import { describe, expect, it, vi } from 'vitest';
import {
  CloudinaryAsset,
  cleanupDependenciesForTest,
  findOrphanAssets,
  parseCleanupArgs,
  runCloudinaryCleanup,
} from '../src/scripts/cleanupCloudinary';

const now = Date.parse('2026-11-20T12:00:00Z');
const old = new Date(now - 48 * 60 * 60 * 1000).toISOString();
const recent = new Date(now - 2 * 60 * 60 * 1000).toISOString();

const folders = [
  'conta-comigo/avatars',
  'conta-comigo/events',
  'conta-comigo/profile-covers',
];

describe('Cloudinary orphan cleanup', () => {
  it('dry-run é o modo por omissão e rejeita combinações inválidas', () => {
    expect(parseCleanupArgs([])).toEqual({ apply: false });
    expect(parseCleanupArgs(['--dry-run'])).toEqual({ apply: false });
    expect(parseCleanupArgs(['--apply'])).toEqual({ apply: true });
    expect(() => parseCleanupArgs(['--apply', '--dry-run'])).toThrow();
    expect(() => parseCleanupArgs(['--force'])).toThrow();
  });

  it('ignora referenciados, assets recentes e pastas externas', () => {
    const assets: CloudinaryAsset[] = [
      { public_id: 'conta-comigo/avatars/referido', created_at: old },
      { public_id: 'conta-comigo/avatars/orfao', created_at: old },
      { public_id: 'conta-comigo/events/recente', created_at: recent },
      { public_id: 'outra-conta/avatars/alheio', created_at: old },
    ];

    expect(findOrphanAssets(assets, ['conta-comigo/avatars/referido'], folders, now)).toEqual({
      orphans: ['conta-comigo/avatars/orfao'],
      recentSkipped: 1,
    });
  });

  it('em dry-run não apaga nada mas identifica os órfãos', async () => {
    const removeAsset = vi.fn(async () => undefined);
    const deps = cleanupDependenciesForTest({
      referenced: ['conta-comigo/events/referido'],
      assets: {
        'conta-comigo/avatars': [{ public_id: 'conta-comigo/avatars/orfao', created_at: old }],
        'conta-comigo/events': [
          { public_id: 'conta-comigo/events/referido', created_at: old },
          { public_id: 'conta-comigo/events/antigo', created_at: old },
        ],
        'conta-comigo/profile-covers': [],
      },
      removeAsset,
    });

    const result = await runCloudinaryCleanup({ apply: false }, deps);

    expect(result.orphans).toEqual([
      'conta-comigo/avatars/orfao',
      'conta-comigo/events/antigo',
    ]);
    expect(result.deleted).toEqual([]);
    expect(removeAsset).not.toHaveBeenCalled();
  });
});
