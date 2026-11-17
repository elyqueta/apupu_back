import { Request, Response } from 'express';
import { toHostDto } from '../dto/host.dto';
import { AvatarBody, CoverBody, UpdateProfileBody } from '../schemas/host.schemas';
import { auditService } from '../services/audit.service';
import { avatarService } from '../services/avatar.service';
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
    const hostId = requireHost(req).id;
    const host = await profileService.update(hostId, req.body as UpdateProfileBody);

    await auditService.recordRequest(req, {
      action: 'profile_updated',
      hostId,
      metadata: { fields: Object.keys(req.body as Record<string, unknown>) },
    });

    res.status(200).json({ data: { host: toHostDto(host) } });
  },

  setAvatar: async (req: Request, res: Response): Promise<void> => {
    const hostId = requireHost(req).id;
    const body = req.body as AvatarBody;
    const host = await profileService.setAvatar(hostId, body.avatar_url);

    await auditService.recordRequest(req, {
      action: 'profile_updated',
      hostId,
      metadata: { fields: ['avatar_url'] },
    });

    res.status(200).json({ data: { host: toHostDto(host) } });
  },

  uploadAvatar: async (req: Request, res: Response): Promise<void> => {
    const hostId = requireHost(req).id;

    // O middleware `uploadAvatar` garante `req.file`; a verificação
    // mantém o contrato explícito caso a rota mude de composição.
    if (!req.file) {
      throw new Error('Upload sem ficheiro: falta o middleware uploadAvatar.');
    }

    const uploaded = await avatarService.upload(req.file.buffer, req.file.mimetype);
    const host = await profileService.setAvatar(hostId, uploaded.url);

    await auditService.recordRequest(req, {
      action: 'profile_updated',
      hostId,
      metadata: {
        fields: ['avatar_url'],
        storage: 'cloudinary',
        public_id: uploaded.publicId,
      },
    });

    res.status(200).json({ data: { host: toHostDto(host) } });
  },

  setCover: async (req: Request, res: Response): Promise<void> => {
    const hostId = requireHost(req).id;
    const body = req.body as CoverBody;
    const host = await profileService.setCoverFromUrl(hostId, body.cover_url);

    await auditService.recordRequest(req, {
      action: 'profile_updated',
      hostId,
      metadata: { fields: ['cover_url'] },
    });

    res.status(200).json({ data: { host: toHostDto(host) } });
  },

  uploadCover: async (req: Request, res: Response): Promise<void> => {
    const hostId = requireHost(req).id;

    // O middleware `uploadProfileCover` garante `req.file`; a
    // verificação mantém o contrato explícito caso a rota mude de
    // composição.
    if (!req.file) {
      throw new Error('Upload sem ficheiro: falta o middleware uploadProfileCover.');
    }

    const host = await profileService.uploadCover(
      hostId,
      req.file.buffer,
      req.file.mimetype
    );

    await auditService.recordRequest(req, {
      action: 'profile_updated',
      hostId,
      metadata: { fields: ['cover_url'], storage: 'cloudinary' },
    });

    res.status(200).json({ data: { host: toHostDto(host) } });
  },

  removeCover: async (req: Request, res: Response): Promise<void> => {
    const hostId = requireHost(req).id;
    const host = await profileService.removeCover(hostId);

    await auditService.recordRequest(req, {
      action: 'profile_updated',
      hostId,
      metadata: { fields: ['cover_url'], removed: true },
    });

    res.status(200).json({ data: { host: toHostDto(host) } });
  },
};
