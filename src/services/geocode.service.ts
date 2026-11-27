import { env } from '../config/env';
import { logger } from '../config/logger';

export interface GeocodeResult {
  displayName: string;
  latitude: number;
  longitude: number;
  type: string | null;
  importance: number | null;
}

type CacheEntry = { expiresAt: number; results: GeocodeResult[] };

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 200;
const cache = new Map<string, CacheEntry>();
let lastRequestAt = 0;

function cacheKey(q: string, limit: number, countrycodes: string): string {
  return `${q.toLowerCase().trim()}|${limit}|${countrycodes}`;
}

function pruneCache(): void {
  const now = Date.now();
  for (const [k, v] of cache) {
    if (v.expiresAt <= now) cache.delete(k);
  }
  while (cache.size > CACHE_MAX) {
    const first = cache.keys().next().value;
    if (!first) break;
    cache.delete(first);
  }
}

async function rateLimitWait(): Promise<void> {
  const minGap = Math.max(0, env.GEOCODER_RATE_LIMIT_MS);
  const now = Date.now();
  const wait = Math.max(0, lastRequestAt + minGap - now);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

/** Resposta externa (Nominatim): campos são validados explicitamente antes de uso. */
type NominatimItem = Record<string, unknown>;

function toResult(item: unknown): GeocodeResult | null {
  const raw: NominatimItem = item !== null && item !== undefined ? (item as NominatimItem) : {};
  const lat = Number(raw['lat']);
  const lon = Number(raw['lon']);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const displayName = typeof raw['display_name'] === 'string' ? raw['display_name'].trim().slice(0, 200) : '';
  if (!displayName) return null;
  return {
    displayName,
    latitude: Math.round(lat * 1e6) / 1e6,
    longitude: Math.round(lon * 1e6) / 1e6,
    type: typeof raw['type'] === 'string' ? raw['type'] : null,
    importance: typeof raw['importance'] === 'number' ? raw['importance'] : null,
  };
}

export const geocodeService = {
  async search(query: string, opts?: { limit?: number; countrycodes?: string }): Promise<GeocodeResult[]> {
    const q = query.trim().slice(0, 120);
    if (q.length < 3) return [];
    const limit = Math.min(8, Math.max(1, opts?.limit ?? 5));
    const countrycodes = (opts?.countrycodes ?? env.GEOCODER_COUNTRYCODES ?? '').trim().toLowerCase();
    const key = cacheKey(q, limit, countrycodes);
    const now = Date.now();
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now) return cached.results;

    await rateLimitWait();
    const base = env.GEOCODER_BASE_URL.replace(/\/$/, '');
    const url = new URL(`${base}/search`);
    url.searchParams.set('q', q);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('limit', String(limit));
    if (countrycodes) url.searchParams.set('countrycodes', countrycodes);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'User-Agent': env.GEOCODER_USER_AGENT,
        },
      });
      if (!res.ok) {
        logger.warn({ status: res.status, provider: 'geocode' }, 'geocode request failed');
        return [];
      }
      const data = await res.json();
      const results = Array.isArray(data) ? data.map(toResult).filter(Boolean) as GeocodeResult[] : [];
      pruneCache();
      cache.set(key, { expiresAt: now + CACHE_TTL_MS, results });
      return results;
    } catch (err) {
      logger.warn({ provider: 'geocode', err: err instanceof Error ? err.message : 'unknown' }, 'geocode request error');
      return [];
    } finally {
      clearTimeout(timeout);
    }
  },
};
