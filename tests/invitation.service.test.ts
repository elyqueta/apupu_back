import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/database/pool', () => ({
  withTransaction: vi.fn(async (callback: (client: unknown) => unknown) => callback({})),
}));

vi.mock('../src/repositories/invitation.repository', () => ({
  invitationRepository: {
    findByTokenHash: vi.fn(),
    findById: vi.fn(),
    findByIdForUpdate: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    create: vi.fn(),
    countByEvent: vi.fn(),
    respond: vi.fn(),
    setGuestMessage: vi.fn(),
  },
}));

vi.mock('../src/repositories/emailDelivery.repository', () => ({
  emailDeliveryRepository: {},
}));

vi.mock('../src/repositories/event.repository', () => ({
  eventRepository: { findById: vi.fn(), findByIdForUpdate: vi.fn() },
}));

vi.mock('../src/repositories/activity.repository', () => ({
  activityRepository: { create: vi.fn() },
}));

vi.mock('../src/services/reminder.service', () => ({
  cancelMessagesForInvitation: vi.fn(),
  enqueueDeclineNotification: vi.fn(),
  enqueueInvitationEmail: vi.fn(),
  enqueueInvitationRemoved: vi.fn(),
  enqueueOnboardingMessages: vi.fn(),
  enqueueRemindersForInvitation: vi.fn(),
}));

vi.mock('../src/services/guestAccess.service', () => ({
  accountOwnsInvitation: vi.fn(),
}));

import { activityRepository } from '../src/repositories/activity.repository';
import { eventRepository } from '../src/repositories/event.repository';
import { invitationRepository } from '../src/repositories/invitation.repository';
import { invitationService } from '../src/services/invitation.service';
import {
  cancelMessagesForInvitation,
  enqueueInvitationEmail,
  enqueueInvitationRemoved,
  enqueueRemindersForInvitation,
} from '../src/services/reminder.service';
import { Invitation } from '../src/types/invitation.types';

const eventId = '00000000-0000-4000-8000-000000000001';
const invitationId = '00000000-0000-4000-8000-000000000002';

function makeInvitation(overrides: Partial<Invitation> = {}): Invitation {
  return {
    id: invitationId,
    eventId,
    guestName: 'João',
    guestEmail: 'joao@exemplo.ao',
    guestPhone: '+244900000000',
    tableName: null,
    guestMessage: null,
    linkExpiresAt: new Date('2027-08-17T01:00:00Z'),
    tokenHash: 'hash-secreto',
    tokenEncrypted: 'token-cifrado',
    claimHash: null,
    claimedAt: null,
    claimRevokedAt: null,
    rsvpStatus: 'pending',
    rsvpRespondedAt: null,
    rsvpVersion: 0,
    sendStatus: 'sent',
    sendCount: 1,
    lastSentAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  };
}

describe('invitationService.add', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('bloqueia um convidado com o email do anfitrião', async () => {
    await expect(
      invitationService.add(
        {
          id: eventId,
          status: 'scheduled',
          hostEmail: 'Anfitriao@Exemplo.ao',
        } as never,
        { name: 'Ana', email: 'anfitriao@exemplo.ao' }
      )
    ).rejects.toMatchObject({
      code: 'invitation_host_email',
      statusCode: 409,
    });

    expect(invitationRepository.create).not.toHaveBeenCalled();
  });
});

describe('invitationService.update', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(eventRepository.findById).mockResolvedValue({
      id: eventId,
      hostEmail: 'anfitriao@exemplo.ao',
    } as never);
    vi.mocked(invitationRepository.update).mockImplementation(async (id, changes) =>
      makeInvitation({ id, guestEmail: changes.guestEmail ?? 'joao@exemplo.ao' })
    );
  });

  it('bloqueia a alteração para o email do anfitrião', async () => {
    vi.mocked(invitationRepository.findById).mockResolvedValue(makeInvitation());

    await expect(
      invitationService.update(eventId, invitationId, { email: 'ANFITRIAO@exemplo.ao' })
    ).rejects.toMatchObject({
      code: 'invitation_host_email',
      statusCode: 409,
    });

    expect(invitationRepository.update).not.toHaveBeenCalled();
  });

  it('bloqueia a alteração de email depois de o convite ser aberto', async () => {
    vi.mocked(invitationRepository.findById).mockResolvedValue(
      makeInvitation({ claimedAt: new Date('2026-02-01T00:00:00Z') })
    );

    await expect(
      invitationService.update(eventId, invitationId, { email: 'novo@exemplo.ao' })
    ).rejects.toMatchObject({
      code: 'invitation_already_opened',
      statusCode: 409,
    });

    expect(invitationRepository.update).not.toHaveBeenCalled();
  });

  it('bloqueia a alteração de telefone quando o convite tem claim', async () => {
    vi.mocked(invitationRepository.findById).mockResolvedValue(
      makeInvitation({ claimHash: 'claim-secreto' })
    );

    await expect(
      invitationService.update(eventId, invitationId, { phone: '+244911111111' })
    ).rejects.toMatchObject({ code: 'invitation_already_opened' });
  });

  it('permite alterar nome e mesa depois da abertura', async () => {
    vi.mocked(invitationRepository.findById).mockResolvedValue(
      makeInvitation({ claimedAt: new Date('2026-02-01T00:00:00Z') })
    );

    await invitationService.update(eventId, invitationId, {
      name: 'João Silva',
      table_name: 'Mesa 3',
    });

    expect(invitationRepository.update).toHaveBeenCalledWith(
      invitationId,
      { guestName: 'João Silva', tableName: 'Mesa 3' },
      expect.anything()
    );
  });

  it('permite corrigir o email enquanto o link não foi aberto', async () => {
    vi.mocked(invitationRepository.findById).mockResolvedValue(makeInvitation());

    await invitationService.update(eventId, invitationId, { email: 'novo@exemplo.ao' });

    expect(invitationRepository.update).toHaveBeenCalledWith(
      invitationId,
      expect.objectContaining({
        guestEmail: 'novo@exemplo.ao',
        tokenHash: expect.any(String),
        tokenEncrypted: expect.any(String),
        resetClaim: true,
      }),
      expect.anything()
    );
    expect(cancelMessagesForInvitation).toHaveBeenCalledWith(
      invitationId,
      expect.anything()
    );
    expect(enqueueInvitationRemoved).toHaveBeenCalledWith(
      expect.objectContaining({ id: eventId }),
      'joao@exemplo.ao',
      expect.anything()
    );
    expect(enqueueInvitationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ id: eventId }),
      expect.objectContaining({ guestEmail: 'novo@exemplo.ao' }),
      { resend: true },
      expect.anything()
    );
    expect(enqueueRemindersForInvitation).toHaveBeenCalled();
  });

  it('não bloqueia quando o contacto enviado é igual ao actual', async () => {
    vi.mocked(invitationRepository.findById).mockResolvedValue(
      makeInvitation({ claimedAt: new Date('2026-02-01T00:00:00Z') })
    );

    await invitationService.update(eventId, invitationId, {
      email: 'joao@exemplo.ao',
      phone: '+244900000000',
    });

    expect(invitationRepository.update).toHaveBeenCalled();
  });
});

describe('invitationService.claim', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('devolve o 404 genérico quando o link expirou', async () => {
    vi.mocked(invitationRepository.findByTokenHash).mockResolvedValue(
      makeInvitation({ linkExpiresAt: new Date('2020-01-01T00:00:00Z') })
    );

    await expect(
      invitationService.claim('token-com-pelo-menos-vinte-caracteres', null, null)
    ).rejects.toMatchObject({ code: 'invitation_not_found', statusCode: 404 });

    expect(eventRepository.findById).not.toHaveBeenCalled();
  });
});

describe('invitationService.respond', () => {
  const access = {
    kind: 'account' as const,
    secret: 'sessao',
    email: 'joao@exemplo.ao',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(eventRepository.findByIdForUpdate).mockResolvedValue({
      id: eventId,
      status: 'scheduled',
      rsvpDeadline: null,
    } as never);
  });

  it('recusa o RSVP quando o link expirou', async () => {
    vi.mocked(invitationRepository.findByIdForUpdate).mockResolvedValue(
      makeInvitation({ linkExpiresAt: new Date('2020-01-01T00:00:00Z') })
    );

    await expect(
      invitationService.respond(eventId, invitationId, access, 'accepted')
    ).rejects.toMatchObject({ code: 'invitation_not_found', statusCode: 404 });

    expect(invitationRepository.respond).not.toHaveBeenCalled();
    expect(activityRepository.create).not.toHaveBeenCalled();
  });

  it('guarda a mensagem e inclui-a nos metadados da notificação', async () => {
    vi.mocked(invitationRepository.findByIdForUpdate).mockResolvedValue(makeInvitation());
    vi.mocked(invitationRepository.respond).mockResolvedValue(
      makeInvitation({ rsvpStatus: 'accepted', guestMessage: 'Vou lá estar!' })
    );

    await invitationService.respond(eventId, invitationId, access, 'accepted', 'Vou lá estar!');

    expect(invitationRepository.respond).toHaveBeenCalledWith(
      invitationId,
      'accepted',
      'Vou lá estar!',
      expect.anything()
    );
    expect(activityRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'rsvp_accepted',
        metadata: { guest_message: 'Vou lá estar!' },
      }),
      expect.anything()
    );
  });

  it('altera só a mensagem quando o estado não muda', async () => {
    vi.mocked(invitationRepository.findByIdForUpdate).mockResolvedValue(
      makeInvitation({ rsvpStatus: 'accepted', rsvpRespondedAt: new Date('2026-03-01T10:00:00Z') })
    );
    vi.mocked(invitationRepository.setGuestMessage).mockResolvedValue(
      makeInvitation({ rsvpStatus: 'accepted', guestMessage: 'Obrigado!' })
    );

    await invitationService.respond(eventId, invitationId, access, 'accepted', 'Obrigado!');

    expect(invitationRepository.setGuestMessage).toHaveBeenCalledWith(
      invitationId,
      'Obrigado!',
      expect.anything()
    );
    expect(invitationRepository.respond).not.toHaveBeenCalled();
    expect(activityRepository.create).not.toHaveBeenCalled();
  });

  it('mantém a mensagem anterior quando o campo não é enviado', async () => {
    vi.mocked(invitationRepository.findByIdForUpdate).mockResolvedValue(
      makeInvitation({ guestMessage: 'Mensagem anterior' })
    );
    vi.mocked(invitationRepository.respond).mockResolvedValue(
      makeInvitation({ rsvpStatus: 'declined', guestMessage: 'Mensagem anterior' })
    );

    await invitationService.respond(eventId, invitationId, access, 'declined');

    expect(invitationRepository.respond).toHaveBeenCalledWith(
      invitationId,
      'declined',
      'Mensagem anterior',
      expect.anything()
    );
  });
});
