import { EventActivity, EventActivityWithEvent } from '../types/host.types';

export interface ActivityDto {
  id: string;
  event_id: string;
  kind: string;
  guest_name: string | null;
  at: string;
}

export interface ActivityWithEventDto extends ActivityDto {
  event_title: string;
}

export function toActivityDto(activity: EventActivity): ActivityDto {
  return {
    id: activity.id,
    event_id: activity.eventId,
    kind: activity.kind,
    guest_name: activity.guestName,
    at: activity.at.toISOString(),
  };
}

export function toActivityWithEventDto(activity: EventActivityWithEvent): ActivityWithEventDto {
  return {
    ...toActivityDto(activity),
    event_title: activity.eventTitle,
  };
}
