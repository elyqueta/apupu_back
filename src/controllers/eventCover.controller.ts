import { Request, Response } from 'express';
import { toEventDto } from '../dto/event.dto';
import { CoverUrlBody } from '../schemas/host.schemas';
import { auditService } from '../services/audit.service';
import { eventCoverService } from '../services/eventCover.service';
import { EventAccessScope } from '../types/event.types';

function accessScope(req: Request): EventAccessScope {
  if (req.hostAccount) {
    return {
      hostId: req.hostAccount.id,
      managerEmail: req.hostAccount.emailVerifiedAt ? req.hostAccount.email : null,
    };
  }

  if (req.event?.hostId) {
    return { hostId: req.event.hostId, managerEmail: null };
  }

  throw new Error('Evento não resolvido: falta o middleware hostAuth.');
}

export const eventCoverController = {
  setUrl: async (req: Request, res: Response): Promise<void> => {
    const body = req.body as CoverUrlBody;
    const event = await eventCoverService.setFromUrl(
      accessScope(req),
      req.params.eventId ?? '',
      body.cover_url
    );

    await auditService.recordRequest(req, {
      action: 'event_cover_updated',
      hostId: event.hostId,
      eventId: event.id,
      metadata: { source: 'url' },
    });

    res.status(200).json({ data: toEventDto(event, undefined, req.accessRole) });
  },

  upload: async (req: Request, res: Response): Promise<void> => {
    const file = req.file;

    if (!file) {
      throw new Error('Ficheiro não resolvido: falta o middleware uploadEventCover.');
    }

    const event = await eventCoverService.upload(
      accessScope(req),
      req.params.eventId ?? '',
      file.buffer,
      file.mimetype
    );

    await auditService.recordRequest(req, {
      action: 'event_cover_updated',
      hostId: event.hostId,
      eventId: event.id,
      metadata: { source: 'upload' },
    });

    res.status(200).json({ data: toEventDto(event, undefined, req.accessRole) });
  },

  remove: async (req: Request, res: Response): Promise<void> => {
    const event = await eventCoverService.remove(
      accessScope(req),
      req.params.eventId ?? ''
    );

    await auditService.recordRequest(req, {
      action: 'event_cover_removed',
      hostId: event.hostId,
      eventId: event.id,
    });

    res.status(200).json({ data: toEventDto(event, undefined, req.accessRole) });
  },
};
