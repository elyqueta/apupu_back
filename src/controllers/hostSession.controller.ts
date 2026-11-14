import { Request, Response } from 'express';
import { toEventDto } from '../dto/event.dto';
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
   */
  create: async (req: Request, res: Response): Promise<void> => {
    const body = req.body as HostSessionBody;
    const result = await hostSessionService.create(body.token);

    setHostSession(res, result.event.id, result.sessionToken);

    res.status(200).json({
      data: {
        event: toEventDto(result.event),
        csrf_token: result.csrfToken,
        expires_at: result.session.expiresAt.toISOString(),
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
