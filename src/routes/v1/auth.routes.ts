import { Router } from 'express';
import { authController } from '../../controllers/auth.controller';
import { asyncHandler } from '../../middlewares/asyncHandler';
import { hostAccountAuth } from '../../middlewares/hostAccountAuth';
import {
  authEmailLimiter,
  authIpLimiter,
  publicTokenLimiter,
} from '../../middlewares/rateLimiter';
import { requireAuthCsrf } from '../../middlewares/requireAuthCsrf';
import { validate } from '../../middlewares/validate';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from '../../schemas/auth.schemas';

const router = Router();

/**
 * @openapi
 * /api/v1/auth/register:
 *   post:
 *     tags: [Conta]
 *     summary: Cria uma conta de anfitrião
 *     description: >
 *       Cria a conta e enfileira o email de verificação. Não inicia
 *       sessão: o frontend deve mostrar "verifique o seu email".
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string, minLength: 8, maxLength: 128 }
 *               display_name: { type: string, nullable: true }
 *     responses:
 *       201:
 *         description: Conta criada.
 *       409:
 *         description: Email já registado.
 *       422:
 *         description: Dados inválidos.
 *       429:
 *         description: Demasiados pedidos.
 */
router.post(
  '/register',
  authIpLimiter,
  authEmailLimiter,
  validate({ body: registerSchema }),
  asyncHandler(authController.register)
);

/**
 * @openapi
 * /api/v1/auth/email/verify:
 *   post:
 *     tags: [Conta]
 *     summary: Consome o token de verificação de email
 *     description: >
 *       Só depois da verificação os eventos legados com o mesmo
 *       `host_email` são ligados à conta, de forma idempotente.
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
 *         description: Email verificado.
 *       422:
 *         description: Token inválido ou expirado.
 */
router.post(
  '/email/verify',
  publicTokenLimiter,
  validate({ body: verifyEmailSchema }),
  asyncHandler(authController.verifyEmail)
);

/**
 * @openapi
 * /api/v1/auth/email/verify/resend:
 *   post:
 *     tags: [Conta]
 *     summary: Reenvia o email de verificação
 *     description: Responde sempre 202, exista ou não a conta.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email }
 *     responses:
 *       202:
 *         description: Pedido aceite.
 *       429:
 *         description: Demasiados pedidos.
 */
router.post(
  '/email/verify/resend',
  authIpLimiter,
  authEmailLimiter,
  validate({ body: resendVerificationSchema }),
  asyncHandler(authController.resendVerification)
);

/**
 * @openapi
 * /api/v1/auth/login:
 *   post:
 *     tags: [Conta]
 *     summary: Inicia sessão de conta
 *     description: >
 *       Define os cookies `apupu_auth` (HttpOnly) e `apupu_csrf_auth`
 *       e devolve o `csrf_token` para o cabeçalho `X-CSRF-Token`.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: Sessão criada.
 *       401:
 *         description: Credenciais inválidas.
 *       423:
 *         description: Conta temporariamente bloqueada.
 *       429:
 *         description: Demasiados pedidos.
 */
router.post(
  '/login',
  authIpLimiter,
  authEmailLimiter,
  validate({ body: loginSchema }),
  asyncHandler(authController.login)
);

/**
 * @openapi
 * /api/v1/auth/logout:
 *   post:
 *     tags: [Conta]
 *     summary: Revoga a sessão atual e limpa os cookies
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: header
 *         name: X-CSRF-Token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       204:
 *         description: Sessão revogada.
 *       401:
 *         description: Sessão ausente ou expirada.
 *       403:
 *         description: Token CSRF inválido.
 */
router.post(
  '/logout',
  asyncHandler(hostAccountAuth),
  requireAuthCsrf,
  asyncHandler(authController.logout)
);

/**
 * @openapi
 * /api/v1/auth/session:
 *   get:
 *     tags: [Conta]
 *     summary: Devolve a conta autenticada, perfil e estado de completude
 *     security:
 *       - accountSession: []
 *     responses:
 *       200:
 *         description: Conta e perfil.
 *       401:
 *         description: Sessão ausente ou expirada.
 */
router.get('/session', asyncHandler(hostAccountAuth), asyncHandler(authController.session));

/**
 * @openapi
 * /api/v1/auth/password/forgot:
 *   post:
 *     tags: [Conta]
 *     summary: Enfileira o email de reposição de senha
 *     description: Responde sempre 202, exista ou não a conta.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email }
 *     responses:
 *       202:
 *         description: Pedido aceite.
 *       429:
 *         description: Demasiados pedidos.
 */
router.post(
  '/password/forgot',
  authIpLimiter,
  authEmailLimiter,
  validate({ body: forgotPasswordSchema }),
  asyncHandler(authController.forgotPassword)
);

/**
 * @openapi
 * /api/v1/auth/password/reset:
 *   post:
 *     tags: [Conta]
 *     summary: Consome o token e define a nova senha
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, password]
 *             properties:
 *               token: { type: string }
 *               password: { type: string, minLength: 8, maxLength: 128 }
 *     responses:
 *       204:
 *         description: Senha alterada; todas as sessões revogadas.
 *       422:
 *         description: Token inválido ou senha fora da política.
 */
router.post(
  '/password/reset',
  publicTokenLimiter,
  authIpLimiter,
  validate({ body: resetPasswordSchema }),
  asyncHandler(authController.resetPassword)
);

/**
 * @openapi
 * /api/v1/auth/password/change:
 *   post:
 *     tags: [Conta]
 *     summary: Altera a senha da conta autenticada
 *     security:
 *       - accountSession: []
 *     parameters:
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
 *             required: [current_password, new_password]
 *             properties:
 *               current_password: { type: string }
 *               new_password: { type: string, minLength: 8, maxLength: 128 }
 *     responses:
 *       204:
 *         description: Senha alterada; as outras sessões foram revogadas.
 *       422:
 *         description: Senha atual incorreta ou nova senha fora da política.
 */
router.post(
  '/password/change',
  asyncHandler(hostAccountAuth),
  requireAuthCsrf,
  validate({ body: changePasswordSchema }),
  asyncHandler(authController.changePassword)
);

export default router;
