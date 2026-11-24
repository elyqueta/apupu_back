import { z } from 'zod';

export const inviteTokenParamsSchema = z.object({
  token: z.string().min(20, 'Token de convite inválido.').max(200),
});

export const MAX_GUEST_MESSAGE_LENGTH = 500;

/**
 * Remove marcações e caracteres de controlo e normaliza espaços. O texto
 * guardado é sempre texto simples: o frontend continua a escapar ao
 * apresentá-lo, mas a API não aceita HTML como mensagem.
 */
export function sanitizeGuestMessage(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;

  const cleaned = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\s\S]/g, (char) => {
      const code = char.codePointAt(0) ?? 0;
      return code < 32 || code === 127 ? ' ' : char;
    })
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned.length > 0 ? cleaned : null;
}

/**
 * RSVP usa `status` no contrato público, não `response`.
 * Apenas `accepted` ou `declined`; `pending` é o estado inicial,
 * nunca um valor enviado pelo cliente.
 *
 * `message` é opcional: ausente mantém a mensagem atual, `null` limpa-a.
 */
export const rsvpSchema = z
  .object({
    status: z.enum(['accepted', 'declined'], {
      error: 'O estado deve ser "accepted" ou "declined".',
    }),
    message: z
      .union([z.string(), z.null()])
      .optional()
      .transform((value) => (value === undefined ? undefined : sanitizeGuestMessage(value)))
      .refine((value) => value === undefined || value === null || value.length <= MAX_GUEST_MESSAGE_LENGTH, {
        message: `A mensagem deve ter no máximo ${MAX_GUEST_MESSAGE_LENGTH} caracteres.`,
      }),
  })
  .strict();

/** Nova validade do link individual do convite (máx. fim do evento + 30 dias). */
export const invitationLinkSchema = z
  .object({
    expires_at: z.coerce.date({ error: 'Indica uma data válida.' }),
  })
  .strict();

export type InvitationLinkBody = z.infer<typeof invitationLinkSchema>;
export type RsvpBody = z.infer<typeof rsvpSchema>;

/* ───────────────────── Link aberto do evento (Bloco 10) ───────────────────── */

export const publicEventSlugParamsSchema = z.object({
  slug: z
    .string()
    .min(10, 'Link inválido.')
    .max(64, 'Link inválido.')
    .regex(/^[A-Za-z0-9_-]+$/, 'Link inválido.'),
});

const optionalContact = (max: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().max(max).optional()
  );

/**
 * Confirmação pelo link aberto. Com conta autenticada (e CSRF válido) o
 * nome, o contacto e a idade vêm da conta e os campos do corpo são
 * ignorados. Sem conta: nome 2–120 e pelo menos um contacto.
 *
 * `website` é um campo honeypot invisível: tem de chegar vazio.
 */
export const publicEventRsvpSchema = z
  .object({
    name: optionalContact(120),
    email: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z
        .email('Email inválido.')
        .max(254)
        .transform((value) => value.toLowerCase())
        .optional()
    ),
    phone: optionalContact(30),
    age: z.preprocess(
      (value) => (value === '' || value === null ? undefined : value),
      z.coerce
        .number({ error: 'Idade inválida.' })
        .int('Idade inválida.')
        .min(0, 'Idade inválida.')
        .max(120, 'Idade inválida.')
        .optional()
    ),
    status: z.enum(['accepted', 'declined'], {
      error: 'O estado deve ser "accepted" ou "declined".',
    }),
    message: z
      .union([z.string(), z.null()])
      .optional()
      .transform((value) => sanitizeGuestMessage(value))
      .refine((value) => value === null || value.length <= MAX_GUEST_MESSAGE_LENGTH, {
        message: `A mensagem deve ter no máximo ${MAX_GUEST_MESSAGE_LENGTH} caracteres.`,
      }),
    website: z.string().max(200).optional(),
    /** Bloco 11: código de partilha do membro da comunidade (`?ref=`). */
    ref: z.string().trim().regex(/^[A-Za-z0-9_-]{6,32}$/).optional(),
  })
  .strict();

export type PublicEventRsvpBody = z.infer<typeof publicEventRsvpSchema>;
