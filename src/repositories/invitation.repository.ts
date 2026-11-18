import { PoolClient } from 'pg';
import { pool, query } from '../database/pool';
import { EventCategory, EventLocation, EventStatus } from '../types/event.types';
import {
  AccountInvitation,
  Invitation,
  InvitationWithEvent,
  RsvpStatus,
  SendStatus,
  UpdateInvitationInput,
} from '../types/invitation.types';

interface InvitationRow {
  id: string;
  event_id: string;
  guest_name: string;
  guest_email: string;
  guest_phone: string | null;
  table_name: string | null;
  token_hash: string;
  token_encrypted: string;
  claim_hash: string | null;
  claimed_at: Date | null;
  claim_revoked_at: Date | null;
  rsvp_status: RsvpStatus;
  rsvp_responded_at: Date | null;
  rsvp_version: number;
  send_status: SendStatus;
  send_count: number;
  last_sent_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function toInvitation(row: InvitationRow): Invitation {
  return {
    id: row.id,
    eventId: row.event_id,
    guestName: row.guest_name,
    guestEmail: row.guest_email,
    guestPhone: row.guest_phone,
    tableName: row.table_name,
    tokenHash: row.token_hash,
    tokenEncrypted: row.token_encrypted,
    claimHash: row.claim_hash,
    claimedAt: row.claimed_at,
    claimRevokedAt: row.claim_revoked_at,
    rsvpStatus: row.rsvp_status,
    rsvpRespondedAt: row.rsvp_responded_at,
    rsvpVersion: row.rsvp_version,
    sendStatus: row.send_status,
    sendCount: row.send_count,
    lastSentAt: row.last_sent_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_COLUMNS = `
  id, event_id, guest_name, guest_email, guest_phone, table_name,
  token_hash, token_encrypted, claim_hash, claimed_at, claim_revoked_at,
  rsvp_status, rsvp_responded_at, rsvp_version,
  send_status, send_count, last_sent_at, created_at, updated_at
`;

interface InvitationWithEventRow extends InvitationRow {
  event_title: string;
  event_starts_at: Date;
  event_status: string;
}

function toInvitationWithEvent(row: InvitationWithEventRow): InvitationWithEvent {
  return {
    ...toInvitation(row),
    eventTitle: row.event_title,
    eventStartsAt: row.event_starts_at,
    eventStatus: row.event_status,
  };
}

interface AccountInvitationRow extends InvitationRow {
  event_title: string;
  event_host_name: string;
  event_starts_at: Date;
  event_timezone: string;
  event_status: EventStatus;
  event_category: EventCategory | null;
  event_template_id: string | null;
  event_cover_url: string | null;
  event_location_type: 'venue' | 'online';
  event_location_name: string | null;
  event_location_address: string | null;
  event_online_url: string | null;
}

function toAccountInvitation(row: AccountInvitationRow): AccountInvitation {
  const eventLocation: EventLocation = {
    type: row.event_location_type,
    name: row.event_location_name,
    address: row.event_location_address,
    onlineUrl: row.event_online_url,
  };

  return {
    ...toInvitation(row),
    eventTitle: row.event_title,
    eventHostName: row.event_host_name,
    eventStartsAt: row.event_starts_at,
    eventTimezone: row.event_timezone,
    eventStatus: row.event_status,
    eventCategory: row.event_category,
    eventTemplateId: row.event_template_id,
    eventCoverUrl: row.event_cover_url,
    eventLocation,
  };
}

export interface InsertInvitationData {
  eventId: string;
  guestName: string;
  guestEmail: string;
  guestPhone: string | null;
  tableName: string | null;
  tokenHash: string;
  tokenEncrypted: string;
}

export interface HostGuestListFilters {
  hostId: string;
  /** Email verificado da conta, para incluir eventos geridos. */
  managerEmail: string | null;
  eventId?: string;
  rsvpStatus?: RsvpStatus;
  sendStatus?: SendStatus;
  q?: string;
  offset: number;
  limit: number;
}

/**
 * Filtros de "Meus convites".
 *
 * `email` vem sempre da sessão, nunca do pedido. A comparação é
 * case-insensitive porque `hosts.email` é `citext` e `guest_email` é
 * `text`.
 */
export interface AccountInvitationListFilters {
  email: string;
  sort: 'starts_at';
  order: 'asc' | 'desc';
  offset: number;
  limit: number;
}

export const invitationRepository = {
  async create(data: InsertInvitationData, client?: PoolClient): Promise<Invitation> {
    const runner = client ?? pool;
    const result = await runner.query<InvitationRow>(
      `INSERT INTO invitations (
         event_id, guest_name, guest_email, guest_phone, table_name,
         token_hash, token_encrypted
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING ${SELECT_COLUMNS}`,
      [
        data.eventId,
        data.guestName,
        data.guestEmail,
        data.guestPhone,
        data.tableName,
        data.tokenHash,
        data.tokenEncrypted,
      ]
    );

    const row = result.rows[0];
    if (!row) throw new Error('Falha ao criar convite: nenhuma linha devolvida.');
    return toInvitation(row);
  },

  async findById(id: string, client?: PoolClient): Promise<Invitation | null> {
    const runner = client ?? pool;
    const result = await runner.query<InvitationRow>(
      `SELECT ${SELECT_COLUMNS} FROM invitations WHERE id = $1`,
      [id]
    );
    const row = result.rows[0];
    return row ? toInvitation(row) : null;
  },

  /** Lê com lock de linha, para decisões transacionais (claim/RSVP). */
  async findByIdForUpdate(id: string, client: PoolClient): Promise<Invitation | null> {
    const result = await client.query<InvitationRow>(
      `SELECT ${SELECT_COLUMNS} FROM invitations WHERE id = $1 FOR UPDATE`,
      [id]
    );
    const row = result.rows[0];
    return row ? toInvitation(row) : null;
  },

  async findByTokenHash(hash: string, client?: PoolClient): Promise<Invitation | null> {
    const runner = client ?? pool;
    const result = await runner.query<InvitationRow>(
      `SELECT ${SELECT_COLUMNS} FROM invitations WHERE token_hash = $1`,
      [hash]
    );
    const row = result.rows[0];
    return row ? toInvitation(row) : null;
  },

  /**
   * Procura o convite de um email num evento.
   *
   * A comparação é case-insensitive porque o email do convidado é
   * guardado normalizado, mas registos antigos podem ter maiúsculas.
   * Usado para garantir que um gestor não duplica o convite ao ser
   * automaticamente incluído na lista de convidados.
   */
  async findByEventAndEmail(
    eventId: string,
    email: string,
    client?: PoolClient
  ): Promise<Invitation | null> {
    const runner = client ?? pool;
    const result = await runner.query<InvitationRow>(
      `SELECT ${SELECT_COLUMNS}
         FROM invitations
        WHERE event_id = $1
          AND lower(guest_email) = lower($2)
        ORDER BY created_at ASC, id ASC
        LIMIT 1`,
      [eventId, email]
    );
    const row = result.rows[0];
    return row ? toInvitation(row) : null;
  },

  async listByEvent(eventId: string, client?: PoolClient): Promise<Invitation[]> {
    const runner = client ?? pool;
    const result = await runner.query<InvitationRow>(
      `SELECT ${SELECT_COLUMNS}
         FROM invitations
        WHERE event_id = $1
        ORDER BY created_at ASC, id ASC`,
      [eventId]
    );
    return result.rows.map(toInvitation);
  },

  /** Lista paginada dos convidados de um evento. */
  async listByEventPage(
    eventId: string,
    offset: number,
    limit: number,
    client?: PoolClient
  ): Promise<{ items: Invitation[]; total: number }> {
    const runner = client ?? pool;
    const countResult = await runner.query<{ total: string }>(
      'SELECT count(*)::text AS total FROM invitations WHERE event_id = $1',
      [eventId]
    );
    const result = await runner.query<InvitationRow>(
      `SELECT ${SELECT_COLUMNS}
         FROM invitations
        WHERE event_id = $1
        ORDER BY created_at ASC, id ASC
        LIMIT $2 OFFSET $3`,
      [eventId, limit, offset]
    );

    return {
      items: result.rows.map(toInvitation),
      total: Number(countResult.rows[0]?.total ?? '0'),
    };
  },

  /**
   * Lista global de convidados de uma conta, com filtros e o resumo do
   * evento a que pertencem.
   *
   * Inclui eventos próprios e eventos em que a conta é gestora activa.
   */
  async listForHost(
    filters: HostGuestListFilters
  ): Promise<{ items: InvitationWithEvent[]; total: number }> {
    const values: unknown[] = [filters.hostId];
    let conditions = ['e.host_id = $1'];

    if (filters.managerEmail) {
      values.push(filters.managerEmail);
      conditions = [
        `(e.host_id = $1 OR EXISTS (
           SELECT 1
             FROM event_managers m
            WHERE m.event_id = e.id
              AND m.email = $2::citext
              AND m.revoked_at IS NULL
         ))`,
      ];
    }

    if (filters.eventId) {
      values.push(filters.eventId);
      conditions.push(`i.event_id = $${values.length}`);
    }
    if (filters.rsvpStatus) {
      values.push(filters.rsvpStatus);
      conditions.push(`i.rsvp_status = $${values.length}`);
    }
    if (filters.sendStatus) {
      values.push(filters.sendStatus);
      conditions.push(`i.send_status = $${values.length}`);
    }
    if (filters.q) {
      values.push(`%${filters.q}%`);
      conditions.push(
        `(i.guest_name ILIKE $${values.length} OR i.guest_email ILIKE $${values.length})`
      );
    }

    const where = conditions.join(' AND ');
    const countResult = await query<{ total: string }>(
      `SELECT count(*)::text AS total
         FROM invitations i
         JOIN events e ON e.id = i.event_id
        WHERE ${where}`,
      values
    );

    const listValues = [...values, filters.limit, filters.offset];
    const result = await query<InvitationWithEventRow>(
      `SELECT ${SELECT_COLUMNS.split(',').map((column) => `i.${column.trim()}`).join(', ')},
              e.title AS event_title,
              e.starts_at AS event_starts_at,
              e.status AS event_status
         FROM invitations i
         JOIN events e ON e.id = i.event_id
        WHERE ${where}
        ORDER BY i.created_at DESC, i.id DESC
        LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
      listValues
    );

    return {
      items: result.rows.map(toInvitationWithEvent),
      total: Number(countResult.rows[0]?.total ?? '0'),
    };
  },

  /**
   * Lista paginada dos convites dirigidos ao email de uma conta.
   *
   * Regras de "Meus convites":
   * - associação por `guest_email` (case-insensitive) ao email da
   *   conta autenticada — opção A, sem migração;
   * - convites revogados não aparecem;
   * - `ORDER BY starts_at` com `NULLS LAST` para que eventos sem data
   *   fiquem no fim (hoje `starts_at` é obrigatório, mas o contrato
   *   fica robusto a eventos legados);
   * - apenas o resumo público do evento acompanha o convite.
   */
  async listForAccountEmail(
    filters: AccountInvitationListFilters
  ): Promise<{ items: AccountInvitation[]; total: number }> {
    const where = 'lower(i.guest_email) = lower($1) AND i.claim_revoked_at IS NULL';
    const values: unknown[] = [filters.email];
    const direction = filters.order === 'asc' ? 'ASC' : 'DESC';

    const countResult = await query<{ total: string }>(
      `SELECT count(*)::text AS total
         FROM invitations i
         JOIN events e ON e.id = i.event_id
        WHERE ${where}`,
      values
    );

    const listValues = [...values, filters.limit, filters.offset];
    const result = await query<AccountInvitationRow>(
      `SELECT ${SELECT_COLUMNS.split(',').map((column) => `i.${column.trim()}`).join(', ')},
              e.title AS event_title,
              e.host_name AS event_host_name,
              e.starts_at AS event_starts_at,
              e.timezone AS event_timezone,
              e.status AS event_status,
              e.category AS event_category,
              e.template_id AS event_template_id,
              e.cover_url AS event_cover_url,
              e.location_type AS event_location_type,
              e.location_name AS event_location_name,
              e.location_address AS event_location_address,
              e.online_url AS event_online_url
         FROM invitations i
         JOIN events e ON e.id = i.event_id
        WHERE ${where}
        ORDER BY e.${filters.sort} ${direction} NULLS LAST, i.id ${direction}
        LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
      listValues
    );

    return {
      items: result.rows.map(toAccountInvitation),
      total: Number(countResult.rows[0]?.total ?? '0'),
    };
  },

  async countByEvent(eventId: string, client?: PoolClient): Promise<number> {
    const runner = client ?? pool;
    const result = await runner.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM invitations WHERE event_id = $1',
      [eventId]
    );
    return Number(result.rows[0]?.count ?? '0');
  },

  /**
   * Claim atómico do primeiro navegador.
   *
   * `WHERE claim_hash IS NULL` garante que dois navegadores
   * simultâneos não conseguem ambos reclamar. Devolve `null` se já
   * estava reclamado.
   */
  async claim(
    id: string,
    claimHash: string,
    client?: PoolClient
  ): Promise<Invitation | null> {
    const runner = client ?? pool;
    const result = await runner.query<InvitationRow>(
      `UPDATE invitations
          SET claim_hash = $2, claimed_at = now(), updated_at = now()
        WHERE id = $1 AND claim_hash IS NULL AND claim_revoked_at IS NULL
        RETURNING ${SELECT_COLUMNS}`,
      [id, claimHash]
    );

    const row = result.rows[0];
    return row ? toInvitation(row) : null;
  },

  async update(
    id: string,
    changes: UpdateInvitationInput,
    client?: PoolClient
  ): Promise<Invitation | null> {
    const runner = client ?? pool;
    const set: string[] = [];
    const values: unknown[] = [];

    if ('guestName' in changes) {
      values.push(changes.guestName);
      set.push(`guest_name = $${values.length}`);
    }
    if ('guestEmail' in changes) {
      values.push(changes.guestEmail);
      set.push(`guest_email = $${values.length}`);
    }
    if ('guestPhone' in changes) {
      values.push(changes.guestPhone);
      set.push(`guest_phone = $${values.length}`);
    }
    if ('tableName' in changes) {
      values.push(changes.tableName);
      set.push(`table_name = $${values.length}`);
    }
    if ('tokenHash' in changes) {
      values.push(changes.tokenHash);
      set.push(`token_hash = $${values.length}`);
    }
    if ('tokenEncrypted' in changes) {
      values.push(changes.tokenEncrypted);
      set.push(`token_encrypted = $${values.length}`);
    }
    if (changes.resetClaim) {
      set.push('claim_hash = NULL', 'claimed_at = NULL', 'claim_revoked_at = NULL');
    }

    if (set.length === 0) return this.findById(id, client);

    values.push(id);
    const result = await runner.query<InvitationRow>(
      `UPDATE invitations
          SET ${set.join(', ')}, updated_at = now()
        WHERE id = $${values.length}
        RETURNING ${SELECT_COLUMNS}`,
      values
    );

    const row = result.rows[0];
    return row ? toInvitation(row) : null;
  },

  /**
   * Atualiza o RSVP e incrementa a versão apenas quando o estado
   * muda. Repetir o mesmo pedido não altera a versão — é isso que
   * torna a notificação de recusa idempotente.
   */
  async respond(
    id: string,
    status: Exclude<RsvpStatus, 'pending'>,
    client?: PoolClient
  ): Promise<Invitation | null> {
    const runner = client ?? pool;
    const result = await runner.query<InvitationRow>(
      `UPDATE invitations
          SET rsvp_status = $2,
              rsvp_responded_at = now(),
              rsvp_version = CASE
                WHEN rsvp_status = $2 THEN rsvp_version
                ELSE rsvp_version + 1
              END,
              updated_at = now()
        WHERE id = $1
        RETURNING ${SELECT_COLUMNS}`,
      [id, status]
    );

    const row = result.rows[0];
    return row ? toInvitation(row) : null;
  },

  async revokeClaim(id: string, client?: PoolClient): Promise<void> {
    const runner = client ?? pool;
    await runner.query(
      `UPDATE invitations
          SET claim_revoked_at = now(), updated_at = now()
        WHERE id = $1`,
      [id]
    );
  },

  async setSendStatus(
    id: string,
    status: SendStatus,
    options: { incrementCount?: boolean } = {},
    client?: PoolClient
  ): Promise<void> {
    const runner = client ?? pool;
    const increment = options.incrementCount ? 1 : 0;
    await runner.query(
      `UPDATE invitations
          SET send_status = $2,
              send_count = send_count + $3,
              last_sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE last_sent_at END,
              updated_at = now()
        WHERE id = $1`,
      [id, status, increment]
    );
  },

  async delete(id: string, client?: PoolClient): Promise<boolean> {
    const runner = client ?? pool;
    const result = await runner.query('DELETE FROM invitations WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  },
};
