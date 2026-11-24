import { NotFoundError, ValidationError } from '../errors/HttpErrors';
import { EventDraftRow, eventDraftRepository } from '../repositories/eventDraft.repository';
import { SaveEventDraftBody } from '../schemas/eventDraft.schemas';

const MAX_DRAFTS = 20;
const NOT_FOUND = 'Rascunho não encontrado.';

export function toEventDraftDto(row: EventDraftRow) {
  return {
    id: row.id,
    title: row.title,
    step: row.step,
    payload: row.payload,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

/**
 * Bloco 14 — rascunhos do assistente de criar evento. Não são eventos:
 * não têm link, não entram no feed nem na pesquisa e nunca geram emails
 * ou notificações. Publicar = `POST /host/events` e apagar o rascunho.
 */
export const eventDraftService = {
  async list(hostId: string) {
    return (await eventDraftRepository.list(hostId)).map(toEventDraftDto);
  },

  async get(hostId: string, id: string) {
    const row = await eventDraftRepository.find(hostId, id);
    if (!row) throw new NotFoundError(NOT_FOUND, 'event_draft_not_found');
    return toEventDraftDto(row);
  },

  async create(hostId: string, body: SaveEventDraftBody) {
    if ((await eventDraftRepository.count(hostId)) >= MAX_DRAFTS) {
      throw new ValidationError(`Pode ter até ${MAX_DRAFTS} rascunhos. Elimine algum para continuar.`, {}, 'event_draft_limit');
    }
    return toEventDraftDto(
      await eventDraftRepository.create(hostId, { title: body.title?.trim() || null, step: body.step, payload: body.payload })
    );
  },

  async update(hostId: string, id: string, body: SaveEventDraftBody) {
    const row = await eventDraftRepository.update(hostId, id, {
      title: body.title?.trim() || null,
      step: body.step,
      payload: body.payload,
    });
    if (!row) throw new NotFoundError(NOT_FOUND, 'event_draft_not_found');
    return toEventDraftDto(row);
  },

  async remove(hostId: string, id: string): Promise<void> {
    if (!(await eventDraftRepository.remove(hostId, id))) throw new NotFoundError(NOT_FOUND, 'event_draft_not_found');
  },
};
