import { RequestHandler, Router } from 'express';
import { institutionController } from '../../controllers/institution.controller';
import { asyncHandler } from '../../middlewares/asyncHandler';
import { hostAccountAuth } from '../../middlewares/hostAccountAuth';
import { writeLimiter } from '../../middlewares/rateLimiter';
import { requireAuthCsrf } from '../../middlewares/requireAuthCsrf';
import { requireVerifiedEmail } from '../../middlewares/requireVerifiedEmail';
import { validate } from '../../middlewares/validate';
import {
  communityRefSchema,
  createInstitutionSchema,
  deleteInstitutionSchema,
  institutionListQuerySchema,
  institutionParamsSchema,
  institutionRequestParamsSchema,
  otpCodeSchema,
  updateInstitutionSchema,
} from '../../schemas/institution.schemas';

/**
 * Bloco 13 — instituições. Só o criador administra. Nenhuma ligação ou
 * remoção de comunidade acontece sem OTP por email do criador.
 *
 * @openapi
 * /api/v1/host/institutions:
 *   get:
 *     tags: [Instituições]
 *     summary: As minhas instituições (`scope=mine`) ou públicas (`scope=discover`)
 *     responses:
 *       200: { description: Lista. }
 *       401:
 *         description: Sessão inválida.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 * /api/v1/host/institutions/requests/{requestId}/confirm:
 *   post:
 *     tags: [Instituições]
 *     summary: O criador confirma a ligação/remoção com o OTP
 *     responses:
 *       200: { description: Pedido aprovado. }
 *       400:
 *         description: Código inválido ou expirado.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       403:
 *         description: Não é o criador.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
const router = Router();
const read: RequestHandler[] = [asyncHandler(hostAccountAuth)];
const write: RequestHandler[] = [asyncHandler(hostAccountAuth), writeLimiter, requireAuthCsrf, requireVerifiedEmail];
const reqParams = validate({ params: institutionRequestParamsSchema });

router.get('/', ...read, validate({ query: institutionListQuerySchema }), asyncHandler(institutionController.list));
router.get('/requests/mine', ...read, asyncHandler(institutionController.myRequests));
router.post('/', ...write, validate({ body: createInstitutionSchema }), asyncHandler(institutionController.create));
router.post('/requests/:requestId/accept', ...write, reqParams, asyncHandler(institutionController.acceptInvite));
router.post('/requests/:requestId/reject', ...write, reqParams, asyncHandler(institutionController.reject));
router.post('/requests/:requestId/approve', ...write, reqParams, asyncHandler(institutionController.startApproval));
router.post(
  '/requests/:requestId/confirm',
  ...write,
  validate({ params: institutionRequestParamsSchema, body: otpCodeSchema }),
  asyncHandler(institutionController.confirmApproval)
);
router.get('/:institutionId', ...read, validate({ params: institutionParamsSchema }), asyncHandler(institutionController.get));
router.patch(
  '/:institutionId',
  ...write,
  validate({ params: institutionParamsSchema, body: updateInstitutionSchema }),
  asyncHandler(institutionController.update)
);
router.delete(
  '/:institutionId',
  ...write,
  validate({ params: institutionParamsSchema, body: deleteInstitutionSchema }),
  asyncHandler(institutionController.remove)
);
const withCommunity = validate({ params: institutionParamsSchema, body: communityRefSchema });
router.post('/:institutionId/join-requests', ...write, withCommunity, asyncHandler(institutionController.requestFromCommunity));
router.post('/:institutionId/invitations', ...write, withCommunity, asyncHandler(institutionController.inviteCommunity));
router.post('/:institutionId/removals', ...write, withCommunity, asyncHandler(institutionController.startRemoval));
router.post('/:institutionId/leave', ...write, withCommunity, asyncHandler(institutionController.leave));

export default router;
