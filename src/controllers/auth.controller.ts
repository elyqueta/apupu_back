import { Request, Response } from 'express';
import { env } from '../config/env';
import { toHostDto } from '../dto/host.dto';
import {
  ChangePasswordBody,
  ForgotPasswordBody,
  LoginBody,
  RegisterBody,
  RegisterRequestCodeBody,
  RegisterVerifyCodeBody,
  ResendVerificationBody,
  ResetPasswordBody,
  VerifyEmailBody,
} from '../schemas/auth.schemas';
import { auditContext } from '../services/audit.service';
import { authService } from '../services/auth.service';
import {
  clearAuthSession,
  readAuthSession,
  setAuthSession,
} from '../utils/cookie.util';
import { csrfTokenFor } from '../utils/token.util';

function userAgent(req: Request): string | null {
  const value = req.header('user-agent');
  return value ? value.slice(0, 512) : null;
}

export const authController = {
  requestRegistrationCode: async (req: Request, res: Response): Promise<void> => {
    const body = req.body as RegisterRequestCodeBody;
    const result = await authService.requestRegistrationCode(body, auditContext(req));

    res.status(202).json({
      data: {
        status: 'accepted',
        email: body.email,
        expires_at: result.expiresAt.toISOString(),
        resend_available_at: result.resendAvailableAt.toISOString(),
        // Conveniência do protótipo: fora de produção devolvemos o código
        // para o frontend poder pré-preencher o ecrã de verificação.
        // Em produção o código só existe no email.
        ...(env.NODE_ENV === 'production' ? {} : { dev_code: result.code }),
      },
    });
  },

  verifyRegistrationCode: async (req: Request, res: Response): Promise<void> => {
    const body = req.body as RegisterVerifyCodeBody;
    const result = await authService.verifyRegistrationCode(body, auditContext(req));

    res.status(200).json({
      data: {
        email: body.email,
        verification_token: result.verificationToken,
        expires_at: result.expiresAt.toISOString(),
      },
    });
  },

  register: async (req: Request, res: Response): Promise<void> => {
    const result = await authService.register(
      req.body as RegisterBody,
      userAgent(req),
      auditContext(req)
    );

    setAuthSession(res, result.session.sessionToken);

    res.status(201).json({
      data: {
        host: toHostDto(result.host),
        csrf_token: result.session.csrfToken,
        expires_at: result.session.expiresAt.toISOString(),
      },
    });
  },

  verifyEmail: async (req: Request, res: Response): Promise<void> => {
    const body = req.body as VerifyEmailBody;
    const host = await authService.verifyEmail(body.token, auditContext(req));

    res.status(200).json({ data: { host: toHostDto(host) } });
  },

  resendVerification: async (req: Request, res: Response): Promise<void> => {
    const body = req.body as ResendVerificationBody;
    await authService.resendVerification(body.email);

    // Resposta sempre igual: não revela existência nem estado da conta.
    res.status(202).json({ data: { status: 'accepted' } });
  },

  login: async (req: Request, res: Response): Promise<void> => {
    const body = req.body as LoginBody;
    const result = await authService.login(body, userAgent(req), auditContext(req));

    setAuthSession(res, result.session.sessionToken);

    res.status(200).json({
      data: {
        host: toHostDto(result.host),
        csrf_token: result.session.csrfToken,
        expires_at: result.session.expiresAt.toISOString(),
      },
    });
  },

  logout: async (req: Request, res: Response): Promise<void> => {
    if (req.accountSession) {
      await authService.logout(req.accountSession.sessionId);
    }

    clearAuthSession(res);
    res.status(204).send();
  },

  session: async (req: Request, res: Response): Promise<void> => {
    const host = await authService.sessionHost(req.hostAccount?.id ?? '');
    const sessionToken = readAuthSession(req);

    res.status(200).json({
      data: {
        host: toHostDto(host),
        ...(sessionToken ? { csrf_token: csrfTokenFor(sessionToken) } : {}),
      },
    });
  },

  forgotPassword: async (req: Request, res: Response): Promise<void> => {
    const body = req.body as ForgotPasswordBody;
    await authService.forgotPassword(body.email);

    res.status(202).json({ data: { status: 'accepted' } });
  },

  resetPassword: async (req: Request, res: Response): Promise<void> => {
    const body = req.body as ResetPasswordBody;
    await authService.resetPassword(body, auditContext(req));

    res.status(204).send();
  },

  changePassword: async (req: Request, res: Response): Promise<void> => {
    if (!req.hostAccount || !req.accountSession) {
      throw new Error('Conta não resolvida: falta o middleware hostAccountAuth.');
    }

    await authService.changePassword(
      req.hostAccount.id,
      req.accountSession.sessionId,
      req.body as ChangePasswordBody,
      auditContext(req)
    );

    res.status(204).send();
  },
};
