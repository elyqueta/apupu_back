import { z } from 'zod';

/** Subscrição de novidades: apenas o email, sem confirmação por email. */
export const newsletterSubscribeSchema = z
  .object({
    email: z
      .string({ error: 'O email é obrigatório.' })
      .trim()
      .toLowerCase()
      .pipe(z.email('Indica um email válido.').max(254, 'O email não pode exceder 254 caracteres.')),
  })
  .strict();

export type NewsletterSubscribeBody = z.infer<typeof newsletterSubscribeSchema>;
