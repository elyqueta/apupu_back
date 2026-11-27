import { z } from 'zod';

export const institutionParamsSchema = z.object({ institutionId: z.string().trim().min(1).max(80) });
export const institutionRequestParamsSchema = z.object({ requestId: z.uuid('Pedido inválido.') });

export const institutionListQuerySchema = z.object({
  scope: z.enum(['mine', 'discover']).default('mine'),
  q: z.string().trim().max(80).optional(),
});

export const createInstitutionSchema = z
  .object({
    name: z.string().trim().min(2, 'O nome deve ter pelo menos 2 caracteres.').max(120),
    description: z.string().trim().max(1000).nullable().optional(),
    visibility: z.enum(['public', 'private']).default('private'),
  })
  .strict();

export const updateInstitutionSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(1000).nullable(),
    visibility: z.enum(['public', 'private']),
    avatar_url: z.url().max(2048).nullable(),
    cover_url: z.url().max(2048).nullable(),
  })
  .strict()
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'Indique pelo menos um campo para atualizar.' });

export const institutionAvatarSchema = z.object({ avatar_url: z.url().max(2048) }).strict();
export const institutionCoverSchema = z.object({ cover_url: z.url().max(2048) }).strict();

export const deleteInstitutionSchema = z.object({ confirm_name: z.string().max(200) }).strict();
export const communityRefSchema = z.object({ community_id: z.uuid('Comunidade inválida.') }).strict();
export const otpCodeSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Código inválido.') }).strict();
