import { z } from 'zod';

/** Formulário público de apoio: limites curtos, sem HTML e erros em pt-PT. */
export const supportCreateSchema = z
  .object({
    name: z
      .string({ error: 'O nome é obrigatório.' })
      .trim()
      .min(2, 'O nome deve ter pelo menos 2 caracteres.')
      .max(120, 'O nome não pode exceder 120 caracteres.'),
    email: z
      .string({ error: 'O email é obrigatório.' })
      .trim()
      .toLowerCase()
      .pipe(z.email('Indica um email válido.').max(254, 'O email não pode exceder 254 caracteres.')),
    message: z
      .string({ error: 'A mensagem é obrigatória.' })
      .trim()
      .min(10, 'A mensagem deve ter pelo menos 10 caracteres.')
      .max(2000, 'A mensagem não pode exceder 2000 caracteres.'),
  })
  .strict();

export type SupportCreateBody = z.infer<typeof supportCreateSchema>;
