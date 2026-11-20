import { z } from 'zod';
import { SORT_ORDERS, paginationQueryFields } from '../utils/pagination.util';
import { EVENT_STATUSES } from '../types/event.types';
import { HOST_STATUSES } from '../types/host.types';

/**
 * Contratos das rotas administrativas do Bloco 6.
 *
 * Motivo e OTP são obrigatórios no cancelamento pelo super admin; o
 * anfitrião pode cancelar sem motivo (mas continua a precisar de OTP).
 */
export const adminOtpSchema = z
  .string({ error: 'O código é obrigatório.' })
  .trim()
  .regex(/^\d{6}$/, 'O código deve ter 6 dígitos.');

export const adminCancelSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(10, 'Indica o motivo do cancelamento (mínimo 10 caracteres).')
      .max(1000, 'O motivo não pode exceder 1000 caracteres.'),
    otp: adminOtpSchema,
  })
  .strict();

export const hostCancelSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .max(1000, 'O motivo não pode exceder 1000 caracteres.')
      .nullable()
      .optional(),
    otp: adminOtpSchema,
  })
  .strict();

const isoDate = z.coerce.date({ error: 'Indica uma data válida.' });

const adminListQuery = z.object({
  q: z.string().trim().max(150).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  order: z.enum(SORT_ORDERS).optional(),
  ...paginationQueryFields,
});

export const adminEventsQuerySchema = adminListQuery.extend({
  status: z.enum(EVENT_STATUSES).optional(),
  host: z.string().trim().max(200).optional(),
});

export const adminUsersQuerySchema = adminListQuery.extend({
  role: z.enum(['admin', 'host']).optional(),
  status: z.enum(HOST_STATUSES).optional(),
});

export const adminAuditQuerySchema = adminListQuery.extend({
  action: z.string().trim().max(100).optional(),
});

/** Filtros das mensagens de apoio e das subscrições de novidades (Bloco 7). */
const adminFormListQuery = z.object({
  q: z.string().trim().max(150).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  ...paginationQueryFields,
});

export const adminSupportQuerySchema = adminFormListQuery.extend({
  status: z.enum(['open', 'resolved', 'all']).optional(),
});

export const adminNewsletterQuerySchema = adminFormListQuery;

export const adminUserIdParamsSchema = z.object({
  userId: z.string().uuid('Identificador inválido.'),
});

export const adminSupportMessageIdParamsSchema = z.object({
  messageId: z.string().uuid('Identificador inválido.'),
});

export const adminNewsletterSubscriptionIdParamsSchema = z.object({
  subscriptionId: z.string().uuid('Identificador inválido.'),
});

/** Motivo opcional da suspensão de uma conta. */
export const adminSuspendSchema = z
  .object({
    reason: z.string().trim().min(3).max(1000).optional(),
  })
  .strict()
  .default({});

export type AdminCancelBody = z.infer<typeof adminCancelSchema>;
export type HostCancelBody = z.infer<typeof hostCancelSchema>;
export type AdminSuspendBody = z.infer<typeof adminSuspendSchema>;
export type AdminEventsQuery = z.infer<typeof adminEventsQuerySchema>;
export type AdminUsersQuery = z.infer<typeof adminUsersQuerySchema>;
export type AdminAuditQuery = z.infer<typeof adminAuditQuerySchema>;
export type AdminSupportQuery = z.infer<typeof adminSupportQuerySchema>;
export type AdminNewsletterQuery = z.infer<typeof adminNewsletterQuerySchema>;
