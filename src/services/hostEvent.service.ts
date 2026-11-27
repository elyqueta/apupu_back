import { ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { communityRepository } from '../repositories/community.repository';
import { communityPermissions } from './communityPermissions';
import { withTransaction } from '../database/pool';
import { emailDeliveryRepository } from '../repositories/emailDelivery.repository';
import { eventRepository } from '../repositories/event.repository';
import { CreateEventBody } from '../schemas/event.schemas';
import { HostEventsQuery } from '../schemas/host.schemas';
import { EventAccessScope, EventWithStats, HostTotals } from '../types/event.types';
import { PaginationMeta } from '../types/pagination.types';
import { buildPaginationMeta, toPageParams } from '../utils/pagination.util';
import { withEffectiveStatus } from '../utils/eventStatus.util';
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
      items: items.map((event) => withEffectiveStatus(event)),
      pagination: buildPaginationMeta(total, page.page, page.pageSize),
    };
  },

  async dashboard(scope: EventAccessScope): Promise<HostDashboard> {
    const [nextEvent, upcoming, totals] = await Promise.all([
      eventRepository.nextScheduledForHost(scope),
      eventRepository.upcomingForHost(scope, UPCOMING_LIMIT),
      eventRepository.totalsForHost(scope),
    ]);

    const effectiveNext = nextEvent ? withEffectiveStatus(nextEvent) : null;
    const effectiveUpcoming = upcoming
      .map((event) => withEffectiveStatus(event))
      .filter((event) => event.status !== 'completed' && event.status !== 'cancelled');

    return {
      next_event: effectiveNext?.status === 'completed' ? null : effectiveNext,
      upcoming: effectiveUpcoming,
      totals,
    };
  },

  async create(hostId: string, input: CreateEventBody): Promise<CreatedEventResult> {
    // Eventos de comunidade passam sempre por sugestão + aprovação.
    if (input.event.community_id) {
      throw new ValidationError(
        'Os eventos da comunidade têm de ser sugeridos e aprovados.',
        { 'event.community_id': ['Use a sugestão de evento da comunidade.'] },
        'community_event_must_be_suggested'
      );
    }
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
      const event = await eventRepository.findById(eventId, client);
      if (!event) {
        throw new NotFoundError('Evento não encontrado.', 'event_not_found');
      }

      const acceptedCount = await eventRepository.countAccepted(eventId, client);

      // Eventos pessoais: só o criador. Eventos de comunidade: gestores e
      // responsável sem confirmados; com confirmados, só o responsável.
      let allowed = event.hostId === hostId;
      if (event.communityId) {
        const member = await communityRepository.findMemberByHost(event.communityId, hostId, client);
        const actor = {
          role: member?.role ?? null,
          status: member?.status ?? null,
          isHostAccount: member?.hasHostAccount ?? false,
        };
        allowed = communityPermissions.canDeleteEvent(actor, acceptedCount) ||
          (event.hostId === hostId && acceptedCount === 0);
        if (!allowed && member?.status === 'active') {
          throw new ForbiddenError(
            'Só o responsável da comunidade apaga eventos com confirmados.',
            'community_forbidden'
          );
        }
      }
      if (!allowed) {
        throw new NotFoundError('Evento não encontrado.', 'event_not_found');
      }

      if (acceptedCount > 0 && (confirmName ?? '').trim() !== event.title.trim()) {
        throw new ValidationError(
          'Escreva o nome do evento para confirmar.',
          { confirm_name: ['Escreva o nome do evento para confirmar.'] },
          'event_delete_confirmation_required'
        );
      }

      const deleted = await eventRepository.softDelete(eventId, client);

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
