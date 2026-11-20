import { Router } from 'express';
import { adminController } from '../../controllers/admin.controller';
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
  adminSuspendSchema,
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

export default router;
