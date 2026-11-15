import { UnauthorizedError } from '../errors';
import { hostRepository } from '../repositories/host.repository';
import { UpdateProfileBody } from '../schemas/host.schemas';
import { HostWithProfile, UpdateHostProfileInput } from '../types/host.types';

/**
 * Perfil do anfitrião.
 *
 * `birth_date` é opcional e não bloqueia a criação de eventos. O
 * serviço limita-se a persistir o valor já validado (data de
 * calendário, passada, idade mínima) e a devolver a conta completa.
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

    await hostRepository.updateProfile(hostId, changes);

    return this.get(hostId);
  },

  async setAvatar(hostId: string, avatarUrl: string): Promise<HostWithProfile> {
    await hostRepository.updateProfile(hostId, { avatarUrl });
    return this.get(hostId);
  },
};
