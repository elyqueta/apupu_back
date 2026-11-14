/** Tipos da outbox de email. */

export const MESSAGE_TYPES = [
  'manage_link',
  'invitation',
  'reminder',
  'decline_notification',
  'event_cancelled',
] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export const DELIVERY_STATUSES = ['pending', 'processing', 'sent', 'failed', 'cancelled'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export interface EmailDelivery {
  id: string;
  eventId: string;
  invitationId: string | null;
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
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
