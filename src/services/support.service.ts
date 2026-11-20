import { NotFoundError } from '../errors';
import { adminAuditRepository } from '../repositories/adminAudit.repository';
import { supportRepository } from '../repositories/support.repository';
import { AdminSupportQuery } from '../schemas/admin.schemas';
import { PaginationMeta } from '../types/pagination.types';
import { SupportMessage } from '../types/support.types';
import { buildPaginationMeta, toPageParams } from '../utils/pagination.util';

/** Mensagens de apoio: submissão pública e gestão pelo super admin. */
export const supportService = {
  async create(data: { name: string; email: string; message: string }): Promise<SupportMessage> {
    return supportRepository.create(data);
  },

  async listForAdmin(
    adminId: string,
    query: AdminSupportQuery
  ): Promise<{ items: SupportMessage[]; pagination: PaginationMeta }> {
    await adminAuditRepository.record({
      adminId,
      action: 'admin_support_listed',
      targetType: 'admin',
      targetId: adminId,
      metadata: { q: query.q ?? null, status: query.status ?? null },
    });

    const page = toPageParams(query.page, query.page_size);
    const result = await supportRepository.list({
      q: query.q,
      status: query.status,
      from: query.from,
      to: query.to,
      ...page,
    });

    return {
      items: result.items,
      pagination: buildPaginationMeta(result.total, page.page, page.pageSize),
    };
  },

  async findForAdmin(adminId: string, messageId: string): Promise<SupportMessage> {
    const message = await supportRepository.findById(messageId);
    if (!message) {
      throw new NotFoundError('Mensagem não encontrada.', 'support_message_not_found');
    }

    await adminAuditRepository.record({
      adminId,
      action: 'admin_support_viewed',
      targetType: 'support_message',
      targetId: messageId,
    });

    return message;
  },

  async resolveForAdmin(adminId: string, messageId: string): Promise<SupportMessage> {
    const message = await supportRepository.resolve(messageId, adminId);
    if (!message) {
      throw new NotFoundError('Mensagem não encontrada.', 'support_message_not_found');
    }

    await adminAuditRepository.record({
      adminId,
      action: 'support_message_resolved',
      targetType: 'support_message',
      targetId: messageId,
    });

    return message;
  },
};
