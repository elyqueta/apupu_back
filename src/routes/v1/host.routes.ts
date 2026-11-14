import { Router } from 'express';
import { eventController } from '../../controllers/event.controller';
import { hostSessionController } from '../../controllers/hostSession.controller';
import { invitationController } from '../../controllers/invitation.controller';
import { asyncHandler } from '../../middlewares/asyncHandler';
import { hostAuth } from '../../middlewares/hostAuth';
import { hostSessionLimiter } from '../../middlewares/rateLimiter';
import { requireHostCsrf } from '../../middlewares/requireHostCsrf';
import { validate } from '../../middlewares/validate';
import {
  createInvitationSchema,
  eventIdParamsSchema,
  hostSessionSchema,
  invitationIdParamsSchema,
  updateEventSchema,
  updateInvitationSchema,
} from '../../schemas/event.schemas';

const router = Router();

/**
 * @openapi
 * /api/v1/host/session:
 *   post:
 *     tags: [Gestão]
 *     summary: Troca o segredo do link de gestão por uma sessão HttpOnly
 *     description: >
 *       O segredo nunca é devolvido em JSON nem registado. A sessão é
 *       limitada ao evento e expira ao fim de `HOST_SESSION_TTL_MINUTES`.
 *       A resposta inclui o `csrf_token` que o cliente deve enviar em
 *       `X-CSRF-Token` nos pedidos mutáveis.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token: { type: string }
 *     responses:
 *       200:
 *         description: Sessão criada; cookies definidos.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     event: { $ref: '#/components/schemas/Event' }
 *                     csrf_token: { type: string }
 *                     expires_at: { type: string, format: date-time }
 *       404:
 *         description: Link de gestão inválido ou expirado.
 *       429:
 *         description: Demasiadas tentativas.
 */
router.post(
  '/session',
  hostSessionLimiter,
  validate({ body: hostSessionSchema }),
  asyncHandler(hostSessionController.create)
);

/**
 * @openapi
 * /api/v1/host/session/{eventId}:
 *   delete:
 *     tags: [Gestão]
 *     summary: Revoga a sessão de gestão e limpa os cookies
 *     security:
 *       - hostSession: []
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       204:
 *         description: Sessão revogada.
 *       401:
 *         description: Sessão ausente ou expirada.
 *       403:
 *         description: Token CSRF inválido.
 */
router.delete(
  '/session/:eventId',
  validate({ params: eventIdParamsSchema }),
  asyncHandler(hostAuth),
  requireHostCsrf,
  asyncHandler(hostSessionController.destroy)
);

/**
 * @openapi
 * /api/v1/host/events/{eventId}:
 *   get:
 *     tags: [Gestão]
 *     summary: Consulta o evento, estatísticas e lista privada de convidados
 *     security:
 *       - hostSession: []
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Evento e convidados.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     event: { $ref: '#/components/schemas/Event' }
 *                     invitations:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/Invitation' }
 *       401:
 *         description: Sessão ausente ou expirada.
 *   patch:
 *     tags: [Gestão]
 *     summary: Actualiza o evento e reconcilia lembretes
 *     security:
 *       - hostSession: []
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: header
 *         name: X-CSRF-Token
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/UpdateEvent' }
 *     responses:
 *       200:
 *         description: Evento actualizado.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data: { $ref: '#/components/schemas/Event' }
 *       403:
 *         description: Token CSRF inválido.
 *       422:
 *         description: Dados inválidos.
 */
router.get(
  '/events/:eventId',
  validate({ params: eventIdParamsSchema }),
  asyncHandler(hostAuth),
  asyncHandler(eventController.get)
);

router.patch(
  '/events/:eventId',
  validate({ params: eventIdParamsSchema }),
  asyncHandler(hostAuth),
  requireHostCsrf,
  validate({ body: updateEventSchema }),
  asyncHandler(eventController.update)
);

/**
 * @openapi
 * /api/v1/host/events/{eventId}/invitations:
 *   get:
 *     tags: [Convidados]
 *     summary: Lista os convidados do evento
 *     security:
 *       - hostSession: []
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Lista de convidados.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/Invitation' }
 *   post:
 *     tags: [Convidados]
 *     summary: Adiciona um convidado e enfileira o convite
 *     security:
 *       - hostSession: []
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: header
 *         name: X-CSRF-Token
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/InvitationInput' }
 *     responses:
 *       201:
 *         description: Convidado criado e convite enfileirado.
 *       409:
 *         description: Email duplicado, evento não agendado ou limite atingido.
 */
router.get(
  '/events/:eventId/invitations',
  validate({ params: eventIdParamsSchema }),
  asyncHandler(hostAuth),
  asyncHandler(invitationController.list)
);

router.post(
  '/events/:eventId/invitations',
  validate({ params: eventIdParamsSchema }),
  asyncHandler(hostAuth),
  requireHostCsrf,
  validate({ body: createInvitationSchema }),
  asyncHandler(invitationController.add)
);

/**
 * @openapi
 * /api/v1/host/events/{eventId}/invitations/{invitationId}:
 *   patch:
 *     tags: [Convidados]
 *     summary: Actualiza os dados de um convidado
 *     security:
 *       - hostSession: []
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: invitationId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: header
 *         name: X-CSRF-Token
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/InvitationInput' }
 *     responses:
 *       200:
 *         description: Convidado actualizado.
 *       404:
 *         description: Convidado não encontrado.
 *       409:
 *         description: Email duplicado.
 *   delete:
 *     tags: [Convidados]
 *     summary: Remove um convidado e as entregas associadas
 *     security:
 *       - hostSession: []
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: invitationId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: header
 *         name: X-CSRF-Token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       204:
 *         description: Convidado removido.
 */
router.patch(
  '/events/:eventId/invitations/:invitationId',
  validate({ params: invitationIdParamsSchema }),
  asyncHandler(hostAuth),
  requireHostCsrf,
  validate({ body: updateInvitationSchema }),
  asyncHandler(invitationController.update)
);

router.delete(
  '/events/:eventId/invitations/:invitationId',
  validate({ params: invitationIdParamsSchema }),
  asyncHandler(hostAuth),
  requireHostCsrf,
  asyncHandler(invitationController.remove)
);

/**
 * @openapi
 * /api/v1/host/events/{eventId}/invitations/{invitationId}/resend:
 *   post:
 *     tags: [Convidados]
 *     summary: Reenvia o convite individual
 *     security:
 *       - hostSession: []
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: invitationId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: header
 *         name: X-CSRF-Token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       202:
 *         description: Convite enfileirado.
 *       409:
 *         description: Convite revogado ou sem link reutilizável.
 *
 * /api/v1/host/events/{eventId}/invitations/{invitationId}/revoke:
 *   post:
 *     tags: [Convidados]
 *     summary: Revoga o acesso do navegador ao convite
 *     security:
 *       - hostSession: []
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: invitationId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: header
 *         name: X-CSRF-Token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Convite revogado.
 */
router.post(
  '/events/:eventId/invitations/:invitationId/resend',
  validate({ params: invitationIdParamsSchema }),
  asyncHandler(hostAuth),
  requireHostCsrf,
  asyncHandler(invitationController.resend)
);

router.post(
  '/events/:eventId/invitations/:invitationId/revoke',
  validate({ params: invitationIdParamsSchema }),
  asyncHandler(hostAuth),
  requireHostCsrf,
  asyncHandler(invitationController.revoke)
);

export default router;
