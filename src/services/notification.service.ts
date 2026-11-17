import { NotFoundError } from '../errors';
import { notificationRepository } from '../repositories/notification.repository';
import {
  HostNotification,
  NotificationKind,
  NotificationStatus,
} from '../types/host.types';
import { EventAccessScope } from '../types/event.types';
import { PaginationMeta } from '../types/pagination.types';
import { buildPaginationMeta, toPageParams } from '../utils/pagination.util';

export interface NotificationListFilters {
  status: NotificationStatus;
  kind?: NotificationKind;
  eventId?: string;
  q?: string;
  page: number;
  pageSize: number;
}

export interface NotificationListResult {
  items: HostNotification[];
  pagination: PaginationMeta;
  unread: number;
}

const NOT_FOUND = 'Notificação não encontrada.';

export const notificationService = {
  async list(
    scope: EventAccessScope,
    filters: NotificationListFilters
  ): Promise<NotificationListResult> {
    // Lembretes são derivados no momento da leitura; a chave de
    // deduplicação mantém a operação idempotente.
    await notificationRepository.syncReminders(scope);

    const page = toPageParams(filters.page, filters.pageSize);
    const { items, total, unread } = await notificationRepository.listForHost({
      hostId: scope.hostId,
      status: filters.status,
      kind: filters.kind,
      eventId: filters.eventId,
      q: filters.q,
      offset: page.offset,
      limit: page.limit,
    });

    return {
      items,
      unread,
      pagination: buildPaginationMeta(total, page.page, page.pageSize),
    };
  },

  async unreadCount(scope: EventAccessScope): Promise<number> {
    await notificationRepository.syncReminders(scope);
    return notificationRepository.unreadCount(scope.hostId);
  },

  async setRead(
    hostId: string,
    notificationId: string,
    read: boolean
  ): Promise<HostNotification> {
    const notification = await notificationRepository.setRead(
      notificationId,
      hostId,
      read
    );

    if (!notification) {
      throw new NotFoundError(NOT_FOUND, 'notification_not_found');
    }

    return notification;
  },

  async markAllRead(hostId: string): Promise<number> {
    return notificationRepository.markAllRead(hostId);
  },

  async dismiss(hostId: string, notificationId: string): Promise<void> {
    const removed = await notificationRepository.dismiss(notificationId, hostId);

    if (!removed) {
      throw new NotFoundError(NOT_FOUND, 'notification_not_found');
    }
  },

  async dismissAll(hostId: string): Promise<number> {
    return notificationRepository.dismissAll(hostId);
  },
};
