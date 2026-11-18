import { Request, Response } from 'express';
import { toDailyReportDto, toReportSummaryDto } from '../dto/report.dto';
import {
  EventExportParams,
  EventExportQuery,
  EventPeriodReportQuery,
  EventReportQuery,
  ReportExportQuery,
} from '../schemas/host.schemas';
import { reportExportService } from '../services/reportExport.service';
import { reportService } from '../services/report.service';
import { EventAccessScope } from '../types/event.types';

function accessScope(req: Request): EventAccessScope {
  if (!req.hostAccount) {
    throw new Error('Conta não resolvida: falta o middleware hostAccountAuth.');
  }

  return {
    hostId: req.hostAccount.id,
    managerEmail: req.hostAccount.emailVerifiedAt ? req.hostAccount.email : null,
  };
}

function sendFile(
  res: Response,
  file: { filename: string; contentType: string; stream: NodeJS.ReadableStream }
): void {
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(200);
  file.stream.pipe(res);
}

export const reportController = {
  summary: async (req: Request, res: Response): Promise<void> => {
    const summary = await reportService.summary(accessScope(req));
    res.status(200).json({ data: toReportSummaryDto(summary) });
  },

  exportSummary: async (req: Request, res: Response): Promise<void> => {
    const { format } = req.query as unknown as ReportExportQuery;
    const file = await reportExportService.summary(accessScope(req), format);
    sendFile(res, file);
  },

  eventExport: async (req: Request, res: Response): Promise<void> => {
    const { eventId, document } = req.params as unknown as EventExportParams;
    const { format, invitation_id } = req.query as unknown as EventExportQuery;
    const file = await reportExportService.eventDocument(
      accessScope(req),
      eventId,
      document,
      format,
      { invitationId: invitation_id }
    );
    sendFile(res, file);
  },

  eventDaily: async (req: Request, res: Response): Promise<void> => {
    const eventId = req.params.eventId ?? '';
    const { days } = req.query as unknown as EventReportQuery;
    const series = await reportService.eventDaily(accessScope(req), eventId, days);

    res.status(200).json({
      data: {
        event_id: eventId,
        days,
        series: series.map(toDailyReportDto),
      },
    });
  },

  eventPeriodExport: async (req: Request, res: Response): Promise<void> => {
    const eventId = req.params.eventId ?? '';
    const { format, from, to } = req.query as unknown as EventPeriodReportQuery;
    const file = await reportExportService.eventPeriodReport(
      accessScope(req),
      eventId,
      from,
      to,
      format
    );
    sendFile(res, file);
  },
};
