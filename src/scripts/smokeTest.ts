import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { closePool } from '../database/pool';
import { processOutbox } from '../services/outbox.service';

/**
 * Smoke test da API.
 *
 * Por omissão é só de leitura. Com `SMOKE_WRITE=true` percorre o fluxo
 * completo: criar evento, obter o link de gestão a partir da outbox de
 * desenvolvimento, abrir sessão, adicionar convidado, reclamar o convite
 * e recusar. Escreve dados na base de dados configurada.
 */
const BASE = env.API_BASE_URL.replace(/\/+$/, '');

interface ApiResponse {
  status: number;
  body: unknown;
  cookies: string[];
}

function cookieHeader(cookies: string[]): string {
  return cookies.map((cookie) => cookie.split(';')[0]).join('; ');
}

async function request(
  route: string,
  init: RequestInit = {},
  cookies: string[] = []
): Promise<ApiResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };

  if (cookies.length > 0) headers.Cookie = cookieHeader(cookies);

  const response = await fetch(`${BASE}${route}`, { ...init, headers });
  const text = await response.text();

  let body: unknown = text;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    // mantém texto
  }

  const withGetSetCookie = response.headers as Headers & { getSetCookie?: () => string[] };
  const cookiesFromResponse =
    withGetSetCookie.getSetCookie?.() ??
    [response.headers.get('set-cookie')].filter((value): value is string => Boolean(value));

  return { status: response.status, body, cookies: cookiesFromResponse };
}

function assertStatus(label: string, response: ApiResponse, expected: number): void {
  if (response.status !== expected) {
    throw new Error(
      `${label}: esperado ${expected}, recebido ${response.status} — ${JSON.stringify(response.body)}`
    );
  }
}

function dataOf(response: ApiResponse): Record<string, unknown> {
  const body = response.body as { data?: Record<string, unknown> } | null;
  return body?.data ?? {};
}

/** Lê a mensagem mais recente da outbox de desenvolvimento. */
async function latestOutboxMessage(
  predicate: (message: { to?: string; subject?: string; text?: string }) => boolean
): Promise<{ to: string; subject: string; text: string }> {
  const directory = path.resolve(process.cwd(), env.EMAIL_JSON_DIR);
  const files = (await readdir(directory)).filter((file) => file.endsWith('.json')).sort();

  for (const file of files.reverse()) {
    const raw = await readFile(path.join(directory, file), 'utf8');
    const message = JSON.parse(raw) as { to?: string; subject?: string; text?: string };

    if (predicate(message)) {
      return {
        to: message.to ?? '',
        subject: message.subject ?? '',
        text: message.text ?? '',
      };
    }
  }

  throw new Error(`Nenhuma mensagem correspondente em ${directory}.`);
}

function extractToken(text: string, prefix: string): string {
  const match = new RegExp(`${prefix}/([A-Za-z0-9_-]+)`).exec(text);
  if (!match?.[1]) throw new Error(`Token não encontrado no texto do email (${prefix}).`);
  return match[1];
}

async function readOnlyChecks(): Promise<void> {
  assertStatus('health', await request('/health'), 200);
  assertStatus('templates', await request('/api/v1/templates'), 200);

  const missing = await request('/api/v1/rota-inexistente');
  assertStatus('rota inexistente', missing, 404);

  logger.info('Smoke test de leitura concluído.');
}

async function writeFlow(): Promise<void> {
  const suffix = Date.now().toString(36);
  const hostEmail = `host-${suffix}@example.test`;
  const guestEmail = `guest-${suffix}@example.test`;
  const startsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const created = await request('/api/v1/events', {
    method: 'POST',
    body: JSON.stringify({
      event: {
        title: `Evento smoke ${suffix}`,
        host_name: 'Anfitriã Smoke',
        host_email: hostEmail,
        starts_at: startsAt,
        timezone: 'Africa/Luanda',
        location: { type: 'venue', name: 'Espaço de teste', address: 'Luanda' },
        message: 'Evento criado pelo smoke test.',
        rules: 'Sem regras.',
        dress_code: 'Casual',
        theme: { mode: 'dark', palette: 'default' },
        contribution: { enabled: false },
      },
      guests: [{ name: 'Convidado Smoke', email: guestEmail, phone: null }],
    }),
  });

  assertStatus('criar evento', created, 201);

  const createdData = dataOf(created);
  const event = createdData.event as { id?: string } | undefined;
  if (!event?.id) throw new Error('Evento criado sem id na resposta.');

  // Em desenvolvimento, as mensagens ficam em ficheiros. Processa a
  // outbox para garantir que os convites já foram renderizados.
  if (env.EMAIL_TRANSPORT === 'json') {
    await processOutbox();
  }

  const manageMessage = await latestOutboxMessage(
    (message) => message.to === hostEmail && (message.subject ?? '').includes('link de gestão')
  );
  const manageToken = extractToken(manageMessage.text, '/gerir');

  const session = await request('/api/v1/host/session', {
    method: 'POST',
    body: JSON.stringify({ token: manageToken }),
  });
  assertStatus('abrir sessão de gestão', session, 200);

  const sessionData = dataOf(session);
  const csrfToken = sessionData.csrf_token;
  if (typeof csrfToken !== 'string') throw new Error('Sessão sem csrf_token.');

  const hostCookies = session.cookies;
  const eventRoute = `/api/v1/host/events/${event.id}`;

  assertStatus('consultar evento', await request(eventRoute, {}, hostCookies), 200);

  const updated = await request(
    eventRoute,
    {
      method: 'PATCH',
      headers: { 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ dress_code: 'Traje formal' }),
    },
    hostCookies
  );
  assertStatus('actualizar evento', updated, 200);

  const added = await request(
    `${eventRoute}/invitations`,
    {
      method: 'POST',
      headers: { 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ name: 'Segundo Convidado', email: `second-${suffix}@example.test` }),
    },
    hostCookies
  );
  assertStatus('adicionar convidado', added, 201);

  if (env.EMAIL_TRANSPORT === 'json') {
    await processOutbox();
  }

  const inviteMessage = await latestOutboxMessage(
    (message) => message.to === guestEmail && (message.subject ?? '').startsWith('Convite:')
  );
  const inviteToken = extractToken(inviteMessage.text, '/convite');

  const claimed = await request(`/api/v1/public/invitations/${inviteToken}/claim`, {
    method: 'POST',
  });
  assertStatus('reclamar convite', claimed, 200);

  const claimData = dataOf(claimed);
  const guestCsrf = claimData.csrf_token;
  if (typeof guestCsrf !== 'string') throw new Error('Claim sem csrf_token.');

  const guestCookies = claimed.cookies;

  assertStatus(
    'consultar convite',
    await request(`/api/v1/public/invitations/${inviteToken}`, {}, guestCookies),
    200
  );

  const rsvp = await request(
    `/api/v1/public/invitations/${inviteToken}/rsvp`,
    {
      method: 'PUT',
      headers: { 'X-CSRF-Token': guestCsrf },
      body: JSON.stringify({ status: 'declined' }),
    },
    guestCookies
  );
  assertStatus('recusar convite', rsvp, 200);

  assertStatus(
    'terminar sessão',
    await request(
      `/api/v1/host/session/${event.id}`,
      { method: 'DELETE', headers: { 'X-CSRF-Token': csrfToken } },
      hostCookies
    ),
    204
  );

  logger.info({ eventId: event.id }, 'Smoke test completo concluído.');
}

async function main(): Promise<void> {
  try {
    await readOnlyChecks();

    if (process.env.SMOKE_WRITE === 'true') {
      await writeFlow();
    }
  } finally {
    await closePool();
  }
}

void main().catch((error: unknown) => {
  logger.error({ err: error }, 'Smoke test falhou.');
  process.exitCode = 1;
});
