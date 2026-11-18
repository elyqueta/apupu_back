import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/repositories/report.repository', () => ({
  reportRepository: {
    summaryForHost: vi.fn(),
  },
}));

import { reportRepository } from '../src/repositories/report.repository';
import { reportExportService } from '../src/services/reportExport.service';

const summary = {
  events: [
    {
      eventId: '00000000-0000-4000-8000-000000000001',
      title: 'Casamento da Ana e do João',
      status: 'scheduled' as const,
      totalInvitations: 10,
      accepted: 6,
      declined: 1,
      pending: 3,
    },
    {
      eventId: '00000000-0000-4000-8000-000000000002',
      title: '=HYPERLINK("http://exemplo.ao")',
      status: 'draft' as const,
      totalInvitations: 2,
      accepted: 0,
      declined: 0,
      pending: 2,
    },
  ],
  totals: {
    total_invitations: 12,
    accepted: 6,
    declined: 1,
    pending: 5,
    response_rate: 7 / 12,
    acceptance_rate: 0.5,
  },
};

describe('reportExportService', () => {
  it('gera um CSV com BOM, cabeçalho e proteção contra fórmulas', async () => {
    vi.mocked(reportRepository.summaryForHost).mockResolvedValue(summary);

    const file = await reportExportService.summary(
      { hostId: 'host-1', managerEmail: null },
      'csv'
    );

    expect(file.contentType).toContain('text/csv');
    expect(file.filename).toMatch(/^conto-contigo-relatorio-\d{4}-\d{2}-\d{2}\.csv$/);

    const text = file.body.toString('utf8');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain('"Casamento da Ana e do João"');
    expect(text).toContain(`"'=HYPERLINK(""http://exemplo.ao"")"`);
    expect(text).toContain('"Total"');
  });

  it('gera um PDF com a assinatura %PDF', async () => {
    vi.mocked(reportRepository.summaryForHost).mockResolvedValue(summary);

    const file = await reportExportService.summary(
      { hostId: 'host-1', managerEmail: null },
      'pdf'
    );

    expect(file.contentType).toBe('application/pdf');
    expect(file.filename).toMatch(/^conto-contigo-relatorio-\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(file.body.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(file.body.byteLength).toBeGreaterThan(1000);
  });
});
