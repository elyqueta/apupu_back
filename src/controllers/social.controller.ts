import { Request, Response } from 'express';
import { hostRepository } from '../repositories/host.repository';
import { FeedType, socialService } from '../services/social.service';

function viewerId(req: Request): string {
  if (!req.hostAccount) throw new Error('Conta não resolvida: falta o middleware hostAccountAuth.');
  return req.hostAccount.id;
}

async function viewerName(req: Request): Promise<string> {
  const host = await hostRepository.findById(viewerId(req));
  return host?.profile.displayName?.trim() || 'Alguém';
}

export const socialController = {
  feed: async (req: Request, res: Response): Promise<void> => {
    const query = req.query as unknown as { type: FeedType; q?: string; category?: string; cursor?: string };
    res.status(200).json({ data: await socialService.feed(query) });
  },

  search: async (req: Request, res: Response): Promise<void> => {
    res.status(200).json({ data: await socialService.search(String(req.query.q ?? '')) });
  },

  publicProfile: async (req: Request, res: Response): Promise<void> => {
    res.status(200).json({ data: await socialService.publicProfile(req.params.id ?? '') });
  },

  publicCommunity: async (req: Request, res: Response): Promise<void> => {
    res.status(200).json({ data: await socialService.publicCommunity(req.params.slug ?? '') });
  },

  profile: async (req: Request, res: Response): Promise<void> => {
    res.status(200).json({ data: await socialService.profile(req.params.id ?? '', viewerId(req)) });
  },

  profileEvents: async (req: Request, res: Response): Promise<void> => {
    const { past, cursor } = req.query as unknown as { past: boolean; cursor?: string };
    res.status(200).json({
      data: await socialService.profileEvents(req.params.id ?? '', viewerId(req), past, cursor),
    });
  },

  communityEvents: async (req: Request, res: Response): Promise<void> => {
    const { past, cursor } = req.query as unknown as { past: boolean; cursor?: string };
    res.status(200).json({ data: await socialService.communityEvents(req.params.slug ?? '', past, cursor) });
  },

  friends: async (req: Request, res: Response): Promise<void> => {
    res.status(200).json({ data: await socialService.list(viewerId(req)) });
  },

  requestFriend: async (req: Request, res: Response): Promise<void> => {
    const id = await socialService.requestFriend(
      { hostId: viewerId(req), name: await viewerName(req) },
      (req.body as { host_id: string }).host_id
    );
    res.status(201).json({ data: { id } });
  },

  respondFriend: async (req: Request, res: Response): Promise<void> => {
    await socialService.respond(
      { hostId: viewerId(req), name: await viewerName(req) },
      req.params.id ?? '',
      (req.body as { accept: boolean }).accept
    );
    res.status(200).json({ data: { ok: true } });
  },

  removeFriend: async (req: Request, res: Response): Promise<void> => {
    await socialService.remove(viewerId(req), req.params.id ?? '');
    res.status(204).send();
  },
};
