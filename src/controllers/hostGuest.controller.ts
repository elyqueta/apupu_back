import { Request, Response } from 'express';
import { toHostGuestDto } from '../dto/invitation.dto';
import { HostGuestsQuery } from '../schemas/host.schemas';
import { hostGuestService } from '../services/hostGuest.service';

function requireHostId(req: Request): string {
  if (!req.hostAccount) {
    throw new Error('Conta não resolvida: falta o middleware hostAccountAuth.');
  }

  return req.hostAccount.id;
}

export const hostGuestController = {
  list: async (req: Request, res: Response): Promise<void> => {
    const result = await hostGuestService.list(
      requireHostId(req),
      req.query as unknown as HostGuestsQuery
    );

    res.status(200).json({
      data: result.items.map(toHostGuestDto),
      pagination: result.pagination,
    });
  },
};
