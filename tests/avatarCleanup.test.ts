import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/repositories/host.repository', () => ({
  hostRepository: {
    findById: vi.fn(),
    updateProfile: vi.fn(),
  },
}));

vi.mock('../src/services/cloudinary.service', () => ({
  destroyImage: vi.fn(async () => undefined),
  isCloudinaryConfigured: vi.fn(() => true),
  uploadImage: vi.fn(),
}));

vi.mock('../src/services/avatar.service', () => ({
  avatarFileHash: vi.fn(() => 'novo-hash'),
  avatarPublicIdFromUrl: vi.fn(() => null),
  avatarService: {
    upload: vi.fn(async () => ({
      url: 'https://res.cloudinary.com/demo/image/upload/conta-comigo/avatars/novo.jpg',
      publicId: 'conta-comigo/avatars/novo',
    })),
  },
}));

import { hostRepository } from '../src/repositories/host.repository';
import { destroyImage } from '../src/services/cloudinary.service';
import { profileService } from '../src/services/profile.service';

const hostId = '00000000-0000-4000-8000-000000000010';

const host = {
  id: hostId,
  status: 'active',
  profile: {
    hostId,
    displayName: null,
    phone: null,
    birthDate: null,
    locale: 'pt-AO',
    timezone: 'UTC',
    avatarUrl: 'https://res.cloudinary.com/demo/image/upload/conta-comigo/avatars/antigo.jpg',
    avatarHash: 'hash-antigo',
    avatarPublicId: 'conta-comigo/avatars/antigo',
    coverUrl: null,
    coverHash: null,
    coverPublicId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
};

describe('avatar Cloudinary cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hostRepository.findById).mockResolvedValue(host as never);
  });

  it('apaga o public_id anterior quando o avatar é substituído por upload', async () => {
    await profileService.uploadAvatar(hostId, Buffer.from('imagem'), 'image/png');

    expect(hostRepository.updateProfile).toHaveBeenCalledWith(hostId, {
      avatarUrl: 'https://res.cloudinary.com/demo/image/upload/conta-comigo/avatars/novo.jpg',
      avatarHash: 'novo-hash',
      avatarPublicId: 'conta-comigo/avatars/novo',
    });
    expect(destroyImage).toHaveBeenCalledWith('conta-comigo/avatars/antigo');
  });

  it('apaga o public_id anterior quando o avatar é removido', async () => {
    await profileService.removeAvatar(hostId);

    expect(hostRepository.updateProfile).toHaveBeenCalledWith(hostId, {
      avatarUrl: null,
      avatarHash: null,
      avatarPublicId: null,
    });
    expect(destroyImage).toHaveBeenCalledWith('conta-comigo/avatars/antigo');
  });
});
