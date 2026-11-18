import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/repositories/report.repository', () => ({
  reportRepository: {
    summaryForHost: vi.fn(),
  },
}));

vi.mock('../src/repositories/event.repository', () => ({
  eventRepository: {
    findByIdForAccess: vi.fn(),
  },
}));

vi.mock('../src/repositories/invitation.repository', () => ({
  invitationRepository: {
    listByEvent: vi.fn(),
    listByEventSlice: vi.fn(),
    statsForEvent: vi.fn(),
    findById: vi.fn(),
  },
}));

import { eventRepository } from '../src/repositories/event.repository';
import { invitationRepository } from '../src/repositories/invitation.repository';
import { reportRepository } from '../src/repositories/report.repository';
import { reportExportService } from '../src/services/reportExport.service';
import { EventRecord } from '../src/types/event.types';
import { Invitation } from '../src/types/invitation.types';
import { encryptToken } from '../src/utils/crypto.util';

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

const event: EventRecord = {
  id: '11111111-2222-4333-8444-555555555555',
  hostId: 'host-1',
  manageTokenHash: 'hash',
  manageTokenExpiresAt: null,
  manageTokenRevokedAt: null,
  title: 'Casamento da Ana e do João',
  hostName: 'Ana Silva',
  hostEmail: 'ana@exemplo.ao',
  category: 'wedding',
  startsAt: new Date('2026-11-22T14:00:00Z'),
  endsAt: null,
  timezone: 'Africa/Luanda',
  location: { type: 'venue', name: 'Hotel Talatona', address: 'Luanda', onlineUrl: null },
  message: null,
  rules: null,
  dressCode: null,
  templateId: null,
  theme: { mode: 'light', palette: 'default' },
  contribution: {
    enabled: false,
    bankName: null,
    accountHolder: null,
    accountReference: null,
  },
  coverUrl: null,
  coverHash: null,
  coverPublicId: null,
  rsvpDeadline: null,
  status: 'scheduled',
  createdAt: new Date('2026-10-01T10:00:00Z'),
  updatedAt: new Date('2026-10-01T10:00:00Z'),
};

const invitation: Invitation = {
  id: '00000000-0000-4000-8000-000000000001',
  eventId: event.id,
  guestName: 'Ana',
  guestEmail: 'ana@exemplo.ao',
  guestPhone: '+244 923 456 789',
  tableName: 'Mesa 1',
  tokenHash: 'hash',
  tokenEncrypted: encryptToken('token-de-teste'),
  claimHash: null,
  claimedAt: null,
  claimRevokedAt: null,
  rsvpStatus: 'accepted',
  rsvpRespondedAt: new Date('2026-11-01T12:30:00Z'),
  rsvpVersion: 1,
  sendStatus: 'sent',
  sendCount: 1,
  lastSentAt: new Date('2026-10-20T09:00:00Z'),
  createdAt: new Date('2026-10-02T08:00:00Z'),
  updatedAt: new Date('2026-10-02T08:00:00Z'),
};

const stats = { totalInvitations: 10, accepted: 6, declined: 1, pending: 3 };

const scope = { hostId: 'host-1', managerEmail: null };

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function allowEvent(): void {
  vi.mocked(eventRepository.findByIdForAccess).mockResolvedValue({
    event,
    accessRole: 'host',
  });
}

describe('reportExportService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('gera um CSV com BOM, cabeçalho e proteção contra fórmulas', async () => {
    vi.mocked(reportRepository.summaryForHost).mockResolvedValue(summary);

    const file = await reportExportService.summary(scope, 'csv');

    expect(file.contentType).toContain('text/csv');
    expect(file.filename).toMatch(/^conto-contigo_relatorio_\d{4}-\d{2}-\d{2}\.csv$/);

    const text = (await collect(file.stream)).toString('utf8');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain('Evento;Estado;Convites;Confirmados;Pendentes;Recusados;Taxa de resposta (%)');
    expect(text).toContain(`"'=HYPERLINK(""http://exemplo.ao"")"`);
    expect(text).not.toContain('Total');
  });

  it('gera um PDF com a assinatura %PDF e o gráfico circular', async () => {
    vi.mocked(reportRepository.summaryForHost).mockResolvedValue(summary);

    const file = await reportExportService.summary(scope, 'pdf');

    expect(file.contentType).toBe('application/pdf');
    expect(file.filename).toMatch(/^conto-contigo_relatorio_\d{4}-\d{2}-\d{2}\.pdf$/);

    const body = await collect(file.stream);
    expect(body.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(body.byteLength).toBeGreaterThan(1000);
    expect(body.byteLength).toBeLessThan(300 * 1024);
  });

  it('exporta a lista de convidados em CSV e em PDF', async () => {
    allowEvent();
    vi.mocked(invitationRepository.listByEventSlice).mockResolvedValue([invitation]);
    vi.mocked(invitationRepository.listByEvent).mockResolvedValue([invitation]);
    vi.mocked(invitationRepository.statsForEvent).mockResolvedValue(stats);

    const csv = await reportExportService.eventDocument(scope, event.id, 'guests', 'csv');
    const csvText = (await collect(csv.stream)).toString('utf8');
    expect(csvText).toContain('Nome;Telemóvel;E-mail;Estado;Mesa;Respondeu em;Enviado em;Evento');
    expect(csvText).toContain('Ana;');

    const pdf = await reportExportService.eventDocument(scope, event.id, 'guests', 'pdf');
    const pdfBody = await collect(pdf.stream);
    expect(pdfBody.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(pdf.filename).toMatch(
      /^conto-contigo_convidados_casamento-da-ana-e-do-joao_\d{4}-\d{2}-\d{2}\.pdf$/
    );
  });

  it('exporta o resumo do evento com o mesmo donut', async () => {
    allowEvent();
    vi.mocked(invitationRepository.statsForEvent).mockResolvedValue(stats);

    const file = await reportExportService.eventDocument(scope, event.id, 'summary', 'pdf');
    const body = await collect(file.stream);

    expect(body.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(body.byteLength).toBeLessThan(300 * 1024);
  });

  it('exporta presenças apenas com os convidados confirmados', async () => {
    allowEvent();
    vi.mocked(invitationRepository.listByEventSlice).mockResolvedValue([
      invitation,
      {
        ...invitation,
        id: '00000000-0000-4000-8000-000000000002',
        guestName: 'Pendente',
        rsvpStatus: 'pending',
      },
    ]);

    const file = await reportExportService.eventDocument(scope, event.id, 'attendance', 'csv');
    const text = (await collect(file.stream)).toString('utf8');

    expect(text).toContain('Ana;');
    expect(text).not.toContain('Pendente');
  });

  it('gera o bilhete em PDF e recusa CSV ou convite ausente', async () => {
    allowEvent();
    vi.mocked(invitationRepository.findById).mockResolvedValue(invitation);

    const file = await reportExportService.eventDocument(scope, event.id, 'ticket', 'pdf', {
      invitationId: invitation.id,
    });
    const body = await collect(file.stream);
    expect(body.subarray(0, 4).toString('latin1')).toBe('%PDF');

    await expect(
      reportExportService.eventDocument(scope, event.id, 'ticket', 'csv', {
        invitationId: invitation.id,
      })
    ).rejects.toThrow('O bilhete só está disponível em PDF.');

    await expect(
      reportExportService.eventDocument(scope, event.id, 'ticket', 'pdf')
    ).rejects.toThrow('Indica o convite do bilhete.');
  });

  it('não expõe eventos de outra conta', async () => {
    vi.mocked(eventRepository.findByIdForAccess).mockResolvedValue(null);

    await expect(
      reportExportService.eventDocument(scope, event.id, 'guests', 'pdf')
    ).rejects.toThrow('Evento não encontrado.');
  });

  it('recusa um bilhete de um convite de outro evento', async () => {
    allowEvent();
    vi.mocked(invitationRepository.findById).mockResolvedValue({
      ...invitation,
      eventId: '99999999-9999-4999-8999-999999999999',
    });

    await expect(
      reportExportService.eventDocument(scope, event.id, 'ticket', 'pdf', {
        invitationId: invitation.id,
      })
    ).rejects.toThrow('Convite não encontrado.');
  });
});
