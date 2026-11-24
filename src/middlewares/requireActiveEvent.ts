import { NextFunction, Request, Response } from 'express';
import { ConflictError } from '../errors';
import { eventRepository } from '../repositories/event.repository';
import { invitationRepository } from '../repositories/invitation.repository';
import { taskRepository } from '../repositories/task.repository';
import { teamInviteRepository } from '../repositories/teamInvite.repository';
import { teamRepository } from '../repositories/team.repository';
import { effectiveEventStatus } from '../utils/eventStatus.util';
import { hashToken } from '../utils/token.util';

/**
 * Bloqueia escritas em eventos cancelados.
 *
 * É montado no router v1, antes dos routers de domínio. Determinamos o
 * evento por, nesta ordem: `eventId` nos parâmetros, `event_id` no corpo,
 * token de convite/convite de equipa, ou pelo recurso referenciado
 * (tarefa, equipa ou convite) quando o `eventId` só existe noutro
 * recurso. Se não for possível resolver o evento com segurança, a rota
 * continua e aplica as suas próprias regras de autorização/404 — nunca
 * inventamos um bloqueio.
 */
export const EVENT_CANCELLED_MESSAGE = 'Este evento foi cancelado. Já não é possível fazer alterações.';
export const EVENT_COMPLETED_MESSAGE = 'Este evento já terminou. Já não é possível fazer alterações.';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type EventStatusRow = {
  status: string;
  startsAt?: Date;
  endsAt?: Date | null;
  timezone?: string;
} | null;

interface EventLookupDependencies {
  findEventStatus: (eventId: string) => Promise<EventStatusRow>;
  findInvitationByTokenHash: (hash: string) => Promise<{ eventId: string } | null>;
  findInvitationById: (id: string) => Promise<{ eventId: string } | null>;
  findTaskById: (id: string) => Promise<{ eventId: string | null } | null>;
  findTeamById: (id: string) => Promise<{ eventId: string } | null>;
  findTeamInviteByTokenHash: (
    hash: string
  ) => Promise<{ eventId: string } | null>;
}

const defaultDependencies: EventLookupDependencies = {
  findEventStatus: (eventId) => eventRepository.findById(eventId),
  findInvitationByTokenHash: (hash) => invitationRepository.findByTokenHash(hash),
  findInvitationById: (id) => invitationRepository.findById(id),
  findTaskById: (id) => taskRepository.findById(id),
  findTeamById: (id) => teamRepository.findById(id),
  findTeamInviteByTokenHash: (hash) => teamInviteRepository.findByTokenHash(hash),
};

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isIgnoredWrite(path: string): boolean {
  // O próprio cancelamento tem de continuar a funcionar depois de
  // cancelado (idempotência). A sessão de gestão não altera dados do
  // evento: é apenas controlo de acesso.
  return (
    /\/events\/[^/]+\/cancel$/.test(path) ||
    /^\/host\/session(?:\/[^/]+)?$/.test(path)
  );
}

/**
 * Bloco 15: eventos terminados ficam só de leitura, exceto galeria.
 * Ponto de extensão: quando a galeria existir, as rotas devem bater
 * neste padrão (ou o middleware deve receber allowGallery).
 */
function isGalleryWrite(path: string): boolean {
  return /\/events\/[^/]+\/(gallery|media)(?:\/|$)/.test(path);
}

function bodyEventId(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  const candidate = record.event_id ?? record.eventId;
  return isUuid(candidate) ? candidate : null;
}

/** Resolve o evento ligado ao pedido, quando possível. */
export async function resolveEventIdForWrite(
  req: Request,
  dependencies: EventLookupDependencies = defaultDependencies
): Promise<string | null> {
  const path = req.path;

  const publicInvitation = /^\/public\/invitations\/([^/]+)\/(?:claim|rsvp)$/.exec(path);
  if (publicInvitation?.[1]) {
    const invitation = await dependencies.findInvitationByTokenHash(
      hashToken(publicInvitation[1])
    );
    return invitation?.eventId ?? null;
  }

  const publicTeamInvite = /^\/public\/team-invites\/([^/]+)\/(?:accept|report)$/.exec(path);
  if (publicTeamInvite?.[1]) {
    const invite = await dependencies.findTeamInviteByTokenHash(
      hashToken(publicTeamInvite[1])
    );
    return invite?.eventId ?? null;
  }

  if (isUuid(req.params.eventId)) return req.params.eventId;

  const fromBody = bodyEventId(req.body);
  if (fromBody) return fromBody;

  if (isUuid(req.params.taskId)) {
    const task = await dependencies.findTaskById(req.params.taskId);
    return task?.eventId ?? null;
  }

  if (isUuid(req.params.teamId)) {
    const team = await dependencies.findTeamById(req.params.teamId);
    return team?.eventId ?? null;
  }

  // Rotas globais da caixa de entrada (Parte F) não têm `eventId`.
  if (isUuid(req.params.invitationId)) {
    const invitation = await dependencies.findInvitationById(req.params.invitationId);
    return invitation?.eventId ?? null;
  }

  return null;
}

export function requireActiveEvent(
  dependencies: EventLookupDependencies = defaultDependencies,
  options: { allowGallery?: boolean } = {}
) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        next();
        return;
      }
      if (isIgnoredWrite(req.path)) {
        next();
        return;
      }

      const eventId = await resolveEventIdForWrite(req, dependencies);
      if (!eventId) {
        next();
        return;
      }

      const event = await dependencies.findEventStatus(eventId);
      if (!event) {
        next();
        return;
      }

      const status = effectiveEventStatus({
        status: event.status as any,
        startsAt: event.startsAt ?? new Date(0),
        endsAt: event.endsAt ?? null,
        timezone: event.timezone ?? 'Africa/Luanda',
      });

      if (status === 'cancelled') {
        throw new ConflictError(EVENT_CANCELLED_MESSAGE, 'event_cancelled');
      }
      if (status === 'completed' && !options.allowGallery && !isGalleryWrite(req.path)) {
        throw new ConflictError(EVENT_COMPLETED_MESSAGE, 'event_completed');
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
