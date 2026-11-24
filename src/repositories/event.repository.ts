import { PoolClient } from 'pg';
import { pool, query } from '../database/pool';
import {
  EventAccessRecord,
  EventAccessRole,
  EventAccessScope,
  EventCategory,
  EventContribution,
  EventLocation,
  EventRecord,
  EventStats,
  EventStatus,
  EventTheme,
  EventVisibility,
  EventWithStats,
  CreateEventInput,
  HostEventListFilters,
  HostTotals,
} from '../types/event.types';

interface EventRow {
  id: string;
  host_id: string | null;
  manage_token_hash: string;
  manage_token_expires_at: Date | null;
  manage_token_revoked_at: Date | null;
  title: string;
  host_name: string;
  host_email: string;
  category: EventCategory | null;
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
  cover_url: string | null;
  cover_hash: string | null;
  cover_public_id: string | null;
  rsvp_deadline: Date | null;
  status: EventStatus;
  cancelled_at: Date | null;
  cancelled_reason: string | null;
  cancelled_by: string | null;
  visibility: EventVisibility;
  public_slug: string | null;
  show_attendee_count: boolean;
  min_age: number | null;
  max_age: number | null;
  deleted_at: Date | null;
  community_id: string | null;
  created_at: Date;
  updated_at: Date;
}

interface EventWithStatsRow extends EventRow {
  stat_total: number;
  stat_accepted: number;
  stat_declined: number;
  stat_pending: number;
  access_role?: EventAccessRole;
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
    hostId: row.host_id,
    manageTokenHash: row.manage_token_hash,
    manageTokenExpiresAt: row.manage_token_expires_at,
    manageTokenRevokedAt: row.manage_token_revoked_at,
    title: row.title,
    hostName: row.host_name,
    hostEmail: row.host_email,
    category: row.category,
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
    coverUrl: row.cover_url,
    coverHash: row.cover_hash,
    coverPublicId: row.cover_public_id,
    rsvpDeadline: row.rsvp_deadline,
    status: row.status,
    cancelledAt: row.cancelled_at,
    cancelledReason: row.cancelled_reason,
    cancelledBy: row.cancelled_by,
    visibility: row.visibility,
    publicSlug: row.public_slug,
    showAttendeeCount: row.show_attendee_count,
    minAge: row.min_age,
    maxAge: row.max_age,
    deletedAt: row.deleted_at,
    communityId: row.community_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toStats(row: EventWithStatsRow): EventStats {
  return {
    totalInvitations: Number(row.stat_total ?? 0),
    accepted: Number(row.stat_accepted ?? 0),
    declined: Number(row.stat_declined ?? 0),
    pending: Number(row.stat_pending ?? 0),
  };
}

function toEventWithStats(row: EventWithStatsRow): EventWithStats {
  return {
    ...toEvent(row),
    stats: toStats(row),
    accessRole: row.access_role ?? 'host',
  };
}

const SELECT_COLUMNS = `
  id, host_id, manage_token_hash, manage_token_expires_at, manage_token_revoked_at,
  title, host_name, host_email, category, starts_at, ends_at, timezone,
  location_type, location_name, location_address, online_url,
  message, rules, dress_code, template_id, theme,
  contribution_enabled, contribution_bank_name, contribution_account_holder,
  contribution_account_reference, cover_url, cover_hash, cover_public_id,
  rsvp_deadline, status, cancelled_at, cancelled_reason, cancelled_by,
  visibility, public_slug, show_attendee_count, min_age, max_age, deleted_at, community_id,
  created_at, updated_at
`;

/** Prefixa as colunas do evento com o alias usado na query. */
function columnsFor(alias: string): string {
  return SELECT_COLUMNS.split(',')
    .map((column) => `${alias}.${column.trim()}`)
    .join(', ');
}

/**
 * Condição de acesso partilhada: proprietário ou gestor activo.
 *
 * Empurra os parâmetros para `values` e devolve a expressão SQL. O
 * `hostId` é sempre o primeiro parâmetro adicionado, pelo que a
 * expressão de `access_role` pode assumir `$1` nas listas.
 */
function accessCondition(
  values: unknown[],
  scope: EventAccessScope,
  alias = 'e'
): string {
  values.push(scope.hostId);
  const hostParam = values.length;
  let condition = `${alias}.host_id = $${hostParam}`;
  const notDeleted = `${alias}.deleted_at IS NULL`;

  if (scope.managerEmail) {
    values.push(scope.managerEmail);
    const emailParam = values.length;
    condition = `(${condition} OR EXISTS (
      SELECT 1
        FROM event_managers m
       WHERE m.event_id = ${alias}.id
         AND m.email = $${emailParam}::citext
         AND m.revoked_at IS NULL
    ))`;
  }

  // Bloco 11: gestores e responsável da comunidade do evento.
  condition = `(${condition} OR EXISTS (
    SELECT 1
      FROM community_members cm
     WHERE cm.community_id = ${alias}.community_id
       AND cm.host_id = $${hostParam}
       AND cm.status = 'active'
       AND cm.role IN ('owner', 'manager')
  ))`;

  return `(${condition} AND ${notDeleted})`;
}

/** Papel de quem consulta: `host` quando é proprietário. */
function accessRoleExpression(alias = 'e', hostParam = 1): string {
  // O responsável da comunidade tem os mesmos poderes do anfitrião.
  return `CASE WHEN ${alias}.host_id = $${hostParam} OR EXISTS (
    SELECT 1 FROM community_members cmo
     WHERE cmo.community_id = ${alias}.community_id
       AND cmo.host_id = $${hostParam}
       AND cmo.status = 'active'
       AND cmo.role = 'owner'
  ) THEN 'host' ELSE 'manager' END`;
}

const STATS_LATERAL = `
  LEFT JOIN LATERAL (
    SELECT
      count(*)::int AS stat_total,
      count(*) FILTER (WHERE rsvp_status = 'accepted')::int AS stat_accepted,
      count(*) FILTER (WHERE rsvp_status = 'declined')::int AS stat_declined,
      count(*) FILTER (WHERE rsvp_status = 'pending')::int AS stat_pending
    FROM invitations i
    WHERE i.event_id = e.id
  ) stats ON true
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
         host_id, manage_token_hash, manage_token_expires_at, title, host_name,
         host_email, category, starts_at, ends_at, timezone, location_type,
         location_name, location_address, online_url, message, rules, dress_code,
         template_id, theme, contribution_enabled, contribution_bank_name,
         contribution_account_holder, contribution_account_reference,
         rsvp_deadline, cover_url, status,
         visibility, public_slug, show_attendee_count, min_age, max_age, community_id
       )
       VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,'scheduled',
         $26,$27,$28,$29,$30,$31
       )
       RETURNING ${SELECT_COLUMNS}`,
      [
        data.hostId,
        data.manageTokenHash,
        data.manageTokenExpiresAt,
        data.title,
        data.hostName,
        data.hostEmail,
        data.category,
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
        data.coverUrl ?? null,
        data.visibility ?? 'private',
        data.publicSlug ?? null,
        data.showAttendeeCount ?? false,
        data.minAge ?? null,
        data.maxAge ?? null,
        data.communityId ?? null,
      ]
    );

    const row = result.rows[0];
    if (!row) throw new Error('Falha ao criar evento: nenhuma linha devolvida.');
    return toEvent(row);
  },

  async findById(id: string, client?: PoolClient): Promise<EventRecord | null> {
    const runner = client ?? pool;
    const result = await runner.query<EventRow>(
      `SELECT ${SELECT_COLUMNS} FROM events WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    const row = result.rows[0];
    return row ? toEvent(row) : null;
  },

  /** Lê com lock de linha para alterações com efeitos na outbox. */
  async findByIdForUpdate(id: string, client: PoolClient): Promise<EventRecord | null> {
    const result = await client.query<EventRow>(
      `SELECT ${SELECT_COLUMNS} FROM events WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [id]
    );
    const row = result.rows[0];
    return row ? toEvent(row) : null;
  },

  /** Leitura limitada à conta: o UUID nunca é autorização por si só. */
  async findByIdForHost(id: string, hostId: string, client?: PoolClient): Promise<EventRecord | null> {
    const runner = client ?? pool;
    const result = await runner.query<EventRow>(
      `SELECT ${SELECT_COLUMNS} FROM events WHERE id = $1 AND host_id = $2 AND deleted_at IS NULL`,
      [id, hostId]
    );
    const row = result.rows[0];
    return row ? toEvent(row) : null;
  },

  /**
   * Lê o evento com o papel de acesso da conta.
   *
   * O acesso é concedido ao proprietário ou a um gestor activo cujo
   * email coincide com o da conta (comparação `citext`). Devolve `null`
   * para qualquer outra conta, para não revelar a existência do
   * recurso.
   */
  async findByIdForAccess(
    id: string,
    scope: EventAccessScope,
    client?: PoolClient
  ): Promise<EventAccessRecord | null> {
    const runner = client ?? pool;
    const values: unknown[] = [id, scope.hostId];
    let condition = 'e.host_id = $2';

    if (scope.managerEmail) {
      values.push(scope.managerEmail);
      condition = `(e.host_id = $2 OR EXISTS (
        SELECT 1
          FROM event_managers m
         WHERE m.event_id = e.id
           AND m.email = $3::citext
           AND m.revoked_at IS NULL
      ))`;
    }
    condition = `(${condition} OR EXISTS (
      SELECT 1 FROM community_members cm
       WHERE cm.community_id = e.community_id
         AND cm.host_id = $2
         AND cm.status = 'active'
         AND cm.role IN ('owner', 'manager')
    ))`;

    const result = await runner.query<EventRow & { access_role: EventAccessRole }>(
      `SELECT ${columnsFor('e')},
              ${accessRoleExpression('e', 2)} AS access_role
         FROM events e
        WHERE e.id = $1 AND e.deleted_at IS NULL AND ${condition}`,
      values
    );

    const row = result.rows[0];
    if (!row) return null;

    return { event: toEvent(row), accessRole: row.access_role };
  },

  async findByManageTokenHash(hash: string): Promise<EventRecord | null> {
    const result = await query<EventRow>(
      `SELECT ${SELECT_COLUMNS} FROM events WHERE manage_token_hash = $1 AND deleted_at IS NULL`,
      [hash]
    );
    const row = result.rows[0];
    return row ? toEvent(row) : null;
  },

  async update(
    id: string,
    changes: Partial<InsertEventData> & {
      status?: EventStatus;
      cancelledAt?: Date | null;
      cancelledReason?: string | null;
      cancelledBy?: string | null;
    },
    client?: PoolClient
  ): Promise<EventRecord | null> {
    const runner = client ?? pool;

    const mapping: Array<[keyof typeof changes, string, (value: unknown) => unknown]> = [
      ['hostId', 'host_id', (v: unknown): unknown => v],
      ['title', 'title', (v: unknown): unknown => v],
      ['hostName', 'host_name', (v: unknown): unknown => v],
      ['hostEmail', 'host_email', (v: unknown): unknown => v],
      ['category', 'category', (v: unknown): unknown => v],
      ['startsAt', 'starts_at', (v: unknown): unknown => v],
      ['endsAt', 'ends_at', (v: unknown): unknown => v],
      ['timezone', 'timezone', (v: unknown): unknown => v],
      ['message', 'message', (v: unknown): unknown => v],
      ['rules', 'rules', (v: unknown): unknown => v],
      ['dressCode', 'dress_code', (v: unknown): unknown => v],
      ['templateId', 'template_id', (v: unknown): unknown => v],
      ['coverUrl', 'cover_url', (v: unknown): unknown => v],
      ['coverHash', 'cover_hash', (v: unknown): unknown => v],
      ['coverPublicId', 'cover_public_id', (v: unknown): unknown => v],
      ['rsvpDeadline', 'rsvp_deadline', (v: unknown): unknown => v],
      ['status', 'status', (v: unknown): unknown => v],
      ['cancelledAt', 'cancelled_at', (v: unknown): unknown => v],
      ['cancelledReason', 'cancelled_reason', (v: unknown): unknown => v],
      ['cancelledBy', 'cancelled_by', (v: unknown): unknown => v],
      ['visibility', 'visibility', (v: unknown): unknown => v],
      ['publicSlug', 'public_slug', (v: unknown): unknown => v],
      ['showAttendeeCount', 'show_attendee_count', (v: unknown): unknown => v],
      ['minAge', 'min_age', (v: unknown): unknown => v],
      ['maxAge', 'max_age', (v: unknown): unknown => v],
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
          AND deleted_at IS NULL
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

  /**
   * Substitui o hash do link de gestão e renova a validade.
   *
   * O token antigo deixa imediatamente de corresponder ao hash. Quando
   * `hostId` é indicado, a actualização só acontece se o evento
   * pertencer à conta — o UUID nunca é autorização por si só.
   */
  async rotateManageToken(
    id: string,
    data: { hash: string; expiresAt: Date; hostId?: string },
    client?: PoolClient
  ): Promise<EventRecord | null> {
    const runner = client ?? pool;
    const result = await runner.query<EventRow>(
      `UPDATE events
          SET manage_token_hash = $1,
              manage_token_expires_at = $2,
              manage_token_revoked_at = NULL,
              updated_at = now()
        WHERE id = $3
          AND ($4::uuid IS NULL OR host_id = $4)
        RETURNING ${SELECT_COLUMNS}`,
      [data.hash, data.expiresAt, id, data.hostId ?? null]
    );

    const row = result.rows[0];
    return row ? toEvent(row) : null;
  },

  /**
   * Remoção lógica, limitada ao proprietário. O link de gestão é
   * revogado e o link público deixa de resolver (`deleted_at`).
   */
  async softDeleteForHost(id: string, hostId: string, client?: PoolClient): Promise<boolean> {
    const runner = client ?? pool;
    const result = await runner.query(
      `UPDATE events
          SET deleted_at = now(),
              manage_token_revoked_at = COALESCE(manage_token_revoked_at, now()),
              updated_at = now()
        WHERE id = $1 AND host_id = $2 AND deleted_at IS NULL`,
      [id, hostId]
    );
    return (result.rowCount ?? 0) > 0;
  },

  /** Remoção lógica sem restrição de dono (a permissão é validada no serviço). */
  async softDelete(id: string, client?: PoolClient): Promise<boolean> {
    const runner = client ?? pool;
    const result = await runner.query(
      `UPDATE events
          SET deleted_at = now(),
              manage_token_revoked_at = COALESCE(manage_token_revoked_at, now()),
              updated_at = now()
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return (result.rowCount ?? 0) > 0;
  },

  /** Evento público, activo e não removido, pelo slug do link aberto. */
  async findByPublicSlug(slug: string, client?: PoolClient): Promise<EventRecord | null> {
    const runner = client ?? pool;
    const result = await runner.query<EventRow>(
      `SELECT ${SELECT_COLUMNS}
         FROM events
        WHERE public_slug = $1
          AND visibility = 'public'
          AND deleted_at IS NULL`,
      [slug]
    );
    const row = result.rows[0];
    return row ? toEvent(row) : null;
  },

  async countAccepted(eventId: string, client?: PoolClient): Promise<number> {
    const runner = client ?? pool;
    const result = await runner.query<{ total: string }>(
      `SELECT count(*)::text AS total
         FROM invitations
        WHERE event_id = $1 AND rsvp_status = 'accepted'`,
      [eventId]
    );
    return Number(result.rows[0]?.total ?? '0');
  },

  /** Liga eventos legados ao anfitrião após verificação de email. */
  async claimByHostEmail(hostId: string, email: string, client?: PoolClient): Promise<number> {
    const runner = client ?? pool;
    const result = await runner.query(
      `UPDATE events
          SET host_id = $1, updated_at = now()
        WHERE host_id IS NULL
          AND lower(host_email) = lower($2)`,
      [hostId, email]
    );
    return result.rowCount ?? 0;
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

  /**
   * Lista paginada dos eventos acessíveis à conta.
   *
   * Inclui os eventos próprios e aqueles em que a conta é gestor
   * activo. As estatísticas vêm de um LATERAL agregado na mesma query:
   * evita N+1 e garante que `total` reflecte o mesmo filtro da lista.
   */
  async listForHost(
    filters: HostEventListFilters
  ): Promise<{ items: EventWithStats[]; total: number }> {
    const values: unknown[] = [];
    const conditions = [
      accessCondition(values, {
        hostId: filters.hostId,
        managerEmail: filters.managerEmail,
      }),
    ];

    if (filters.status) {
      values.push(filters.status);
      conditions.push(`e.status = $${values.length}`);
    }

    if (filters.q) {
      values.push(`%${filters.q}%`);
      conditions.push(`e.title ILIKE $${values.length}`);
    }

    const where = conditions.join(' AND ');
    const direction = filters.order === 'asc' ? 'ASC' : 'DESC';

    const countResult = await query<{ total: string }>(
      `SELECT count(*)::text AS total FROM events e WHERE ${where}`,
      values
    );

    const listValues = [...values, filters.limit, filters.offset];
    const listResult = await query<EventWithStatsRow>(
      `SELECT ${columnsFor('e')},
              stats.stat_total, stats.stat_accepted, stats.stat_declined, stats.stat_pending,
              ${accessRoleExpression()} AS access_role
         FROM events e
         ${STATS_LATERAL}
        WHERE ${where}
        ORDER BY e.${filters.sort} ${direction}, e.id ${direction}
        LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
      listValues
    );

    return {
      items: listResult.rows.map(toEventWithStats),
      total: Number(countResult.rows[0]?.total ?? '0'),
    };
  },

  async nextScheduledForHost(scope: EventAccessScope): Promise<EventWithStats | null> {
    const values: unknown[] = [];
    const access = accessCondition(values, scope);

    const result = await query<EventWithStatsRow>(
      `SELECT ${columnsFor('e')},
              stats.stat_total, stats.stat_accepted, stats.stat_declined, stats.stat_pending,
              ${accessRoleExpression()} AS access_role
         FROM events e
         ${STATS_LATERAL}
        WHERE ${access} AND e.status = 'scheduled' AND e.starts_at > now()
        ORDER BY e.starts_at ASC, e.id ASC
        LIMIT 1`,
      values
    );
    const row = result.rows[0];
    return row ? toEventWithStats(row) : null;
  },

  async upcomingForHost(scope: EventAccessScope, limit: number): Promise<EventWithStats[]> {
    const values: unknown[] = [];
    const access = accessCondition(values, scope);
    values.push(limit);

    const result = await query<EventWithStatsRow>(
      `SELECT ${columnsFor('e')},
              stats.stat_total, stats.stat_accepted, stats.stat_declined, stats.stat_pending,
              ${accessRoleExpression()} AS access_role
         FROM events e
         ${STATS_LATERAL}
        WHERE ${access} AND e.status = 'scheduled' AND e.starts_at > now()
        ORDER BY e.starts_at ASC, e.id ASC
        LIMIT $${values.length}`,
      values
    );
    return result.rows.map(toEventWithStats);
  },

  async totalsForHost(scope: EventAccessScope): Promise<HostTotals> {
    const values: unknown[] = [];
    const access = accessCondition(values, scope);

    const result = await query<{
      events: string;
      drafts: string;
      scheduled: string;
      cancelled: string;
      completed: string;
      total_invitations: string;
      accepted: string;
      declined: string;
      pending: string;
    }>(
      `SELECT
         count(DISTINCT e.id)::text AS events,
         count(DISTINCT e.id) FILTER (WHERE e.status = 'draft')::text AS drafts,
         count(DISTINCT e.id) FILTER (WHERE e.status = 'scheduled')::text AS scheduled,
         count(DISTINCT e.id) FILTER (WHERE e.status = 'cancelled')::text AS cancelled,
         count(DISTINCT e.id) FILTER (WHERE e.status = 'completed')::text AS completed,
         count(i.id)::text AS total_invitations,
         count(i.id) FILTER (WHERE i.rsvp_status = 'accepted')::text AS accepted,
         count(i.id) FILTER (WHERE i.rsvp_status = 'declined')::text AS declined,
         count(i.id) FILTER (WHERE i.rsvp_status = 'pending')::text AS pending
       FROM events e
       LEFT JOIN invitations i ON i.event_id = e.id
       WHERE ${access}`,
      values
    );

    const row = result.rows[0];
    return {
      events: Number(row?.events ?? '0'),
      drafts: Number(row?.drafts ?? '0'),
      scheduled: Number(row?.scheduled ?? '0'),
      cancelled: Number(row?.cancelled ?? '0'),
      completed: Number(row?.completed ?? '0'),
      totalInvitations: Number(row?.total_invitations ?? '0'),
      accepted: Number(row?.accepted ?? '0'),
      declined: Number(row?.declined ?? '0'),
      pending: Number(row?.pending ?? '0'),
    };
  },

  /** Contagens globais para a visão geral do super admin. */
  async countAll(): Promise<{ hosts: number; active: number; cancelled: number }> {
    const result = await query<{
      hosts: string;
      active: string;
      cancelled: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM hosts) AS hosts,
         (SELECT count(*)::text FROM events WHERE status = 'scheduled' AND deleted_at IS NULL) AS active,
         (SELECT count(*)::text FROM events WHERE status = 'cancelled' AND deleted_at IS NULL) AS cancelled`
    );
    const row = result.rows[0];
    return {
      hosts: Number(row?.hosts ?? '0'),
      active: Number(row?.active ?? '0'),
      cancelled: Number(row?.cancelled ?? '0'),
    };
  },

  /** Lista global para o painel admin, com filtros opcionais. */
  async listForAdmin(filters: {
    q?: string;
    status?: EventStatus;
    host?: string;
    from?: Date;
    to?: Date;
    order: 'asc' | 'desc';
    limit: number;
    offset: number;
  }): Promise<{ items: EventWithStats[]; total: number }> {
    const values: unknown[] = [];
    const conditions: string[] = ['e.deleted_at IS NULL'];

    const push = (sql: string, value: unknown): void => {
      values.push(value);
      conditions.push(sql.replace('?', `$${values.length}`));
    };

    if (filters.q) push('(e.title ILIKE ? OR e.host_email::text ILIKE ?)', `%${filters.q}%`);
    if (filters.status) push('e.status = ?', filters.status);
    if (filters.host) push('e.host_email::text ILIKE ?', `%${filters.host}%`);
    if (filters.from) push('e.created_at >= ?', filters.from);
    if (filters.to) push('e.created_at <= ?', filters.to);

    const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const direction = filters.order === 'asc' ? 'ASC' : 'DESC';

    const [count, list] = await Promise.all([
      query<{ total: string }>(`SELECT count(*)::text AS total FROM events e${where}`, values),
      query<EventWithStatsRow>(
        `SELECT ${columnsFor('e')},
                stats.stat_total, stats.stat_accepted, stats.stat_declined, stats.stat_pending,
                'owner'::text AS access_role
           FROM events e
           ${STATS_LATERAL}
           ${where}
          ORDER BY e.created_at ${direction}, e.id ${direction}
          LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, filters.limit, filters.offset]
      ),
    ]);

    return {
      items: list.rows.map(toEventWithStats),
      total: Number(count.rows[0]?.total ?? '0'),
    };
  },
};
