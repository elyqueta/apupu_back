import { z } from 'zod';
import { EVENT_CATEGORIES } from '../types/event.types';

const q = z.string().trim().max(80).optional();
const cursor = z.string().trim().max(40).regex(/^[A-Za-z0-9_-]*$/).optional();

export const feedQuerySchema = z.object({
  type: z.enum(['events', 'communities', 'people']).default('events'),
  q,
  category: z.enum(EVENT_CATEGORIES).optional(),
  cursor,
});

export const searchQuerySchema = z.object({ q: z.string().trim().min(1).max(80) });

export const profileParamsSchema = z.object({ id: z.uuid('Perfil inválido.') });

export const eventsListQuerySchema = z.object({
  past: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  cursor,
});

export const communitySlugParamsSchema = z.object({
  slug: z.string().trim().min(1).max(80).regex(/^[a-z0-9-]+$/),
});

export const friendRequestSchema = z.object({ host_id: z.uuid('Pessoa inválida.') }).strict();

export const friendshipParamsSchema = z.object({ id: z.uuid('Pedido inválido.') });

export const friendDecisionSchema = z.object({ accept: z.boolean() }).strict();
