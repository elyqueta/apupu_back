import { invitationRepository } from '../repositories/invitation.repository';
import { HostGuestsQuery } from '../schemas/host.schemas';
import { InvitationWithEvent } from '../types/invitation.types';
import { PaginationMeta } from '../types/pagination.types';
import { buildPaginationMeta, toPageParams } from '../utils/pagination.util';

export interface HostGuestListResult {
  items: InvitationWithEvent[];
  pagination: PaginationMeta;
}

export const hostGuestService = {
  async list(hostId: string, query: HostGuestsQuery): Promise<HostGuestListResult> {
    const page = toPageParams(query.page, query.page_size);

    const { items, total } = await invitationRepository.listForHost({
      hostId,
      eventId: query.event_id,
      rsvpStatus: query.rsvp_status,
      sendStatus: query.send_status,
      q: query.q,
      offset: page.offset,
      limit: page.limit,
    });

    return {
      items,
      pagination: buildPaginationMeta(total, page.page, page.pageSize),
    };
  },
};
