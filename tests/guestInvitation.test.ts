import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/repositories/hostAuthSession.repository', () => ({
  hostAuthSessionRepository: {
    findActiveByTokenHash: vi.fn(),
    touch: vi.fn(),
  },
}));

vi.mock('../src/repositories/host.repository', () => ({
  hostRepository: { findById: vi.fn() },
}));

vi.mock('../src/repositories/invitation.repository', () => ({
  invitationRepository: { listForAccountEmail: vi.fn() },
}));

import app from '../src/app';
import { env } from '../src/config/env';
import { hostAuthSessionRepository } from '../src/repositories/hostAuthSession.repository';
import { hostRepository } from '../src/repositories/host.repository';
import { invitationRepository } from '../src/repositories/invitation.repository';
import { HostAuthSession, HostWithProfile } from '../src/types/host.types';
import { AccountInvitation } from '../src/types/invitation.types';
import { encryptToken } from '../src/utils/crypto.util';
import { links } from '../src/utils/links.util';

const NOW = new Date('2026-11-15T10:00:00.000Z');
const INVITE_TOKEN = 'convite-token-de-teste-1234567890';

const host: HostWithProfile = {
  id: 'host-1',
  email: 'ana@exemplo.ao',
  passwordHash: 'hash',
  emailVerifiedAt: NOW,
  status: 'active',
  failedLoginAttempts: 0,
  lockedUntil: null,
  lastLoginAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  profile: {
    hostId: 'host-1',
    displayName: 'Ana',
    phone: null,
    birthDate: null,
    locale: 'pt-AO',
    timezone: 'Africa/Luanda',
    avatarUrl: null,
    coverUrl: null,
    coverHash: null,
    coverPublicId: null,
    createdAt: NOW,
    updatedAt: NOW,
  },
};

const accountSession: HostAuthSession = {
  id: 'account-session-1',
  hostId: host.id,
  tokenHash: 'token-hash',
  csrfHash: 'csrf-hash',
  userAgentHash: null,
  expiresAt: new Date('2026-11-22T10:00:00.000Z'),
  revokedAt: null,
  lastUsedAt: null,
  createdAt: NOW,
};

const invitation: AccountInvitation = {
  id: '11111111-1111-4111-8111-111111111111',
  eventId: '22222222-2222-4222-8222-222222222222',
  guestName: 'Ana',
  guestEmail: host.email,
  guestPhone: '+244900000000',
  tableName: 'Mesa 3',
  guestMessage: null,
  linkExpiresAt: new Date('2027-08-17T01:00:00Z'),
  tokenHash: 'hash-secreto',
  tokenEncrypted: encryptToken(INVITE_TOKEN),
  claimHash: null,
  claimedAt: null,
  claimRevokedAt: null,
  rsvpStatus: 'accepted',
  rsvpRespondedAt: NOW,
  rsvpVersion: 1,
  sendStatus: 'sent',
  sendCount: 1,
  lastSentAt: NOW,
  createdAt: NOW,
  updatedAt: NOW,
  eventTitle: 'Casamento da Ana e do João',
  eventHostName: 'Ana Silva',
  eventStartsAt: new Date('2026-12-01T17:00:00.000Z'),
  eventTimezone: 'Africa/Luanda',
  eventStatus: 'scheduled',
  eventCategory: 'wedding',
  eventTemplateId: 'aurora',
  eventLocation: {
    type: 'venue',
    name: 'Salão X',
    address: 'Luanda',
    onlineUrl: null,
  },
};

function authCookie(): string {
  return `${env.AUTH_COOKIE_NAME}=account-token`;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(hostAuthSessionRepository.findActiveByTokenHash).mockResolvedValue(accountSession);
  vi.mocked(hostAuthSessionRepository.touch).mockResolvedValue(undefined);
  vi.mocked(hostRepository.findById).mockResolvedValue(host);
  vi.mocked(invitationRepository.listForAccountEmail).mockResolvedValue({
    items: [invitation],
    total: 1,
  });
});

describe('GET /api/v1/host/invitations (Meus convites)', () => {
  it('devolve os convites do email da conta com o resumo do evento', async () => {
    const response = await request(app)
      .get('/api/v1/host/invitations')
      .set('Cookie', [authCookie()]);

    expect(response.status).toBe(200);
    expect(response.body.pagination).toEqual({
      page: 1,
      page_size: 20,
      total: 1,
      total_pages: 1,
    });

    const item = response.body.data[0];
    expect(item).toMatchObject({
      id: invitation.id,
      event_id: invitation.eventId,
      rsvp_status: 'accepted',
      rsvp_responded_at: NOW.toISOString(),
      table_name: 'Mesa 3',
      invitation_url: links.invitation(INVITE_TOKEN),
      invitation_url_expires_at: '2027-08-17T01:00:00.000Z',
      created_at: NOW.toISOString(),
      event: {
        id: invitation.eventId,
        title: 'Casamento da Ana e do João',
        host_name: 'Ana Silva',
        starts_at: '2026-12-01T17:00:00.000Z',
        timezone: 'Africa/Luanda',
        status: 'scheduled',
        category: 'wedding',
        template_id: 'aurora',
        location: {
          type: 'venue',
          name: 'Salão X',
          address: 'Luanda',
          online_url: null,
        },
      },
    });

    // Nunca expor o convidado em si, outros convidados, envio ou dados
    // internos do evento.
    expect(item).not.toHaveProperty('guest_name');
    expect(item).not.toHaveProperty('guest_email');
    expect(item).not.toHaveProperty('guest_phone');
    expect(item).not.toHaveProperty('send_status');
    expect(item).not.toHaveProperty('send_count');
    expect(item).not.toHaveProperty('updated_at');
    expect(item.event).not.toHaveProperty('host_email');
    expect(item.event).not.toHaveProperty('contribution');
    expect(item.event).not.toHaveProperty('message');
    expect(item.event).not.toHaveProperty('stats');

    expect(invitationRepository.listForAccountEmail).toHaveBeenCalledWith({
      email: host.email,
      sort: 'starts_at',
      order: 'asc',
      offset: 0,
      limit: 20,
    });
  });

  it('usa sempre o email da sessão, ignorando filtros de email do pedido', async () => {
    const response = await request(app)
      .get('/api/v1/host/invitations?guest_email=outro@exemplo.ao&email=outro@exemplo.ao')
      .set('Cookie', [authCookie()]);

    expect(response.status).toBe(200);
    expect(invitationRepository.listForAccountEmail).toHaveBeenCalledWith(
      expect.objectContaining({ email: host.email })
    );
    expect(invitationRepository.listForAccountEmail).not.toHaveBeenCalledWith(
      expect.objectContaining({ email: 'outro@exemplo.ao' })
    );
  });

  it('devolve 401 sem sessão de conta', async () => {
    const response = await request(app).get('/api/v1/host/invitations');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('host_session_invalid');
    expect(invitationRepository.listForAccountEmail).not.toHaveBeenCalled();
  });

  it('devolve 403 quando o email da conta ainda não foi verificado', async () => {
    vi.mocked(hostRepository.findById).mockResolvedValue({
      ...host,
      emailVerifiedAt: null,
    });

    const response = await request(app)
      .get('/api/v1/host/invitations')
      .set('Cookie', [authCookie()]);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('email_not_verified');
    expect(invitationRepository.listForAccountEmail).not.toHaveBeenCalled();
  });

  it('pagina e aceita ordenação descendente', async () => {
    vi.mocked(invitationRepository.listForAccountEmail).mockResolvedValue({
      items: [invitation],
      total: 3,
    });

    const response = await request(app)
      .get('/api/v1/host/invitations?page=2&page_size=2&order=desc')
      .set('Cookie', [authCookie()]);

    expect(response.status).toBe(200);
    expect(response.body.pagination).toEqual({
      page: 2,
      page_size: 2,
      total: 3,
      total_pages: 2,
    });
    expect(invitationRepository.listForAccountEmail).toHaveBeenCalledWith({
      email: host.email,
      sort: 'starts_at',
      order: 'desc',
      offset: 2,
      limit: 2,
    });
  });

  it('devolve data vazia e paginação a zeros quando não há convites', async () => {
    vi.mocked(invitationRepository.listForAccountEmail).mockResolvedValue({
      items: [],
      total: 0,
    });

    const response = await request(app)
      .get('/api/v1/host/invitations')
      .set('Cookie', [authCookie()]);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
    expect(response.body.pagination).toEqual({
      page: 1,
      page_size: 20,
      total: 0,
      total_pages: 0,
    });
  });

  it('mantém eventos cancelados/concluídos com o estado do evento', async () => {
    vi.mocked(invitationRepository.listForAccountEmail).mockResolvedValue({
      items: [{ ...invitation, eventStatus: 'cancelled' }],
      total: 1,
    });

    const response = await request(app)
      .get('/api/v1/host/invitations')
      .set('Cookie', [authCookie()]);

    expect(response.status).toBe(200);
    expect(response.body.data[0].event.status).toBe('cancelled');
  });

  it('rejeita paginação fora dos limites com 422', async () => {
    const response = await request(app)
      .get('/api/v1/host/invitations?page_size=101')
      .set('Cookie', [authCookie()]);

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('validation_failed');
    expect(invitationRepository.listForAccountEmail).not.toHaveBeenCalled();
  });
});
