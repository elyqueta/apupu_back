import { Request, Response } from 'express';
import { toSupportMessageDto } from '../dto/support.dto';
import { AdminSupportQuery } from '../schemas/admin.schemas';
import { SupportCreateBody } from '../schemas/support.schemas';
import { auditService } from '../services/audit.service';
import { supportService } from '../services/support.service';

function adminId(req: Request): string {
  if (!req.hostAccount) throw new Error('Falta o middleware de admin.');
  return req.hostAccount.id;
}

/** Formulário público de apoio e respectiva gestão administrativa. */
export const supportController = {
  create: async (req: Request, res: Response): Promise<void> => {
    const message = await supportService.create(req.body as SupportCreateBody);
    res.status(201).json({
      data: { id: message.id, created_at: message.createdAt.toISOString() },
    });
  },

  list: async (req: Request, res: Response): Promise<void> => {
    const result = await supportService.listForAdmin(
      adminId(req),
      req.query as unknown as AdminSupportQuery
    );
    res.status(200).json({
      data: result.items.map(toSupportMessageDto),
      pagination: result.pagination,
    });
  },

  get: async (req: Request, res: Response): Promise<void> => {
    const message = await supportService.findForAdmin(adminId(req), req.params.messageId ?? '');
    res.status(200).json({ data: toSupportMessageDto(message) });
  },

  resolve: async (req: Request, res: Response): Promise<void> => {
    const messageId = req.params.messageId ?? '';
    const message = await supportService.resolveForAdmin(adminId(req), messageId);

    await auditService.recordRequest(req, {
      action: 'support_message_resolved',
      hostId: adminId(req),
      metadata: { message_id: messageId },
    });

    res.status(200).json({ data: toSupportMessageDto(message) });
  },
};
