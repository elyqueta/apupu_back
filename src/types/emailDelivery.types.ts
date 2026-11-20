/** Tipos da outbox de email. */

export const MESSAGE_TYPES = [
  'manage_link',
  'manager_invite',
  'invitation',
  'reminder',
  'decline_notification',
  'event_cancelled',
  'invitation_removed',
  'invitation_reply',
  'email_verification',
  'registration_otp',
  'host_welcome',
  'password_reset',
  'profile_reminder',
  // Fase 3 — equipas e tarefas.
  'team_invite',
  'team_added',
  'team_role_changed',
  'task_assigned',
  'task_completed',
  'task_reassigned',
] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

/** Mensagens de conta: não dependem de um evento. */
export const HOST_MESSAGE_TYPES: readonly MessageType[] = [
  'email_verification',
  'registration_otp',
  'host_welcome',
  'password_reset',
  'profile_reminder',
];

export function isHostMessage(type: MessageType): boolean {
  return HOST_MESSAGE_TYPES.includes(type);
}

export const DELIVERY_STATUSES = ['pending', 'processing', 'sent', 'failed', 'cancelled'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export interface EmailDelivery {
  id: string;
  /** Nulo em mensagens de conta (verificação, reposição de senha). */
  eventId: string | null;
  invitationId: string | null;
  hostId: string | null;
  messageType: MessageType;
  reminderKind: string | null;
  recipientEmail: string;
  scheduledFor: Date;
  status: DeliveryStatus;
  attempts: number;
  nextAttemptAt: Date | null;
  providerMessageId: string | null;
  lastError: string | null;
  idempotencyKey: string;
  /** Token cifrado para mensagens de conta; nunca o token em claro. */
  tokenEncrypted: string | null;
  /**
   * Variáveis de renderização específicas da mensagem (nome da equipa,
   * título da tarefa, autor, etc.). Nunca contém tokens em claro.
   */
  payload: Record<string, unknown>;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
