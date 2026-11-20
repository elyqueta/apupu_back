import { SupportMessage } from '../types/support.types';

/** Vista administrativa de uma mensagem de apoio (campos em snake_case). */
export interface SupportMessageDto {
  id: string;
  name: string;
  email: string;
  message: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

export function toSupportMessageDto(message: SupportMessage): SupportMessageDto {
  return {
    id: message.id,
    name: message.name,
    email: message.email,
    message: message.message,
    status: message.status,
    created_at: message.createdAt.toISOString(),
    resolved_at: message.resolvedAt?.toISOString() ?? null,
    resolved_by: message.resolvedBy,
  };
}
