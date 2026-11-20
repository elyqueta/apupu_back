import { Router } from 'express';
import { newsletterController } from '../../controllers/newsletter.controller';
import { supportController } from '../../controllers/support.controller';
import { asyncHandler } from '../../middlewares/asyncHandler';
import {
  newsletterFormLimiter,
  supportFormLimiter,
} from '../../middlewares/rateLimiter';
import { validate } from '../../middlewares/validate';
import { newsletterSubscribeSchema } from '../../schemas/newsletter.schemas';
import { supportCreateSchema } from '../../schemas/support.schemas';

/**
 * Formulários públicos (Bloco 7).
 *
 * Não há sessão nem capacidade, por isso não se aplica CSRF: o abuso é
 * travado pelo limite por IP. Montado em `/api/v1/public`.
 */
const router = Router();

/**
 * @openapi
 * /api/v1/public/support:
 *   post:
 *     tags: [Apoio]
 *     summary: Envia uma mensagem de apoio
 *     description: >
 *       Formulário público, sem autenticação e sem CSRF. Limite por IP.
 *       A resposta só devolve o identificador e a data de criação.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, message]
 *             properties:
 *               name: { type: string, minLength: 2, maxLength: 120 }
 *               email: { type: string, format: email, maxLength: 254 }
 *               message: { type: string, minLength: 10, maxLength: 2000 }
 *     responses:
 *       201:
 *         description: Mensagem registada.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     id: { type: string, format: uuid }
 *                     created_at: { type: string, format: date-time }
 *       422:
 *         description: Campos inválidos.
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
  '/support',
  supportFormLimiter,
  validate({ body: supportCreateSchema }),
  asyncHandler(supportController.create)
);

/**
 * @openapi
 * /api/v1/public/newsletter:
 *   post:
 *     tags: [Novidades]
 *     summary: Subscrever-se às novidades
 *     description: >
 *       Subscrição directa, sem confirmação por email. Idempotente por
 *       email normalizado (`lower(email)`): a resposta é sempre a mesma e
 *       não revela se o endereço já estava na lista. Limite por IP, sem
 *       autenticação e sem CSRF.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email, maxLength: 254 }
 *     responses:
 *       201:
 *         description: Email subscrito (ou já subscrito).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     subscribed: { type: boolean, example: true }
 *       422:
 *         description: Email inválido.
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
  '/newsletter',
  newsletterFormLimiter,
  validate({ body: newsletterSubscribeSchema }),
  asyncHandler(newsletterController.subscribe)
);

export default router;
