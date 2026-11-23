import { Router } from 'express';
import { publicEventController } from '../../controllers/publicEvent.controller';
import { asyncHandler } from '../../middlewares/asyncHandler';
import { noStore } from '../../middlewares/noStore';
import {
  publicEventRsvpEventLimiter,
  publicTokenLimiter,
  rsvpLimiter,
} from '../../middlewares/rateLimiter';
import { validate } from '../../middlewares/validate';
import {
  publicEventRsvpSchema,
  publicEventSlugParamsSchema,
} from '../../schemas/invitation.schemas';

const router = Router();

/**
 * @openapi
 * /api/v1/public/events/{slug}:
 *   get:
 *     tags: [Eventos públicos]
 *     summary: Dados públicos de um evento aberto
 *     description: >
 *       Mesmo DTO seguro do convite, sem lista de convidados e sem limites
 *       de idade (apenas `has_age_restriction`). `attendee_count` só existe
 *       quando o anfitrião o tornou público. Com sessão de conta, `viewer`
 *       traz os dados da própria conta para confirmar com um clique.
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Evento público.
 *       404:
 *         description: Evento inexistente, privado ou removido.
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
  '/:slug',
  publicTokenLimiter,
  noStore,
  validate({ params: publicEventSlugParamsSchema }),
  asyncHandler(publicEventController.get)
);

/**
 * @openapi
 * /api/v1/public/events/{slug}/rsvp:
 *   post:
 *     tags: [Eventos públicos]
 *     summary: Confirma presença pelo link aberto
 *     description: >
 *       Nome (2–120) e email ou telefone; idade obrigatória quando o evento
 *       tem restrição. O mesmo contacto actualiza a resposta existente.
 *       Qualquer recusa por idade devolve sempre 403 `public_rsvp_refused`
 *       com a mesma mensagem.
 *     parameters:
 *       - in: path
 *         name: slug
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
 *               name: { type: string }
 *               email: { type: string }
 *               phone: { type: string }
 *               age: { type: integer }
 *               status: { type: string, enum: [accepted, declined] }
 *               message: { type: string, nullable: true }
 *     responses:
 *       200:
 *         description: Resposta registada.
 *       403:
 *         description: Confirmação recusada.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: Evento inexistente, privado ou removido.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       409:
 *         description: Evento cancelado, terminado, prazo passado ou contacto com convite individual.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       422:
 *         description: Dados inválidos.
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
  '/:slug/rsvp',
  publicTokenLimiter,
  rsvpLimiter,
  publicEventRsvpEventLimiter,
  noStore,
  validate({ params: publicEventSlugParamsSchema, body: publicEventRsvpSchema }),
  asyncHandler(publicEventController.rsvp)
);

export default router;
