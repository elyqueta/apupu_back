import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middlewares/asyncHandler';
import { hostAccountAuth } from '../../middlewares/hostAccountAuth';
import { publicTokenLimiter } from '../../middlewares/rateLimiter';
import { validate } from '../../middlewares/validate';
import { geocodeService } from '../../services/geocode.service';

const router = Router();

const querySchema = z.object({
  q: z.string().trim().min(3).max(120),
  limit: z.coerce.number().int().min(1).max(8).optional(),
  countrycodes: z.string().trim().max(20).optional(),
});

router.get(
  '/',
  publicTokenLimiter,
  asyncHandler(hostAccountAuth),
  validate({ query: querySchema }),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { q, limit, countrycodes } = req.query as unknown as z.infer<typeof querySchema>;
    const results = await geocodeService.search(q, { limit, countrycodes });
    res.status(200).json({ data: results });
  }),
);

export default router;
