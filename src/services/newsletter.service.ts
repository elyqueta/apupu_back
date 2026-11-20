import { NotFoundError } from '../errors';
import { adminAuditRepository } from '../repositories/adminAudit.repository';
import { newsletterRepository } from '../repositories/newsletter.repository';
import { AdminNewsletterQuery } from '../schemas/admin.schemas';
import { NewsletterSubscription } from '../types/newsletter.types';
import { PaginationMeta } from '../types/pagination.types';
import { buildPaginationMeta, toPageParams } from '../utils/pagination.util';

/** Subscrições de novidades: registo público e gestão pelo super admin. */
export const newsletterService = {
  /** Resposta idêntica quer o email já exista quer seja novo. */
  async subscribe(email: string): Promise<{ subscribed: true }> {
    await newsletterRepository.subscribe(email);
    return { subscribed: true };
  },

  async listForAdmin(
    adminId: string,
    query: AdminNewsletterQuery
  ): Promise<{ items: NewsletterSubscription[]; pagination: PaginationMeta }> {
    await adminAuditRepository.record({
      adminId,
      action: 'admin_newsletter_listed',
      targetType: 'admin',
      targetId: adminId,
      metadata: { q: query.q ?? null },
    });

    const page = toPageParams(query.page, query.page_size);
    const result = await newsletterRepository.list({
      q: query.q,
      from: query.from,
      to: query.to,
      ...page,
    });

    return {
      items: result.items,
      pagination: buildPaginationMeta(result.total, page.page, page.pageSize),
    };
  },

  async removeForAdmin(adminId: string, subscriptionId: string): Promise<{ removed: true }> {
    const removed = await newsletterRepository.remove(subscriptionId);
    if (!removed) {
      throw new NotFoundError('Subscrição não encontrada.', 'newsletter_subscription_not_found');
    }

    await adminAuditRepository.record({
      adminId,
      action: 'newsletter_subscription_removed',
      targetType: 'newsletter_subscription',
      targetId: subscriptionId,
    });

    return { removed: true };
  },

  async exportForAdmin(
    adminId: string,
    query: AdminNewsletterQuery
  ): Promise<NewsletterSubscription[]> {
    await adminAuditRepository.record({
      adminId,
      action: 'admin_newsletter_exported',
      targetType: 'admin',
      targetId: adminId,
      metadata: { q: query.q ?? null },
    });

    return newsletterRepository.listForExport({
      q: query.q,
      from: query.from,
      to: query.to,
    });
  },
};
