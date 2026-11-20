import { Router } from 'express';
import { adminController } from '../../controllers/admin.controller';
import { newsletterController } from '../../controllers/newsletter.controller';
import { supportController } from '../../controllers/support.controller';
import { asyncHandler } from '../../middlewares/asyncHandler';
import { hostAccountAuth } from '../../middlewares/hostAccountAuth';
import {
  adminActionLimiter,
  adminOtpLimiter,
  writeLimiter,
} from '../../middlewares/rateLimiter';
import { requireAuthCsrf } from '../../middlewares/requireAuthCsrf';
import { requireSuperAdmin } from '../../middlewares/requireSuperAdmin';
import { validate } from '../../middlewares/validate';
import {
  adminAuditQuerySchema,
  adminCancelSchema,
  adminEventsQuerySchema,
  adminNewsletterQuerySchema,
  adminNewsletterSubscriptionIdParamsSchema,
  adminSuspendSchema,
  adminSupportMessageIdParamsSchema,
  adminSupportQuerySchema,
  adminUserIdParamsSchema,
  adminUsersQuerySchema,
} from '../../schemas/admin.schemas';
import { eventIdParamsSchema } from '../../schemas/event.schemas';

/**
 * Rotas do super admin (Bloco 6).
 *
 * Todas exigem sessão de conta, papel `super_admin` e CSRF nas escritas.
 * A promoção a super admin é feita apenas por SQL — não existe rota
 * para atribuir ou remover o papel.
 */
const router = Router();

router.use(asyncHandler(hostAccountAuth), requireSuperAdmin);

router.get(
  '/overview',
  adminActionLimiter,
  asyncHandler(adminController.overview)
);

router.get(
  '/events',
  adminActionLimiter,
  validate({ query: adminEventsQuerySchema }),
  asyncHandler(adminController.listEvents)
);

router.get(
  '/events/:eventId',
  adminActionLimiter,
  validate({ params: eventIdParamsSchema }),
  asyncHandler(adminController.getEvent)
);

router.post(
  '/events/:eventId/cancel/otp',
  adminOtpLimiter,
  validate({ params: eventIdParamsSchema }),
  requireAuthCsrf,
  asyncHandler(adminController.requestCancelOtp)
);

router.post(
  '/events/:eventId/cancel',
  adminOtpLimiter,
  validate({ params: eventIdParamsSchema }),
  adminActionLimiter,
  requireAuthCsrf,
  validate({ body: adminCancelSchema }),
  asyncHandler(adminController.cancelEvent)
);

router.get(
  '/users',
  adminActionLimiter,
  validate({ query: adminUsersQuerySchema }),
  asyncHandler(adminController.listUsers)
);

router.get(
  '/users/:userId',
  adminActionLimiter,
  validate({ params: adminUserIdParamsSchema }),
  asyncHandler(adminController.getUser)
);

router.post(
  '/users/:userId/suspend',
  adminActionLimiter,
  writeLimiter,
  validate({ params: adminUserIdParamsSchema }),
  requireAuthCsrf,
  validate({ body: adminSuspendSchema }),
  asyncHandler(adminController.suspendUser)
);

router.post(
  '/users/:userId/reactivate',
  adminActionLimiter,
  writeLimiter,
  validate({ params: adminUserIdParamsSchema }),
  requireAuthCsrf,
  asyncHandler(adminController.reactivateUser)
);

router.post(
  '/users/:userId/revoke-sessions',
  adminActionLimiter,
  writeLimiter,
  validate({ params: adminUserIdParamsSchema }),
  requireAuthCsrf,
  asyncHandler(adminController.revokeSessions)
);

router.get(
  '/audit',
  adminActionLimiter,
  validate({ query: adminAuditQuerySchema }),
  asyncHandler(adminController.listAudit)
);

/**
 * @openapi
 * /api/v1/admin/support:
 *   get:
 *     tags: [Admin — Apoio]
 *     summary: Lista mensagens de apoio (super admin)
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string, maxLength: 150 }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [open, resolved, all] }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: page_size
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *     responses:
 *       200:
 *         description: Lista paginada de mensagens.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/SupportMessage' }
 *                 pagination: { $ref: '#/components/schemas/PaginationMeta' }
 *       401:
 *         description: Sessão ausente ou expirada.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       403:
 *         description: Área reservada ao super admin.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       422:
 *         description: Filtro ou paginação inválidos.
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
  '/support',
  adminActionLimiter,
  validate({ query: adminSupportQuerySchema }),
  asyncHandler(supportController.list)
);

/**
 * @openapi
 * /api/v1/admin/support/{messageId}:
 *   get:
 *     tags: [Admin — Apoio]
 *     summary: Detalhe de uma mensagem de apoio (super admin)
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: path
 *         name: messageId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Mensagem encontrada.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data: { $ref: '#/components/schemas/SupportMessage' }
 *       401:
 *         description: Sessão ausente ou expirada.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       403:
 *         description: Área reservada ao super admin.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: Mensagem não encontrada.
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
  '/support/:messageId',
  adminActionLimiter,
  validate({ params: adminSupportMessageIdParamsSchema }),
  asyncHandler(supportController.get)
);

/**
 * @openapi
 * /api/v1/admin/support/{messageId}/resolve:
 *   post:
 *     tags: [Admin — Apoio]
 *     summary: Marca uma mensagem de apoio como resolvida (super admin)
 *     description: >
 *       Idempotente: repetir a chamada devolve a mesma mensagem, sem
 *       alterar `resolved_at` nem `resolved_by`. Exige X-CSRF-Token.
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: path
 *         name: messageId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: header
 *         name: X-CSRF-Token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Mensagem resolvida.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data: { $ref: '#/components/schemas/SupportMessage' }
 *       401:
 *         description: Sessão ausente ou expirada.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       403:
 *         description: CSRF inválido ou área reservada ao super admin.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: Mensagem não encontrada.
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
  '/support/:messageId/resolve',
  adminActionLimiter,
  validate({ params: adminSupportMessageIdParamsSchema }),
  requireAuthCsrf,
  asyncHandler(supportController.resolve)
);

/**
 * @openapi
 * /api/v1/admin/newsletter:
 *   get:
 *     tags: [Admin — Novidades]
 *     summary: Lista subscrições de novidades (super admin)
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string, maxLength: 150 }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: page_size
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *     responses:
 *       200:
 *         description: Lista paginada de subscrições.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/NewsletterSubscription' }
 *                 pagination: { $ref: '#/components/schemas/PaginationMeta' }
 *       401:
 *         description: Sessão ausente ou expirada.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       403:
 *         description: Área reservada ao super admin.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       422:
 *         description: Filtro ou paginação inválidos.
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
  '/newsletter',
  adminActionLimiter,
  validate({ query: adminNewsletterQuerySchema }),
  asyncHandler(newsletterController.list)
);

/**
 * @openapi
 * /api/v1/admin/newsletter/export:
 *   get:
 *     tags: [Admin — Novidades]
 *     summary: Exporta subscrições de novidades em CSV (super admin)
 *     description: >
 *       Usa os mesmos filtros da lista (`q`, `from`, `to`), sem
 *       paginação. Cabeçalho `email,created_at`; valores que começam por
 *       `=`, `+`, `-` ou `@` são prefixados com `'`.
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string, maxLength: 150 }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: Ficheiro newsletter.csv.
 *         content:
 *           text/csv:
 *             schema: { type: string }
 *       401:
 *         description: Sessão ausente ou expirada.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       403:
 *         description: Área reservada ao super admin.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       422:
 *         description: Filtro inválido.
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
  '/newsletter/export',
  adminActionLimiter,
  validate({ query: adminNewsletterQuerySchema }),
  asyncHandler(newsletterController.export)
);

/**
 * @openapi
 * /api/v1/admin/newsletter/{subscriptionId}:
 *   delete:
 *     tags: [Admin — Novidades]
 *     summary: Remove uma subscrição de novidades (super admin)
 *     description: Exige X-CSRF-Token. A remoção é auditada.
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: path
 *         name: subscriptionId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: header
 *         name: X-CSRF-Token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Subscrição removida.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     removed: { type: boolean, example: true }
 *       401:
 *         description: Sessão ausente ou expirada.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       403:
 *         description: CSRF inválido ou área reservada ao super admin.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: Subscrição não encontrada.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       429:
 *         description: Demasiados pedidos.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.delete(
  '/newsletter/:subscriptionId',
  adminActionLimiter,
  validate({ params: adminNewsletterSubscriptionIdParamsSchema }),
  requireAuthCsrf,
  asyncHandler(newsletterController.remove)
);

export default router;
