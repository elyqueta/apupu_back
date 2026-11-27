import { PoolClient } from 'pg';
import { pool, query } from '../database/pool';

/** Bloco 13 — instituições e pedidos de associação de comunidades. */
export interface InstitutionRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  visibility: 'public' | 'private';
  creator_id: string;
  avatar_url: string | null;
  cover_url: string | null;
  avatar_public_id?: string | null;
  cover_public_id?: string | null;
  created_at: Date;
  community_count: number;
}

export interface LinkRequestRow {
  id: string;
  institution_id: string;
  community_id: string;
  community_name: string;
  community_slug: string;
  institution_name: string;
  direction: 'community_to_institution' | 'institution_to_community';
  kind: 'link' | 'remove';
  status: 'pending' | 'awaiting_otp' | 'approved' | 'rejected' | 'cancelled';
  community_accepted_at: Date | null;
  created_at: Date;
}

export interface LinkedCommunityRow {
  id: string;
  name: string;
  slug: string;
  visibility: 'public' | 'private';
  avatar_url: string | null;
  owner_id: string;
  member_count: number;
}

type Runner = PoolClient | typeof pool;

const INSTITUTION_SELECT = `
  SELECT i.id, i.name, i.slug, i.description, i.visibility, i.creator_id,
         i.avatar_url, i.cover_url, i.avatar_public_id, i.cover_public_id, i.created_at,
         (SELECT count(*)::int FROM communities c
           WHERE c.institution_id = i.id AND c.deleted_at IS NULL) AS community_count
    FROM institutions i
`;

const REQUEST_SELECT = `
  SELECT r.id, r.institution_id, r.community_id, c.name AS community_name, c.slug AS community_slug,
         i.name AS institution_name, r.direction, r.kind, r.status, r.community_accepted_at, r.created_at
    FROM institution_community_requests r
    JOIN communities c ON c.id = r.community_id
    JOIN institutions i ON i.id = r.institution_id
`;

export const institutionRepository = {
  async create(
    data: { name: string; slug: string; description: string | null; visibility: 'public' | 'private'; creatorId: string },
    client?: PoolClient
  ): Promise<string> {
    const runner: Runner = client ?? pool;
    const result = await runner.query<{ id: string }>(
      `INSERT INTO institutions (name, slug, description, visibility, creator_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [data.name, data.slug, data.description, data.visibility, data.creatorId]
    );
    return result.rows[0]?.id ?? '';
  },

  async slugExists(slug: string): Promise<boolean> {
    const result = await query<{ exists: boolean }>('SELECT EXISTS (SELECT 1 FROM institutions WHERE slug = $1) AS exists', [slug]);
    return Boolean(result.rows[0]?.exists);
  },

  async find(idOrSlug: string): Promise<InstitutionRow | null> {
    const byId = /^[0-9a-f-]{36}$/i.test(idOrSlug);
    const result = await query<InstitutionRow>(
      `${INSTITUTION_SELECT} WHERE ${byId ? 'i.id' : 'i.slug'} = $1 AND i.deleted_at IS NULL`,
      [idOrSlug]
    );
    return result.rows[0] ?? null;
  },

  /** As minhas (criador) ou onde sou responsável de uma comunidade associada. */
  async listForHost(hostId: string): Promise<InstitutionRow[]> {
    const result = await query<InstitutionRow>(
      `${INSTITUTION_SELECT}
        WHERE i.deleted_at IS NULL
          AND (i.creator_id = $1 OR EXISTS (
            SELECT 1 FROM communities c
             WHERE c.institution_id = i.id AND c.owner_id = $1 AND c.deleted_at IS NULL
          ))
        ORDER BY i.name ASC`,
      [hostId]
    );
    return result.rows;
  },

  async listPublic(limit: number, offset = 0, q?: string): Promise<InstitutionRow[]> {
    const values: unknown[] = [limit, offset];
    let search = '';
    if (q) {
      values.push(`%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`);
      search = `AND i.name ILIKE $${values.length} ESCAPE '\\'`;
    }
    const result = await query<InstitutionRow>(
      `${INSTITUTION_SELECT}
        WHERE i.deleted_at IS NULL AND i.visibility = 'public' ${search}
        ORDER BY i.created_at DESC, i.id ASC
        LIMIT $1 OFFSET $2`,
      values
    );
    return result.rows;
  },

  async update(
    id: string,
    changes: {
      name?: string;
      description?: string | null;
      visibility?: 'public' | 'private';
      avatar_url?: string | null;
      cover_url?: string | null;
      avatar_public_id?: string | null;
      cover_public_id?: string | null;
    }
  ): Promise<void> {
    const set: string[] = [];
    const values: unknown[] = [];
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined) continue;
      values.push(value);
      set.push(`${key} = $${values.length}`);
    }
    if (set.length === 0) return;
    values.push(id);
    await query(`UPDATE institutions SET ${set.join(', ')}, updated_at = now() WHERE id = $${values.length}`, values);
  },

  async softDelete(id: string, client: PoolClient): Promise<void> {
    await client.query('UPDATE institutions SET deleted_at = now(), updated_at = now() WHERE id = $1', [id]);
    await client.query('UPDATE communities SET institution_id = NULL WHERE institution_id = $1', [id]);
    await client.query(
      `UPDATE institution_community_requests SET status = 'cancelled', decided_at = now()
        WHERE institution_id = $1 AND status IN ('pending', 'awaiting_otp')`,
      [id]
    );
  },

  async communities(institutionId: string): Promise<LinkedCommunityRow[]> {
    const result = await query<LinkedCommunityRow>(
      `SELECT c.id, c.name, c.slug, c.visibility, c.avatar_url, c.owner_id,
              (SELECT count(*)::int FROM community_members m WHERE m.community_id = c.id AND m.status = 'active') AS member_count
         FROM communities c
        WHERE c.institution_id = $1 AND c.deleted_at IS NULL
        ORDER BY c.name ASC`,
      [institutionId]
    );
    return result.rows;
  },

  /** Comunidade (não removida) com o seu responsável e instituição actual. */
  async findCommunity(communityId: string): Promise<{ id: string; name: string; owner_id: string; institution_id: string | null } | null> {
    const result = await query<{ id: string; name: string; owner_id: string; institution_id: string | null }>(
      'SELECT id, name, owner_id, institution_id FROM communities WHERE id = $1 AND deleted_at IS NULL',
      [communityId]
    );
    return result.rows[0] ?? null;
  },

  /** Liga apenas se a comunidade ainda não tiver instituição (no máximo uma). */
  async link(communityId: string, institutionId: string, client: PoolClient): Promise<boolean> {
    const result = await client.query(
      `UPDATE communities SET institution_id = $2, updated_at = now()
        WHERE id = $1 AND institution_id IS NULL AND deleted_at IS NULL`,
      [communityId, institutionId]
    );
    return (result.rowCount ?? 0) > 0;
  },

  async unlink(communityId: string, institutionId: string, client?: PoolClient): Promise<boolean> {
    const runner: Runner = client ?? pool;
    const result = await runner.query(
      `UPDATE communities SET institution_id = NULL, updated_at = now()
        WHERE id = $1 AND institution_id = $2`,
      [communityId, institutionId]
    );
    return (result.rowCount ?? 0) > 0;
  },

  /* ─────────────────────────────── Pedidos ─────────────────────────────── */

  async createRequest(data: {
    institutionId: string;
    communityId: string;
    direction: LinkRequestRow['direction'];
    kind: LinkRequestRow['kind'];
    requestedBy: string;
    communityAccepted: boolean;
  }): Promise<string> {
    const result = await query<{ id: string }>(
      `INSERT INTO institution_community_requests
         (institution_id, community_id, direction, kind, requested_by, community_accepted_at)
       VALUES ($1, $2, $3, $4, $5, CASE WHEN $6 THEN now() END)
       RETURNING id`,
      [data.institutionId, data.communityId, data.direction, data.kind, data.requestedBy, data.communityAccepted]
    );
    return result.rows[0]?.id ?? '';
  },

  async findRequest(id: string, client?: PoolClient): Promise<LinkRequestRow | null> {
    const runner: Runner = client ?? pool;
    const result = await runner.query<LinkRequestRow>(`${REQUEST_SELECT} WHERE r.id = $1`, [id]);
    return result.rows[0] ?? null;
  },

  async openRequestsForInstitution(institutionId: string): Promise<LinkRequestRow[]> {
    const result = await query<LinkRequestRow>(
      `${REQUEST_SELECT} WHERE r.institution_id = $1 AND r.status IN ('pending', 'awaiting_otp') ORDER BY r.created_at ASC`,
      [institutionId]
    );
    return result.rows;
  },

  /** Pedidos abertos das comunidades de que a conta é responsável. */
  async openRequestsForOwner(hostId: string): Promise<LinkRequestRow[]> {
    const result = await query<LinkRequestRow>(
      `${REQUEST_SELECT}
        WHERE c.owner_id = $1 AND r.status IN ('pending', 'awaiting_otp')
        ORDER BY r.created_at ASC`,
      [hostId]
    );
    return result.rows;
  },

  async setRequestStatus(
    id: string,
    status: LinkRequestRow['status'],
    decidedBy: string | null,
    client?: PoolClient,
    otpExpiresAt?: Date
  ): Promise<void> {
    const runner: Runner = client ?? pool;
    await runner.query(
      `UPDATE institution_community_requests
          SET status = $2,
              otp_expires_at = COALESCE($4, otp_expires_at),
              decided_by = CASE WHEN $2 IN ('approved', 'rejected', 'cancelled') THEN $3 ELSE decided_by END,
              decided_at = CASE WHEN $2 IN ('approved', 'rejected', 'cancelled') THEN now() ELSE decided_at END
        WHERE id = $1`,
      [id, status, decidedBy, otpExpiresAt ?? null]
    );
  },

  async acceptByCommunity(id: string): Promise<void> {
    await query(
      `UPDATE institution_community_requests SET community_accepted_at = now() WHERE id = $1 AND status = 'pending'`,
      [id]
    );
  },

  /** Eventos públicos próximos das comunidades da instituição (agregados). */
  async upcomingEvents(institutionId: string, limit: number): Promise<
    { id: string; title: string; starts_at: Date; timezone: string; cover_url: string | null; public_slug: string; community_name: string }[]
  > {
    const result = await query<{
      id: string;
      title: string;
      starts_at: Date;
      timezone: string;
      cover_url: string | null;
      public_slug: string;
      community_name: string;
    }>(
      `SELECT e.id, e.title, e.starts_at, e.timezone, e.cover_url, e.public_slug, c.name AS community_name
         FROM events e
         JOIN communities c ON c.id = e.community_id AND c.deleted_at IS NULL
        WHERE c.institution_id = $1
          AND e.visibility = 'public' AND e.public_slug IS NOT NULL AND e.deleted_at IS NULL
          AND e.status = 'scheduled'
          AND COALESCE(e.ends_at, e.starts_at + interval '6 hours') >= now()
        ORDER BY e.starts_at ASC
        LIMIT $2`,
      [institutionId, limit]
    );
    return result.rows;
  },
};
