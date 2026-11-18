import { PoolClient } from 'pg';
import { pool } from '../database/pool';

/**
 * Repositório da verificação de email por OTP.
 *
 * Fluxo:
 * 1. `create` grava o HMAC do código e invalida pedidos anteriores.
 * 2. `registerFailedAttempt` incrementa as tentativas de forma atómica.
 * 3. `markVerified` troca o código válido por um token de uso único.
 * 4. `consumeVerificationToken` valida e consome esse token antes de a
 *    conta ser criada.
 *
 * O código e o token em claro nunca chegam à base de dados.
 */
interface RegistrationVerificationRow {
  id: string;
  email: string;
  code_hash: string;
  attempts: number;
  expires_at: Date;
  verified_at: Date | null;
  verification_token_hash: string | null;
  verification_token_expires_at: Date | null;
  consumed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface RegistrationVerification {
  id: string;
  email: string;
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  verifiedAt: Date | null;
  verificationTokenHash: string | null;
  verificationTokenExpiresAt: Date | null;
  consumedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toVerification(row: RegistrationVerificationRow): RegistrationVerification {
  return {
    id: row.id,
    email: row.email,
    codeHash: row.code_hash,
    attempts: row.attempts,
    expiresAt: row.expires_at,
    verifiedAt: row.verified_at,
    verificationTokenHash: row.verification_token_hash,
    verificationTokenExpiresAt: row.verification_token_expires_at,
    consumedAt: row.consumed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_COLUMNS = `
  id, email, code_hash, attempts, expires_at, verified_at,
  verification_token_hash, verification_token_expires_at,
  consumed_at, created_at, updated_at
`;

export const registrationVerificationRepository = {
  /** Invalida pedidos pendentes do mesmo email antes de emitir outro código. */
  async consumePendingForEmail(email: string, client?: PoolClient): Promise<number> {
    const runner = client ?? pool;
    const result = await runner.query(
      `UPDATE registration_verifications
          SET consumed_at = now(), updated_at = now()
        WHERE email = $1 AND consumed_at IS NULL`,
      [email]
    );
    return result.rowCount ?? 0;
  },

  async create(
    email: string,
    codeHash: string,
    expiresAt: Date,
    client?: PoolClient
  ): Promise<RegistrationVerification> {
    const runner = client ?? pool;
    const result = await runner.query<RegistrationVerificationRow>(
      `INSERT INTO registration_verifications (email, code_hash, expires_at)
       VALUES ($1, $2, $3)
       RETURNING ${SELECT_COLUMNS}`,
      [email, codeHash, expiresAt]
    );

    const row = result.rows[0];
    if (!row) throw new Error('Falha ao criar verificação de registo.');
    return toVerification(row);
  },

  /**
   * Cria uma verificação já validada e emite o token de registo.
   *
   * Usado quando o email já foi inscrito por um anfitrião: nesse caso o
   * convite serve de prova de posse e o OTP é dispensado.
   */
  async createVerified(
    email: string,
    tokenHash: string,
    tokenExpiresAt: Date,
    client?: PoolClient
  ): Promise<RegistrationVerification> {
    const runner = client ?? pool;
    const result = await runner.query<RegistrationVerificationRow>(
      `INSERT INTO registration_verifications
         (email, code_hash, expires_at, verified_at,
          verification_token_hash, verification_token_expires_at)
       VALUES ($1, $2, $3, now(), $2, $3)
       RETURNING ${SELECT_COLUMNS}`,
      [email, tokenHash, tokenExpiresAt]
    );

    const row = result.rows[0];
    if (!row) throw new Error('Falha ao criar verificação de registo.');
    return toVerification(row);
  },

  /** Pedido mais recente do email ainda não consumido nem expirado. */
  async findLatestActiveForEmail(
    email: string,
    client?: PoolClient
  ): Promise<RegistrationVerification | null> {
    const runner = client ?? pool;
    const result = await runner.query<RegistrationVerificationRow>(
      `SELECT ${SELECT_COLUMNS}
         FROM registration_verifications
        WHERE email = $1
          AND consumed_at IS NULL
          AND expires_at > now()
        ORDER BY created_at DESC
        LIMIT 1`,
      [email]
    );

    const row = result.rows[0];
    return row ? toVerification(row) : null;
  },

  /** Versão bloqueante para a verificação do código (evita corridas). */
  async findLatestActiveForEmailForUpdate(
    email: string,
    client: PoolClient
  ): Promise<RegistrationVerification | null> {
    const result = await client.query<RegistrationVerificationRow>(
      `SELECT ${SELECT_COLUMNS}
         FROM registration_verifications
        WHERE email = $1
          AND consumed_at IS NULL
          AND expires_at > now()
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE`,
      [email]
    );

    const row = result.rows[0];
    return row ? toVerification(row) : null;
  },

  /**
   * Regista uma tentativa falhada. Devolve o total de tentativas para
   * que o serviço possa decidir se o código deve ser invalidado.
   */
  async registerFailedAttempt(id: string, client?: PoolClient): Promise<number> {
    const runner = client ?? pool;
    const result = await runner.query<{ attempts: number }>(
      `UPDATE registration_verifications
          SET attempts = attempts + 1, updated_at = now()
        WHERE id = $1
        RETURNING attempts`,
      [id]
    );
    return result.rows[0]?.attempts ?? 0;
  },

  /** Marca o código como verificado e emite o token de uso único. */
  async markVerified(
    id: string,
    tokenHash: string,
    tokenExpiresAt: Date,
    client?: PoolClient
  ): Promise<void> {
    const runner = client ?? pool;
    await runner.query(
      `UPDATE registration_verifications
          SET verified_at = now(),
              verification_token_hash = $2,
              verification_token_expires_at = $3,
              updated_at = now()
        WHERE id = $1`,
      [id, tokenHash, tokenExpiresAt]
    );
  },

  /**
   * Consome o token de verificação. A condição inclui o email, o que
   * impede reutilizar o token numa conta diferente.
   */
  async consumeVerificationToken(
    email: string,
    tokenHash: string,
    client: PoolClient
  ): Promise<boolean> {
    const result = await client.query(
      `UPDATE registration_verifications
          SET consumed_at = now(), updated_at = now()
        WHERE email = $1
          AND verification_token_hash = $2
          AND consumed_at IS NULL
          AND verified_at IS NOT NULL
          AND verification_token_expires_at > now()
        RETURNING id`,
      [email, tokenHash]
    );
    return (result.rowCount ?? 0) > 0;
  },
};
