import { NotFoundError } from '../errors';
import { activityRepository } from '../repositories/activity.repository';
import { eventRepository } from '../repositories/event.repository';
import { EventActivity, EventActivityWithEvent } from '../types/host.types';
import { PaginationMeta } from '../types/pagination.types';
import { buildPaginationMeta, toPageParams } from '../utils/pagination.util';

export interface ActivityListResult<T> {
  items: T[];
  pagination: PaginationMeta;
}

export const activityService = {
  async listForHost(
    hostId: string,
    pageNumber: number,
    pageSize: number
  ): Promise<ActivityListResult<EventActivityWithEvent>> {
    const page = toPageParams(pageNumber, pageSize);
    const { items, total } = await activityRepository.listForHost(
      hostId,
      page.offset,
      page.limit
    );

    return {
      items,
      pagination: buildPaginationMeta(total, page.page, page.pageSize),
    };
  },

  async listForEvent(
    hostId: string,
    eventId: string,
    pageNumber: number,
    pageSize: number
  ): Promise<ActivityListResult<EventActivity>> {
    const event = await eventRepository.findByIdForHost(eventId, hostId);

    if (!event) {
      throw new NotFoundError('Evento não encontrado.', 'event_not_found');
    }

    const page = toPageParams(pageNumber, pageSize);
    const { items, total } = await activityRepository.listForEvent(
      eventId,
      page.offset,
      page.limit
    );

    return {
      items,
      pagination: buildPaginationMeta(total, page.page, page.pageSize),
    };
  },
};
