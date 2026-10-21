/**
 * ╔═══════════════════════════════════════════════════════════════════════╗
 * ║   SaloonBossX — Cloud Bridge (Google Drive sync for 1 to N branches)   ║
 * ║                                                                       ║
 * ║   Deploy ONCE, in the SALON OWNER'S own Google account. Their data   ║
 * ║   goes to their own Google Drive — never to the app seller.          ║
 * ║                                                                       ║
 * ║   1. Open https://script.google.com  → New project                    ║
 * ║   2. Delete the sample code, paste this whole file, Save.             ║
 * ║   3. Deploy → New deployment → type "Web app"                         ║
 * ║        Execute as:      Me                                            ║
 * ║        Who has access:  Anyone                                        ║
 * ║      → Deploy → Authorise (Advanced → Go to project → Allow).         ║
 * ║   4. Copy the Web app URL (ends in /exec).                            ║
 * ║   5. In the app: Settings → Branches & Cloud → "Set up HQ" → paste.   ║
 * ║                                                                       ║
 * ║   Free. Uses only Google Drive + Google Sheets in the owner's         ║
 * ║   account (normal free quota is far more than a salon chain needs).   ║
 * ╚═══════════════════════════════════════════════════════════════════════╝
 *
 * What it stores, in Drive → "SaloonBossX Cloud" folder:
 *   branches/<branchId>.json     latest summary of each branch (small)
 *   backups/<branchId>/*.sbx     daily ENCRYPTED backups (last 14 kept)
 *                                encrypted on the phone; this script and
 *                                Google cannot read them
 *   catalog.json                 price list pushed by head office
 *   "SaloonBossX HQ Dashboard"   Google Sheet, updated on every sync, so the
 *                                owner can also watch all branches on a laptop
 *
 * Security: every request is signed (HMAC-SHA256) with the chain secret that
 * lives only on the owner's phones. Without the secret nothing can be read or
 * written, even by someone who has the URL.
 */

var VERSION = 5;            // 2 = online booking, 3 = connect/join links, 4 = shared cloud, 5 = short links + JSON API for the booking website
var MAX_SKEW_MS = 24 * 60 * 60 * 1000;
var KEEP_BACKUPS = 14;
var MAX_PAYLOAD = 30 * 1024 * 1024;   // one encrypted backup; far above a real salon's
var MAX_BRANCHES = 30;                // per salon / chain, shared cloud only
var MAX_NEW_PER_DAY = 300;            // new salons per day, shared cloud only

// ── salons (chains) ─────────────────────────────────────────────────────────
// Owner's own script (v1–v4): one salon, secret in Script Properties.
// Shared cloud (v4, HOSTED=1): many salons; each has a folder named after its
// id holding "_auth" (the request-signing key — NOT the backup key, which
// never leaves the phones). Nothing grows in Script Properties per salon.

function isHosted_() { return PropertiesService.getScriptProperties().getProperty('HOSTED') === '1'; }
function cleanId_(v) { v = String(v || ''); return /^[a-z0-9]{4,40}$/i.test(v) ? v : ''; }

function hostedParent_(create) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('CLOUD_PARENT');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  if (!create) return null;
  var f = DriveApp.createFolder('SaloonBossX Cloud');
  props.setProperty('CLOUD_PARENT', f.getId());
  return f;
}

function chain_(chainId) {
  if (!/^[a-z0-9]{8,40}$/i.test(String(chainId || ''))) return null;
  var props = PropertiesService.getScriptProperties();
  var s = props.getProperty('SECRET_' + chainId);
  if (s) return { secret: s, root: rootFolder_(chainId) };
  if (!isHosted_()) return null;
  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (e) {}
  var c = cache && cache.get('C_' + chainId);
  if (c) { var parts = c.split('|'); try { return { secret: parts[0], root: DriveApp.getFolderById(parts[1]) }; } catch (e) {} }
  var parent = hostedParent_(false);
  if (!parent) return null;
  var it = parent.getFoldersByName(chainId);
  if (!it.hasNext()) return null;
  var f = it.next();
  var k = f.getFilesByName('_auth');
  if (!k.hasNext()) return null;
  var sec = String(k.next().getBlob().getDataAsString('UTF-8')).trim();
  if (!sec) return null;
  try { cache && cache.put('C_' + chainId, sec + '|' + f.getId(), 21600); } catch (e) {}
  return { secret: sec, root: f };
}

function claim_(chainId, secret, wantsHosted, allowSecond) {
  if (!/^[a-f0-9]{32,128}$/.test(secret)) return { ok: false, error: 'bad_secret' };
  var props = PropertiesService.getScriptProperties();
  var lk = LockService.getScriptLock();
  try { lk.waitLock(15000); } catch (e1) { return { ok: false, error: 'busy', message: 'Cloud is busy, retrying automatically.' }; }
  try {
    if (chain_(chainId)) return { ok: true };   // claimed meanwhile — the signature check decides
    var hasChain = props.getKeys().some(function (k) { return k.indexOf('SECRET_') === 0; });
    // A brand-new script becomes the shared cloud on its first one-tap request.
    if (!isHosted_() && !hasChain && wantsHosted) props.setProperty('HOSTED', '1');
    if (isHosted_()) {
      var dayKey = 'NEW_' + new Date().toISOString().slice(0, 10);
      var made = Number(props.getProperty(dayKey) || 0);
      if (made >= MAX_NEW_PER_DAY) return { ok: false, error: 'busy', message: 'Too many new salons today. Try again tomorrow.' };
      var parent = hostedParent_(true);
      var f = parent.createFolder(chainId);
      f.createFile('_auth', secret, 'text/plain');
      ['branches', 'backups', 'booking'].forEach(function (n) { f.createFolder(n); });
      props.setProperty(dayKey, String(made + 1));
      if (made === 0) props.getKeys().forEach(function (k) { if (k.indexOf('NEW_') === 0 && k !== dayKey) props.deleteProperty(k); });
      return { ok: true };
    }
    // Owner's own script: one salon only, so its link can never be reused for someone else's data.
    if (hasChain && !allowSecond) return { ok: false, error: 'taken', message: 'This script already belongs to another salon. Deploy a fresh copy.' };
    props.setProperty('SECRET_' + chainId, secret);
    var root = rootFolder_(chainId);
    ['branches', 'backups', 'booking'].forEach(function (n) { sub_(root, n); });
    return { ok: true };
  } finally { lk.releaseLock(); }
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  // JSON for the booking website (customers never open script.google.com).
  if (p.api) return json_(bookingApi_(String(p.s || p.book || '')));
  if (p.book) return bookingPage_(String(p.book));
  if (p.connect) return connectPage_();
  if (p.join) return joinPage_();
  return json_({ ok: true, app: 'SaloonBossX Cloud Bridge', version: VERSION, hint: 'Paste this URL into the app. Customers book at ?book=<chain>-<branch>.' });
}

function doPost(e) {
  // No global lock: every salon writes only its own files, so many salons can
  // sync at the same time. Shared read-modify-write steps lock locally.
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var action = String(body.action || '');
    var chainId = String(body.chainId || '');
    var branchId = String(body.branchId || '');
    // Public: the booking page's fallback when google.script.run is blocked.
    if (action === 'public_book') return json_(submitBooking(String(body.key || ''), body.form || {}));
    var ts = Number(body.ts || 0);
    var payloadStr = typeof body.payload === 'string' ? body.payload : JSON.stringify(body.payload || {});

    if (!/^[a-z0-9]{8,40}$/i.test(chainId)) return json_({ ok: false, error: 'bad_chain' });
    if (branchId && !/^[a-z0-9]{4,40}$/i.test(branchId)) return json_({ ok: false, error: 'bad_branch' });
    if (Math.abs(Date.now() - ts) > MAX_SKEW_MS) return json_({ ok: false, error: 'clock', message: 'Phone date/time is wrong. Fix it in phone settings.' });
    if (payloadStr.length > MAX_PAYLOAD) return json_({ ok: false, error: 'too_big', message: 'Backup is too large for the cloud.' });

    var payload = payloadStr ? JSON.parse(payloadStr) : {};
    var ch = chain_(chainId);
    if (!ch) {
      // First contact claims the salon (only "hello" from the owner's phone may do this).
      if (action !== 'hello' || !body.claimSecret) return json_({ ok: false, error: 'unknown_chain', message: 'Set up head office first.' });
      var claimed = claim_(chainId, String(body.claimSecret), !!payload.hosted, !!body.allowSecondChain);
      if (!claimed.ok) return json_(claimed);
      ch = chain_(chainId);
      if (!ch) return json_({ ok: false, error: 'busy', message: 'Cloud is busy, retrying automatically.' });
    }

    var expected = hmacHex_(action + '|' + chainId + '|' + branchId + '|' + ts + '|' + sha256Hex_(payloadStr), ch.secret);
    if (expected !== String(body.sig || '')) return json_({ ok: false, error: 'auth', message: 'Wrong join code / secret.' });

    var root = ch.root;

    switch (action) {
      case 'hello':          return json_(hello_(root, chainId, payload));
      case 'ping':           return json_({ ok: true, time: Date.now(), version: VERSION });
      case 'push_booking':   return json_(pushBookingProfile_(root, chainId, branchId, payload));
      case 'get_bookings':   return json_(getBookings_(root, branchId, payload));
      case 'push_summary':   return json_(pushSummary_(root, chainId, branchId, payload));
      case 'pull_branches':  return json_(pullBranches_(root));
      case 'push_backup':    return json_(pushBackup_(root, branchId, payload));
      case 'list_backups':   return json_(listBackups_(root, payload.all ? '' : cleanId_(payload.branchId || branchId)));
      case 'get_backup':     return json_(getBackup_(root, payload.fileId));
      case 'push_catalog':   return json_(pushCatalog_(root, payload));
      case 'get_catalog':    return json_(getCatalog_(root, Number(payload.since || 0)));
      case 'remove_branch':  return json_(removeBranch_(root, cleanId_(payload.branchId)));
      default:               return json_({ ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    var msg = String(err && err.message || err);
    if (/too many times|Service invoked|rate|quota/i.test(msg)) return json_({ ok: false, error: 'busy', message: 'Cloud is busy, retrying automatically.' });
    return json_({ ok: false, error: 'server', message: msg });
  }
}

// ── actions ─────────────────────────────────────────────────────────────────

function hello_(root, chainId, p) {
  // Shared (seller-hosted) cloud: no Sheet — the owner could not open it, and
  // their figures are encrypted anyway. Owner's own script: Sheet dashboard.
  if (isHosted_()) return { ok: true, version: VERSION, hosted: true };
  var sheet = dashboard_(root, chainId, p.chainName);
  return { ok: true, folderUrl: root.getUrl(), sheetUrl: sheet.getUrl(), version: VERSION };
}

function pushSummary_(root, chainId, branchId, p) {
  if (!branchId) return { ok: false, error: 'no_branch' };
  var dir = sub_(root, 'branches');
  if (isHosted_() && !dir.getFilesByName(branchId + '.json').hasNext() && countFiles_(dir) >= MAX_BRANCHES) return { ok: false, error: 'too_many', message: 'Too many branches for one salon.' };
  var record = { branchId: branchId, branchName: String(p.branchName || 'Branch'), receivedAt: new Date().toISOString(), summary: p.summary || {}, enc: p.enc || '' };
  writeFile_(dir, branchId + '.json', JSON.stringify(record), 'application/json');
  if (!p.enc) { try { updateSheet_(root, chainId, record); } catch (e) { /* sheet is a convenience — never fail a sync on it */ } }
  return { ok: true, receivedAt: record.receivedAt };
}

function pullBranches_(root) {
  var dir = sub_(root, 'branches');
  var it = dir.getFiles();
  var out = [];
  while (it.hasNext()) {
    var f = it.next();
    if (f.isTrashed() || !/\.json$/.test(f.getName())) continue;
    try { out.push(JSON.parse(f.getBlob().getDataAsString('UTF-8'))); } catch (e) {}
  }
  return { ok: true, branches: out, serverTime: new Date().toISOString() };
}

function pushBackup_(root, branchId, p) {
  if (!branchId || !p.data) return { ok: false, error: 'empty' };
  var base = sub_(root, 'backups');
  if (isHosted_() && !base.getFoldersByName(branchId).hasNext() && countFolders_(base) >= MAX_BRANCHES) return { ok: false, error: 'too_many', message: 'Too many branches for one salon.' };
  var dir = sub_(base, branchId);
  var name = String(p.name || ('backup_' + new Date().toISOString().slice(0, 10))) + '.sbx';
  // Shared cloud: one file per weekday, overwritten in place — 7 days of
  // history and nothing piling up in Drive's trash.
  if (isHosted_()) {
    var label = String(p.label || '').replace(/[^A-Za-z0-9-]+/g, '-').slice(0, 30);
    name = 'backup-' + ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date().getDay()] + (label ? '_' + label : '') + '.sbx';
  }
  writeFile_(dir, name, String(p.data), 'text/plain');
  // keep the newest KEEP_BACKUPS
  var files = [], it = dir.getFiles();
  while (it.hasNext()) { var f = it.next(); if (!f.isTrashed()) files.push(f); }
  files.sort(function (a, b) { return b.getLastUpdated().getTime() - a.getLastUpdated().getTime(); });
  var keep = isHosted_() ? Math.min(7, KEEP_BACKUPS) : KEEP_BACKUPS;   // shared cloud: last 7 days
  for (var i = keep; i < files.length; i++) files[i].setTrashed(true);
  return { ok: true, name: name, kept: Math.min(files.length, keep) };
}

function listBackups_(root, branchId) {
  var base = sub_(root, 'backups');
  var out = [];
  var dirs = branchId ? [sub_(base, branchId)] : (function () { var a = [], it = base.getFolders(); while (it.hasNext()) a.push(it.next()); return a; })();
  dirs.forEach(function (dir) {
    var it = dir.getFiles();
    while (it.hasNext()) {
      var f = it.next();
      if (f.isTrashed()) continue;
      out.push({ id: f.getId(), name: f.getName(), branchId: dir.getName(), size: f.getSize(), updated: f.getLastUpdated().toISOString() });
    }
  });
  out.sort(function (a, b) { return a.updated < b.updated ? 1 : -1; });
  return { ok: true, backups: out.slice(0, 60) };
}

function getBackup_(root, fileId) {
  if (!fileId) return { ok: false, error: 'no_file' };
  var f = DriveApp.getFileById(String(fileId));
  // Only files inside this chain's folder may be read.
  var parents = f.getParents(), inside = false;
  while (parents.hasNext()) {
    var p = parents.next(), gp = p.getParents();
    while (gp.hasNext()) { var g = gp.next(); if (g.getName() === 'backups') { var ggp = g.getParents(); while (ggp.hasNext()) if (ggp.next().getId() === root.getId()) inside = true; } }
  }
  if (!inside) return { ok: false, error: 'forbidden' };
  return { ok: true, name: f.getName(), data: f.getBlob().getDataAsString('UTF-8') };
}

function pushCatalog_(root, p) {
  var version = Date.now();
  writeFile_(root, 'catalog.json', JSON.stringify({ version: version, note: String(p.note || ''), services: p.services || [], pushedAt: new Date().toISOString() }), 'application/json');
  return { ok: true, version: version };
}

function getCatalog_(root, since) {
  var it = root.getFilesByName('catalog.json');
  if (!it.hasNext()) return { ok: true, changed: false };
  var c = JSON.parse(it.next().getBlob().getDataAsString('UTF-8'));
  if (Number(c.version || 0) <= since) return { ok: true, changed: false, version: c.version };
  return { ok: true, changed: true, catalog: c };
}

function removeBranch_(root, branchId) {
  if (!branchId) return { ok: false };
  var it = sub_(root, 'branches').getFilesByName(branchId + '.json');
  while (it.hasNext()) it.next().setTrashed(true);
  return { ok: true };
}

// ── Google Sheet dashboard ──────────────────────────────────────────────────

function dashboard_(root, chainId, name) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SHEET_' + chainId);
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) {} }
  // Set up from the template Sheet? Use that same Sheet as the dashboard.
  var bound = props.getProperty('SHEET_DEFAULT'), ss = null, b;
  if (bound) { try { ss = SpreadsheetApp.openById(bound); } catch (e) { ss = null; } }
  if (ss) {
    b = ss.getSheetByName('Branches') || ss.insertSheet('Branches');
    if (b.getLastRow() > 0) { if (!ss.getSheetByName('Daily')) { var d0 = ss.insertSheet('Daily'); d0.appendRow(['Date', 'Branch', 'Revenue', 'Bills']); } props.setProperty('SHEET_' + chainId, ss.getId()); return ss; }
  } else {
    ss = SpreadsheetApp.create((name ? name + ' — ' : '') + 'SaloonBossX HQ Dashboard');
    DriveApp.getFileById(ss.getId()).moveTo(root);
    b = ss.getSheets()[0];
    b.setName('Branches');
  }
  b.appendRow(['Branch', 'City', 'Last sync', 'Today revenue', 'Today bills', 'Month revenue', 'Month bills', 'Month expenses', 'Month profit', 'Avg bill', 'Pending dues', 'Low-stock items', 'Staff present today', 'Alerts']);
  b.setFrozenRows(1);
  b.getRange(1, 1, 1, 14).setFontWeight('bold').setBackground('#111111').setFontColor('#D9A441');
  b.getRange(1, 16).setValue('key');
  b.hideColumns(15, 2);
  var d = ss.getSheetByName('Daily') || ss.insertSheet('Daily');
  if (d.getLastRow() === 0) d.appendRow(['Date', 'Branch', 'Revenue', 'Bills']);
  d.setFrozenRows(1);
  d.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#111111').setFontColor('#D9A441');
  props.setProperty('SHEET_' + chainId, ss.getId());
  return ss;
}

function updateSheet_(root, chainId, rec) {
  var ss = dashboard_(root, chainId);
  var s = rec.summary || {}, t = s.today || {}, m = s.month || {};
  var row = [
    rec.branchName, s.city || '', new Date(),
    t.revenue || 0, t.bills || 0, m.revenue || 0, m.bills || 0, m.expenses || 0, m.profit || 0, m.avgBill || 0,
    (s.dues && s.dues.amount) || 0, (s.lowStock || []).length,
    s.attendanceToday ? (s.attendanceToday.present + '/' + s.attendanceToday.total) : '',
    (s.alerts || []).map(function (a) { return a.title; }).join(' | '),
  ];
  var sh = ss.getSheetByName('Branches');
  var ids = sh.getRange(1, 16, Math.max(1, sh.getLastRow()), 1).getValues(); // hidden key column P
  var at = -1;
  for (var i = 1; i < ids.length; i++) if (ids[i][0] === rec.branchId) { at = i + 1; break; }
  if (at < 0) { sh.appendRow(row.concat(['', rec.branchId])); }
  else { sh.getRange(at, 1, 1, row.length).setValues([row]); }

  var daily = ss.getSheetByName('Daily');
  var recent = (s.daily || []).slice(-7);
  if (recent.length) {
    var last = daily.getLastRow();
    var existing = last > 1 ? daily.getRange(2, 1, last - 1, 2).getDisplayValues() : [];
    var index = {};
    for (var j = 0; j < existing.length; j++) index[existing[j][0] + '|' + existing[j][1]] = j + 2;
    recent.forEach(function (r) {
      var key = r.date + '|' + rec.branchName;
      if (index[key]) daily.getRange(index[key], 3, 1, 2).setValues([[r.revenue || 0, r.bills || 0]]);
      else daily.appendRow([r.date, rec.branchName, r.revenue || 0, r.bills || 0]);
    });
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

function rootFolder_(chainId) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('ROOT_' + chainId);
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var parentId = props.getProperty('CLOUD_PARENT'), parent = null;
  if (parentId) { try { parent = DriveApp.getFolderById(parentId); } catch (e) { parent = null; } }
  if (!parent) { parent = DriveApp.createFolder('SaloonBossX Cloud'); props.setProperty('CLOUD_PARENT', parent.getId()); }
  var f = parent.createFolder(chainId);
  props.setProperty('ROOT_' + chainId, f.getId());
  return f;
}

function countFiles_(dir) { var n = 0, it = dir.getFiles(); while (it.hasNext()) { if (!it.next().isTrashed()) n++; } return n; }
function countFolders_(dir) { var n = 0, it = dir.getFolders(); while (it.hasNext()) { it.next(); n++; } return n; }

function sub_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function writeFile_(dir, name, content, mime) {
  var it = dir.getFilesByName(name);
  if (it.hasNext()) { var f = it.next(); f.setContent(content); return f; }
  return dir.createFile(name, content, mime);
}

function hex_(bytes) {
  return bytes.map(function (b) { var v = (b < 0 ? b + 256 : b).toString(16); return v.length === 1 ? '0' + v : v; }).join('');
}
function sha256Hex_(s) { return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)); }
function hmacHex_(msg, key) { return hex_(Utilities.computeHmacSha256Signature(msg, key, Utilities.Charset.UTF_8)); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }


// ═══════════════════════════════════════════════════════════════════════════
// ONLINE BOOKING — public page customers open from WhatsApp, Instagram,
// Google Maps or a QR at the counter:  <web app URL>?book=<branchId>
//
// The salon phone publishes its menu, opening hours and BUSY time blocks
// (never client names) with every sync. Customers send a booking REQUEST;
// the salon confirms it in the app, which sends the WhatsApp confirmation.
// Request-then-confirm is deliberate: the phone works offline, so the page
// can only know busy slots as of the last sync — this never double-books.
// ═══════════════════════════════════════════════════════════════════════════

var MAX_PENDING = 80;          // per branch, unsynced
var MAX_PER_PHONE_DAY = 3;

/** "<chain>-<branch>" → that salon's folder; a bare "<branch>" (v2/v3 links) → the only salon on this script. */
function resolveBooking_(key) {
  key = String(key || '').replace(/[^a-z0-9-]/gi, '').slice(0, 90);
  var parts = key.split('-');
  if (parts.length === 2) {
    var ch = null;
    try { ch = chain_(parts[0]); } catch (e) { ch = null; }
    return { root: ch ? ch.root : null, branchId: cleanId_(parts[1]) };
  }
  return { root: onlyRoot_(), branchId: parts[0] };
}

function onlyRoot_() {
  if (isHosted_()) return null;   // shared cloud: a link must name its salon
  var props = PropertiesService.getScriptProperties();
  var keys = props.getKeys().filter(function (k) { return k.indexOf('ROOT_') === 0; });
  if (keys.length !== 1) return null;
  try { return DriveApp.getFolderById(props.getProperty(keys[0])); } catch (e) { return null; }
}

function readJson_(dir, name, fallback) {
  var it = dir.getFilesByName(name);
  if (!it.hasNext()) return fallback;
  try { return JSON.parse(it.next().getBlob().getDataAsString('UTF-8')); } catch (e) { return fallback; }
}

function pushBookingProfile_(root, chainId, branchId, p) {
  if (!branchId) return { ok: false, error: 'no_branch' };
  p.updatedAt = new Date().toISOString();
  var json = JSON.stringify(p);
  if (json.length > 400000) return { ok: false, error: 'too_big', message: 'Too many services for the booking page.' };
  var dir = sub_(root, 'booking');
  if (isHosted_() && !dir.getFilesByName(branchId + '.profile.json').hasNext() && countFiles_(dir) >= MAX_BRANCHES * 2) return { ok: false, error: 'too_many' };
  writeFile_(dir, branchId + '.profile.json', json, 'application/json');
  var slug = p.slug ? registerSlug_(root, chainId, branchId, p.slug) : '';
  return { ok: true, slug: slug };
}

/** A request still holding its slot (not yet accepted into the calendar or declined). */
function holdsSlot_(r) { return r.status === 'new' || r.status === 'sent' || r.status === 'synced'; }

/**
 * The phone collects new requests. Delivery is acknowledged on the NEXT call
 * (p.ack), and only then are the customer's name and number wiped — a reply
 * lost on a bad network can never lose a booking. p.resolved tells the cloud
 * which requests were accepted / declined so their slots free up.
 * Apps before 5.3 send no p.ack: they get the old deliver-once behaviour.
 */
function getBookings_(root, branchId, p) {
  if (!branchId) return { ok: false, error: 'no_branch' };
  var dir = sub_(root, 'booking');
  var name = branchId + '.requests.json';
  var acking = Object.prototype.toString.call(p.ack) === '[object Array]';
  var ack = acking ? p.ack.map(String) : [];
  var resolved = Object.prototype.toString.call(p.resolved) === '[object Array]' ? p.resolved : [];
  var cutoff = Date.now() - 30 * 86400000;
  var peek = readJson_(dir, name, { requests: [] });
  var pending = peek.requests.filter(function (r) { return r.status === 'new' || r.status === 'sent'; });
  var stale = peek.requests.some(function (r) { return Date.parse(r.createdAt) <= cutoff; });
  // Nothing to change → answer without taking the lock (most polls).
  if (!pending.length && !ack.length && !resolved.length && !stale) return { ok: true, requests: [] };

  var lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch (e) { return { ok: false, error: 'busy', message: 'Cloud is busy, retrying automatically.' }; }
  try {
    var data = readJson_(dir, name, { requests: [] });
    var byId = {};
    data.requests.forEach(function (r) { byId[r.id] = r; });
    var scrub = function (r) { if (r.name || r.phone) { r.pk = r.pk || sha256Hex_(String(r.phone)).slice(0, 16); r.name = ''; r.phone = ''; r.note = ''; } };
    ack.forEach(function (id) { var r = byId[id]; if (r && (r.status === 'sent' || r.status === 'new')) { r.status = 'synced'; scrub(r); } });
    resolved.forEach(function (x) {
      var r = x && byId[String(x.id)];
      if (r && (x.status === 'accepted' || x.status === 'declined')) { r.status = x.status; scrub(r); }
    });
    var out = JSON.parse(JSON.stringify(data.requests.filter(function (r) { return r.status === 'new' || r.status === 'sent'; })));
    data.requests.forEach(function (r) {
      if (r.status === 'new') r.status = acking ? 'sent' : 'synced';
      if (!acking && r.status === 'synced') scrub(r);
    });
    data.requests = data.requests.filter(function (r) { return Date.parse(r.createdAt) > cutoff; });
    writeFile_(dir, name, JSON.stringify(data), 'application/json');
    return { ok: true, requests: out, acks: true };
  } finally { try { lock.releaseLock(); } catch (e2) {} }
}

/** Called from the booking page with google.script.run. Public, so validate everything. */
function submitBooking(branchId, f) {
  branchId = keyFor_(branchId);
  var lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch (e) { return { ok: false, message: 'Busy, please try again.' }; }
  try {
    var rb = resolveBooking_(branchId);
    var root = rb.root;
    branchId = rb.branchId;
    if (!root) return { ok: false, message: 'Online booking is not set up yet.' };
    var dir = sub_(root, 'booking');
    var prof = readJson_(dir, branchId + '.profile.json', null);
    if (!prof || !prof.enabled) return { ok: false, message: 'This salon is not taking online bookings right now.' };
    f = f || {};
    if (f.website) return { ok: true, ref: 'OK' };                       // honeypot: bots fill hidden fields
    var name = String(f.name || '').trim().slice(0, 60);
    var phone = bookingPhone_(prof, f.phone);
    if (name.length < 2) return { ok: false, message: 'Please enter your name.' };
    if (!phone) return { ok: false, message: 'Please enter a valid mobile number.' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(f.date)) || !/^\d{2}:\d{2}$/.test(String(f.time))) return { ok: false, message: 'Please pick a date and time.' };
    var keys = (f.services || []).map(String).slice(0, 6);
    var svcs = (prof.services || []).filter(function (s) { return keys.indexOf(String(s.key)) >= 0; });
    if (!svcs.length) return { ok: false, message: 'Please choose at least one service.' };
    var duration = svcs.reduce(function (a, s) { return a + (Number(s.duration) || 30); }, 0);
    // The page only OFFERS valid slots; a crafted request must not get past
    // the published hours, closed days, lead time, booking window or staff list.
    var staffId = Number(f.staffId) || 0;
    var timeErr = bookingTimeError_(prof, String(f.date), String(f.time), duration, staffId);
    if (timeErr) return { ok: false, message: timeErr };

    var name2 = branchId + '.requests.json';
    var data = readJson_(dir, name2, { requests: [] });
    var today = istDate_(Date.now(), prof);
    var pending = data.requests.filter(function (r) { return r.status === 'new' || r.status === 'sent'; }).length;
    if (pending >= MAX_PENDING) return { ok: false, message: 'The salon has many pending requests. Please call or WhatsApp them.' };
    var pk = sha256Hex_(phone).slice(0, 16);
    // createdAt is UTC; compare the INDIA date it falls on (UTC 20:00 is already tomorrow in IST).
    var mine = data.requests.filter(function (r) { return (r.phone === phone || r.pk === pk) && istDate_(Date.parse(r.createdAt), prof) === today; }).length;
    if (mine >= MAX_PER_PHONE_DAY) return { ok: false, message: 'You have already sent requests today. The salon will contact you soon.' };
    if (!slotFree_(prof, data.requests, String(f.date), String(f.time), duration, staffId)) {
      return { ok: false, message: 'Sorry, that time was just taken. Please pick another slot.' };
    }
    var ref = 'B' + Utilities.getUuid().replace(/-/g, '').slice(0, 7).toUpperCase();
    data.requests.push({
      id: ref, status: 'new', createdAt: new Date().toISOString(),
      name: name, phone: phone, note: String(f.note || '').slice(0, 200),
      services: svcs.map(function (s) { return { key: s.key, name: s.name, price: s.price, duration: s.duration }; }),
      staffId: staffId, date: String(f.date), time: String(f.time), duration: duration,
    });
    writeFile_(dir, name2, JSON.stringify(data), 'application/json');
    return { ok: true, ref: ref };
  } catch (err) {
    return { ok: false, message: 'Something went wrong. Please WhatsApp the salon.' };
  } finally { try { lock.releaseLock(); } catch (e3) {} }
}

function toMin_(t) { var a = String(t).split(':'); return Number(a[0]) * 60 + Number(a[1]); }

/**
 * The salon's UTC offset in minutes, published by the app (universal edition).
 * Profiles published by older apps carry none: India (+330) as before.
 */
function tzMin_(prof) { var t = Number(prof && prof.tzMin); return isFinite(t) && Math.abs(t) <= 840 ? t : 330; }

/** "YYYY-MM-DD" in the salon's local time for a UTC millisecond timestamp. */
function istDate_(ms, prof) { return new Date(Number(ms) + tzMin_(prof) * 60000).toISOString().slice(0, 10); }

/**
 * Customer's mobile for the salon's country, as national digits; a foreign
 * number in full international form is kept with its country code.
 * Returns '' when it cannot be a phone number. India keeps its strict check.
 */
function bookingPhone_(prof, raw) {
  var dial = String((prof && prof.dial) || '91');
  var len = (prof && prof.phoneLen && prof.phoneLen.length === 2) ? prof.phoneLen : [10, 10];
  var s = String(raw || '').trim();
  var p = s.replace(/\D/g, '').replace(/^00/, '');
  var intl = s.charAt(0) === '+' || /^\s*00/.test(s);
  var ok = function (x) { return x.length >= len[0] && x.length <= len[1] && (dial !== '91' || /^[6-9]/.test(x)); };
  if (dial && p.indexOf(dial) === 0 && ok(p.slice(dial.length)) && (intl || p.length > len[1])) return p.slice(dial.length);
  if (!intl && p.charAt(0) === '0' && ok(p.slice(1))) return p.slice(1);
  if (!intl && ok(p)) return p;
  if (intl && p.length >= 8 && p.length <= 15) return '+' + p;
  return '';
}

/**
 * Server-side check of a public booking against the salon's PUBLISHED profile
 * (all times are India time). Returns '' when fine, else a message for the
 * customer. Checks: real calendar date, real HH:MM, not a closed day, inside
 * opening hours for the whole service duration, at least leadMin minutes from
 * now, within maxDays, and a staff id that is really on the published list.
 */
function bookingTimeError_(prof, date, time, duration, staffId) {
  var dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date));
  var tm = /^(\d{2}):(\d{2})$/.exec(String(time));
  if (!dm || !tm) return 'Please pick a date and time.';
  var y = Number(dm[1]), mo = Number(dm[2]), d = Number(dm[3]);
  var day = new Date(Date.UTC(y, mo - 1, d));
  if (day.getUTCFullYear() !== y || day.getUTCMonth() !== mo - 1 || day.getUTCDate() !== d) return 'Please pick a valid date.';
  if (Number(tm[1]) > 23 || Number(tm[2]) > 59) return 'Please pick a valid time.';

  var hours = prof.hours || {};
  var closed = Object.prototype.toString.call(hours.closedDays) === '[object Array]' ? hours.closedDays.map(Number) : [];
  if (closed.indexOf(day.getUTCDay()) >= 0) return 'The salon is closed on that day. Please pick another day.';

  var start = toMin_(time);
  var okHm = function (v) { return /^\d{2}:\d{2}$/.test(String(v || '')); };
  if (okHm(hours.open) && okHm(hours.close)) {
    var open = toMin_(hours.open), close = toMin_(hours.close);
    if (close <= open) close += 1440;             // open past midnight
    if (start < open || start + duration > close) {
      return 'Please pick a time between ' + hours.open + ' and ' + hours.close + ' (your services take ' + duration + ' min).';
    }
  }

  var ist = new Date(Date.now() + tzMin_(prof) * 60000);
  var todayUtc = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  var dayDiff = Math.round((day.getTime() - todayUtc) / 86400000);
  var minsAhead = dayDiff * 1440 + start - (ist.getUTCHours() * 60 + ist.getUTCMinutes());
  if (minsAhead < 0) return 'That time has already passed. Please pick a later time.';
  var lead = Math.max(0, Number(prof.leadMin) || 0);
  if (minsAhead < lead) return 'Please book at least ' + lead + ' minutes ahead.';
  var maxDays = Math.max(0, Number(prof.maxDays) || 14);
  if (dayDiff > maxDays) return 'Online booking is open only ' + maxDays + ' days ahead.';

  if (staffId) {
    var known = (prof.staff || []).some(function (x) { return Number(x && x.id) === staffId; });
    if (!known) return 'Please choose a stylist from the list.';
  }
  return '';
}

/** Free if, for the chosen stylist (or "any"), fewer bookings overlap than there are stylists. */
function slotFree_(prof, requests, date, time, duration, staffId) {
  var s = toMin_(time), e = s + duration;
  var blocks = ((prof.busy || {})[date] || []).slice();
  requests.forEach(function (r) { if (r.date === date && holdsSlot_(r)) blocks.push({ s: r.time, e: null, d: r.duration, staff: r.staffId || 0 }); });
  var overlaps = function (b) { var bs = toMin_(b.s), be = b.e ? toMin_(b.e) : bs + (Number(b.d) || 30); return bs < e && s < be; };
  var staffN = Math.max(1, (prof.staff || []).length);
  if (staffId) return !blocks.some(function (b) { return overlaps(b) && (b.staff === staffId); });
  return blocks.filter(overlaps).length < staffN;
}

// ── short links: /glow-beauty-vashi → <chain>-<branch> ─────────────────────
function slugsDir_(create) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SLUGS_DIR');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  if (!create) return null;   // public requests never create folders
  var parent = isHosted_() ? hostedParent_(true) : null;
  var f = parent ? parent.createFolder('_links') : DriveApp.createFolder('SaloonBossX booking links');
  props.setProperty('SLUGS_DIR', f.getId());
  return f;
}
function cleanSlug_(v) {
  return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}
function slugKey_(slug) {
  slug = cleanSlug_(slug);
  if (!slug) return '';
  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (e) {}
  var c = cache && cache.get('S_' + slug);
  if (c) return c;
  var dir = slugsDir_(false);
  if (!dir) return '';
  var it = dir.getFilesByName(slug);
  if (!it.hasNext()) return '';
  var key = String(it.next().getBlob().getDataAsString('UTF-8')).trim();
  try { cache && cache.put('S_' + slug, key, 21600); } catch (e) {}
  return key;
}
/** Give this branch its short link (first free of name, name-2 … name-9). Old links keep working. */
function registerSlug_(root, chainId, branchId, wanted) {
  var key = chainId + '-' + branchId;
  var base = cleanSlug_(wanted);
  if (base.length < 3 || /^(api|admin|book|www|help|app|saloonbossx)$/.test(base)) return '';
  // A link name may never look like a salon key — it could hijack that salon's bookings.
  if (/^[a-z0-9]{8,40}-[a-z0-9]{1,40}(-\d)?$/.test(base) && /\d/.test(base) && !/[g-z]/.test(base.replace(/-/g, ''))) return '';
  if (/^[a-z0-9]{8,40}-[a-z0-9]{4,40}$/.test(base) && chain_(base.split('-')[0])) return '';
  for (var i = 1; i <= 9; i++) {
    var slug = i === 1 ? base : base + '-' + i;
    var cur = slugKey_(slug);
    if (cur === key) return slug;
    if (cur) continue;
    var lock = LockService.getScriptLock();
    try { lock.waitLock(10000); } catch (e) { return ''; }
    try {
      if (slugKey_(slug)) continue;
      var mine = sub_(root, 'booking');
      var listName = branchId + '.links';
      var list = String(readText_(mine, listName) || '').split(',').filter(String);
      if (list.length >= 5) return list[list.length - 1];   // abuse guard: 5 links per branch
      slugsDir_(true).createFile(slug, key, 'text/plain');
      list.push(slug);
      writeFile_(mine, listName, list.join(','), 'text/plain');
      return slug;
    } finally { lock.releaseLock(); }
  }
  return '';
}
function readText_(dir, name) {
  var it = dir.getFilesByName(name);
  return it.hasNext() ? it.next().getBlob().getDataAsString('UTF-8') : '';
}

/** A real "<chain>-<branch>" key wins over any link name; otherwise look up the short link. */
function keyFor_(sOrKey) {
  var raw = String(sOrKey || '').replace(/[^a-z0-9-]/gi, '').slice(0, 90);
  var m = raw.match(/^([a-z0-9]{8,40})-([a-z0-9]{4,40})$/i);
  if (m && chain_(m[1])) return raw;
  return slugKey_(raw) || raw;
}

/** Short link or "<chain>-<branch>" (or a bare branch on an owner's own script) → the salon. */
function bookingData_(sOrKey) {
  var key = keyFor_(sOrKey);
  var rb = resolveBooking_(key);
  var branchId = rb.branchId, root = rb.root;
  var prof = root && branchId ? readJson_(sub_(root, 'booking'), branchId + '.profile.json', null) : null;
  var pend = root && branchId ? readJson_(sub_(root, 'booking'), branchId + '.requests.json', { requests: [] }).requests : [];
  var taken = pend.filter(holdsSlot_).map(function (r) { return { date: r.date, s: r.time, d: r.duration, staff: r.staffId || 0 }; });
  return { key: key, profile: prof && prof.enabled ? prof : null, taken: taken };
}

function bookingApi_(sOrKey) {
  var d = bookingData_(sOrKey);
  if (!d.profile) return { ok: false, error: 'not_found', message: 'This booking link is not active.' };
  return { ok: true, key: d.key, profile: d.profile, taken: d.taken, version: VERSION };
}

function bookingPage_(bookKey) {
  var d = bookingData_(bookKey);
  bookKey = d.key;
  var prof = d.profile, taken = d.taken;
  var safe = function (o) { return JSON.stringify(o).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026'); };
  // Function replacements: a "$&" in a salon's note must not be read as a regex token.
  var html = BOOKING_HTML
    .replace('__PROFILE__', function () { return safe(prof); })
    .replace('__TAKEN__', function () { return safe(taken); })
    .replace('__BRANCH__', function () { return safe(String(bookKey || '').replace(/[^a-z0-9-]/gi, '').slice(0, 90)); })
    .replace('__URL__', function () { var u = ''; try { u = ScriptApp.getService().getUrl(); } catch (e) {} return safe(u); });
  return HtmlService.createHtmlOutput(html)
    .setTitle(prof && prof.salonName ? prof.salonName + ' — Book online' : 'Book online')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

var BOOKING_HTML = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
'*{box-sizing:border-box}body{margin:0;font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f5fb;color:#17151f}' +
'.hero{background:#0b0b0b;color:#fff;padding:22px 18px 18px}.hero h1{margin:0;font-size:22px}.hero p{margin:6px 0 0;color:#cfc8b8;font-size:13px}.gold{color:#d9a441}' +
'.wrap{max-width:560px;margin:0 auto;padding:14px}.card{background:#fff;border-radius:16px;padding:14px;margin-bottom:12px;box-shadow:0 2px 10px rgba(30,20,60,.06)}' +
'h2{font-size:13px;letter-spacing:.8px;text-transform:uppercase;color:#8b8698;margin:0 0 10px}' +
'.svc{display:flex;align-items:center;gap:10px;padding:10px 4px;border-bottom:1px solid #f0eef6;cursor:pointer}.svc:last-child{border:0}.svc input{width:20px;height:20px;accent-color:#6d4aff}' +
'.svc .n{flex:1;font-weight:600}.svc .m{color:#8b8698;font-size:12px}.svc .p{font-weight:800}' +
'.chips{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px}.chip{flex:0 0 auto;border:1.5px solid #e4e1ee;border-radius:12px;padding:8px 10px;text-align:center;background:#fff;cursor:pointer;min-width:58px}' +
'.chip.on{background:#6d4aff;color:#fff;border-color:#6d4aff}.chip.off{opacity:.35;pointer-events:none}.chip small{display:block;font-size:11px;opacity:.8}' +
'.slots{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.slot{border:1.5px solid #e4e1ee;border-radius:10px;padding:9px 0;text-align:center;font-weight:700;background:#fff;cursor:pointer;font-size:14px}' +
'.slot.on{background:#6d4aff;color:#fff;border-color:#6d4aff}' +
'input[type=text],input[type=tel],select,textarea{width:100%;padding:12px;border:1.5px solid #e4e1ee;border-radius:12px;font-size:16px;margin-bottom:10px;background:#fff;font-family:inherit}' +
'.btn{width:100%;padding:15px;border:0;border-radius:14px;background:#6d4aff;color:#fff;font-size:16px;font-weight:800;cursor:pointer}.btn:disabled{opacity:.5}' +
'.sum{display:flex;justify-content:space-between;font-weight:700;margin-bottom:10px}.muted{color:#8b8698;font-size:12.5px}.err{color:#e5484d;font-weight:700;margin:8px 0}' +
'.ok{text-align:center;padding:30px 10px}.ok .big{font-size:54px}.wa{display:inline-block;margin-top:14px;background:#25d366;color:#fff;padding:12px 18px;border-radius:12px;text-decoration:none;font-weight:800}' +
'.cat{font-size:12px;font-weight:800;color:#6d4aff;margin:12px 0 2px;text-transform:uppercase;letter-spacing:.6px}.hp{position:absolute;left:-9999px}.foot{text-align:center;color:#b8b4c6;font-size:11px;padding:14px}' +
'</style></head><body><div id="app"></div><script>' +
'var P=__PROFILE__,T=__TAKEN__,B=__BRANCH__,U=__URL__;var S={svc:{},date:"",time:"",staff:0};' +
'function $(h){document.getElementById("app").innerHTML=h}function esc(x){return String(x==null?"":x).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c]})}' +
'function pad(n){return(n<10?"0":"")+n}function ymd(d){return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate())}function mm(t){var a=t.split(":");return+a[0]*60+ +a[1]}function hm(m){return pad(Math.floor(m/60))+":"+pad(m%60)}' +
'function dur(){var d=0;P.services.forEach(function(s){if(S.svc[s.key])d+=+s.duration||30});return d}function tot(){var d=0;P.services.forEach(function(s){if(S.svc[s.key])d+=+s.price||0});return d}' +
'function free(date,t,d){var s=mm(t),e=s+d;var bl=((P.busy||{})[date]||[]).map(function(b){return{s:mm(b.s),e:b.e?mm(b.e):mm(b.s)+30,staff:b.staff||0}});' +
'T.forEach(function(r){if(r.date===date)bl.push({s:mm(r.s),e:mm(r.s)+(+r.d||30),staff:r.staff||0})});var ov=function(b){return b.s<e&&s<b.e};' +
'if(S.staff)return!bl.some(function(b){return ov(b)&&b.staff===S.staff});return bl.filter(ov).length<Math.max(1,(P.staff||[]).length)}' +
'function slots(){if(!S.date)return[];var d=dur()||30,o=mm(P.hours.open),c=mm(P.hours.close),st=+P.slot||30,out=[];var now=new Date(),lead=(+P.leadMin||60);' +
'for(var m=o;m+d<=c;m+=st){var t=hm(m);if(S.date===ymd(now)&&m<now.getHours()*60+now.getMinutes()+lead)continue;if(free(S.date,t,d))out.push(t)}return out}' +
'function render(err){if(!P){$("<div class=hero><h1>Online booking</h1><p>This salon is not taking online bookings right now.</p></div>");return}' +
'var h="<div class=hero><h1>"+esc(P.salonName)+"</h1><p>"+esc([P.address,P.city].filter(Boolean).join(", "))+"</p><p class=gold>Book online · confirmed on WhatsApp</p>"+(/^https:\\/\\//.test(P.reviewUrl||"")?"<p><a href=\\""+esc(P.reviewUrl)+"\\" target=_blank style=\\"color:#fff;font-weight:700\\">★ See our Google reviews</a></p>":"")+"</div><div class=wrap>";' +
'h+="<div class=card><h2>1 · Choose services</h2>";var lc="";P.services.forEach(function(s){if(s.category&&s.category!==lc){lc=s.category;h+="<div class=cat>"+esc(lc)+"</div>"}h+="<label class=svc><input type=checkbox "+(S.svc[s.key]?"checked":"")+" onchange=\\"S.svc[\'"+s.key+"\']=this.checked;S.time=\'\';render()\\"><span class=n>"+esc(s.name)+"<div class=m>"+(+s.duration||30)+" min</div></span><span class=p>₹"+(+s.price||0).toLocaleString("en-IN")+"</span></label>"});h+="</div>";' +
'if((P.staff||[]).length>1){h+="<div class=card><h2>2 · Stylist (optional)</h2><select onchange=\\"S.staff=+this.value;S.time=\'\';render()\\"><option value=0>Anyone available</option>";P.staff.forEach(function(x){h+="<option value="+x.id+(S.staff===x.id?" selected":"")+">"+esc(x.name)+"</option>"});h+="</select></div>"}' +
'h+="<div class=card><h2>3 · Date</h2><div class=chips>";var D=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];for(var i=0;i<(+P.maxDays||14);i++){var d=new Date();d.setDate(d.getDate()+i);var k=ymd(d),off=(P.hours.closedDays||[]).indexOf(d.getDay())>=0;' +
'h+="<div class=\\"chip"+(S.date===k?" on":"")+(off?" off":"")+"\\" onclick=\\"S.date=\'"+k+"\';S.time=\'\';render()\\"><small>"+(i===0?"Today":i===1?"Tomorrow":D[d.getDay()])+"</small><b>"+d.getDate()+"</b></div>"}h+="</div></div>";' +
'if(S.date){var sl=dur()?slots():[];h+="<div class=card><h2>4 · Time</h2>"+(!dur()?"<div class=muted>Choose a service first.</div>":sl.length?"<div class=slots>"+sl.map(function(t){return"<div class=\\"slot"+(S.time===t?" on":"")+"\\" onclick=\\"S.time=\'"+t+"\';render()\\">"+t+"</div>"}).join("")+"</div>":"<div class=muted>No free time on this day. Try another date.</div>")+"</div>"}' +
'if(S.time){h+="<div class=card><h2>5 · Your details</h2><input id=nm type=text placeholder=\\"Your name\\" value=\\""+esc(S.name||"")+"\\" oninput=\\"S.name=this.value\\"><input id=ph type=tel inputmode=numeric placeholder=\\"Mobile number (WhatsApp)\\" value=\\""+esc(S.phone||"")+"\\" oninput=\\"S.phone=this.value\\"><textarea id=nt rows=2 placeholder=\\"Note for the salon (optional)\\" oninput=\\"S.note=this.value\\">"+esc(S.note||"")+"</textarea><input class=hp id=web tabindex=-1 autocomplete=off>' +
'<div class=sum><span>"+S.date+" · "+S.time+" · "+dur()+" min</span><span>"+(P.sym||"₹")+tot().toLocaleString(P.locale||"en-IN")+"</span></div>"+(err?"<div class=err>"+esc(err)+"</div>":"")+"<button class=btn id=go onclick=\\"send()\\">Request booking</button><p class=muted>The salon confirms on WhatsApp. Pay at the salon.</p></div>"}' +
'if(P.note)h+="<p class=muted style=\\"text-align:center\\">"+esc(P.note)+"</p>";h+="</div><div class=foot>Powered by SaloonBossX</div>";$(h)}' +
'function send(){var b=document.getElementById("go");b.disabled=true;b.textContent="Sending…";var keys=Object.keys(S.svc).filter(function(k){return S.svc[k]});' +
'var f={services:keys,date:S.date,time:S.time,staffId:S.staff,name:S.name,phone:S.phone,note:S.note,website:document.getElementById("web").value};' +
// google.script.run can fail when the phone browser is signed in to several
// Google accounts; then the request goes as a plain POST to the same script.
'var post=function(){try{fetch(U,{method:"POST",body:JSON.stringify({action:"public_book",key:B,form:f})}).then(function(x){return x.json()}).then(done,function(){render("Network problem. Please try again, or WhatsApp the salon.")})}catch(e){render("Network problem. Please try again, or WhatsApp the salon.")}};' +
'try{google.script.run.withSuccessHandler(done).withFailureHandler(post).submitBooking(B,f)}catch(e){post()}}' +
'function done(r){if(!r||!r.ok){render(r&&r.message||"Could not send. Please try again.");return}' +
'var wa=P.whatsapp?"https://wa.me/91"+P.whatsapp+"?text="+encodeURIComponent("Hi, I just requested a booking (ref "+r.ref+") for "+S.date+" at "+S.time+". — "+(S.name||"")):"";' +
'$("<div class=hero><h1>"+esc(P.salonName)+"</h1></div><div class=wrap><div class=\\"card ok\\"><div class=big>✅</div><h3>Request sent!</h3><p>"+esc(S.date)+" at "+esc(S.time)+"<br>Ref: <b>"+esc(r.ref)+"</b></p><p class=muted>The salon will confirm on WhatsApp shortly.</p>"+(wa?"<a class=wa href=\\""+wa+"\\" target=_top>Message the salon</a>":"")+"</div></div>")}' +
'render();</script></body></html>';


// ═══════════════════════════════════════════════════════════════════════════
// EASY SETUP
//  1. Owner taps "Create my free cloud" in the app → Google "Make a copy" of
//     the template Sheet (this script comes inside it — nothing to paste).
//  2. In the copy: menu ☁️ SaloonBossX → Set up. The sidebar walks through the
//     one Deploy click and then shows a QR code.
//  3. Owner scans the QR with the phone camera → "Connect this phone" → the
//     app opens already connected. Branches join from a WhatsApp link.
// ═══════════════════════════════════════════════════════════════════════════

var APP_PACKAGE = 'com.salonboss.app';
var APP_SCHEME = 'saloonbossx';

function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('☁️ SaloonBossX')
      .addItem('Set up / connect phone', 'showSetup')
      .addToUi();
  } catch (e) { /* standalone script: no UI */ }
}

/** Menu item. Running it also triggers Google's one-time permission screen. */
function showSetup() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss) PropertiesService.getScriptProperties().setProperty('SHEET_DEFAULT', ss.getId());
  } catch (e) {}
  var html = HtmlService.createHtmlOutput(SETUP_HTML).setTitle('SaloonBossX setup');
  SpreadsheetApp.getUi().showSidebar(html);
}

/** Called by the sidebar. The web-app URL once deployed, else ''. */
function getMyUrl() {
  try { var u = ScriptApp.getService().getUrl() || ''; return /\/exec$/.test(u) ? u : (u ? u.replace(/\/dev$/, '/exec') : ''); } catch (e) { return ''; }
}

function myUrl_() { try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; } }

function appButtons_(path, query) {
  var q = query ? '?' + query : '';
  var intent = 'intent://' + path + q + '#Intent;scheme=' + APP_SCHEME + ';package=' + APP_PACKAGE + ';end';
  var direct = APP_SCHEME + '://' + path + q;
  return '<a class=btn href="' + intent + '" target=_top>Open in SaloonBossX (Android)</a>' +
         '<a class="btn ghost" href="' + direct + '" target=_top>Open on iPhone</a>';
}

var PAGE_CSS = '<meta name=viewport content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f5fb;color:#17151f}' +
  '.hero{background:#0b0b0b;color:#fff;padding:24px 18px}.hero h1{margin:0;font-size:22px}.gold{color:#d9a441;font-weight:800;letter-spacing:1px;font-size:12px}' +
  '.wrap{max-width:520px;margin:0 auto;padding:16px}.card{background:#fff;border-radius:16px;padding:16px;margin-bottom:12px;box-shadow:0 2px 10px rgba(30,20,60,.06)}' +
  '.btn{display:block;text-align:center;background:#6d4aff;color:#fff;padding:15px;border-radius:14px;text-decoration:none;font-weight:800;margin-top:10px}' +
  '.ghost{background:#fff;color:#6d4aff;border:1.5px solid #6d4aff}.muted{color:#8b8698;font-size:13px;line-height:19px}code{word-break:break-all;background:#f1f0f8;padding:6px;border-radius:8px;display:block;font-size:12px}</style>';

function connectPage_() {
  var url = myUrl_();
  var html = PAGE_CSS + '<div class=hero><div class=gold>SALOONBOSSX CLOUD</div><h1>Connect this phone</h1></div><div class=wrap><div class=card>' +
    '<p>Your free cloud is ready. Tap the button on the phone that has SaloonBossX installed.</p>' +
    appButtons_('connect', 'u=' + encodeURIComponent(url)) +
    '<p class=muted style="margin-top:16px">Button does not open the app? In SaloonBossX open <b>Settings → Branches &amp; Cloud</b> and paste this link:</p><code>' + url + '</code>' +
    '</div></div>';
  return HtmlService.createHtmlOutput(html).setTitle('Connect SaloonBossX').addMetaTag('viewport', 'width=device-width, initial-scale=1').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Branch join link: <url>?join=1#<join code>. The code (which contains the
 * chain secret) lives after "#", so it is never sent to any server — the page
 * reads it in the browser with google.script.url.getLocation.
 */
function joinPage_() {
  var html = PAGE_CSS + '<div class=hero><div class=gold>SALOONBOSSX</div><h1>Join your salon chain</h1></div><div class=wrap><div class=card>' +
    '<p>Tap the button on this branch’s phone (SaloonBossX must be installed and activated).</p><div id=b>Loading…</div>' +
    '<p class=muted style="margin-top:16px">If nothing opens: in SaloonBossX go to <b>Settings → Branches &amp; Cloud → Join as a branch</b> and paste the code your owner sent.</p>' +
    '</div></div><script>google.script.url.getLocation(function(l){var c=(l.hash||"").replace(/^#/,"");' +
    'if(!c){document.getElementById("b").innerHTML="<p class=muted>This link is incomplete. Ask your owner to share it again.</p>";return}' +
    'var q="c="+encodeURIComponent(c);document.getElementById("b").innerHTML=' +
    '"<a class=btn href=\\"intent://join?"+q+"#Intent;scheme=' + APP_SCHEME + ';package=' + APP_PACKAGE + ';end\\" target=_top>Open in SaloonBossX (Android)</a>"+' +
    '"<a class=\\"btn ghost\\" href=\\"' + APP_SCHEME + '://join?"+q+"\\" target=_top>Open on iPhone</a>"});</script>';
  return HtmlService.createHtmlOutput(html).setTitle('Join SaloonBossX').addMetaTag('viewport', 'width=device-width, initial-scale=1').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

var SETUP_HTML = '<style>body{font-family:Arial,sans-serif;font-size:13px;color:#17151f;padding:6px}h2{font-size:16px;margin:4px 0 10px}' +
  '.s{background:#f6f5fb;border-radius:10px;padding:10px;margin-bottom:10px}.n{display:inline-block;width:20px;height:20px;border-radius:10px;background:#6d4aff;color:#fff;text-align:center;font-weight:bold;margin-right:6px}' +
  'b{color:#6d4aff}#qr{text-align:center;margin-top:8px}#qr img,#qr svg{width:200px;height:200px}button{background:#6d4aff;color:#fff;border:0;border-radius:8px;padding:10px;width:100%;font-weight:bold;cursor:pointer}</style>' +
  '<h2>☁️ SaloonBossX free cloud</h2>' +
  '<div class=s><span class=n>1</span>Permission given ✅ (you just did it).</div>' +
  '<div class=s><span class=n>2</span>Top right: <b>Extensions → Apps Script</b>. In the new tab click blue <b>Deploy → New deployment</b>, click ⚙ → <b>Web app</b>.<br>Set <b>Execute as: Me</b> and <b>Who has access: Anyone</b> → <b>Deploy</b> → <b>Authorise</b>.</div>' +
  '<div class=s><span class=n>3</span>Come back here and press:<br><br><button onclick="chk()">I have deployed — show my QR</button><div id=qr></div></div>' +
  '<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js" onerror="var x=document.createElement(\'script\');x.src=\'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js\';document.head.appendChild(x)"></script>' +
  '<script>function chk(){document.getElementById("qr").innerHTML="Checking…";google.script.run.withSuccessHandler(function(u){' +
  'if(!u){document.getElementById("qr").innerHTML="<p>Not deployed yet. Finish step 2, then press again.</p>";return}' +
  'var t=u+"?connect=1",img="";try{var q=qrcode(0,"M");q.addData(t);q.make();img=q.createSvgTag(4,8)}catch(e){}' +
  'var wa="https://wa.me/?text="+encodeURIComponent("SaloonBossX connect link: "+t);' +
  'document.getElementById("qr").innerHTML=(img?"<p><b>Scan with your phone camera</b>, then tap Open in SaloonBossX.</p>"+img:"")+' +
  '"<p>"+(img?"Or ":"")+"<a href=\\""+wa+"\\" target=_blank><b>send the link to your own WhatsApp</b></a> and tap it on the phone.</p>"+' +
  '"<p style=\\"word-break:break-all;font-size:10px;color:#888\\">"+t+"</p>"}).getMyUrl()}</script>';
