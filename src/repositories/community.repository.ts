import { PoolClient } from 'pg';
import { pool, query } from '../database/pool';
import {
  Community,
  CommunityEventSummary,
  CommunityJoinRequest,
  CommunityMember,
  CommunityMemberStatus,
  CommunityReferralStat,
  CommunityRole,
  CommunityTeamSummary,
  CommunityTransfer,
  CommunityVisibility,
  CommunityWithStats,
  JoinRequestStatus,
  TransferStatus,
} from '../types/community.types';
import { escapeLike } from '../utils/like.util';

type Runner = PoolClient | typeof pool;

interface CommunityRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  visibility: CommunityVisibility;
  owner_id: string;
  avatar_url: string | null;
  cover_url: string | null;
  created_at: Date;
  updated_at: Date;
}

interface CommunityStatsRow extends CommunityRow {
  member_count: number;
  event_count: number;
  team_count: number;
  my_role: CommunityRole | null;
  my_status: CommunityMemberStatus | null;
  my_pending_request: boolean;
}

const COMMUNITY_COLUMNS = `
  c.id, c.name, c.slug, c.description, c.visibility, c.owner_id,
  c.avatar_url, c.cover_url, c.created_at, c.updated_at
`;

function toCommunity(row: CommunityRow): Community {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    visibility: row.visibility,
    ownerId: row.owner_id,
    avatarUrl: row.avatar_url,
    coverUrl: row.cover_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toCommunityWithStats(row: CommunityStatsRow): CommunityWithStats {
  return {
    ...toCommunity(row),
    memberCount: Number(row.member_count ?? 0),
    eventCount: Number(row.event_count ?? 0),
    teamCount: Number(row.team_count ?? 0),
    myRole: row.my_role,
    myStatus: row.my_status,
    myPendingRequest: Boolean(row.my_pending_request),
  };
}

/** `$1` = conta que consulta. */
const STATS_SELECT = `
  ${COMMUNITY_COLUMNS},
  (SELECT count(*)::int FROM community_members m
    WHERE m.community_id = c.id AND m.status = 'active') AS member_count,
  (SELECT count(*)::int FROM events e
    WHERE e.community_id = c.id AND e.deleted_at IS NULL) AS event_count,
  (SELECT count(*)::int FROM teams t
    WHERE t.community_id = c.id AND t.deleted_at IS NULL) AS team_count,
  me.role AS my_role,
  me.status AS my_status,
  EXISTS (
    SELECT 1 FROM community_join_requests r
     WHERE r.community_id = c.id AND r.host_id = $1 AND r.status = 'pending'
  ) AS my_pending_request
`;

const ME_JOIN = `
  LEFT JOIN LATERAL (
    SELECT m.role, m.status
      FROM community_members m
     WHERE m.community_id = c.id
       AND m.host_id = $1
       AND m.status IN ('active', 'invited')
     ORDER BY (m.status = 'active') DESC
     LIMIT 1
  ) me ON true
`;

interface MemberRow {
  id: string;
  community_id: string;
  host_id: string | null;
  email: string | null;
  phone: string | null;
  display_name: string | null;
  avatar_url: string | null;
  role: CommunityRole;
  status: CommunityMemberStatus;
  ref_code: string;
  has_host_account: boolean;
  joined_at: Date | null;
  created_at: Date;
}

const MEMBER_SELECT = `
  SELECT m.id, m.community_id, m.host_id, COALESCE(m.email::text, h.email::text) AS email,
         m.phone, COALESCE(p.display_name, m.display_name) AS display_name,
         p.avatar_url, m.role, m.status, m.ref_code,
         (h.id IS NOT NULL AND h.status = 'active') AS has_host_account,
         m.joined_at, m.created_at
    FROM community_members m
    LEFT JOIN hosts h ON h.id = m.host_id
    LEFT JOIN host_profiles p ON p.host_id = m.host_id
`;

function toMember(row: MemberRow): CommunityMember {
  return {
    id: row.id,
    communityId: row.community_id,
    hostId: row.host_id,
    email: row.email,
    phone: row.phone,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    role: row.role,
    status: row.status,
    refCode: row.ref_code,
    hasHostAccount: Boolean(row.has_host_account),
    joinedAt: row.joined_at,
    createdAt: row.created_at,
  };
}

interface JoinRequestRow {
  id: string;
  community_id: string;
  host_id: string;
  display_name: string | null;
  email: string;
  avatar_url: string | null;
  message: string | null;
  status: JoinRequestStatus;
  decided_by: string | null;
  decided_at: Date | null;
  created_at: Date;
}

function toJoinRequest(row: JoinRequestRow): CommunityJoinRequest {
  return {
    id: row.id,
    communityId: row.community_id,
    hostId: row.host_id,
    displayName: row.display_name,
    email: row.email,
    avatarUrl: row.avatar_url,
    message: row.message,
    status: row.status,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
  };
}

interface TransferRow {
  id: string;
  community_id: string;
  from_host_id: string;
  to_host_id: string;
  status: TransferStatus;
  otp_expires_at: Date | null;
  created_at: Date;
  completed_at: Date | null;
}

function toTransfer(row: TransferRow): CommunityTransfer {
  return {
    id: row.id,
    communityId: row.community_id,
    fromHostId: row.from_host_id,
    toHostId: row.to_host_id,
    status: row.status,
    otpExpiresAt: row.otp_expires_at,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export const communityRepository = {
  /* ───────────────────────────── Comunidades ───────────────────────────── */

  async create(
    data: {
      name: string;
      slug: string;
      description: string | null;
      visibility: CommunityVisibility;
      ownerId: string;
      ownerEmail: string;
      ownerRefCode: string;
    },
    client: PoolClient
  ): Promise<Community> {
    const result = await client.query<CommunityRow>(
      `INSERT INTO communities AS c (name, slug, description, visibility, owner_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${COMMUNITY_COLUMNS}`,
      [data.name, data.slug, data.description, data.visibility, data.ownerId]
    );
    const row = result.rows[0];
    if (!row) throw new Error('Falha ao criar comunidade.');
    await client.query(
      `INSERT INTO community_members (community_id, host_id, email, role, status, ref_code, joined_at)
       VALUES ($1, $2, $3, 'owner', 'active', $4, now())`,
      [row.id, data.ownerId, data.ownerEmail, data.ownerRefCode]
    );
    return toCommunity(row);
  },

  async slugExists(slug: string): Promise<boolean> {
    const result = await query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM communities WHERE slug = $1) AS exists',
      [slug]
    );
    return Boolean(result.rows[0]?.exists);
  },

  async findById(id: string, viewerId: string, client?: PoolClient): Promise<CommunityWithStats | null> {
    const runner: Runner = client ?? pool;
    const result = await runner.query<CommunityStatsRow>(
      `SELECT ${STATS_SELECT} FROM communities c ${ME_JOIN}
        WHERE c.id = $2 AND c.deleted_at IS NULL`,
      [viewerId, id]
    );
    const row = result.rows[0];
    return row ? toCommunityWithStats(row) : null;
  },

  async findBySlug(slug: string, viewerId: string): Promise<CommunityWithStats | null> {
    const result = await query<CommunityStatsRow>(
      `SELECT ${STATS_SELECT} FROM communities c ${ME_JOIN}
        WHERE c.slug = $2 AND c.deleted_at IS NULL`,
      [viewerId, slug]
    );
    const row = result.rows[0];
    return row ? toCommunityWithStats(row) : null;
  },

  /** As minhas comunidades (membro activo ou convidado) e, opcionalmente, pesquisa. */
  async listForHost(viewerId: string, q?: string): Promise<CommunityWithStats[]> {
    const values: unknown[] = [viewerId];
    let search = '';
    if (q) {
      values.push(`%${escapeLike(q)}%`);
      search = `AND c.name ILIKE $${values.length} ESCAPE '\\'`;
    }
    const result = await query<CommunityStatsRow>(
      `SELECT ${STATS_SELECT} FROM communities c ${ME_JOIN}
        WHERE c.deleted_at IS NULL AND me.role IS NOT NULL ${search}
        ORDER BY (me.status = 'invited') DESC, c.name ASC`,
      values
    );
    return result.rows.map(toCommunityWithStats);
  },

  /** Comunidades públicas (para descobrir e pedir adesão). */
  async listPublic(viewerId: string, q: string | undefined, limit: number): Promise<CommunityWithStats[]> {
    const values: unknown[] = [viewerId, limit];
    let search = '';
    if (q) {
      values.push(`%${escapeLike(q)}%`);
      search = `AND c.name ILIKE $${values.length} ESCAPE '\\'`;
    }
    const result = await query<CommunityStatsRow>(
      `SELECT ${STATS_SELECT} FROM communities c ${ME_JOIN}
        WHERE c.deleted_at IS NULL AND c.visibility = 'public' ${search}
        ORDER BY c.created_at DESC
        LIMIT $2`,
      values
    );
    return result.rows.map(toCommunityWithStats);
  },

  async update(
    id: string,
    changes: Partial<Pick<Community, 'name' | 'description' | 'visibility' | 'avatarUrl' | 'coverUrl'>>,
    client?: PoolClient
  ): Promise<void> {
    const runner: Runner = client ?? pool;
    const mapping: [keyof typeof changes, string][] = [
      ['name', 'name'],
      ['description', 'description'],
      ['visibility', 'visibility'],
      ['avatarUrl', 'avatar_url'],
      ['coverUrl', 'cover_url'],
    ];
    const set: string[] = [];
    const values: unknown[] = [];
    for (const [key, column] of mapping) {
      if (key in changes) {
        values.push(changes[key]);
        set.push(`${column} = $${values.length}`);
      }
    }
    if (set.length === 0) return;
    values.push(id);
    await runner.query(
      `UPDATE communities SET ${set.join(', ')}, updated_at = now()
        WHERE id = $${values.length} AND deleted_at IS NULL`,
      values
    );
  },

  /** Remoção lógica; os eventos ficam (passam a eventos pessoais do anfitrião). */
  async softDelete(id: string, client: PoolClient): Promise<void> {
    await client.query(
      `UPDATE communities SET deleted_at = now(), updated_at = now() WHERE id = $1`,
      [id]
    );
    await client.query(`UPDATE events SET community_id = NULL WHERE community_id = $1`, [id]);
    await client.query(`UPDATE teams SET community_id = NULL WHERE community_id = $1`, [id]);
  },

  /* ─────────────────────────────── Membros ─────────────────────────────── */

  async listMembers(communityId: string): Promise<CommunityMember[]> {
    const result = await query<MemberRow>(
      `${MEMBER_SELECT}
        WHERE m.community_id = $1 AND m.status IN ('active', 'invited')
        ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END,
                 (m.status = 'invited'), lower(COALESCE(p.display_name, m.display_name, m.email::text, '')) ASC`,
      [communityId]
    );
    return result.rows.map(toMember);
  },

  async findMemberByHost(
    communityId: string,
    hostId: string,
    client?: PoolClient
  ): Promise<CommunityMember | null> {
    const runner: Runner = client ?? pool;
    const result = await runner.query<MemberRow>(
      `${MEMBER_SELECT}
        WHERE m.community_id = $1 AND m.host_id = $2 AND m.status IN ('active', 'invited')
        ORDER BY (m.status = 'active') DESC
        LIMIT 1`,
      [communityId, hostId]
    );
    const row = result.rows[0];
    return row ? toMember(row) : null;
  },

  async findMemberById(id: string, client?: PoolClient): Promise<CommunityMember | null> {
    const runner: Runner = client ?? pool;
    const result = await runner.query<MemberRow>(`${MEMBER_SELECT} WHERE m.id = $1`, [id]);
    const row = result.rows[0];
    return row ? toMember(row) : null;
  },

  async findActiveMemberByRefCode(communityId: string, refCode: string): Promise<CommunityMember | null> {
    const result = await query<MemberRow>(
      `${MEMBER_SELECT}
        WHERE m.community_id = $1 AND m.ref_code = $2 AND m.status = 'active'`,
      [communityId, refCode]
    );
    const row = result.rows[0];
    return row ? toMember(row) : null;
  },

  async insertMember(
    data: {
      communityId: string;
      hostId: string | null;
      email: string | null;
      phone: string | null;
      displayName: string | null;
      role: CommunityRole;
      status: CommunityMemberStatus;
      refCode: string;
      invitedBy: string | null;
    },
    client?: PoolClient
  ): Promise<string> {
    const runner: Runner = client ?? pool;
    const result = await runner.query<{ id: string }>(
      `INSERT INTO community_members (
         community_id, host_id, email, phone, display_name, role, status, ref_code,
         invited_by, joined_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $7 = 'active' THEN now() END)
       RETURNING id`,
      [
        data.communityId,
        data.hostId,
        data.email,
        data.phone,
        data.displayName,
        data.role,
        data.status,
        data.refCode,
        data.invitedBy,
      ]
    );
    const row = result.rows[0];
    if (!row) throw new Error('Falha ao adicionar membro.');
    return row.id;
  },

  async setMemberStatus(
    id: string,
    status: CommunityMemberStatus,
    client?: PoolClient
  ): Promise<void> {
    const runner: Runner = client ?? pool;
    await runner.query(
      `UPDATE community_members
          SET status = $2,
              joined_at = CASE WHEN $2 = 'active' THEN COALESCE(joined_at, now()) ELSE joined_at END,
              left_at = CASE WHEN $2 IN ('left', 'removed') THEN now() ELSE left_at END,
              updated_at = now()
        WHERE id = $1`,
      [id, status]
    );
  },

  async setMemberRole(id: string, role: CommunityRole, client?: PoolClient): Promise<void> {
    const runner: Runner = client ?? pool;
    await runner.query(
      `UPDATE community_members SET role = $2, updated_at = now() WHERE id = $1`,
      [id, role]
    );
  },

  /** Liga convites por email a uma conta (quando o email coincide). */
  async attachHostToInvites(hostId: string, email: string): Promise<void> {
    await query(
      `UPDATE community_members
          SET host_id = $1, updated_at = now()
        WHERE host_id IS NULL AND email = $2::citext AND status = 'invited'`,
      [hostId, email]
    );
  },

  /* ──────────────────────────── Pedidos de adesão ───────────────────────── */

  async createJoinRequest(
    communityId: string,
    hostId: string,
    message: string | null
  ): Promise<CommunityJoinRequest> {
    const result = await query<{ id: string }>(
      `INSERT INTO community_join_requests (community_id, host_id, message)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [communityId, hostId, message]
    );
    const created = await this.findJoinRequest(result.rows[0]?.id ?? '');
    if (!created) throw new Error('Falha ao criar pedido de adesão.');
    return created;
  },

  async findJoinRequest(id: string, client?: PoolClient): Promise<CommunityJoinRequest | null> {
    const runner: Runner = client ?? pool;
    const result = await runner.query<JoinRequestRow>(
      `SELECT r.id, r.community_id, r.host_id, p.display_name, h.email::text AS email,
              p.avatar_url, r.message, r.status, r.decided_by, r.decided_at, r.created_at
         FROM community_join_requests r
         JOIN hosts h ON h.id = r.host_id
         LEFT JOIN host_profiles p ON p.host_id = r.host_id
        WHERE r.id = $1`,
      [id]
    );
    const row = result.rows[0];
    return row ? toJoinRequest(row) : null;
  },

  async listPendingJoinRequests(communityId: string): Promise<CommunityJoinRequest[]> {
    const result = await query<JoinRequestRow>(
      `SELECT r.id, r.community_id, r.host_id, p.display_name, h.email::text AS email,
              p.avatar_url, r.message, r.status, r.decided_by, r.decided_at, r.created_at
         FROM community_join_requests r
         JOIN hosts h ON h.id = r.host_id
         LEFT JOIN host_profiles p ON p.host_id = r.host_id
        WHERE r.community_id = $1 AND r.status = 'pending'
        ORDER BY r.created_at ASC`,
      [communityId]
    );
    return result.rows.map(toJoinRequest);
  },

  async decideJoinRequest(
    id: string,
    status: Exclude<JoinRequestStatus, 'pending'>,
    decidedBy: string | null,
    client: PoolClient
  ): Promise<boolean> {
    const result = await client.query(
      `UPDATE community_join_requests
          SET status = $2, decided_by = $3, decided_at = now()
        WHERE id = $1 AND status = 'pending'`,
      [id, status, decidedBy]
    );
    return (result.rowCount ?? 0) > 0;
  },

  /* ─────────────────────── Transferência de responsabilidade ─────────────── */

  async createTransfer(
    data: { communityId: string; fromHostId: string; toHostId: string; otpExpiresAt: Date },
    client: PoolClient
  ): Promise<CommunityTransfer> {
    await client.query(
      `UPDATE community_ownership_transfers
          SET status = 'cancelled', updated_at = now()
        WHERE community_id = $1 AND status IN ('pending_otp', 'pending_accept')`,
      [data.communityId]
    );
    const result = await client.query<TransferRow>(
      `INSERT INTO community_ownership_transfers (community_id, from_host_id, to_host_id, otp_expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id, community_id, from_host_id, to_host_id, status, otp_expires_at, created_at, completed_at`,
      [data.communityId, data.fromHostId, data.toHostId, data.otpExpiresAt]
    );
    const row = result.rows[0];
    if (!row) throw new Error('Falha ao iniciar transferência.');
    return toTransfer(row);
  },

  async findOpenTransfer(communityId: string, client?: PoolClient): Promise<CommunityTransfer | null> {
    const runner: Runner = client ?? pool;
    const result = await runner.query<TransferRow>(
      `SELECT id, community_id, from_host_id, to_host_id, status, otp_expires_at, created_at, completed_at
         FROM community_ownership_transfers
        WHERE community_id = $1 AND status IN ('pending_otp', 'pending_accept')
        ORDER BY created_at DESC
        LIMIT 1
        ${client ? 'FOR UPDATE' : ''}`,
      [communityId]
    );
    const row = result.rows[0];
    return row ? toTransfer(row) : null;
  },

  async setTransferStatus(id: string, status: TransferStatus, client: PoolClient): Promise<void> {
    await client.query(
      `UPDATE community_ownership_transfers
          SET status = $2,
              completed_at = CASE WHEN $2 = 'completed' THEN now() ELSE completed_at END,
              updated_at = now()
        WHERE id = $1`,
      [id, status]
    );
  },

  /** Troca atómica: o anterior passa a gestor, o destinatário a responsável. */
  async swapOwner(
    communityId: string,
    fromHostId: string,
    toHostId: string,
    client: PoolClient
  ): Promise<void> {
    await client.query(
      `UPDATE community_members SET role = 'manager', updated_at = now()
        WHERE community_id = $1 AND host_id = $2 AND role = 'owner' AND status = 'active'`,
      [communityId, fromHostId]
    );
    await client.query(
      `UPDATE community_members SET role = 'owner', updated_at = now()
        WHERE community_id = $1 AND host_id = $2 AND status = 'active'`,
      [communityId, toHostId]
    );
    await client.query(
      `UPDATE communities SET owner_id = $2, updated_at = now() WHERE id = $1`,
      [communityId, toHostId]
    );
  },

  /* ──────────────────────────── Eventos e equipas ───────────────────────── */

  async listEvents(communityId: string, includePrivate: boolean): Promise<CommunityEventSummary[]> {
    const result = await query<{
      id: string;
      title: string;
      starts_at: Date;
      status: string;
      visibility: 'public' | 'private';
      public_slug: string | null;
      cover_url: string | null;
      accepted_count: number;
    }>(
      `SELECT e.id, e.title, e.starts_at, e.status, e.visibility, e.public_slug, e.cover_url,
              (SELECT count(*)::int FROM invitations i
                WHERE i.event_id = e.id AND i.rsvp_status = 'accepted') AS accepted_count
         FROM events e
        WHERE e.community_id = $1
          AND e.deleted_at IS NULL
          AND ($2::boolean OR e.visibility = 'public')
        ORDER BY e.starts_at DESC`,
      [communityId, includePrivate]
    );
    return result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      startsAt: row.starts_at,
      status: row.status,
      visibility: row.visibility,
      publicSlug: row.public_slug,
      coverUrl: row.cover_url,
      acceptedCount: Number(row.accepted_count ?? 0),
    }));
  },

  async listTeams(communityId: string): Promise<CommunityTeamSummary[]> {
    const result = await query<{
      id: string;
      name: string;
      category: string;
      member_count: number;
      event_count: number;
    }>(
      `SELECT t.id, t.name, t.category,
              (SELECT count(*)::int FROM team_members tm
                WHERE tm.team_id = t.id AND tm.removed_at IS NULL) AS member_count,
              (SELECT count(*)::int FROM team_events te
                 JOIN events e ON e.id = te.event_id AND e.deleted_at IS NULL
                WHERE te.team_id = t.id) AS event_count
         FROM teams t
        WHERE t.community_id = $1 AND t.deleted_at IS NULL
        ORDER BY lower(t.name) ASC`,
      [communityId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      memberCount: Number(row.member_count ?? 0),
      eventCount: Number(row.event_count ?? 0),
    }));
  },

  /* ─────────────────────────────── Partilhas ────────────────────────────── */

  async referralStats(communityId: string, onlyMemberId?: string): Promise<CommunityReferralStat[]> {
    const result = await query<{
      member_id: string;
      display_name: string | null;
      email: string | null;
      invitations: number;
      accepted: number;
    }>(
      `SELECT m.id AS member_id, COALESCE(p.display_name, m.display_name) AS display_name,
              COALESCE(m.email::text, h.email::text) AS email,
              count(i.id)::int AS invitations,
              count(i.id) FILTER (WHERE i.rsvp_status = 'accepted')::int AS accepted
         FROM community_members m
         LEFT JOIN hosts h ON h.id = m.host_id
         LEFT JOIN host_profiles p ON p.host_id = m.host_id
         LEFT JOIN invitations i ON i.referrer_member_id = m.id
         LEFT JOIN events e ON e.id = i.event_id
        WHERE m.community_id = $1
          AND m.status = 'active'
          AND ($2::uuid IS NULL OR m.id = $2)
          AND (i.id IS NULL OR (e.deleted_at IS NULL AND e.community_id = $1))
        GROUP BY m.id, p.display_name, m.display_name, m.email, h.email
        ORDER BY accepted DESC, invitations DESC`,
      [communityId, onlyMemberId ?? null]
    );
    return result.rows.map((row) => ({
      memberId: row.member_id,
      displayName: row.display_name,
      email: row.email,
      invitations: Number(row.invitations ?? 0),
      accepted: Number(row.accepted ?? 0),
    }));
  },
};
