import { Request, RequestHandler, Response, Router } from 'express';
import { asyncHandler } from '../../middlewares/asyncHandler';
import { hostAccountAuth } from '../../middlewares/hostAccountAuth';
import { eventDraftLimiter, writeLimiter } from '../../middlewares/rateLimiter';
import { requireAuthCsrf } from '../../middlewares/requireAuthCsrf';
import { validate } from '../../middlewares/validate';
import { eventDraftParamsSchema, saveEventDraftSchema, SaveEventDraftBody } from '../../schemas/eventDraft.schemas';
import { eventDraftService } from '../../services/eventDraft.service';

/**
 * Bloco 14 — rascunhos do assistente de criar evento (privados).
 *
 * @openapi
 * /api/v1/host/event-drafts:
 *   get:
 *     tags: [Eventos]
 *     summary: Rascunhos do anfitrião (mais recentes primeiro)
 *     responses:
 *       200: { description: Lista. }
 *       401:
 *         description: Sessão inválida.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
const router = Router();
const read: RequestHandler[] = [asyncHandler(hostAccountAuth)];
const save: RequestHandler[] = [asyncHandler(hostAccountAuth), eventDraftLimiter, requireAuthCsrf];
const params = validate({ params: eventDraftParamsSchema });
const body = validate({ body: saveEventDraftSchema });

function hostId(req: Request): string {
  if (!req.hostAccount) throw new Error('Conta não resolvida: falta o middleware hostAccountAuth.');
  return req.hostAccount.id;
}
const draftId = (req: Request): string => req.params.draftId ?? '';

router.get('/', ...read, asyncHandler(async (req: Request, res: Response) => {
  res.status(200).json({ data: await eventDraftService.list(hostId(req)) });
}));
router.get('/:draftId', ...read, params, asyncHandler(async (req: Request, res: Response) => {
  res.status(200).json({ data: await eventDraftService.get(hostId(req), draftId(req)) });
}));
router.post('/', ...save, body, asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json({ data: await eventDraftService.create(hostId(req), req.body as SaveEventDraftBody) });
}));
router.put('/:draftId', ...save, params, body, asyncHandler(async (req: Request, res: Response) => {
  res.status(200).json({ data: await eventDraftService.update(hostId(req), draftId(req), req.body as SaveEventDraftBody) });
}));
router.delete('/:draftId', asyncHandler(hostAccountAuth), writeLimiter, requireAuthCsrf, params, asyncHandler(async (req: Request, res: Response) => {
  await eventDraftService.remove(hostId(req), draftId(req));
  res.status(204).send();
}));

export default router;
