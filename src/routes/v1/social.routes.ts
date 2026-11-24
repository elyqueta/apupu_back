import { Router } from 'express';
import { socialController } from '../../controllers/social.controller';
import { asyncHandler } from '../../middlewares/asyncHandler';
import { hostAccountAuth } from '../../middlewares/hostAccountAuth';
import {
  publicFeedLimiter,
  publicSearchLimiter,
  writeLimiter,
} from '../../middlewares/rateLimiter';
import { requireAuthCsrf } from '../../middlewares/requireAuthCsrf';
import { validate } from '../../middlewares/validate';
import {
  communitySlugParamsSchema,
  eventsListQuerySchema,
  feedQuerySchema,
  friendDecisionSchema,
  friendRequestSchema,
  friendshipParamsSchema,
  profileParamsSchema,
  searchQuerySchema,
} from '../../schemas/social.schemas';

/**
 * Bloco 12 — rotas públicas (sem conta) do feed e pesquisa.
 *
 * Só entidades públicas; nunca dados de contacto. Rate limit por IP.
 *
 * @openapi
 * /api/v1/public/feed:
 *   get:
 *     tags: [Feed]
 *     summary: Feed público paginado por cursor (12 por página)
 *     responses:
 *       200: { description: Página do feed. }
 *       429:
 *         description: Demasiados pedidos.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 * /api/v1/public/search:
 *   get:
 *     tags: [Feed]
 *     summary: Pesquisa agrupada (eventos, comunidades, pessoas), 5 por grupo
 *     responses:
 *       200: { description: Resultados agrupados. }
 *       429:
 *         description: Demasiados pedidos.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
export const publicSocialRouter = Router();

publicSocialRouter.get('/feed', publicFeedLimiter, validate({ query: feedQuerySchema }), asyncHandler(socialController.feed));
publicSocialRouter.get('/search', publicSearchLimiter, validate({ query: searchQuerySchema }), asyncHandler(socialController.search));
publicSocialRouter.get(
  '/profiles/:id',
  publicFeedLimiter,
  validate({ params: profileParamsSchema }),
  asyncHandler(socialController.publicProfile)
);
publicSocialRouter.get(
  '/communities/:slug',
  publicFeedLimiter,
  validate({ params: communitySlugParamsSchema }),
  asyncHandler(socialController.publicCommunity)
);

/**
 * Bloco 12 — perfis (com conta) e amizades.
 *
 * @openapi
 * /api/v1/host/profiles/{id}:
 *   get:
 *     tags: [Perfis]
 *     summary: Perfil público com "em comum" (requer conta)
 *     responses:
 *       200: { description: Perfil. }
 *       404:
 *         description: Perfil privado ou inexistente.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 * /api/v1/host/friends:
 *   get:
 *     tags: [Amigos]
 *     summary: Amigos e pedidos recebidos/enviados
 *     responses:
 *       200: { description: Listas de amizade. }
 *       401:
 *         description: Sessão inválida.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
export const hostSocialRouter = Router();

hostSocialRouter.get(
  '/profiles/:id',
  asyncHandler(hostAccountAuth),
  validate({ params: profileParamsSchema }),
  asyncHandler(socialController.profile)
);
hostSocialRouter.get(
  '/profiles/:id/events',
  asyncHandler(hostAccountAuth),
  validate({ params: profileParamsSchema, query: eventsListQuerySchema }),
  asyncHandler(socialController.profileEvents)
);
hostSocialRouter.get(
  '/community-events/:slug',
  asyncHandler(hostAccountAuth),
  validate({ params: communitySlugParamsSchema, query: eventsListQuerySchema }),
  asyncHandler(socialController.communityEvents)
);
hostSocialRouter.get('/friends', asyncHandler(hostAccountAuth), asyncHandler(socialController.friends));
hostSocialRouter.post(
  '/friends/requests',
  asyncHandler(hostAccountAuth),
  writeLimiter,
  requireAuthCsrf,
  validate({ body: friendRequestSchema }),
  asyncHandler(socialController.requestFriend)
);
hostSocialRouter.post(
  '/friends/:id/decision',
  asyncHandler(hostAccountAuth),
  writeLimiter,
  requireAuthCsrf,
  validate({ params: friendshipParamsSchema, body: friendDecisionSchema }),
  asyncHandler(socialController.respondFriend)
);
hostSocialRouter.delete(
  '/friends/:id',
  asyncHandler(hostAccountAuth),
  writeLimiter,
  requireAuthCsrf,
  validate({ params: friendshipParamsSchema }),
  asyncHandler(socialController.removeFriend)
);
