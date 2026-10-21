#!/usr/bin/env node
/**
 * npm run check-booking [-- salon-link-name]
 * Checks, from your laptop, everything a customer's phone needs:
 *   1. the cloud script is public, answers JSON and is version 5+
 *   2. the booking website is online and points at that cloud
 *   3. (optional) a salon's short link really loads its menu
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
const CLOUD = (process.env.EXPO_PUBLIC_CLOUD_URL || env.EXPO_PUBLIC_CLOUD_URL || '').trim();
const SITE = (process.env.EXPO_PUBLIC_BOOKING_SITE || env.EXPO_PUBLIC_BOOKING_SITE || '').trim().replace(/\/+$/, '');
const slug = process.argv[2] || '';
let bad = 0;
const ok = (m) => console.log('  ✔ ' + m);
const no = (m, fix) => { bad++; console.log('  ✖ ' + m + (fix ? '\n      → ' + fix : '')); };

async function get(url) {
  const r = await fetch(url, { redirect: 'follow', headers: { 'cache-control': 'no-cache' } });
  return { status: r.status, text: await r.text() };
}

(async () => {
  console.log('\n1. Cloud script');
  if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(CLOUD)) no('EXPO_PUBLIC_CLOUD_URL missing or not an /exec link', 'Copy the Web app URL ending in /exec into .env');
  else {
    try {
      const a = await get(CLOUD);
      let d; try { d = JSON.parse(a.text); } catch { d = null; }
      if (!d) no('Google returned a web page, not data (' + (/unable to open/i.test(a.text) ? '"unable to open the file"' : 'HTTP ' + a.status) + ')', 'Deploy → Manage deployments: Execute as Me, Who has access: Anyone. Use the /exec URL.');
      else if (Number(d.version) < 5) no(`Script version ${d.version} — short links need version 5`, 'Paste the new google-apps-script/BranchSync.gs → Deploy → Manage deployments → ✏️ → Version: New version → Deploy');
      else ok(`Public, version ${d.version}`);
      const t = await get(CLOUD + '?api=1&s=zz-check-' + Date.now());
      let e; try { e = JSON.parse(t.text); } catch { e = null; }
      if (e && e.ok === false) ok('Booking API answers'); else no('Booking API did not answer as expected', 'Update the script to the latest version (see above)');
    } catch (err) { no('Could not reach Google: ' + err.message); }
  }

  console.log('\n2. Booking website');
  if (!SITE) no('EXPO_PUBLIC_BOOKING_SITE is empty — links will be long Google links that fail on many phones', 'Set up GitHub Pages (BOOKING_WEBSITE_SETUP.md) and put https://<you>.github.io in .env');
  else {
    try {
      const c = await get(SITE + '/config.js?t=' + Date.now());
      const m = c.text.match(/SBX_API\s*=\s*"([^"]*)"/);
      if (c.status >= 400 || !m) no(`${SITE}/config.js not found (HTTP ${c.status})`, 'Run npm run booking-site and upload index.html, 404.html, config.js, .nojekyll; Settings → Pages → main / root');
      else if (m[1].replace(/\/+$/, '') !== CLOUD) no('config.js points to a different cloud link', 'Run npm run booking-site again and re-upload config.js');
      else ok('Online, config.js points to your cloud');
      const p = await get(SITE + '/any-salon-check');
      if (/SBX_API|config\.js/.test(p.text)) ok('Short links like ' + SITE.replace(/^https:\/\//, '') + '/salon-name serve the booking page');
      else no('Short links do not serve the booking page', 'Upload 404.html (a copy of index.html) to the site root');
    } catch (err) { no('Could not reach the website: ' + err.message); }
  }

  if (slug && CLOUD) {
    console.log(`\n3. Salon link "${slug}"`);
    try {
      const s = JSON.parse((await get(CLOUD + '?api=1&s=' + encodeURIComponent(slug))).text);
      if (s.ok) ok(`${s.profile.salonName} · ${s.profile.services.length} services · ${SITE ? SITE + '/' + slug : ''}`);
      else no(s.message || 'Not found', 'In the salon app: Online Booking → Save & publish (needs internet)');
    } catch (err) { no('Could not check: ' + err.message); }
  }
  console.log(bad ? `\n${bad} problem(s) to fix.\n` : '\nAll good — customers can book.\n');
  process.exit(bad ? 1 : 0);
})();
