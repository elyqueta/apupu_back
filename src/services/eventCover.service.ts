import { createHash } from 'node:crypto';
import { env } from '../config/env';
import { NotFoundError } from '../errors';
import { eventRepository } from '../repositories/event.repository';
import { Event, EventAccessScope, EventRecord } from '../types/event.types';
import { destroyImage, uploadImage } from './cloudinary.service';

const EVENT_NOT_FOUND = 'Evento não encontrado.';

async function requireEvent(
  scope: EventAccessScope,
  eventId: string
): Promise<EventRecord> {
  const access = await eventRepository.findByIdForAccess(eventId, scope);

  if (!access) {
    throw new NotFoundError(EVENT_NOT_FOUND, 'event_not_found');
  }

  return access.event;
}

async function replaceCover(
  eventId: string,
  previous: EventRecord,
  cover: {
    coverUrl: string | null;
    coverHash: string | null;
    coverPublicId: string | null;
  }
): Promise<Event> {
  const updated = await eventRepository.update(eventId, cover);

  if (!updated) {
    throw new NotFoundError(EVENT_NOT_FOUND, 'event_not_found');
  }

  if (
    previous.coverPublicId &&
    previous.coverPublicId !== cover.coverPublicId
  ) {
    await destroyImage(previous.coverPublicId);
  }

  return updated;
}

export const eventCoverService = {
  /** Define a capa por URL. Repetir o mesmo URL é uma operação idempotente. */
  async setFromUrl(
    scope: EventAccessScope,
    eventId: string,
    url: string
  ): Promise<Event> {
    const event = await requireEvent(scope, eventId);

    if (event.coverUrl === url && !event.coverPublicId) {
      return event;
    }

    return replaceCover(eventId, event, {
      coverUrl: url,
      coverHash: null,
      coverPublicId: null,
    });
  },

  /**
   * Upload com idempotência por conteúdo: o mesmo ficheiro (SHA-256)
   * não volta a ser enviado para o Cloudinary.
   */
  async upload(
    scope: EventAccessScope,
    eventId: string,
    buffer: Buffer,
    contentType: string
  ): Promise<Event> {
    const event = await requireEvent(scope, eventId);
    const hash = createHash('sha256').update(buffer).digest('hex');

    if (event.coverHash === hash && event.coverUrl) {
      return event;
    }

    const uploaded = await uploadImage(buffer, contentType, {
      folder: env.CLOUDINARY_EVENT_FOLDER,
      unavailableMessage: 'O upload da imagem de capa não está configurado.',
      unavailableCode: 'event_cover_upload_unavailable',
    });

    return replaceCover(eventId, event, {
      coverUrl: uploaded.url,
      coverHash: hash,
      coverPublicId: uploaded.publicId,
    });
  },

  /** Remove a capa. Repetir a remoção é uma operação idempotente. */
  async remove(scope: EventAccessScope, eventId: string): Promise<Event> {
    const event = await requireEvent(scope, eventId);

    if (!event.coverUrl && !event.coverPublicId && !event.coverHash) {
      return event;
    }

    return replaceCover(eventId, event, {
      coverUrl: null,
      coverHash: null,
      coverPublicId: null,
    });
  },
};
