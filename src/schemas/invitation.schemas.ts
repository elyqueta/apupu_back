import { z } from 'zod';

export const inviteTokenParamsSchema = z.object({
  token: z.string().min(20, 'Token de convite inválido.').max(200),
});

/**
 * RSVP usa `status` no contrato público, não `response`.
 * Apenas `accepted` ou `declined`; `pending` é o estado inicial,
 * nunca um valor enviado pelo cliente.
 */
export const rsvpSchema = z
  .object({
    status: z.enum(['accepted', 'declined'], {
      error: 'O estado deve ser "accepted" ou "declined".',
    }),
  })
  .strict();

export type RsvpBody = z.infer<typeof rsvpSchema>;
