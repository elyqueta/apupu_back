import { PoolClient } from 'pg';
import { pool } from '../database/pool';
import {
  Invitation,
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
  id, event_id, guest_name, guest_email, guest_phone,
  token_hash, token_encrypted, claim_hash, claimed_at, claim_revoked_at,
  rsvp_status, rsvp_responded_at, rsvp_version,
  send_status, send_count, last_sent_at, created_at, updated_at
`;

export interface InsertInvitationData {
  eventId: string;
  guestName: string;
  guestEmail: string;
  guestPhone: string | null;
  tokenHash: string;
  tokenEncrypted: string;
}

export const invitationRepository = {
  async create(data: InsertInvitationData, client?: PoolClient): Promise<Invitation> {
    const runner = client ?? pool;
    const result = await runner.query<InvitationRow>(
      `INSERT INTO invitations (
         event_id, guest_name, guest_email, guest_phone, token_hash, token_encrypted
       )
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING ${SELECT_COLUMNS}`,
      [
        data.eventId,
        data.guestName,
        data.guestEmail,
        data.guestPhone,
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

  async listByEvent(eventId: string, client?: PoolClient): Promise<Invitation[]> {
    const runner = client ?? pool;
    const result = await runner.query<InvitationRow>(
      `SELECT ${SELECT_COLUMNS}
         FROM invitations
        WHERE event_id = $1
        ORDER BY created_at ASC`,
      [eventId]
    );
    return result.rows.map(toInvitation);
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
