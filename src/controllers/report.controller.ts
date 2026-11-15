import { Request, Response } from 'express';
import { toDailyReportDto, toReportSummaryDto } from '../dto/report.dto';
import { EventReportQuery } from '../schemas/host.schemas';
import { reportService } from '../services/report.service';

function requireHostId(req: Request): string {
  if (!req.hostAccount) {
    throw new Error('Conta não resolvida: falta o middleware hostAccountAuth.');
  }

  return req.hostAccount.id;
}

export const reportController = {
  summary: async (req: Request, res: Response): Promise<void> => {
    const summary = await reportService.summary(requireHostId(req));
    res.status(200).json({ data: toReportSummaryDto(summary) });
  },

  eventDaily: async (req: Request, res: Response): Promise<void> => {
    const eventId = req.params.eventId ?? '';
    const { days } = req.query as unknown as EventReportQuery;
    const series = await reportService.eventDaily(requireHostId(req), eventId, days);

    res.status(200).json({
      data: {
        event_id: eventId,
        days,
        series: series.map(toDailyReportDto),
      },
    });
  },
};
