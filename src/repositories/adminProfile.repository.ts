import { query } from '../database/pool';

/**
 * Leituras de perfil para o painel admin (Bloco 8).
 *
 * São consultas de relatório: só devolvem campos necessários ao detalhe e ao
 * PDF, nunca hashes, tokens nem `public_id` do Cloudinary. O acesso é
 * garantido pelas rotas (`hostAccountAuth` + `requireSuperAdmin`), não por
 * estas funções.
 */

export interface AdminProfileEvent {
  id: string;
  title: string;
  status: string;
  starts_at: string;
  created_at: string;
  guest_count: number;
}

export interface AdminProfileTeam {
  id: string;
  name: string;
  member_count: number;
  event_title: string | null;
}

export interface AdminReportHost {
  id: string;
  email: string;
  display_name: string | null;
  phone: string | null;
  locale: string;
  timezone: string;
  avatar_url: string | null;
  cover_url: string | null;
  status: string;
  is_super_admin: boolean;
  created_at: string;
  events_count: number;
  teams_count: number;
  invitations_count: number;
}

function asCount(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function iso(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

export const adminProfileRepository = {
  /** Eventos próprios ou geridos pela conta, mais recentes primeiro. */
  async eventsForUser(userId: string, limit: number): Promise<AdminProfileEvent[]> {
    const result = await query<{
      id: string;
      title: string;
      status: string;
      starts_at: Date | null;
      created_at: Date | null;
      guest_count: string | number;
    }>(
      `SELECT e.id::text, e.title, e.status, e.starts_at, e.created_at,
              (SELECT count(*)::text FROM invitations i WHERE i.event_id = e.id) AS guest_count
         FROM events e
        WHERE e.host_id = $1
           OR EXISTS (
                SELECT 1 FROM event_managers em
                 WHERE em.event_id = e.id
                   AND em.email = (SELECT h.email FROM hosts h WHERE h.id = $1)
                   AND em.revoked_at IS NULL
              )
        ORDER BY e.created_at DESC NULLS LAST, e.id DESC
        LIMIT $2`,
      [userId, limit]
    );

    return result.rows.map((row) => ({
      id: String(row.id),
      title: row.title,
      status: row.status,
      starts_at: iso(row.starts_at) ?? '',
      created_at: iso(row.created_at) ?? '',
      guest_count: asCount(row.guest_count),
    }));
  },

  /** Equipas dos eventos da conta (próprios ou geridos). */
  async teamsForUser(userId: string, limit: number): Promise<AdminProfileTeam[]> {
    const result = await query<{
      id: string;
      name: string;
      member_count: string | number;
      event_title: string | null;
    }>(
      `SELECT t.id::text, t.name,
              (SELECT count(*)::text FROM team_members tm
                WHERE tm.team_id = t.id AND tm.removed_at IS NULL) AS member_count,
              e.title AS event_title
         FROM teams t
         JOIN events e ON e.id = t.event_id
        WHERE t.deleted_at IS NULL
          AND (
            e.host_id = $1
            OR EXISTS (
              SELECT 1 FROM event_managers em
               WHERE em.event_id = e.id
                 AND em.email = (SELECT h.email FROM hosts h WHERE h.id = $1)
                 AND em.revoked_at IS NULL
            )
          )
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT $2`,
      [userId, limit]
    );

    return result.rows.map((row) => ({
      id: String(row.id),
      name: row.name,
      member_count: asCount(row.member_count),
      event_title: row.event_title,
    }));
  },

  /**
   * Todas as contas com contadores agregados, para o relatório global.
   * Os contadores são subconsultas indexadas; a paginação é feita em memória
   * pelo chamador (o job corre fora do pedido HTTP).
   */
  async allUsersForReport(): Promise<AdminReportHost[]> {
    const result = await query<{
      id: string;
      email: string;
      display_name: string | null;
      phone: string | null;
      locale: string;
      timezone: string;
      avatar_url: string | null;
      cover_url: string | null;
      status: string;
      is_super_admin: boolean;
      created_at: Date;
      events_count: string | number;
      teams_count: string | number;
      invitations_count: string | number;
    }>(
      `SELECT h.id::text, h.email::text, p.display_name, p.phone, p.locale, p.timezone,
              p.avatar_url, p.cover_url, h.status, h.is_super_admin, h.created_at,
              (SELECT count(*)::text FROM events e WHERE e.host_id = h.id) AS events_count,
              (SELECT count(*)::text FROM teams t
                JOIN events e ON e.id = t.event_id
                WHERE e.host_id = h.id AND t.deleted_at IS NULL) AS teams_count,
              (SELECT count(*)::text FROM invitations i
                JOIN events e ON e.id = i.event_id
                WHERE e.host_id = h.id) AS invitations_count
         FROM hosts h
         JOIN host_profiles p ON p.host_id = h.id
        ORDER BY h.created_at ASC, h.id ASC`
    );

    return result.rows.map((row) => ({
      id: String(row.id),
      email: row.email,
      display_name: row.display_name,
      phone: row.phone,
      locale: row.locale,
      timezone: row.timezone,
      avatar_url: row.avatar_url,
      cover_url: row.cover_url,
      status: row.status,
      is_super_admin: row.is_super_admin,
      created_at: iso(row.created_at) ?? '',
      events_count: asCount(row.events_count),
      teams_count: asCount(row.teams_count),
      invitations_count: asCount(row.invitations_count),
    }));
  },
};
