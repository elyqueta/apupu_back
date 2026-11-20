import { Request, Response } from 'express';
import { toNewsletterDto } from '../dto/newsletter.dto';
import { AdminNewsletterQuery } from '../schemas/admin.schemas';
import { NewsletterSubscribeBody } from '../schemas/newsletter.schemas';
import { auditService } from '../services/audit.service';
import { newsletterService } from '../services/newsletter.service';
import { newsletterCsv } from '../utils/newsletterCsv.util';

function adminId(req: Request): string {
  if (!req.hostAccount) throw new Error('Falta o middleware de admin.');
  return req.hostAccount.id;
}

/** Subscrição pública de novidades e exportação/remoção administrativa. */
export const newsletterController = {
  subscribe: async (req: Request, res: Response): Promise<void> => {
    const result = await newsletterService.subscribe((req.body as NewsletterSubscribeBody).email);
    res.status(201).json({ data: result });
  },

  list: async (req: Request, res: Response): Promise<void> => {
    const result = await newsletterService.listForAdmin(
      adminId(req),
      req.query as unknown as AdminNewsletterQuery
    );
    res.status(200).json({
      data: result.items.map(toNewsletterDto),
      pagination: result.pagination,
    });
  },

  remove: async (req: Request, res: Response): Promise<void> => {
    const subscriptionId = req.params.subscriptionId ?? '';
    const result = await newsletterService.removeForAdmin(adminId(req), subscriptionId);

    await auditService.recordRequest(req, {
      action: 'newsletter_subscription_removed',
      hostId: adminId(req),
      metadata: { subscription_id: subscriptionId },
    });

    res.status(200).json({ data: result });
  },

  export: async (req: Request, res: Response): Promise<void> => {
    const subscriptions = await newsletterService.exportForAdmin(
      adminId(req),
      req.query as unknown as AdminNewsletterQuery
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="newsletter.csv"');
    res.status(200).send(newsletterCsv(subscriptions));
  },
};
