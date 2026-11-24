import { Request, Response } from 'express';
import { auditService } from '../services/audit.service';
import { InstitutionViewer, institutionService } from '../services/institution.service';

function viewer(req: Request): InstitutionViewer {
  if (!req.hostAccount) throw new Error('Conta não resolvida: falta o middleware hostAccountAuth.');
  return { hostId: req.hostAccount.id, email: req.hostAccount.email };
}

const id = (req: Request): string => req.params.institutionId ?? '';
const requestId = (req: Request): string => req.params.requestId ?? '';

export const institutionController = {
  list: async (req: Request, res: Response): Promise<void> => {
    const { scope, q } = req.query as unknown as { scope: 'mine' | 'discover'; q?: string };
    res.status(200).json({ data: await institutionService.list(viewer(req), scope, q) });
  },

  myRequests: async (req: Request, res: Response): Promise<void> => {
    res.status(200).json({ data: await institutionService.myRequests(viewer(req)) });
  },

  get: async (req: Request, res: Response): Promise<void> => {
    res.status(200).json({ data: await institutionService.detail(id(req), viewer(req)) });
  },

  create: async (req: Request, res: Response): Promise<void> => {
    const me = viewer(req);
    const institution = await institutionService.create(me, req.body as never);
    await auditService.recordRequest(req, { action: 'institution_created', hostId: me.hostId, metadata: { institution_id: institution.id } });
    res.status(201).json({ data: institution });
  },

  update: async (req: Request, res: Response): Promise<void> => {
    const me = viewer(req);
    const institution = await institutionService.update(id(req), me, req.body as never);
    await auditService.recordRequest(req, {
      action: 'institution_updated',
      hostId: me.hostId,
      metadata: { institution_id: institution.id, fields: Object.keys(req.body as object) },
    });
    res.status(200).json({ data: institution });
  },

  remove: async (req: Request, res: Response): Promise<void> => {
    const me = viewer(req);
    await institutionService.remove(id(req), me, (req.body as { confirm_name: string }).confirm_name);
    await auditService.recordRequest(req, { action: 'institution_deleted', hostId: me.hostId, metadata: { institution: id(req) } });
    res.status(204).send();
  },

  requestFromCommunity: async (req: Request, res: Response): Promise<void> => {
    const me = viewer(req);
    const request = await institutionService.requestFromCommunity(id(req), me, (req.body as { community_id: string }).community_id);
    await auditService.recordRequest(req, {
      action: 'institution_link_requested',
      hostId: me.hostId,
      metadata: { request_id: request.id, direction: request.direction },
    });
    res.status(201).json({ data: request });
  },

  inviteCommunity: async (req: Request, res: Response): Promise<void> => {
    const me = viewer(req);
    const request = await institutionService.inviteCommunity(id(req), me, (req.body as { community_id: string }).community_id);
    await auditService.recordRequest(req, {
      action: 'institution_link_requested',
      hostId: me.hostId,
      metadata: { request_id: request.id, direction: request.direction },
    });
    res.status(201).json({ data: request });
  },

  acceptInvite: async (req: Request, res: Response): Promise<void> => {
    await institutionService.acceptInvite(requestId(req), viewer(req));
    res.status(200).json({ data: { ok: true } });
  },

  reject: async (req: Request, res: Response): Promise<void> => {
    const me = viewer(req);
    await institutionService.reject(requestId(req), me);
    await auditService.recordRequest(req, { action: 'institution_link_rejected', hostId: me.hostId, metadata: { request_id: requestId(req) } });
    res.status(200).json({ data: { ok: true } });
  },

  startApproval: async (req: Request, res: Response): Promise<void> => {
    res.status(202).json({ data: await institutionService.startApproval(requestId(req), viewer(req)) });
  },

  confirmApproval: async (req: Request, res: Response): Promise<void> => {
    const me = viewer(req);
    const request = await institutionService.confirmApproval(requestId(req), me, (req.body as { code: string }).code);
    await auditService.recordRequest(req, {
      action: request.kind === 'remove' ? 'institution_community_removed' : 'institution_link_approved',
      hostId: me.hostId,
      metadata: { request_id: request.id, community_id: request.community_id },
    });
    res.status(200).json({ data: request });
  },

  startRemoval: async (req: Request, res: Response): Promise<void> => {
    const data = await institutionService.startRemoval(id(req), viewer(req), (req.body as { community_id: string }).community_id);
    res.status(202).json({ data });
  },

  leave: async (req: Request, res: Response): Promise<void> => {
    const me = viewer(req);
    const communityId = (req.body as { community_id: string }).community_id;
    await institutionService.leave(id(req), me, communityId);
    await auditService.recordRequest(req, { action: 'institution_community_left', hostId: me.hostId, metadata: { community_id: communityId } });
    res.status(204).send();
  },
};
