import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toNewsletterDto } from '../src/dto/newsletter.dto';
import { toSupportMessageDto } from '../src/dto/support.dto';
import { adminNewsletterQuerySchema, adminSupportQuerySchema } from '../src/schemas/admin.schemas';
import { newsletterSubscribeSchema } from '../src/schemas/newsletter.schemas';
import { supportCreateSchema } from '../src/schemas/support.schemas';
import { newsletterService } from '../src/services/newsletter.service';
import { supportService } from '../src/services/support.service';
import { SupportMessage } from '../src/types/support.types';
import { csvField, newsletterCsv } from '../src/utils/newsletterCsv.util';

const UUID = '00000000-0000-4000-8000-000000000001';
const CREATED_AT = new Date('2026-11-20T10:00:00.000Z');

vi.mock('../src/repositories/adminAudit.repository', () => ({
  adminAuditRepository: { record: vi.fn(async () => undefined) },
}));

vi.mock('../src/repositories/support.repository', () => ({
  supportRepository: {
    create: vi.fn(async (data: { name: string; email: string; message: string }) => ({
      id: UUID,
      ...data,
      status: 'open',
      resolvedAt: null,
      resolvedBy: null,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    })),
    findById: vi.fn(async () => null),
    resolve: vi.fn(async () => null),
  },
}));

vi.mock('../src/repositories/newsletter.repository', () => ({
  newsletterRepository: {
    subscribe: vi.fn(async () => undefined),
    remove: vi.fn(async () => true),
  },
}));

import app from '../src/app';
import { adminAuditRepository } from '../src/repositories/adminAudit.repository';
import { newsletterRepository } from '../src/repositories/newsletter.repository';
import { supportRepository } from '../src/repositories/support.repository';

function message(overrides: Partial<SupportMessage> = {}): SupportMessage {
  return {
    id: UUID,
    name: 'Ana Silva',
    email: 'ana@exemplo.pt',
    message: 'Olá, preciso de ajuda com o convite.',
    status: 'open',
    resolvedAt: null,
    resolvedBy: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(supportRepository.findById).mockResolvedValue(null);
  vi.mocked(supportRepository.resolve).mockResolvedValue(null);
  vi.mocked(newsletterRepository.remove).mockResolvedValue(true);
});

describe('Bloco 7 — schemas Zod', () => {
  const validSupport = {
    name: 'Ana Silva',
    email: 'Ana@Exemplo.pt',
    message: 'Olá, preciso de ajuda com o convite.',
  };

  it('valida e normaliza o formulário de apoio nos limites do contrato', () => {
    expect(supportCreateSchema.parse(validSupport)).toEqual({
      ...validSupport,
      email: 'ana@exemplo.pt',
    });

    expect(supportCreateSchema.safeParse({ ...validSupport, name: 'A' }).success).toBe(false);
    expect(supportCreateSchema.safeParse({ ...validSupport, name: 'a'.repeat(120) }).success).toBe(
      true
    );
    expect(supportCreateSchema.safeParse({ ...validSupport, name: 'a'.repeat(121) }).success).toBe(
      false
    );
    expect(supportCreateSchema.safeParse({ ...validSupport, message: '123456789' }).success).toBe(
      false
    );
    expect(supportCreateSchema.safeParse({ ...validSupport, message: 'x'.repeat(2000) }).success).toBe(
      true
    );
    expect(supportCreateSchema.safeParse({ ...validSupport, message: 'x'.repeat(2001) }).success).toBe(
      false
    );
    expect(supportCreateSchema.safeParse({ ...validSupport, extra: 1 }).success).toBe(false);
  });

  it('valida o email da newsletter até 254 caracteres e rejeita campos extra', () => {
    const email254 = `${'a'.repeat(243)}@exemplo.pt`;
    expect(email254).toHaveLength(254);

    expect(newsletterSubscribeSchema.parse({ email: ' ANA@Exemplo.pt ' })).toEqual({
      email: 'ana@exemplo.pt',
    });
    expect(newsletterSubscribeSchema.safeParse({ email: email254 }).success).toBe(true);
    expect(newsletterSubscribeSchema.safeParse({ email: `a${email254}` }).success).toBe(false);
    expect(newsletterSubscribeSchema.safeParse({ email: 'nao-e-email' }).success).toBe(false);
    expect(newsletterSubscribeSchema.safeParse({ email: 'ana@exemplo.pt', extra: 1 }).success).toBe(
      false
    );
  });

  it('valida filtros, estados e paginação das listagens admin', () => {
    expect(
      adminSupportQuerySchema.safeParse({ status: 'all', page: '2', page_size: '10' }).success
    ).toBe(true);
    expect(adminSupportQuerySchema.safeParse({ status: 'pendente' }).success).toBe(false);
    expect(adminSupportQuerySchema.safeParse({ page_size: '101' }).success).toBe(false);
    expect(adminSupportQuerySchema.safeParse({ page: '0' }).success).toBe(false);
    expect(adminNewsletterQuerySchema.safeParse({ q: 'ana', from: '2026-01-01' }).success).toBe(
      true
    );
    expect(adminNewsletterQuerySchema.parse({ status: 'open' })).not.toHaveProperty('status');
  });
});

describe('Bloco 7 — newsletter idempotente', () => {
  it('devolve sempre a mesma resposta, mesmo quando o email já existe', async () => {
    const subscribe = vi.mocked(newsletterRepository.subscribe);

    const first = await newsletterService.subscribe('ana@exemplo.pt');
    const second = await newsletterService.subscribe('ana@exemplo.pt');

    expect(first).toEqual({ subscribed: true });
    expect(second).toEqual(first);
    expect(subscribe).toHaveBeenCalledTimes(2);
    expect(subscribe).toHaveBeenCalledWith('ana@exemplo.pt');
  });

  it('mapeia a remoção inexistente para 404 com código estável', async () => {
    vi.mocked(newsletterRepository.remove).mockResolvedValue(false);

    await expect(newsletterService.removeForAdmin('admin-1', UUID)).rejects.toMatchObject({
      statusCode: 404,
      code: 'newsletter_subscription_not_found',
      message: 'Subscrição não encontrada.',
    });
  });
});

describe('Bloco 7 — DTOs e erro de mensagem inexistente', () => {
  it('expõe a mensagem em snake_case com datas ISO e nulos', () => {
    expect(toSupportMessageDto(message())).toEqual({
      id: UUID,
      name: 'Ana Silva',
      email: 'ana@exemplo.pt',
      message: 'Olá, preciso de ajuda com o convite.',
      status: 'open',
      created_at: CREATED_AT.toISOString(),
      resolved_at: null,
      resolved_by: null,
    });
  });

  it('expõe o resolved_at e o resolved_by quando a mensagem está resolvida', () => {
    const resolvedAt = new Date('2026-11-20T11:30:00.000Z');
    const dto = toSupportMessageDto(
      message({ status: 'resolved', resolvedAt, resolvedBy: 'admin-1' })
    );

    expect(dto.status).toBe('resolved');
    expect(dto.resolved_at).toBe(resolvedAt.toISOString());
    expect(dto.resolved_by).toBe('admin-1');
  });

  it('expõe a subscrição em snake_case', () => {
    expect(
      toNewsletterDto({ id: UUID, email: 'ana@exemplo.pt', createdAt: CREATED_AT })
    ).toEqual({
      id: UUID,
      email: 'ana@exemplo.pt',
      created_at: CREATED_AT.toISOString(),
    });
  });

  it('mapeia detalhe e resolução inexistentes para 404 pt-PT', async () => {
    await expect(supportService.findForAdmin('admin-1', UUID)).rejects.toMatchObject({
      statusCode: 404,
      code: 'support_message_not_found',
      message: 'Mensagem não encontrada.',
    });
    await expect(supportService.resolveForAdmin('admin-1', UUID)).rejects.toMatchObject({
      statusCode: 404,
      code: 'support_message_not_found',
      message: 'Mensagem não encontrada.',
    });
  });
});

describe('Bloco 7 — resolve idempotente', () => {
  it('mantém resolved_at/resolved_by ao repetir a operação e não audita conteúdo', async () => {
    const resolvedAt = new Date('2026-11-20T11:30:00.000Z');
    const resolved = message({ status: 'resolved', resolvedAt, resolvedBy: 'admin-1' });
    vi.mocked(supportRepository.resolve).mockResolvedValue(resolved);

    const first = await supportService.resolveForAdmin('admin-1', UUID);
    const second = await supportService.resolveForAdmin('admin-1', UUID);

    expect(toSupportMessageDto(first)).toEqual(toSupportMessageDto(second));
    expect(first.resolvedAt).toEqual(resolvedAt);
    expect(first.resolvedBy).toBe('admin-1');
    expect(supportRepository.resolve).toHaveBeenCalledTimes(2);
    expect(supportRepository.resolve).toHaveBeenCalledWith(UUID, 'admin-1');

    const audit = vi.mocked(adminAuditRepository.record).mock.calls[0]?.[0];
    expect(audit?.action).toBe('support_message_resolved');
    expect(JSON.stringify(audit?.metadata ?? {})).not.toContain(resolved.message);
  });
});

describe('Bloco 7 — exportação CSV', () => {
  it('usa o cabeçalho do contrato e protege fórmulas e aspas', () => {
    expect(csvField('ana@exemplo.pt')).toBe('ana@exemplo.pt');
    expect(csvField('  =SUM(A1:A2)')).toBe("'  =SUM(A1:A2)");
    expect(csvField('+cmd')).toBe("'+cmd");
    expect(csvField('-cmd')).toBe("'-cmd");
    expect(csvField('@cmd')).toBe("'@cmd");
    expect(csvField('a"b@exemplo.pt')).toBe('"a""b@exemplo.pt"');

    const csv = newsletterCsv([
      { id: '1', email: '=SUM(A1:A2)', createdAt: CREATED_AT },
      { id: '2', email: 'a"b@exemplo.pt', createdAt: CREATED_AT },
    ]);

    expect(csv.startsWith('email,created_at\r\n')).toBe(true);
    expect(csv).toContain(`'=SUM(A1:A2),${CREATED_AT.toISOString()}`);
    expect(csv).toContain(`"a""b@exemplo.pt",${CREATED_AT.toISOString()}`);
    expect(csv.split('\r\n')).toHaveLength(4);
    expect(csv.split('\r\n')[3]).toBe('');
  });
});

describe('Bloco 7 — rotas públicas', () => {
  it('aceita apoio sem CSRF e devolve apenas id e created_at', async () => {
    const response = await request(app).post('/api/v1/public/support').send({
      name: 'Ana Silva',
      email: 'ana@exemplo.pt',
      message: 'Olá, preciso de ajuda com o convite.',
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ data: { id: UUID, created_at: CREATED_AT.toISOString() } });

    const invalid = await request(app)
      .post('/api/v1/public/support')
      .send({ name: 'A', email: 'inválido', message: 'curta' });
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.code).toBe('validation_failed');
    expect(invalid.body.error.fields).toHaveProperty('email');
  });

  it('aceita a mesma subscrição duas vezes com resposta igual', async () => {
    const first = await request(app)
      .post('/api/v1/public/newsletter')
      .send({ email: 'ana@exemplo.pt' });
    const second = await request(app)
      .post('/api/v1/public/newsletter')
      .send({ email: 'ANA@exemplo.pt' });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body).toEqual({ data: { subscribed: true } });
    expect(second.body).toEqual(first.body);
  });
});
