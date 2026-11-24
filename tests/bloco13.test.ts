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

import { institutionRepository, LinkRequestRow } from '../src/repositories/institution.repository';
import { institutionService } from '../src/services/institution.service';
import { assertPurposeOtp, requestPurposeOtp } from '../src/services/purposeOtp.service';

const creator = { hostId: 'creator', email: 'criador@exemplo.ao' };
const owner = { hostId: 'owner', email: 'dono@exemplo.ao' };
const stranger = { hostId: 'stranger', email: 'x@exemplo.ao' };

const institution = {
  id: '00000000-0000-4000-8000-0000000000i1',
  name: 'Diocese',
  slug: 'diocese',
  description: null,
  visibility: 'public' as const,
  creator_id: 'creator',
  avatar_url: null,
  cover_url: null,
  created_at: new Date(),
  community_count: 0,
};

function request(overrides: Partial<LinkRequestRow> = {}): LinkRequestRow {
  return {
    id: '00000000-0000-4000-8000-0000000000r1',
    institution_id: institution.id,
    community_id: 'c1',
    community_name: 'Jovens',
    community_slug: 'jovens',
    institution_name: 'Diocese',
    direction: 'community_to_institution',
    kind: 'link',
    status: 'pending',
    community_accepted_at: new Date(),
    created_at: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(requestPurposeOtp).mockClear();
  vi.mocked(assertPurposeOtp).mockReset();
  vi.spyOn(institutionRepository, 'find').mockResolvedValue(institution);
  vi.spyOn(institutionRepository, 'communities').mockResolvedValue([]);
  vi.spyOn(institutionRepository, 'findCommunity').mockResolvedValue({
    id: 'c1',
    name: 'Jovens',
    owner_id: 'owner',
    institution_id: null,
  });
});

describe('Bloco 13 — permissões', () => {
  it('só o criador edita ou apaga', async () => {
    await expect(institutionService.update('diocese', owner, { name: 'X' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(institutionService.remove('diocese', stranger, 'Diocese')).rejects.toMatchObject({ statusCode: 403 });
  });

  it('só o responsável da comunidade pede para entrar', async () => {
    await expect(institutionService.requestFromCommunity('diocese', stranger, 'c1')).rejects.toMatchObject({ statusCode: 403 });
  });

  it('só o criador convida comunidades', async () => {
    await expect(institutionService.inviteCommunity('diocese', owner, 'c1')).rejects.toMatchObject({ statusCode: 403 });
  });

  it('comunidade com instituição não pode ter outra', async () => {
    vi.spyOn(institutionRepository, 'findCommunity').mockResolvedValue({
      id: 'c1',
      name: 'Jovens',
      owner_id: 'owner',
      institution_id: 'outra',
    });
    await expect(institutionService.requestFromCommunity('diocese', owner, 'c1')).rejects.toMatchObject({
      code: 'community_has_institution',
    });
  });

  it('instituição privada é 404 para quem não é criador nem responsável associado', async () => {
    vi.spyOn(institutionRepository, 'find').mockResolvedValue({ ...institution, visibility: 'private' });
    await expect(institutionService.load('diocese', stranger)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('Bloco 13 — OTP do criador', () => {
  it('aprovar exige OTP: o pedido passa a "awaiting_otp" e nada é ligado', async () => {
    vi.spyOn(institutionRepository, 'findRequest').mockResolvedValue(request());
    const setStatus = vi.spyOn(institutionRepository, 'setRequestStatus').mockResolvedValue();
    const link = vi.spyOn(institutionRepository, 'link');
    const result = await institutionService.startApproval('r1', creator);
    expect(result.status).toBe('awaiting_otp');
    expect(requestPurposeOtp).toHaveBeenCalledWith(creator.email, 'institution_link', expect.any(Object));
    expect(setStatus).toHaveBeenCalledWith(expect.any(String), 'awaiting_otp', null, undefined, expect.any(Date));
    expect(link).not.toHaveBeenCalled();
  });

  it('o responsável da comunidade não pode aprovar', async () => {
    vi.spyOn(institutionRepository, 'findRequest').mockResolvedValue(request());
    await expect(institutionService.startApproval('r1', owner)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('convite ainda não aceite pela comunidade não avança', async () => {
    vi.spyOn(institutionRepository, 'findRequest').mockResolvedValue(
      request({ direction: 'institution_to_community', community_accepted_at: null }),
    );
    await expect(institutionService.startApproval('r1', creator)).rejects.toMatchObject({
      code: 'institution_community_pending',
    });
  });

  it('OTP inválido não liga; OTP válido liga de forma atómica', async () => {
    vi.spyOn(institutionRepository, 'findRequest').mockResolvedValue(request({ status: 'awaiting_otp' }));
    const link = vi.spyOn(institutionRepository, 'link').mockResolvedValue(true);
    vi.spyOn(institutionRepository, 'setRequestStatus').mockResolvedValue();
    vi.mocked(assertPurposeOtp).mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'otp_invalid' }));
    await expect(institutionService.confirmApproval('r1', creator, '000000')).rejects.toMatchObject({ code: 'otp_invalid' });
    expect(link).not.toHaveBeenCalled();

    await institutionService.confirmApproval('r1', creator, '123456');
    expect(link).toHaveBeenCalledWith('c1', institution.id, expect.anything());
  });

  it('remover uma comunidade também exige OTP do criador', async () => {
    vi.spyOn(institutionRepository, 'findCommunity').mockResolvedValue({
      id: 'c1',
      name: 'Jovens',
      owner_id: 'owner',
      institution_id: institution.id,
    });
    vi.spyOn(institutionRepository, 'createRequest').mockResolvedValue('r2');
    vi.spyOn(institutionRepository, 'findRequest').mockResolvedValue(request({ id: 'r2', kind: 'remove' }));
    vi.spyOn(institutionRepository, 'setRequestStatus').mockResolvedValue();
    const unlink = vi.spyOn(institutionRepository, 'unlink');
    const result = await institutionService.startRemoval('diocese', creator, 'c1');
    expect(result.status).toBe('awaiting_otp');
    expect(unlink).not.toHaveBeenCalled();
    await expect(institutionService.startRemoval('diocese', owner, 'c1')).rejects.toMatchObject({ statusCode: 403 });
  });
});
