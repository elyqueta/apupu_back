import { HostTask } from '../types/host.types';

export interface TaskDto {
  id: string;
  event_id: string | null;
  event_title: string | null;
  manager_id: string | null;
  manager_email: string | null;
  label: string;
  done: boolean;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export function toTaskDto(task: HostTask): TaskDto {
  return {
    id: task.id,
    event_id: task.eventId,
    event_title: task.eventTitle,
    manager_id: task.managerId,
    manager_email: task.managerEmail,
    label: task.label,
    done: task.done,
    completed_at: task.completedAt?.toISOString() ?? null,
    created_at: task.createdAt.toISOString(),
    updated_at: task.updatedAt.toISOString(),
  };
}
