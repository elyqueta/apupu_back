import { PoolClient } from 'pg';
import { pool } from '../database/pool';

/**
 * Eliminação de contas inactivas.
 *
 * O corte é aplicado a `COALESCE(last_login_at, created_at)`: uma conta
 * criada e nunca usada também conta como inactiva. A selecção usa
 * `FOR UPDATE SKIP LOCKED` para que dois processos de retenção possam
 * correr em paralelo sem apagar a mesma conta duas vezes.
 *
 * A chamada deve correr dentro de uma transacção (ver
 * `retention.service.ts`), para que os locks e as contagens sejam
 * consistentes.
 */
export interface RetentionBatchResult {
  hostsDeleted: number;
  eventsDetached: number;
  verificationsDeleted: number;
}

export const retentionRepository = {
  async deleteInactiveBatch(
    cutoff: Date,
    limit: number,
    client?: PoolClient
  ): Promise<RetentionBatchResult> {
    const runner = client ?? pool;

    const selected = await runner.query<{ id: string; email: string }>(
      `SELECT id, email::text AS email
         FROM hosts
        WHERE COALESCE(last_login_at, created_at) < $1
        ORDER BY COALESCE(last_login_at, created_at)
        LIMIT $2
        FOR UPDATE SKIP LOCKED`,
      [cutoff, limit]
    );

    if (selected.rows.length === 0) {
      return { hostsDeleted: 0, eventsDetached: 0, verificationsDeleted: 0 };
    }

    const ids = selected.rows.map((row) => row.id);

    // OTP de registo não tem FK para `hosts` (existe antes da conta);
    // é removido pelo email para não deixar histórico da conta apagada.
    const verifications = await runner.query(
      `DELETE FROM registration_verifications
        WHERE email IN (
          SELECT email FROM hosts WHERE id = ANY($1::uuid[])
        )`,
      [ids]
    );

    // Os eventos não são apagados: ficam sem dono, como os eventos
    // legados. A actualização explícita devolve a contagem de eventos
    // desligados da conta.
    const detached = await runner.query(
      `UPDATE events
          SET host_id = NULL, updated_at = now()
        WHERE host_id = ANY($1::uuid[])`,
      [ids]
    );

    // Perfil, sessões, tokens, tarefas e entregas são removidos por
    // `ON DELETE CASCADE`.
    const deleted = await runner.query(
      `DELETE FROM hosts WHERE id = ANY($1::uuid[])`,
      [ids]
    );

    return {
      hostsDeleted: deleted.rowCount ?? 0,
      eventsDetached: detached.rowCount ?? 0,
      verificationsDeleted: verifications.rowCount ?? 0,
    };
  },
};
