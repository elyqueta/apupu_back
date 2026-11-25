import { PoolClient } from 'pg';
import { pool, query } from '../database/pool';
import { escapeLike } from '../utils/like.util';

/**
 * Bloco 12 — consultas públicas (feed, pesquisa, perfis) e amizades.
 *
 * Regras transversais (testadas em `tests/bloco12.test.ts`):
 * - eventos: só `visibility = 'public'`, não removidos, não em rascunho,
 *   não cancelados; no feed só próximos ou a decorrer;
 * - pessoas: só contas activas, verificadas e com `profile_visibility = 'public'`;
 * - comunidades: só `visibility = 'public'` e não removidas;
 * - nunca devolve email, telefone nem data de nascimento.
 */

export const PUBLIC_EVENT_SQL = `
  e.visibility = 'public'
  AND e.deleted_at IS NULL
  AND e.public_slug IS NOT NULL
  AND e.status IN ('scheduled', 'completed', 'cancelled')
`;

const EFFECTIVE_END_SQL = `CASE WHEN e.ends_at IS NOT NULL THEN e.ends_at ELSE (((e.starts_at AT TIME ZONE COALESCE(NULLIF(e.timezone,''),'Africa/Luanda'))::date + 1)::timestamp AT TIME ZONE COALESCE(NULLIF(e.timezone,''),'Africa/Luanda')) END`;
const EFFECTIVE_STATUS_SQL = `CASE
  WHEN e.status = 'cancelled' THEN 'cancelled'
  WHEN e.status = 'draft' THEN 'draft'
  WHEN e.status = 'completed' THEN 'completed'
  WHEN (${EFFECTIVE_END_SQL}) <= now() THEN 'completed'
  ELSE e.status
END`;
const STATUS_GROUP_SQL = `CASE WHEN (${EFFECTIVE_STATUS_SQL}) = 'cancelled' THEN 2 WHEN (${EFFECTIVE_STATUS_SQL}) = 'completed' THEN 1 ELSE 0 END`;
const BLOCO15_ORDER_SQL = `${STATUS_GROUP_SQL} ASC, CASE WHEN ${STATUS_GROUP_SQL} = 0 THEN e.starts_at END ASC, CASE WHEN ${STATUS_GROUP_SQL} > 0 THEN e.starts_at END DESC, e.id ASC`;

/** Próximos ou a decorrer (fim, ou início + 6 h quando não há fim). */
export const UPCOMING_SQL = `COALESCE(e.ends_at, e.starts_at + interval '6 hours') >= now()`;

export const PUBLIC_PERSON_SQL = `
  h.profile_visibility = 'public'
  AND h.status = 'active'
  AND h.email_verified_at IS NOT NULL
`;

export interface FeedEventRow {
  id: string;
  title: string;
  category: string | null;
  starts_at: Date;
  ends_at: Date | null;
  timezone: string;
  status: string;
  location_type: 'venue' | 'online';
  location_name: string | null;
  cover_url: string | null;
  template_id: string | null;
  theme: { mode?: string; palette?: string } | null;
  public_slug: string;
  host_name: string;
  show_attendee_count: boolean;
  attendee_count: number;
  community_name: string | null;
  community_slug: string | null;
  host_avatar_url: string | null;
  excerpt: string | null;
  created_at: Date;
}

export interface FeedCommunityRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  member_count: number;
}

export interface FeedPersonRow {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  cover_url: string | null;
}

const EVENT_SELECT = `
  SELECT e.id, e.title, e.category, e.starts_at, e.ends_at, e.timezone, e.status,
         e.location_type, e.location_name, e.cover_url, e.template_id, e.theme,
         e.public_slug, e.host_name, e.show_attendee_count,
         (SELECT count(*)::int FROM invitations i
           WHERE i.event_id = e.id AND i.rsvp_status = 'accepted') AS attendee_count,
         c.name AS community_name, c.slug AS community_slug,
         hp.avatar_url AS host_avatar_url,
         left(e.message, 220) AS excerpt,
         e.created_at
    FROM events e
    LEFT JOIN communities c
      ON c.id = e.community_id AND c.deleted_at IS NULL AND c.visibility = 'public'
    LEFT JOIN host_profiles hp ON hp.host_id = e.host_id
`;

const COMMUNITY_SELECT = `
  SELECT c.id, c.name, c.slug, c.description, c.avatar_url, c.cover_url,
         (SELECT count(*)::int FROM community_members m
           WHERE m.community_id = c.id AND m.status = 'active') AS member_count
    FROM communities c
`;

const PERSON_SELECT = `
  SELECT h.id, p.display_name, p.avatar_url, p.cover_url
    FROM hosts h
    JOIN host_profiles p ON p.host_id = h.id
`;

function like(q: string): string {
  return `%${escapeLike(q)}%`;
}

export const socialRepository = {
  /* ─────────────────────────────── Feed ─────────────────────────────── */

  async feedEvents(opts: { q?: string; category?: string; offset: number; limit: number }): Promise<FeedEventRow[]> {
    const values: unknown[] = [opts.limit, opts.offset];
    // Bloco 15: ativos/futuros primeiro, depois passados, depois cancelados.
    const where = [PUBLIC_EVENT_SQL];
    if (opts.q) {
      values.push(like(opts.q));
      where.push(`e.title ILIKE $${values.length} ESCAPE '\\'`);
    }
    if (opts.category) {
      values.push(opts.category);
      where.push(`e.category = $${values.length}`);
    }
    const result = await query<FeedEventRow>(
      `${EVENT_SELECT}
        WHERE ${where.join(' AND ')}
        ORDER BY ${BLOCO15_ORDER_SQL}
        LIMIT $1 OFFSET $2`,
      values
    );
    return result.rows;
  },

  async feedCommunities(opts: { q?: string; offset: number; limit: number }): Promise<FeedCommunityRow[]> {
    const values: unknown[] = [opts.limit, opts.offset];
    const where = ["c.visibility = 'public'", 'c.deleted_at IS NULL'];
    if (opts.q) {
      values.push(like(opts.q));
      where.push(`c.name ILIKE $${values.length} ESCAPE '\\'`);
    }
    const result = await query<FeedCommunityRow>(
      `${COMMUNITY_SELECT}
        WHERE ${where.join(' AND ')}
        ORDER BY c.created_at DESC, c.id ASC
        LIMIT $1 OFFSET $2`,
      values
    );
    return result.rows;
  },

  async feedPeople(opts: { q?: string; offset: number; limit: number }): Promise<FeedPersonRow[]> {
    const values: unknown[] = [opts.limit, opts.offset];
    const where = [PUBLIC_PERSON_SQL, "COALESCE(btrim(p.display_name), '') <> ''"];
    if (opts.q) {
      values.push(like(opts.q));
      where.push(`p.display_name ILIKE $${values.length} ESCAPE '\\'`);
    }
    const result = await query<FeedPersonRow>(
      `${PERSON_SELECT}
        WHERE ${where.join(' AND ')}
        ORDER BY lower(p.display_name) ASC, h.id ASC
        LIMIT $1 OFFSET $2`,
      values
    );
    return result.rows;
  },

  /* ──────────────────────────── Perfis públicos ─────────────────────────── */

  async findPublicPerson(id: string): Promise<FeedPersonRow | null> {
    const result = await query<FeedPersonRow>(`${PERSON_SELECT} WHERE h.id = $1 AND ${PUBLIC_PERSON_SQL}`, [id]);
    return result.rows[0] ?? null;
  },

  /** Perfil visível a uma conta: público, ou o próprio. */
  async findVisiblePerson(id: string, viewerId: string): Promise<FeedPersonRow | null> {
    const result = await query<FeedPersonRow>(
      `${PERSON_SELECT}
        WHERE h.id = $1
          AND h.status = 'active'
          AND (h.id = $2 OR (${PUBLIC_PERSON_SQL}))`,
      [id, viewerId]
    );
    return result.rows[0] ?? null;
  },

  async hostedEvents(hostId: string, past: boolean, offset: number, limit: number): Promise<FeedEventRow[]> {
    const ended = `(${EFFECTIVE_END_SQL}) <= now() OR ${EFFECTIVE_STATUS_SQL} IN ('completed', 'cancelled')`;
    const result = await query<FeedEventRow>(
      `${EVENT_SELECT}
        WHERE e.host_id = $1 AND ${PUBLIC_EVENT_SQL}
          AND ${past ? ended : `NOT (${ended})`}
        ORDER BY ${BLOCO15_ORDER_SQL}
        LIMIT $2 OFFSET $3`,
      [hostId, limit, offset]
    );
    return result.rows;
  },

  async communityEvents(communityId: string, past: boolean, offset: number, limit: number): Promise<FeedEventRow[]> {
    const ended = `(${EFFECTIVE_END_SQL}) <= now() OR ${EFFECTIVE_STATUS_SQL} IN ('completed', 'cancelled')`;
    const result = await query<FeedEventRow>(
      `${EVENT_SELECT}
        WHERE e.community_id = $1 AND ${PUBLIC_EVENT_SQL}
          AND ${past ? ended : `NOT (${ended})`}
        ORDER BY ${BLOCO15_ORDER_SQL}
        LIMIT $2 OFFSET $3`,
      [communityId, limit, offset]
    );
    return result.rows;
  },

  async findPublicCommunity(slug: string): Promise<FeedCommunityRow | null> {
    const result = await query<FeedCommunityRow>(
      `${COMMUNITY_SELECT} WHERE c.slug = $1 AND c.visibility = 'public' AND c.deleted_at IS NULL`,
      [slug]
    );
    return result.rows[0] ?? null;
  },

  /** Comunidades públicas onde a pessoa é membro activo. */
  async publicCommunitiesOf(hostId: string): Promise<FeedCommunityRow[]> {
    const result = await query<FeedCommunityRow>(
      `${COMMUNITY_SELECT}
        WHERE c.visibility = 'public' AND c.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM community_members m
                       WHERE m.community_id = c.id AND m.host_id = $1 AND m.status = 'active')
        ORDER BY c.name ASC
        LIMIT 24`,
      [hostId]
    );
    return result.rows;
  },

  /** Comunidades em comum (públicas ou privadas onde ambos são membros activos). */
  async mutualCommunities(a: string, b: string): Promise<FeedCommunityRow[]> {
    const result = await query<FeedCommunityRow>(
      `${COMMUNITY_SELECT}
        WHERE c.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM community_members m WHERE m.community_id = c.id AND m.host_id = $1 AND m.status = 'active')
          AND EXISTS (SELECT 1 FROM community_members m WHERE m.community_id = c.id AND m.host_id = $2 AND m.status = 'active')
        ORDER BY c.name ASC
        LIMIT 12`,
      [a, b]
    );
    return result.rows;
  },

  /* ─────────────────────────────── Amizades ─────────────────────────────── */

  async friendCount(hostId: string): Promise<number> {
    const result = await query<{ total: number }>(
      `SELECT count(*)::int AS total FROM friendships
        WHERE status = 'accepted' AND (requester_id = $1 OR addressee_id = $1)`,
      [hostId]
    );
    return Number(result.rows[0]?.total ?? 0);
  },

  /** Amigos em comum (só nome e foto; perfis privados aparecem só como contagem). */
  async mutualFriends(a: string, b: string): Promise<{ total: number; preview: FeedPersonRow[] }> {
    const friendsOf = (param: string) => `
      SELECT CASE WHEN f.requester_id = ${param} THEN f.addressee_id ELSE f.requester_id END AS friend_id
        FROM friendships f
       WHERE f.status = 'accepted' AND (f.requester_id = ${param} OR f.addressee_id = ${param})`;
    const result = await query<FeedPersonRow & { total: number }>(
      `WITH mutual AS (
         (${friendsOf('$1')}) INTERSECT (${friendsOf('$2')})
       )
       SELECT h.id, p.display_name, p.avatar_url, p.cover_url,
              (SELECT count(*)::int FROM mutual) AS total
         FROM mutual
         JOIN hosts h ON h.id = mutual.friend_id
         JOIN host_profiles p ON p.host_id = h.id
        WHERE ${PUBLIC_PERSON_SQL}
        ORDER BY lower(COALESCE(p.display_name, '')) ASC
        LIMIT 6`,
      [a, b]
    );
    const total = result.rows[0]?.total ?? (await this.countMutual(a, b));
    return { total: Number(total), preview: result.rows.map(({ total: _t, ...row }) => row) };
  },

  async countMutual(a: string, b: string): Promise<number> {
    const result = await query<{ total: number }>(
      `SELECT count(*)::int AS total FROM (
         SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END AS id
           FROM friendships WHERE status = 'accepted' AND (requester_id = $1 OR addressee_id = $1)
         INTERSECT
         SELECT CASE WHEN requester_id = $2 THEN addressee_id ELSE requester_id END
           FROM friendships WHERE status = 'accepted' AND (requester_id = $2 OR addressee_id = $2)
       ) mutual`,
      [a, b]
    );
    return Number(result.rows[0]?.total ?? 0);
  },

  async findFriendship(
    a: string,
    b: string,
    client?: PoolClient
  ): Promise<{ id: string; requester_id: string; addressee_id: string; status: string } | null> {
    const runner = client ?? pool;
    const result = await runner.query<{ id: string; requester_id: string; addressee_id: string; status: string }>(
      `SELECT id, requester_id, addressee_id, status FROM friendships
        WHERE LEAST(requester_id, addressee_id) = LEAST($1::uuid, $2::uuid)
          AND GREATEST(requester_id, addressee_id) = GREATEST($1::uuid, $2::uuid)`,
      [a, b]
    );
    return result.rows[0] ?? null;
  },

  async findFriendshipById(id: string): Promise<{ id: string; requester_id: string; addressee_id: string; status: string } | null> {
    const result = await query<{ id: string; requester_id: string; addressee_id: string; status: string }>(
      'SELECT id, requester_id, addressee_id, status FROM friendships WHERE id = $1',
      [id]
    );
    return result.rows[0] ?? null;
  },

  async requestsSentToday(requesterId: string): Promise<number> {
    const result = await query<{ total: number }>(
      `SELECT count(*)::int AS total FROM friendships
        WHERE requester_id = $1 AND created_at >= now() - interval '1 day'`,
      [requesterId]
    );
    return Number(result.rows[0]?.total ?? 0);
  },

  /** Cria ou reabre o pedido (um pedido recusado pode voltar a ser feito). */
  async upsertRequest(requesterId: string, addresseeId: string): Promise<string> {
    const existing = await this.findFriendship(requesterId, addresseeId);
    if (existing) {
      await query(
        `UPDATE friendships
            SET requester_id = $2, addressee_id = $3, status = 'pending',
                created_at = now(), responded_at = NULL
          WHERE id = $1`,
        [existing.id, requesterId, addresseeId]
      );
      return existing.id;
    }
    const result = await query<{ id: string }>(
      `INSERT INTO friendships (requester_id, addressee_id) VALUES ($1, $2) RETURNING id`,
      [requesterId, addresseeId]
    );
    return result.rows[0]?.id ?? '';
  },

  async respond(id: string, status: 'accepted' | 'rejected'): Promise<void> {
    await query(`UPDATE friendships SET status = $2, responded_at = now() WHERE id = $1`, [id, status]);
  },

  async remove(id: string): Promise<void> {
    await query('DELETE FROM friendships WHERE id = $1', [id]);
  },

  /** Amigos (aceites) e pedidos recebidos/enviados, com nome e foto. */
  async listForHost(hostId: string): Promise<
    {
      id: string;
      status: string;
      direction: 'incoming' | 'outgoing';
      other_id: string;
      display_name: string | null;
      avatar_url: string | null;
      created_at: Date;
    }[]
  > {
    const result = await query<{
      id: string;
      status: string;
      direction: 'incoming' | 'outgoing';
      other_id: string;
      display_name: string | null;
      avatar_url: string | null;
      created_at: Date;
    }>(
      `SELECT f.id, f.status,
              CASE WHEN f.requester_id = $1 THEN 'outgoing' ELSE 'incoming' END AS direction,
              o.id AS other_id, p.display_name, p.avatar_url, f.created_at
         FROM friendships f
         JOIN hosts o ON o.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
         JOIN host_profiles p ON p.host_id = o.id
        WHERE (f.requester_id = $1 OR f.addressee_id = $1)
          AND f.status IN ('pending', 'accepted')
          AND o.status = 'active'
        ORDER BY f.status DESC, lower(COALESCE(p.display_name, '')) ASC`,
      [hostId]
    );
    return result.rows;
  },
};
