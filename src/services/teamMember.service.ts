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
   * - emails com conta activa ficam `ativo`; os restantes ficam
   *   `convite_pendente` (o envio do convite é da Fase 3);
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

        const account = await hostRepository.findByEmail(email);
        const activeAccount = account && account.status === 'active' ? account : null;
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
          added.push(entry);
        } else {
          pending.push(entry);
        }

        // TODO(Fase 3): enviar convite por email ao membro pendente e
        // criar a notificação transacional correspondente.
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

    if (input.role === 'membro') {
      const updated = await teamMemberRepository.updateRole(member.id, 'membro');

      if (!updated) {
        throw new NotFoundError(MEMBER_NOT_FOUND, 'team_member_not_found');
      }

      // Decisão aprovada: despromover só mexe no papel de equipa. O
      // acesso ao evento em `event_managers` não é revogado aqui.
      // TODO(Fase 3): notificar a alteração de papel.
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

      // TODO(Fase 3): notificar a promoção a gestor.
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

        // TODO(Fase 3): notificar a remoção e a reatribuição.
        return { removed: true as const, reassignedTasks };
      });
    }

    await teamMemberRepository.softRemove(memberId);

    // TODO(Fase 3): notificar a remoção.
    return { removed: true as const, reassignedTasks: 0 };
  },
};
