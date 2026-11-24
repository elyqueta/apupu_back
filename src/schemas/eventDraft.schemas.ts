import { z } from 'zod';

export const eventDraftParamsSchema = z.object({ draftId: z.uuid('Rascunho inválido.') });

/**
 * O conteúdo é o estado do assistente (formulário), guardado como está:
 * só é validado como evento ao publicar (`POST /host/events`).
 */
export const saveEventDraftSchema = z
  .object({
    title: z.string().trim().max(150).nullable().optional(),
    step: z.number().int().min(0).max(20),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict()
  .refine((value) => JSON.stringify(value.payload).length <= 60_000, {
    message: 'O rascunho é demasiado grande.',
    path: ['payload'],
  });

export type SaveEventDraftBody = z.infer<typeof saveEventDraftSchema>;
