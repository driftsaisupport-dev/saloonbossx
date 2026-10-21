#!/usr/bin/env node
/**
 * One-time setup: generate the Ed25519 signing pair.
 *
 *   node tools/keygen.js
 *
 * The PUBLIC key goes in .env as EXPO_PUBLIC_LICENSE_PUBKEY and ships in the app.
 * The PRIVATE key goes in keys/private.key and MUST NEVER be committed, emailed,
 * or put in the app. Back it up somewhere safe — lose it and you can no longer
 * issue licences for builds already in the field.
 */
const nacl = require('tweetnacl');
const fs = require('fs');
const path = require('path');

const b64url = (b) => Buffer.from(b).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const pair = nacl.sign.keyPair();
const dir = path.join(__dirname, '..', 'keys');
fs.mkdirSync(dir, { recursive: true });

const privPath = path.join(dir, 'private.key');
if (fs.existsSync(privPath)) {
  console.error('\nkeys/private.key already exists. Refusing to overwrite.');
  console.error('Delete it deliberately if you really mean to rotate keys —');
  console.error('every licence signed with the old key will stop verifying.\n');
  process.exit(1);
}

fs.writeFileSync(privPath, b64url(pair.secretKey), { mode: 0o600 });

// The public key is not secret. Writing it to a committed file means every
// build picks it up automatically — EAS does not upload your git-ignored .env,
// and a build without the public key cannot activate ANY licence.
fs.writeFileSync(path.join(__dirname, '..', 'license-public.key'), b64url(pair.publicKey) + '\n');

try { require('./embed-pubkey'); } catch {}
console.log('\nKeypair generated.\n');
console.log('Public key written to license-public.key (commit this file).\n');
console.log('Optional — the same value for .env:\n');
console.log(`EXPO_PUBLIC_LICENSE_PUBKEY=${b64url(pair.publicKey)}\n`);
console.log('Private key written to keys/private.key (git-ignored).');
console.log('Back it up now, in two places. There is no recovery.\n');
