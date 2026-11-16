import { env } from '../config/env';
import { withTransaction } from '../database/pool';
import {
  ConflictError,
  LockedError,
  UnauthorizedError,
  ValidationError,
} from '../errors';
import { eventRepository } from '../repositories/event.repository';
import { hostAuthSessionRepository } from '../repositories/hostAuthSession.repository';
import { hostRepository } from '../repositories/host.repository';
import {
  emailVerificationRepository,
  passwordResetRepository,
} from '../repositories/hostToken.repository';
import { HostAuthSession, HostWithProfile } from '../types/host.types';
import { isUniqueViolation } from '../utils/db.util';
import {
  hashPassword,
  verifyAgainstDummy,
  verifyPassword,
} from '../utils/password.util';
import { csrfTokenFor, generateToken, hashToken } from '../utils/token.util';
import {
  ChangePasswordBody,
  LoginBody,
  RegisterBody,
  ResetPasswordBody,
} from '../schemas/auth.schemas';
import { AuditContext, auditService } from './audit.service';
import { enqueueEmailVerification, enqueueHostWelcome, enqueuePasswordReset } from './reminder.service';

/**
 * Autenticação da conta de anfitrião.
 *
 * Regras transversais:
 * - o email não revela existência em `login`/`forgot` (mensagem
 *   genérica e, no login sem conta, uma verificação de senha contra um
 *   hash descartável para nivelar o tempo de resposta);
 * - a senha em claro nunca é persistida, registada ou devolvida;
 * - qualquer falha de sessão devolve o mesmo 401 genérico.
 */

const INVALID_CREDENTIALS = 'Email ou senha inválidos.';
const INVALID_SESSION = 'Sessão inválida ou expirada.';
const INVALID_VERIFICATION = 'Link de verificação inválido ou expirado.';
const INVALID_RESET = 'Link de reposição inválido ou expirado.';

export interface CreatedAccountSession {
  session: HostAuthSession;
  sessionToken: string;
  csrfToken: string;
  expiresAt: Date;
}

function tokenExpiry(minutes: number): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

async function createAccountSession(
  hostId: string,
  userAgent: string | null
): Promise<CreatedAccountSession> {
  const sessionToken = generateToken();
  const csrfToken = csrfTokenFor(sessionToken);
  const expiresAt = tokenExpiry(env.AUTH_SESSION_TTL_MINUTES);

  const session = await hostAuthSessionRepository.create({
    hostId,
    tokenHash: hashToken(sessionToken),
    csrfHash: hashToken(csrfToken),
    userAgentHash: userAgent ? hashToken(userAgent) : null,
    expiresAt,
  });

  return { session, sessionToken, csrfToken, expiresAt };
}

export const authService = {
  /**
   * Cria a conta, o perfil e o token de verificação numa transacção.
   *
   * Não inicia sessão: o frontend mostra "verifique o seu email". O
   * email de boas-vindas é enfileirado uma única vez por conta.
   */
  async register(input: RegisterBody): Promise<HostWithProfile> {
    const passwordHash = await hashPassword(input.password);

    try {
      return await withTransaction(async (client) => {
        if (await hostRepository.emailExists(input.email)) {
          throw new ConflictError('Este email já está registado.', 'email_already_registered', {
            email: ['Este email já está registado.'],
          });
        }

        const host = await hostRepository.create(
          {
            email: input.email,
            passwordHash,
            displayName: input.display_name ?? null,
          },
          client
        );

        const token = generateToken();
        await emailVerificationRepository.create(
          host.id,
          hashToken(token),
          tokenExpiry(env.EMAIL_VERIFICATION_TTL_MINUTES),
          client
        );

        await enqueueEmailVerification(host.id, host.email, token, client);
        await enqueueHostWelcome(host.id, host.email, client);

        return host;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('Este email já está registado.', 'email_already_registered', {
          email: ['Este email já está registado.'],
        });
      }

      throw error;
    }
  },

  /**
   * Consome o token de verificação e, só agora, liga os eventos legados
   * cujo `host_email` coincide com o email verificado.
   */
  async verifyEmail(token: string, context?: AuditContext): Promise<HostWithProfile> {
    const host = await withTransaction(async (client) => {
      const hostId = await emailVerificationRepository.consume(hashToken(token), client);

      if (!hostId) {
        throw new ValidationError(
          INVALID_VERIFICATION,
          { token: [INVALID_VERIFICATION] },
          'verification_invalid'
        );
      }

      await hostRepository.setEmailVerified(hostId, client);

      const host = await hostRepository.findById(hostId, client);

      if (!host) {
        throw new ValidationError(
          INVALID_VERIFICATION,
          { token: [INVALID_VERIFICATION] },
          'verification_invalid'
        );
      }

      await eventRepository.claimByHostEmail(host.id, host.email, client);
      return host;
    });

    await auditService.record({
      action: 'email_verified',
      hostId: host.id,
      ip: context?.ip ?? null,
      requestId: context?.requestId ?? null,
    });

    return host;
  },

  /**
   * Reenvia a verificação. Responde sempre da mesma forma: não revela
   * se o email existe nem se já está verificado.
   */
  async resendVerification(email: string): Promise<void> {
    const host = await hostRepository.findByEmail(email);

    if (!host || host.emailVerifiedAt || host.status !== 'active') {
      return;
    }

    const token = generateToken();

    await withTransaction(async (client) => {
      await emailVerificationRepository.consumeAllForHost(host.id, client);
      await emailVerificationRepository.create(
        host.id,
        hashToken(token),
        tokenExpiry(env.EMAIL_VERIFICATION_TTL_MINUTES),
        client
      );
      await enqueueEmailVerification(host.id, host.email, token, client);
    });
  },

  /**
   * Autentica e cria a sessão de conta. O login é permitido com email
   * por verificar; criar/gerir eventos exige verificação.
   */
  async login(
    input: LoginBody,
    userAgent: string | null,
    context?: AuditContext
  ): Promise<{
    host: HostWithProfile;
    session: CreatedAccountSession;
  }> {
    const auditBase = {
      ip: context?.ip ?? null,
      requestId: context?.requestId ?? null,
    };

    const host = await hostRepository.findByEmail(input.email);

    if (!host) {
      await verifyAgainstDummy(input.password);

      await auditService.record({
        ...auditBase,
        action: 'login_failure',
        outcome: 'failure',
        metadata: { reason: 'unknown_account' },
      });

      throw new UnauthorizedError(INVALID_CREDENTIALS, 'invalid_credentials');
    }

    if (host.status !== 'active') {
      await auditService.record({
        ...auditBase,
        action: 'login_failure',
        outcome: 'failure',
        hostId: host.id,
        metadata: { reason: 'inactive_account' },
      });

      throw new UnauthorizedError(INVALID_CREDENTIALS, 'invalid_credentials');
    }

    if (host.lockedUntil && host.lockedUntil.getTime() > Date.now()) {
      await auditService.record({
        ...auditBase,
        action: 'login_locked',
        outcome: 'failure',
        hostId: host.id,
        metadata: { reason: 'locked' },
      });

      throw new LockedError();
    }

    const valid = await verifyPassword(host.passwordHash, input.password);

    if (!valid) {
      const { lockedUntil } = await hostRepository.registerFailedLogin(
        host.id,
        env.AUTH_MAX_FAILED_LOGINS,
        env.AUTH_LOCK_MINUTES
      );

      await auditService.record({
        ...auditBase,
        action: 'login_failure',
        outcome: 'failure',
        hostId: host.id,
        metadata: { reason: 'invalid_password' },
      });

      if (lockedUntil && lockedUntil.getTime() > Date.now()) {
        await auditService.record({
          ...auditBase,
          action: 'login_locked',
          outcome: 'failure',
          hostId: host.id,
          metadata: { reason: 'too_many_failures' },
        });

        throw new LockedError();
      }

      throw new UnauthorizedError(INVALID_CREDENTIALS, 'invalid_credentials');
    }

    await hostRepository.registerSuccessfulLogin(host.id);

    const session = await createAccountSession(host.id, userAgent);
    const refreshed = (await hostRepository.findById(host.id)) ?? host;

    await auditService.record({
      ...auditBase,
      action: 'login_success',
      hostId: refreshed.id,
      metadata: { email_verified: refreshed.emailVerifiedAt !== null },
    });

    return { host: refreshed, session };
  },

  /** Resolve a conta de uma sessão de conta válida. */
  async sessionHost(hostId: string): Promise<HostWithProfile> {
    const host = await hostRepository.findById(hostId);

    if (!host || host.status !== 'active') {
      throw new UnauthorizedError(INVALID_SESSION, 'host_session_invalid');
    }

    return host;
  },

  async logout(sessionId: string): Promise<void> {
    await hostAuthSessionRepository.revoke(sessionId);
  },

  /**
   * Enfileira a reposição de senha. Responde sempre `202`, exista ou
   * não a conta. Reposições anteriores ficam inválidas.
   */
  async forgotPassword(email: string): Promise<void> {
    const host = await hostRepository.findByEmail(email);

    if (!host || host.status !== 'active') {
      return;
    }

    const token = generateToken();

    await withTransaction(async (client) => {
      await passwordResetRepository.consumeAllForHost(host.id, client);
      await passwordResetRepository.create(
        host.id,
        hashToken(token),
        tokenExpiry(env.PASSWORD_RESET_TTL_MINUTES),
        client
      );
      await enqueuePasswordReset(host.id, host.email, token, client);
    });
  },

  /**
   * Consome o token, define a nova senha e revoga todas as sessões.
   * O token é de uso único e é invalidado mesmo antes de a senha ser
   * gravada.
   */
  async resetPassword(input: ResetPasswordBody, context?: AuditContext): Promise<void> {
    const passwordHash = await hashPassword(input.password);

    const hostId = await withTransaction(async (client) => {
      const resolvedHostId = await passwordResetRepository.consume(
        hashToken(input.token),
        client
      );

      if (!resolvedHostId) {
        throw new ValidationError(INVALID_RESET, { token: [INVALID_RESET] }, 'reset_invalid');
      }

      await hostRepository.updatePassword(resolvedHostId, passwordHash, client);
      await hostAuthSessionRepository.revokeAllForHost(resolvedHostId);

      return resolvedHostId;
    });

    await auditService.record({
      action: 'password_reset',
      hostId,
      ip: context?.ip ?? null,
      requestId: context?.requestId ?? null,
    });
  },

  /** Altera a senha autenticada, mantendo a sessão atual. */
  async changePassword(
    hostId: string,
    sessionId: string,
    input: ChangePasswordBody,
    context?: AuditContext
  ): Promise<void> {
    const host = await hostRepository.findById(hostId);

    if (!host || host.status !== 'active') {
      throw new UnauthorizedError(INVALID_SESSION, 'host_session_invalid');
    }

    const valid = await verifyPassword(host.passwordHash, input.current_password);

    if (!valid) {
      throw new ValidationError('Verifique os campos indicados.', {
        current_password: ['A senha atual está incorreta.'],
      });
    }

    const passwordHash = await hashPassword(input.new_password);

    await withTransaction(async (client) => {
      await hostRepository.updatePassword(hostId, passwordHash, client);
      await hostAuthSessionRepository.revokeAllForHost(hostId, sessionId);
    });

    await auditService.record({
      action: 'password_changed',
      hostId,
      ip: context?.ip ?? null,
      requestId: context?.requestId ?? null,
    });
  },
};
