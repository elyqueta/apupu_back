import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { communityRepository } from '../repositories/community.repository';
import { teamMemberRepository } from '../repositories/teamMember.repository';
import { communityPermissions } from './communityPermissions';
import { withTransaction } from '../database/pool';
import { teamRepository } from '../repositories/team.repository';
import {
  CreateTeamBody,
  DeleteTeamQuery,
  SetTeamEventsBody,
  TeamListQuery,
  UpdateTeamBody,
} from '../schemas/team.schemas';
import { EventAccessScope } from '../types/event.types';
import { PaginationMeta } from '../types/pagination.types';
import { TeamMyRole, TeamWithStats } from '../types/team.types';
import { buildPaginationMeta, toPageParams } from '../utils/pagination.util';
import {
  assertCanManageTeam,
  memberForScope,
  requireEventRole,
  resolveTeamAccess,
  ResourceRole,
  scopeEmail,
} from './teamAccess.service';

export interface TeamListResult {
  items: TeamWithStats[];
  pagination: PaginationMeta;
}

export interface DeleteTeamResult {
  deleted: true;
  reassignedToTeamId: string | null;
  archivedTasks: number;
  reassignedTasks: number;
}

/**
 * Papel efectivo da conta na equipa. O anfitrião do evento é sempre
 * `anfitriao`; os restantes usam a linha de `team_members` e, na sua
 * ausência, o papel no evento.
 */
async function myRoleFor(
  teamId: string,
  role: ResourceRole,
  scope: EventAccessScope
): Promise<TeamMyRole> {
  if (role === 'host') return 'anfitriao';

  const member = await memberForScope(teamId, role, scope);
  if (member) return member.role === 'gestor' ? 'gestor' : 'membro';

  return role === 'manager' ? 'gestor' : 'membro';
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}

export const teamService = {
  /**
   * Bloco 11: associa a equipa a um, vários ou todos os eventos. Só o
   * criador; o evento principal (`teams.event_id`) mantém-se sempre.
   */
  async setEvents(
    scope: EventAccessScope,
    teamId: string,
    input: SetTeamEventsBody
  ): Promise<TeamWithStats> {
    const { team } = await resolveTeamAccess(teamId, scope);
    if (team.createdByHostId !== scope.hostId) {
      throw new ForbiddenError(
        'Só quem criou a equipa a pode associar a outros eventos.',
        'team_creator_only'
      );
    }

    const assignable = await teamRepository.listAssignableEventIds(scope.hostId, team.communityId);
    // "Todos": numa equipa de comunidade, todos os eventos da comunidade;
    // sem comunidade, todos os eventos de que o criador é anfitrião.
    const requested = input.all
      ? team.communityId
        ? await teamRepository.listAssignableEventIds(scope.hostId, team.communityId, true)
        : assignable
      : input.event_ids;
    const invalid = requested.filter((id) => !assignable.includes(id));
    if (invalid.length > 0) {
      throw new ValidationError('Verifique os campos indicados.', {
        event_ids: ['Só pode associar eventos que gere.'],
      });
    }

    await withTransaction((client) => teamRepository.setEvents(team.id, team.eventId, requested, client));
    const updated = await teamRepository.findById(team.id);
    if (!updated) throw new NotFoundError('Equipa não encontrada.', 'team_not_found');
    return updated;
  },

  async removeEvent(scope: EventAccessScope, teamId: string, eventId: string): Promise<TeamWithStats> {
    const { team } = await resolveTeamAccess(teamId, scope);
    if (team.createdByHostId !== scope.hostId) {
      throw new ForbiddenError(
        'Só quem criou a equipa a pode associar a outros eventos.',
        'team_creator_only'
      );
    }
    if (eventId === team.eventId) {
      throw new ConflictError('O evento principal da equipa não pode ser retirado.', 'team_primary_event');
    }
    await withTransaction((client) =>
      teamRepository.setEvents(
        team.id,
        team.eventId,
        team.eventIds.filter((id) => id !== eventId),
        client
      )
    );
    const updated = await teamRepository.findById(team.id);
    if (!updated) throw new NotFoundError('Equipa não encontrada.', 'team_not_found');
    return updated;
  },

  /** Bloco 11: um membro sai da equipa quando quiser (o anfitrião implícito não). */
  async leave(scope: EventAccessScope, teamId: string): Promise<void> {
    const { team } = await resolveTeamAccess(teamId, scope);
    const email = scope.managerEmail;
    const member = email ? await teamMemberRepository.findActiveByTeamAndEmail(team.id, email) : null;
    if (!member || member.isHost) {
      throw new NotFoundError('Não é membro desta equipa.', 'team_member_not_found');
    }
    await teamMemberRepository.softRemove(member.id);
  },

  async list(scope: EventAccessScope, query: TeamListQuery): Promise<TeamListResult> {
    if (query.event_id) {
      await requireEventRole(query.event_id, scope);
    }

    const page = toPageParams(query.page, query.page_size);
    const { items, total } = await teamRepository.listForAccess({
      hostId: scope.hostId,
      managerEmail: scope.managerEmail,
      actorEmail: await scopeEmail(scope),
      eventId: query.event_id,
      category: query.category,
      role: query.role,
      eventStatus: query.event_status,
      mine: query.mine,
      q: query.q,
      offset: page.offset,
      limit: page.limit,
    });

    return {
      items,
      pagination: buildPaginationMeta(total, page.page, page.pageSize),
    };
  },

  async get(scope: EventAccessScope, teamId: string): Promise<TeamWithStats> {
    const access = await resolveTeamAccess(teamId, scope);
    return {
      ...access.team,
      myRole: await myRoleFor(teamId, access.role, scope),
    };
  },

  /**
   * Cria a equipa e materializa o anfitrião e os gestores activos na
   * mesma transação. A materialização é idempotente.
   */
  async create(scope: EventAccessScope, input: CreateTeamBody): Promise<TeamWithStats> {
    const role = await requireEventRole(input.event_id, scope);
    assertCanManageTeam(role);

    if (input.community_id) {
      const member = await communityRepository.findMemberByHost(input.community_id, scope.hostId);
      const allowed = communityPermissions.canCreateTeam({
        role: member?.role ?? null,
        status: member?.status ?? null,
        isHostAccount: member?.hasHostAccount ?? false,
      });
      if (!allowed) {
        throw new ForbiddenError(
          'Só gestores e o responsável criam equipas na comunidade.',
          'community_forbidden'
        );
      }
    }

    try {
      const team = await withTransaction(async (client) => {
        const created = await teamRepository.create(
          {
            eventId: input.event_id,
            name: input.name,
            category: input.category,
            description: input.description ?? null,
            createdByHostId: scope.hostId,
            communityId: input.community_id ?? null,
          },
          client
        );

        await teamRepository.materializeEventStaff(created.id, client);
        // A materialização insere os membros do evento na mesma transação: reler
        // para devolver contagens e `members_preview` já actualizados.
        const materialized = await teamRepository.findById(created.id, client);
        if (!materialized) {
          throw new Error('Falha ao ler a equipa criada.');
        }
        return materialized;
      });

      return {
        ...team,
        myRole: await myRoleFor(team.id, role, scope),
      };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError(
          'Já existe uma equipa com esse nome neste evento.',
          'team_name_conflict'
        );
      }
      throw error;
    }
  },

  async update(
    scope: EventAccessScope,
    teamId: string,
    input: UpdateTeamBody
  ): Promise<TeamWithStats> {
    const access = await resolveTeamAccess(teamId, scope);
    assertCanManageTeam(access.role);

    try {
      const updated = await teamRepository.update(teamId, input);

      if (!updated) {
        throw new NotFoundError('Equipa não encontrada.', 'team_not_found');
      }

      return {
        ...updated,
        myRole: await myRoleFor(teamId, access.role, scope),
      };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError(
          'Já existe uma equipa com esse nome neste evento.',
          'team_name_conflict'
        );
      }
      throw error;
    }
  },

  /**
   * Remove (sempre logicamente) uma equipa.
   *
   * Com tarefas abertas, exige confirmação explícita e uma das duas
   * saídas: reatribuir para outra equipa do mesmo evento ou arquivar as
   * tarefas. Sem confirmação devolve `409 team_has_open_tasks` com a
   * lista, para o frontend pedir a decisão ao utilizador.
   */
  async remove(
    scope: EventAccessScope,
    teamId: string,
    query: DeleteTeamQuery
  ): Promise<DeleteTeamResult> {
    const access = await resolveTeamAccess(teamId, scope);
    assertCanManageTeam(access.role);

    const openTasks = await teamRepository.listOpenTasks(teamId);

    if (openTasks.length > 0) {
      if (!query.confirm) {
        throw new ConflictError(
          'Esta equipa tem tarefas abertas. Reatribua-as ou confirme o arquivo.',
          'team_has_open_tasks',
          undefined,
          { tasks: openTasks }
        );
      }

      if (query.reassign_to_team_id) {
        if (query.reassign_to_team_id === teamId) {
          throw new ValidationError('Verifique os campos indicados.', {
            reassign_to_team_id: ['Indique uma equipa de destino diferente.'],
          });
        }

        const target = await resolveTeamAccess(query.reassign_to_team_id, scope);

        if (target.team.eventId !== access.team.eventId) {
          throw new ValidationError('Verifique os campos indicados.', {
            reassign_to_team_id: ['A equipa de destino tem de ser do mesmo evento.'],
          });
        }

        assertCanManageTeam(target.role);

        const fallback = await teamRepository.defaultAssignee(target.team.id);

        if (!fallback) {
          throw new ValidationError('Verifique os campos indicados.', {
            reassign_to_team_id: [
              'A equipa de destino não tem anfitrião nem gestor para assumir as tarefas.',
            ],
          });
        }

        return withTransaction(async (client) => {
          const reassignedTasks = await teamRepository.reassignTasksToTeam(
            teamId,
            target.team.id,
            client
          );

          await teamRepository.softDelete(teamId, client);

          return {
            deleted: true as const,
            reassignedToTeamId: target.team.id,
            archivedTasks: 0,
            reassignedTasks,
          };
        });
      }

      if (!query.archive) {
        throw new ValidationError('Verifique os campos indicados.', {
          archive: ['Confirme o arquivo das tarefas ou indique a equipa de destino.'],
        });
      }

      return withTransaction(async (client) => {
        const archivedTasks = await teamRepository.archiveTasks(teamId, client);
        await teamRepository.softDelete(teamId, client);

        return {
          deleted: true as const,
          reassignedToTeamId: null,
          archivedTasks,
          reassignedTasks: 0,
        };
      });
    }

    await teamRepository.softDelete(teamId);

    return {
      deleted: true as const,
      reassignedToTeamId: null,
      archivedTasks: 0,
      reassignedTasks: 0,
    };
  },
};
