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
  adminWeeklyReportIdParamsSchema,
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

/**
 * @openapi
 * /api/v1/admin/users:
 *   get:
 *     tags: [Admin — Utilizadores]
 *     summary: Lista contas com avatar e capa (super admin)
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string, maxLength: 150 }
 *       - in: query
 *         name: role
 *         schema: { type: string, enum: [admin, host] }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [active, suspended, deleted] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: page_size
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *     responses:
 *       200:
 *         description: Lista paginada; `data[].avatar_url` e `data[].cover_url` podem ser nulos.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data: { type: array, items: { $ref: '#/components/schemas/AdminUser' } }
 *                 pagination: { $ref: '#/components/schemas/PaginationMeta' }
 *       403: { description: Área reservada ao super admin, schema: { $ref: '#/components/schemas/Error' } }
 *       429: { description: Demasiados pedidos, schema: { $ref: '#/components/schemas/Error' } }
 */
router.get(
  '/users',
  adminActionLimiter,
  validate({ query: adminUsersQuerySchema }),
  asyncHandler(adminController.listUsers)
);

/**
 * @openapi
 * /api/v1/admin/users/{userId}:
 *   get:
 *     tags: [Admin — Utilizadores]
 *     summary: Detalhe de uma conta com perfil, eventos e equipas (super admin)
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Perfil completo, até 50 eventos e 50 equipas associadas.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data: { $ref: '#/components/schemas/AdminUserDetail' }
 *       404: { description: Utilizador não encontrado, schema: { $ref: '#/components/schemas/Error' } }
 */
router.get(
  '/users/:userId',
  adminActionLimiter,
  validate({ params: adminUserIdParamsSchema }),
  asyncHandler(adminController.getUser)
);

/**
 * @openapi
 * /api/v1/admin/users/{userId}/report:
 *   get:
 *     tags: [Admin — Relatórios]
 *     summary: PDF individual de um perfil (super admin)
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: PDF com cabeçalho `Content-Disposition: attachment`.
 *         content:
 *           application/pdf:
 *             schema: { type: string, format: binary }
 *       404: { description: Utilizador não encontrado, schema: { $ref: '#/components/schemas/Error' } }
 */
router.get(
  '/users/:userId/report',
  adminActionLimiter,
  validate({ params: adminUserIdParamsSchema }),
  asyncHandler(adminController.userReport)
);

/**
 * @openapi
 * /api/v1/admin/reports/all:
 *   get:
 *     tags: [Admin — Relatórios]
 *     summary: PDF global de todos os perfis sob procura (super admin)
 *     security:
 *       - accountSession: []
 *     responses:
 *       200:
 *         description: PDF com todos os perfis e contadores agregados.
 *         content:
 *           application/pdf:
 *             schema: { type: string, format: binary }
 */
router.get(
  '/reports/all',
  adminActionLimiter,
  asyncHandler(adminController.allUsersReport)
);

/**
 * @openapi
 * /api/v1/admin/reports/weekly:
 *   get:
 *     tags: [Admin — Relatórios]
 *     summary: Lista dos relatórios semanais disponíveis para download
 *     security:
 *       - accountSession: []
 *     responses:
 *       200:
 *         description: Até 12 semanas, mais recente primeiro.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data: { type: array, items: { $ref: '#/components/schemas/AdminWeeklyReport' } }
 */
router.get(
  '/reports/weekly',
  adminActionLimiter,
  asyncHandler(adminController.listWeeklyReports)
);

/**
 * @openapi
 * /api/v1/admin/reports/weekly/{reportId}/download:
 *   get:
 *     tags: [Admin — Relatórios]
 *     summary: Descarrega um relatório semanal em PDF
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: path
 *         name: reportId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: PDF guardado na base de dados.
 *         content:
 *           application/pdf:
 *             schema: { type: string, format: binary }
 *       404: { description: Relatório não encontrado, schema: { $ref: '#/components/schemas/Error' } }
 */
router.get(
  '/reports/weekly/:reportId/download',
  adminActionLimiter,
  validate({ params: adminWeeklyReportIdParamsSchema }),
  asyncHandler(adminController.downloadWeeklyReport)
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
