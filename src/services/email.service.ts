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

/**
 * Transporte de email.
 *
 * - `smtp`: entrega real através do provider configurado.
 * - `json`: desenvolvimento. Escreve a mensagem renderizada em
 *   `EMAIL_JSON_DIR` em vez de a enviar ou de a colocar nos logs — os
 *   links contêm tokens de acesso e nunca devem aparecer em logs.
 */
function buildTransport(): Transporter | null {
  if (env.EMAIL_TRANSPORT !== 'smtp') return null;

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

function summaryFromContext(context: DeliveryContext): EventSummary {
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

function inviteToken(context: DeliveryContext): string {
  if (!context.tokenEncrypted) {
    throw new Error('Entrega de convite sem token cifrado.');
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
  const event = summaryFromContext(context);

  switch (context.messageType) {
    case 'manage_link': {
      throw new Error('O link de gestão não é enviado pela outbox.');
    }

    case 'invitation': {
      const url = links.invitation(inviteToken(context));
      const guest = context.guestName ?? 'convidado';

      return {
        to: context.recipientEmail,
        subject: `Convite: ${event.title}`,
        messageKey: context.idempotencyKey,
        text: [
          `Olá ${guest},`,
          '',
          `${context.hostName} convida-te para ${event.title}.`,
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
          <p><strong>${escapeHtml(context.hostName)}</strong> convida-te para <strong>${escapeHtml(event.title)}</strong>.</p>
          ${eventHtml(event)}
          ${context.eventContributionEnabled ? '<p>Os dados de contribuição estão disponíveis na página do convite.</p>' : ''}
          <p><a href="${escapeHtml(url)}">Confirmar presença</a></p>
          <p>Este link é pessoal. Não o partilhes.</p>
        `,
      };
    }

    case 'reminder': {
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
      const guest = context.guestName ?? 'Um convidado';
      const guestEmail = context.guestEmail ?? context.recipientEmail;

      return {
        to: context.hostEmail,
        subject: `Convite recusado — ${event.title}`,
        messageKey: context.idempotencyKey,
        text: [
          `Olá ${context.hostName},`,
          '',
          `${guest} (${guestEmail}) recusou o convite para ${event.title}.`,
          'Os lembretes para este convidado foram cancelados.',
        ].join('\n'),
        html: `
          <p>Olá ${escapeHtml(context.hostName)},</p>
          <p><strong>${escapeHtml(guest)}</strong> (${escapeHtml(guestEmail)}) recusou o convite para <strong>${escapeHtml(event.title)}</strong>.</p>
          <p>Os lembretes para este convidado foram cancelados.</p>
        `,
      };
    }

    case 'event_cancelled': {
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
      `O teu evento ${input.title} foi criado no Apupu.`,
      'Guarda este link: é a única forma de gerir o evento.',
      input.manageUrl,
      '',
      'Quem tiver o link pode gerir o evento e ver a lista de convidados.',
      'Não o partilhes com os convidados.',
    ].join('\n'),
    html: `
      <p>Olá ${escapeHtml(input.hostName)},</p>
      <p>O teu evento <strong>${escapeHtml(input.title)}</strong> foi criado no Apupu.</p>
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
