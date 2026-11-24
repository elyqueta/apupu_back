import { Task } from '../types/team.types';

/**
 * Contrato da tarefa.
 *
 * `label` e `done` continuam presentes, marcados como obsoletos, para
 * não quebrar clientes antigos durante a transição. A fonte de verdade
 * é `title`/`status`.
 */
export interface TaskDto {
  id: string;
  event_id: string | null;
  event_title: string | null;
  team_id: string | null;
  team_name: string | null;
  assignee_member_id: string | null;
  assignee_email: string | null;
  assignee_display_name: string | null;
  /** `false` → mostrar "Responsável sem acesso". */
  assignee_has_access: boolean | null;
  title: string;
  description: string | null;
  due_date: string | null;
  priority: string;
  status: string;
  created_by_host_id: string | null;
  /** Autor da tarefa (persistente). */
  created_by_name: string | null;
  completed_by_member_id: string | null;
  completed_by_name: string | null;
  completed_at: string | null;
  archived_at: string | null;
  /** @deprecated Use `title`. */
  label: string;
  /** @deprecated Use `status === 'concluida'`. */
  done: boolean;
  /** @deprecated Mantido apenas para leitura durante a transição. */
  manager_id: string | null;
  /** @deprecated Mantido apenas para leitura durante a transição. */
  manager_email: string | null;
  created_at: string;
  updated_at: string;
}

export function toTaskDto(task: Task): TaskDto {
  return {
    id: task.id,
    event_id: task.eventId,
    event_title: task.eventTitle,
    team_id: task.teamId,
    team_name: task.teamName,
    assignee_member_id: task.assigneeMemberId,
    assignee_email: task.assigneeEmail,
    assignee_display_name: task.assigneeDisplayName,
    assignee_has_access: task.assigneeHasAccess,
    title: task.title,
    description: task.description,
    due_date: task.dueDate,
    priority: task.priority,
    status: task.status,
    created_by_host_id: task.createdByHostId,
    created_by_name: task.createdByName ?? null,
    completed_by_member_id: task.completedByMemberId,
    completed_by_name: task.completedByName ?? null,
    completed_at: task.completedAt?.toISOString() ?? null,
    archived_at: task.archivedAt?.toISOString() ?? null,
    label: task.title,
    done: task.status === 'concluida',
    manager_id: task.managerId,
    manager_email: task.managerEmail,
    created_at: task.createdAt.toISOString(),
    updated_at: task.updatedAt.toISOString(),
  };
}
