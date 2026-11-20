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
