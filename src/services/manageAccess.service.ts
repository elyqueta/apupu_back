import { logger } from '../config/logger';
import { ForbiddenError } from '../errors';
import { eventManagerRepository } from '../repositories/eventManager.repository';
import { eventRepository } from '../repositories/event.repository';
import { notificationRepository } from '../repositories/notification.repository';
import { ManageAccessBody, manageAccessSchema } from '../schemas/manageAccess.schemas';
import {
  DUMMY_ACCESS_CODE_HASH,
  accessCodeMatches,
  hashAccessCode,
} from '../utils/accessCode.util';
import { hashToken } from '../utils/token.util';
import { CreatedHostSession, hostSessionService, isManagerLinkValid } from './hostSession.service';

const ACCESS_DENIED_MESSAGE = 'Não foi possível aceder.';
const ACCESS_DENIED_CODE = 'access_denied';

/** Todas as falhas desta rota partilham o mesmo envelope. */
function deny(reason: string): never {
  logger.warn({ reason }, 'Acesso de gestão negado.');
  throw new ForbiddenError(ACCESS_DENIED_MESSAGE, ACCESS_DENIED_CODE);
}

function managerLabel(manager: {
  displayName: string | null;
  email: string | null;
  phone: string | null;
}): string {
  return manager.displayName ?? manager.email ?? manager.phone ?? 'gestor';
}

export const manageAccessService = {
  /**
   * Troca o link secreto + código de acesso por uma sessão de gestão.
   *
   * Nenhum motivo de falha é exposto: todos os caminhos terminam no
   * mesmo 403. O hash fictício garante que um token inexistente custa
   * o mesmo tempo de comparação de um token válido.
   */
  async access(body: unknown): Promise<CreatedHostSession> {
    const parsed = manageAccessSchema.safeParse(body);
    if (!parsed.success) return deny('invalid_format');

    const input: ManageAccessBody = parsed.data;
    const manager = await eventManagerRepository.findByTokenHash(hashToken(input.token));

    // Comparação fictícia para tokens inexistentes.
    const providedHash = hashAccessCode(
      input.code ?? 'AAAAAA',
      manager?.id ?? '00000000-0000-4000-8000-000000000000'
    );
    const codeMatches = accessCodeMatches(providedHash, manager?.accessCodeHash ?? DUMMY_ACCESS_CODE_HASH);

    if (!manager) {
      // A comparação já foi feita; o resultado não é usado para manter
      // o mesmo tempo de resposta de um token existente.
      void codeMatches;
      return deny('unknown_token');
    }

    if (!isManagerLinkValid(manager)) return deny('link_invalid');

    // Gestores legados continuam a entrar só com o link até o anfitrião
    // gerar um código. O sinal `legacy_access` fica apenas interno.
    const legacyAccess = manager.accessCodeHash === null;
    if (!legacyAccess && (!input.code || !codeMatches)) {
      const failure = await eventManagerRepository.recordAccessFailure(manager.id);

      if (failure?.revoked) {
        const event = await eventRepository.findById(manager.eventId);
        if (event?.hostId) {
          await notificationRepository.createForHost({
            hostId: event.hostId,
            eventId: event.id,
            kind: 'access_suspicious',
            title: `Tentativas de acesso suspeitas ao link de ${managerLabel(manager)}`,
            body: `O link de ${event.title} foi revogado após 15 tentativas falhadas.`,
            metadata: { manager_id: manager.id, reason: 'access_failures' },
            dedupeKey: `access_suspicious:${manager.id}:${manager.linkExpiresAt?.toISOString() ?? 'legacy'}`,
          });
        }
      }

      return deny('invalid_code');
    }

    if (!legacyAccess) {
      await eventManagerRepository.recordSuccessfulAccess(manager.id);
    }

    // `legacy_access` não é serializado: apenas regista o motivo interno.
    logger.info({ reason: legacyAccess ? 'legacy_access' : 'code_access' }, 'Acesso de gestão concedido.');
    return hostSessionService.createManagerSession(manager);
  },
};
