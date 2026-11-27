import { z } from 'zod';
import { COMMUNITY_VISIBILITIES } from '../types/community.types';

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const communityIdParamsSchema = z.object({
  communityId: z.string().trim().min(1).max(80),
});

export const communityMemberParamsSchema = communityIdParamsSchema.extend({
  memberId: z.uuid('Membro inválido.'),
});

export const communityRequestParamsSchema = communityIdParamsSchema.extend({
  requestId: z.uuid('Pedido inválido.'),
});

export const communityListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  scope: z.enum(['mine', 'discover']).default('mine'),
});

export const createCommunitySchema = z
  .object({
    name: z.string().trim().min(2, 'O nome deve ter pelo menos 2 caracteres.').max(120),
    description: optionalText(1000),
    visibility: z.enum(COMMUNITY_VISIBILITIES).default('private'),
  })
  .strict();

export const updateCommunitySchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    description: optionalText(1000),
    visibility: z.enum(COMMUNITY_VISIBILITIES),
    avatar_url: z.url().max(2048).nullable(),
    cover_url: z.url().max(2048).nullable(),
  })
  .strict()
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Indique pelo menos um campo para atualizar.',
  });

export const communityAvatarSchema = z
  .object({ avatar_url: z.url().max(2048) })
  .strict();

export const communityCoverSchema = z
  .object({ cover_url: z.url().max(2048) })
  .strict();

export const deleteCommunitySchema = z
  .object({ confirm_name: z.string().max(200) })
  .strict();

export const inviteCommunityMemberSchema = z
  .object({
    email: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.email('Email inválido.').max(254).optional()
    ),
    phone: z.string().trim().max(30).optional(),
    role: z.enum(['manager', 'member']).default('member'),
  })
  .strict();

export const changeCommunityRoleSchema = z
  .object({ role: z.enum(['manager', 'member']) })
  .strict();

export const joinRequestSchema = z
  .object({ message: z.string().trim().max(500).nullable().optional() })
  .strict()
  .default({});

export const decideJoinRequestSchema = z
  .object({ decision: z.enum(['approve', 'reject']) })
  .strict();

export const communityEventSuggestionParamsSchema = communityIdParamsSchema.extend({
  suggestionId: z.uuid('Sugestão inválida.'),
});

/**
 * O corpo completo do evento é validado no serviço com `createEventSchema`
 * depois de fixar `event.community_id`; aqui apenas se garante a forma
 * geral e o tamanho da mensagem.
 */
export const communityEventSuggestionBodySchema = z
  .object({
    event: z.looseObject({}),
    guests: z.array(z.unknown()).optional(),
    message: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

export const decideEventSuggestionSchema = z
  .object({ decision: z.enum(['approve', 'reject']) })
  .strict();

export const communityActivityBodySchema = z
  .object({ event_id: z.uuid('Evento inválido.') })
  .strict();

export const answerInviteSchema = z.object({ accept: z.boolean() }).strict();

export const startTransferSchema = z.object({ member_id: z.uuid('Membro inválido.') }).strict();

export const verifyTransferSchema = z
  .object({ code: z.string().trim().regex(/^\d{6}$/, 'Código inválido.') })
  .strict();

export type CreateCommunityBody = z.infer<typeof createCommunitySchema>;
export type UpdateCommunityBody = z.infer<typeof updateCommunitySchema>;
export type InviteCommunityMemberBody = z.infer<typeof inviteCommunityMemberSchema>;
