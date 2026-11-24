import { Request, Response } from 'express';
import {
  toCommunityDetailDto,
  toCommunityDto,
  toCommunityMemberDto,
  toJoinRequestDto,
  toReferralDto,
  toTransferDto,
} from '../dto/community.dto';
import {
  CreateCommunityBody,
  InviteCommunityMemberBody,
  UpdateCommunityBody,
} from '../schemas/community.schemas';
import { auditService } from '../services/audit.service';
import { communityService, Viewer } from '../services/community.service';

function viewer(req: Request): Viewer {
  if (!req.hostAccount) {
    throw new Error('Conta não resolvida: falta o middleware hostAccountAuth.');
  }
  return { hostId: req.hostAccount.id, email: req.hostAccount.email };
}

const id = (req: Request): string => req.params.communityId ?? '';

export const communityController = {
  list: async (req: Request, res: Response): Promise<void> => {
    const { q, scope } = req.query as { q?: string; scope?: 'mine' | 'discover' };
    const items =
      scope === 'discover'
        ? await communityService.discover(viewer(req), q)
        : await communityService.list(viewer(req), q);
    res.status(200).json({ data: items.map(toCommunityDto) });
  },

  get: async (req: Request, res: Response): Promise<void> => {
    const me = viewer(req);
    const detail = await communityService.detail(me, id(req));
    res.status(200).json({ data: toCommunityDetailDto(detail, me.hostId) });
  },

  create: async (req: Request, res: Response): Promise<void> => {
    const me = viewer(req);
    const community = await communityService.create(me, req.body as CreateCommunityBody);
    await auditService.recordRequest(req, {
      action: 'community_created',
      hostId: me.hostId,
      metadata: { community_id: community.id, visibility: community.visibility },
    });
    res.status(201).json({ data: toCommunityDto(community) });
  },

  update: async (req: Request, res: Response): Promise<void> => {
    const me = viewer(req);
    const body = req.body as UpdateCommunityBody;
    const community = await communityService.update(me, id(req), body);
    await auditService.recordRequest(req, {
      action: 'community_updated',
      hostId: me.hostId,
      metadata: { community_id: community.id, fields: Object.keys(body) },
    });
    res.status(200).json({ data: toCommunityDto(community) });
  },

  remove: async (req: Request, res: Response): Promise<void> => {
    const me = viewer(req);
    const community = await communityService.remove(
      me,
      id(req),
      (req.body as { confirm_name: string }).confirm_name
    );
    await auditService.recordRequest(req, {
      action: 'community_deleted',
      hostId: me.hostId,
      metadata: { community_id: community.id },
    });
    res.status(204).send();
  },

  invite: async (req: Request, res: Response): Promise<void> => {
    const me = viewer(req);
    const member = await communityService.invite(me, id(req), req.body as InviteCommunityMemberBody);
    await auditService.recordRequest(req, {
      action: 'community_member_invited',
      hostId: me.hostId,
      metadata: { community_id: member.communityId, role: member.role },
    });
    res.status(201).json({ data: toCommunityMemberDto(member, true) });
  },

  answerInvite: async (req: Request, res: Response): Promise<void> => {
    await communityService.answerInvite(viewer(req), id(req), (req.body as { accept: boolean }).accept);
    res.status(204).send();
  },

  removeMember: async (req: Request, res: Response): Promise<void> => {
    const me = viewer(req);
    const member = await communityService.removeMember(me, id(req), req.params.memberId ?? '');
    await auditService.recordRequest(req, {
      action: 'community_member_removed',
      hostId: me.hostId,
      metadata: { community_id: member.communityId, role: member.role },
    });
    res.status(204).send();
  },

  leave: async (req: Request, res: Response): Promise<void> => {
    const me = viewer(req);
    await communityService.leave(me, id(req));
    await auditService.recordRequest(req, {
      action: 'community_member_left',
      hostId: me.hostId,
      metadata: { community: id(req) },
    });
    res.status(204).send();
  },

  changeRole: async (req: Request, res: Response): Promise<void> => {
    const me = viewer(req);
    const member = await communityService.changeRole(
      me,
      id(req),
      req.params.memberId ?? '',
      (req.body as { role: 'manager' | 'member' }).role
    );
    await auditService.recordRequest(req, {
      action: 'community_role_changed',
      hostId: me.hostId,
      metadata: { community_id: member.communityId, role: member.role },
    });
    res.status(200).json({ data: toCommunityMemberDto(member, true) });
  },

  requestToJoin: async (req: Request, res: Response): Promise<void> => {
    const body = (req.body ?? {}) as { message?: string | null };
    const request = await communityService.requestToJoin(viewer(req), id(req), body.message?.trim() || null);
    res.status(201).json({ data: toJoinRequestDto(request) });
  },

  cancelJoinRequest: async (req: Request, res: Response): Promise<void> => {
    await communityService.cancelJoinRequest(viewer(req), id(req));
    res.status(204).send();
  },

  listJoinRequests: async (req: Request, res: Response): Promise<void> => {
    const items = await communityService.listJoinRequests(viewer(req), id(req));
    res.status(200).json({ data: items.map(toJoinRequestDto) });
  },

  decideJoinRequest: async (req: Request, res: Response): Promise<void> => {
    const me = viewer(req);
    const approve = (req.body as { decision: 'approve' | 'reject' }).decision === 'approve';
    const request = await communityService.decideJoinRequest(me, id(req), req.params.requestId ?? '', approve);
    await auditService.recordRequest(req, {
      action: 'community_join_decided',
      hostId: me.hostId,
      metadata: { community_id: request.communityId, decision: approve ? 'approved' : 'rejected' },
    });
    res.status(200).json({ data: toJoinRequestDto(request) });
  },

  startTransfer: async (req: Request, res: Response): Promise<void> => {
    const me = viewer(req);
    const transfer = await communityService.startTransfer(
      me,
      id(req),
      (req.body as { member_id: string }).member_id
    );
    await auditService.recordRequest(req, {
      action: 'community_transfer_started',
      hostId: me.hostId,
      metadata: { community_id: transfer.communityId },
    });
    res.status(202).json({ data: toTransferDto(transfer, me.hostId) });
  },

  verifyTransfer: async (req: Request, res: Response): Promise<void> => {
    const me = viewer(req);
    const transfer = await communityService.verifyTransferOtp(me, id(req), (req.body as { code: string }).code);
    res.status(200).json({ data: toTransferDto(transfer, me.hostId) });
  },

  acceptTransfer: async (req: Request, res: Response): Promise<void> => {
    const me = viewer(req);
    const transfer = await communityService.acceptTransfer(me, id(req));
    await auditService.recordRequest(req, {
      action: 'community_transfer_completed',
      hostId: me.hostId,
      metadata: { community_id: transfer.communityId, from_host_id: transfer.fromHostId },
    });
    res.status(200).json({ data: toTransferDto(transfer, me.hostId) });
  },

  cancelTransfer: async (req: Request, res: Response): Promise<void> => {
    const me = viewer(req);
    await communityService.cancelTransfer(me, id(req));
    await auditService.recordRequest(req, {
      action: 'community_transfer_cancelled',
      hostId: me.hostId,
      metadata: { community: id(req) },
    });
    res.status(204).send();
  },

  referrals: async (req: Request, res: Response): Promise<void> => {
    const items = await communityService.referrals(viewer(req), id(req));
    res.status(200).json({ data: items.map(toReferralDto) });
  },
};
