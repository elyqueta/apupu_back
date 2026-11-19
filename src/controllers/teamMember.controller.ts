import { Request, Response } from 'express';
import {
  toAddTeamMembersDto,
  toTeamMemberDto,
  toUpdateMemberRoleDto,
} from '../dto/teamMember.dto';
import {
  AddTeamMembersBody,
  TeamMemberListQuery,
  UpdateTeamMemberRoleBody,
} from '../schemas/team.schemas';
import { teamMemberService } from '../services/teamMember.service';
import { EventAccessScope } from '../types/event.types';

function accessScope(req: Request): EventAccessScope {
  if (!req.hostAccount) {
    throw new Error('Conta não resolvida: falta o middleware hostAccountAuth.');
  }

  return {
    hostId: req.hostAccount.id,
    managerEmail: req.hostAccount.emailVerifiedAt ? req.hostAccount.email : null,
  };
}

export const teamMemberController = {
  list: async (req: Request, res: Response): Promise<void> => {
    const result = await teamMemberService.list(
      accessScope(req),
      req.params.teamId ?? '',
      req.query as unknown as TeamMemberListQuery
    );

    res.status(200).json({
      data: result.items.map(toTeamMemberDto),
      pagination: result.pagination,
    });
  },

  add: async (req: Request, res: Response): Promise<void> => {
    const result = await teamMemberService.add(
      accessScope(req),
      req.params.teamId ?? '',
      req.body as AddTeamMembersBody
    );

    res.status(201).json(toAddTeamMembersDto(result));
  },

  updateRole: async (req: Request, res: Response): Promise<void> => {
    const result = await teamMemberService.updateRole(
      accessScope(req),
      req.params.teamId ?? '',
      req.params.memberId ?? '',
      req.body as UpdateTeamMemberRoleBody
    );

    res.status(200).json({ data: toUpdateMemberRoleDto(result) });
  },

  remove: async (req: Request, res: Response): Promise<void> => {
    const result = await teamMemberService.remove(
      accessScope(req),
      req.params.teamId ?? '',
      req.params.memberId ?? '',
      req.query
    );

    res.status(200).json({
      data: {
        removed: result.removed,
        reassigned_tasks: result.reassignedTasks,
      },
    });
  },
};
