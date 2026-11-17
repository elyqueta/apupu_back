import { Request, Response } from 'express';
import { toNotificationDto } from '../dto/notification.dto';
import {
  NotificationsQuery,
  UpdateNotificationBody,
} from '../schemas/host.schemas';
import { notificationService } from '../services/notification.service';
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

function hostId(req: Request): string {
  if (!req.hostAccount) {
    throw new Error('Conta não resolvida: falta o middleware hostAccountAuth.');
  }

  return req.hostAccount.id;
}

export const notificationController = {
  list: async (req: Request, res: Response): Promise<void> => {
    const query = req.query as unknown as NotificationsQuery;
    const result = await notificationService.list(accessScope(req), {
      status: query.status,
      kind: query.kind,
      eventId: query.event_id,
      q: query.q,
      page: query.page,
      pageSize: query.page_size,
    });

    res.status(200).json({
      data: result.items.map(toNotificationDto),
      pagination: result.pagination,
      unread_count: result.unread,
    });
  },

  unreadCount: async (req: Request, res: Response): Promise<void> => {
    const count = await notificationService.unreadCount(accessScope(req));
    res.status(200).json({ data: { unread_count: count } });
  },

  setRead: async (req: Request, res: Response): Promise<void> => {
    const body = req.body as UpdateNotificationBody;
    const notification = await notificationService.setRead(
      hostId(req),
      req.params.notificationId ?? '',
      body.read
    );

    res.status(200).json({ data: toNotificationDto(notification) });
  },

  markAllRead: async (req: Request, res: Response): Promise<void> => {
    const updated = await notificationService.markAllRead(hostId(req));
    res.status(200).json({ data: { updated } });
  },

  dismiss: async (req: Request, res: Response): Promise<void> => {
    await notificationService.dismiss(hostId(req), req.params.notificationId ?? '');
    res.status(204).send();
  },

  dismissAll: async (req: Request, res: Response): Promise<void> => {
    const removed = await notificationService.dismissAll(hostId(req));
    res.status(200).json({ data: { removed } });
  },
};
