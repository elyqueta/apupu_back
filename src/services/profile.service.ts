import { createHash } from 'node:crypto';
import { env } from '../config/env';
import { UnauthorizedError } from '../errors';
import { hostRepository } from '../repositories/host.repository';
import { UpdateProfileBody } from '../schemas/host.schemas';
import { HostWithProfile, UpdateHostProfileInput } from '../types/host.types';
import { destroyImage, uploadImage } from './cloudinary.service';

/**
 * Perfil do anfitrião.
 *
 * `birth_date` é opcional e não bloqueia a criação de eventos. O
 * serviço limita-se a persistir o valor já validado (data de
 * calendário, passada, idade mínima) e a devolver a conta completa.
 *
 * A imagem de capa segue o mesmo padrão da capa de evento: URL
 * directo ou upload assinado para o Cloudinary, com idempotência por
 * SHA-256 e remoção do asset antigo.
 */
export const profileService = {
  async get(hostId: string): Promise<HostWithProfile> {
    const host = await hostRepository.findById(hostId);

    if (!host || host.status !== 'active') {
      throw new UnauthorizedError('Sessão inválida ou expirada.', 'host_session_invalid');
    }

    return host;
  },

  async update(hostId: string, input: UpdateProfileBody): Promise<HostWithProfile> {
    const changes: UpdateHostProfileInput = {};

    if ('display_name' in input) changes.displayName = input.display_name ?? null;
    if ('phone' in input) changes.phone = input.phone ?? null;
    if ('birth_date' in input) changes.birthDate = input.birth_date ?? null;
    if (input.locale !== undefined) changes.locale = input.locale;
    if (input.timezone !== undefined) changes.timezone = input.timezone;
    if ('avatar_url' in input) changes.avatarUrl = input.avatar_url ?? null;
    if ('cover_url' in input) changes.coverUrl = input.cover_url ?? null;

    await hostRepository.updateProfile(hostId, changes);

    return this.get(hostId);
  },

  async setAvatar(hostId: string, avatarUrl: string): Promise<HostWithProfile> {
    await hostRepository.updateProfile(hostId, { avatarUrl });
    return this.get(hostId);
  },

  /** Define a capa por URL. Repetir o mesmo URL é idempotente. */
  async setCoverFromUrl(hostId: string, coverUrl: string): Promise<HostWithProfile> {
    const host = await this.get(hostId);

    if (host.profile.coverUrl === coverUrl && !host.profile.coverPublicId) {
      return host;
    }

    const previousPublicId = host.profile.coverPublicId;
    await hostRepository.updateProfile(hostId, {
      coverUrl,
      coverHash: null,
      coverPublicId: null,
    });
    await destroyImage(previousPublicId);

    return this.get(hostId);
  },

  /**
   * Upload com idempotência por conteúdo: o mesmo ficheiro (SHA-256)
   * não volta a ser enviado para o Cloudinary.
   */
  async uploadCover(
    hostId: string,
    buffer: Buffer,
    contentType: string
  ): Promise<HostWithProfile> {
    const host = await this.get(hostId);
    const hash = createHash('sha256').update(buffer).digest('hex');

    if (host.profile.coverHash === hash && host.profile.coverUrl) {
      return host;
    }

    const uploaded = await uploadImage(buffer, contentType, {
      folder: env.CLOUDINARY_PROFILE_COVER_FOLDER,
      unavailableMessage: 'O upload da imagem de capa não está configurado.',
      unavailableCode: 'profile_cover_upload_unavailable',
    });

    const previousPublicId = host.profile.coverPublicId;
    await hostRepository.updateProfile(hostId, {
      coverUrl: uploaded.url,
      coverHash: hash,
      coverPublicId: uploaded.publicId,
    });

    if (previousPublicId && previousPublicId !== uploaded.publicId) {
      await destroyImage(previousPublicId);
    }

    return this.get(hostId);
  },

  /** Remove a capa. Repetir a remoção é idempotente. */
  async removeCover(hostId: string): Promise<HostWithProfile> {
    const host = await this.get(hostId);
    const { coverUrl, coverHash, coverPublicId } = host.profile;

    if (!coverUrl && !coverHash && !coverPublicId) {
      return host;
    }

    await hostRepository.updateProfile(hostId, {
      coverUrl: null,
      coverHash: null,
      coverPublicId: null,
    });
    await destroyImage(coverPublicId);

    return this.get(hostId);
  },
};
