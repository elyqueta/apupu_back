import { createHash } from 'node:crypto';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { ServiceUnavailableError } from '../errors';

/**
 * Upload de avatares para o Cloudinary.
 *
 * O pedido é assinado no servidor: o frontend envia apenas o ficheiro
 * e o `CLOUDINARY_API_SECRET` nunca sai do backend. A assinatura segue
 * a regra do Cloudinary — SHA-1 dos parâmetros ordenados por nome,
 * concatenados como `chave=valor&...` e seguidos do segredo.
 *
 * Sem as três variáveis (`CLOUDINARY_CLOUD_NAME`,
 * `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`) o upload responde
 * `503 avatar_upload_unavailable`; o resto da API, incluindo o avatar
 * por URL, continua a funcionar.
 */
export interface UploadedAvatar {
  url: string;
  publicId: string | null;
}

interface CloudinaryResponse {
  secure_url?: unknown;
  url?: unknown;
  public_id?: unknown;
  error?: { message?: unknown };
}

export function isAvatarUploadConfigured(): boolean {
  return Boolean(
    env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET
  );
}

function signature(params: Record<string, string>, apiSecret: string): string {
  const payload = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');

  return createHash('sha1').update(`${payload}${apiSecret}`).digest('hex');
}

export const avatarService = {
  async upload(buffer: Buffer, contentType: string): Promise<UploadedAvatar> {
    const cloudName = env.CLOUDINARY_CLOUD_NAME;
    const apiKey = env.CLOUDINARY_API_KEY;
    const apiSecret = env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
      throw new ServiceUnavailableError(
        'O upload de avatar não está configurado.',
        'avatar_upload_unavailable'
      );
    }

    const timestamp = String(Math.floor(Date.now() / 1000));
    const params = { folder: env.CLOUDINARY_AVATAR_FOLDER, timestamp };

    const form = new FormData();
    form.append('file', new Blob([buffer], { type: contentType }));
    form.append('api_key', apiKey);
    form.append('timestamp', timestamp);
    form.append('folder', params.folder);
    form.append('signature', signature(params, apiSecret));

    let response: Response;
    try {
      response = await fetch(
        `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`,
        {
          method: 'POST',
          body: form,
          signal: AbortSignal.timeout(20_000),
        }
      );
    } catch (error) {
      logger.error({ err: error }, 'Falha de rede no upload para o Cloudinary.');
      throw new ServiceUnavailableError(
        'O upload de avatar está temporariamente indisponível.',
        'avatar_upload_unavailable'
      );
    }

    const body = (await response.json().catch(() => ({}))) as CloudinaryResponse;

    if (!response.ok) {
      const detail =
        typeof body.error?.message === 'string' ? body.error.message : 'sem detalhe';
      logger.error(
        { status: response.status, detail },
        'Cloudinary recusou o upload de avatar.'
      );
      throw new ServiceUnavailableError(
        'O upload de avatar está temporariamente indisponível.',
        'avatar_upload_unavailable'
      );
    }

    const url = typeof body.secure_url === 'string' ? body.secure_url : body.url;

    if (typeof url !== 'string') {
      logger.error({ status: response.status }, 'Cloudinary devolveu um upload sem URL.');
      throw new ServiceUnavailableError(
        'O upload de avatar está temporariamente indisponível.',
        'avatar_upload_unavailable'
      );
    }

    return {
      url,
      publicId: typeof body.public_id === 'string' ? body.public_id : null,
    };
  },
};
