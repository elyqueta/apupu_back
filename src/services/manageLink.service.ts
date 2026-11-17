import { randomUUID } from 'node:crypto';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { NotFoundError } from '../errors';
import { eventRepository } from '../repositories/event.repository';
import { emailDeliveryRepository } from '../repositories/emailDelivery.repository';
import { Event, EventRecord } from '../types/event.types';
import { encryptToken } from '../utils/crypto.util';
import { generateToken, hashToken } from '../utils/token.util';

/**
 * Gestão do link secreto de um evento.
 *
 * O token em claro só existe no pedido que o gera: `events` guarda
 * apenas o HMAC e a outbox guarda uma cópia cifrada até o worker
 * renderizar o email. Por isso, rotacionar ou reenviar implica sempre
 * gerar um token novo — o anterior deixa de corresponder ao hash
 * guardado.
 */

export interface ManageTokenMaterial {
  token: string;
  hash: string;
  expiresAt: Date;
}

/** `queued` = aceite pela outbox; o envio acontece em segundo plano. */
export type ManageEmailStatus = 'queued' | 'failed';

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
   * Enfileira o link para envio em segundo plano.
   *
   * O token é guardado cifrado na linha da outbox e apagado/ignorado
   * quando a entrega termina. A chave de idempotência é sempre única
   * para rotações/reenvios; repetir a operação gera um token novo e
   * uma chave nova.
   */
  async deliver(
    event: Event,
    token: string,
    idempotencyKey: string
  ): Promise<ManageEmailStatus> {
    try {
      await emailDeliveryRepository.enqueue({
        eventId: event.id,
        invitationId: null,
        hostId: event.hostId,
        messageType: 'manage_link',
        reminderKind: null,
        recipientEmail: event.hostEmail,
        scheduledFor: new Date(),
        idempotencyKey,
        tokenEncrypted: encryptToken(token),
      });

      return 'queued';
    } catch (error) {
      logger.error({ err: error, eventId: event.id }, 'Falha ao enfileirar o link de gestão.');
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
