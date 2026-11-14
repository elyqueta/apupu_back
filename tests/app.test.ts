import request from 'supertest';
import { describe, expect, it } from 'vitest';
import app from '../src/app';

describe('app', () => {
  it('serve o spec OpenAPI em desenvolvimento', async () => {
    const response = await request(app).get('/openapi.json');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      openapi: '3.0.0',
      info: { title: 'Apupu API' },
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
        '/api/v1/host/session',
        '/api/v1/host/events/{eventId}',
        '/api/v1/host/events/{eventId}/invitations',
        '/api/v1/public/invitations/{token}/claim',
        '/api/v1/public/invitations/{token}/rsvp',
      ])
    );
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

  it('impede caching das respostas da API', async () => {
    const response = await request(app).get('/api/v1/rota-inexistente');
    expect(response.headers['cache-control']).toBe('private, no-store');
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
});
