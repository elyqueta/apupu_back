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

export const avatarService = {
  async upload(buffer: Buffer, contentType: string): Promise<UploadedAvatar> {
    return uploadImage(buffer, contentType, {
      folder: env.CLOUDINARY_AVATAR_FOLDER,
      unavailableMessage: 'O upload de avatar não está configurado.',
      unavailableCode: 'avatar_upload_unavailable',
    });
  },
};
