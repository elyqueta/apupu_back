import { NotFoundError, ValidationError } from '../errors';
import { withTransaction } from '../database/pool';
import { emailDeliveryRepository } from '../repositories/emailDelivery.repository';
import { eventRepository } from '../repositories/event.repository';
import { CreateEventBody } from '../schemas/event.schemas';
import { HostEventsQuery } from '../schemas/host.schemas';
import { EventAccessScope, EventWithStats, HostTotals } from '../types/event.types';
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
 * O `hostId` vem sempre da sessão, nunca do pedido. As leituras
 * incluem os eventos próprios e aqueles em que a conta é gestora
 * activa; as mutações estruturais continuam limitadas ao proprietário.
 */
export const hostEventService = {
  async list(scope: EventAccessScope, query: HostEventsQuery): Promise<HostEventListResult> {
    const page = toPageParams(query.page, query.page_size);

    const { items, total } = await eventRepository.listForHost({
      hostId: scope.hostId,
      managerEmail: scope.managerEmail,
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

  async dashboard(scope: EventAccessScope): Promise<HostDashboard> {
    const [nextEvent, upcoming, totals] = await Promise.all([
      eventRepository.nextScheduledForHost(scope),
      eventRepository.upcomingForHost(scope, UPCOMING_LIMIT),
      eventRepository.totalsForHost(scope),
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

  /**
   * Remoção lógica pelo proprietário. Com convidados confirmados exige
   * `confirmName` igual ao título (exacto, após trim). Gestores e outras
   * contas recebem o mesmo 404 de um evento inexistente.
   */
  async remove(
    hostId: string,
    eventId: string,
    confirmName?: string
  ): Promise<{ acceptedCount: number }> {
    return withTransaction(async (client) => {
      const event = await eventRepository.findByIdForHost(eventId, hostId, client);

      if (!event) {
        throw new NotFoundError('Evento não encontrado.', 'event_not_found');
      }

      const acceptedCount = await eventRepository.countAccepted(eventId, client);

      if (acceptedCount > 0 && (confirmName ?? '').trim() !== event.title.trim()) {
        throw new ValidationError(
          'Escreva o nome do evento para confirmar.',
          { confirm_name: ['Escreva o nome do evento para confirmar.'] },
          'event_delete_confirmation_required'
        );
      }

      const deleted = await eventRepository.softDeleteForHost(eventId, hostId, client);

      if (!deleted) {
        throw new NotFoundError('Evento não encontrado.', 'event_not_found');
      }

      await emailDeliveryRepository.cancelPendingForEvent(eventId, client);

      return { acceptedCount };
    });
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
