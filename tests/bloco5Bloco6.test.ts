import { describe, expect, it, vi } from 'vitest';
import { toHostDto } from '../src/dto/host.dto';
import { ConflictError, ForbiddenError } from '../src/errors';
import {
  EVENT_CANCELLED_MESSAGE,
  requireActiveEvent,
  resolveEventIdForWrite,
} from '../src/middlewares/requireActiveEvent';
import { assertNotSelf } from '../src/middlewares/requireSuperAdmin';
import { hostCancelSchema, adminCancelSchema } from '../src/schemas/admin.schemas';
import { inboxQuerySchema } from '../src/schemas/inbox.schemas';
import type { HostWithProfile } from '../src/types/host.types';

/** Pedido mínimo para os testes do guard; só importa method/path/params/body. */
const UUID = '00000000-0000-4000-8000-000000000001';

function request(method: string, path: string, params: Record<string, string> = {}, body: unknown = {}) {
  return { method, path, params, body } as never;
}

describe('Bloco 5/6 — evento cancelado', () => {
  it('bloqueia escritas com event_cancelled em todas as rotas ligadas ao evento', async () => {
    const dependencies = {
      findEventStatus: vi.fn(async () => ({ status: 'cancelled' })),
      findInvitationByTokenHash: vi.fn(async () => ({ eventId: 'event-1' })),
      findInvitationById: vi.fn(async () => ({ eventId: 'event-1' })),
      findTaskById: vi.fn(async () => ({ eventId: 'event-1' })),
      findTeamById: vi.fn(async () => ({ eventId: 'event-1' })),
      findTeamInviteByTokenHash: vi.fn(async () => ({ eventId: 'event-1' })),
    };

    const cases = [
      request('PATCH', `/host/events/${UUID}`, { eventId: UUID }),
      request('POST', '/public/invitations/token/rsvp'),
      request('POST', `/host/tasks/${UUID}`, { taskId: UUID }),
      request('DELETE', `/host/teams/${UUID}`, { teamId: UUID }),
      request('POST', `/host/inbox/${UUID}/answer`, { invitationId: UUID }),
    ];

    for (const req of cases) {
      let captured: unknown;
      await requireActiveEvent(dependencies)(req, {} as never, ((error: unknown) => {
        captured = error;
      }) as never);

      expect(captured).toBeInstanceOf(ConflictError);
      expect((captured as ConflictError).code).toBe('event_cancelled');
      expect((captured as ConflictError).message).toBe(EVENT_CANCELLED_MESSAGE);
    }
  });

  it('não bloqueia leituras nem o próprio cancelamento', async () => {
    const dependencies = {
      findEventStatus: vi.fn(async () => ({ status: 'cancelled' })),
      findInvitationByTokenHash: vi.fn(async () => null),
      findInvitationById: vi.fn(async () => null),
      findTaskById: vi.fn(async () => null),
      findTeamById: vi.fn(async () => null),
      findTeamInviteByTokenHash: vi.fn(async () => null),
    };

    for (const req of [
      request('GET', '/public/invitations/token'),
      request('POST', `/host/events/${UUID}/cancel`, { eventId: UUID }),
    ]) {
      let captured: unknown;
      await requireActiveEvent(dependencies)(req, {} as never, ((error?: unknown) => {
        captured = error;
      }) as never);
      expect(captured).toBeUndefined();
    }
  });

  it('resolve o evento a partir de outro recurso quando não há eventId na rota', async () => {
    const dependencies = {
      findEventStatus: vi.fn(async () => null),
      findInvitationByTokenHash: vi.fn(async () => null),
      findInvitationById: vi.fn(async () => ({ eventId: 'via-invitation' })),
      findTaskById: vi.fn(async () => ({ eventId: 'via-task' })),
      findTeamById: vi.fn(async () => ({ eventId: 'via-team' })),
      findTeamInviteByTokenHash: vi.fn(async () => null),
    };

    expect(await resolveEventIdForWrite(request('POST', `/host/tasks/${UUID}`, { taskId: UUID }), dependencies)).toBe('via-task');
    expect(await resolveEventIdForWrite(request('POST', `/host/inbox/${UUID}/answer`, { invitationId: UUID }), dependencies)).toBe('via-invitation');
  });
});

describe('Bloco 6 — protecção do super admin', () => {
  it('impede acções sobre a própria conta', () => {
    expect(() => assertNotSelf('admin-1', 'admin-1')).toThrow(ForbiddenError);
    expect(() => assertNotSelf('admin-1', 'admin-2')).not.toThrow();
  });

  it('exige OTP nos dois cancelamentos e motivo apenas no admin', () => {
    expect(adminCancelSchema.safeParse({ otp: '123456' }).success).toBe(false);
    expect(adminCancelSchema.safeParse({ otp: '123456', reason: 'Motivo válido' }).success).toBe(true);
    expect(hostCancelSchema.safeParse({ otp: '123456' }).success).toBe(true);
    expect(hostCancelSchema.safeParse({ otp: 'abc' }).success).toBe(false);
  });

  it('expõe is_super_admin no DTO da sessão', () => {
    const now = new Date();
    const host = {
      id: 'host-1',
      email: 'admin@exemplo.ao',
      emailVerifiedAt: now,
      isSuperAdmin: true,
      status: 'active',
      createdAt: now,
      profile: {
        displayName: 'Admin',
        birthDate: null,
        locale: 'pt-AO',
        timezone: 'Europe/Lisbon',
        avatarUrl: null,
        coverUrl: null,
      },
    } as unknown as HostWithProfile;

    expect(toHostDto(host).is_super_admin).toBe(true);
  });

  it('aceita event_id como filtro da caixa de entrada', () => {
    expect(inboxQuerySchema.safeParse({ event_id: UUID }).success).toBe(true);
    expect(inboxQuerySchema.safeParse({ event_id: 'nao-uuid' }).success).toBe(false);
  });
});
