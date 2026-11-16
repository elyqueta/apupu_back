import { NotFoundError } from '../errors';
import { eventRepository } from '../repositories/event.repository';
import { CreateEventBody } from '../schemas/event.schemas';
import { HostEventsQuery } from '../schemas/host.schemas';
import { EventWithStats, HostTotals } from '../types/event.types';
import { PaginationMeta } from '../types/pagination.types';
import { buildPaginationMeta, toPageParams } from '../utils/pagination.util';
import { CreatedEventResult, eventService } from './event.service';
import { ManageEmailStatus, manageLinkService } from './manageLink.service';

const UPCOMING_LIMIT = 5;

export interface HostEventListResult {
  items: EventWithStats[];
  pagination: PaginationMeta;
}

export interface HostDashboard {
  next_event: EventWithStats | null;
  upcoming: EventWithStats[];
  totals: HostTotals;
}

/**
 * Operações do workspace autenticado.
 *
 * O `hostId` vem sempre da sessão, nunca do pedido. Qualquer leitura
 * ou mutação é limitada por `events.host_id = sessão.host_id`.
 */
export const hostEventService = {
  async list(hostId: string, query: HostEventsQuery): Promise<HostEventListResult> {
    const page = toPageParams(query.page, query.page_size);

    const { items, total } = await eventRepository.listForHost({
      hostId,
      status: query.status,
      q: query.q,
      sort: query.sort,
      order: query.order,
      offset: page.offset,
      limit: page.limit,
    });

    return {
      items,
      pagination: buildPaginationMeta(total, page.page, page.pageSize),
    };
  },

  async dashboard(hostId: string): Promise<HostDashboard> {
    const [nextEvent, upcoming, totals] = await Promise.all([
      eventRepository.nextScheduledForHost(hostId),
      eventRepository.upcomingForHost(hostId, UPCOMING_LIMIT),
      eventRepository.totalsForHost(hostId),
    ]);

    return {
      next_event: nextEvent,
      upcoming,
      totals,
    };
  },

  async create(hostId: string, input: CreateEventBody): Promise<CreatedEventResult> {
    return eventService.create(input, { hostId });
  },

  async remove(hostId: string, eventId: string): Promise<void> {
    const deleted = await eventRepository.deleteForHost(eventId, hostId);

    if (!deleted) {
      throw new NotFoundError('Evento não encontrado.', 'event_not_found');
    }
  },

  /**
   * Reenvia um link de gestão novo para o email do anfitrião.
   *
   * A operação roda o token: o link anterior deixa de ser válido assim
   * que o novo é emitido. Nunca devolve o token em claro.
   */
  async resendManageLink(
    hostId: string,
    eventId: string
  ): Promise<{ eventId: string; status: ManageEmailStatus; expiresAt: Date | null }> {
    const result = await manageLinkService.resendForHost(hostId, eventId);

    return {
      eventId: result.event.id,
      status: result.status,
      expiresAt: result.event.manageTokenExpiresAt,
    };
  },
};
