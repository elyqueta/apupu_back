import { Router } from 'express';
import { publicController } from '../../controllers/public.controller';
import { teamInviteController } from '../../controllers/teamInvite.controller';
import { asyncHandler } from '../../middlewares/asyncHandler';
import { guestAuth } from '../../middlewares/guestAuth';
import { hostAccountAuth } from '../../middlewares/hostAccountAuth';
import { publicTokenLimiter, rsvpLimiter } from '../../middlewares/rateLimiter';
import { requireAuthCsrf } from '../../middlewares/requireAuthCsrf';
import { requireGuestCsrf } from '../../middlewares/requireGuestCsrf';
import { validate } from '../../middlewares/validate';
import { inviteTokenParamsSchema, rsvpSchema } from '../../schemas/invitation.schemas';
import { teamInviteTokenParamsSchema } from '../../schemas/team.schemas';

const router = Router();

/**
 * @openapi
 * /api/v1/public/invitations/{token}/claim:
 *   post:
 *     tags: [Convites públicos]
 *     summary: Reclama o convite no primeiro navegador
 *     description: >
 *       O primeiro claim válido é atómico e emite um cookie HttpOnly de
 *       capacidade. Um token inválido ou um convite revogado recebem
 *       sempre o mesmo 404 genérico. Se o pedido trouxer uma sessão de
 *       conta cujo email verificado coincide com o do convite, o convite
 *       é devolvido mesmo que já tenha sido reclamado noutro navegador;
 *       nesse caso o `claim_hash` existente não é alterado.
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Apresentação pública do convite.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data: { $ref: '#/components/schemas/PublicInvitation' }
 *       404:
 *         description: Convite não encontrado.
 *       429:
 *         description: Demasiados pedidos.
 */
router.post(
  '/:token/claim',
  publicTokenLimiter,
  validate({ params: inviteTokenParamsSchema }),
  asyncHandler(publicController.claim)
);

/**
 * @openapi
 * /api/v1/public/invitations/{token}:
 *   get:
 *     tags: [Convites públicos]
 *     summary: Consulta o convite com a capacidade do navegador ou a conta
 *     description: >
 *       Aceita a capacidade HttpOnly emitida no claim ou uma sessão de
 *       conta cujo email verificado coincide com o email do convite.
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Apresentação pública do convite.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data: { $ref: '#/components/schemas/PublicInvitation' }
 *       404:
 *         description: Convite não encontrado ou reclamado por outro navegador.
 */
router.get(
  '/:token',
  publicTokenLimiter,
  validate({ params: inviteTokenParamsSchema }),
  asyncHandler(guestAuth),
  asyncHandler(publicController.get)
);

/**
 * @openapi
 * /api/v1/public/invitations/{token}/rsvp:
 *   put:
 *     tags: [Convites públicos]
 *     summary: Aceita, altera ou recusa o convite
 *     description: >
 *       Exige a capacidade do navegador ou uma sessão de conta cujo
 *       email verificado coincide com o do convite, mais o token CSRF
 *       derivado desse segredo. Recusar cancela os lembretes futuros e
 *       notifica o anfitrião; repetir o mesmo estado não duplica a
 *       notificação.
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema: { type: string }
 *       - in: header
 *         name: X-CSRF-Token
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [accepted, declined] }
 *     responses:
 *       200:
 *         description: Resposta registada.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data: { $ref: '#/components/schemas/PublicInvitation' }
 *       403:
 *         description: Token CSRF inválido.
 *       404:
 *         description: Convite não encontrado.
 *       409:
 *         description: Evento cancelado, terminado ou prazo de resposta excedido.
 */
router.put(
  '/:token/rsvp',
  publicTokenLimiter,
  rsvpLimiter,
  validate({ params: inviteTokenParamsSchema }),
  asyncHandler(guestAuth),
  requireGuestCsrf,
  validate({ body: rsvpSchema }),
  asyncHandler(publicController.rsvp)
);

/**
 * @openapi
 * /api/v1/public/team-invites/{token}:
 *   get:
 *     tags: [Convites públicos]
 *     summary: Valida um convite de equipa
 *     description: >
 *       Devolve apenas o nome da equipa e quem convida quando o token
 *       é válido. Não revela o email convidado, o evento nem a
 *       validade. Um convite inexistente devolve 404; expirado,
 *       revogado ou já aceite devolve 409 com um código estável. O
 *       token em claro nunca é devolvido.
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Convite válido.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/TeamInvitePreviewEnvelope' }
 *       404:
 *         description: Convite não encontrado.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       409:
 *         description: Convite expirado, revogado ou já aceite.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.get(
  '/team-invites/:token',
  publicTokenLimiter,
  validate({ params: teamInviteTokenParamsSchema }),
  asyncHandler(teamInviteController.preview)
);

/**
 * @openapi
 * /api/v1/public/team-invites/{token}/report:
 *   post:
 *     tags: [Convites públicos]
 *     summary: Denuncia um convite desconhecido
 *     description: >
 *       Usado pelo botão "Não conheço este convite". Revoga o convite,
 *       cancela os emails pendentes e bloqueia o remetente original
 *       para aquele email. Responde sempre `204`, mesmo para um token
 *       inválido, para não permitir enumerar convites.
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       204:
 *         description: Denúncia registada (ou token inexistente).
 *       429:
 *         description: Demasiados pedidos.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.post(
  '/team-invites/:token/report',
  publicTokenLimiter,
  validate({ params: teamInviteTokenParamsSchema }),
  asyncHandler(teamInviteController.reportUnknown)
);

/**
 * @openapi
 * /api/v1/public/team-invites/{token}/accept:
 *   post:
 *     tags: [Convites públicos]
 *     summary: Aceita um convite de equipa
 *     description: >
 *       Exige sessão de conta com email verificado e coincidente com o
 *       email convidado. A aceitação é atómica: repetir o pedido devolve
 *       `409 invite_not_active` e nunca activa o membro duas vezes.
 *       Cancela os emails pendentes do convite.
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema: { type: string }
 *       - in: header
 *         name: X-CSRF-Token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Convite aceite.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/TeamInviteAcceptEnvelope' }
 *       401:
 *         description: Sessão inválida.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       403:
 *         description: Email não verificado, diferente do convite ou CSRF inválido.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: Convite não encontrado.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       409:
 *         description: Convite expirado, revogado ou já aceite.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.post(
  '/team-invites/:token/accept',
  publicTokenLimiter,
  validate({ params: teamInviteTokenParamsSchema }),
  asyncHandler(hostAccountAuth),
  requireAuthCsrf,
  asyncHandler(teamInviteController.accept)
);

export default router;
