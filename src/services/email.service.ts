import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../config/env';
import { catalog } from '../emails/catalog';
import { formatEmailClock, formatEmailDate } from '../emails/format';
import { renderEmailHtml, renderEmailText } from '../emails/render';
import { EmailTemplateCode, EmailVars } from '../emails/types';
import { DeliveryContext } from '../repositories/emailDelivery.repository';
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
/**
 * Transporte efectivo.
 *
 * Fora de produção nunca há entrega real: mesmo que o `.env` local
 * tenha `brevo`, `smtp` ou `resend`, as mensagens são escritas em
 * `EMAIL_JSON_DIR`. Isto impede que um ambiente de desenvolvimento ou
 * de testes envie emails para endereços reais por engano.
 */
export function resolveTransport(): typeof env.EMAIL_TRANSPORT {
  if (env.NODE_ENV !== 'production') return 'json';
  return env.EMAIL_TRANSPORT;
}

function buildTransport(): Transporter | null {
  if (resolveTransport() !== 'smtp') return null;

  if (!env.SMTP_PASS && env.RESEND_API_KEY) {
    return nodemailer.createTransport({
      host: 'smtp.resend.com',
      port: 465,
      secure: true,
      auth: { user: env.SMTP_USER || 'resend', pass: env.RESEND_API_KEY },
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
  const transportName = resolveTransport();

  if (transportName === 'brevo') {
    return emailSender.send(message);
  }

  if (transportName === 'resend') {
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

function eventLocation(event: EventSummary): string | undefined {
  if (event.locationType === 'online') {
    return event.onlineUrl ? `Online: ${event.onlineUrl}` : 'Online';
  }

  const parts = [event.locationName, event.locationAddress].filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0
  );

  return parts.length > 0 ? parts.join(' · ') : undefined;
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
 * reposição de palavra-passe).
 */
function hostToken(context: DeliveryContext): string {
  if (!context.tokenEncrypted) {
    throw new Error('Entrega de conta sem segredo cifrado.');
  }
  return decryptToken(context.tokenEncrypted);
}

/** Lê uma string não vazia do payload da entrega. */
function payloadString(context: DeliveryContext, key: string): string | undefined {
  const value = context.payload?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/** Link para a tarefa, quando a entrega tem evento e tarefa. */
function taskUrl(context: DeliveryContext): string | undefined {
  const taskId = payloadString(context, 'taskId');
  return context.eventId && taskId ? links.task(context.eventId, taskId) : undefined;
}

/** Link para a equipa, quando a entrega tem evento e equipa. */
function teamUrl(context: DeliveryContext): string | undefined {
  const teamId = payloadString(context, 'teamId');
  return context.eventId && teamId ? links.team(context.eventId, teamId) : undefined;
}

/** Variáveis comuns a todas as mensagens de evento. */
function eventVars(
  context: DeliveryContext,
  event: EventSummary,
  overrides: Partial<EmailVars> = {}
): EmailVars {
  return {
    anfitriao: context.hostName ?? undefined,
    evento: event.title,
    data: formatEmailDate(event.startsAt, event.timezone),
    hora: formatEmailClock(event.startsAt, event.timezone),
    local: eventLocation(event),
    online: event.locationType === 'online',
    vestuario: event.dressCode ?? undefined,
    ...overrides,
  };
}

/**
 * Os lembretes são agendados por dias (`14d`, `7d`, `3d`, `1d`), mas o
 * catálogo distingue o dia anterior e a última hora. Um eventual
 * `reminderKind` em horas (`2h`) também é reconhecido.
 */
function reminderCode(kind: string | null): EmailTemplateCode {
  if (kind === '2h') return 'lembrete_2h';

  const days = Number.parseInt((kind ?? '').replace('d', ''), 10);
  if (days === 0) return 'lembrete_2h';
  if (days === 1) return 'lembrete_24h';

  return 'lembrete';
}

function reminderDays(kind: string | null): number | undefined {
  if (kind === '2h') return undefined;

  const days = Number.parseInt((kind ?? '').replace('d', ''), 10);
  return Number.isFinite(days) ? days : undefined;
}

interface DeliveryEmail {
  to: string;
  code: EmailTemplateCode;
  vars: EmailVars;
}

/**
 * Traduz a entrega da outbox para uma entrada do catálogo.
 *
 * As ligações são reconstruídas apenas aqui, imediatamente antes do
 * envio, e nunca são persistidas na linha de entrega.
 */
function buildDeliveryEmail(context: DeliveryContext): DeliveryEmail {
  switch (context.messageType) {
    case 'manage_link': {
      const event = requireEventSummary(context);

      return {
        to: context.recipientEmail,
        code: 'manage_link',
        vars: eventVars(context, event, {
          nome: context.hostName ?? undefined,
          url: links.manageEvent(hostToken(context)),
        }),
      };
    }

    case 'manager_invite': {
      const event = requireEventSummary(context);

      return {
        to: context.recipientEmail,
        code: 'manager_invite',
        vars: eventVars(context, event, {
          url: links.manageEvent(hostToken(context)),
          codigo: payloadString(context, 'access_code'),
        }),
      };
    }

    case 'email_verification':
      return {
        to: context.recipientEmail,
        code: 'email_verification',
        vars: { url: links.verifyEmail(hostToken(context)) },
      };

    case 'registration_otp': {
      const code = hostToken(context);

      if (payloadString(context, 'purpose') === 'institution_link') {
        return {
          to: context.recipientEmail,
          code: 'instituicao_codigo',
          vars: {
            codigo: code,
            comunidade: payloadString(context, 'communityName'),
            instituicao: payloadString(context, 'institutionName'),
            expiraEm: `${env.REGISTRATION_OTP_TTL_MINUTES} minutos`,
          },
        };
      }

      if (payloadString(context, 'purpose') === 'community_transfer') {
        return {
          to: context.recipientEmail,
          code: 'comunidade_transferencia_codigo',
          vars: {
            codigo: code,
            comunidade: payloadString(context, 'communityName'),
            expiraEm: `${env.REGISTRATION_OTP_TTL_MINUTES} minutos`,
          },
        };
      }

      if (payloadString(context, 'purpose') === 'event_cancel') {
        return {
          to: context.recipientEmail,
          code: 'cancelamento_codigo',
          vars: {
            codigo: code,
            expiraEm: `${env.REGISTRATION_OTP_TTL_MINUTES} minutos`,
          },
        };
      }

      return {
        to: context.recipientEmail,
        code: 'verificacao_codigo',
        vars: {
          codigo: code,
          expiraEm: `${env.REGISTRATION_OTP_TTL_MINUTES} minutos`,
          url: links.registerOtp(context.recipientEmail, code),
        },
      };
    }

    case 'password_reset':
      return {
        to: context.recipientEmail,
        code: 'recuperar_senha',
        vars: { url: links.resetPassword(hostToken(context)) },
      };

    case 'community_notice': {
      const slug = payloadString(context, 'communitySlug');
      return {
        to: context.recipientEmail,
        code: 'comunidade_aviso',
        vars: {
          nome: payloadString(context, 'recipientName'),
          comunidade: payloadString(context, 'communityName'),
          autor: payloadString(context, 'actorName'),
          aviso: payloadString(context, 'kind') as EmailVars['aviso'],
          url: slug ? links.community(slug) : links.settings(),
        },
      };
    }

    case 'host_welcome':
      return {
        to: context.recipientEmail,
        code: 'boas_vindas',
        vars: { url: links.createEvent() },
      };

    case 'profile_reminder':
      return {
        to: context.recipientEmail,
        code: 'profile_reminder',
        vars: { url: links.settings() },
      };

    case 'invitation': {
      const event = requireEventSummary(context);

      return {
        to: context.recipientEmail,
        code: 'convite_recebido',
        vars: eventVars(context, event, {
          nome: context.guestName ?? undefined,
          convidado: context.guestName ?? undefined,
          url: links.invitation(inviteToken(context)),
          contribuicao: context.eventContributionEnabled === true,
        }),
      };
    }

    case 'reminder': {
      const event = requireEventSummary(context);

      return {
        to: context.recipientEmail,
        code: reminderCode(context.reminderKind),
        vars: eventVars(context, event, {
          nome: context.guestName ?? undefined,
          convidado: context.guestName ?? undefined,
          url: links.invitation(inviteToken(context)),
          confirmado: context.rsvpStatus === 'accepted',
          dias: reminderDays(context.reminderKind),
        }),
      };
    }

    case 'decline_notification': {
      const event = requireEventSummary(context);

      return {
        to: context.hostEmail ?? context.recipientEmail,
        code: 'decline_notification',
        vars: eventVars(context, event, {
          nome: context.hostName ?? undefined,
          convidado: context.guestName ?? undefined,
          detalhe: context.guestEmail ?? context.recipientEmail,
        }),
      };
    }

    case 'invitation_removed': {
      const event = requireEventSummary(context);

      return {
        to: context.recipientEmail,
        code: 'invitation_removed',
        vars: eventVars(context, event, {
          nome: context.guestName ?? undefined,
          convidado: context.guestName ?? undefined,
        }),
      };
    }

    case 'team_invite': {
      const event = requireEventSummary(context);

      return {
        to: context.recipientEmail,
        code: 'equipa_convite',
        vars: eventVars(context, event, {
          nome: payloadString(context, 'recipientName'),
          anfitriao: payloadString(context, 'actorName') ?? context.hostName ?? undefined,
          equipa: payloadString(context, 'teamName'),
          url: links.teamInvite(hostToken(context)),
          denunciarUrl: links.teamInviteReport(hostToken(context)),
          expiraEm: payloadString(context, 'expiryLabel'),
        }),
      };
    }

    case 'team_added': {
      const event = requireEventSummary(context);

      return {
        to: context.recipientEmail,
        code: 'equipa_adicionado',
        vars: eventVars(context, event, {
          nome: payloadString(context, 'recipientName'),
          equipa: payloadString(context, 'teamName'),
          autor: payloadString(context, 'actorName'),
          url: teamUrl(context),
        }),
      };
    }

    case 'team_role_changed': {
      const event = requireEventSummary(context);

      return {
        to: context.recipientEmail,
        code: 'equipa_papel_alterado',
        vars: eventVars(context, event, {
          nome: payloadString(context, 'recipientName'),
          equipa: payloadString(context, 'teamName'),
          autor: payloadString(context, 'actorName'),
          papel: payloadString(context, 'role'),
          url: teamUrl(context),
        }),
      };
    }

    case 'task_assigned': {
      const event = requireEventSummary(context);

      return {
        to: context.recipientEmail,
        code: 'tarefa_atribuida',
        vars: eventVars(context, event, {
          nome: payloadString(context, 'recipientName'),
          equipa: payloadString(context, 'teamName'),
          tarefa: payloadString(context, 'taskTitle'),
          autor: payloadString(context, 'actorName'),
          prazo: payloadString(context, 'dueDate'),
          url: taskUrl(context),
        }),
      };
    }

    case 'task_completed': {
      const event = requireEventSummary(context);

      return {
        to: context.recipientEmail,
        code: 'tarefa_concluida',
        vars: eventVars(context, event, {
          nome: payloadString(context, 'recipientName'),
          equipa: payloadString(context, 'teamName'),
          tarefa: payloadString(context, 'taskTitle'),
          responsavel: payloadString(context, 'assigneeName'),
          url: taskUrl(context),
        }),
      };
    }

    case 'task_reassigned': {
      const event = requireEventSummary(context);

      return {
        to: context.recipientEmail,
        code: 'tarefa_reatribuida',
        vars: eventVars(context, event, {
          nome: payloadString(context, 'recipientName'),
          equipa: payloadString(context, 'teamName'),
          tarefa: payloadString(context, 'taskTitle'),
          responsavel: payloadString(context, 'assigneeName'),
          anterior: payloadString(context, 'previousAssigneeName'),
          autor: payloadString(context, 'actorName'),
          variante:
            payloadString(context, 'variant') === 'anterior' ? 'anterior' : 'novo',
          url: taskUrl(context),
        }),
      };
    }

    case 'invitation_reply': {
      const event = requireEventSummary(context);

      return {
        to: context.recipientEmail,
        code: 'resposta_mensagem',
        vars: eventVars(context, event, {
          nome: context.guestName ?? undefined,
          convidado: context.guestName ?? undefined,
          resposta: payloadString(context, 'answer'),
        }),
      };
    }

    case 'event_cancelled': {
      const event = requireEventSummary(context);

      return {
        to: context.recipientEmail,
        code: 'evento_cancelado',
        vars: eventVars(context, event, {
          nome: context.guestName ?? undefined,
          convidado: context.guestName ?? undefined,
          canceladoPor:
            payloadString(context, 'cancelledBy') === 'plataforma'
              ? 'plataforma'
              : 'anfitriao',
          motivo: payloadString(context, 'reason'),
        }),
      };
    }
  }
}

/**
 * Renderiza uma entrega a partir do contexto carregado da base de dados.
 *
 * O HTML e o texto simples vêm do mesmo catálogo, pelo que a copy e os
 * detalhes nunca divergem entre os dois formatos.
 */
export function renderDelivery(context: DeliveryContext): MailMessage {
  const delivery = buildDeliveryEmail(context);
  const content = catalog[delivery.code].email(delivery.vars);

  return {
    to: delivery.to,
    subject: content.subject,
    messageKey: context.idempotencyKey,
    text: renderEmailText(content),
    html: renderEmailHtml(content),
  };
}
