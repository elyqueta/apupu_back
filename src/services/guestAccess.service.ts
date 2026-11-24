import { Request } from 'express';
import { hostAuthSessionRepository } from '../repositories/hostAuthSession.repository';
import { hostRepository } from '../repositories/host.repository';
import { Invitation } from '../types/invitation.types';
import { readAuthSession } from '../utils/cookie.util';
import { hashToken } from '../utils/token.util';

/** Identidade mínima de uma sessão de conta válida. */
export interface AccountIdentity {
  hostId: string;
  email: string;
  emailVerified: boolean;
  sessionToken: string;
}

/**
 * Resolve a conta autenticada a partir do cookie `apupu_auth`, sem
 * falhar quando não há sessão.
 *
 * É usada no fluxo público do convite: uma conta válida é uma
 * alternativa à capacidade do navegador, mas a ausência de conta não
 * deve produzir 401 — o convite público continua a responder 404
 * genérico.
 */
export async function resolveAccountIdentity(
  req: Request
): Promise<AccountIdentity | null> {
  const sessionToken = readAuthSession(req);

  if (!sessionToken) return null;

  const session = await hostAuthSessionRepository.findActiveByTokenHash(
    hashToken(sessionToken)
  );

  if (!session) return null;

  const host = await hostRepository.findById(session.hostId);

  if (!host || host.status !== 'active') return null;

  return {
    hostId: host.id,
    email: host.email,
    emailVerified: host.emailVerifiedAt !== null,
    sessionToken,
  };
}

/** `true` quando a conta verificada é a convidada deste convite. */
export function accountOwnsInvitation(
  invitation: Invitation,
  account: AccountIdentity | null
): account is AccountIdentity {
  return Boolean(
    account &&
      account.emailVerified &&
      invitation.guestEmail &&
      invitation.guestEmail.trim().toLowerCase() ===
        account.email.trim().toLowerCase()
  );
}
