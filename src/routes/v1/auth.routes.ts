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
  registerRequestCodeSchema,
  registerSchema,
  registerVerifyCodeSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from '../../schemas/auth.schemas';

const router = Router();

/**
 * @openapi
 * /api/v1/auth/register/request-code:
 *   post:
 *     tags: [Conta]
 *     summary: Valida o email e envia um código OTP
 *     description: >
 *       Primeiro passo do registo. Confirma que o email ainda não está
 *       registado e envia um código de 6 dígitos, válido por
 *       `REGISTRATION_OTP_TTL_MINUTES` minutos. Pedidos repetidos antes
 *       de `REGISTRATION_OTP_RESEND_SECONDS` devolvem `429`
 *       `otp_resend_too_soon`. A conta só é criada depois de o código
 *       ser verificado em `/auth/register/verify-code`. O código é
 *       enviado exclusivamente por email, com um link que pré-preenche
 *       o ecrã de verificação; nunca é devolvido na resposta da API.
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
 *         description: Código enfileirado para envio por email.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/RegistrationCodeEnvelope' }
 *       409:
 *         description: Email já registado.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *             example:
 *               error:
 *                 code: email_already_registered
 *                 message: Este email já está registado.
 *                 fields: { email: [Este email já está registado.] }
 *                 request_id: 6b1f0a1e-8f6d-4a3e-9c2d-1f2a3b4c5d6e
 *       422:
 *         description: Email inválido.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       429:
 *         description: Demasiados pedidos ou reenvio demasiado cedo.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.post(
  '/register/request-code',
  authIpLimiter,
  authEmailLimiter,
  validate({ body: registerRequestCodeSchema }),
  asyncHandler(authController.requestRegistrationCode)
);

/**
 * @openapi
 * /api/v1/auth/register/verify-code:
 *   post:
 *     tags: [Conta]
 *     summary: Troca o código OTP por um token de criação de conta
 *     description: >
 *       Verifica o código de 6 dígitos. Em caso de sucesso devolve um
 *       `verification_token` de uso único, válido por
 *       `REGISTRATION_VERIFICATION_TTL_MINUTES` minutos, que deve ser
 *       enviado em `/auth/register`. Após
 *       `REGISTRATION_OTP_MAX_ATTEMPTS` falhas o código é invalidado.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, code]
 *             properties:
 *               email: { type: string, format: email }
 *               code: { type: string, pattern: '^[0-9]{6}$' }
 *     responses:
 *       200:
 *         description: Código válido; token de criação emitido.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/RegistrationVerificationEnvelope' }
 *       422:
 *         description: Código inválido, expirado ou tentativas excedidas.
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
  '/register/verify-code',
  authIpLimiter,
  authEmailLimiter,
  validate({ body: registerVerifyCodeSchema }),
  asyncHandler(authController.verifyRegistrationCode)
);

/**
 * @openapi
 * /api/v1/auth/register:
 *   post:
 *     tags: [Conta]
 *     summary: Cria uma conta de anfitrião já com o email verificado
 *     description: >
 *       Terceiro e último passo do registo. Exige o
 *       `verification_token` devolvido por
 *       `/auth/register/verify-code`; sem ele devolve `422`
 *       `verification_required`. A conta é criada com
 *       `email_verified=true`, os eventos legados com o mesmo email são
 *       ligados à conta, o email de boas-vindas é enfileirado e uma
 *       sessão é criada automaticamente. O cookie é HttpOnly; o token
 *       bruto nunca é devolvido em JSON.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password, verification_token]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string, minLength: 8, maxLength: 128 }
 *               display_name: { type: string, nullable: true }
 *               verification_token: { type: string }
 *     responses:
 *       201:
 *         description: Conta criada, sessão iniciada por cookie HttpOnly e csrf_token devolvido.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/RegistrationEnvelope' }
 *       409:
 *         description: Email já registado.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       422:
 *         description: Dados inválidos ou token de verificação inválido/expirado.
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
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/HostEnvelope' }
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
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/AcceptedEnvelope' }
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
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/LoginEnvelope' }
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
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SessionEnvelope' }
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
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/AcceptedEnvelope' }
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
