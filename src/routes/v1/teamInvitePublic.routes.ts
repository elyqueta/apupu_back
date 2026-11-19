import { Router } from 'express';
import { teamInviteController } from '../../controllers/teamInvite.controller';
import { asyncHandler } from '../../middlewares/asyncHandler';
import { hostAccountAuth } from '../../middlewares/hostAccountAuth';
import {
  publicTokenLimiter,
  teamInviteAcceptLimiter,
  teamInvitePreviewLimiter,
  teamInviteReportLimiter,
} from '../../middlewares/rateLimiter';
import { requireAuthCsrf } from '../../middlewares/requireAuthCsrf';
import { validate } from '../../middlewares/validate';
import { teamInviteTokenParamsSchema } from '../../schemas/team.schemas';

/**
 * Rotas públicas de convites de equipa.
 *
 * Montadas em `/api/v1/public/team-invites`, separadas das rotas de
 * convites de evento (`/api/v1/public/invitations`). A separação
 * garante que o contrato publicado (`/public/team-invites/{token}`) é
 * o caminho realmente servido.
 */
const router = Router();

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
 *       429:
 *         description: Demasiados pedidos.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.get(
  '/:token',
  publicTokenLimiter,
  teamInvitePreviewLimiter,
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
  '/:token/report',
  publicTokenLimiter,
  teamInviteReportLimiter,
  validate({ params: teamInviteTokenParamsSchema }),
  asyncHandler(teamInviteController.reportUnknown)
);

/**
 * @openapi
 * /api/v1/public/team-invites/{token}/report:
 *   get:
 *     tags: [Convites públicos]
 *     summary: Confirmação de denúncia (não revoga)
 *     description: >
 *       Os scanners de email seguem ligações automaticamente. Este
 *       `GET` existe apenas para responder `405` e garantir que abrir a
 *       página de confirmação nunca revoga o convite; a revogação só
 *       acontece no `POST` explícito do botão.
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       405:
 *         description: Use POST para confirmar a denúncia.
 *         headers:
 *           Allow:
 *             schema: { type: string, example: POST }
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       429:
 *         description: Demasiados pedidos.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.get(
  '/:token/report',
  publicTokenLimiter,
  teamInviteReportLimiter,
  validate({ params: teamInviteTokenParamsSchema }),
  teamInviteController.reportUnknownMethodNotAllowed
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
 *       429:
 *         description: Demasiados pedidos.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.post(
  '/:token/accept',
  publicTokenLimiter,
  teamInviteAcceptLimiter,
  validate({ params: teamInviteTokenParamsSchema }),
  asyncHandler(hostAccountAuth),
  requireAuthCsrf,
  asyncHandler(teamInviteController.accept)
);

export default router;
