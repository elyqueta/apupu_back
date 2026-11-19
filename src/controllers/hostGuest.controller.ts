import { Request, Response } from 'express';
import { toHostGuestDto } from '../dto/invitation.dto';
import { TeamGuestDto } from '../dto/team.dto';
import { HostGuestsQuery } from '../schemas/host.schemas';
import { hostGuestService } from '../services/hostGuest.service';
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

function toTeamGuestDto(candidate: {
  invitationId: string;
  eventId: string;
  eventTitle: string;
  eventStartsAt: Date | null;
  eventStatus: string;
  guestName: string;
  guestEmail: string;
  hasEmail: boolean;
  isMember: boolean;
  memberId: string | null;
}): TeamGuestDto {
  return {
    invitation_id: candidate.invitationId,
    event_id: candidate.eventId,
    event_title: candidate.eventTitle,
    event_starts_at: candidate.eventStartsAt?.toISOString() ?? null,
    event_status: candidate.eventStatus,
    guest_name: candidate.guestName,
    guest_email: candidate.guestEmail,
    has_email: candidate.hasEmail,
    is_member: candidate.isMember,
    member_id: candidate.memberId,
  };
}

export const hostGuestController = {
  list: async (req: Request, res: Response): Promise<void> => {
    const result = await hostGuestService.list(
      accessScope(req),
      req.query as unknown as HostGuestsQuery
    );

    if (result.mode === 'team') {
      res.status(200).json({
        team_id: result.teamId,
        data: result.items.map(toTeamGuestDto),
        pagination: result.pagination,
      });
      return;
    }

    res.status(200).json({
      data: result.items.map(toHostGuestDto),
      pagination: result.pagination,
    });
  },
};
