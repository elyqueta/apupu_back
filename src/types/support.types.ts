/** Tipos das mensagens de apoio enviadas pelo formulário público. */
export type SupportMessageStatus = 'open' | 'resolved';

export interface SupportMessage {
  id: string;
  name: string;
  email: string;
  message: string;
  status: SupportMessageStatus;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSupportMessageInput {
  name: string;
  email: string;
  message: string;
}
