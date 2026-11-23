import { PoolClient } from 'pg';
import { pool } from '../database/pool';

/**
 * Histórico das alterações da data de nascimento (Bloco 10).
 *
 * Serve apenas para marcar confirmações suspeitas: se, com um valor
 * anterior, a pessoa não cumpria os limites de idade de um evento e com
 * o valor actual cumpre, a confirmação fica marcada para revisão.
 */
export const hostBirthDateChangeRepository = {
  async record(
    data: { hostId: string; oldValue: string | null; newValue: string | null },
    client?: PoolClient
  ): Promise<void> {
    const runner = client ?? pool;
    await runner.query(
      `INSERT INTO host_birth_date_changes (host_id, old_value, new_value)
       VALUES ($1, $2::date, $3::date)`,
      [data.hostId, data.oldValue, data.newValue]
    );
  },

  /** Valores anteriores (não nulos) da data de nascimento da conta. */
  async previousValues(hostId: string, client?: PoolClient): Promise<string[]> {
    const runner = client ?? pool;
    const result = await runner.query<{ old_value: string }>(
      `SELECT DISTINCT old_value::text AS old_value
         FROM host_birth_date_changes
        WHERE host_id = $1
          AND old_value IS NOT NULL`,
      [hostId]
    );
    return result.rows.map((row) => row.old_value);
  },
};
