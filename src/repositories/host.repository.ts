import { PoolClient } from 'pg';
import { pool, query, withTransaction } from '../database/pool';
import {
  CreateHostInput,
  GoogleIdentityInput,
  HostLocale,
  HostProfile,
  HostPublicContact,
  HostStatus,
  ProfileVisibility,
  HostWithProfile,
  UpdateHostProfileInput,
} from '../types/host.types';
import { escapeLike } from '../utils/like.util';

/** Item da lista global exposta ao painel admin (sem dados sensíveis). */
export interface AdminUserListItem {
  id: string;
  email: string;
  status: HostStatus;
  is_super_admin: boolean;
  email_verified_at: string | null;
  created_at: string;
  display_name: string | null;
  /** Dados de perfil usados pelos cards e pelo detalhe do painel admin. */
  avatar_url: string | null;
  cover_url: string | null;
  phone: string | null;
  birth_date: string | null;
  locale: string;
  timezone: string;
  profile_complete: boolean;
}

interface HostRow {
  id: string;
  email: string;
  password_hash: string | null;
  email_verified_at: Date | null;
  is_super_admin: boolean;
  status: HostStatus;
  failed_login_attempts: number;
  locked_until: Date | null;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
  display_name: string | null;
  phone: string | null;
  birth_date: string | null;
  locale: HostLocale;
  timezone: string;
  avatar_url: string | null;
  avatar_hash: string | null;
  avatar_public_id: string | null;
  cover_url: string | null;
  cover_hash: string | null;
  cover_public_id: string | null;
  profile_visibility: ProfileVisibility;
  profile_created_at: Date;
  profile_updated_at: Date;
}

function toHost(row: HostRow): HostWithProfile {
  const profile: HostProfile = {
    hostId: row.id,
    displayName: row.display_name,
    phone: row.phone,
    birthDate: row.birth_date,
    locale: row.locale,
    timezone: row.timezone,
    avatarUrl: row.avatar_url,
    avatarHash: row.avatar_hash,
    avatarPublicId: row.avatar_public_id,
    coverUrl: row.cover_url,
    coverHash: row.cover_hash,
    coverPublicId: row.cover_public_id,
    visibility: row.profile_visibility,
    createdAt: row.profile_created_at,
    updatedAt: row.profile_updated_at,
  };

  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    emailVerifiedAt: row.email_verified_at,
    isSuperAdmin: row.is_super_admin,
    status: row.status,
    failedLoginAttempts: row.failed_login_attempts,
    lockedUntil: row.locked_until,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    profile,
  };
}

/** Vista segura de uma conta para o painel admin. */
export function toAdminUserListItem(host: HostWithProfile): AdminUserListItem {
  return {
    id: host.id,
    email: host.email,
    status: host.status,
    is_super_admin: host.isSuperAdmin,
    email_verified_at: host.emailVerifiedAt?.toISOString() ?? null,
    created_at: host.createdAt.toISOString(),
    display_name: host.profile.displayName,
    avatar_url: host.profile.avatarUrl,
    cover_url: host.profile.coverUrl,
    phone: host.profile.phone,
    birth_date: host.profile.birthDate,
    locale: host.profile.locale,
    timezone: host.profile.timezone,
    profile_complete: Boolean(host.profile.birthDate),
  };
}

const SELECT_COLUMNS = `
  h.id, h.email::text AS email, h.password_hash, h.email_verified_at,
  h.is_super_admin, h.status,
  h.failed_login_attempts, h.locked_until, h.last_login_at, h.created_at, h.updated_at,
  p.display_name, p.phone, p.birth_date::text AS birth_date, p.locale, p.timezone,
  p.avatar_url, p.avatar_hash, p.avatar_public_id,
  p.cover_url, p.cover_hash, p.cover_public_id, h.profile_visibility,
  p.created_at AS profile_created_at, p.updated_at AS profile_updated_at
`;

const FROM_HOSTS = `
  FROM hosts h
  JOIN host_profiles p ON p.host_id = h.id
`;

export const hostRepository = {
  async create(input: CreateHostInput, client?: PoolClient): Promise<HostWithProfile> {
    const runner = client ?? pool;
    const hostResult = await runner.query<{ id: string }>(
      `INSERT INTO hosts (email, password_hash, google_id, email_verified_at)
       VALUES ($1, $2, $3, CASE WHEN $4 THEN now() ELSE NULL END)
       RETURNING id`,
      [input.email, input.passwordHash, input.googleId ?? null, input.emailVerified ?? false]
    );

    const hostId = hostResult.rows[0]?.id;
    if (!hostId) throw new Error('Falha ao criar anfitrião: nenhum id devolvido.');

    await runner.query(
      `INSERT INTO host_profiles (host_id, display_name, avatar_url)
       VALUES ($1, $2, $3)`,
      [hostId, input.displayName, input.avatarUrl ?? null]
    );

    const created = await this.findById(hostId, client);
    if (!created) throw new Error('Falha ao ler o anfitrião criado.');
    return created;
  },

  async findById(id: string, client?: PoolClient): Promise<HostWithProfile | null> {
    const runner = client ?? pool;
    const result = await runner.query<HostRow>(
      `SELECT ${SELECT_COLUMNS} ${FROM_HOSTS} WHERE h.id = $1`,
      [id]
    );
    const row = result.rows[0];
    return row ? toHost(row) : null;
  },

  async findByIdForUpdate(id: string, client: PoolClient): Promise<HostWithProfile | null> {
    const result = await client.query<HostRow>(
      `SELECT ${SELECT_COLUMNS} ${FROM_HOSTS} WHERE h.id = $1 FOR UPDATE OF h`,
      [id]
    );
    const row = result.rows[0];
    return row ? toHost(row) : null;
  },

  async findByEmail(email: string, client?: PoolClient): Promise<HostWithProfile | null> {
    const runner = client ?? pool;
    const result = await runner.query<HostRow>(
      `SELECT ${SELECT_COLUMNS} ${FROM_HOSTS} WHERE h.email = $1`,
      [email]
    );
    const row = result.rows[0];
    return row ? toHost(row) : null;
  },

  async findByGoogleId(googleId: string, client?: PoolClient): Promise<HostWithProfile | null> {
    const runner = client ?? pool;
    const result = await runner.query<HostRow>(
      `SELECT ${SELECT_COLUMNS} ${FROM_HOSTS} WHERE h.google_id = $1`,
      [googleId]
    );
    const row = result.rows[0];
    return row ? toHost(row) : null;
  },

  /**
   * Resolve uma identidade Google para uma conta local.
   *
   * Ordem: google_id -> email -> criação. Tudo numa transação e com
   * `ON CONFLICT (email)` para que dois logins simultâneos com o mesmo
   * email não criem contas duplicadas. O `google_id` nunca é sobrescrito
   * se já pertencer a outra conta.
   */
  async findOrCreateFromGoogle(input: GoogleIdentityInput): Promise<HostWithProfile> {
    return withTransaction(async (client) => {
      const byGoogleId = await this.findByGoogleId(input.googleId, client);
      if (byGoogleId) return byGoogleId;

      const hostResult = await client.query<{ id: string }>(
        `INSERT INTO hosts (email, password_hash, google_id, email_verified_at)
         VALUES ($1, NULL, $2, CASE WHEN $3 THEN now() ELSE NULL END)
         ON CONFLICT (email) DO UPDATE
           SET google_id = COALESCE(hosts.google_id, EXCLUDED.google_id),
               email_verified_at = CASE
                 WHEN $3 THEN COALESCE(hosts.email_verified_at, now())
                 ELSE hosts.email_verified_at
               END,
               updated_at = now()
         RETURNING id`,
        [input.email, input.googleId, input.emailVerified]
      );

      const hostId = hostResult.rows[0]?.id;
      if (!hostId) throw new Error('Falha ao ligar conta Google: nenhum id devolvido.');

      await client.query(
        `INSERT INTO host_profiles (host_id, display_name, avatar_url)
         VALUES ($1, $2, $3)
         ON CONFLICT (host_id) DO UPDATE
           SET display_name = CASE
                 WHEN NULLIF(btrim(host_profiles.display_name), '') IS NULL
                   THEN EXCLUDED.display_name
                 ELSE host_profiles.display_name
               END,
               avatar_url = COALESCE(host_profiles.avatar_url, EXCLUDED.avatar_url),
               updated_at = now()`,
        [hostId, input.displayName, input.avatarUrl]
      );

      const user = await this.findById(hostId, client);
      if (!user) throw new Error('Falha ao ler conta Google após criação/ligação.');
      return user;
    });
  },

  async emailExists(email: string): Promise<boolean> {
    const result = await query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM hosts WHERE email = $1) AS exists',
      [email]
    );
    return result.rows[0]?.exists ?? false;
  },

  /**
   * Dados de contacto para a página pública do convite.
   *
   * Nome e email vêm sempre do evento; telefone e avatar só do perfil
   * de uma conta verificada e ativa com o mesmo email. Uma conta sem
   * verificação, suspensa ou inexistente não expõe mais nada.
   */
  async findPublicContactByEventId(eventId: string): Promise<HostPublicContact | null> {
    const result = await query<{
      host_name: string;
      host_email: string;
      phone: string | null;
      avatar_url: string | null;
    }>(
      `SELECT e.host_name, e.host_email, p.phone, p.avatar_url
         FROM events e
         LEFT JOIN hosts h
           ON h.email = e.host_email
          AND h.email_verified_at IS NOT NULL
          AND h.status = 'active'
         LEFT JOIN host_profiles p ON p.host_id = h.id
        WHERE e.id = $1
        LIMIT 1`,
      [eventId]
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      name: row.host_name,
      email: row.host_email,
      phone: row.phone,
      avatarUrl: row.avatar_url,
    };
  },

  async setEmailVerified(id: string, client?: PoolClient): Promise<void> {
    const runner = client ?? pool;
    await runner.query(
      `UPDATE hosts
          SET email_verified_at = COALESCE(email_verified_at, now()), updated_at = now()
        WHERE id = $1`,
      [id]
    );
  },

  async updatePassword(id: string, passwordHash: string, client?: PoolClient): Promise<void> {
    const runner = client ?? pool;
    await runner.query(
      `UPDATE hosts
          SET password_hash = $2, updated_at = now()
        WHERE id = $1`,
      [id, passwordHash]
    );
  },

  async setStatus(id: string, status: HostStatus, client?: PoolClient): Promise<void> {
    const runner = client ?? pool;
    await runner.query(
      `UPDATE hosts SET status = $2, updated_at = now() WHERE id = $1`,
      [id, status]
    );
  },

  async registerSuccessfulLogin(id: string): Promise<void> {
    await query(
      `UPDATE hosts
          SET failed_login_attempts = 0, locked_until = NULL,
              last_login_at = now(), updated_at = now()
        WHERE id = $1`,
      [id]
    );
  },

  async registerFailedLogin(
    id: string,
    maxAttempts: number,
    lockMinutes: number
  ): Promise<{ lockedUntil: Date | null }> {
    const result = await query<{ locked_until: Date | null }>(
      `UPDATE hosts
          SET failed_login_attempts = failed_login_attempts + 1,
              locked_until = CASE
                WHEN failed_login_attempts + 1 >= $2
                  THEN now() + make_interval(mins => $3)
                ELSE locked_until
              END,
              updated_at = now()
        WHERE id = $1
        RETURNING locked_until`,
      [id, maxAttempts, lockMinutes]
    );

    return { lockedUntil: result.rows[0]?.locked_until ?? null };
  },

  async updateProfile(
    hostId: string,
    changes: UpdateHostProfileInput,
    client?: PoolClient
  ): Promise<HostProfile> {
    const runner = client ?? pool;
    const set: string[] = [];
    const values: unknown[] = [];

    const mapping: Array<[keyof UpdateHostProfileInput, string]> = [
      ['displayName', 'display_name'],
      ['phone', 'phone'],
      ['birthDate', 'birth_date'],
      ['locale', 'locale'],
      ['timezone', 'timezone'],
      ['avatarUrl', 'avatar_url'],
      ['avatarHash', 'avatar_hash'],
      ['avatarPublicId', 'avatar_public_id'],
      ['coverUrl', 'cover_url'],
      ['coverHash', 'cover_hash'],
      ['coverPublicId', 'cover_public_id'],
    ];

    for (const [key, column] of mapping) {
      if (key in changes) {
        values.push(changes[key]);
        set.push(`${column} = $${values.length}`);
      }
    }

    if (changes.visibility !== undefined) {
      await runner.query(
        `UPDATE hosts SET profile_visibility = $1, updated_at = now() WHERE id = $2`,
        [changes.visibility, hostId]
      );
    }

    if (set.length > 0) {
      values.push(hostId);
      await runner.query(
        `UPDATE host_profiles
            SET ${set.join(', ')}, updated_at = now()
          WHERE host_id = $${values.length}`,
        values
      );
    }

    const result = await runner.query<HostRow>(
      `SELECT ${SELECT_COLUMNS} ${FROM_HOSTS} WHERE h.id = $1`,
      [hostId]
    );
    const row = result.rows[0];
    if (!row) throw new Error('Perfil de anfitrião não encontrado.');
    return toHost(row).profile;
  },

  /**
   * Pesquisa de perfis para utilizadores (amigos, comunidades).
   *
   * Só devolve contas activas, verificadas e com perfil **público**: um
   * perfil privado nunca aparece em pesquisa nenhuma.
   */
  async searchPublicProfiles(
    q: string,
    limit: number,
    excludeHostId?: string
  ): Promise<HostWithProfile[]> {
    const result = await query<HostRow>(
      `SELECT ${SELECT_COLUMNS} ${FROM_HOSTS}
        WHERE h.profile_visibility = 'public'
          AND h.status = 'active'
          AND h.email_verified_at IS NOT NULL
          AND ($3::uuid IS NULL OR h.id <> $3)
          AND p.display_name ILIKE $1 ESCAPE '\\'
        ORDER BY p.display_name ASC, h.id ASC
        LIMIT $2`,
      [`%${escapeLike(q)}%`, limit, excludeHostId ?? null]
    );
    return result.rows.map(toHost);
  },

  /** Lista global de contas para o painel admin. */
  async listForAdmin(filters: {
    q?: string;
    role?: 'admin' | 'host';
    status?: HostStatus;
    from?: Date;
    order: 'asc' | 'desc';
    limit: number;
    offset: number;
  }): Promise<{ items: AdminUserListItem[]; total: number }> {
    const values: unknown[] = [];
    const conditions: string[] = [];

    const push = (sql: string, value: unknown): void => {
      values.push(value);
      conditions.push(sql.replace('?', `$${values.length}`));
    };

    if (filters.q) {
      push('(h.email::text ILIKE ? OR p.display_name ILIKE ?)', `%${filters.q}%`);
    }
    if (filters.role) push('h.is_super_admin = ?', filters.role === 'admin');
    if (filters.status) push('h.status = ?', filters.status);
    if (filters.from) push('h.created_at >= ?', filters.from);

    const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const direction = filters.order === 'asc' ? 'ASC' : 'DESC';

    const [count, list] = await Promise.all([
      query<{ total: string }>(
        `SELECT count(*)::text AS total FROM hosts h JOIN host_profiles p ON p.host_id = h.id ${where}`,
        values
      ),
      query<HostRow>(
        `SELECT ${SELECT_COLUMNS} ${FROM_HOSTS}${where}
          ORDER BY h.created_at ${direction}, h.id ${direction}
          LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, filters.limit, filters.offset]
      ),
    ]);

    return {
      items: list.rows.map((row) => toAdminUserListItem(toHost(row))),
      total: Number(count.rows[0]?.total ?? '0'),
    };
  },
};
