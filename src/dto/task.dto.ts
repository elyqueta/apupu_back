import { HostTask } from '../types/host.types';

export interface TaskDto {
  id: string;
  event_id: string | null;
  label: string;
  done: boolean;
  created_at: string;
  updated_at: string;
}

export function toTaskDto(task: HostTask): TaskDto {
  return {
    id: task.id,
    event_id: task.eventId,
    label: task.label,
    done: task.done,
    created_at: task.createdAt.toISOString(),
    updated_at: task.updatedAt.toISOString(),
  };
}
