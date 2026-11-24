import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/database/pool', () => ({
  withTransaction: vi.fn(async (callback: (client: unknown) => unknown) => callback({})),
  query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
  pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
}));

vi.mock('../src/repositories/event.repository', () => ({
  eventRepository: {
    findByPublicSlug: vi.fn(),
    findByIdForUpdate: vi.fn(),
    findByIdForHost: vi.fn(),
    findById: vi.fn(),
    countAccepted: vi.fn(async () => 0),
    softDeleteForHost: vi.fn(async () => true),
    softDelete: vi.fn(async () => true),
  },
}));

vi.mock('../src/repositories/invitation.repository', () => ({
  invitationRepository: {
    findByContactForUpdate: vi.fn(),
    createPublic: vi.fn(),
    updatePublicResponse: vi.fn(),
  },
}));

vi.mock('../src/repositories/host.repository', async () => {
  const actual = await vi.importActual<typeof import('../src/repositories/host.repository')>(
    '../src/repositories/host.repository'
  );
  return {
    ...actual,
    hostRepository: { ...actual.hostRepository, findById: vi.fn() },
  };
});

vi.mock('../src/repositories/hostBirthDateChange.repository', () => ({
  hostBirthDateChangeRepository: { previousValues: vi.fn(async () => []), record: vi.fn() },
}));

vi.mock('../src/repositories/community.repository', () => ({
  communityRepository: { findMemberByHost: vi.fn(async () => null), findActiveMemberByRefCode: vi.fn(async () => null) },
}));

vi.mock('../src/repositories/activity.repository', () => ({
  activityRepository: { create: vi.fn() },
}));

vi.mock('../src/repositories/emailDelivery.repository', () => ({
  emailDeliveryRepository: { cancelPendingForEvent: vi.fn() },
}));

vi.mock('../src/services/reminder.service', () => ({
  cancelMessagesForInvitation: vi.fn(),
  enqueueRemindersForInvitation: vi.fn(),
  enqueueDeclineNotification: vi.fn(),
  enqueueInvitationEmail: vi.fn(),
  enqueueInvitationRemoved: vi.fn(),
  enqueueOnboardingMessages: vi.fn(),
}));

vi.mock('../src/services/linkValidity.service', () => ({
  linkValidityService: { maximumFor: vi.fn(async () => new Date('2030-01-01T00:00:00Z')) },
}));

import { query } from '../src/database/pool';
import { toEventDto, toOpenEventDto } from '../src/dto/event.dto';
import { activityRepository } from '../src/repositories/activity.repository';
import { eventRepository } from '../src/repositories/event.repository';
import { hostBirthDateChangeRepository } from '../src/repositories/hostBirthDateChange.repository';
import { hostRepository } from '../src/repositories/host.repository';
import { invitationRepository } from '../src/repositories/invitation.repository';
import { createEventSchema, updateEventSchema } from '../src/schemas/event.schemas';
import { publicEventRsvpSchema } from '../src/schemas/invitation.schemas';
import { hostEventService } from '../src/services/hostEvent.service';
import {
  PUBLIC_RSVP_REFUSED_CODE,
  PUBLIC_RSVP_REFUSED_MESSAGE,
  publicEventService,
} from '../src/services/publicEvent.service';
import { EventRecord } from '../src/types/event.types';
import { HostWithProfile } from '../src/types/host.types';
import { Invitation } from '../src/types/invitation.types';
import { ageFromBirthDate, ageWithinLimits } from '../src/utils/age.util';

const eventId = '00000000-0000-4000-8000-0000000000a1';
const hostId = '00000000-0000-4000-8000-0000000000b1';

function makeEvent(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: eventId,
    hostId,
    manageTokenHash: 'hash',
    manageTokenExpiresAt: null,
    manageTokenRevokedAt: null,
    title: 'Festa da Ana',
    hostName: 'Ana',
    hostEmail: 'ana@exemplo.ao',
    category: 'birthday',
    startsAt: new Date(Date.now() + 10 * 24 * 3600 * 1000),
    endsAt: null,
    timezone: 'Africa/Luanda',
    location: { type: 'venue', name: 'Casa', address: null, onlineUrl: null },
    message: null,
    rules: null,
    dressCode: null,
    templateId: null,
    theme: { mode: 'light', palette: 'default' },
    contribution: { enabled: false, bankName: null, accountHolder: null, accountReference: null },
    coverUrl: null,
    coverHash: null,
    coverPublicId: null,
    rsvpDeadline: null,
    status: 'scheduled',
    cancelledAt: null,
    cancelledReason: null,
    cancelledBy: null,
    visibility: 'public',
    publicSlug: 'abcDEF123_-x',
    showAttendeeCount: false,
    minAge: null,
    maxAge: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeInvitation(overrides: Partial<Invitation> = {}): Invitation {
  return {
    id: '00000000-0000-4000-8000-0000000000c1',
    eventId,
    guestName: 'Visitante',
    guestEmail: 'v@exemplo.ao',
    guestPhone: null,
    guestPhoneNormalized: null,
    source: 'public_link',
    guestAge: null,
    ageFlag: false,
    ageFlagReason: null,
    tableName: null,
    guestMessage: null,
    messageAnswer: null,
    messageAnsweredAt: null,
    messageReadAt: null,
    linkExpiresAt: null,
    tokenHash: 'h',
    tokenEncrypted: 'e',
    claimHash: null,
    claimedAt: null,
    claimRevokedAt: null,
    rsvpStatus: 'accepted',
    rsvpRespondedAt: new Date(),
    rsvpVersion: 1,
    sendStatus: 'pending',
    sendCount: 0,
    lastSentAt: null,
    whatsappSharedAt: null,
    whatsappShareCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeHost(birthDate: string | null): HostWithProfile {
  return {
    id: hostId,
    email: 'conta@exemplo.ao',
    passwordHash: null,
    emailVerifiedAt: new Date(),
    isSuperAdmin: false,
    status: 'active',
    failedLoginAttempts: 0,
    lockedUntil: null,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    profile: {
      hostId,
      displayName: 'Conta Real',
      phone: null,
      birthDate,
      locale: 'pt-AO',
      timezone: 'Africa/Luanda',
      avatarUrl: null,
      avatarHash: null,
      avatarPublicId: null,
      coverUrl: null,
      coverHash: null,
      coverPublicId: null,
      visibility: 'private',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  } as HostWithProfile;
}

const account = { hostId, email: 'conta@exemplo.ao', emailVerified: true, sessionToken: 't' };

function yearsAgo(years: number): string {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - years);
  date.setUTCDate(date.getUTCDate() - 2);
  return date.toISOString().slice(0, 10);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(eventRepository.findByPublicSlug).mockResolvedValue(makeEvent());
  vi.mocked(eventRepository.findByIdForUpdate).mockResolvedValue(makeEvent());
  vi.mocked(invitationRepository.findByContactForUpdate).mockResolvedValue(null);
  vi.mocked(invitationRepository.createPublic).mockImplementation(async (data) =>
    makeInvitation({ guestName: data.guestName, guestEmail: data.guestEmail, rsvpStatus: data.status })
  );
});

describe('Bloco 10 — idade', () => {
  it('calcula a idade em anos completos e respeita os limites', () => {
    expect(ageFromBirthDate('2000-01-01', new Date('2026-01-01T12:00:00Z'))).toBe(26);
    expect(ageFromBirthDate('2000-06-15', new Date('2026-06-14T12:00:00Z'))).toBe(25);
    expect(ageWithinLimits(17, { minAge: 18, maxAge: null })).toBe(false);
    expect(ageWithinLimits(18, { minAge: 18, maxAge: 30 })).toBe(true);
    expect(ageWithinLimits(31, { minAge: 18, maxAge: 30 })).toBe(false);
  });

  it('valida mín ≤ máx no evento', () => {
    const result = updateEventSchema.safeParse({ min_age: 30, max_age: 18 });
    expect(result.success).toBe(false);
  });

  it('eventos novos são privados por defeito', () => {
    const parsed = createEventSchema.parse({
      event: {
        title: 'Teste',
        host_name: 'Ana',
        host_email: 'ana@exemplo.ao',
        starts_at: new Date(Date.now() + 86_400_000).toISOString(),
        location: { type: 'venue', name: 'Casa' },
      },
    });
    expect(parsed.event.visibility).toBe('private');
    expect(parsed.event.show_attendee_count).toBe(false);
  });
});

describe('Bloco 10 — DTO público', () => {
  it('nunca expõe limites de idade nem convidados; contagem só quando permitida', () => {
    const contact = { name: 'Ana', email: 'ana@exemplo.ao', phone: null, avatarUrl: null };
    const hidden = toOpenEventDto(makeEvent({ minAge: 18, maxAge: 30 }), contact, {
      rsvpDeadlinePassed: false,
      attendeeCount: 7,
    });
    expect(hidden.has_age_restriction).toBe(true);
    expect('attendee_count' in hidden).toBe(false);
    expect(JSON.stringify(hidden)).not.toMatch(/min_age|max_age|guests/);

    const shown = toOpenEventDto(makeEvent({ showAttendeeCount: true }), contact, {
      rsvpDeadlinePassed: false,
      attendeeCount: 7,
    });
    expect(shown.attendee_count).toBe(7);
  });

  it('vista de gestão traz o link público só quando o evento é público', () => {
    expect(toEventDto(makeEvent()).public_url).toMatch(/\/e\/abcDEF123_-x$/);
    expect(toEventDto(makeEvent({ visibility: 'private' })).public_url).toBeNull();
  });
});

describe('Bloco 10 — RSVP pelo link aberto', () => {
  it('exige nome e pelo menos um contacto', async () => {
    const body = publicEventRsvpSchema.parse({ name: 'Rui', status: 'accepted' });
    await expect(publicEventService.rsvp('abcDEF123_-x', body, null)).rejects.toMatchObject({
      statusCode: 422,
    });
  });

  it('cria uma confirmação com origem public_link', async () => {
    const body = publicEventRsvpSchema.parse({
      name: 'Rui',
      phone: '923 456 789',
      status: 'accepted',
    });
    await publicEventService.rsvp('abcDEF123_-x', body, null);
    expect(invitationRepository.createPublic).toHaveBeenCalledWith(
      expect.objectContaining({ guestPhoneNormalized: '+244923456789', guestEmail: null }),
      expect.anything()
    );
  });

  it('o mesmo contacto actualiza a resposta existente (sem duplicar)', async () => {
    vi.mocked(invitationRepository.findByContactForUpdate).mockResolvedValue(makeInvitation());
    vi.mocked(invitationRepository.updatePublicResponse).mockResolvedValue(
      makeInvitation({ rsvpStatus: 'declined' })
    );
    const body = publicEventRsvpSchema.parse({
      name: 'Visitante',
      email: 'V@exemplo.ao',
      status: 'declined',
    });
    await publicEventService.rsvp('abcDEF123_-x', body, null);
    expect(invitationRepository.createPublic).not.toHaveBeenCalled();
    expect(invitationRepository.updatePublicResponse).toHaveBeenCalledTimes(1);
  });

  it('não altera convites individuais pelo link aberto', async () => {
    vi.mocked(invitationRepository.findByContactForUpdate).mockResolvedValue(
      makeInvitation({ source: 'personal' })
    );
    const body = publicEventRsvpSchema.parse({ name: 'Ana', email: 'v@exemplo.ao', status: 'accepted' });
    await expect(publicEventService.rsvp('abcDEF123_-x', body, null)).rejects.toMatchObject({
      code: 'public_rsvp_personal_invite',
    });
  });

  it('recusa por idade devolve sempre a mesma resposta (abaixo ou acima)', async () => {
    const restricted = makeEvent({ minAge: 18, maxAge: 30 });
    vi.mocked(eventRepository.findByPublicSlug).mockResolvedValue(restricted);
    vi.mocked(eventRepository.findByIdForUpdate).mockResolvedValue(restricted);

    const errors = [];
    for (const age of [12, 45]) {
      const body = publicEventRsvpSchema.parse({ name: 'Rui', email: 'r@x.ao', age, status: 'accepted' });
      errors.push(await publicEventService.rsvp('abcDEF123_-x', body, null).catch((e) => e));
    }
    for (const error of errors) {
      expect(error.statusCode).toBe(403);
      expect(error.code).toBe(PUBLIC_RSVP_REFUSED_CODE);
      expect(error.message).toBe(PUBLIC_RSVP_REFUSED_MESSAGE);
      expect(error.message).not.toMatch(/18|30/);
    }
    expect(invitationRepository.createPublic).not.toHaveBeenCalled();
  });

  it('conta sem data de nascimento não confirma em evento com restrição', async () => {
    const restricted = makeEvent({ minAge: 18 });
    vi.mocked(eventRepository.findByPublicSlug).mockResolvedValue(restricted);
    vi.mocked(hostRepository.findById).mockResolvedValue(makeHost(null));
    const body = publicEventRsvpSchema.parse({ status: 'accepted' });
    await expect(publicEventService.rsvp('abcDEF123_-x', body, account)).rejects.toMatchObject({
      code: 'age_profile_required',
    });
  });

  it('data de nascimento alterada que passa a cumprir marca a confirmação', async () => {
    const restricted = makeEvent({ minAge: 18 });
    vi.mocked(eventRepository.findByPublicSlug).mockResolvedValue(restricted);
    vi.mocked(eventRepository.findByIdForUpdate).mockResolvedValue(restricted);
    vi.mocked(hostRepository.findById).mockResolvedValue(makeHost(yearsAgo(20)));
    vi.mocked(hostBirthDateChangeRepository.previousValues).mockResolvedValue([yearsAgo(15)]);

    const body = publicEventRsvpSchema.parse({ status: 'accepted' });
    await publicEventService.rsvp('abcDEF123_-x', body, account);

    expect(invitationRepository.createPublic).toHaveBeenCalledWith(
      expect.objectContaining({ ageFlag: true, ageFlagReason: 'birth_date_changed', guestAge: 20 }),
      expect.anything()
    );
    expect(activityRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ age_flag: true }) }),
      expect.anything()
    );
  });

  it('o anfitrião não responde ao próprio evento', async () => {
    const body = publicEventRsvpSchema.parse({ name: 'Ana', email: 'ANA@exemplo.ao', status: 'accepted' });
    await expect(publicEventService.rsvp('abcDEF123_-x', body, null)).rejects.toMatchObject({
      code: 'public_rsvp_host',
    });
  });

  it('evento cancelado mantém a regra actual', async () => {
    vi.mocked(eventRepository.findByPublicSlug).mockResolvedValue(makeEvent({ status: 'cancelled' }));
    const body = publicEventRsvpSchema.parse({ name: 'Rui', email: 'r@x.ao', status: 'accepted' });
    await expect(publicEventService.rsvp('abcDEF123_-x', body, null)).rejects.toMatchObject({
      code: 'event_cancelled',
    });
  });

  it('evento privado ou inexistente devolve 404', async () => {
    vi.mocked(eventRepository.findByPublicSlug).mockResolvedValue(null);
    await expect(publicEventService.view('abcDEF123_-x', null)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe('Bloco 10 — apagar evento', () => {
  it('com confirmados exige o nome exacto', async () => {
    vi.mocked(eventRepository.findById).mockResolvedValue(makeEvent());
    vi.mocked(eventRepository.countAccepted).mockResolvedValue(3);

    await expect(hostEventService.remove(hostId, eventId)).rejects.toMatchObject({
      code: 'event_delete_confirmation_required',
    });
    await expect(hostEventService.remove(hostId, eventId, 'festa da ana')).rejects.toMatchObject({
      code: 'event_delete_confirmation_required',
    });
    await expect(hostEventService.remove(hostId, eventId, '  Festa da Ana ')).resolves.toEqual({
      acceptedCount: 3,
    });
    expect(eventRepository.softDelete).toHaveBeenCalledTimes(1);
  });

  it('sem confirmados não exige o nome', async () => {
    vi.mocked(eventRepository.findById).mockResolvedValue(makeEvent());
    vi.mocked(eventRepository.countAccepted).mockResolvedValue(0);
    await expect(hostEventService.remove(hostId, eventId)).resolves.toEqual({ acceptedCount: 0 });
  });

  it('gestor ou outra conta recebe 404 (só o criador apaga)', async () => {
    vi.mocked(eventRepository.findById).mockResolvedValue(makeEvent());
    await expect(hostEventService.remove('outra-conta', eventId, 'Festa da Ana')).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(eventRepository.softDelete).not.toHaveBeenCalled();
  });
});

describe('Bloco 10 — perfis privados', () => {
  it('a pesquisa de perfis filtra sempre por perfil público (teste negativo)', async () => {
    await hostRepository.searchPublicProfiles('ana', 10);
    const sql = String(vi.mocked(query).mock.calls.at(-1)?.[0] ?? '');
    expect(sql).toContain("h.profile_visibility = 'public'");
  });
});
