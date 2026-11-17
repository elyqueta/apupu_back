import { createHash } from 'node:crypto';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { ServiceUnavailableError } from '../errors';

/**
 * Integração mínima com o Cloudinary.
 *
 * A assinatura é feita no servidor; o `CLOUDINARY_API_SECRET` nunca
 * sai do backend. Sem as três variáveis de configuração, os uploads
 * respondem com o erro indicado pelo chamador e o resto da API
 * continua a funcionar.
 */
export interface UploadedImage {
  url: string;
  publicId: string | null;
}

interface CloudinaryResponse {
  secure_url?: unknown;
  url?: unknown;
  public_id?: unknown;
  result?: unknown;
  error?: { message?: unknown };
}

export interface UploadOptions {
  folder: string;
  unavailableMessage: string;
  unavailableCode: string;
}

export function isCloudinaryConfigured(): boolean {
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

function cloudName(): string {
  return encodeURIComponent(env.CLOUDINARY_CLOUD_NAME ?? '');
}

export async function uploadImage(
  buffer: Buffer,
  contentType: string,
  options: UploadOptions
): Promise<UploadedImage> {
  const apiKey = env.CLOUDINARY_API_KEY;
  const apiSecret = env.CLOUDINARY_API_SECRET;

  if (!isCloudinaryConfigured() || !apiKey || !apiSecret) {
    throw new ServiceUnavailableError(
      options.unavailableMessage,
      options.unavailableCode
    );
  }

  const timestamp = String(Math.floor(Date.now() / 1000));
  const params = { folder: options.folder, timestamp };

  const form = new FormData();
  form.append('file', new Blob([buffer], { type: contentType }));
  form.append('api_key', apiKey);
  form.append('timestamp', timestamp);
  form.append('folder', params.folder);
  form.append('signature', signature(params, apiSecret));

  let response: Response;
  try {
    response = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName()}/image/upload`,
      {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(20_000),
      }
    );
  } catch (error) {
    logger.error({ err: error }, 'Falha de rede no upload para o Cloudinary.');
    throw new ServiceUnavailableError(
      options.unavailableMessage,
      options.unavailableCode
    );
  }

  const body = (await response.json().catch(() => ({}))) as CloudinaryResponse;

  if (!response.ok) {
    const detail =
      typeof body.error?.message === 'string' ? body.error.message : 'sem detalhe';
    logger.error(
      { status: response.status, detail },
      'Cloudinary recusou um upload de imagem.'
    );
    throw new ServiceUnavailableError(
      options.unavailableMessage,
      options.unavailableCode
    );
  }

  const url = typeof body.secure_url === 'string' ? body.secure_url : body.url;

  if (typeof url !== 'string') {
    logger.error({ status: response.status }, 'Cloudinary devolveu um upload sem URL.');
    throw new ServiceUnavailableError(
      options.unavailableMessage,
      options.unavailableCode
    );
  }

  return {
    url,
    publicId: typeof body.public_id === 'string' ? body.public_id : null,
  };
}

/**
 * Remove um asset antigo. Uma falha é registada mas nunca impede a
 * actualização da base de dados: o utilizador já tem a nova imagem.
 */
export async function destroyImage(publicId: string | null): Promise<void> {
  const apiKey = env.CLOUDINARY_API_KEY;
  const apiSecret = env.CLOUDINARY_API_SECRET;

  if (!publicId || !isCloudinaryConfigured() || !apiKey || !apiSecret) {
    return;
  }

  const timestamp = String(Math.floor(Date.now() / 1000));
  const params = { public_id: publicId, timestamp };
  const form = new FormData();

  form.append('public_id', publicId);
  form.append('timestamp', timestamp);
  form.append('api_key', apiKey);
  form.append('signature', signature(params, apiSecret));

  try {
    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName()}/image/destroy`,
      {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(10_000),
      }
    );

    if (!response.ok) {
      logger.warn(
        { status: response.status, public_id: publicId },
        'Cloudinary não removeu o asset antigo.'
      );
    }
  } catch (error) {
    logger.warn({ err: error, public_id: publicId }, 'Falha ao remover asset no Cloudinary.');
  }
}
