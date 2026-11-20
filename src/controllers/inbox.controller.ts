import { Request, Response } from 'express';
import { toHostGuestDto } from '../dto/invitation.dto';
import { InboxAnswerBody, InboxQuery, InboxReadBody } from '../schemas/inbox.schemas';
import { inboxService } from '../services/inbox.service';
import { EventAccessScope } from '../types/event.types';

function scope(req: Request): EventAccessScope {
  if (!req.hostAccount) throw new Error('Falta o middleware hostAccountAuth.');
  return {
    hostId: req.hostAccount.id,
    managerEmail: req.hostAccount.emailVerifiedAt ? req.hostAccount.email : null,
  };
}

/** Caixa de entrada de mensagens de convidados (Parte F). */
export const inboxController = {
  list: async (req: Request, res: Response): Promise<void> => {
    const result = await inboxService.list(scope(req), req.query as unknown as InboxQuery);
    res.status(200).json({
      data: result.items.map(toHostGuestDto),
      pagination: result.pagination,
    });
  },

  setRead: async (req: Request, res: Response): Promise<void> => {
    const { read } = req.body as InboxReadBody;
    const invitation = await inboxService.setRead(
      scope(req),
      req.params.invitationId ?? '',
      read
    );
    res.status(200).json({
      data: invitation ? { id: invitation.id, message_read_at: invitation.messageReadAt } : null,
    });
  },

  answer: async (req: Request, res: Response): Promise<void> => {
    const { answer } = req.body as InboxAnswerBody;
    const invitation = await inboxService.answer(scope(req), req.params.invitationId ?? '', answer);
    res.status(200).json({
      data: {
        id: invitation?.id,
        message_answer: invitation?.messageAnswer,
        message_answered_at: invitation?.messageAnsweredAt,
      },
    });
  },
};
