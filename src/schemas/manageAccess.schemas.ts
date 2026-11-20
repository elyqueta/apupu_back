import { z } from 'zod';
import { normalizeAccessCode } from '../utils/accessCode.util';

/**
 * Corpo da troca de link + código por sessão de gestão.
 *
 * O código é normalizado antes da validação para aceitar minúsculas,
 * espaços e hífens. É opcional apenas para gestores legados, que ainda
 * não têm código gerado. Falhas de formato são tratadas pela rota como
 * qualquer outra falha de acesso: 403 genérico, sem detalhes.
 */
export const manageAccessSchema = z
  .object({
    token: z.string().min(20).max(200),
    code: z
      .string()
      .min(6)
      .max(32)
      .transform(normalizeAccessCode)
      .refine((value) => /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/.test(value))
      .optional(),
  })
  .strict();

export type ManageAccessBody = z.infer<typeof manageAccessSchema>;
