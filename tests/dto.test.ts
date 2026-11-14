import { describe, expect, it } from 'vitest';
import { toEventDto, toPublicEventDto } from '../src/dto/event.dto';
import { toInvitationDto, toPublicInvitationDto } from '../src/dto/invitation.dto';
import { Event } from '../src/types/event.types';
import { Invitation } from '../src/types/invitation.types';

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
  tokenHash: 'hash-secreto',
  tokenEncrypted: 'token-cifrado',
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

  it('a vista pública do evento não expõe o email do anfitrião nem estatísticas', () => {
    const dto = toPublicEventDto(event);

    expect(dto).not.toHaveProperty('host_email');
    expect(dto).not.toHaveProperty('stats');
    expect(dto.title).toBe('Casamento da Ana');
  });

  it('a vista de gestão do convite não expõe hashes nem tokens', () => {
    const dto = toInvitationDto(invitation);
    const serialized = JSON.stringify(dto);

    expect(serialized).not.toContain(invitation.tokenHash);
    expect(serialized).not.toContain(invitation.tokenEncrypted);
    expect(serialized).not.toContain(invitation.claimHash);
    expect(dto).not.toHaveProperty('token_hash');
    expect(dto).not.toHaveProperty('claim_hash');
  });

  it('a vista pública do convite só mostra os dados do próprio convidado', () => {
    const dto = toPublicInvitationDto(event, invitation, false);
    const serialized = JSON.stringify(dto);

    expect(dto.guest.name).toBe('João');
    expect(dto.guest.rsvp_status).toBe('pending');
    expect(dto).not.toHaveProperty('invitations');
    expect(serialized).not.toContain(invitation.guestEmail);
    expect(serialized).not.toContain(invitation.tokenHash);
  });
});
