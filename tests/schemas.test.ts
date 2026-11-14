import { describe, expect, it } from 'vitest';
import {
  createEventSchema,
  createInvitationSchema,
  updateEventSchema,
  updateInvitationSchema,
} from '../src/schemas/event.schemas';
import { rsvpSchema } from '../src/schemas/invitation.schemas';

/**
 * Datas no futuro: `createEventSchema` recusa eventos que já começaram.
 * Usamos 2027 para os testes não dependerem da data de execução.
 */
const validEvent = {
  title: 'Casamento da Ana',
  host_name: 'Ana',
  host_email: 'ANA@Exemplo.ao',
  starts_at: '2027-08-15T18:00:00+01:00',
  timezone: 'Africa/Luanda',
  location: { type: 'venue' as const, name: 'Salão Principal' },
};

const validBody = {
  event: validEvent,
  guests: [],
};

describe('createEventSchema', () => {
  it('aceita o envelope { event, guests } e normaliza o email', () => {
    const parsed = createEventSchema.parse(validBody);
    expect(parsed.event.host_email).toBe('ana@exemplo.ao');
    expect(parsed.event.starts_at).toBeInstanceOf(Date);
    expect(parsed.guests).toEqual([]);
  });

  it('rejeita o formato antigo (campos no topo) por ser estrito', () => {
    expect(createEventSchema.safeParse(validEvent).success).toBe(false);
  });

  it('rejeita data de fim anterior ao início', () => {
    const result = createEventSchema.safeParse({
      event: { ...validEvent, ends_at: '2027-08-15T17:00:00+01:00' },
      guests: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejeita prazo de resposta depois do início', () => {
    const result = createEventSchema.safeParse({
      event: { ...validEvent, rsvp_deadline: '2027-08-16T10:00:00+01:00' },
      guests: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejeita data de início no passado', () => {
    const result = createEventSchema.safeParse({
      event: { ...validEvent, starts_at: '2020-01-01T10:00:00Z' },
      guests: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejeita fuso horário inválido', () => {
    const result = createEventSchema.safeParse({
      event: { ...validEvent, timezone: 'Fuso/Inventado' },
      guests: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejeita email inválido', () => {
    const result = createEventSchema.safeParse({
      event: { ...validEvent, host_email: 'nao-e-email' },
      guests: [],
    });
    expect(result.success).toBe(false);
  });

  it('exige nome do local quando o tipo é venue', () => {
    const result = createEventSchema.safeParse({
      event: { ...validEvent, location: { type: 'venue', name: '' } },
      guests: [],
    });
    expect(result.success).toBe(false);
  });

  it('exige URL válida quando o tipo é online', () => {
    const result = createEventSchema.safeParse({
      event: { ...validEvent, location: { type: 'online', online_url: 'nao-url' } },
      guests: [],
    });
    expect(result.success).toBe(false);
  });

  it('exige os três campos bancários quando a contribuição está ativa', () => {
    const result = createEventSchema.safeParse({
      event: { ...validEvent, contribution: { enabled: true } },
      guests: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejeita emails duplicados na lista de convidados', () => {
    const result = createEventSchema.safeParse({
      event: validEvent,
      guests: [
        { name: 'Ana', email: 'ana@exemplo.ao' },
        { name: 'Ana II', email: 'ANA@exemplo.ao' },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejeita campos desconhecidos (não aceita token nem estado RSVP)', () => {
    const result = createEventSchema.safeParse({
      ...validBody,
      manage_token: 'injectado',
    });
    expect(result.success).toBe(false);
  });
});

describe('updateEventSchema', () => {
  it('aceita um único campo e não aplica defaults', () => {
    const parsed = updateEventSchema.parse({ dress_code: 'Formal' });
    expect(parsed).toEqual({ dress_code: 'Formal' });
  });

  it('rejeita um corpo vazio', () => {
    expect(updateEventSchema.safeParse({}).success).toBe(false);
  });

  it('aceita a transição de estado', () => {
    const parsed = updateEventSchema.parse({ status: 'cancelled' });
    expect(parsed.status).toBe('cancelled');
  });

  it('rejeita estado desconhecido', () => {
    expect(updateEventSchema.safeParse({ status: 'deleted' }).success).toBe(false);
  });

  it('rejeita tema vazio', () => {
    expect(updateEventSchema.safeParse({ theme: {} }).success).toBe(false);
  });

  it('permite limpar datas com null', () => {
    const parsed = updateEventSchema.parse({ ends_at: null, rsvp_deadline: null });
    expect(parsed.ends_at).toBeNull();
    expect(parsed.rsvp_deadline).toBeNull();
  });

  it('rejeita data de fim anterior ao início enviado no mesmo pedido', () => {
    const result = updateEventSchema.safeParse({
      starts_at: '2027-08-15T18:00:00Z',
      ends_at: '2027-08-15T17:00:00Z',
    });
    expect(result.success).toBe(false);
  });
});

describe('createInvitationSchema', () => {
  it('normaliza o email do convidado', () => {
    const parsed = createInvitationSchema.parse({
      name: 'João',
      email: 'JOAO@Exemplo.ao',
    });
    expect(parsed.email).toBe('joao@exemplo.ao');
  });

  it('rejeita nome demasiado curto', () => {
    expect(
      createInvitationSchema.safeParse({ name: 'J', email: 'joao@exemplo.ao' }).success
    ).toBe(false);
  });

  it('rejeita campos desconhecidos', () => {
    expect(
      createInvitationSchema.safeParse({
        name: 'João',
        email: 'joao@exemplo.ao',
        rsvp_status: 'accepted',
      }).success
    ).toBe(false);
  });
});

describe('updateInvitationSchema', () => {
  it('aceita actualização parcial', () => {
    expect(updateInvitationSchema.parse({ phone: '+244900000000' })).toEqual({
      phone: '+244900000000',
    });
  });

  it('rejeita um corpo vazio', () => {
    expect(updateInvitationSchema.safeParse({}).success).toBe(false);
  });
});

describe('rsvpSchema', () => {
  it('aceita "accepted" e "declined"', () => {
    expect(rsvpSchema.parse({ status: 'accepted' })).toEqual({ status: 'accepted' });
    expect(rsvpSchema.parse({ status: 'declined' })).toEqual({ status: 'declined' });
  });

  it('rejeita "pending" — é o estado inicial, nunca enviado pelo cliente', () => {
    expect(rsvpSchema.safeParse({ status: 'pending' }).success).toBe(false);
  });

  it('rejeita o formato antigo { response }', () => {
    expect(rsvpSchema.safeParse({ response: 'declined' }).success).toBe(false);
  });

  it('rejeita campos desconhecidos', () => {
    expect(rsvpSchema.safeParse({ status: 'accepted', companion_count: 2 }).success).toBe(false);
  });
});
