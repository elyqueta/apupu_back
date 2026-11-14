import { Router } from 'express';
import { eventController } from '../../controllers/event.controller';
import { asyncHandler } from '../../middlewares/asyncHandler';
import { validate } from '../../middlewares/validate';
import { createEventSchema } from '../../schemas/event.schemas';

const router = Router();

/**
 * @openapi
 * /api/v1/events:
 *   post:
 *     tags: [Eventos]
 *     summary: Cria um evento, convidados e entregas de email
 *     description: >
 *       Não requer conta. O segredo de gestão nunca é devolvido: é
 *       enviado uma única vez para o email do anfitrião. A resposta
 *       indica o estado de enfileiramento dos convites por destinatário.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/CreateEvent' }
 *     responses:
 *       201:
 *         description: Evento criado.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     event: { $ref: '#/components/schemas/Event' }
 *                     manage_email_status: { type: string, enum: [sent, failed] }
 *                     deliveries:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           email: { type: string, format: email }
 *                           status: { type: string, enum: [queued, sent, failed] }
 *       422:
 *         description: Dados inválidos.
 */
router.post('/', validate({ body: createEventSchema }), asyncHandler(eventController.create));

export default router;
