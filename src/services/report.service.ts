import { NotFoundError } from '../errors';
import { eventRepository } from '../repositories/event.repository';
import { HostReportSummary, reportRepository } from '../repositories/report.repository';
import { DailyReportRow } from '../types/event.types';

export const reportService = {
  async summary(hostId: string): Promise<HostReportSummary> {
    return reportRepository.summaryForHost(hostId);
  },

  /**
   * Série diária de um evento (UTC, um ponto por dia, incluindo dias
   * sem movimento). A posse do evento é verificada antes da consulta.
   */
  async eventDaily(
    hostId: string,
    eventId: string,
    days: number
  ): Promise<DailyReportRow[]> {
    const event = await eventRepository.findByIdForHost(eventId, hostId);

    if (!event) {
      throw new NotFoundError('Evento não encontrado.', 'event_not_found');
    }

    return reportRepository.dailyForEvent(eventId, days);
  },
};
