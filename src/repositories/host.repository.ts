import { PoolClient } from 'pg';
import { pool, query } from '../database/pool';
import {
  CreateHostInput,
  HostLocale,
  HostProfile,
  HostStatus,
  HostWithProfile,
  UpdateHostProfileInput,
} from '../types/host.types';

interface HostRow {
  id: string;
  email: string;
  password_hash: string;
  email_verified_at: Date | null;
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
  cover_url: string | null;
  cover_hash: string | null;
  cover_public_id: string | null;
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
    coverUrl: row.cover_url,
    coverHash: row.cover_hash,
    coverPublicId: row.cover_public_id,
    createdAt: row.profile_created_at,
    updatedAt: row.profile_updated_at,
  };

  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    emailVerifiedAt: row.email_verified_at,
    status: row.status,
    failedLoginAttempts: row.failed_login_attempts,
    lockedUntil: row.locked_until,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    profile,
  };
}

const SELECT_COLUMNS = `
  h.id, h.email::text AS email, h.password_hash, h.email_verified_at, h.status,
  h.failed_login_attempts, h.locked_until, h.last_login_at, h.created_at, h.updated_at,
  p.display_name, p.phone, p.birth_date::text AS birth_date, p.locale, p.timezone,
  p.avatar_url,
  p.cover_url, p.cover_hash, p.cover_public_id,
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
      `INSERT INTO hosts (email, password_hash)
       VALUES ($1, $2)
       RETURNING id`,
      [input.email, input.passwordHash]
    );

    const hostId = hostResult.rows[0]?.id;
    if (!hostId) throw new Error('Falha ao criar anfitrião: nenhum id devolvido.');

    await runner.query(
      `INSERT INTO host_profiles (host_id, display_name)
       VALUES ($1, $2)`,
      [hostId, input.displayName]
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

  async findByEmail(email: string): Promise<HostWithProfile | null> {
    const result = await query<HostRow>(
      `SELECT ${SELECT_COLUMNS} ${FROM_HOSTS} WHERE h.email = $1`,
      [email]
    );
    const row = result.rows[0];
    return row ? toHost(row) : null;
  },

  async emailExists(email: string): Promise<boolean> {
    const result = await query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM hosts WHERE email = $1) AS exists',
      [email]
    );
    return result.rows[0]?.exists ?? false;
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
};
