import { Readable } from 'node:stream';
import { Request, Response } from 'express';
import { adminReportService } from '../services/adminReport.service';
import { adminService } from '../services/admin.service';
import {
  AdminAuditQuery,
  AdminCancelBody,
  AdminEventsQuery,
  AdminSuspendBody,
  AdminUsersQuery,
} from '../schemas/admin.schemas';
import { toEventDto } from '../dto/event.dto';
import { auditService } from '../services/audit.service';

function adminId(req: Request): string {
  if (!req.hostAccount) throw new Error('Falta o middleware de admin.');
  return req.hostAccount.id;
}

function sendPdf(
  res: Response,
  file: { filename: string; contentType: string; stream: Readable }
): void {
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(200);
  file.stream.pipe(res);
}

/** Controlador do painel de super admin (Blocos 6 a 8). */
export const adminController = {
  overview: async (req: Request, res: Response): Promise<void> => {
    res.status(200).json({ data: await adminService.overview(adminId(req)) });
  },

  listEvents: async (req: Request, res: Response): Promise<void> => {
    const result = await adminService.listEvents(
      adminId(req),
      req.query as unknown as AdminEventsQuery
    );
    res.status(200).json({
      data: result.items.map((event) => toEventDto(event)),
      pagination: result.pagination,
    });
  },

  getEvent: async (req: Request, res: Response): Promise<void> => {
    const event = await adminService.getEvent(adminId(req), req.params.eventId ?? '');
    res.status(200).json({ data: { event: toEventDto(event) } });
  },

  requestCancelOtp: async (req: Request, res: Response): Promise<void> => {
    const result = await adminService.requestEventCancelOtp(
      adminId(req),
      req.params.eventId ?? '',
      req.hostAccount?.email ?? ''
    );
    res.status(200).json({
      data: {
        expires_at: result.expiresAt.toISOString(),
        resend_available_at: result.resendAvailableAt.toISOString(),
      },
    });
  },

  cancelEvent: async (req: Request, res: Response): Promise<void> => {
    const { reason, otp } = req.body as AdminCancelBody;
    const event = await adminService.cancelEvent(adminId(req), req.params.eventId ?? '', reason, otp);
    await auditService.recordRequest(req, {
      action: 'admin_event_cancelled',
      hostId: adminId(req),
      eventId: event.id,
      metadata: { reason },
    });
    res.status(200).json({ data: { event: toEventDto(event) } });
  },

  listUsers: async (req: Request, res: Response): Promise<void> => {
    const result = await adminService.listUsers(adminId(req), req.query as unknown as AdminUsersQuery);
    res.status(200).json({ data: result.items, pagination: result.pagination });
  },

  getUser: async (req: Request, res: Response): Promise<void> => {
    res.status(200).json({ data: await adminService.getUser(adminId(req), req.params.userId ?? '') });
  },

  suspendUser: async (req: Request, res: Response): Promise<void> => {
    const host = await adminService.suspendUser(
      adminId(req),
      req.params.userId ?? '',
      (req.body as AdminSuspendBody | undefined)?.reason ?? null
    );
    res.status(200).json({
      data: {
        id: host?.id,
        email: host?.email,
        status: host?.status,
      },
    });
  },

  reactivateUser: async (req: Request, res: Response): Promise<void> => {
    const host = await adminService.reactivateUser(adminId(req), req.params.userId ?? '');
    res.status(200).json({
      data: {
        id: host?.id,
        email: host?.email,
        status: host?.status,
      },
    });
  },

  revokeSessions: async (req: Request, res: Response): Promise<void> => {
    const result = await adminService.revokeSessions(adminId(req), req.params.userId ?? '');
    res.status(200).json({ data: result });
  },

  userReport: async (req: Request, res: Response): Promise<void> => {
    const file = await adminReportService.userReport(
      adminId(req),
      req.params.userId ?? ''
    );
    sendPdf(res, file);
  },

  allUsersReport: async (req: Request, res: Response): Promise<void> => {
    sendPdf(res, await adminReportService.allUsersReport(adminId(req)));
  },

  listWeeklyReports: async (_req: Request, res: Response): Promise<void> => {
    res.status(200).json({ data: await adminReportService.listWeeklyReports() });
  },

  downloadWeeklyReport: async (req: Request, res: Response): Promise<void> => {
    const { report, content } = await adminReportService.getWeeklyReport(
      req.params.reportId ?? ''
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${report.filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.status(200).send(content);
  },

  listAudit: async (req: Request, res: Response): Promise<void> => {
    const result = await adminService.listAudit(adminId(req), req.query as unknown as AdminAuditQuery);
    res.status(200).json({ data: result.items, pagination: result.pagination });
  },
};
