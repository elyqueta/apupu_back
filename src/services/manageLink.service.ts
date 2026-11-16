import { randomUUID } from 'node:crypto';
import { env } from '../config/env';
import { NotFoundError } from '../errors';
import { eventRepository } from '../repositories/event.repository';
import { emailDeliveryRepository } from '../repositories/emailDelivery.repository';
import { Event, EventRecord } from '../types/event.types';
import { links } from '../utils/links.util';
import { generateToken, hashToken } from '../utils/token.util';
import { sendManageLink } from './email.service';

/**
 * Gestão do link secreto de um evento.
 *
 * O token em claro só existe durante a entrega: a base de dados guarda
 * apenas o HMAC. Por isso, rotacionar ou reenviar implica sempre gerar
 * um token novo — o anterior deixa de corresponder ao hash guardado.
 */

export interface ManageTokenMaterial {
  token: string;
  hash: string;
  expiresAt: Date;
}

export type ManageEmailStatus = 'sent' | 'failed';

/** Validade do link de gestão, em dias, a contar de agora. */
export function manageTokenExpiry(): Date {
  return new Date(Date.now() + env.MANAGE_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export function generateManageToken(): ManageTokenMaterial {
  const token = generateToken();

  return {
    token,
    hash: hashToken(token),
    expiresAt: manageTokenExpiry(),
  };
}

export const manageLinkService = {
  generate: generateManageToken,

  /**
   * Entrega o link por email e registra o resultado na outbox.
   *
   * A chave de idempotência é sempre única para rotações/reenvios;
   * repetir a operação gera um token novo e uma chave nova.
   */
  async deliver(
    event: Event,
    token: string,
    idempotencyKey: string
  ): Promise<ManageEmailStatus> {
    try {
      const { providerMessageId } = await sendManageLink({
        eventId: event.id,
        title: event.title,
        hostName: event.hostName,
        hostEmail: event.hostEmail,
        manageUrl: links.manageEvent(token),
      });

      await emailDeliveryRepository
        .recordDirect({
          eventId: event.id,
          recipientEmail: event.hostEmail,
          messageType: 'manage_link',
          idempotencyKey,
          status: 'sent',
          providerMessageId,
          lastError: null,
        })
        .catch(() => undefined);

      return 'sent';
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido.';

      await emailDeliveryRepository
        .recordDirect({
          eventId: event.id,
          recipientEmail: event.hostEmail,
          messageType: 'manage_link',
          idempotencyKey,
          status: 'failed',
          providerMessageId: null,
          lastError: message.slice(0, 500),
        })
        .catch(() => undefined);

      return 'failed';
    }
  },

  /**
   * Gera um token novo, substitui o anterior na base de dados e
   * envia-o por email.
   *
   * `hostId` limita a operação à conta proprietária (o UUID do evento
   * não é autorização). Devolve `null` quando o evento não existe ou
   * não pertence à conta.
   */
  async rotateAndSend(
    eventId: string,
    options: {
      hostId?: string;
      reason: 'rotate' | 'resend';
    }
  ): Promise<{ event: EventRecord; status: ManageEmailStatus } | null> {
    const material = generateManageToken();

    const event = await eventRepository.rotateManageToken(eventId, {
      hash: material.hash,
      expiresAt: material.expiresAt,
      hostId: options.hostId,
    });

    if (!event) return null;

    const status = await this.deliver(
      event,
      material.token,
      `manage_link:${eventId}:${options.reason}:${randomUUID()}`
    );

    return { event, status };
  },

  /**
   * Reenvia um link novo para um evento da conta autenticada.
   *
   * A resposta é 404 para eventos inexistentes ou de outra conta; a
   * existência do recurso nunca é revelada a quem não o possui.
   */
  async resendForHost(
    hostId: string,
    eventId: string
  ): Promise<{ event: EventRecord; status: ManageEmailStatus }> {
    const result = await this.rotateAndSend(eventId, { hostId, reason: 'resend' });

    if (!result) {
      throw new NotFoundError('Evento não encontrado.', 'event_not_found');
    }

    return result;
  },
};
