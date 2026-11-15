import { Request, Response } from 'express';
import { toHostDto } from '../dto/host.dto';
import { AvatarBody, UpdateProfileBody } from '../schemas/host.schemas';
import { profileService } from '../services/profile.service';
import { HostWithProfile } from '../types/host.types';

function requireHost(req: Request): HostWithProfile {
  if (!req.hostAccount) {
    throw new Error('Conta não resolvida: falta o middleware hostAccountAuth.');
  }

  return req.hostAccount;
}

export const profileController = {
  get: async (req: Request, res: Response): Promise<void> => {
    const host = await profileService.get(requireHost(req).id);

    res.status(200).json({ data: { host: toHostDto(host) } });
  },

  update: async (req: Request, res: Response): Promise<void> => {
    const host = await profileService.update(
      requireHost(req).id,
      req.body as UpdateProfileBody
    );

    res.status(200).json({ data: { host: toHostDto(host) } });
  },

  setAvatar: async (req: Request, res: Response): Promise<void> => {
    const body = req.body as AvatarBody;
    const host = await profileService.setAvatar(requireHost(req).id, body.avatar_url);

    res.status(200).json({ data: { host: toHostDto(host) } });
  },
};
