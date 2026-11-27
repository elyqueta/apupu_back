import { ForbiddenError, NotFoundError } from '../errors';
import { eventRepository } from '../repositories/event.repository';
import { hostRepository } from '../repositories/host.repository';
import { taskRepository } from '../repositories/task.repository';
import { teamMemberRepository } from '../repositories/teamMember.repository';
import { teamRepository } from '../repositories/team.repository';
import { EventAccessScope } from '../types/event.types';
import { Task, TeamMemberWithStats, TeamWithStats } from '../types/team.types';

/** Papel efectivo de uma conta dentro de um evento/equipa. */
export type ResourceRole = 'host' | 'manager' | 'member';

export interface TeamAccess {
  team: TeamWithStats;
  role: ResourceRole;
}

export interface TaskAccess {
  task: Task;
  team: TeamWithStats | null;
  role: ResourceRole;
}

const EVENT_NOT_FOUND = 'Evento não encontrado.';
const TEAM_NOT_FOUND = 'Equipa não encontrada.';
const TASK_NOT_FOUND = 'Tarefa não encontrada.';

/**
 * Resolve o papel da conta num evento.
 *
 * Anfitrião e gestor activo vêm de `events`/`event_managers`. Um membro
 * de equipa sem acesso de gestão também conta como `member`, mas só
 * dentro das equipas em que está activo.
 */
export async function resolveEventRole(
  eventId: string,
  scope: EventAccessScope
): Promise<ResourceRole | null> {
  const access = await eventRepository.findByIdForAccess(eventId, scope);
  // Membro da comunidade participa nas equipas como membro, sem poderes
  // de gestão (os votos de equipa continuam reservados a anfitrião/gestor).
  if (access) return access.accessRole === 'communityMember' ? 'member' : access.accessRole;

  if (!scope.managerEmail) return null;

  const isMember = await teamMemberRepository.existsActiveInEvent(
    eventId,
    scope.managerEmail
  );

  return isMember ? 'member' : null;
}

export async function requireEventRole(
  eventId: string,
  scope: EventAccessScope
): Promise<ResourceRole> {
  const role = await resolveEventRole(eventId, scope);

  if (!role) {
    throw new NotFoundError(EVENT_NOT_FOUND, 'event_not_found');
  }

  return role;
}

/**
 * Resolve o acesso a uma equipa. Qualquer recurso de um evento sem
 * acesso devolve 404 (nunca 403), para não revelar a sua existência.
 */
export async function resolveTeamAccess(
  teamId: string,
  scope: EventAccessScope
): Promise<TeamAccess> {
  const team = await teamRepository.findById(teamId);

  if (!team) {
    throw new NotFoundError(TEAM_NOT_FOUND, 'team_not_found');
  }

  let role = await resolveEventRole(team.eventId, scope);

  // Bloco 11: o criador e quem gere um dos eventos associados também vê a
  // equipa. O criador tem poderes de anfitrião; os restantes, de gestor.
  if (!role && team.createdByHostId === scope.hostId) {
    role = 'host';
  }
  if (!role) {
    for (const eventId of team.eventIds) {
      if (eventId === team.eventId) continue;
      const other = await resolveEventRole(eventId, scope);
      if (other === 'host' || other === 'manager') {
        role = 'manager';
        break;
      }
    }
  }

  if (!role) {
    throw new NotFoundError(TEAM_NOT_FOUND, 'team_not_found');
  }

  if (role === 'member') {
    if (!scope.managerEmail) {
      throw new NotFoundError(TEAM_NOT_FOUND, 'team_not_found');
    }

    const membership = await teamMemberRepository.findActiveByTeamAndEmail(
      team.id,
      scope.managerEmail
    );

    if (!membership) {
      throw new NotFoundError(TEAM_NOT_FOUND, 'team_not_found');
    }
  }

  return { team, role };
}

/**
 * Resolve o acesso a uma tarefa.
 *
 * Tarefas com equipa seguem o acesso da equipa. Tarefas pessoais
 * (`team_id = null`) só existem para quem as criou.
 */
export async function resolveTaskAccess(
  taskId: string,
  scope: EventAccessScope
): Promise<TaskAccess> {
  const task = await taskRepository.findById(taskId);

  if (!task || task.archivedAt) {
    throw new NotFoundError(TASK_NOT_FOUND, 'task_not_found');
  }

  if (task.teamId) {
    try {
      const access = await resolveTeamAccess(task.teamId, scope);
      return { task, team: access.team, role: access.role };
    } catch (error) {
      // O pedido é sobre uma tarefa: um evento/equipa sem acesso não
      // deve revelar que a equipa existe. O contrato de tarefas devolve
      // sempre `404 task_not_found`.
      if (error instanceof NotFoundError) {
        throw new NotFoundError(TASK_NOT_FOUND, 'task_not_found');
      }
      throw error;
    }
  }

  if (task.hostId !== scope.hostId) {
    throw new NotFoundError(TASK_NOT_FOUND, 'task_not_found');
  }

  return { task, team: null, role: 'host' };
}

/** Email da conta autenticada, mesmo quando ainda não foi verificado. */
export async function scopeEmail(scope: EventAccessScope): Promise<string | null> {
  if (scope.managerEmail) return scope.managerEmail;

  const host = await hostRepository.findById(scope.hostId);
  return host?.email ?? null;
}

/**
 * Linha de `team_members` que representa a conta autenticada na equipa.
 * Para o anfitrião usa a linha `is_host`; para os restantes, o email.
 */
export async function memberForScope(
  teamId: string,
  role: ResourceRole,
  scope: EventAccessScope
): Promise<TeamMemberWithStats | null> {
  if (role === 'host') {
    return teamMemberRepository.findHostMember(teamId);
  }

  if (!scope.managerEmail) return null;

  return teamMemberRepository.findActiveByTeamAndEmail(teamId, scope.managerEmail);
}

/** Só o anfitrião e os gestores podem criar/editar/apagar equipas. */
export function assertCanManageTeam(role: ResourceRole): void {
  if (role !== 'host' && role !== 'manager') {
    throw new ForbiddenError(
      'Apenas o anfitrião ou um gestor pode gerir equipas.',
      'team_action_forbidden'
    );
  }
}

/** Promover ou despromover um gestor é uma acção exclusiva do anfitrião. */
export function assertHost(role: ResourceRole): void {
  if (role !== 'host') {
    throw new ForbiddenError(
      'Apenas o anfitrião pode promover ou despromover gestores.',
      'host_action_forbidden'
    );
  }
}
