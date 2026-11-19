import { invitationRepository } from '../repositories/invitation.repository';
import { HostGuestsQuery } from '../schemas/host.schemas';
import { EventAccessScope } from '../types/event.types';
import { InvitationWithEvent } from '../types/invitation.types';
import { PaginationMeta } from '../types/pagination.types';
import { TeamGuestCandidate } from '../types/team.types';
import { buildPaginationMeta, toPageParams } from '../utils/pagination.util';
import { resolveTeamAccess } from './teamAccess.service';

export interface HostGuestListResult {
  mode: 'guests';
  items: InvitationWithEvent[];
  pagination: PaginationMeta;
}

export interface TeamGuestListResult {
  mode: 'team';
  teamId: string;
  items: TeamGuestCandidate[];
  pagination: PaginationMeta;
}

export type HostGuestResult = HostGuestListResult | TeamGuestListResult;

export const hostGuestService = {
  /**
   * Lista convidados.
   *
   * Com `for_team`, devolve os candidatos a membro dessa equipa: apenas
   * convidados de eventos em que a conta é anfitriã, mais os do evento
   * da equipa, deduplicados por email.
   */
  async list(scope: EventAccessScope, query: HostGuestsQuery): Promise<HostGuestResult> {
    const page = toPageParams(query.page, query.page_size);

    if (query.for_team) {
      const access = await resolveTeamAccess(query.for_team, scope);

      const { items, total } = await invitationRepository.listTeamGuestCandidates({
        hostId: scope.hostId,
        teamId: access.team.id,
        eventId: access.team.eventId,
        q: query.q,
        offset: page.offset,
        limit: page.limit,
      });

      return {
        mode: 'team',
        teamId: access.team.id,
        items,
        pagination: buildPaginationMeta(total, page.page, page.pageSize),
      };
    }

    const { items, total } = await invitationRepository.listForHost({
      hostId: scope.hostId,
      managerEmail: scope.managerEmail,
      eventId: query.event_id,
      rsvpStatus: query.rsvp_status,
      sendStatus: query.send_status,
      q: query.q,
      offset: page.offset,
      limit: page.limit,
    });

    return {
      mode: 'guests',
      items,
      pagination: buildPaginationMeta(total, page.page, page.pageSize),
    };
  },
};
