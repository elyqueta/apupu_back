import { NotFoundError } from '../errors';
import { eventRepository } from '../repositories/event.repository';
import { HostReportSummary, reportRepository } from '../repositories/report.repository';
import { DailyReportRow, EventAccessScope } from '../types/event.types';

export const reportService = {
  async summary(scope: EventAccessScope): Promise<HostReportSummary> {
    return reportRepository.summaryForHost(scope);
  },

  /**
   * Série diária de um evento (UTC, um ponto por dia, incluindo dias
   * sem movimento). O acesso ao evento é verificado antes da consulta.
   */
  async eventDaily(
    scope: EventAccessScope,
    eventId: string,
    days: number
  ): Promise<DailyReportRow[]> {
    const access = await eventRepository.findByIdForAccess(eventId, scope);

    if (!access) {
      throw new NotFoundError('Evento não encontrado.', 'event_not_found');
    }

    return reportRepository.dailyForEvent(eventId, days);
  },
};
