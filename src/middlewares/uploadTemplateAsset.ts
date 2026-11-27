import { NextFunction, Request, Response } from 'express';
import multer, { MulterError } from 'multer';
import { env } from '../config/env';
import { ValidationError } from '../errors';

/**
 * Upload de asset de template (logótipo ou imagem de QR) em multipart/form-data,
 * campo `file`. O ficheiro fica em memória e é enviado para o Cloudinary.
 */
const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.TEMPLATE_ASSET_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (ACCEPTED_TYPES.has(file.mimetype)) {
      callback(null, true);
      return;
    }

    callback(
      new ValidationError('Verifique os campos indicados.', {
        file: ['O ficheiro tem de ser JPEG, PNG, WebP ou SVG.'],
      })
    );
  },
}).single('file');

function maxSizeLabel(): string {
  const mib = env.TEMPLATE_ASSET_MAX_BYTES / (1024 * 1024);
  return `${Number.isInteger(mib) ? mib : mib.toFixed(1)} MiB`;
}

export function uploadTemplateAsset(req: Request, res: Response, next: NextFunction): void {
  upload(req, res, (error: unknown) => {
    if (error instanceof MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        next(
          new ValidationError('Verifique os campos indicados.', {
            file: [`O ficheiro não pode exceder ${maxSizeLabel()}.`],
          })
        );
        return;
      }

      next(
        new ValidationError('Verifique os campos indicados.', {
          file: ['Não foi possível processar o ficheiro enviado.'],
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
          file: ['Envia uma imagem no campo `file`.'],
        })
      );
      return;
    }

    next();
  });
}
