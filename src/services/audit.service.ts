import { isIP } from 'node:net';
import { Request } from 'express';
import { logger } from '../config/logger';
import { auditRepository } from '../repositories/audit.repository';
import { AuditEntry } from '../types/audit.types';

export interface AuditContext {
  ip: string | null;
  requestId: string | null;
}

/**
 * Contexto de auditoria extraído do pedido.
 *
 * O IP é validado antes de chegar ao PostgreSQL (`inet`): um valor
 * inválido é guardado como `null` em vez de fazer falhar a operação
 * principal.
 */
export function auditContext(req: Request): AuditContext {
  const ip = req.ip ?? null;

  return {
    ip: ip && isIP(ip) !== 0 ? ip : null,
    requestId: req.id ?? null,
  };
}

export const auditService = {
  /**
   * Regista um evento crítico.
   *
   * A auditoria nunca deve impedir a operação de negócio: uma falha de
   * escrita é registada internamente e o pedido continua. O erro não é
   * silencioso, mas também não é exposto ao cliente.
   */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await auditRepository.create(entry);
    } catch (error) {
      logger.error(
        { err: error, action: entry.action, requestId: entry.requestId ?? null },
        'Falha ao registar evento de auditoria.'
      );
    }
  },

  /** Variante que combina o contexto do pedido com a entrada. */
  async recordRequest(
    req: Request,
    entry: Omit<AuditEntry, 'ip' | 'requestId'>
  ): Promise<void> {
    await this.record({ ...entry, ...auditContext(req) });
  },
};
