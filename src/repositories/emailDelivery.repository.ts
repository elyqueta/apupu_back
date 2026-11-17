import { PoolClient } from 'pg';
import { pool, query } from '../database/pool';
import { EmailDelivery, MessageType } from '../types/emailDelivery.types';

interface DeliveryRow {
  id: string;
  event_id: string | null;
  invitation_id: string | null;
  host_id: string | null;
  message_type: MessageType;
  reminder_kind: string | null;
  recipient_email: string;
  scheduled_for: Date;
  status: EmailDelivery['status'];
  attempts: number;
  next_attempt_at: Date | null;
  provider_message_id: string | null;
  last_error: string | null;
  idempotency_key: string;
  token_encrypted: string | null;
  sent_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function toDelivery(row: DeliveryRow): EmailDelivery {
  return {
    id: row.id,
    eventId: row.event_id,
    invitationId: row.invitation_id,
    hostId: row.host_id,
    messageType: row.message_type,
    reminderKind: row.reminder_kind,
    recipientEmail: row.recipient_email,
    scheduledFor: row.scheduled_for,
    status: row.status,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    providerMessageId: row.provider_message_id,
    lastError: row.last_error,
    idempotencyKey: row.idempotency_key,
    tokenEncrypted: row.token_encrypted,
    sentAt: row.sent_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_COLUMNS = `
  id, event_id, invitation_id, host_id, message_type, reminder_kind, recipient_email,
  scheduled_for, status, attempts, next_attempt_at, provider_message_id,
  last_error, idempotency_key, token_encrypted, sent_at, created_at, updated_at
`;

const CONTEXT_COLUMNS = `
  d.*,
  e.title                       AS event_title,
  e.status                      AS event_status,
  e.starts_at                   AS event_starts_at,
  e.ends_at                     AS event_ends_at,
  e.timezone                    AS event_timezone,
  e.location_type               AS event_location_type,
  e.location_name               AS event_location_name,
  e.location_address            AS event_location_address,
  e.online_url                  AS event_online_url,
  e.dress_code                  AS event_dress_code,
  e.rsvp_deadline               AS event_rsvp_deadline,
  e.contribution_enabled        AS event_contribution_enabled,
  e.host_name,
  e.host_email,
  i.guest_name,
  i.guest_email,
  i.token_encrypted             AS invitation_token_encrypted,
  i.rsvp_status,
  i.claim_revoked_at
`;

export interface InsertDeliveryData {
  eventId: string | null;
  invitationId: string | null;
  hostId?: string | null;
  messageType: MessageType;
  reminderKind: string | null;
  recipientEmail: string;
  scheduledFor: Date;
  idempotencyKey: string;
  /** Token cifrado para mensagens de conta. Nunca em claro. */
  tokenEncrypted?: string | null;
}

/**
 * Contexto necessário para renderizar uma mensagem.
 *
 * Não inclui o token em claro: o convite guarda-o cifrado
 * (`token_encrypted`) e a desencriptação acontece apenas no momento de
 * renderizar, dentro do worker.
 */
export interface DeliveryContext extends EmailDelivery {
  eventTitle: string | null;
  eventStatus: string | null;
  eventStartsAt: Date | null;
  eventEndsAt: Date | null;
  eventTimezone: string | null;
  eventLocationType: string | null;
  eventLocationName: string | null;
  eventLocationAddress: string | null;
  eventOnlineUrl: string | null;
  eventDressCode: string | null;
  eventRsvpDeadline: Date | null;
  eventContributionEnabled: boolean | null;
  hostName: string | null;
  hostEmail: string | null;
  guestName: string | null;
  guestEmail: string | null;
  invitationTokenEncrypted: string | null;
  rsvpStatus: string | null;
  claimRevokedAt: Date | null;
}

interface DeliveryContextRow extends DeliveryRow {
  event_title: string | null;
  event_status: string | null;
  event_starts_at: Date | null;
  event_ends_at: Date | null;
  event_timezone: string | null;
  event_location_type: string | null;
  event_location_name: string | null;
  event_location_address: string | null;
  event_online_url: string | null;
  event_dress_code: string | null;
  event_rsvp_deadline: Date | null;
  event_contribution_enabled: boolean | null;
  host_name: string | null;
  host_email: string | null;
  guest_name: string | null;
  guest_email: string | null;
  invitation_token_encrypted: string | null;
  rsvp_status: string | null;
  claim_revoked_at: Date | null;
}

function toContext(row: DeliveryContextRow): DeliveryContext {
  return {
    ...toDelivery(row),
    eventTitle: row.event_title,
    eventStatus: row.event_status,
    eventStartsAt: row.event_starts_at,
    eventEndsAt: row.event_ends_at,
    eventTimezone: row.event_timezone,
    eventLocationType: row.event_location_type,
    eventLocationName: row.event_location_name,
    eventLocationAddress: row.event_location_address,
    eventOnlineUrl: row.event_online_url,
    eventDressCode: row.event_dress_code,
    eventRsvpDeadline: row.event_rsvp_deadline,
    eventContributionEnabled: row.event_contribution_enabled,
    hostName: row.host_name,
    hostEmail: row.host_email,
    guestName: row.guest_name,
    guestEmail: row.guest_email,
    invitationTokenEncrypted: row.invitation_token_encrypted,
    rsvpStatus: row.rsvp_status,
    claimRevokedAt: row.claim_revoked_at,
  };
}

export const emailDeliveryRepository = {
  /**
   * Enfileira uma entrega. A chave idempotente única garante que
   * repetir a operação de negócio não cria um segundo email.
   */
  async enqueue(data: InsertDeliveryData, client?: PoolClient): Promise<EmailDelivery | null> {
    const runner = client ?? pool;
    const result = await runner.query<DeliveryRow>(
      `INSERT INTO email_deliveries (
         event_id, invitation_id, host_id, message_type, reminder_kind,
         recipient_email, scheduled_for, idempotency_key, token_encrypted
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING ${SELECT_COLUMNS}`,
      [
        data.eventId,
        data.invitationId,
        data.hostId ?? null,
        data.messageType,
        data.reminderKind,
        data.recipientEmail,
        data.scheduledFor,
        data.idempotencyKey,
        data.tokenEncrypted ?? null,
      ]
    );

    const row = result.rows[0];

    if (!row) {
      return null;
    }

    // Acorda o worker assim que a transacção fizer commit. O polling
    // continua como fallback, mas emails imediatos (OTP, convites) não
    // esperam pelo próximo ciclo.
    await runner.query('SELECT pg_notify($1, $2)', ['outbox_new', data.messageType]);

    return toDelivery(row);
  },

  /**
   * Reserva um lote de entregas vencidas.
   *
   * `FOR UPDATE SKIP LOCKED` permite várias instâncias a correr o
   * worker em paralelo sem enviarem o mesmo email. O estado passa a
   * `processing` e `attempts` é incrementado antes do envio. A
   * transacção termina antes do envio: se o processo cair, a
   * recuperação de `processing` antigos devolve a linha a `pending`.
   */
  async claimDue(limit: number, client: PoolClient): Promise<DeliveryContext[]> {
    const result = await client.query<DeliveryContextRow>(
      `WITH due AS (
         SELECT id
           FROM email_deliveries
          WHERE status = 'pending'
            AND scheduled_for <= now()
            AND (next_attempt_at IS NULL OR next_attempt_at <= now())
          ORDER BY scheduled_for ASC
          LIMIT $1
          FOR UPDATE SKIP LOCKED
       )
       UPDATE email_deliveries d
          SET status = 'processing',
              attempts = d.attempts + 1,
              updated_at = now()
         FROM due
        WHERE d.id = due.id
        RETURNING d.*`,
      [limit]
    );

    if (result.rows.length === 0) return [];

    const ids = result.rows.map((row) => row.id);
    const context = await client.query<DeliveryContextRow>(
      `SELECT ${CONTEXT_COLUMNS}
         FROM email_deliveries d
         LEFT JOIN events e ON e.id = d.event_id
         LEFT JOIN invitations i ON i.id = d.invitation_id
        WHERE d.id = ANY($1::uuid[])`,
      [ids]
    );

    return context.rows.map(toContext);
  },

  /** Recarrega o contexto imediatamente antes do envio. */
  async findContextById(id: string): Promise<DeliveryContext | null> {
    const result = await query<DeliveryContextRow>(
      `SELECT ${CONTEXT_COLUMNS}
         FROM email_deliveries d
         LEFT JOIN events e ON e.id = d.event_id
         LEFT JOIN invitations i ON i.id = d.invitation_id
        WHERE d.id = $1`,
      [id]
    );

    const row = result.rows[0];
    return row ? toContext(row) : null;
  },

  /**
   * Devolve entregas presas em `processing` há mais de `minutes`
   * minutos (processo morto a meio do envio) para `pending`.
   */
  async recoverStaleProcessing(minutes = 10): Promise<number> {
    const result = await query(
      `UPDATE email_deliveries
          SET status = 'pending', next_attempt_at = now(), updated_at = now()
        WHERE status = 'processing'
          AND updated_at < now() - make_interval(mins => $1)`,
      [minutes]
    );
    return result.rowCount ?? 0;
  },

  async markSent(id: string, providerMessageId: string | null, client?: PoolClient): Promise<void> {
    const runner = client ?? pool;
    await runner.query(
      `UPDATE email_deliveries
          SET status = 'sent', sent_at = now(), provider_message_id = $2,
              next_attempt_at = NULL, last_error = NULL, updated_at = now()
        WHERE id = $1`,
      [id, providerMessageId]
    );
  },

  async markFailed(
    id: string,
    error: string,
    nextAttemptAt: Date | null,
    client?: PoolClient
  ): Promise<void> {
    const runner = client ?? pool;
    await runner.query(
      `UPDATE email_deliveries
          SET status = CASE WHEN $3::timestamptz IS NULL THEN 'failed' ELSE 'pending' END,
              last_error = $2,
              next_attempt_at = $3,
              updated_at = now()
        WHERE id = $1`,
      [id, error.slice(0, 500), nextAttemptAt]
    );
  },

  async markCancelled(id: string, reason: string | null = null, client?: PoolClient): Promise<void> {
    const runner = client ?? pool;
    await runner.query(
      `UPDATE email_deliveries
          SET status = 'cancelled', last_error = COALESCE($2, last_error), updated_at = now()
        WHERE id = $1 AND status IN ('pending', 'processing')`,
      [id, reason]
    );
  },

  /** Cancela entregas futuras de um convite (ex.: após recusa). */
  async cancelPendingForInvitation(
    invitationId: string,
    messageTypes: MessageType[],
    client?: PoolClient
  ): Promise<number> {
    const runner = client ?? pool;
    const result = await runner.query(
      `UPDATE email_deliveries
          SET status = 'cancelled', updated_at = now()
        WHERE invitation_id = $1
          AND status = 'pending'
          AND message_type = ANY($2::text[])`,
      [invitationId, messageTypes]
    );
    return result.rowCount ?? 0;
  },

  /** Cancela todas as entregas futuras de um evento (ex.: cancelamento). */
  async cancelPendingForEvent(eventId: string, client?: PoolClient): Promise<number> {
    const runner = client ?? pool;
    const result = await runner.query(
      `UPDATE email_deliveries
          SET status = 'cancelled', updated_at = now()
        WHERE event_id = $1 AND status IN ('pending', 'processing')`,
      [eventId]
    );
    return result.rowCount ?? 0;
  },

  /** Cancela apenas alguns tipos de mensagem de um evento. */
  async cancelPendingForEventTypes(
    eventId: string,
    messageTypes: MessageType[],
    client?: PoolClient
  ): Promise<number> {
    const runner = client ?? pool;
    const result = await runner.query(
      `UPDATE email_deliveries
          SET status = 'cancelled', updated_at = now()
        WHERE event_id = $1
          AND status = 'pending'
          AND message_type = ANY($2::text[])`,
      [eventId, messageTypes]
    );
    return result.rowCount ?? 0;
  },

  /** Atualiza o destinatário de entregas ainda pendentes de um convite. */
  async updatePendingRecipient(
    invitationId: string,
    recipientEmail: string,
    client?: PoolClient
  ): Promise<void> {
    const runner = client ?? pool;
    await runner.query(
      `UPDATE email_deliveries
          SET recipient_email = $2, updated_at = now()
        WHERE invitation_id = $1 AND status = 'pending'`,
      [invitationId, recipientEmail]
    );
  },

  async findById(id: string, client?: PoolClient): Promise<EmailDelivery | null> {
    const runner = client ?? pool;
    const result = await runner.query<DeliveryRow>(
      `SELECT ${SELECT_COLUMNS} FROM email_deliveries WHERE id = $1`,
      [id]
    );
    const row = result.rows[0];
    return row ? toDelivery(row) : null;
  },

  async listByEvent(eventId: string): Promise<EmailDelivery[]> {
    const result = await query<DeliveryRow>(
      `SELECT ${SELECT_COLUMNS}
         FROM email_deliveries
        WHERE event_id = $1
        ORDER BY created_at DESC`,
      [eventId]
    );
    return result.rows.map(toDelivery);
  },
};
