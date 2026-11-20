import { createHash } from 'node:crypto';
import { env } from '../config/env';
import {
  isCloudinaryConfigured,
  uploadImage,
  UploadedImage,
} from './cloudinary.service';

/**
 * Upload de avatares para o Cloudinary.
 *
 * O pedido é assinado no servidor: o frontend envia apenas o ficheiro
 * e o `CLOUDINARY_API_SECRET` nunca sai do backend.
 *
 * Sem as três variáveis (`CLOUDINARY_CLOUD_NAME`,
 * `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`) o upload responde
 * `503 avatar_upload_unavailable`; o resto da API, incluindo o avatar
 * por URL, continua a funcionar.
 */
export type UploadedAvatar = UploadedImage;

export function isAvatarUploadConfigured(): boolean {
  return isCloudinaryConfigured();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extrai o `public_id` de um URL de avatar produzido por `uploadImage`.
 * URLs de outros provedores (ou de outro cloud) devolvem `null` e não
 * são apagados — não nos pertencem.
 */
export function avatarPublicIdFromUrl(avatarUrl: string | null): string | null {
  if (!avatarUrl) return null;

  const cloudName = env.CLOUDINARY_CLOUD_NAME?.trim();
  if (!cloudName) return null;

  const folder = env.CLOUDINARY_AVATAR_FOLDER.trim();
  if (!/^[A-Za-z0-9_-]+$/.test(cloudName) || !/^[A-Za-z0-9_/-]+$/.test(folder)) {
    return null;
  }

  const pattern = new RegExp(
    `^https://res\\.cloudinary\\.com/${cloudName}/image/upload/` +
      `(?:v[0-9]+/)?${escapeRegExp(folder)}/([^/?#]+)$`
  );
  const match = pattern.exec(avatarUrl);
  const publicId = match?.[1];
  if (!publicId) return null;

  return publicId.replace(/\.[^.]+$/, '');
}

/** Hash do ficheiro, usado para tornar o upload idempotente. */
export function avatarFileHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export const avatarService = {
  async upload(buffer: Buffer, contentType: string): Promise<UploadedAvatar> {
    return uploadImage(buffer, contentType, {
      folder: env.CLOUDINARY_AVATAR_FOLDER,
      unavailableMessage: 'O upload de avatar não está configurado.',
      unavailableCode: 'avatar_upload_unavailable',
    });
  },
};
