import { z } from 'zod';
import { env } from '../config/env';
import {
  EVENT_SORT_FIELDS,
  SORT_ORDERS,
  paginationQueryFields,
} from '../utils/pagination.util';
import { ageInYears, isValidCalendarDate, isValidTimeZone } from '../utils/date.util';
import { EVENT_STATUSES } from '../types/event.types';
import { HOST_LOCALES, NOTIFICATION_KINDS, PROFILE_VISIBILITIES } from '../types/host.types';
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_STATUS_FILTERS,
  TEAM_CATEGORIES,
} from '../types/team.types';
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
    profile_visibility: z.enum(PROFILE_VISIBILITIES).optional(),
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
  /**
   * Lista de candidatos para uma equipa concreta. Quando presente, a
   * origem são apenas os eventos em que a conta é anfitriã (mais o
   * evento da equipa), deduplicados por email.
   */
  for_team: z.uuid('Identificador de equipa inválido.').optional(),
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

const MAX_REPORT_PERIOD_DAYS = 366;

function calendarPeriodDays(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.floor((end - start) / 86_400_000) + 1;
}

/**
 * Relatório de um evento num período.
 *
 * As datas são dias de calendário `YYYY-MM-DD` interpretados em UTC,
 * tal como a série diária do evento. O limite de 366 dias evita PDFs
 * com centenas de páginas e consultas desnecessariamente longas.
 */
const eventPeriodReportQuerySchema = z
  .object({
    format: z.enum(['csv', 'pdf']).default('pdf'),
    from: z
      .string()
      .trim()
      .refine(isValidCalendarDate, 'Indique uma data inicial válida no formato AAAA-MM-DD.'),
    to: z
      .string()
      .trim()
      .refine(isValidCalendarDate, 'Indique uma data final válida no formato AAAA-MM-DD.'),
  })
  .refine((value) => value.from <= value.to, {
    message: 'A data final deve ser igual ou posterior à inicial.',
    path: ['to'],
  })
  .refine((value) => calendarPeriodDays(value.from, value.to) <= MAX_REPORT_PERIOD_DAYS, {
    message: `O período não pode exceder ${MAX_REPORT_PERIOD_DAYS} dias.`,
    path: ['to'],
  });

const eventExportParamsSchema = z.object({
  eventId: z.uuid('Identificador de evento inválido.'),
  document: z.enum(['guests', 'summary', 'attendance', 'ticket']),
});

const eventExportQuerySchema = z.object({
  format: z.enum(['csv', 'pdf']).default('pdf'),
  invitation_id: z.uuid('Identificador de convite inválido.').optional(),
});

const booleanQuery = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((value) => value === true || value === 'true' || value === '1')
  .optional();

const tasksQuerySchema = z.object({
  event_id: z.uuid('Identificador de evento inválido.').optional(),
  team_id: z.uuid('Identificador de equipa inválido.').optional(),
  status: z.enum(TASK_STATUS_FILTERS).default('all'),
  assignee: z.enum(['all', 'host', 'manager', 'member']).default('all'),
  manager_id: z.uuid('Identificador de gestor inválido.').optional(),
  assignee_member_id: z.uuid('Identificador de membro inválido.').optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  /** `true` mostra apenas as tarefas antigas sem equipa. */
  personal: booleanQuery,
  q: z.string().trim().max(150).optional(),
  ...paginationQueryFields,
});

const createTaskSchema = z
  .object({
    label: z.string().trim().min(1, 'A tarefa precisa de uma descrição.').max(200).optional(),
    title: z.string().trim().min(1, 'A tarefa precisa de uma descrição.').max(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    due_date: z
      .string()
      .trim()
      .refine(isValidCalendarDate, 'Indique uma data válida no formato AAAA-MM-DD.')
      .nullable()
      .optional(),
    priority: z.enum(TASK_PRIORITIES).default('normal'),
    status: z.enum(TASK_STATUSES).optional(),
    done: z.boolean().optional(),
    event_id: z.uuid('Identificador de evento inválido.').nullable().optional(),
    team_id: z.uuid('Identificador de equipa inválido.').nullable().optional(),
    assignee_member_id: z.uuid('Identificador de membro inválido.').nullable().optional(),
    manager_id: z.uuid('Identificador de gestor inválido.').nullable().optional(),
  })
  .strict()
  .refine((value) => value.label !== undefined || value.title !== undefined, {
    message: 'A tarefa precisa de uma descrição.',
    path: ['title'],
  })
  .refine(
    (value) =>
      value.label === undefined ||
      value.title === undefined ||
      value.label === value.title,
    {
      message: '`label` e `title` não podem ser diferentes.',
      path: ['title'],
    }
  )
  .refine((value) => value.manager_id == null || value.event_id != null, {
    message: 'Uma tarefa atribuída a um gestor exige um evento.',
    path: ['event_id'],
  })
  .refine(
    (value) =>
      value.status === undefined ||
      value.done === undefined ||
      value.done === (value.status === 'concluida'),
    {
      message: 'O estado e `done` não podem estar em contradição.',
      path: ['done'],
    }
  )
  .refine((value) => value.assignee_member_id == null || value.team_id != null, {
    message: 'Um responsável exige uma equipa.',
    path: ['team_id'],
  });

const updateTaskSchema = z
  .object({
    label: z.string().trim().min(1, 'A tarefa precisa de uma descrição.').max(200).optional(),
    title: z.string().trim().min(1, 'A tarefa precisa de uma descrição.').max(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    due_date: z
      .string()
      .trim()
      .refine(isValidCalendarDate, 'Indique uma data válida no formato AAAA-MM-DD.')
      .nullable()
      .optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    status: z.enum(TASK_STATUSES).optional(),
    done: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Indique pelo menos um campo para atualizar.',
  })
  .refine(
    (value) =>
      value.label === undefined ||
      value.title === undefined ||
      value.label === value.title,
    {
      message: '`label` e `title` não podem ser diferentes.',
      path: ['title'],
    }
  )
  .refine(
    (value) =>
      value.status === undefined ||
      value.done === undefined ||
      value.done === (value.status === 'concluida'),
    {
      message: 'O estado e `done` não podem estar em contradição.',
      path: ['done'],
    }
  );

const taskIdParamsSchema = z.object({
  taskId: z.uuid('Identificador de tarefa inválido.'),
});

const notificationsQuerySchema = z.object({
  status: z.enum(['all', 'unread', 'read']).default('all'),
  kind: z.enum(NOTIFICATION_KINDS).optional(),
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
    team_name: z.string().trim().min(2).max(80),
    team_category: z.enum(TEAM_CATEGORIES).optional(),
    team_description: z.string().trim().max(500).nullable().optional(),
    display_name: z.string().trim().min(1).max(120).nullable().optional(),
    email: z.email('Email inválido.').max(320).nullable().optional(),
    phone: z.string().trim().min(9).max(30).nullable().optional(),
    link_expires_at: z.coerce.date().nullable().optional(),
  })
  .strict()
  .refine((value) => Boolean(value.email || value.phone), {
    message: 'Indique um email ou telefone.',
  });

const updateManagerLinkSchema = z
  .object({
    link_expires_at: z.coerce.date(),
  })
  .strict();

const regenerateManagerAccessSchema = z
  .object({
    team_name: z.string().trim().min(2).max(80).nullable().optional(),
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
  eventExportParamsSchema,
  eventExportQuerySchema,
  eventPeriodReportQuerySchema,
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
  updateManagerLinkSchema,
  regenerateManagerAccessSchema,
};

export type UpdateProfileBody = z.infer<typeof updateProfileSchema>;
export type AvatarBody = z.infer<typeof avatarSchema>;
export type CoverBody = z.infer<typeof coverSchema>;
export type HostEventsQuery = z.infer<typeof hostEventsQuerySchema>;
export type HostGuestsQuery = z.infer<typeof hostGuestsQuerySchema>;
export type GuestInvitationsQuery = z.infer<typeof guestInvitationsQuerySchema>;
export type EventReportQuery = z.infer<typeof eventReportQuerySchema>;
export type ReportExportQuery = z.infer<typeof reportExportQuerySchema>;
export type EventExportParams = z.infer<typeof eventExportParamsSchema>;
export type EventExportQuery = z.infer<typeof eventExportQuerySchema>;
export type EventPeriodReportQuery = z.infer<typeof eventPeriodReportQuerySchema>;
export type TasksQuery = z.infer<typeof tasksQuerySchema>;
export type CreateTaskBody = z.infer<typeof createTaskSchema>;
export type UpdateTaskBody = z.infer<typeof updateTaskSchema>;
export type NotificationsQuery = z.infer<typeof notificationsQuerySchema>;
export type UpdateNotificationBody = z.infer<typeof updateNotificationSchema>;
export type CoverUrlBody = z.infer<typeof coverUrlSchema>;
export type AddEventManagerBody = z.infer<typeof addEventManagerSchema>;
export type UpdateManagerLinkBody = z.infer<typeof updateManagerLinkSchema>;
export type RegenerateManagerAccessBody = z.infer<
  typeof regenerateManagerAccessSchema
>;
