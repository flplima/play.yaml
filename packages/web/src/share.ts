/**
 * Score-in-URL sharing: the whole document travels in the URL hash,
 * compressed with the browser's native CompressionStream and base64url-
 * encoded, so any song links anywhere without a server. Built entirely on
 * standard Web APIs.
 */

const HASH_PREFIX = '#s=';

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000; // keep String.fromCharCode under the argument limit
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function pipe(
  bytes: Uint8Array<ArrayBuffer>,
  transform: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Encode a score as a URL hash (`#s=…`). */
export async function encodeShareHash(text: string): Promise<string> {
  const deflated = await pipe(
    new TextEncoder().encode(text),
    new CompressionStream('deflate-raw'),
  );
  return HASH_PREFIX + toBase64Url(deflated);
}

/** True when the given (or current) hash carries a shared score. */
export function isShareHash(hash: string = location.hash): boolean {
  return hash.startsWith(HASH_PREFIX);
}

/**
 * Decode a `#s=…` hash back to the score text. Returns null when the hash
 * is not a share hash; throws when it is one but the payload is corrupt.
 */
export async function decodeShareHash(hash: string): Promise<string | null> {
  if (!isShareHash(hash)) return null;
  const inflated = await pipe(
    fromBase64Url(hash.slice(HASH_PREFIX.length)),
    new DecompressionStream('deflate-raw'),
  );
  return new TextDecoder().decode(inflated);
}

/** Drop a stale share hash from the address bar (after edits diverge from it). */
export function clearShareHash(): void {
  if (isShareHash()) history.replaceState(null, '', location.pathname + location.search);
}
