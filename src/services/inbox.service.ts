import { logger } from '../config/logger';
import { NotFoundError } from '../errors';
import { withTransaction } from '../database/pool';
import { eventRepository } from '../repositories/event.repository';
import { invitationRepository } from '../repositories/invitation.repository';
import { InboxQuery } from '../schemas/inbox.schemas';
import { EventAccessScope } from '../types/event.types';
import { Invitation, InvitationWithEvent } from '../types/invitation.types';
import { PaginationMeta } from '../types/pagination.types';
import { buildPaginationMeta, toPageParams } from '../utils/pagination.util';
import { enqueueInvitationReply } from './reminder.service';

/**
 * Caixa de entrada de mensagens de convidados.
 *
 * A resposta do anfitrião fica guardada no convite e é devolvida no DTO
 * público; quando há email, o convidado também é notificado. A outbox é
 * escrita na mesma transação da resposta: se a fila falhar, a resposta
 * continua visível no convite.
 */
export const inboxService = {
  async list(
    scope: EventAccessScope,
    query: InboxQuery
  ): Promise<{ items: InvitationWithEvent[]; pagination: PaginationMeta }> {
    const page = toPageParams(query.page, query.page_size);
    const result = await invitationRepository.listInbox({
      hostId: scope.hostId,
      managerEmail: scope.managerEmail,
      eventId: query.event_id,
      q: query.q,
      read: query.read,
      answered: query.answered,
      from: query.from,
      to: query.to,
      ...page,
    });

    return {
      items: result.items,
      pagination: buildPaginationMeta(result.total, page.page, page.pageSize),
    };
  },

  async findForHost(scope: EventAccessScope, invitationId: string): Promise<Invitation> {
    const invitation = await invitationRepository.findById(invitationId);
    if (!invitation || !(await belongsToScope(invitation.eventId, scope))) {
      throw new NotFoundError('Mensagem não encontrada.', 'message_not_found');
    }
    return invitation;
  },

  async setRead(
    scope: EventAccessScope,
    invitationId: string,
    read: boolean
  ): Promise<Invitation | null> {
    await this.findForHost(scope, invitationId);
    return invitationRepository.setMessageRead(invitationId, read);
  },

  async answer(
    scope: EventAccessScope,
    invitationId: string,
    answer: string
  ): Promise<Invitation> {
    const invitation = await this.findForHost(scope, invitationId);

    return withTransaction(async (client) => {
      const updated = await invitationRepository.setMessageAnswer(
        invitationId,
        answer,
        client
      );
      if (!updated) {
        throw new NotFoundError('Mensagem não encontrada.', 'message_not_found');
      }

      // Best-effort: se o email não estiver disponível, a resposta já
      // ficou guardada e visível no convite público.
      try {
        await enqueueInvitationReply(invitation, answer, client);
      } catch (error) {
        logger.warn({ err: error, invitationId }, 'Falha ao enfileirar resposta por email.');
      }

      return updated;
    });
  },
};

async function belongsToScope(
  eventId: string,
  scope: EventAccessScope
): Promise<boolean> {
  const event = await eventRepository.findByIdForAccess(eventId, scope);
  return event !== null;
}
