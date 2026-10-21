import c from 'node:crypto';
export const getRandomBytes = (n) => new Uint8Array(c.randomBytes(n));
export const randomUUID = () => c.randomUUID();
export const CryptoDigestAlgorithm = { SHA256: 'SHA-256' };
export async function digest(alg, data) { return c.createHash('sha256').update(data).digest().buffer; }
