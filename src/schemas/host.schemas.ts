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

const paginatedQuerySchema = z.object({
  ...paginationQueryFields,
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
});

const createTaskSchema = z
  .object({
    label: z.string().trim().min(1, 'A tarefa precisa de uma descrição.').max(200),
    event_id: z.uuid('Identificador de evento inválido.').nullable().optional(),
  })
  .strict();

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

export {
  hostEventsQuerySchema,
  hostGuestsQuerySchema,
  paginatedQuerySchema,
  eventReportQuerySchema,
  tasksQuerySchema,
  createTaskSchema,
  updateTaskSchema,
  taskIdParamsSchema,
};

export type UpdateProfileBody = z.infer<typeof updateProfileSchema>;
export type AvatarBody = z.infer<typeof avatarSchema>;
export type HostEventsQuery = z.infer<typeof hostEventsQuerySchema>;
export type HostGuestsQuery = z.infer<typeof hostGuestsQuerySchema>;
export type EventReportQuery = z.infer<typeof eventReportQuerySchema>;
export type TasksQuery = z.infer<typeof tasksQuerySchema>;
export type CreateTaskBody = z.infer<typeof createTaskSchema>;
export type UpdateTaskBody = z.infer<typeof updateTaskSchema>;
