import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/repositories/adminAudit.repository', () => ({
  adminAuditRepository: { record: vi.fn(async () => undefined) },
}));

vi.mock('../src/repositories/host.repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/repositories/host.repository')>();
  return {
    ...actual,
    hostRepository: { ...actual.hostRepository, findById: vi.fn() },
  };
});

vi.mock('../src/repositories/adminProfile.repository', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../src/repositories/adminProfile.repository')>();
  return {
    ...actual,
    adminProfileRepository: {
      ...actual.adminProfileRepository,
      eventsForUser: vi.fn(async () => []),
      teamsForUser: vi.fn(async () => []),
      allUsersForReport: vi.fn(async () => []),
    },
  };
});

vi.mock('../src/repositories/adminWeeklyReport.repository', () => ({
  adminWeeklyReportRepository: {
    claim: vi.fn(),
    markReady: vi.fn(),
    discard: vi.fn(async () => undefined),
    list: vi.fn(async () => []),
    findReady: vi.fn(async () => null),
    prune: vi.fn(async () => 0),
  },
}));

import { swaggerSpec } from '../src/config/swagger';
import { adminAuditRepository } from '../src/repositories/adminAudit.repository';
import { adminProfileRepository } from '../src/repositories/adminProfile.repository';
import { adminWeeklyReportRepository } from '../src/repositories/adminWeeklyReport.repository';
import { hostRepository } from '../src/repositories/host.repository';
import { adminService } from '../src/services/admin.service';
import { adminReportService, weekStartFor } from '../src/services/adminReport.service';
import { HostWithProfile } from '../src/types/host.types';

const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '00000000-0000-4000-8000-000000000002';

function host(): HostWithProfile {
  const now = new Date('2026-01-10T10:00:00.000Z');
  return {
    id: USER_ID,
    email: 'ana@exemplo.ao',
    passwordHash: 'hash-secreto',
    emailVerifiedAt: now,
    isSuperAdmin: false,
    status: 'active',
    failedLoginAttempts: 0,
    lockedUntil: null,
    lastLoginAt: null,
    createdAt: now,
    updatedAt: now,
    profile: {
      hostId: USER_ID,
      displayName: 'Ana Silva',
      phone: '+244923000000',
      birthDate: '1990-05-20',
      locale: 'pt-AO',
      timezone: 'Africa/Luanda',
      avatarUrl: null,
      avatarHash: 'hash-do-avatar',
      avatarPublicId: 'conta-comigo/avatars/segredo',
      coverUrl: null,
      coverHash: 'hash-da-capa',
      coverPublicId: 'conta-comigo/profile-covers/segredo',
      createdAt: now,
      updatedAt: now,
    },
  };
}

async function collect(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(hostRepository.findById).mockResolvedValue(host());
  vi.mocked(adminProfileRepository.eventsForUser).mockResolvedValue([
    {
      id: '00000000-0000-4000-8000-000000000003',
      title: 'Casamento da Ana',
      status: 'scheduled',
      starts_at: '2026-06-01T14:00:00.000Z',
      created_at: '2026-01-10T10:00:00.000Z',
      guest_count: 12,
    },
  ]);
  vi.mocked(adminProfileRepository.teamsForUser).mockResolvedValue([
    {
      id: '00000000-0000-4000-8000-000000000004',
      name: 'Decoração',
      member_count: 4,
      event_title: 'Casamento da Ana',
    },
  ]);
  vi.mocked(adminWeeklyReportRepository.claim).mockResolvedValue(null);
  vi.mocked(adminWeeklyReportRepository.markReady).mockResolvedValue(null);
});

describe('Bloco 8 — contrato OpenAPI', () => {
  it('documenta as rotas de utilizadores e de relatórios', () => {
    const paths = swaggerSpec.paths ?? {};

    for (const path of [
      '/api/v1/admin/users',
      '/api/v1/admin/users/{userId}',
      '/api/v1/admin/users/{userId}/report',
      '/api/v1/admin/reports/all',
      '/api/v1/admin/reports/weekly',
      '/api/v1/admin/reports/weekly/{reportId}/download',
    ]) {
      expect(paths[path], `path ${path}`).toBeDefined();
      expect(paths[path]?.get).toBeDefined();
    }
  });
});

describe('Bloco 8 — detalhe de utilizador no admin', () => {
  it('devolve avatar, capa, eventos e equipas sem dados sensíveis', async () => {
    const detail = await adminService.getUser(ADMIN_ID, USER_ID);

    expect(detail).toMatchObject({
      id: USER_ID,
      email: 'ana@exemplo.ao',
      display_name: 'Ana Silva',
      avatar_url: null,
      cover_url: null,
      locale: 'pt-AO',
      timezone: 'Africa/Luanda',
    });
    expect(detail.events).toHaveLength(1);
    expect(detail.teams).toHaveLength(1);
    expect(detail).not.toHaveProperty('password_hash');
    expect(JSON.stringify(detail)).not.toContain('hash-do-avatar');
    expect(JSON.stringify(detail)).not.toContain('avatar_public_id');
    expect(adminAuditRepository.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'admin_user_viewed', targetId: USER_ID })
    );
  });

  it('devolve 404 quando a conta não existe', async () => {
    vi.mocked(hostRepository.findById).mockResolvedValue(null);

    await expect(adminService.getUser(ADMIN_ID, USER_ID)).rejects.toMatchObject({
      code: 'user_not_found',
    });
  });
});

describe('Bloco 8 — PDF individual', () => {
  it('gera um PDF com o nome do perfil e audita a exportação', async () => {
    const file = await adminReportService.userReport(ADMIN_ID, USER_ID);
    const body = await collect(file.stream);

    expect(file.contentType).toBe('application/pdf');
    expect(file.filename).toMatch(/^conto-contigo_perfil_ana-silva_\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(adminAuditRepository.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'admin_user_report_exported', targetId: USER_ID })
    );
  });
});

describe('Bloco 8 — relatório semanal', () => {
  it('calcula a semana de Luanda a partir de um domingo em UTC', () => {
    // 22 nov 2026, 23:30 UTC = 23 nov (segunda) em Luanda.
    expect(weekStartFor(new Date('2026-11-22T23:30:00.000Z'))).toBe('2026-11-23');
    expect(weekStartFor(new Date('2026-11-25T12:00:00.000Z'))).toBe('2026-11-23');
  });

  it('gera uma vez por semana, grava o PDF e aplica a retenção', async () => {
    const generatedAt = new Date('2026-11-23T09:00:00.000Z');
    const report = {
      id: '00000000-0000-4000-8000-000000000005',
      week_start: '2026-11-23',
      status: 'ready' as const,
      filename: 'conto-contigo_relatorio-semanal_2026-11-23.pdf',
      size_bytes: 123,
      host_count: 1,
      generated_at: generatedAt.toISOString(),
      created_at: generatedAt.toISOString(),
    };

    vi.mocked(adminWeeklyReportRepository.claim).mockResolvedValue(report.id);
    vi.mocked(adminWeeklyReportRepository.markReady).mockResolvedValue(report);
    vi.mocked(adminProfileRepository.allUsersForReport).mockResolvedValue([
      {
        id: USER_ID,
        email: 'ana@exemplo.ao',
        display_name: 'Ana Silva',
        phone: null,
        locale: 'pt-AO',
        timezone: 'Africa/Luanda',
        avatar_url: null,
        cover_url: null,
        status: 'active',
        is_super_admin: false,
        created_at: '2026-01-10T10:00:00.000Z',
        events_count: 1,
        teams_count: 1,
        invitations_count: 12,
      },
    ]);

    const result = await adminReportService.generateWeeklyReport(generatedAt);

    expect(result).toEqual(report);
    expect(adminWeeklyReportRepository.claim).toHaveBeenCalledWith(
      '2026-11-23',
      expect.stringContaining('relatorio-semanal_2026-11-23.pdf')
    );
    const content = vi.mocked(adminWeeklyReportRepository.markReady).mock.calls[0]?.[1];
    expect(content?.subarray(0, 5).toString()).toBe('%PDF-');
    expect(adminWeeklyReportRepository.prune).toHaveBeenCalledWith('2026-08-31');
    expect(adminWeeklyReportRepository.discard).not.toHaveBeenCalled();
    expect(adminAuditRepository.record).not.toHaveBeenCalled();
  });

  it('não refaz trabalho quando outra instância já reservou a semana', async () => {
    vi.mocked(adminWeeklyReportRepository.claim).mockResolvedValue(null);

    expect(await adminReportService.generateWeeklyReport()).toBeNull();
    expect(adminProfileRepository.allUsersForReport).not.toHaveBeenCalled();
    expect(adminWeeklyReportRepository.markReady).not.toHaveBeenCalled();
  });

  it('liberta a reserva se a geração falhar', async () => {
    const id = '00000000-0000-4000-8000-000000000006';
    vi.mocked(adminWeeklyReportRepository.claim).mockResolvedValue(id);
    vi.mocked(adminProfileRepository.allUsersForReport).mockRejectedValue(
      new Error('BD indisponível')
    );

    await expect(adminReportService.generateWeeklyReport()).rejects.toThrow('BD indisponível');
    expect(adminWeeklyReportRepository.discard).toHaveBeenCalledWith(id);
  });
});
