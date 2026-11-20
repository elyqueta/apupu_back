import { Request, Response } from 'express';
import { toEventDto } from '../dto/event.dto';
import { auditService } from '../services/audit.service';
import { manageAccessService } from '../services/manageAccess.service';
import { setHostSession } from '../utils/cookie.util';

/**
 * Entry point público para gestores sem conta: link + código de acesso.
 *
 * A resposta usa o mesmo envelope da troca de link do anfitrião para que
 * o frontend partilhe a lógica de arranque da sessão de gestão.
 */
export const manageAccessController = {
  access: async (req: Request, res: Response): Promise<void> => {
    const result = await manageAccessService.access(req.body);

    setHostSession(res, result.event.id, result.sessionToken);

    await auditService.recordRequest(req, {
      action: 'manager_link_used',
      hostId: result.event.hostId,
      eventId: result.event.id,
      metadata: { access_mode: result.email ? 'email' : 'phone' },
    });

    res.status(200).json({
      data: {
        event: toEventDto(result.event, undefined, result.role),
        role: result.role,
        access_role: result.role,
        email: result.email,
        csrf_token: result.csrfToken,
        expires_at: result.session.expiresAt.toISOString(),
      },
    });
  },
};
