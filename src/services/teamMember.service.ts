import { withTransaction } from '../database/pool';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../errors';
import { eventManagerRepository } from '../repositories/eventManager.repository';
import { hostRepository } from '../repositories/host.repository';
import { hostSessionRepository } from '../repositories/hostSession.repository';
import { taskRepository } from '../repositories/task.repository';
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
import { normalizeAngolanPhone } from '../utils/phone.util';
import { eventManagerService } from './eventManager.service';
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

interface MemberContact {
  email: string | null;
  phone: string | null;
  displayName: string | null;
}

function contactKey(contact: MemberContact): string {
  return contact.email ?? `phone:${contact.phone ?? ''}`;
}

function sameContact(
  manager: { email: string | null; phone: string | null },
  member: { email: string | null; phone: string | null }
): boolean {
  if (member.email && manager.email && normalizeEmail(manager.email) === normalizeEmail(member.email)) {
    return true;
  }
  return Boolean(member.phone && manager.phone === member.phone);
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
   * Adiciona até 50 pessoas por pedido (formato legado `emails` ainda
   * aceite). Cada pessoa tem email e/ou telefone; quem só tem telefone
   * fica `convite_telefone` e não recebe nenhuma notificação automática.
   *
   * - normaliza contactos e deduplica por email/telefone;
   * - não deixa a conta adicionar-se a si própria;
   * - emails com conta activa **e verificada** ficam `ativo` e recebem
   *   notificação + email; os restantes recebem o convite pela outbox;
   * - devolve `{ added, pending, skipped }` com o motivo por linha.
   */
  async add(
    scope: EventAccessScope,
    teamId: string,
    input: AddTeamMembersBody
  ): Promise<AddTeamMembersResult> {
    const access = await resolveTeamAccess(teamId, scope);
    assertCanManageTeam(access.role);

    const contacts: MemberContact[] =
      input.members?.map((member) => {
        const email = member.email?.trim() ? normalizeEmail(member.email) : null;
        const phone = member.phone?.trim() ? normalizeAngolanPhone(member.phone) : null;

        if (member.phone?.trim() && !phone) {
          throw new ValidationError('Verifique os campos indicados.', {
            phone: ['Telefone inválido. Use o formato angolano.'],
          });
        }
        if (!email && !phone) {
          throw new ValidationError('Verifique os campos indicados.', {
            email: ['Indique um email ou telefone.'],
            phone: ['Indique um email ou telefone.'],
          });
        }

        return {
          email,
          phone,
          displayName: member.display_name?.trim() || null,
        };
      }) ??
      input.emails?.map((email) => ({
        email: normalizeEmail(email),
        phone: null,
        displayName: null,
      })) ??
      [];

    if (contacts.length > 50) {
      throw new BadRequestError(
        'Só pode adicionar até 50 pessoas por pedido.',
        'too_many_members',
        { members: ['Envie no máximo 50 pessoas por pedido.'] }
      );
    }

    const self = (await scopeEmail(scope))?.toLowerCase() ?? null;
    const actor = await actorName(scope);
    const actorEmail = self;
    const added: TeamMemberAddResult[] = [];
    const pending: TeamMemberAddResult[] = [];
    const skipped: TeamMemberAddResult[] = [];
    const seen = new Set<string>();
    const skippedIndexes = new Set<number>();

    contacts.forEach((contact, index) => {
      const key = contactKey(contact);

      if (seen.has(key)) {
        skippedIndexes.add(index);
        skipped.push({
          email: contact.email,
          phone: contact.phone,
          memberId: null,
          status: contact.email ? 'convite_pendente' : 'convite_telefone',
          reason: 'duplicate_in_request',
        });
        return;
      }

      seen.add(key);

      if (self && contact.email === self) {
        skippedIndexes.add(index);
        skipped.push({
          email: contact.email,
          phone: contact.phone,
          memberId: null,
          status: 'convite_pendente',
          reason: 'self',
        });
        return;
      }
    });

    await withTransaction(async (client) => {
      for (const [index, contact] of contacts.entries()) {
        if (skippedIndexes.has(index)) continue;

        const existing = contact.email
          ? await teamMemberRepository.findActiveByTeamAndEmail(teamId, contact.email, client)
          : await teamMemberRepository.findActiveByTeamAndPhone(teamId, contact.phone!, client);

        if (existing) {
          skipped.push({
            email: existing.email,
            phone: existing.phone,
            memberId: existing.id,
            status: existing.status,
            reason: 'already_member',
          });
          continue;
        }

        // O remetente denunciado ("não conheço este convite") fica
        // bloqueado para aquele email. O motivo devolvido é genérico
        // para não revelar a denúncia a quem a recebeu.
        if (
          contact.email &&
          (await teamInviteRepository.isBlocked(scope.hostId, contact.email, client))
        ) {
          skipped.push({
            email: contact.email,
            phone: contact.phone,
            memberId: null,
            status: 'convite_pendente',
            reason: 'invite_not_possible',
          });
          continue;
        }

        const account = contact.email ? await hostRepository.findByEmail(contact.email) : null;
        const activeAccount =
          account && account.status === 'active' && account.emailVerifiedAt ? account : null;
        const status = activeAccount ? 'ativo' : contact.email ? 'convite_pendente' : 'convite_telefone';
        const origin = contact.email ? 'email' : 'telefone';
        const displayName = contact.displayName ?? activeAccount?.profile.displayName ?? null;
        const removed = contact.email
          ? await teamMemberRepository.findRemovedByTeamAndEmail(teamId, contact.email, client)
          : await teamMemberRepository.findRemovedByTeamAndPhone(teamId, contact.phone!, client);

        let member: TeamMemberWithStats | null;

        if (removed) {
          member = await teamMemberRepository.reactivate(
            removed.id,
            {
              hostId: activeAccount?.id ?? null,
              email: contact.email,
              phone: contact.phone,
              displayName,
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
              email: contact.email,
              phone: contact.phone,
              displayName,
              role: 'membro',
              status,
              origin,
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
          email: member.email,
          phone: member.phone,
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
        } else if (member.email) {
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
        } else {
          // Quem só tem telefone recebe o convite por WhatsApp, fora
          // desta API. Não há envio automático nem notificação in-app.
          pending.push(entry);
        }
      }
    });

    return { added, pending, skipped };
  },

  /**
   * Promover ou despromover exige o anfitrião. Promover cria o acesso ao
   * evento apenas se a equipa não tiver gestor ativo. Despromover revoga
   * o link e as sessões desse gestor, fechando a lacuna da auditoria.
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
      return withTransaction(async (client) => {
        const updated = await teamMemberRepository.updateRole(member.id, 'membro', client);

        if (!updated) {
          throw new NotFoundError(MEMBER_NOT_FOUND, 'team_member_not_found');
        }

        const activeManager = await eventManagerRepository.findActiveByTeam(teamId, client);

        if (activeManager && sameContact(activeManager, member)) {
          const revoked = await eventManagerRepository.revoke(activeManager.id, client);
          if (revoked) {
            await hostSessionRepository.revokeAllForManager(activeManager.id, client);
          }
        }

        await notifyRoleChanged({
          eventId: access.team.eventId,
          teamId: access.team.id,
          member: updated,
          teamName: access.team.name,
          actorName: actor,
          actorEmail,
          client,
        });

        return { member: updated, eventManagerId: null };
      });
    }

    return withTransaction(async (client) => {
      const updated = await teamMemberRepository.updateRole(member.id, 'gestor', client);

      if (!updated) {
        throw new NotFoundError(MEMBER_NOT_FOUND, 'team_member_not_found');
      }

      const accessGrant = await eventManagerService.ensureForMember(
        scope.hostId,
        access.team.eventId,
        teamId,
        {
          email: member.email,
          phone: member.phone,
          displayName: member.displayName,
        },
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

      return {
        member: updated,
        eventManagerId: accessGrant.manager.id,
        accessCode: accessGrant.code,
        accessLink: accessGrant.link,
      };
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
          // O contexto da notificação precisa do criador original da
          // tarefa; `openTasksForMember` devolve só o resumo usado nos
          // detalhes do erro, por isso lemos a tarefa completa.
          const fresh = await taskRepository.findById(task.id, client);

          await notifyTaskReassigned({
            event: {
              taskId: task.id,
              taskTitle: task.title,
              eventId: access.team.eventId,
              eventTitle: access.team.eventTitle,
              teamName: access.team.name,
              actorName: actor,
              actorEmail,
              createdByHostId: fresh?.createdByHostId ?? null,
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
