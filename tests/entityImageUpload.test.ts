import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/database/pool', () => ({
  withTransaction: vi.fn(async (callback: (client: unknown) => unknown) => callback({})),
  query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
  pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
}));

vi.mock('../src/services/purposeOtp.service', () => ({
  requestPurposeOtp: vi.fn(async () => ({ expiresAt: new Date(Date.now() + 600_000) })),
  assertPurposeOtp: vi.fn(),
}));

vi.mock('../src/services/cloudinary.service', () => ({
  uploadImage: vi.fn(async () => ({
    url: 'https://res.cloudinary.com/demo/image/upload/community/avatar.png',
    publicId: 'new-image',
  })),
  destroyImage: vi.fn(async () => undefined),
}));

import { communityRepository } from '../src/repositories/community.repository';
import { institutionRepository } from '../src/repositories/institution.repository';
import { communityService } from '../src/services/community.service';
import { institutionService } from '../src/services/institution.service';
import { destroyImage, uploadImage } from '../src/services/cloudinary.service';

const viewer = { hostId: 'host-1', email: 'teste@exemplo.ao' };
const uploaded = {
  url: 'https://res.cloudinary.com/demo/image/upload/community/avatar.png',
  publicId: 'new-image',
};

const community = {
  id: '00000000-0000-4000-8000-0000000000c1',
  name: 'Comunidade',
  slug: 'comunidade',
  description: null,
  visibility: 'public' as const,
  ownerId: viewer.hostId,
  avatarUrl: 'https://antigo/avatar.png',
  avatarPublicId: 'old-avatar',
  coverUrl: null,
  coverPublicId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  memberCount: 1,
  eventCount: 0,
  teamCount: 0,
  myRole: 'owner' as const,
  myStatus: 'active' as const,
  myPendingRequest: false,
};

const institution = {
  id: '00000000-0000-4000-8000-0000000000i1',
  name: 'Instituição',
  slug: 'instituicao',
  description: null,
  visibility: 'public' as const,
  creator_id: viewer.hostId,
  avatar_url: null,
  avatar_public_id: null,
  cover_url: 'https://antigo/capa.png',
  cover_public_id: 'old-cover',
  created_at: new Date(),
  community_count: 0,
};

function member(role: 'owner' | 'manager' | 'member') {
  return {
    id: 'm1',
    communityId: community.id,
    hostId: viewer.hostId,
    email: viewer.email,
    displayName: 'Teste',
    role,
    status: 'active' as const,
    joinedAt: new Date(),
    hasHostAccount: true,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(uploadImage).mockReset().mockResolvedValue(uploaded);
  vi.mocked(destroyImage).mockReset().mockResolvedValue(undefined);
});

describe('upload de imagens de comunidades e instituições', () => {
  it('gestores carregam o avatar e a imagem antiga é removida', async () => {
    const findById = vi.spyOn(communityRepository, 'findById')
      .mockResolvedValueOnce(community as never)
      .mockResolvedValueOnce({
        ...community,
        avatarUrl: uploaded.url,
        avatarPublicId: uploaded.publicId,
      } as never);
    vi.spyOn(communityRepository, 'findMemberByHost').mockResolvedValue(member('manager') as never);
    const update = vi.spyOn(communityRepository, 'update').mockResolvedValue();

    const result = await communityService.uploadAvatar(
      viewer,
      community.id,
      Buffer.from('imagem'),
      'image/png'
    );

    expect(uploadImage).toHaveBeenCalledWith(
      expect.any(Buffer),
      'image/png',
      expect.objectContaining({ unavailableCode: 'community_image_upload_unavailable' })
    );
    expect(update).toHaveBeenCalledWith(community.id, {
      avatarUrl: uploaded.url,
      avatarPublicId: uploaded.publicId,
    });
    expect(destroyImage).toHaveBeenCalledWith('old-avatar');
    expect(findById).toHaveBeenCalledTimes(2);
    expect(result.avatarUrl).toBe(uploaded.url);
  });

  it('membros simples não carregam imagens da comunidade', async () => {
    vi.spyOn(communityRepository, 'findById').mockResolvedValue(community as never);
    vi.spyOn(communityRepository, 'findMemberByHost').mockResolvedValue(member('member') as never);

    await expect(
      communityService.uploadCover(viewer, community.id, Buffer.from('x'), 'image/png')
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it('o criador carrega a capa da instituição e limpa o public_id anterior', async () => {
    vi.spyOn(institutionRepository, 'find')
      .mockResolvedValueOnce(institution as never)
      .mockResolvedValueOnce({
        ...institution,
        cover_url: uploaded.url,
        cover_public_id: uploaded.publicId,
      } as never);
    const update = vi.spyOn(institutionRepository, 'update').mockResolvedValue();

    await institutionService.uploadCover(
      institution.id,
      viewer,
      Buffer.from('imagem'),
      'image/webp'
    );

    expect(uploadImage).toHaveBeenCalledWith(
      expect.any(Buffer),
      'image/webp',
      expect.objectContaining({ unavailableCode: 'institution_image_upload_unavailable' })
    );
    expect(update).toHaveBeenCalledWith(institution.id, {
      cover_url: uploaded.url,
      cover_public_id: uploaded.publicId,
    });
    expect(destroyImage).toHaveBeenCalledWith('old-cover');
  });

  it('quem não é criador não altera imagens da instituição', async () => {
    vi.spyOn(institutionRepository, 'find').mockResolvedValue({
      ...institution,
      creator_id: 'outro',
    } as never);

    await expect(
      institutionService.uploadAvatar(institution.id, viewer, Buffer.from('x'), 'image/png')
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(uploadImage).not.toHaveBeenCalled();
  });
});
