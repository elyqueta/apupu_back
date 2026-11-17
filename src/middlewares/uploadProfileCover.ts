import { NextFunction, Request, Response } from 'express';
import multer, { MulterError } from 'multer';
import { env } from '../config/env';
import { ValidationError } from '../errors';

/**
 * Upload da imagem de capa do perfil em multipart/form-data, campo
 * `cover`.
 *
 * O ficheiro é mantido em memória (limite `PROFILE_COVER_MAX_BYTES`)
 * e enviado directamente para o Cloudinary. Nada é escrito no disco
 * local, pelo que não há ficheiros temporários para limpar.
 */
const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.PROFILE_COVER_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (ACCEPTED_TYPES.has(file.mimetype)) {
      callback(null, true);
      return;
    }

    callback(
      new ValidationError('Verifique os campos indicados.', {
        cover: ['A imagem de capa tem de ser JPEG, PNG ou WebP.'],
      })
    );
  },
}).single('cover');

function maxSizeLabel(): string {
  const mib = env.PROFILE_COVER_MAX_BYTES / (1024 * 1024);
  return `${Number.isInteger(mib) ? mib : mib.toFixed(1)} MiB`;
}

export function uploadProfileCover(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  upload(req, res, (error: unknown) => {
    if (error instanceof MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        next(
          new ValidationError('Verifique os campos indicados.', {
            cover: [`A imagem de capa não pode exceder ${maxSizeLabel()}.`],
          })
        );
        return;
      }

      next(
        new ValidationError('Verifique os campos indicados.', {
          cover: ['Não foi possível processar o ficheiro enviado.'],
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
          cover: ['Envia uma imagem no campo `cover`.'],
        })
      );
      return;
    }

    next();
  });
}
