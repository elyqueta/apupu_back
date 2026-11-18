import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/repositories/invitation.repository', () => ({
  invitationRepository: {
    listByEventSlice: vi.fn(),
  },
}));

import { invitationRepository } from '../src/repositories/invitation.repository';
import { csvExportService } from '../src/services/csvExport.service';
import { EventRecord, EventStats } from '../src/types/event.types';
import { Invitation } from '../src/types/invitation.types';

const event: EventRecord = {
  id: '11111111-2222-4333-8444-555555555555',
  hostId: 'host-1',
  manageTokenHash: 'hash',
  manageTokenExpiresAt: null,
  manageTokenRevokedAt: null,
  title: 'Casamento da Ana & do João',
  hostName: 'Ana Silva',
  hostEmail: 'ana@exemplo.ao',
  category: 'wedding',
  startsAt: new Date('2026-11-22T14:00:00Z'),
  endsAt: null,
  timezone: 'Africa/Luanda',
  location: {
    type: 'venue',
    name: 'Hotel Talatona',
    address: 'Luanda',
    onlineUrl: null,
  },
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

function guest(overrides: Partial<Invitation>): Invitation {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    eventId: event.id,
    guestName: 'Ana',
    guestEmail: 'ana@exemplo.ao',
    guestPhone: '+244 923 456 789',
    tableName: 'Mesa 1',
    tokenHash: 'hash',
    tokenEncrypted: 'token',
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
    ...overrides,
  };
}

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

const generatedAt = new Date('2026-11-18T10:00:00Z');

describe('csvExportService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('exporta convidados com BOM, CRLF, cabeçalho fixo e telefone como texto', async () => {
    vi.mocked(invitationRepository.listByEventSlice).mockResolvedValue([
      guest({}),
      guest({
        id: '00000000-0000-4000-8000-000000000002',
        guestName: '=HYPERLINK("http://exemplo.ao")',
        guestEmail: 'joao@exemplo.ao',
        guestPhone: null,
        tableName: null,
        rsvpStatus: 'declined',
        rsvpRespondedAt: null,
      }),
    ]);

    const file = csvExportService.guests(event, generatedAt);
    const text = (await collect(file.stream)).toString('utf8');

    expect(file.filename).toBe(
      'conto-contigo_convidados_casamento-da-ana-do-joao_2026-11-18.csv'
    );
    expect(file.contentType).toBe('text/csv; charset=utf-8');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain(
      'Nome;Telemóvel;E-mail;Estado;Mesa;Respondeu em;Enviado em;Evento\r\n'
    );
    expect(text).toContain(
      "Ana;'+244 923 456 789;ana@exemplo.ao;Confirmado;Mesa 1;2026-11-01 13:30;2026-10-20 10:00;Casamento da Ana & do João\r\n"
    );
    expect(text).toContain(
      `"'=HYPERLINK(""http://exemplo.ao"")";;joao@exemplo.ao;Recusado;;;2026-10-20 10:00;Casamento da Ana & do João\r\n`
    );
    expect(text).not.toContain('Total');
    expect(text).not.toContain('Gerado em');
  });

  it('exporta presenças apenas com convidados confirmados', async () => {
    vi.mocked(invitationRepository.listByEventSlice).mockResolvedValue([
      guest({}),
      guest({
        id: '00000000-0000-4000-8000-000000000002',
        guestName: 'Pendente',
        rsvpStatus: 'pending',
      }),
    ]);

    const file = csvExportService.attendance(event, generatedAt);
    const text = (await collect(file.stream)).toString('utf8');

    expect(text).toContain('Nome;E-mail;Telemóvel;Mesa;Respondeu em;Evento\r\n');
    expect(text).toContain('Ana;ana@exemplo.ao;');
    expect(text).not.toContain('Pendente');
  });

  it('exporta o resumo do evento com taxas em vírgula decimal', async () => {
    const stats: EventStats = {
      totalInvitations: 120,
      accepted: 78,
      declined: 12,
      pending: 30,
    };

    const file = csvExportService.eventSummary(event, stats, generatedAt);
    const text = (await collect(file.stream)).toString('utf8');

    expect(file.filename).toBe(
      'conto-contigo_resumo_casamento-da-ana-do-joao_2026-11-18.csv'
    );
    expect(text).toContain(
      'Evento;Data;Local;Anfitrião;Estado;Convites;Confirmados;Pendentes;Recusados;Taxa de resposta (%);Taxa de confirmação (%)\r\n'
    );
    expect(text).toContain(
      'Casamento da Ana & do João;2026-11-22 15:00;Hotel Talatona · Luanda;Ana Silva;Agendado;120;78;30;12;75,0;65,0\r\n'
    );
  });

  it('exporta o relatório global sem linhas de metadados nem total misturado', async () => {
    const file = csvExportService.report(
      {
        events: [
          {
            eventId: event.id,
            title: '=HYPERLINK("http://exemplo.ao")',
            status: 'scheduled',
            totalInvitations: 10,
            accepted: 6,
            declined: 1,
            pending: 3,
          },
        ],
        totals: {
          total_invitations: 10,
          accepted: 6,
          declined: 1,
          pending: 3,
          response_rate: 0.7,
          acceptance_rate: 0.6,
        },
      },
      generatedAt
    );
    const text = (await collect(file.stream)).toString('utf8');

    expect(file.filename).toBe('conto-contigo_relatorio_2026-11-18.csv');
    expect(text).toContain(
      'Evento;Estado;Convites;Confirmados;Pendentes;Recusados;Taxa de resposta (%)\r\n'
    );
    expect(text).toContain(`"'=HYPERLINK(""http://exemplo.ao"")";Agendado;10;6;3;1;70,0\r\n`);
    expect(text).not.toContain('Total');
  });
});
