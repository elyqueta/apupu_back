/**
 * Bloco 14 — extrai o ID (11 caracteres) de um link do YouTube. Aceita
 * `youtube.com/watch?v=`, `youtu.be/`, `youtube.com/shorts/` e
 * `youtube.com/embed/` (com ou sem `www.`/`m.`). Devolve `null` quando o
 * link não é reconhecido: nunca se guarda o URL livre.
 */
const ID = /^[A-Za-z0-9_-]{11}$/;

export function youtubeVideoId(input: string): string | null {
  const value = input.trim();
  if (ID.test(value)) return value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.replace(/^(www|m)\./, '');
  let candidate: string | null = null;
  if (host === 'youtu.be') {
    candidate = url.pathname.split('/')[1] ?? null;
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const [, first, second] = url.pathname.split('/');
    if (first === 'watch') candidate = url.searchParams.get('v');
    else if (first === 'shorts' || first === 'embed' || first === 'live') candidate = second ?? null;
  }
  return candidate && ID.test(candidate) ? candidate : null;
}
