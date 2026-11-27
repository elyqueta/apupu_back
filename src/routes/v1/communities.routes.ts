import { RequestHandler, Router } from 'express';
import { communityController } from '../../controllers/community.controller';
import { asyncHandler } from '../../middlewares/asyncHandler';
import { hostAccountAuth } from '../../middlewares/hostAccountAuth';
import { writeLimiter } from '../../middlewares/rateLimiter';
import { requireAuthCsrf } from '../../middlewares/requireAuthCsrf';
import { requireVerifiedEmail } from '../../middlewares/requireVerifiedEmail';
import {
  uploadCommunityAvatar,
  uploadCommunityCover,
} from '../../middlewares/uploadEntityImage';
import { validate } from '../../middlewares/validate';
import {
  answerInviteSchema,
  changeCommunityRoleSchema,
  communityActivityBodySchema,
  communityAvatarSchema,
  communityCoverSchema,
  communityIdParamsSchema,
  communityListQuerySchema,
  communityMemberParamsSchema,
  communityEventSuggestionBodySchema,
  communityEventSuggestionParamsSchema,
  communityRequestParamsSchema,
  createCommunitySchema,
  decideEventSuggestionSchema,
  decideJoinRequestSchema,
  deleteCommunitySchema,
  inviteCommunityMemberSchema,
  joinRequestSchema,
  startTransferSchema,
  updateCommunitySchema,
  verifyTransferSchema,
} from '../../schemas/community.schemas';

/**
 * Comunidades (Bloco 11). Todas as rotas exigem sessão de conta; as
 * escritas exigem CSRF e email verificado. Erros: 403
 * `community_forbidden`, 404 `community_not_found` (também para
 * comunidades privadas sem acesso), 409 em conflitos, 422 em validação.
 *
 * @openapi
 * /api/v1/host/communities:
 *   get:
 *     tags: [Comunidades]
 *     summary: As minhas comunidades (`scope=mine`) ou públicas (`scope=discover`)
 *     responses:
 *       200: { description: Lista de comunidades. }
 *       401:
 *         description: Sessão inválida.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *   post:
 *     tags: [Comunidades]
 *     summary: Cria uma comunidade; quem cria é o responsável
 *     responses:
 *       201: { description: Comunidade criada. }
 *       422:
 *         description: Dados inválidos.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
const router = Router();

const read: RequestHandler[] = [asyncHandler(hostAccountAuth)];
const write: RequestHandler[] = [
  asyncHandler(hostAccountAuth),
  writeLimiter,
  requireAuthCsrf,
  requireVerifiedEmail,
];

router.get('/', ...read, validate({ query: communityListQuerySchema }), asyncHandler(communityController.list));
router.post('/', ...write, validate({ body: createCommunitySchema }), asyncHandler(communityController.create));
router.get('/:communityId', ...read, validate({ params: communityIdParamsSchema }), asyncHandler(communityController.get));
router.patch(
  '/:communityId',
  ...write,
  validate({ params: communityIdParamsSchema, body: updateCommunitySchema }),
  asyncHandler(communityController.update)
);

router.post(
  '/:communityId/avatar',
  ...write,
  validate({ params: communityIdParamsSchema, body: communityAvatarSchema }),
  asyncHandler(communityController.setAvatarUrl)
);
router.post(
  '/:communityId/avatar/upload',
  ...write,
  validate({ params: communityIdParamsSchema }),
  uploadCommunityAvatar,
  asyncHandler(communityController.uploadAvatar)
);
router.delete(
  '/:communityId/avatar',
  ...write,
  validate({ params: communityIdParamsSchema }),
  asyncHandler(communityController.removeAvatar)
);
router.post(
  '/:communityId/cover',
  ...write,
  validate({ params: communityIdParamsSchema, body: communityCoverSchema }),
  asyncHandler(communityController.setCoverUrl)
);
router.post(
  '/:communityId/cover/upload',
  ...write,
  validate({ params: communityIdParamsSchema }),
  uploadCommunityCover,
  asyncHandler(communityController.uploadCover)
);
router.delete(
  '/:communityId/cover',
  ...write,
  validate({ params: communityIdParamsSchema }),
  asyncHandler(communityController.removeCover)
);

router.delete(
  '/:communityId',
  ...write,
  validate({ params: communityIdParamsSchema, body: deleteCommunitySchema }),
  asyncHandler(communityController.remove)
);

router.post(
  '/:communityId/members',
  ...write,
  validate({ params: communityIdParamsSchema, body: inviteCommunityMemberSchema }),
  asyncHandler(communityController.invite)
);
router.post(
  '/:communityId/invite/answer',
  ...write,
  validate({ params: communityIdParamsSchema, body: answerInviteSchema }),
  asyncHandler(communityController.answerInvite)
);
router.delete(
  '/:communityId/members/:memberId',
  ...write,
  validate({ params: communityMemberParamsSchema }),
  asyncHandler(communityController.removeMember)
);
router.patch(
  '/:communityId/members/:memberId',
  ...write,
  validate({ params: communityMemberParamsSchema, body: changeCommunityRoleSchema }),
  asyncHandler(communityController.changeRole)
);
router.post(
  '/:communityId/leave',
  ...write,
  validate({ params: communityIdParamsSchema }),
  asyncHandler(communityController.leave)
);

router.post(
  '/:communityId/join-requests',
  ...write,
  validate({ params: communityIdParamsSchema, body: joinRequestSchema }),
  asyncHandler(communityController.requestToJoin)
);
router.delete(
  '/:communityId/join-requests/mine',
  ...write,
  validate({ params: communityIdParamsSchema }),
  asyncHandler(communityController.cancelJoinRequest)
);
router.get(
  '/:communityId/join-requests',
  ...read,
  validate({ params: communityIdParamsSchema }),
  asyncHandler(communityController.listJoinRequests)
);
router.post(
  '/:communityId/join-requests/:requestId/decision',
  ...write,
  validate({ params: communityRequestParamsSchema, body: decideJoinRequestSchema }),
  asyncHandler(communityController.decideJoinRequest)
);

router.post(
  '/:communityId/event-suggestions',
  ...write,
  validate({
    params: communityIdParamsSchema,
    body: communityEventSuggestionBodySchema,
  }),
  asyncHandler(communityController.suggestEvent)
);
// `/mine` antes de qualquer rota com `:suggestionId`.
router.get(
  '/:communityId/event-suggestions/mine',
  ...read,
  validate({ params: communityIdParamsSchema }),
  asyncHandler(communityController.listMyEventSuggestions)
);
router.get(
  '/:communityId/event-suggestions',
  ...read,
  validate({ params: communityIdParamsSchema }),
  asyncHandler(communityController.listPendingEventSuggestions)
);
router.post(
  '/:communityId/event-suggestions/:suggestionId/decision',
  ...write,
  validate({ params: communityEventSuggestionParamsSchema, body: decideEventSuggestionSchema }),
  asyncHandler(communityController.decideEventSuggestion)
);
router.delete(
  '/:communityId/event-suggestions/:suggestionId',
  ...write,
  validate({ params: communityEventSuggestionParamsSchema }),
  asyncHandler(communityController.cancelEventSuggestion)
);

// Feed de actividade: acção "Partilhar" do feed de eventos.
router.post(
  '/:communityId/activity',
  ...write,
  validate({ params: communityIdParamsSchema, body: communityActivityBodySchema }),
  asyncHandler(communityController.shareActivity)
);
router.get(
  '/:communityId/activity',
  ...read,
  validate({ params: communityIdParamsSchema }),
  asyncHandler(communityController.listActivity)
);

router.post(
  '/:communityId/transfer/start',
  ...write,
  validate({ params: communityIdParamsSchema, body: startTransferSchema }),
  asyncHandler(communityController.startTransfer)
);
router.post(
  '/:communityId/transfer/verify-otp',
  ...write,
  validate({ params: communityIdParamsSchema, body: verifyTransferSchema }),
  asyncHandler(communityController.verifyTransfer)
);
router.post(
  '/:communityId/transfer/accept',
  ...write,
  validate({ params: communityIdParamsSchema }),
  asyncHandler(communityController.acceptTransfer)
);
router.post(
  '/:communityId/transfer/cancel',
  ...write,
  validate({ params: communityIdParamsSchema }),
  asyncHandler(communityController.cancelTransfer)
);

router.get(
  '/:communityId/referrals',
  ...read,
  validate({ params: communityIdParamsSchema }),
  asyncHandler(communityController.referrals)
);

export default router;
