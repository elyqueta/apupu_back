import { Request, Response } from 'express';
import { toEventDto } from '../dto/event.dto';
import { auditService } from '../services/audit.service';
import { hostSessionService } from '../services/hostSession.service';
import { clearHostSession, setHostSession } from '../utils/cookie.util';

interface HostSessionBody {
  token: string;
}

export const hostSessionController = {
  /**
   * Troca o segredo do link de gestão por uma sessão HttpOnly.
   *
   * O segredo nunca é devolvido nem registado. O `csrf_token` é o valor
   * derivado que o frontend deve enviar em `X-CSRF-Token` nos pedidos
   * mutáveis seguintes.
   *
   * O link do anfitrião roda ao ser usado; o link de um gestor apenas
   * abre a mesma área de gestão, sem emitir um link novo.
   */
  create: async (req: Request, res: Response): Promise<void> => {
    const body = req.body as HostSessionBody;
    const result = await hostSessionService.create(body.token);

    setHostSession(res, result.event.id, result.sessionToken);

    await auditService.recordRequest(req, {
      action: result.role === 'manager' ? 'manager_link_used' : 'manage_link_rotated',
      hostId: result.event.hostId,
      eventId: result.event.id,
      metadata: { manage_email_status: result.manageEmailStatus },
    });

    res.status(200).json({
      data: {
        event: toEventDto(result.event, undefined, result.role),
        role: result.role,
        access_role: result.role,
        csrf_token: result.csrfToken,
        expires_at: result.session.expiresAt.toISOString(),
        manage_email_status: result.manageEmailStatus,
        manage_token_expires_at: result.event.manageTokenExpiresAt?.toISOString() ?? null,
      },
    });
  },

  /** Revoga a sessão actual e limpa os cookies do evento. */
  destroy: async (req: Request, res: Response): Promise<void> => {
    const session = req.hostSession;

    if (!session) {
      throw new Error('Sessão não resolvida: falta o middleware hostAuth.');
    }

    await hostSessionService.revoke(session.id);
    clearHostSession(res, session.eventId);

    res.status(204).send();
  },
};
