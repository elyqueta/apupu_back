import { Router } from 'express';
import { manageAccessController } from '../../controllers/manageAccess.controller';
import { asyncHandler } from '../../middlewares/asyncHandler';
import {
  manageAccessLimiter,
  publicTokenLimiter,
} from '../../middlewares/rateLimiter';

/**
 * Rotas públicas de acesso à gestão sem conta.
 *
 * Montadas em `/api/v1/public/manage`, separadas dos convites para que
 * o segredo do link e o código nunca apareçam em parâmetros de URL.
 */
const router = Router();

/**
 * @openapi
 * /api/v1/public/manage/access:
 *   post:
 *     tags: [Gestão pública]
 *     summary: Troca link + código por sessão de gestão
 *     description: >
 *       Todas as falhas respondem 403 com o mesmo corpo e código.
 *       O código é opcional apenas para gestores legados sem código
 *       gerado. Nunca devolve o motivo da falha nem o código.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token: { type: string, minLength: 20, maxLength: 200 }
 *               code: { type: string, minLength: 6, maxLength: 32 }
 *     responses:
 *       200:
 *         description: Sessão de gestão criada.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/HostSessionEnvelope' }
 *       403:
 *         description: Acesso não autorizado (resposta genérica).
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
  '/access',
  publicTokenLimiter,
  manageAccessLimiter,
  asyncHandler(manageAccessController.access)
);

export default router;
