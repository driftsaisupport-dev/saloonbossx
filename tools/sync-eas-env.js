#!/usr/bin/env node
/**
 * npm run eas-env
 * EAS cloud builds do NOT receive your git-ignored .env. This copies every
 * EXPO_PUBLIC_* / SBX_* value from .env into eas.json (each build profile's
 * "env"), so the APK you sell has your WhatsApp number, cloud links, etc.
 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const env = {};
try {
  for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*((?:EXPO_PUBLIC|SBX)_[A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[2].replace(/^["']|["']$/g, '')) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { console.error('✖ No .env file. Copy .env.example to .env and fill it in first.'); process.exit(1); }
const p = path.join(root, 'eas.json');
const eas = JSON.parse(fs.readFileSync(p, 'utf8'));
for (const name of Object.keys(eas.build || {})) eas.build[name].env = { ...(eas.build[name].env || {}), ...env };
fs.writeFileSync(p, JSON.stringify(eas, null, 2) + '\n');
console.log(`✔ Copied ${Object.keys(env).length} values into eas.json (${Object.keys(eas.build).join(', ')}).`);
console.log('  eas.json now contains your links and RESPONSE secret — do not post it publicly.');
