#!/usr/bin/env node
/**
 * npm run booking-site
 * Makes booking-site/dist — upload its files to GitHub Pages (or Netlify /
 * Cloudflare Pages). See BOOKING_WEBSITE_SETUP.md.
 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const env = {};
try {
  for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}
const api = (process.env.EXPO_PUBLIC_CLOUD_URL || env.EXPO_PUBLIC_CLOUD_URL || '').trim();
if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(api)) {
  console.error('✖ Set EXPO_PUBLIC_CLOUD_URL in .env first (your Cloud Bridge /exec link). See HOSTED_CLOUD_SETUP.md.');
  process.exit(1);
}
const src = path.join(root, 'booking-site');
const out = path.join(src, 'dist');
fs.mkdirSync(out, { recursive: true });
const html = fs.readFileSync(path.join(src, 'index.html'), 'utf8');
fs.writeFileSync(path.join(out, 'index.html'), html);
// GitHub Pages serves 404.html for /any-salon-name — that is how short links work.
fs.writeFileSync(path.join(out, '404.html'), html);
fs.writeFileSync(path.join(out, 'config.js'), `window.SBX_API = ${JSON.stringify(api)};\n`);
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log(`✔ booking-site/dist ready (cloud: ${api.slice(0, 60)}…)`);
console.log('  Upload index.html, 404.html, config.js and .nojekyll to your GitHub Pages repo.');
