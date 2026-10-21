/**
 * Byte helpers. PURE MODULE — no React Native imports (tested in node).
 */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP: Int16Array = (() => {
  const t = new Int16Array(256).fill(-1);
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
  t['-'.charCodeAt(0)] = 62; // base64url
  t['_'.charCodeAt(0)] = 63;
  return t;
})();

/** Decode standard or URL-safe base64 (whitespace and padding tolerated) to bytes. */
export function base64ToBytes(b64: string): Uint8Array {
  const clean = String(b64 || '').replace(/[\s=]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buf = 0, bits = 0, o = 0;
  for (let i = 0; i < clean.length; i++) {
    const v = LOOKUP[clean.charCodeAt(i)];
    if (v < 0) throw new Error('Invalid base64 data.');
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buf >> bits) & 0xff;
    }
  }
  return o === out.length ? out : out.slice(0, o);
}

/** Lower-case hex of a byte buffer (e.g. a SHA-256 digest). */
export function bytesToHex(buf: ArrayBuffer | Uint8Array): string {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u.length; i++) s += u[i].toString(16).padStart(2, '0');
  return s;
}
