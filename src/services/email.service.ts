import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { DeliveryContext } from '../repositories/emailDelivery.repository';
import { formatDateTime } from '../utils/date.util';
import { decryptToken } from '../utils/crypto.util';
import { links } from '../utils/links.util';
import { emailSender } from './emailSender.service';

/**
 * Transporte de email.
 *
 * - `brevo`: SMTP transaccional autenticado com as credenciais Brevo.
 * - `resend`: API HTTP do Resend, autenticada com `RESEND_API_KEY`.
 * - `smtp`: entrega real por SMTP. Se `SMTP_PASS` não estiver definido
 *   mas existir `RESEND_API_KEY`, usa o SMTP do Resend
 *   (`smtp.resend.com`, utilizador `resend`, porta 465/SSL). Assim a
 *   mesma chave serve os dois modos e não é preciso duplicá-la.
 * - `json`: desenvolvimento. Escreve a mensagem renderizada em
 *   `EMAIL_JSON_DIR` em vez de a enviar ou de a colocar nos logs — os
 *   links contêm tokens de acesso e nunca devem aparecer em logs.
 */
function buildTransport(): Transporter | null {
  if (env.EMAIL_TRANSPORT !== 'smtp') return null;

  if (!env.SMTP_PASS && env.RESEND_API_KEY) {
    return nodemailer.createTransport({
      host: 'smtp.resend.com',
      port: 465,
      secure: true,
      auth: { user: env.SMTP_USER ?? 'resend', pass: env.RESEND_API_KEY },
    });
  }

  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth:
      env.SMTP_USER && env.SMTP_PASS
        ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
        : undefined,
  });
}

const transport = buildTransport();

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

interface ResendResponse {
  id?: unknown;
  message?: unknown;
}

/**
 * Envia uma mensagem pela API HTTP do Resend.
 *
 * O corpo de erro do provider é lido apenas para diagnóstico interno;
 * nunca é devolvido ao cliente nem escrito nos logs com dados do
 * destinatário. O token de convite/gestão não faz parte do erro.
 */
async function sendWithResend(message: MailMessage): Promise<SendResult> {
  if (!env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY ausente com EMAIL_TRANSPORT=resend.');
  }

  const response = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
    }),
  });

  if (!response.ok) {
    let detail = '';
    try {
      const body = (await response.json()) as ResendResponse;
      detail = typeof body.message === 'string' ? `: ${body.message}` : '';
    } catch {
      // Corpo não-JSON: mantém apenas o estado HTTP.
    }

    throw new Error(`Resend respondeu ${response.status}${detail}`);
  }

  const body = (await response.json()) as ResendResponse;
  return { providerMessageId: typeof body.id === 'string' ? body.id : null };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeFileKey(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 120);
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Usado para nomear o ficheiro em modo `json`; nunca vai para o corpo. */
  messageKey: string;
}

export interface SendResult {
  providerMessageId: string | null;
}

/** Envia (ou escreve em disco, em desenvolvimento) uma mensagem. */
export async function sendMail(message: MailMessage): Promise<SendResult> {
  if (env.EMAIL_TRANSPORT === 'brevo') {
    return emailSender.send(message);
  }

  if (env.EMAIL_TRANSPORT === 'resend') {
    return sendWithResend(message);
  }

  if (!transport) {
    const id = randomUUID();
    const directory = path.resolve(process.cwd(), env.EMAIL_JSON_DIR);
    await mkdir(directory, { recursive: true });

    const file = path.join(
      directory,
      `${new Date().toISOString().replace(/[:.]/g, '-')}-${safeFileKey(message.messageKey)}-${id}.json`
    );

    await writeFile(
      file,
      JSON.stringify(
        {
          id,
          from: env.EMAIL_FROM,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
          createdAt: new Date().toISOString(),
        },
        null,
        2
      ),
      'utf8'
    );

    return { providerMessageId: id };
  }

  const info = await transport.sendMail({
    from: env.EMAIL_FROM,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });

  return { providerMessageId: typeof info.messageId === 'string' ? info.messageId : null };
}

interface EventSummary {
  title: string;
  startsAt: Date;
  timezone: string;
  locationType: string;
  locationName: string | null;
  locationAddress: string | null;
  onlineUrl: string | null;
  dressCode: string | null;
}

function eventLines(event: EventSummary): string[] {
  const lines = [event.title, `Data: ${formatDateTime(event.startsAt, event.timezone)}`];

  if (event.locationType === 'online' && event.onlineUrl) {
    lines.push(`Online: ${event.onlineUrl}`);
  } else {
    if (event.locationName) lines.push(`Local: ${event.locationName}`);
    if (event.locationAddress) lines.push(`Endereço: ${event.locationAddress}`);
  }

  if (event.dressCode) lines.push(`Dress code: ${event.dressCode}`);
  return lines;
}

function eventHtml(event: EventSummary): string {
  const rows = [
    `<p><strong>${escapeHtml(event.title)}</strong></p>`,
    `<p>Data: ${escapeHtml(formatDateTime(event.startsAt, event.timezone))}</p>`,
  ];

  if (event.locationType === 'online' && event.onlineUrl) {
    rows.push(
      `<p>Online: <a href="${escapeHtml(event.onlineUrl)}">${escapeHtml(event.onlineUrl)}</a></p>`
    );
  } else {
    if (event.locationName) rows.push(`<p>Local: ${escapeHtml(event.locationName)}</p>`);
    if (event.locationAddress) rows.push(`<p>Endereço: ${escapeHtml(event.locationAddress)}</p>`);
  }

  if (event.dressCode) rows.push(`<p>Dress code: ${escapeHtml(event.dressCode)}</p>`);
  return rows.join('\n');
}

function summaryFromContext(context: DeliveryContext): EventSummary | null {
  if (
    context.eventTitle === null ||
    context.eventStartsAt === null ||
    context.eventTimezone === null ||
    context.eventLocationType === null
  ) {
    return null;
  }

  return {
    title: context.eventTitle,
    startsAt: context.eventStartsAt,
    timezone: context.eventTimezone,
    locationType: context.eventLocationType,
    locationName: context.eventLocationName,
    locationAddress: context.eventLocationAddress,
    onlineUrl: context.eventOnlineUrl,
    dressCode: context.eventDressCode,
  };
}

function requireEventSummary(context: DeliveryContext): EventSummary {
  const event = summaryFromContext(context);

  if (!event) {
    throw new Error('Entrega de evento sem dados do evento.');
  }

  return event;
}

function inviteToken(context: DeliveryContext): string {
  if (!context.invitationTokenEncrypted) {
    throw new Error('Entrega de convite sem token cifrado.');
  }
  return decryptToken(context.invitationTokenEncrypted);
}

/**
 * Segredo cifrado das mensagens de conta (OTP, verificação e
 * reposição de senha).
 */
function hostToken(context: DeliveryContext): string {
  if (!context.tokenEncrypted) {
    throw new Error('Entrega de conta sem segredo cifrado.');
  }
  return decryptToken(context.tokenEncrypted);
}

function reminderText(kind: string | null): { lead: string; subject: string } {
  const days = Number.parseInt((kind ?? '').replace('d', ''), 10);

  if (!Number.isFinite(days)) {
    return { lead: 'Lembrete do evento', subject: 'Lembrete' };
  }

  if (days === 1) {
    return { lead: 'O evento é amanhã', subject: 'O evento é amanhã' };
  }

  return { lead: `Faltam ${days} dias para o evento`, subject: `Faltam ${days} dias` };
}

/**
 * Renderiza uma entrega a partir do contexto carregado da base de dados.
 *
 * O link é reconstruído apenas aqui, imediatamente antes do envio, e
 * nunca é persistido na linha de entrega.
 */
export function renderDelivery(context: DeliveryContext): MailMessage {
  switch (context.messageType) {
    case 'manage_link': {
      throw new Error('O link de gestão não é enviado pela outbox.');
    }

    case 'email_verification': {
      const url = links.verifyEmail(hostToken(context));

      return {
        to: context.recipientEmail,
        subject: 'Confirma o teu email — Conto Contigo',
        messageKey: context.idempotencyKey,
        text: [
          'Olá,',
          '',
          'Criaste uma conta no Conto Contigo. Confirma o teu email para poderes criar e gerir eventos:',
          url,
          '',
          'Este link expira ao fim de 24 horas e só pode ser usado uma vez.',
        ].join('\n'),
        html: `
          <p>Olá,</p>
          <p>Criaste uma conta no Conto Contigo. Confirma o teu email para poderes criar e gerir eventos:</p>
          <p><a href="${escapeHtml(url)}">Confirmar email</a></p>
          <p>Este link expira ao fim de 24 horas e só pode ser usado uma vez.</p>
        `,
      };
    }

    case 'registration_otp': {
      const code = hostToken(context);
      const minutes = env.REGISTRATION_OTP_TTL_MINUTES;

      return {
        to: context.recipientEmail,
        subject: 'O teu código de confirmação — Conto Contigo',
        messageKey: context.idempotencyKey,
        text: [
          'Olá,',
          '',
          'O teu código de confirmação do Conto Contigo é:',
          code,
          '',
          `O código expira ao fim de ${minutes} minutos e só pode ser usado uma vez.`,
          'Se não pediste este código, ignora este email.',
        ].join('\n'),
        html: `
          <p>Olá,</p>
          <p>O teu código de confirmação do Conto Contigo é:</p>
          <p style="font-size: 28px; font-weight: bold; letter-spacing: 6px;">${escapeHtml(code)}</p>
          <p>O código expira ao fim de ${minutes} minutos e só pode ser usado uma vez.</p>
          <p>Se não pediste este código, ignora este email.</p>
        `,
      };
    }

    case 'password_reset': {
      const url = links.resetPassword(hostToken(context));

      return {
        to: context.recipientEmail,
        subject: 'Reposição de senha — Conto Contigo',
        messageKey: context.idempotencyKey,
        text: [
          'Olá,',
          '',
          'Recebemos um pedido para repor a senha da tua conta no Conto Contigo:',
          url,
          '',
          'Se não fizeste este pedido, ignora este email. O link expira ao fim de 60 minutos.',
        ].join('\n'),
        html: `
          <p>Olá,</p>
          <p>Recebemos um pedido para repor a senha da tua conta no Conto Contigo:</p>
          <p><a href="${escapeHtml(url)}">Definir nova senha</a></p>
          <p>Se não fizeste este pedido, ignora este email. O link expira ao fim de 60 minutos.</p>
        `,
      };
    }

    case 'host_welcome': {
      return {
        to: context.recipientEmail,
        subject: 'Bem-vindo ao Conto Contigo',
        messageKey: context.idempotencyKey,
        text: [
          'Olá,',
          '',
          'A tua conta no Conto Contigo foi criada e o teu email já está confirmado.',
          'Já podes criar e gerir os teus eventos.',
          links.login(),
        ].join('\n'),
        html: `
          <p>Olá,</p>
          <p>A tua conta no Conto Contigo foi criada e o teu email já está confirmado.</p>
          <p>Já podes criar e gerir os teus eventos.</p>
          <p><a href="${escapeHtml(links.login())}">Entrar no Conto Contigo</a></p>
        `,
      };
    }

    case 'profile_reminder': {
      return {
        to: context.recipientEmail,
        subject: 'Completa o teu perfil — Conto Contigo',
        messageKey: context.idempotencyKey,
        text: [
          'Olá,',
          '',
          'Falta preencher a tua data de nascimento no perfil do Conto Contigo.',
          'Podes fazê-lo nas definições da conta.',
          links.login(),
        ].join('\n'),
        html: `
          <p>Olá,</p>
          <p>Falta preencher a tua data de nascimento no perfil do Conto Contigo.</p>
          <p>Podes fazê-lo nas definições da conta.</p>
          <p><a href="${escapeHtml(links.login())}">Abrir definições</a></p>
        `,
      };
    }

    case 'invitation': {
      const event = requireEventSummary(context);
      const url = links.invitation(inviteToken(context));
      const guest = context.guestName ?? 'convidado';

      return {
        to: context.recipientEmail,
        subject: `Convite: ${event.title}`,
        messageKey: context.idempotencyKey,
        text: [
          `Olá ${guest},`,
          '',
          `${context.hostName ?? 'O anfitrião'} convida-te para ${event.title}.`,
          '',
          eventLines(event).join('\n'),
          '',
          context.eventContributionEnabled
            ? 'Os dados de contribuição estão disponíveis na página do convite.'
            : '',
          `Confirma a tua presença: ${url}`,
          '',
          'Este link é pessoal. Não o partilhes.',
        ]
          .filter((line) => line !== '')
          .join('\n'),
        html: `
          <p>Olá ${escapeHtml(guest)},</p>
          <p><strong>${escapeHtml(context.hostName ?? 'O anfitrião')}</strong> convida-te para <strong>${escapeHtml(event.title)}</strong>.</p>
          ${eventHtml(event)}
          ${context.eventContributionEnabled ? '<p>Os dados de contribuição estão disponíveis na página do convite.</p>' : ''}
          <p><a href="${escapeHtml(url)}">Confirmar presença</a></p>
          <p>Este link é pessoal. Não o partilhes.</p>
        `,
      };
    }

    case 'reminder': {
      const event = requireEventSummary(context);
      const url = links.invitation(inviteToken(context));
      const guest = context.guestName ?? 'convidado';
      const { lead, subject } = reminderText(context.reminderKind);

      const callToAction =
        context.rsvpStatus === 'accepted'
          ? 'A tua presença está confirmada. Aqui ficam os detalhes do evento.'
          : 'Ainda não respondeste. Confirma ou atualiza a tua resposta:';

      return {
        to: context.recipientEmail,
        subject: `${subject} — ${event.title}`,
        messageKey: context.idempotencyKey,
        text: [
          `Olá ${guest},`,
          '',
          `${lead}: ${event.title}.`,
          '',
          eventLines(event).join('\n'),
          '',
          callToAction,
          url,
        ].join('\n'),
        html: `
          <p>Olá ${escapeHtml(guest)},</p>
          <p><strong>${escapeHtml(lead)}</strong>: ${escapeHtml(event.title)}.</p>
          ${eventHtml(event)}
          <p>${escapeHtml(callToAction)}</p>
          <p><a href="${escapeHtml(url)}">Abrir convite</a></p>
        `,
      };
    }

    case 'decline_notification': {
      const event = requireEventSummary(context);
      const guest = context.guestName ?? 'Um convidado';
      const guestEmail = context.guestEmail ?? context.recipientEmail;

      return {
        to: context.hostEmail ?? context.recipientEmail,
        subject: `Convite recusado — ${event.title}`,
        messageKey: context.idempotencyKey,
        text: [
          `Olá ${context.hostName ?? 'anfitrião'},`,
          '',
          `${guest} (${guestEmail}) recusou o convite para ${event.title}.`,
          'Os lembretes para este convidado foram cancelados.',
        ].join('\n'),
        html: `
          <p>Olá ${escapeHtml(context.hostName ?? 'anfitrião')},</p>
          <p><strong>${escapeHtml(guest)}</strong> (${escapeHtml(guestEmail)}) recusou o convite para <strong>${escapeHtml(event.title)}</strong>.</p>
          <p>Os lembretes para este convidado foram cancelados.</p>
        `,
      };
    }

    case 'event_cancelled': {
      const event = requireEventSummary(context);
      const guest = context.guestName ?? 'convidado';

      return {
        to: context.recipientEmail,
        subject: `Evento cancelado — ${event.title}`,
        messageKey: context.idempotencyKey,
        text: [
          `Olá ${guest},`,
          '',
          `O evento ${event.title} foi cancelado pelo anfitrião.`,
          'Não é necessário responder ao convite.',
        ].join('\n'),
        html: `
          <p>Olá ${escapeHtml(guest)},</p>
          <p>O evento <strong>${escapeHtml(event.title)}</strong> foi cancelado pelo anfitrião.</p>
          <p>Não é necessário responder ao convite.</p>
        `,
      };
    }
  }
}

/** Envia o link de gestão imediatamente após a criação do evento. */
export async function sendManageLink(input: {
  eventId: string;
  title: string;
  hostName: string;
  hostEmail: string;
  manageUrl: string;
}): Promise<SendResult> {
  const message: MailMessage = {
    to: input.hostEmail,
    subject: `O teu link de gestão — ${input.title}`,
    messageKey: `manage_link_${input.eventId}`,
    text: [
      `Olá ${input.hostName},`,
      '',
      `O teu evento ${input.title} foi criado no Conto Contigo.`,
      'Guarda este link: é a única forma de gerir o evento.',
      input.manageUrl,
      '',
      'Quem tiver o link pode gerir o evento e ver a lista de convidados.',
      'Não o partilhes com os convidados.',
    ].join('\n'),
    html: `
      <p>Olá ${escapeHtml(input.hostName)},</p>
      <p>O teu evento <strong>${escapeHtml(input.title)}</strong> foi criado no Conto Contigo.</p>
      <p>Guarda este link — é a única forma de gerir o evento:</p>
      <p><a href="${escapeHtml(input.manageUrl)}">${escapeHtml(input.manageUrl)}</a></p>
      <p>Quem tiver o link pode gerir o evento e ver a lista de convidados. Não o partilhes com os convidados.</p>
    `,
  };

  try {
    return await sendMail(message);
  } catch (error) {
    logger.error({ err: error, eventId: input.eventId }, 'Falha ao enviar o link de gestão.');
    throw error;
  }
}
