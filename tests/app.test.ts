import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

/**
 * O teste do aceite público não deve depender de uma base de dados:
 * o repositório é simulado para devolver "não encontrado", que é o
 * mesmo 404 genérico devolvido a um token inválido.
 */
vi.mock('../src/repositories/invitation.repository', () => ({
  invitationRepository: {
    findByTokenHash: vi.fn().mockResolvedValue(null),
  },
}));

import app from '../src/app';
import { invitationRepository } from '../src/repositories/invitation.repository';

describe('app', () => {
  it('serve o spec OpenAPI em desenvolvimento', async () => {
    const response = await request(app).get('/openapi.json');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      openapi: '3.0.0',
      info: { title: 'Conto Contigo API' },
    });
    expect(Object.keys(response.body.paths ?? {}).length).toBeGreaterThan(0);
  });

  it('documenta as rotas de gestão e públicas do contrato', async () => {
    const response = await request(app).get('/openapi.json');
    const paths = Object.keys(response.body.paths ?? {});

    expect(paths).toEqual(
      expect.arrayContaining([
        '/api/v1/events',
        '/api/v1/templates',
        '/api/v1/auth/register',
        '/api/v1/auth/register/request-code',
        '/api/v1/auth/register/verify-code',
        '/api/v1/auth/login',
        '/api/v1/auth/session',
        '/api/v1/auth/password/forgot',
        '/api/v1/host/profile',
        '/api/v1/host/events',
        '/api/v1/host/dashboard',
        '/api/v1/host/guests',
        '/api/v1/host/invitations',
        '/api/v1/host/reports/summary',
        '/api/v1/host/reports/export',
        '/api/v1/host/managers',
        '/api/v1/host/tasks',
        '/api/v1/host/session',
        '/api/v1/host/events/{eventId}',
        '/api/v1/host/events/{eventId}/invitations',
        '/api/v1/host/events/{eventId}/reports',
        '/api/v1/public/invitations/{token}/claim',
        '/api/v1/public/invitations/{token}/rsvp',
      ])
    );
  });

  it('documenta os esquemas de conta e paginação', async () => {
    const response = await request(app).get('/openapi.json');
    const schemas = response.body.components?.schemas ?? {};
    const invitationCreate =
      response.body.paths?.['/api/v1/host/events/{eventId}/invitations']?.post;

    expect(schemas).toHaveProperty('Host');
    expect(schemas).toHaveProperty('HostProfile');
    expect(schemas).toHaveProperty('PaginationMeta');
    expect(schemas).toHaveProperty('EventCategory');
    expect(schemas).toHaveProperty('GuestInvitation');
    expect(response.body.components?.securitySchemes).toHaveProperty('accountSession');
    expect(invitationCreate.security).toEqual([
      { hostSession: [] },
      { accountSession: [] },
    ]);
  });

  it('devolve 404 no envelope de erro estável', async () => {
    const response = await request(app).get('/api/v1/rota-inexistente');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      error: {
        code: 'route_not_found',
        request_id: expect.any(String),
      },
    });
    expect(response.body.error.message).toEqual(expect.any(String));
  });

  it('devolve 422 com fields em erros de validação', async () => {
    const response = await request(app)
      .post('/api/v1/events')
      .send({ event: { title: 'X' } });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('validation_failed');
    expect(response.body.error.fields).toEqual(expect.any(Object));
  });

  it('devolve 400 para JSON inválido', async () => {
    const response = await request(app)
      .post('/api/v1/events')
      .set('Content-Type', 'application/json')
      .send('{"event": ');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('invalid_json');
  });

  it('devolve o mesmo 404 genérico para token público inexistente', async () => {
    const response = await request(app).get(
      '/api/v1/public/invitations/token-que-nao-existe-123456'
    );

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('invitation_not_found');
    expect(response.body.error.message).toBe('Convite não encontrado.');
  });

  it('devolve o mesmo 404 genérico para um link expirado', async () => {
    vi.mocked(invitationRepository.findByTokenHash).mockResolvedValueOnce({
      id: '00000000-0000-4000-8000-000000000001',
      eventId: '00000000-0000-4000-8000-000000000002',
      guestName: 'João',
      guestEmail: 'joao@exemplo.ao',
      guestPhone: null,
      tableName: null,
      guestMessage: null,
      linkExpiresAt: new Date('2020-01-01T00:00:00Z'),
      tokenHash: 'hash',
      tokenEncrypted: 'cifrado',
      claimHash: null,
      claimedAt: null,
      claimRevokedAt: null,
      rsvpStatus: 'pending',
      rsvpRespondedAt: null,
      rsvpVersion: 0,
      sendStatus: 'pending',
      sendCount: 0,
      lastSentAt: null,
      createdAt: new Date('2019-12-01T00:00:00Z'),
      updatedAt: new Date('2019-12-01T00:00:00Z'),
    });

    const response = await request(app).get(
      '/api/v1/public/invitations/token-expirado-com-pelo-menos-20'
    );

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('invitation_not_found');
    expect(response.body.error.message).toBe('Convite não encontrado.');
  });

  it('impede caching das respostas da API', async () => {
    const response = await request(app).get('/api/v1/rota-inexistente');
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('propaga o X-Request-Id para a resposta e para o erro', async () => {
    const response = await request(app)
      .get('/api/v1/rota-inexistente')
      .set('X-Request-Id', 'test-request-123');

    expect(response.headers['x-request-id']).toBe('test-request-123');
    expect(response.body.error.request_id).toBe('test-request-123');
  });

  it('não aceita um X-Request-Id com caracteres inseguros', async () => {
    const response = await request(app)
      .get('/api/v1/rota-inexistente')
      .set('X-Request-Id', 'id com espaços');

    expect(response.headers['x-request-id']).not.toBe('id com espaços');
    expect(response.body.error.request_id).toBe(response.headers['x-request-id']);
  });

  it('exige sessão de gestão nas rotas do anfitrião', async () => {
    const response = await request(app).get(
      '/api/v1/host/events/00000000-0000-4000-8000-000000000000'
    );

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('host_session_invalid');
  });

  it('exige CSRF nos pedidos mutáveis de gestão', async () => {
    const response = await request(app)
      .patch('/api/v1/host/events/00000000-0000-4000-8000-000000000000')
      .send({ dress_code: 'Formal' });

    // Sem sessão, o 401 vem antes do CSRF — a ordem é intencional.
    expect(response.status).toBe(401);
  });

  it('exige sessão de conta nas rotas do workspace', async () => {
    const session = await request(app).get('/api/v1/auth/session');
    expect(session.status).toBe(401);
    expect(session.body.error.code).toBe('host_session_invalid');

    const profile = await request(app).get('/api/v1/host/profile');
    expect(profile.status).toBe(401);
    expect(profile.body.error.code).toBe('host_session_invalid');

    const events = await request(app).get('/api/v1/host/events');
    expect(events.status).toBe(401);
    expect(events.body.error.code).toBe('host_session_invalid');

    const dashboard = await request(app).get('/api/v1/host/dashboard');
    expect(dashboard.status).toBe(401);
  });

  it('exige sessão antes do CSRF nas mutações autenticadas', async () => {
    const logout = await request(app).post('/api/v1/auth/logout');
    expect(logout.status).toBe(401);
    expect(logout.body.error.code).toBe('host_session_invalid');

    const createEvent = await request(app).post('/api/v1/host/events').send({});
    expect(createEvent.status).toBe(401);
    expect(createEvent.body.error.code).toBe('host_session_invalid');
  });

  it('valida o registo de conta', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'não-é-email', password: 'curta' });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('validation_failed');
    expect(response.body.error.fields).toHaveProperty('email');
    expect(response.body.error.fields).toHaveProperty('password');
  });

  it('valida o email no reenvio de verificação', async () => {
    const response = await request(app)
      .post('/api/v1/auth/email/verify/resend')
      .send({ email: 'não-é-email' });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('validation_failed');
    expect(response.body.error.fields).toHaveProperty('email');
  });

  it('mantém o aceite público sem conta', async () => {
    const claim = await request(app).post(
      '/api/v1/public/invitations/token-que-nao-existe-123456/claim'
    );
    expect(claim.status).toBe(404);
    expect(claim.body.error.code).toBe('invitation_not_found');

    const rsvp = await request(app)
      .put('/api/v1/public/invitations/token-que-nao-existe-123456/rsvp')
      .send({ status: 'accepted' });
    expect(rsvp.status).toBe(404);
    expect(rsvp.body.error.code).toBe('invitation_not_found');
  });

  it('resolve todos os $ref do spec OpenAPI', async () => {
    const response = await request(app).get('/openapi.json');
    const spec = response.body as Record<string, unknown>;

    const resolve = (ref: string): unknown => {
      expect(ref.startsWith('#/')).toBe(true);

      return ref
        .slice(2)
        .split('/')
        .reduce<unknown>((node, segment) => {
          if (node === null || typeof node !== 'object') return undefined;
          return (node as Record<string, unknown>)[segment];
        }, spec);
    };

    const refs = new Set<string>();
    const visit = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      if (node === null || typeof node !== 'object') return;

      for (const [key, value] of Object.entries(node)) {
        if (key === '$ref' && typeof value === 'string') refs.add(value);
        else visit(value);
      }
    };
    visit(spec);

    expect(refs.size).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(resolve(ref), `$ref não resolvido: ${ref}`).toBeDefined();
    }
  });

  it('documenta um corpo JSON em todas as respostas não-2xx', async () => {
    const response = await request(app).get('/openapi.json');
    const spec = response.body as {
      paths?: Record<string, Record<string, unknown>>;
      components?: { responses?: Record<string, { content?: Record<string, unknown> }> };
    };

    const failures: string[] = [];
    const withoutErrors: string[] = [];

    for (const [pathName, pathItem] of Object.entries(spec.paths ?? {})) {
      for (const [method, rawOperation] of Object.entries(pathItem)) {
        const operation = rawOperation as { responses?: Record<string, unknown> };
        const statuses = Object.keys(operation.responses ?? {});

        if (!statuses.some((status) => !status.startsWith('2'))) {
          withoutErrors.push(`${method.toUpperCase()} ${pathName}`);
        }

        for (const [status, rawResponse] of Object.entries(operation.responses ?? {})) {
          if (status.startsWith('2')) continue;

          const responseObject = rawResponse as {
            $ref?: string;
            content?: Record<string, unknown>;
          };

          let resolved = responseObject;
          if (responseObject.$ref) {
            const name = responseObject.$ref.replace('#/components/responses/', '');
            const component = spec.components?.responses?.[name];
            if (!component) {
              failures.push(`${method.toUpperCase()} ${pathName} ${status}: $ref inexistente`);
              continue;
            }
            resolved = component;
          }

          if (!resolved.content?.['application/json']) {
            failures.push(`${method.toUpperCase()} ${pathName} ${status}: sem corpo JSON`);
          }
        }
      }
    }

    expect(failures).toEqual([]);
    expect(withoutErrors).toEqual([]);
  });
});
