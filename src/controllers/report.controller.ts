import { Request, Response } from 'express';
import { toDailyReportDto, toReportSummaryDto } from '../dto/report.dto';
import { EventReportQuery } from '../schemas/host.schemas';
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

export const reportController = {
  summary: async (req: Request, res: Response): Promise<void> => {
    const summary = await reportService.summary(accessScope(req));
    res.status(200).json({ data: toReportSummaryDto(summary) });
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
};
