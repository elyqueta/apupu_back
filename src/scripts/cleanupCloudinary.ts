import { env } from '../config/env';
import { logger } from '../config/logger';
import { closePool, query as queryDatabase } from '../database/pool';
import { destroyImage } from '../services/cloudinary.service';

/**
 * Limpeza de assets órfãos do Cloudinary.
 *
 * Corre em `--dry-run` por omissão: apenas lista e conta. `--apply`
 * remove os órfãos. Por segurança:
 *
 * - só são considerados assets das pastas configuradas (e da conta
 *   configurada, através da Admin API);
 * - assets criados nas últimas 24 horas nunca são apagados;
 * - um `public_id` referenciado em qualquer tabela é sempre mantido;
 * - URLs externas não têm `public_id` e nunca são tocadas.
 *
 * Agendamento sugerido (cron do Render ou worker separado), sempre com
 * revisão do dry-run antes de activar `--apply`:
 *
 * ```
 * 0 4 * * 0 cd /srv/conta-comigo && npm run cloudinary:cleanup -- --dry-run
 * ```
 */
const MIN_AGE_HOURS = 24;
const MAX_PAGES = 1000;
const PAGE_SIZE = 500;
const SAFE_FOLDER = /^[A-Za-z0-9_/-]+$/;

export interface CloudinaryAsset {
  public_id: string;
  created_at?: string;
}

interface ReferencedRow {
  public_id: string | null;
}

export interface CleanupOptions {
  apply: boolean;
}

export interface CleanupDependencies {
  query: (text: string, params?: unknown[]) => Promise<{ rows: ReferencedRow[] }>;
  listAssets: (folder: string) => Promise<CloudinaryAsset[]>;
  removeAsset: (publicId: string) => Promise<void>;
}

export interface CleanupResult {
  apply: boolean;
  folders: string[];
  scanned: number;
  referenced: number;
  recentSkipped: number;
  orphans: string[];
  deleted: string[];
  failed: string[];
}

interface AdminResourcesResponse {
  resources?: Array<{ public_id?: unknown; created_at?: unknown }>;
  next_cursor?: unknown;
  error?: { message?: unknown };
}

/** Aceita apenas `--dry-run` (omissão) e `--apply`. */
export function parseCleanupArgs(argv: string[]): CleanupOptions {
  const allowed = new Set(['--dry-run', '--apply']);
  const unknown = argv.filter((arg) => !allowed.has(arg));

  if (unknown.length > 0) {
    throw new Error(`Argumento desconhecido: ${unknown[0]}. Use --dry-run ou --apply.`);
  }
  if (argv.includes('--dry-run') && argv.includes('--apply')) {
    throw new Error('Use apenas uma das opções: --dry-run ou --apply.');
  }

  return { apply: argv.includes('--apply') };
}

/** Pastas desta aplicação, deduplicadas. */
export function configuredFolders(): string[] {
  return Array.from(
    new Set([
      env.CLOUDINARY_AVATAR_FOLDER.trim(),
      env.CLOUDINARY_EVENT_FOLDER.trim(),
      env.CLOUDINARY_PROFILE_COVER_FOLDER.trim(),
    ])
  ).filter((folder) => SAFE_FOLDER.test(folder));
}

/**
 * Filtra os assets listados. Não confiamos apenas no `prefix` da Admin
 * API: voltamos a exigir que o `public_id` comece pela pasta exacta.
 */
export function findOrphanAssets(
  assets: CloudinaryAsset[],
  referencedPublicIds: string[],
  folders: string[],
  now = Date.now()
): { orphans: string[]; recentSkipped: number } {
  const referenced = new Set(referencedPublicIds.filter(Boolean));
  const prefixes = folders.map((folder) => `${folder}/`);
  const minimumTimestamp = now - MIN_AGE_HOURS * 60 * 60 * 1000;
  const orphans: string[] = [];
  let recentSkipped = 0;

  for (const asset of assets) {
    const publicId = asset.public_id;
    if (typeof publicId !== 'string' || !prefixes.some((prefix) => publicId.startsWith(prefix))) {
      continue;
    }
    if (referenced.has(publicId)) continue;

    const created = asset.created_at ? Date.parse(asset.created_at) : Number.NaN;
    if (Number.isFinite(created) && created > minimumTimestamp) {
      recentSkipped += 1;
      continue;
    }

    orphans.push(publicId);
  }

  return { orphans: Array.from(new Set(orphans)), recentSkipped };
}

async function loadReferencedPublicIds(query: CleanupDependencies['query']): Promise<string[]> {
  const result = await query(`
    SELECT avatar_public_id AS public_id FROM host_profiles WHERE avatar_public_id IS NOT NULL
    UNION
    SELECT cover_public_id AS public_id FROM host_profiles WHERE cover_public_id IS NOT NULL
    UNION
    SELECT cover_public_id AS public_id FROM events WHERE cover_public_id IS NOT NULL
  `);

  return result.rows.map((row) => row.public_id).filter((id): id is string => Boolean(id));
}

/** Lista todas as páginas de uma pasta via Admin API do Cloudinary. */
export async function fetchFolderAssets(folder: string): Promise<CloudinaryAsset[]> {
  const apiKey = env.CLOUDINARY_API_KEY;
  const apiSecret = env.CLOUDINARY_API_SECRET;

  if (!env.CLOUDINARY_CLOUD_NAME || !apiKey || !apiSecret || !SAFE_FOLDER.test(folder)) {
    throw new Error('Cloudinary não está configurado para a limpeza de órfãs.');
  }

  const authorization = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
  const assets: CloudinaryAsset[] = [];
  let nextCursor: string | undefined;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(
      `https://api.cloudinary.com/v1_1/${encodeURIComponent(env.CLOUDINARY_CLOUD_NAME)}/resources/image`
    );
    url.searchParams.set('type', 'upload');
    url.searchParams.set('prefix', `${folder}/`);
    url.searchParams.set('max_results', String(PAGE_SIZE));
    if (nextCursor) url.searchParams.set('next_cursor', nextCursor);

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Basic ${authorization}` },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      logger.error({ err: error, folder }, 'Falha de rede ao listar assets no Cloudinary.');
      throw error;
    }

    const body = (await response.json().catch(() => ({}))) as AdminResourcesResponse;
    if (!response.ok) {
      const detail = typeof body.error?.message === 'string' ? body.error.message : 'sem detalhe';
      logger.error({ status: response.status, detail, folder }, 'A Admin API recusou a listagem.');
      throw new Error('Não foi possível listar os assets do Cloudinary.');
    }

    for (const resource of body.resources ?? []) {
      if (typeof resource.public_id !== 'string') continue;
      assets.push({
        public_id: resource.public_id,
        created_at: typeof resource.created_at === 'string' ? resource.created_at : undefined,
      });
    }

    const cursor = body.next_cursor;
    if (typeof cursor !== 'string' || !cursor) break;
    if (cursor === nextCursor) break;
    nextCursor = cursor;
  }

  return assets;
}

/** Facilita testes unitários sem base de dados nem Cloudinary. */
export function cleanupDependenciesForTest(options: {
  referenced: string[];
  assets: Record<string, CloudinaryAsset[]>;
  removeAsset?: (publicId: string) => Promise<void>;
}): CleanupDependencies {
  return {
    query: () => Promise.resolve({ rows: options.referenced.map((public_id) => ({ public_id })) }),
    listAssets: (folder: string): Promise<CloudinaryAsset[]> =>
      Promise.resolve(options.assets[folder] ?? []),
    removeAsset: options.removeAsset ?? ((): Promise<void> => Promise.resolve()),
  };
}

const defaultDependencies: CleanupDependencies = {
  query: async (text, params) => ({
    rows: (await queryDatabase<ReferencedRow>(text, params)).rows,
  }),
  listAssets: fetchFolderAssets,
  removeAsset: destroyImage,
};

export async function runCloudinaryCleanup(
  options: CleanupOptions,
  dependencies: CleanupDependencies = defaultDependencies
): Promise<CleanupResult> {
  const folders = configuredFolders();
  const result: CleanupResult = {
    apply: options.apply,
    folders,
    scanned: 0,
    referenced: 0,
    recentSkipped: 0,
    orphans: [],
    deleted: [],
    failed: [],
  };

  if (folders.length === 0) {
    logger.warn('Nenhuma pasta Cloudinary configurada; nada a limpar.');
    return result;
  }

  const referenced = await loadReferencedPublicIds(dependencies.query);
  result.referenced = referenced.length;

  for (const folder of folders) {
    const assets = await dependencies.listAssets(folder);
    const { orphans, recentSkipped } = findOrphanAssets(assets, referenced, folders);
    result.scanned += assets.length;
    result.recentSkipped += recentSkipped;

    for (const publicId of orphans) {
      if (!result.orphans.includes(publicId)) result.orphans.push(publicId);
    }
  }

  if (options.apply) {
    for (const publicId of result.orphans) {
      try {
        await dependencies.removeAsset(publicId);
        result.deleted.push(publicId);
      } catch (error) {
        result.failed.push(publicId);
        logger.warn({ err: error, public_id: publicId }, 'Falha ao remover asset órfão.');
      }
    }
  }

  logger.info(
    {
      mode: options.apply ? 'apply' : 'dry-run',
      folders: folders.length,
      scanned: result.scanned,
      referenced: result.referenced,
      recent_skipped: result.recentSkipped,
      orphans: result.orphans.length,
      deleted: result.deleted.length,
      failed: result.failed.length,
    },
    'Limpeza de assets órfãos concluída.'
  );

  return result;
}

async function main(): Promise<void> {
  try {
    await runCloudinaryCleanup(parseCleanupArgs(process.argv.slice(2)));
  } finally {
    await closePool();
  }
}

if (process.argv[1]?.endsWith('cleanupCloudinary.ts') || process.argv[1]?.endsWith('cleanupCloudinary.js')) {
  void main().catch((error: unknown) => {
    logger.error({ err: error }, 'Falha ao limpar assets órfãos do Cloudinary.');
    process.exitCode = 1;
  });
}
