import { PoolClient } from 'pg';
import { pool } from '../database/pool';
import { AuditEntry } from '../types/audit.types';

/**
 * Repositório append-only da auditoria.
 *
 * `host_id` e `event_id` são UUIDs simples (sem FK) para que o registo
 * sobreviva à eliminação da conta ou do evento. O serviço que chama
 * este repositório valida e normaliza o IP.
 */
export const auditRepository = {
  async create(entry: AuditEntry, client?: PoolClient): Promise<void> {
    const runner = client ?? pool;

    await runner.query(
      `INSERT INTO host_audit_log (
         host_id, event_id, action, outcome, ip, request_id, metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        entry.hostId ?? null,
        entry.eventId ?? null,
        entry.action,
        entry.outcome ?? 'success',
        entry.ip ?? null,
        entry.requestId ?? null,
        JSON.stringify(entry.metadata ?? {}),
      ]
    );
  },
};
