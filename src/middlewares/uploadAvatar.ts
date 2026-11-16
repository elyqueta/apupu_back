import { NextFunction, Request, Response } from 'express';
import multer, { MulterError } from 'multer';
import { env } from '../config/env';
import { ValidationError } from '../errors';

/**
 * Upload do avatar em multipart/form-data, campo `avatar`.
 *
 * O ficheiro é mantido em memória (limite `AVATAR_MAX_BYTES`) e
 * enviado directamente para o Cloudinary. Nada é escrito no disco
 * local, pelo que não há ficheiros temporários para limpar.
 */
const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.AVATAR_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (ACCEPTED_TYPES.has(file.mimetype)) {
      callback(null, true);
      return;
    }

    callback(
      new ValidationError('Verifique os campos indicados.', {
        avatar: ['O avatar tem de ser uma imagem JPEG, PNG ou WebP.'],
      })
    );
  },
}).single('avatar');

function maxSizeLabel(): string {
  const mib = env.AVATAR_MAX_BYTES / (1024 * 1024);
  return `${Number.isInteger(mib) ? mib : mib.toFixed(1)} MiB`;
}

export function uploadAvatar(req: Request, res: Response, next: NextFunction): void {
  upload(req, res, (error: unknown) => {
    if (error instanceof MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        next(
          new ValidationError('Verifique os campos indicados.', {
            avatar: [`O avatar não pode exceder ${maxSizeLabel()}.`],
          })
        );
        return;
      }

      next(
        new ValidationError('Verifique os campos indicados.', {
          avatar: ['Não foi possível processar o ficheiro enviado.'],
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
          avatar: ['Envia uma imagem no campo `avatar`.'],
        })
      );
      return;
    }

    next();
  });
}
