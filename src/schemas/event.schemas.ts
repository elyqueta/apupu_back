import { z } from 'zod';
import { env } from '../config/env';
import {
  EVENT_CATEGORIES,
  EVENT_STATUSES,
  EVENT_VISIBILITIES,
  LOCATION_TYPES,
  THEME_MODES,
} from '../types/event.types';
import { isValidTimeZone } from '../utils/date.util';

/**
 * Contrato de entrada do evento.
 *
 * Os nomes seguem snake_case porque são o contrato partilhado com o
 * frontend. `.strict()` rejeita campos desconhecidos: o payload não
 * pode injectar token, estado RSVP, hash ou identificador de
 * navegador.
 */

const optionalText = (max: number): z.ZodOptional<z.ZodNullable<z.ZodString>> =>
  z.string().trim().max(max).nullable().optional();

/** Datas opcionais na criação: `null` e ausência são equivalentes. */
const optionalDate = z.preprocess(
  (value) => (value === null || value === '' || value === undefined ? null : value),
  z.coerce.date({ error: 'Data inválida.' }).nullable()
);

/**
 * Datas opcionais na actualização: a ausência do campo mantém o valor
 * actual. Só `null` (ou string vazia) limpa o campo.
 */
const updateDate = z
  .preprocess(
    (value) => (value === null || value === '' ? null : value),
    z.coerce.date({ error: 'Data inválida.' }).nullable()
  )
  .optional();

/** Idade opcional (0–120); `null` ou vazio significa "sem limite". */
const ageLimit = z.preprocess(
  (value) => (value === '' || value === undefined ? null : value),
  z.coerce
    .number({ error: 'Idade inválida.' })
    .int('A idade deve ser um número inteiro.')
    .min(0, 'A idade deve estar entre 0 e 120.')
    .max(120, 'A idade deve estar entre 0 e 120.')
    .nullable()
);

const visibilitySchema = z.enum(EVENT_VISIBILITIES);

const locationSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('venue'),
      name: z.string().trim().min(1, 'O nome do local é obrigatório.').max(200),
      address: optionalText(300),
    })
    .strict(),
  z
    .object({
      type: z.literal('online'),
      online_url: z.url('A ligação online deve ser uma URL válida.').max(2048),
    })
    .strict(),
]);

const themeSchema = z
  .object({
    mode: z.enum(THEME_MODES).default('light'),
    palette: z.string().trim().min(1).max(50).default('default'),
  })
  .strict();

const themeUpdateSchema = z
  .object({
    mode: z.enum(THEME_MODES).optional(),
    palette: z.string().trim().min(1).max(50).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Indique pelo menos um campo do tema para atualizar.',
  });

const contributionSchema = z
  .object({
    enabled: z.boolean().default(false),
    bank_name: optionalText(200),
    account_holder: optionalText(200),
    account_reference: optionalText(200),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.enabled) return;

    for (const field of ['bank_name', 'account_holder', 'account_reference'] as const) {
      if (!value[field]) {
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: 'Obrigatório quando a contribuição está ativa.',
        });
      }
    }
  });

/**
 * Contribuição em actualização: os campos ausentes são preenchidos a
 * partir do estado actual antes de se validar a obrigatoriedade.
 */
const contributionUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    bank_name: optionalText(200),
    account_holder: optionalText(200),
    account_reference: optionalText(200),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Indique pelo menos um campo da contribuição para atualizar.',
  });

const eventObjectSchema = z
  .object({
    title: z.string().trim().min(2, 'O título deve ter pelo menos 2 caracteres.').max(150),
    host_name: z.string().trim().min(2, 'O nome do anfitrião é obrigatório.').max(150),
    host_email: z
      .email('Email do anfitrião inválido.')
      .max(254)
      .transform((value) => value.toLowerCase()),
    category: z.enum(EVENT_CATEGORIES).nullable().optional(),
    starts_at: z.coerce.date({ error: 'Data de início inválida.' }),
    ends_at: optionalDate,
    timezone: z
      .string()
      .trim()
      .min(1)
      .default('Africa/Luanda')
      .refine(isValidTimeZone, 'Fuso horário inválido.'),
    location: locationSchema,
    message: optionalText(4000),
    rules: optionalText(4000),
    dress_code: optionalText(200),
    template_id: z.uuid('Template inválido.').nullable().optional(),
    cover_url: z.url('URL de capa inválida.').max(2048).nullable().optional(),
    theme: themeSchema.optional(),
    contribution: contributionSchema.optional(),
    rsvp_deadline: optionalDate,
    visibility: visibilitySchema.default('private'),
    show_attendee_count: z.boolean().default(false),
    min_age: ageLimit.optional(),
    max_age: ageLimit.optional(),
  })
  .strict();

/**
 * Actualização explícita: ao contrário de `eventObjectSchema.partial()`,
 * nenhum campo ausente recebe o valor por omissão (o que repunha, por
 * exemplo, o fuso ou o tema em cada PATCH).
 */
const eventUpdateObjectSchema = z
  .object({
    title: z.string().trim().min(2, 'O título deve ter pelo menos 2 caracteres.').max(150),
    host_name: z.string().trim().min(2, 'O nome do anfitrião é obrigatório.').max(150),
    host_email: z
      .email('Email do anfitrião inválido.')
      .max(254)
      .transform((value) => value.toLowerCase()),
    category: z.enum(EVENT_CATEGORIES).nullable(),
    starts_at: z.coerce.date({ error: 'Data de início inválida.' }),
    ends_at: updateDate,
    timezone: z.string().trim().min(1).refine(isValidTimeZone, 'Fuso horário inválido.'),
    location: locationSchema,
    message: optionalText(4000),
    rules: optionalText(4000),
    dress_code: optionalText(200),
    template_id: z.uuid('Template inválido.').nullable(),
    theme: themeUpdateSchema,
    contribution: contributionUpdateSchema,
    rsvp_deadline: updateDate,
    status: z.enum(EVENT_STATUSES),
    visibility: visibilitySchema,
    show_attendee_count: z.boolean(),
    min_age: ageLimit,
    max_age: ageLimit,
  })
  .strict()
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Indique pelo menos um campo para atualizar.',
  });

function validateEventDates(
  value: {
    starts_at?: Date;
    ends_at?: Date | null;
    rsvp_deadline?: Date | null;
    min_age?: number | null;
    max_age?: number | null;
  },
  ctx: z.RefinementCtx
): void {
  if (
    value.min_age !== undefined &&
    value.min_age !== null &&
    value.max_age !== undefined &&
    value.max_age !== null &&
    value.min_age > value.max_age
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['max_age'],
      message: 'A idade máxima deve ser maior ou igual à idade mínima.',
    });
  }

  if (value.ends_at && value.starts_at && value.ends_at <= value.starts_at) {
    ctx.addIssue({
      code: 'custom',
      path: ['ends_at'],
      message: 'A data de fim deve ser posterior à data de início.',
    });
  }

  if (value.rsvp_deadline && value.starts_at && value.rsvp_deadline > value.starts_at) {
    ctx.addIssue({
      code: 'custom',
      path: ['rsvp_deadline'],
      message: 'O prazo de resposta deve ser anterior ao início do evento.',
    });
  }
}

const guestSchema = z
  .object({
    name: z.string().trim().min(2, 'O nome do convidado é obrigatório.').max(150),
    email: z
      .email('Email do convidado inválido.')
      .max(254)
      .transform((value) => value.toLowerCase()),
    phone: optionalText(30),
    table_name: optionalText(100),
  })
  .strict();

export const createEventSchema = z
  .object({
    event: eventObjectSchema,
    guests: z.array(guestSchema).max(env.MAX_INVITATIONS_PER_EVENT).default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    validateEventDates(value.event, ctx);

    if (value.event.starts_at.getTime() <= Date.now()) {
      ctx.addIssue({
        code: 'custom',
        path: ['event', 'starts_at'],
        message: 'A data de início deve ser futura.',
      });
    }

    const seen = new Set<string>();
    const hostEmail = value.event.host_email.trim().toLowerCase();
    value.guests.forEach((guest, index) => {
      if (guest.email === hostEmail) {
        ctx.addIssue({
          code: 'custom',
          path: ['guests', index, 'email'],
          message: 'O email do anfitrião não pode ser usado como convidado.',
        });
      }

      if (seen.has(guest.email)) {
        ctx.addIssue({
          code: 'custom',
          path: ['guests', index, 'email'],
          message: 'Email duplicado na lista de convidados.',
        });
      }
      seen.add(guest.email);
    });
  });

export const updateEventSchema = eventUpdateObjectSchema.superRefine(validateEventDates);

export const createInvitationSchema = guestSchema;

export const updateInvitationSchema = z
  .object({
    name: z.string().trim().min(2).max(150),
    email: z
      .email('Email do convidado inválido.')
      .max(254)
      .transform((value) => value.toLowerCase()),
    phone: optionalText(30),
    table_name: optionalText(100),
  })
  .strict()
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Indique pelo menos um campo para atualizar.',
  });

/**
 * Remoção de evento. `confirm_name` só é exigido quando há convidados
 * confirmados; nesse caso tem de coincidir com o título (após trim).
 */
export const deleteEventSchema = z
  .object({
    confirm_name: z.string().max(200).optional(),
  })
  .strict()
  .default({});

export const hostSessionSchema = z
  .object({
    token: z.string().min(20, 'Token de gestão inválido.').max(200),
  })
  .strict();

export const eventIdParamsSchema = z.object({
  eventId: z.uuid('Identificador de evento inválido.'),
});

export const invitationIdParamsSchema = z.object({
  eventId: z.uuid('Identificador de evento inválido.'),
  invitationId: z.uuid('Identificador de convite inválido.'),
});

export const LOCATION_TYPE_VALUES = LOCATION_TYPES;
export const EVENT_STATUS_VALUES = EVENT_STATUSES;

export type CreateEventBody = z.infer<typeof createEventSchema>;
export type UpdateEventBody = z.infer<typeof updateEventSchema>;
export type CreateInvitationBody = z.infer<typeof createInvitationSchema>;
export type UpdateInvitationBody = z.infer<typeof updateInvitationSchema>;
export type DeleteEventBody = z.infer<typeof deleteEventSchema>;
