import { withTransaction } from '../database/pool';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../errors';
import { eventManagerRepository } from '../repositories/eventManager.repository';
import { hostRepository } from '../repositories/host.repository';
import { teamMemberRepository } from '../repositories/teamMember.repository';
import {
  AddTeamMembersBody,
  RemoveTeamMemberQuery,
  TeamMemberListQuery,
  UpdateTeamMemberRoleBody,
} from '../schemas/team.schemas';
import { EventAccessScope } from '../types/event.types';
import { PaginationMeta } from '../types/pagination.types';
import {
  TeamMemberAddResult,
  TeamMemberWithStats,
  UpdateMemberRoleResult,
} from '../types/team.types';
import { buildPaginationMeta, toPageParams } from '../utils/pagination.util';
import {
  assertCanManageTeam,
  assertHost,
  resolveTeamAccess,
  scopeEmail,
} from './teamAccess.service';
import { teamInviteRepository } from '../repositories/teamInvite.repository';
import { createInviteForMember, teamInviteService } from './teamInvite.service';
import {
  notifyRoleChanged,
  notifyTaskReassigned,
  notifyTeamMemberAdded,
} from './teamNotification.service';

export interface TeamMemberListResult {
  items: TeamMemberWithStats[];
  pagination: PaginationMeta;
}

export interface AddTeamMembersResult {
  added: TeamMemberAddResult[];
  pending: TeamMemberAddResult[];
  skipped: TeamMemberAddResult[];
}

const MEMBER_NOT_FOUND = 'Membro não encontrado.';

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Nome da conta autenticada usado nas notificações. */
async function actorName(scope: EventAccessScope): Promise<string> {
  const host = await hostRepository.findById(scope.hostId);
  return host?.profile.displayName?.trim() || host?.email || 'O anfitrião';
}

export const teamMemberService = {
  async list(
    scope: EventAccessScope,
    teamId: string,
    query: TeamMemberListQuery
  ): Promise<TeamMemberListResult> {
    await resolveTeamAccess(teamId, scope);

    const page = toPageParams(query.page, query.page_size);
    const { items, total } = await teamMemberRepository.listForTeam(teamId, {
      role: query.role,
      status: query.status,
      q: query.q,
      offset: page.offset,
      limit: page.limit,
    });

    return {
      items,
      pagination: buildPaginationMeta(total, page.page, page.pageSize),
    };
  },

  /**
   * Adiciona até 50 emails por pedido.
   *
   * - normaliza (trim + minúsculas) e deduplica;
   * - não deixa a conta adicionar-se a si própria;
   * - emails com conta activa **e verificada** ficam `ativo` e recebem
   *   notificação + email; os restantes ficam `convite_pendente` e
   *   recebem o convite pela outbox, salvo bloqueio do remetente;
   * - devolve `{ added, pending, skipped }` com o motivo por linha.
   */
  async add(
    scope: EventAccessScope,
    teamId: string,
    input: AddTeamMembersBody
  ): Promise<AddTeamMembersResult> {
    const access = await resolveTeamAccess(teamId, scope);
    assertCanManageTeam(access.role);

    if (input.emails.length > 50) {
      throw new BadRequestError(
        'Só pode adicionar até 50 emails por pedido.',
        'too_many_emails',
        { emails: ['Envie no máximo 50 emails por pedido.'] }
      );
    }

    const self = (await scopeEmail(scope))?.toLowerCase() ?? null;
    const actor = await actorName(scope);
    const actorEmail = self;
    const added: TeamMemberAddResult[] = [];
    const pending: TeamMemberAddResult[] = [];
    const skipped: TeamMemberAddResult[] = [];
    const seen = new Set<string>();
    const emails: string[] = [];

    for (const raw of input.emails) {
      const email = normalizeEmail(raw);

      if (seen.has(email)) {
        skipped.push({
          email,
          memberId: null,
          status: 'convite_pendente',
          reason: 'duplicate_in_request',
        });
        continue;
      }

      seen.add(email);

      if (self && email === self) {
        skipped.push({
          email,
          memberId: null,
          status: 'convite_pendente',
          reason: 'self',
        });
        continue;
      }

      emails.push(email);
    }

    await withTransaction(async (client) => {
      for (const email of emails) {
        const existing = await teamMemberRepository.findActiveByTeamAndEmail(
          teamId,
          email,
          client
        );

        if (existing) {
          skipped.push({
            email,
            memberId: existing.id,
            status: existing.status,
            reason: 'already_member',
          });
          continue;
        }

        // O remetente denunciado ("não conheço este convite") fica
        // bloqueado para aquele email. O motivo devolvido é genérico
        // para não revelar a denúncia a quem a recebeu.
        if (await teamInviteRepository.isBlocked(scope.hostId, email, client)) {
          skipped.push({
            email,
            memberId: null,
            status: 'convite_pendente',
            reason: 'invite_not_possible',
          });
          continue;
        }

        const account = await hostRepository.findByEmail(email);
        const activeAccount =
          account && account.status === 'active' && account.emailVerifiedAt ? account : null;
        const status = activeAccount ? 'ativo' : 'convite_pendente';
        const removed = await teamMemberRepository.findRemovedByTeamAndEmail(
          teamId,
          email,
          client
        );

        let member: TeamMemberWithStats | null;

        if (removed) {
          member = await teamMemberRepository.reactivate(
            removed.id,
            {
              hostId: activeAccount?.id ?? null,
              displayName: activeAccount?.profile.displayName ?? null,
              status,
              invitedByHostId: scope.hostId,
              joinedAt: activeAccount ? new Date() : null,
            },
            client
          );
        } else {
          member = await teamMemberRepository.create(
            {
              teamId,
              hostId: activeAccount?.id ?? null,
              email,
              displayName: activeAccount?.profile.displayName ?? null,
              role: 'membro',
              status,
              origin: 'email',
              isHost: false,
              invitedByHostId: scope.hostId,
              joinedAt: activeAccount ? new Date() : null,
            },
            client
          );
        }

        if (!member) {
          throw new Error('Falha ao adicionar membro à equipa.');
        }

        const entry: TeamMemberAddResult = {
          email,
          memberId: member.id,
          status: member.status,
        };

        if (member.status === 'ativo') {
          // Conta registada e com email verificado: recebe in-app e
          // email, porque já pode entrar imediatamente.
          await notifyTeamMemberAdded({
            eventId: access.team.eventId,
            teamId: access.team.id,
            teamName: access.team.name,
            member,
            actorName: actor,
            actorEmail,
            client,
          });

          added.push(entry);
        } else {
          // Sem conta ou com email por verificar: fica pendente e recebe
          // apenas o convite por email. Nunca é ativado sem verificar.
          const invite = await createInviteForMember({
            member,
            team: access.team,
            actorName: actor,
            actorHostId: scope.hostId,
            client,
          });

          if (invite.reason) {
            entry.reason = invite.reason;
          }

          pending.push(entry);
        }
      }
    });

    return { added, pending, skipped };
  },

  /**
   * Promover ou despromover exige o anfitrião. Promover cria/reactiva o
   * acesso ao evento (`event_managers`) na mesma transação; despromover
   * altera apenas o papel na equipa, sem revogar o acesso ao evento.
   */
  async updateRole(
    scope: EventAccessScope,
    teamId: string,
    memberId: string,
    input: UpdateTeamMemberRoleBody
  ): Promise<UpdateMemberRoleResult> {
    const access = await resolveTeamAccess(teamId, scope);

    // A matriz do Prompt 5 reserva ao anfitrião as duas direcções: um
    // gestor não promove nem despromove outro gestor.
    assertHost(access.role);

    const member = await teamMemberRepository.findById(memberId);

    if (!member || member.teamId !== teamId || member.removedAt) {
      throw new NotFoundError(MEMBER_NOT_FOUND, 'team_member_not_found');
    }

    if (member.isHost) {
      throw new ConflictError(
        'O anfitrião não pode ser removido nem despromovido.',
        'host_member_immutable'
      );
    }

    if (member.role === input.role) {
      return { member, eventManagerId: null };
    }

    const actor = await actorName(scope);
    const actorEmail = await scopeEmail(scope);

    if (input.role === 'membro') {
      const updated = await teamMemberRepository.updateRole(member.id, 'membro');

      if (!updated) {
        throw new NotFoundError(MEMBER_NOT_FOUND, 'team_member_not_found');
      }

      // Decisão aprovada: despromover só mexe no papel de equipa. O
      // acesso ao evento em `event_managers` não é revogado aqui.
      await notifyRoleChanged({
        eventId: access.team.eventId,
        teamId: access.team.id,
        member: updated,
        teamName: access.team.name,
        actorName: actor,
        actorEmail,
      });

      return { member: updated, eventManagerId: null };
    }

    return withTransaction(async (client) => {
      const updated = await teamMemberRepository.updateRole(member.id, 'gestor', client);

      if (!updated) {
        throw new NotFoundError(MEMBER_NOT_FOUND, 'team_member_not_found');
      }

      const manager = await eventManagerRepository.ensureActiveForEmail(
        access.team.eventId,
        member.email,
        client
      );

      await notifyRoleChanged({
        eventId: access.team.eventId,
        teamId: access.team.id,
        member: updated,
        teamName: access.team.name,
        actorName: actor,
        actorEmail,
        client,
      });

      return { member: updated, eventManagerId: manager.id };
    });
  },

  /**
   * Remove logicamente um membro.
   *
   * Com tarefas abertas devolve `409 member_has_open_tasks` com a
   * lista; o cliente pode repetir com `reassign_to_member_id` para
   * reatribuir tudo e remover na mesma transação.
   */
  async remove(
    scope: EventAccessScope,
    teamId: string,
    memberId: string,
    query: RemoveTeamMemberQuery
  ): Promise<{ removed: true; reassignedTasks: number }> {
    const access = await resolveTeamAccess(teamId, scope);
    assertCanManageTeam(access.role);

    const member = await teamMemberRepository.findById(memberId);

    if (!member || member.teamId !== teamId || member.removedAt) {
      throw new NotFoundError(MEMBER_NOT_FOUND, 'team_member_not_found');
    }

    if (member.isHost) {
      throw new ConflictError(
        'O anfitrião não pode ser removido nem despromovido.',
        'host_member_immutable'
      );
    }

    const openTasks = await teamMemberRepository.openTasksForMember(memberId);
    const actor = await actorName(scope);
    const actorEmail = await scopeEmail(scope);

    if (openTasks.length > 0) {
      if (!query.reassign_to_member_id) {
        throw new ConflictError(
          'Este membro tem tarefas abertas. Reatribua-as antes de o remover.',
          'member_has_open_tasks',
          undefined,
          { tasks: openTasks }
        );
      }

      if (query.reassign_to_member_id === memberId) {
        throw new ValidationError('Verifique os campos indicados.', {
          reassign_to_member_id: ['Indique outro responsável.'],
        });
      }

      const target = await teamMemberRepository.findById(query.reassign_to_member_id);

      if (
        !target ||
        target.teamId !== teamId ||
        target.removedAt ||
        target.id === memberId
      ) {
        throw new ValidationError('Verifique os campos indicados.', {
          reassign_to_member_id: ['O novo responsável tem de ser membro activo desta equipa.'],
        });
      }

      return withTransaction(async (client) => {
        const reassignedTasks = await teamMemberRepository.reassignOpenTasks(
          memberId,
          target.id,
          client
        );

        await teamMemberRepository.softRemove(memberId, client);
        await teamInviteService.revokeForMember(memberId, client);

        for (const task of openTasks) {
          await notifyTaskReassigned({
            event: {
              taskId: task.id,
              taskTitle: task.title,
              eventId: access.team.eventId,
              eventTitle: access.team.eventTitle,
              teamName: access.team.name,
              actorName: actor,
              actorEmail,
            },
            newAssignee: target,
            previousAssignee: null,
            client,
          });
        }

        return { removed: true as const, reassignedTasks };
      });
    }

    return withTransaction(async (client) => {
      await teamMemberRepository.softRemove(memberId, client);
      await teamInviteService.revokeForMember(memberId, client);

      return { removed: true as const, reassignedTasks: 0 };
    });
  },
};
