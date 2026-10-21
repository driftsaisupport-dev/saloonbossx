/**
 * Cloud backup encryption — done on the phone, before anything leaves it.
 *
 *   json ─deflate─▶ bytes ─AES-256-CBC(random IV)─▶ ct ─HMAC-SHA256─▶ "SBX1:iv:ct:mac"
 *
 * Keys come from the chain secret (32 random bytes that only the owner's
 * phones hold). Google Drive, the Apps Script, and the app seller only ever
 * see ciphertext. The MAC means a tampered or truncated file is rejected
 * instead of being restored as garbage.
 *
 * Pure crypto-js + pako, no React Native, so it is unit-tested in Node.
 */
import CryptoJS from 'crypto-js';
import pako from 'pako';

type WordArray = CryptoJS.lib.WordArray;

function u8ToWords(u8: Uint8Array): WordArray {
  const words: number[] = [];
  for (let i = 0; i < u8.length; i++) words[i >>> 2] |= u8[i] << (24 - (i % 4) * 8);
  return CryptoJS.lib.WordArray.create(words, u8.length);
}

function wordsToU8(wa: WordArray): Uint8Array {
  const { words, sigBytes } = wa;
  const out = new Uint8Array(sigBytes);
  for (let i = 0; i < sigBytes; i++) out[i] = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
  return out;
}

function keys(secret: string) {
  return {
    enc: CryptoJS.SHA256('sbx-enc|' + secret),
    mac: CryptoJS.SHA256('sbx-mac|' + secret),
  };
}

export function encryptBackup(json: string, secret: string, iv16: Uint8Array): string {
  if (iv16.length !== 16) throw new Error('IV must be 16 bytes');
  const k = keys(secret);
  const packed = pako.deflate(json, { level: 6 });
  const iv = u8ToWords(iv16);
  const ct = CryptoJS.AES.encrypt(u8ToWords(packed), k.enc, { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }).ciphertext;
  const ivB = CryptoJS.enc.Base64.stringify(iv);
  const ctB = CryptoJS.enc.Base64.stringify(ct);
  const mac = CryptoJS.HmacSHA256(`${ivB}:${ctB}`, k.mac).toString(CryptoJS.enc.Hex);
  return `SBX1:${ivB}:${ctB}:${mac}`;
}

export function decryptBackup(blob: string, secret: string): string {
  const parts = String(blob || '').trim().split(':');
  if (parts.length !== 4 || parts[0] !== 'SBX1') throw new Error('Not a SaloonBossX cloud backup.');
  const [, ivB, ctB, mac] = parts;
  const k = keys(secret);
  const check = CryptoJS.HmacSHA256(`${ivB}:${ctB}`, k.mac).toString(CryptoJS.enc.Hex);
  if (check !== mac) throw new Error('This backup belongs to a different chain or is damaged.');
  const iv = CryptoJS.enc.Base64.parse(ivB);
  const ct = CryptoJS.enc.Base64.parse(ctB);
  const plain = CryptoJS.AES.decrypt(CryptoJS.lib.CipherParams.create({ ciphertext: ct }), k.enc, { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 });
  return pako.inflate(wordsToU8(plain), { to: 'string' });
}

/**
 * Shared cloud: the server only ever gets this one-way derived key for
 * signing requests. The backup/summary keys derive from the raw secret, which
 * stays on the phones and in the recovery key — so the cloud's owner (the app
 * seller) can verify requests but can never decrypt a salon's data.
 */
export function authKey(secret: string): string {
  return CryptoJS.SHA256('sbx-auth|' + secret).toString(CryptoJS.enc.Hex);
}

/** Request signature, mirrored by hmacHex_() in google-apps-script/BranchSync.gs. */
export function signRequest(action: string, chainId: string, branchId: string, ts: number, payload: string, secret: string): string {
  const digest = CryptoJS.SHA256(CryptoJS.enc.Utf8.parse(payload)).toString(CryptoJS.enc.Hex);
  return CryptoJS.HmacSHA256(`${action}|${chainId}|${branchId}|${ts}|${digest}`, secret).toString(CryptoJS.enc.Hex);
}

export function bytesToHex(b: Uint8Array): string {
  return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
}

/** Join code: everything a new branch phone needs, in one pasteable string. */
export function makeJoinCode(d: { url: string; chainId: string; secret: string; chainName: string; hosted?: boolean }): string {
  const json = JSON.stringify({ u: d.url, c: d.chainId, s: d.secret, n: d.chainName, ...(d.hosted ? { h: 1 } : {}) });
  return 'SBXJOIN1.' + CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse(json)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function readJoinCode(code: string): { url: string; chainId: string; secret: string; chainName: string; hosted: boolean } {
  const raw = String(code || '').replace(/\s+/g, '');
  if (!raw.startsWith('SBXJOIN1.')) throw new Error('That is not a SaloonBossX join code.');
  let b64 = raw.slice(9).replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const o = JSON.parse(CryptoJS.enc.Base64.parse(b64).toString(CryptoJS.enc.Utf8));
  if (!o?.u || !o?.c || !o?.s) throw new Error('The join code is incomplete. Copy it again.');
  return { url: o.u, chainId: o.c, secret: o.s, chainName: o.n || '', hosted: o.h === 1 };
}
