import { describe, expect, it } from 'vitest';
import { catalog, catalogEntries } from '../src/emails/catalog';
import { formatEmailClock, formatEmailDate } from '../src/emails/format';
import { renderEmailHtml, renderEmailText } from '../src/emails/render';
import { EMAIL_TEMPLATE_CODES, EmailTemplateCode, EmailVars } from '../src/emails/types';
import type { DeliveryContext } from '../src/repositories/emailDelivery.repository';
import { renderDelivery } from '../src/services/email.service';
import { encryptToken } from '../src/utils/crypto.util';

const EVENT_START = new Date('2026-11-21T14:00:00Z');
const TIMEZONE = 'Africa/Luanda';

const BASE_VARS: EmailVars = {
  nome: 'Ana',
  anfitriao: 'Pedro',
  convidado: 'Ana',
  evento: 'Aniversário do Pedro',
  data: formatEmailDate(EVENT_START, TIMEZONE),
  hora: formatEmailClock(EVENT_START, TIMEZONE),
  local: 'Salão Panorâmico · Luanda',
  codigo: '482916',
  expiraEm: '10 minutos',
  url: 'https://conto-contigo.example/convite/exemplo',
  dias: 3,
  confirmado: false,
  online: false,
  vestuario: 'Traje casual',
  contribuicao: false,
  detalhe: 'ana@example.com',
};

const OVERRIDES: Partial<Record<EmailTemplateCode, Partial<EmailVars>>> = {
  boas_vindas: { url: 'https://conto-contigo.example/criar-evento' },
  verificacao_codigo: {
    url: 'https://conto-contigo.example/criar-conta?email=ana%40example.com&codigo=482916',
  },
  recuperar_senha: { url: 'https://conto-contigo.example/redefinir-senha?token=exemplo' },
  presenca_confirmada: {
    nome: 'Pedro',
    url: 'https://conto-contigo.example/gerir/exemplo',
  },
  lembrete_24h: { confirmado: true },
  lembrete_2h: { confirmado: true, online: true, local: 'Online' },
  lembrete: { dias: 7, confirmado: false },
  manage_link: { nome: 'Pedro', url: 'https://conto-contigo.example/gerir/exemplo' },
  manager_invite: { nome: undefined, url: 'https://conto-contigo.example/gerir/exemplo' },
  email_verification: { url: 'https://conto-contigo.example/verificar-email/exemplo' },
  profile_reminder: { url: 'https://conto-contigo.example/definicoes' },
  decline_notification: { nome: 'Pedro' },
};

function varsFor(code: EmailTemplateCode): EmailVars {
  return { ...BASE_VARS, ...OVERRIDES[code] };
}

function deliveryContext(overrides: Partial<DeliveryContext> = {}): DeliveryContext {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    eventId: '00000000-0000-4000-8000-000000000002',
    invitationId: '00000000-0000-4000-8000-000000000003',
    hostId: '00000000-0000-4000-8000-000000000004',
    messageType: 'invitation',
    reminderKind: null,
    recipientEmail: 'ana@example.test',
    scheduledFor: new Date(),
    status: 'pending',
    attempts: 0,
    nextAttemptAt: null,
    providerMessageId: null,
    lastError: null,
    idempotencyKey: 'invitation:test:initial',
    tokenEncrypted: null,
    sentAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    eventTitle: 'Aniversário do Pedro',
    eventStatus: 'scheduled',
    eventStartsAt: EVENT_START,
    eventEndsAt: null,
    eventTimezone: TIMEZONE,
    eventLocationType: 'venue',
    eventLocationName: 'Salão Panorâmico',
    eventLocationAddress: 'Luanda',
    eventOnlineUrl: null,
    eventDressCode: 'Traje casual',
    eventRsvpDeadline: null,
    eventContributionEnabled: false,
    hostName: 'Pedro',
    hostEmail: 'pedro@example.test',
    guestName: 'Ana',
    guestEmail: 'ana@example.test',
    invitationTokenEncrypted: encryptToken('token-de-teste'),
    rsvpStatus: 'pending',
    claimRevokedAt: null,
    ...overrides,
  };
}

describe('catálogo de mensagens', () => {
  it('cobre todos os códigos declarados', () => {
    const codes = catalogEntries.map((entry) => entry.code);
    expect(new Set(codes)).toEqual(new Set(EMAIL_TEMPLATE_CODES));
  });

  it('respeita os limites de assunto, push e SMS', () => {
    for (const entry of catalogEntries) {
      const vars = varsFor(entry.code);
      const content = entry.email(vars);
      const push = entry.push(vars);
      const sms = entry.sms(vars);

      expect(content.subject.length, entry.code).toBeLessThanOrEqual(50);
      expect(content.preheader.length, entry.code).toBeLessThanOrEqual(90);
      expect(push.title.length, entry.code).toBeLessThanOrEqual(45);
      expect(push.body.length, entry.code).toBeLessThanOrEqual(120);
      expect(sms.length, entry.code).toBeLessThanOrEqual(160);
    }
  });

  it('mantém o código OTP em destaque e liga ao front já preenchido', () => {
    const vars = varsFor('verificacao_codigo');
    const content = catalog.verificacao_codigo.email(vars);

    expect(content.code).toBe('482916');
    expect(content.cta).toEqual({ label: 'Continuar no Conto Contigo', url: vars.url });

    const html = renderEmailHtml(content, { baseUrl: 'https://exemplo.test', year: 2026 });
    expect(html).toContain('letter-spacing:8px');
    expect(html).toContain('Continuar no Conto Contigo');
  });

  it('gera HTML com a marca, dark mode e rodapé', () => {
    const html = renderEmailHtml(catalog.convite_recebido.email(BASE_VARS), {
      baseUrl: 'https://exemplo.test',
      year: 2026,
    });

    expect(html).toContain('https://exemplo.test/email/email-logo-white-480.png');
    expect(html).toContain('prefers-color-scheme:dark');
    expect(html).toContain('background:#0F3D3E');
    expect(html).toContain('Ver convite');
    expect(html).toContain('Preferências de notificação');
    expect(html).toContain('© 2026 Conto Contigo · Luanda, Angola');
    expect(Buffer.byteLength(html, 'utf8')).toBeLessThan(100 * 1024);
  });

  it('escapa variáveis no HTML e preserva o texto simples', () => {
    const content = catalog.convite_recebido.email({
      ...BASE_VARS,
      nome: '<Ana>',
      evento: 'Festa & Cia',
    });

    const html = renderEmailHtml(content, { baseUrl: 'https://exemplo.test', year: 2026 });
    expect(html).not.toContain('<Ana>');
    expect(html).toContain('&lt;Ana&gt;');
    expect(html).toContain('Festa &amp; Cia');

    const text = renderEmailText(content, { baseUrl: 'https://exemplo.test', year: 2026 });
    expect(text).toContain('Olá, <Ana>.');
    expect(text).toContain('Festa & Cia');
    expect(text).toContain('— Equipa Conto Contigo');
  });

  it('formata datas e horas em pt-PT', () => {
    expect(formatEmailDate(EVENT_START, TIMEZONE)).toBe('sáb, 21 nov 2026');
    expect(formatEmailClock(EVENT_START, TIMEZONE)).toBe('15:00');
  });
});

describe('renderDelivery', () => {
  it('renderiza o convite com o layout da marca e link pessoal', () => {
    const message = renderDelivery(deliveryContext());

    expect(message.to).toBe('ana@example.test');
    expect(message.subject).toContain('Pedro convidou-te');
    expect(message.html).toContain('Conto Contigo');
    expect(message.html).toContain('/convite/token-de-teste');
    expect(message.text).toContain('Ver convite:');
    expect(message.text).toContain('— Equipa Conto Contigo');
  });

  it('renderiza o OTP em destaque com ligação para o front preenchida', () => {
    const message = renderDelivery(
      deliveryContext({
        messageType: 'registration_otp',
        eventId: null,
        invitationId: null,
        eventTitle: null,
        eventStartsAt: null,
        eventTimezone: null,
        eventLocationType: null,
        invitationTokenEncrypted: null,
        tokenEncrypted: encryptToken('482916'),
      })
    );

    expect(message.subject).toContain('482916');
    expect(message.html).toContain('letter-spacing:8px');
    expect(message.html).toContain('Continuar no Conto Contigo');
    expect(message.html).toContain('/criar-conta?email=');
    expect(message.html).toContain('codigo=482916');
    expect(message.text).toContain('Código: 482916');
    expect(message.text).toContain('Continuar no Conto Contigo:');
  });
});
