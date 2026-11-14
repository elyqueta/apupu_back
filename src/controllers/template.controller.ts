import { Request, Response } from 'express';
import { toTemplateDto } from '../dto/invitation.dto';
import { templateService } from '../services/template.service';

export const templateController = {
  /** Lista apenas templates activos, prontos para o formulário de criação. */
  list: async (_req: Request, res: Response): Promise<void> => {
    const templates = await templateService.listActive();

    res.status(200).json({ data: templates.map(toTemplateDto) });
  },
};
