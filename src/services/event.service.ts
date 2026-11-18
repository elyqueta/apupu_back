import { NotFoundError, ValidationError } from '../errors';
import { withTransaction } from '../database/pool';
import { activityRepository } from '../repositories/activity.repository';
import { eventRepository, InsertEventData } from '../repositories/event.repository';
import { emailDeliveryRepository } from '../repositories/emailDelivery.repository';
import { invitationRepository } from '../repositories/invitation.repository';
import { templateRepository } from '../repositories/template.repository';
import {
  CreateEventInput,
  Event,
  EventContribution,
  EventLocation,
  EventStats,
  EventTheme,
} from '../types/event.types';
import { Invitation } from '../types/invitation.types';
import { encryptToken } from '../utils/crypto.util';
import { generateToken, hashToken } from '../utils/token.util';
import { CreateEventBody, UpdateEventBody } from '../schemas/event.schemas';
import { generateManageToken, manageLinkService } from './manageLink.service';
import {
  cancelMessagesForEvent,
  enqueueEventCancelled,
  enqueueOnboardingForEvent,
  rescheduleRemindersForEvent,
} from './reminder.service';

function normalizeOptional(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function assertDateOrder(event: {
  startsAt: Date;
  endsAt: Date | null;
  rsvpDeadline: Date | null;
}): void {
  if (event.endsAt && event.endsAt <= event.startsAt) {
    throw new ValidationError('Verifique as datas indicadas.', {
      ends_at: ['A data de fim deve ser posterior à data de início.'],
    });
  }

  if (event.rsvpDeadline && event.rsvpDeadline > event.startsAt) {
    throw new ValidationError('Verifique as datas indicadas.', {
      rsvp_deadline: ['O prazo de resposta deve ser anterior ao início do evento.'],
    });
  }
}

async function assertTemplateActive(templateId: string | null | undefined): Promise<void> {
  if (!templateId) return;

  const template = await templateRepository.findById(templateId);

  if (!template || !template.isActive) {
    throw new ValidationError('Verifique os campos indicados.', {
      template_id: ['Template de convite inválido ou inativo.'],
    });
  }
}

function toLocation(location: CreateEventBody['event']['location']): EventLocation {
  if (location.type === 'online') {
    return {
      type: 'online',
      name: null,
      address: null,
      onlineUrl: location.online_url,
    };
  }

  return {
    type: 'venue',
    name: location.name,
    address: normalizeOptional(location.address),
    onlineUrl: null,
  };
}

function toTheme(theme: CreateEventBody['event']['theme']): EventTheme {
  return theme ?? { mode: 'light', palette: 'default' };
}

function toContribution(
  contribution: CreateEventBody['event']['contribution']
): EventContribution {
  if (!contribution) {
    return {
      enabled: false,
      bankName: null,
      accountHolder: null,
      accountReference: null,
    };
  }

  return {
    enabled: contribution.enabled,
    bankName: normalizeOptional(contribution.bank_name),
    accountHolder: normalizeOptional(contribution.account_holder),
    accountReference: normalizeOptional(contribution.account_reference),
  };
}

function mergeTheme(
  current: EventTheme,
  update: NonNullable<UpdateEventBody['theme']>
): EventTheme {
  return {
    mode: update.mode ?? current.mode,
    palette: update.palette ?? current.palette,
  };
}

function mergeContribution(
  current: EventContribution,
  update: NonNullable<UpdateEventBody['contribution']>
): EventContribution {
  const merged: EventContribution = {
    enabled: update.enabled ?? current.enabled,
    bankName: 'bank_name' in update ? normalizeOptional(update.bank_name) : current.bankName,
    accountHolder:
      'account_holder' in update
        ? normalizeOptional(update.account_holder)
        : current.accountHolder,
    accountReference:
      'account_reference' in update
        ? normalizeOptional(update.account_reference)
        : current.accountReference,
  };

  if (merged.enabled) {
    const fields: Record<string, string[]> = {};

    if (!merged.bankName) fields.bank_name = ['Obrigatório quando a contribuição está ativa.'];
    if (!merged.accountHolder) {
      fields.account_holder = ['Obrigatório quando a contribuição está ativa.'];
    }
    if (!merged.accountReference) {
      fields.account_reference = ['Obrigatório quando a contribuição está ativa.'];
    }

    if (Object.keys(fields).length > 0) {
      throw new ValidationError('Verifique os campos indicados.', fields);
    }
  }

  return merged;
}

export interface CreatedEventResult {
  event: Event;
  manageEmailStatus: 'queued' | 'failed';
  deliveries: Array<{ email: string; status: 'queued' }>;
}

export interface CreateEventOptions {
  /** Conta proprietária; ausente no fluxo legado por link secreto. */
  hostId?: string | null;
}

export const eventService = {
  /**
   * Cria o evento, os convites e as entregas iniciais numa única
   * transacção. O link de gestão é enfileirado na outbox: o token
   * cifrado fica na linha da entrega até o worker renderizar o email,
   * pelo que o pedido HTTP não espera pelo fornecedor de email.
   *
   * `options.hostId` liga o evento à conta autenticada. O fluxo legado
   * (sem conta) continua a funcionar com `hostId` nulo.
   */
  async create(
    input: CreateEventBody,
    options: CreateEventOptions = {}
  ): Promise<CreatedEventResult> {
    await assertTemplateActive(input.event.template_id);

    const manageToken = generateManageToken();

    const data: InsertEventData = {
      hostId: options.hostId ?? null,
      manageTokenHash: manageToken.hash,
      manageTokenExpiresAt: manageToken.expiresAt,
      title: input.event.title,
      hostName: input.event.host_name,
      hostEmail: input.event.host_email,
      category: input.event.category ?? null,
      startsAt: input.event.starts_at,
      endsAt: input.event.ends_at ?? null,
      timezone: input.event.timezone,
      location: toLocation(input.event.location),
      message: normalizeOptional(input.event.message),
      rules: normalizeOptional(input.event.rules),
      dressCode: normalizeOptional(input.event.dress_code),
      templateId: input.event.template_id ?? null,
      coverUrl: input.event.cover_url ?? null,
      theme: toTheme(input.event.theme),
      contribution: toContribution(input.event.contribution),
      rsvpDeadline: input.event.rsvp_deadline ?? null,
    };

    assertDateOrder({
      startsAt: data.startsAt,
      endsAt: data.endsAt,
      rsvpDeadline: data.rsvpDeadline,
    });

    const created = await withTransaction(async (client) => {
      const event = await eventRepository.create(data, client);
      const invitations: Invitation[] = [];

      for (const guest of input.guests) {
        const token = generateToken();
        const invitation = await invitationRepository.create(
          {
            eventId: event.id,
            guestName: guest.name,
            guestEmail: guest.email,
            guestPhone: normalizeOptional(guest.phone),
            tableName: normalizeOptional(guest.table_name),
            tokenHash: hashToken(token),
            tokenEncrypted: encryptToken(token),
          },
          client
        );

        invitations.push(invitation);
      }

      await enqueueOnboardingForEvent(event, invitations, client);

      await activityRepository.create(
        {
          eventId: event.id,
          kind: 'event_created',
          metadata: { guest_count: invitations.length },
        },
        client
      );

      return { event, invitations };
    });

    const manageEmailStatus = await manageLinkService.deliver(
      created.event,
      manageToken.token,
      `manage_link:${created.event.id}`
    );

    return {
      event: created.event,
      manageEmailStatus,
      deliveries: created.invitations.map((invitation) => ({
        email: invitation.guestEmail,
        status: 'queued' as const,
      })),
    };
  },

  async statsFor(event: Event): Promise<EventStats> {
    return eventRepository.stats(event.id);
  },

  /**
   * Actualiza o evento e reconcilia a outbox na mesma transacção.
   *
   * - Cancelar/completar invalida lembretes pendentes.
   * - Cancelar enfileira a comunicação de cancelamento.
   * - Alterar data/fuso cancela e reconstrói apenas lembretes futuros.
   */
  async update(eventId: string, input: UpdateEventBody): Promise<Event> {
    if ('template_id' in input) {
      await assertTemplateActive(input.template_id);
    }

    return withTransaction(async (client) => {
      const current = await eventRepository.findByIdForUpdate(eventId, client);

      if (!current) {
        throw new NotFoundError('Evento não encontrado.', 'event_not_found');
      }

      const startsAt = input.starts_at ?? current.startsAt;
      const endsAt = 'ends_at' in input ? (input.ends_at ?? null) : current.endsAt;
      const rsvpDeadline =
        'rsvp_deadline' in input ? (input.rsvp_deadline ?? null) : current.rsvpDeadline;

      assertDateOrder({ startsAt, endsAt, rsvpDeadline });

      const changes: Partial<CreateEventInput> & { status?: Event['status'] } = {};

      if (input.title !== undefined) changes.title = input.title;
      if (input.host_name !== undefined) changes.hostName = input.host_name;
      if (input.host_email !== undefined) changes.hostEmail = input.host_email;
      if (input.category !== undefined) changes.category = input.category;
      if (input.starts_at !== undefined) changes.startsAt = input.starts_at;
      if ('ends_at' in input) changes.endsAt = input.ends_at ?? null;
      if (input.timezone !== undefined) changes.timezone = input.timezone;
      if (input.location !== undefined) changes.location = toLocation(input.location);
      if ('message' in input) changes.message = normalizeOptional(input.message);
      if ('rules' in input) changes.rules = normalizeOptional(input.rules);
      if ('dress_code' in input) changes.dressCode = normalizeOptional(input.dress_code);
      if ('template_id' in input) changes.templateId = input.template_id ?? null;
      if (input.theme !== undefined) {
        changes.theme = mergeTheme(current.theme, input.theme);
      }
      if (input.contribution !== undefined) {
        changes.contribution = mergeContribution(current.contribution, input.contribution);
      }
      if ('rsvp_deadline' in input) changes.rsvpDeadline = input.rsvp_deadline ?? null;
      if (input.status !== undefined) changes.status = input.status;

      const updated = await eventRepository.update(eventId, changes, client);

      if (!updated) {
        throw new NotFoundError('Evento não encontrado.', 'event_not_found');
      }

      const becameCancelled = current.status !== 'cancelled' && updated.status === 'cancelled';
      const becameCompleted = current.status !== 'completed' && updated.status === 'completed';
      const becameDraft = current.status !== 'draft' && updated.status === 'draft';
      const reactivated =
        (current.status === 'cancelled' || current.status === 'draft') &&
        updated.status === 'scheduled';
      const scheduleChanged =
        input.starts_at !== undefined || input.timezone !== undefined;

      if (becameCancelled || becameCompleted) {
        await cancelMessagesForEvent(updated.id, client);
      } else if (becameDraft) {
        // Um evento em rascunho não está pronto: os lembretes ficam
        // cancelados até voltar a `scheduled`.
        await emailDeliveryRepository.cancelPendingForEventTypes(
          updated.id,
          ['reminder'],
          client
        );
      }

      if (becameCancelled) {
        const invitations = await invitationRepository.listByEvent(updated.id, client);
        await enqueueEventCancelled(updated, invitations, client);
      } else if (!becameCompleted && !becameDraft && (scheduleChanged || reactivated)) {
        await emailDeliveryRepository.cancelPendingForEventTypes(
          updated.id,
          ['reminder'],
          client
        );

        const invitations = await invitationRepository.listByEvent(updated.id, client);
        const eligible = invitations.filter(
          (invitation) =>
            invitation.rsvpStatus !== 'declined' && invitation.claimRevokedAt === null
        );

        await rescheduleRemindersForEvent(updated, eligible, client);
      }

      return updated;
    });
  },
};
