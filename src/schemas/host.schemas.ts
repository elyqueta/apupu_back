import { z } from 'zod';
import { env } from '../config/env';
import {
  EVENT_SORT_FIELDS,
  SORT_ORDERS,
  paginationQueryFields,
} from '../utils/pagination.util';
import { ageInYears, isValidCalendarDate, isValidTimeZone } from '../utils/date.util';
import { EVENT_STATUSES } from '../types/event.types';
import { HOST_LOCALES } from '../types/host.types';
import { RSVP_STATUSES, SEND_STATUSES } from '../types/invitation.types';

/**
 * Contrato do perfil e das listas do workspace do anfitrião.
 *
 * Todos os campos são opcionais no PATCH: a ausência mantém o valor
 * atual. Só `null` limpa um campo opcional.
 */

const optionalText = (max: number): z.ZodOptional<z.ZodNullable<z.ZodString>> =>
  z.string().trim().max(max).nullable().optional();

/**
 * Data de nascimento: data de calendário `YYYY-MM-DD`, no passado e
 * com a idade mínima configurada. É PII: nunca é registada em logs.
 */
const birthDateSchema = z
  .string()
  .trim()
  .refine(isValidCalendarDate, 'Indique uma data válida no formato AAAA-MM-DD.')
  .refine(
    (value) => ageInYears(value) >= env.MIN_HOST_AGE_YEARS,
    `É necessário ter pelo menos ${env.MIN_HOST_AGE_YEARS} anos.`
  )
  .nullable()
  .optional();

export const updateProfileSchema = z
  .object({
    display_name: optionalText(150),
    phone: optionalText(30),
    birth_date: birthDateSchema,
    locale: z.enum(HOST_LOCALES).optional(),
    timezone: z
      .string()
      .trim()
      .min(1)
      .refine(isValidTimeZone, 'Fuso horário inválido.')
      .optional(),
    avatar_url: z.url('URL de avatar inválida.').max(2048).nullable().optional(),
    cover_url: z.url('URL de capa inválida.').max(2048).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Indique pelo menos um campo para atualizar.',
  });

export const avatarSchema = z
  .object({
    avatar_url: z.url('URL de avatar inválida.').max(2048),
  })
  .strict();

export const coverSchema = z
  .object({
    cover_url: z.url('URL de capa inválida.').max(2048),
  })
  .strict();

const hostEventsQuerySchema = z.object({
  status: z.enum(EVENT_STATUSES).optional(),
  q: z.string().trim().max(150).optional(),
  sort: z.enum(EVENT_SORT_FIELDS).default('starts_at'),
  order: z.enum(SORT_ORDERS).default('desc'),
  ...paginationQueryFields,
});

const hostGuestsQuerySchema = z.object({
  event_id: z.uuid('Identificador de evento inválido.').optional(),
  rsvp_status: z.enum(RSVP_STATUSES).optional(),
  send_status: z.enum(SEND_STATUSES).optional(),
  q: z.string().trim().max(150).optional(),
  ...paginationQueryFields,
});

/**
 * "Meus convites": lista da conta autenticada como convidada.
 *
 * A ordenação por omissão é `starts_at asc` — próximos eventos
 * primeiro. Não há filtro por evento: a lista é sempre a do email da
 * sessão.
 */
const guestInvitationsQuerySchema = z.object({
  sort: z.enum(['starts_at']).default('starts_at'),
  order: z.enum(SORT_ORDERS).default('asc'),
  ...paginationQueryFields,
});

const paginatedQuerySchema = z.object({
  ...paginationQueryFields,
});

const reportExportQuerySchema = z.object({
  format: z.enum(['csv', 'pdf']).default('pdf'),
});

const eventReportQuerySchema = z.object({
  days: z.coerce
    .number({ error: 'O número de dias deve ser um número.' })
    .int()
    .min(1)
    .max(365)
    .default(30),
});

const tasksQuerySchema = z.object({
  event_id: z.uuid('Identificador de evento inválido.').optional(),
  status: z.enum(['all', 'pending', 'done']).default('all'),
  assignee: z.enum(['all', 'host', 'manager']).default('all'),
  manager_id: z.uuid('Identificador de gestor inválido.').optional(),
  q: z.string().trim().max(150).optional(),
  ...paginationQueryFields,
});

const createTaskSchema = z
  .object({
    label: z.string().trim().min(1, 'A tarefa precisa de uma descrição.').max(200),
    event_id: z.uuid('Identificador de evento inválido.').nullable().optional(),
    manager_id: z.uuid('Identificador de gestor inválido.').nullable().optional(),
  })
  .strict()
  .refine((value) => value.manager_id == null || value.event_id != null, {
    message: 'Uma tarefa atribuída a um gestor exige um evento.',
    path: ['event_id'],
  });

const updateTaskSchema = z
  .object({
    label: z.string().trim().min(1, 'A tarefa precisa de uma descrição.').max(200).optional(),
    done: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Indique pelo menos um campo para atualizar.',
  });

const taskIdParamsSchema = z.object({
  taskId: z.uuid('Identificador de tarefa inválido.'),
});

const notificationsQuerySchema = z.object({
  status: z.enum(['all', 'unread', 'read']).default('all'),
  kind: z
    .enum([
      'rsvp_accepted',
      'rsvp_declined',
      'guest_added',
      'reminder_sent',
      'event_created',
      'event_upcoming',
      'rsvp_deadline',
      'task_assigned',
      'task_completed',
    ])
    .optional(),
  event_id: z.uuid('Identificador de evento inválido.').optional(),
  q: z.string().trim().max(150).optional(),
  ...paginationQueryFields,
});

const notificationIdParamsSchema = z.object({
  notificationId: z.uuid('Identificador de notificação inválido.'),
});

const updateNotificationSchema = z
  .object({
    read: z.boolean(),
  })
  .strict();

const activityIdParamsSchema = z.object({
  eventId: z.uuid('Identificador de evento inválido.'),
  activityId: z.uuid('Identificador de actividade inválido.'),
});

const coverUrlSchema = z
  .object({
    cover_url: z.url('URL de imagem inválida.').max(2048),
  })
  .strict();

const addEventManagerSchema = z
  .object({
    email: z.email('Email inválido.').max(320),
  })
  .strict();

const eventManagerParamsSchema = z.object({
  eventId: z.uuid('Identificador de evento inválido.'),
  managerId: z.uuid('Identificador de gestor inválido.'),
});

export {
  hostEventsQuerySchema,
  hostGuestsQuerySchema,
  guestInvitationsQuerySchema,
  paginatedQuerySchema,
  eventReportQuerySchema,
  reportExportQuerySchema,
  tasksQuerySchema,
  createTaskSchema,
  updateTaskSchema,
  taskIdParamsSchema,
  notificationsQuerySchema,
  notificationIdParamsSchema,
  updateNotificationSchema,
  activityIdParamsSchema,
  coverUrlSchema,
  addEventManagerSchema,
  eventManagerParamsSchema,
};

export type UpdateProfileBody = z.infer<typeof updateProfileSchema>;
export type AvatarBody = z.infer<typeof avatarSchema>;
export type CoverBody = z.infer<typeof coverSchema>;
export type HostEventsQuery = z.infer<typeof hostEventsQuerySchema>;
export type HostGuestsQuery = z.infer<typeof hostGuestsQuerySchema>;
export type GuestInvitationsQuery = z.infer<typeof guestInvitationsQuerySchema>;
export type EventReportQuery = z.infer<typeof eventReportQuerySchema>;
export type ReportExportQuery = z.infer<typeof reportExportQuerySchema>;
export type TasksQuery = z.infer<typeof tasksQuerySchema>;
export type CreateTaskBody = z.infer<typeof createTaskSchema>;
export type UpdateTaskBody = z.infer<typeof updateTaskSchema>;
export type NotificationsQuery = z.infer<typeof notificationsQuerySchema>;
export type UpdateNotificationBody = z.infer<typeof updateNotificationSchema>;
export type CoverUrlBody = z.infer<typeof coverUrlSchema>;
export type AddEventManagerBody = z.infer<typeof addEventManagerSchema>;
