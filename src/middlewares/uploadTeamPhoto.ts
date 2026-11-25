import { NextFunction, Request, Response } from 'express';
import multer, { MulterError } from 'multer';
import { env } from '../config/env';
import { ValidationError } from '../errors';

const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.TEAM_PHOTO_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (ACCEPTED_TYPES.has(file.mimetype)) {
      callback(null, true);
      return;
    }

    callback(
      new ValidationError('Verifique os campos indicados.', {
        photo: ['A foto da equipa tem de ser JPEG, PNG ou WebP.'],
      })
    );
  },
}).single('photo');

function maxSizeLabel(): string {
  const mib = env.TEAM_PHOTO_MAX_BYTES / (1024 * 1024);
  return `${Number.isInteger(mib) ? mib : mib.toFixed(1)} MiB`;
}

export function uploadTeamPhoto(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  upload(req, res, (error: unknown) => {
    if (error instanceof MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        next(
          new ValidationError('Verifique os campos indicados.', {
            photo: [`A foto da equipa não pode exceder ${maxSizeLabel()}.`],
          })
        );
        return;
      }

      next(
        new ValidationError('Verifique os campos indicados.', {
          photo: ['Não foi possível processar o ficheiro enviado.'],
        })
      );
      return;
    }

    if (error) {
      next(error);
      return;
    }

    if (!req.file) {
      next(
        new ValidationError('Verifique os campos indicados.', {
          photo: ['Envia uma imagem no campo `photo`.'],
        })
      );
      return;
    }

    next();
  });
}
