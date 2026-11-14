import { PoolClient } from 'pg';
import { pool, query } from '../database/pool';
import {
  EventRecord,
  EventStats,
  EventStatus,
  CreateEventInput,
  EventLocation,
  EventTheme,
  EventContribution,
} from '../types/event.types';

interface EventRow {
  id: string;
  manage_token_hash: string;
  manage_token_expires_at: Date | null;
  manage_token_revoked_at: Date | null;
  title: string;
  host_name: string;
  host_email: string;
  starts_at: Date;
  ends_at: Date | null;
  timezone: string;
  location_type: 'venue' | 'online';
  location_name: string | null;
  location_address: string | null;
  online_url: string | null;
  message: string | null;
  rules: string | null;
  dress_code: string | null;
  template_id: string | null;
  theme: EventTheme;
  contribution_enabled: boolean;
  contribution_bank_name: string | null;
  contribution_account_holder: string | null;
  contribution_account_reference: string | null;
  rsvp_deadline: Date | null;
  status: EventStatus;
  created_at: Date;
  updated_at: Date;
}

function toEvent(row: EventRow): EventRecord {
  const location: EventLocation = {
    type: row.location_type,
    name: row.location_name,
    address: row.location_address,
    onlineUrl: row.online_url,
  };

  const contribution: EventContribution = {
    enabled: row.contribution_enabled,
    bankName: row.contribution_bank_name,
    accountHolder: row.contribution_account_holder,
    accountReference: row.contribution_account_reference,
  };

  return {
    id: row.id,
    manageTokenHash: row.manage_token_hash,
    manageTokenExpiresAt: row.manage_token_expires_at,
    manageTokenRevokedAt: row.manage_token_revoked_at,
    title: row.title,
    hostName: row.host_name,
    hostEmail: row.host_email,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    timezone: row.timezone,
    location,
    message: row.message,
    rules: row.rules,
    dressCode: row.dress_code,
    templateId: row.template_id,
    theme: row.theme,
    contribution,
    rsvpDeadline: row.rsvp_deadline,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_COLUMNS = `
  id, manage_token_hash, manage_token_expires_at, manage_token_revoked_at,
  title, host_name, host_email, starts_at, ends_at, timezone,
  location_type, location_name, location_address, online_url,
  message, rules, dress_code, template_id, theme,
  contribution_enabled, contribution_bank_name, contribution_account_holder,
  contribution_account_reference, rsvp_deadline, status, created_at, updated_at
`;

export interface InsertEventData extends CreateEventInput {
  manageTokenHash: string;
  manageTokenExpiresAt: Date | null;
}

export const eventRepository = {
  async create(data: InsertEventData, client?: PoolClient): Promise<EventRecord> {
    const runner = client ?? pool;
    const result = await runner.query<EventRow>(
      `INSERT INTO events (
         manage_token_hash, manage_token_expires_at, title, host_name, host_email,
         starts_at, ends_at, timezone, location_type, location_name,
         location_address, online_url, message, rules, dress_code,
         template_id, theme, contribution_enabled, contribution_bank_name,
         contribution_account_holder, contribution_account_reference,
         rsvp_deadline, status
       )
       VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,'scheduled'
       )
       RETURNING ${SELECT_COLUMNS}`,
      [
        data.manageTokenHash,
        data.manageTokenExpiresAt,
        data.title,
        data.hostName,
        data.hostEmail,
        data.startsAt,
        data.endsAt,
        data.timezone,
        data.location.type,
        data.location.name,
        data.location.address,
        data.location.onlineUrl,
        data.message,
        data.rules,
        data.dressCode,
        data.templateId,
        JSON.stringify(data.theme),
        data.contribution.enabled,
        data.contribution.bankName,
        data.contribution.accountHolder,
        data.contribution.accountReference,
        data.rsvpDeadline,
      ]
    );

    const row = result.rows[0];
    if (!row) throw new Error('Falha ao criar evento: nenhuma linha devolvida.');
    return toEvent(row);
  },

  async findById(id: string, client?: PoolClient): Promise<EventRecord | null> {
    const runner = client ?? pool;
    const result = await runner.query<EventRow>(
      `SELECT ${SELECT_COLUMNS} FROM events WHERE id = $1`,
      [id]
    );
    const row = result.rows[0];
    return row ? toEvent(row) : null;
  },

  /** Lê com lock de linha para alterações com efeitos na outbox. */
  async findByIdForUpdate(id: string, client: PoolClient): Promise<EventRecord | null> {
    const result = await client.query<EventRow>(
      `SELECT ${SELECT_COLUMNS} FROM events WHERE id = $1 FOR UPDATE`,
      [id]
    );
    const row = result.rows[0];
    return row ? toEvent(row) : null;
  },

  async findByManageTokenHash(hash: string): Promise<EventRecord | null> {
    const result = await query<EventRow>(
      `SELECT ${SELECT_COLUMNS} FROM events WHERE manage_token_hash = $1`,
      [hash]
    );
    const row = result.rows[0];
    return row ? toEvent(row) : null;
  },

  async update(
    id: string,
    changes: Partial<InsertEventData> & { status?: EventStatus },
    client?: PoolClient
  ): Promise<EventRecord | null> {
    const runner = client ?? pool;

    const mapping: Array<[keyof typeof changes, string, (value: unknown) => unknown]> = [
      ['title', 'title', (v: unknown): unknown => v],
      ['hostName', 'host_name', (v: unknown): unknown => v],
      ['hostEmail', 'host_email', (v: unknown): unknown => v],
      ['startsAt', 'starts_at', (v: unknown): unknown => v],
      ['endsAt', 'ends_at', (v: unknown): unknown => v],
      ['timezone', 'timezone', (v: unknown): unknown => v],
      ['message', 'message', (v: unknown): unknown => v],
      ['rules', 'rules', (v: unknown): unknown => v],
      ['dressCode', 'dress_code', (v: unknown): unknown => v],
      ['templateId', 'template_id', (v: unknown): unknown => v],
      ['rsvpDeadline', 'rsvp_deadline', (v: unknown): unknown => v],
      ['status', 'status', (v: unknown): unknown => v],
    ];

    const set: string[] = [];
    const values: unknown[] = [];

    for (const [key, column, transform] of mapping) {
      if (key in changes) {
        values.push(transform(changes[key]));
        set.push(`${column} = $${values.length}`);
      }
    }

    if ('location' in changes && changes.location) {
      values.push(changes.location.type);
      set.push(`location_type = $${values.length}`);
      values.push(changes.location.name);
      set.push(`location_name = $${values.length}`);
      values.push(changes.location.address);
      set.push(`location_address = $${values.length}`);
      values.push(changes.location.onlineUrl);
      set.push(`online_url = $${values.length}`);
    }

    if ('theme' in changes && changes.theme) {
      values.push(JSON.stringify(changes.theme));
      set.push(`theme = $${values.length}`);
    }

    if ('contribution' in changes && changes.contribution) {
      values.push(changes.contribution.enabled);
      set.push(`contribution_enabled = $${values.length}`);
      values.push(changes.contribution.bankName);
      set.push(`contribution_bank_name = $${values.length}`);
      values.push(changes.contribution.accountHolder);
      set.push(`contribution_account_holder = $${values.length}`);
      values.push(changes.contribution.accountReference);
      set.push(`contribution_account_reference = $${values.length}`);
    }

    if (set.length === 0) {
      return this.findById(id, client);
    }

    values.push(id);
    const result = await runner.query<EventRow>(
      `UPDATE events
          SET ${set.join(', ')}, updated_at = now()
        WHERE id = $${values.length}
        RETURNING ${SELECT_COLUMNS}`,
      values
    );

    const row = result.rows[0];
    return row ? toEvent(row) : null;
  },

  async revokeManageToken(id: string, client?: PoolClient): Promise<void> {
    const runner = client ?? pool;
    await runner.query(
      `UPDATE events
          SET manage_token_revoked_at = now(), updated_at = now()
        WHERE id = $1`,
      [id]
    );
  },

  async stats(eventId: string): Promise<EventStats> {
    const result = await query<{
      total: string;
      accepted: string;
      declined: string;
      pending: string;
    }>(
      `SELECT
         count(*)::text AS total,
         count(*) FILTER (WHERE rsvp_status = 'accepted')::text AS accepted,
         count(*) FILTER (WHERE rsvp_status = 'declined')::text AS declined,
         count(*) FILTER (WHERE rsvp_status = 'pending')::text AS pending
       FROM invitations
       WHERE event_id = $1`,
      [eventId]
    );

    const row = result.rows[0];
    return {
      totalInvitations: Number(row?.total ?? '0'),
      accepted: Number(row?.accepted ?? '0'),
      declined: Number(row?.declined ?? '0'),
      pending: Number(row?.pending ?? '0'),
    };
  },
};
