import { NextFunction, Request, Response } from 'express';
import multer, { MulterError } from 'multer';
import { env } from '../config/env';
import { ValidationError } from '../errors';

/**
 * Upload de imagem em multipart/form-data para entidades com avatar e capa
 * (comunidades e instituições). O ficheiro fica em memória e é enviado
 * directamente para o Cloudinary, sem ficheiros temporários no disco.
 */
const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

interface Options {
  field: string;
  maxBytes: number;
}

function maxSizeLabel(maxBytes: number): string {
  const mib = maxBytes / (1024 * 1024);
  return `${Number.isInteger(mib) ? mib : mib.toFixed(1)} MiB`;
}

function imageUpload({ field, maxBytes }: Options) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: 1 },
    fileFilter: (_req, file, callback) => {
      if (ACCEPTED_TYPES.has(file.mimetype)) {
        callback(null, true);
        return;
      }

      callback(
        new ValidationError('Verifique os campos indicados.', {
          [field]: ['A imagem tem de ser JPEG, PNG ou WebP.'],
        })
      );
    },
  }).single(field);

  return (req: Request, res: Response, next: NextFunction): void => {
    upload(req, res, (error: unknown) => {
      if (error instanceof MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
          next(
            new ValidationError('Verifique os campos indicados.', {
              [field]: [`A imagem não pode exceder ${maxSizeLabel(maxBytes)}.`],
            })
          );
          return;
        }

        next(
          new ValidationError('Verifique os campos indicados.', {
            [field]: ['Não foi possível processar o ficheiro enviado.'],
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
            [field]: [`Envia uma imagem no campo \`${field}\`.`],
          })
        );
        return;
      }

      next();
    });
  };
}

export const uploadCommunityAvatar = imageUpload({
  field: 'avatar',
  maxBytes: env.COMMUNITY_IMAGE_MAX_BYTES,
});

export const uploadCommunityCover = imageUpload({
  field: 'cover',
  maxBytes: env.COMMUNITY_IMAGE_MAX_BYTES,
});

export const uploadInstitutionAvatar = imageUpload({
  field: 'avatar',
  maxBytes: env.INSTITUTION_IMAGE_MAX_BYTES,
});

export const uploadInstitutionCover = imageUpload({
  field: 'cover',
  maxBytes: env.INSTITUTION_IMAGE_MAX_BYTES,
});
