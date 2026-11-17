import { Request, Response } from 'express';
import { toGuestInvitationDto } from '../dto/invitation.dto';
import { GuestInvitationsQuery } from '../schemas/host.schemas';
import { guestInvitationService } from '../services/guestInvitation.service';
import { HostWithProfile } from '../types/host.types';

function requireAccount(req: Request): HostWithProfile {
  if (!req.hostAccount) {
    throw new Error('Conta não resolvida: falta o middleware hostAccountAuth.');
  }

  return req.hostAccount;
}

export const guestInvitationController = {
  /** Lista os convites da conta autenticada, com o resumo do evento. */
  listMine: async (req: Request, res: Response): Promise<void> => {
    const account = requireAccount(req);
    const result = await guestInvitationService.listMine(
      account.email,
      req.query as unknown as GuestInvitationsQuery
    );

    res.status(200).json({
      data: result.items.map(toGuestInvitationDto),
      pagination: result.pagination,
    });
  },
};
