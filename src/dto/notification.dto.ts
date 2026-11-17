import { HostNotification } from '../types/host.types';

export interface NotificationDto {
  id: string;
  event_id: string | null;
  event_title: string | null;
  activity_id: string | null;
  kind: string;
  title: string;
  body: string | null;
  metadata: Record<string, unknown>;
  read: boolean;
  read_at: string | null;
  created_at: string;
}

export function toNotificationDto(notification: HostNotification): NotificationDto {
  return {
    id: notification.id,
    event_id: notification.eventId,
    event_title: notification.eventTitle,
    activity_id: notification.activityId,
    kind: notification.kind,
    title: notification.title,
    body: notification.body,
    metadata: notification.metadata,
    read: notification.readAt !== null,
    read_at: notification.readAt?.toISOString() ?? null,
    created_at: notification.createdAt.toISOString(),
  };
}
