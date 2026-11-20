import { describe, expect, it, vi } from 'vitest';
import { logger } from '../src/config/logger';
import { toEventDto, toPublicEventDto } from '../src/dto/event.dto';
import { toInvitationDto, toPublicInvitationDto } from '../src/dto/invitation.dto';
import { Event } from '../src/types/event.types';
import { HostPublicContact } from '../src/types/host.types';
import { Invitation } from '../src/types/invitation.types';
import { encryptToken } from '../src/utils/crypto.util';
import { links } from '../src/utils/links.util';

const INVITE_TOKEN = 'convite-token-de-teste-1234567890';

const hostContact: HostPublicContact = {
  name: 'Ana',
  email: 'ana@exemplo.ao',
  phone: '+244923456789',
  avatarUrl: 'https://res.cloudinary.com/demo/image/upload/avatar.jpg',
};

const event: Event = {
  id: '00000000-0000-4000-8000-000000000001',
  title: 'Casamento da Ana',
  hostName: 'Ana',
  hostEmail: 'ana@exemplo.ao',
  startsAt: new Date('2027-08-15T17:00:00Z'),
  endsAt: null,
  timezone: 'Africa/Luanda',
  location: {
    type: 'venue',
    name: 'Salão Principal',
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
  rsvpDeadline: null,
  status: 'scheduled',
  manageTokenExpiresAt: null,
  manageTokenRevokedAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

const invitation: Invitation = {
  id: '00000000-0000-4000-8000-000000000002',
  eventId: event.id,
  guestName: 'João',
  guestEmail: 'joao@exemplo.ao',
  guestPhone: null,
  guestMessage: null,
  linkExpiresAt: new Date('2027-08-17T01:00:00Z'),
  tokenHash: 'hash-secreto',
  tokenEncrypted: encryptToken(INVITE_TOKEN),
  claimHash: 'claim-secreto',
  claimedAt: new Date('2026-01-02T00:00:00Z'),
  claimRevokedAt: null,
  rsvpStatus: 'pending',
  rsvpRespondedAt: null,
  rsvpVersion: 0,
  sendStatus: 'sent',
  sendCount: 1,
  lastSentAt: new Date('2026-01-02T00:00:00Z'),
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
};

describe('DTOs', () => {
  it('a vista de gestão do evento usa snake_case e inclui contacto do anfitrião', () => {
    const dto = toEventDto(event);

    expect(dto.host_email).toBe('ana@exemplo.ao');
    expect(dto.starts_at).toBe('2027-08-15T17:00:00.000Z');
    expect(dto).not.toHaveProperty('manageTokenHash');
    expect(dto).not.toHaveProperty('manage_token_hash');
  });

  it('a vista pública do evento expõe só o contacto mínimo do anfitrião', () => {
    const dto = toPublicEventDto(event, hostContact);
    const serialized = JSON.stringify(dto);

    expect(dto.host_name).toBe('Ana');
    expect(dto.host_email).toBe('ana@exemplo.ao');
    expect(dto.host_phone).toBe('+244923456789');
    expect(dto.host_avatar_url).toBe(hostContact.avatarUrl);
    expect(serialized).not.toContain('birth_date');
    expect(dto).not.toHaveProperty('stats');
    expect(dto).not.toHaveProperty('template_id');
    expect(dto.title).toBe('Casamento da Ana');
  });

  it('a vista de gestão do convite não expõe hashes nem o token cifrado', () => {
    const dto = toInvitationDto(invitation);
    const serialized = JSON.stringify(dto);

    expect(serialized).not.toContain(invitation.tokenHash);
    expect(serialized).not.toContain(invitation.tokenEncrypted);
    expect(serialized).not.toContain(invitation.claimHash);
    expect(dto).not.toHaveProperty('token_hash');
    expect(dto).not.toHaveProperty('claim_hash');
    expect(dto.guest_message).toBeNull();
  });

  it('o link de partilha do convite é absoluto e reutiliza o token do email', () => {
    const dto = toInvitationDto(invitation);

    expect(dto.invitation_url).toBe(links.invitation(INVITE_TOKEN));
    expect(dto.invitation_url).toContain('/convite/');
    expect(dto.invitation_url_expires_at).toBe('2027-08-17T01:00:00.000Z');
    expect(dto.opened_at).toBe('2026-01-02T00:00:00.000Z');
  });

  it('um convite ainda não aberto expõe opened_at nulo', () => {
    const dto = toInvitationDto({ ...invitation, claimedAt: null, claimHash: null });

    expect(dto.opened_at).toBeNull();
  });

  it('um convite revogado não expõe link de partilha', () => {
    const dto = toInvitationDto({
      ...invitation,
      claimRevokedAt: new Date('2026-02-01T00:00:00Z'),
    });

    expect(dto.invitation_url).toBeNull();
    expect(dto.invitation_url_expires_at).toBe('2027-08-17T01:00:00.000Z');
  });

  it('um token que não pode ser decifrado não derruba a listagem', () => {
    const logged = vi.spyOn(logger, 'error').mockImplementation(() => undefined);

    try {
      const dto = toInvitationDto({ ...invitation, tokenEncrypted: 'invalido' });

      expect(dto.invitation_url).toBeNull();
      expect(logged).toHaveBeenCalledOnce();
    } finally {
      logged.mockRestore();
    }
  });

  it('a vista pública do convite só mostra os dados do próprio convidado', () => {
    const dto = toPublicInvitationDto(event, invitation, false, true, hostContact);
    const serialized = JSON.stringify(dto);

    expect(dto.guest.name).toBe('João');
    expect(dto.guest.email).toBe(invitation.guestEmail);
    expect(dto.guest.email_has_account).toBe(true);
    expect(dto.guest.rsvp_status).toBe('pending');
    expect(dto.guest.message).toBeNull();
    expect(dto.event.host_email).toBe(hostContact.email);
    expect(dto.event.host_phone).toBe(hostContact.phone);
    expect(serialized).not.toContain('birth_date');
    expect(dto).not.toHaveProperty('invitations');
    expect(dto).not.toHaveProperty('invitation_url');
    expect(serialized).not.toContain(invitation.tokenHash);
    expect(serialized).not.toContain(INVITE_TOKEN);
  });
});
