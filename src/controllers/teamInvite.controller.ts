import { Request, Response } from 'express';
import { teamInviteService } from '../services/teamInvite.service';
import { EventAccessScope } from '../types/event.types';

function accessScope(req: Request): EventAccessScope {
  if (!req.hostAccount) {
    throw new Error('Conta não resolvida: falta o middleware hostAccountAuth.');
  }

  return {
    hostId: req.hostAccount.id,
    managerEmail: req.hostAccount.emailVerifiedAt ? req.hostAccount.email : null,
  };
}

export const teamInviteController = {
  /** Reenvia o convite de um membro pendente (rota autenticada). */
  resend: async (req: Request, res: Response): Promise<void> => {
    const result = await teamInviteService.resend(
      accessScope(req),
      req.params.teamId ?? '',
      req.params.memberId ?? ''
    );

    res.status(200).json({ data: result });
  },

  /** Valida o token e devolve o resumo para a página pública. */
  preview: async (req: Request, res: Response): Promise<void> => {
    const result = await teamInviteService.preview(req.params.token ?? '');
    res.status(200).json({ data: result });
  },

  /**
   * "Não conheço este convite".
   *
   * Responde sempre `204`, mesmo para um token inválido, para não
   * permitir enumerar convites. A denúncia revoga o convite e bloqueia
   * o remetente para aquele email.
   */
  reportUnknown: async (req: Request, res: Response): Promise<void> => {
    await teamInviteService.reportUnknown(req.params.token ?? '');
    res.status(204).end();
  },

  /**
   * `GET` da rota de denúncia.
   *
   * Scanners de email seguem ligações automaticamente. O `GET` nunca
   * pode revogar o convite: responde `405` e indica que a confirmação
   * exige um `POST` explícito do botão.
   */
  reportUnknownMethodNotAllowed: (req: Request, res: Response): void => {
    res.set('Allow', 'POST');
    res.status(405).json({
      error: {
        code: 'method_not_allowed',
        message: 'Use POST para confirmar que não conhece este convite.',
        request_id: req.id ?? 'unknown',
      },
    });
  },

  /** Aceita o convite com a conta autenticada. */
  accept: async (req: Request, res: Response): Promise<void> => {
    const account = req.hostAccount;

    if (!account) {
      throw new Error('Conta não resolvida: falta o middleware hostAccountAuth.');
    }

    const result = await teamInviteService.accept(req.params.token ?? '', {
      hostId: account.id,
      email: account.email,
      displayName: account.profile.displayName,
      emailVerified: Boolean(account.emailVerifiedAt),
    });

    res.status(200).json({ data: result });
  },
};
