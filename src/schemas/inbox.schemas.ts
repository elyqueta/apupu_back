import { z } from 'zod';
import { paginationQueryFields } from '../utils/pagination.util';

/** Filtros da caixa de entrada de mensagens (Parte F). */
export const inboxQuerySchema = z.object({
  q: z.string().trim().max(150).optional(),
  event_id: z.string().uuid('Identificador de evento inválido.').optional(),
  read: z.enum(['read', 'unread']).optional(),
  answered: z.enum(['answered', 'unanswered']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  ...paginationQueryFields,
});

export const inboxAnswerSchema = z
  .object({
    answer: z
      .string({ error: 'A resposta é obrigatória.' })
      .trim()
      .min(1, 'Escreve uma resposta.')
      .max(1000, 'A resposta não pode exceder 1000 caracteres.'),
  })
  .strict();

export const inboxReadSchema = z
  .object({
    read: z.boolean().default(true),
  })
  .strict();

export const inboxIdParamsSchema = z.object({
  invitationId: z.string().uuid('Identificador inválido.'),
});

export type InboxQuery = z.infer<typeof inboxQuerySchema>;
export type InboxAnswerBody = z.infer<typeof inboxAnswerSchema>;
export type InboxReadBody = z.infer<typeof inboxReadSchema>;
