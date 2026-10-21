/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║         SaloonBossX v4 — License Server  (Google Apps Script)    ║
 * ║                                                                  ║
 * ║  HOW TO DEPLOY:                                                  ║
 * ║  1. Open script.google.com → New project → paste this code      ║
 * ║  2. Project Settings → Script Properties → add:                 ║
 * ║       RESPONSE_SECRET = <a long random string>                  ║
 * ║     (MUST match SBX_RESPONSE_SECRET in the app's .env)          ║
 * ║  3. Import the xlsx → Sheets → name it "SaloonBossX Licenses"  ║
 * ║  4. Extensions → Apps Script → Deploy → New deployment          ║
 * ║     → Web app → Execute as: Me → Who has access: Anyone         ║
 * ║  5. Copy the web app URL                                         ║
 * ║  6. In app .env: set EXPO_PUBLIC_LICENSE_URL = that URL          ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

// Pull the signing secret from Script Properties (Project Settings → Script
// Properties). Falls back to the literal below only if the property is unset.
function getResponseSecret_() {
  try {
    var p = PropertiesService.getScriptProperties().getProperty('RESPONSE_SECRET');
    if (p) return p;
  } catch (e) { /* ignore */ }
  return CONFIG.RESPONSE_SECRET;
}

// ── CONFIGURATION ─────────────────────────────────────────────────────────────
const CONFIG = {
  SPREADSHEET_NAME:  'SaloonBossX Licenses',   // name of your Google Sheet
  SHEET_NAME:        'Keys Master',             // tab name inside the sheet
  
  // No fallback. The secret lives ONLY in Script Properties. A literal here
  // would be committed to the repo alongside the app that verifies against it,
  // which defeats the point of signing responses at all.
  RESPONSE_SECRET: '',
  
  // Max devices per plan (server-side enforcement)
  MAX_DEVICES: { solo: 1, standard: 1, multi: 3, academy: 2 },   // extra branches: issue the key with --devices N
  
  // Column positions in the sheet (1-indexed, matches the xlsx)
  COL: {
    SERIAL:          1,   // A: Row number
    KEY:             2,   // B: License key
    PLAN:            3,   // C: Plan name (solo/standard/multi/academy)
    PRICE:           4,   // D: Price
    EXPIRY:          5,   // E: Expiry date
    MAX_DEVICES:     6,   // F: Max devices
    STATUS:          7,   // G: AVAILABLE / ACTIVE / REVOKED / USED_UP
    DEVICES_USED:    8,   // H: Count of devices
    DEVICE_IDS:      9,   // I: Pipe-separated device IDs
    CUSTOMER_NAME:  10,   // J: Customer name
    CUSTOMER_PHONE: 11,   // K: Customer phone
    CUSTOMER_EMAIL: 12,   // L: Customer email
    SALE_DATE:      13,   // M: Sale/activation date
    AMOUNT_PAID:    14,   // N: Amount paid
    NOTES:          15,   // O: Notes
    BILLING:        16,   // P: Monthly / Yearly / Lifetime (info only)
  }
};

// ── HMAC-SHA256 for response signing ──────────────────────────────────────────
function hmacSha256Base64(message, secret) {
  const value = message == null ? '' : String(message);
  const key = secret == null ? String(getResponseSecret_() || '') : String(secret);
  if (!key) throw new Error('RESPONSE_SECRET is empty — set it in Script Properties.');
  const valueBytes = Utilities.newBlob(value).getBytes();
  const keyBytes = Utilities.newBlob(key).getBytes();
  const sigBytes = Utilities.computeHmacSha256Signature(valueBytes, keyBytes);
  return Utilities.base64Encode(sigBytes);
}

// ── Read the plan out of a v4 key (SBX-<payload>-<86-char signature>) ────────
// This does NOT verify the signature (Apps Script has no Ed25519); the app does
// that. It only decides which plan/device limit to record.
function decodeKeyPayload_(rawKey) {
  try {
    if (rawKey.slice(0, 4).toUpperCase() !== 'SBX-') return null;
    const body = rawKey.slice(4);
    if (body.length < 88 || body.charAt(body.length - 87) !== '-') return null;
    let b64 = body.slice(0, body.length - 87);
    while (b64.length % 4) b64 += '=';
    const json = Utilities.newBlob(Utilities.base64DecodeWebSafe(b64)).getDataAsString();
    const p = JSON.parse(json);
    return p && p.p ? p : null;
  } catch (err) { return null; }
}

// Sheets turns "2026-11-02" into a Date; always hand the app YYYY-MM-DD.
function fmtExpiry_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return Utilities.formatDate(v, 'Asia/Kolkata', 'yyyy-MM-dd');
  return String(v == null ? '' : v).trim() || 'LIFETIME';
}

// ── Get sheet ──────────────────────────────────────────────────────────────────
// `readOnly` (GET requests): never create the tab — return null instead.
function getSheet(readOnly) {
  const files = DriveApp.getFilesByName(CONFIG.SPREADSHEET_NAME);
  if (!files.hasNext()) throw new Error('Sheet not found: ' + CONFIG.SPREADSHEET_NAME);
  const ss = SpreadsheetApp.open(files.next());
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet && readOnly) return null;
  if (!sheet) {
    // First run: create the tab with headers so setup is one step.
    sheet = ss.insertSheet(CONFIG.SHEET_NAME);
    sheet.appendRow(['#', 'License Key', 'Plan', 'Price', 'Expiry', 'Max Devices', 'Status',
      'Devices Used', 'Device IDs', 'Customer Name', 'Customer Phone', 'Customer Email',
      'Sale Date', 'Amount Paid', 'Notes', 'Billing']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ── Find key row (returns 0-based row index in data, or -1) ──────────────────
function findKeyRow(sheet, key) {
  const data = sheet.getDataRange().getValues();
  const cleanKey = key.trim().toUpperCase();
  for (let r = 1; r < data.length; r++) {  // skip header row
    if (String(data[r][CONFIG.COL.KEY - 1]).trim().toUpperCase() === cleanKey) return r;
  }
  return -1;
}

// ── Normalize plan from sheet (e.g. "Standard (Single Salon)" → "standard") ──
function normalizePlan(rawPlan) {
  const s = String(rawPlan || '').toLowerCase().trim();
  if (s.startsWith('solo'))     return 'solo';
  if (s.startsWith('standard')) return 'standard';
  if (s.startsWith('multi'))    return 'multi';
  if (s.startsWith('academy') || s.includes('academy')) return 'academy';
  // Legacy
  if (s === 'starter')  return 'solo';
  if (s === 'pro')      return 'standard';
  if (s === 'business') return 'multi';
  return s;
}

// ── Build a signed response ───────────────────────────────────────────────────
function signedResponse(valid, plan, expiry, message, key, deviceId, extraFields) {
  const ts = Date.now();
  const sig = valid
    ? hmacSha256Base64(
        [key.trim().toUpperCase(), String(deviceId || '').trim(), 'true',
         String(plan), String(expiry), String(ts)].join('|'),
        getResponseSecret_()
      )
    : '';
  return Object.assign(
    { valid, plan, expiry, message, ts, sig },
    extraFields || {}
  );
}

// ── Locking ───────────────────────────────────────────────────────────────────
// Without this, two people activating the same key at the same moment both read
// the device list before either writes, both pass the device-limit check, and
// the key registers on more devices than it was sold for.
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    return { valid: false, message: 'Server busy. Try again in a moment.' };
  }
  try { return fn(); } finally { lock.releaseLock(); }
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────
// Registration mutates the sheet, so it belongs on POST. GET is retried and
// prefetched by proxies and link scanners, which can burn a device slot without
// anyone tapping anything. doGet is STRICTLY read-only: it never registers a
// key or a device, never starts a monthly/yearly term, never releases a slot
// and never creates the sheet tab. Only POST action=activate registers.
function doPost(e) {
  return handle_(e, true);
}

/** Run once from the editor to create the tab and check permissions. */
function setup() {
  getSheet();
  if (!getResponseSecret_()) Logger.log('WARNING: set RESPONSE_SECRET in Project Settings → Script Properties.');
  Logger.log('Setup OK.');
}

function doGet(e) {
  return handle_(e, false);
}

function handle_(e, allowWrite) {
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);
  
  try {
    const action    = (e.parameter.action   || '').toLowerCase();
    const rawKey    = (e.parameter.key      || '').replace(/\s+/g, '');
    const key       = rawKey.toUpperCase();
    const deviceId  = (e.parameter.device   || '').trim();
    const ts        = parseInt(e.parameter.ts || '0');
    const custEmail = (e.parameter.email    || '').trim();
    const custName  = (e.parameter.name     || '').trim();
    
    // ── Basic guards ──
    if (!key)      { output.setContent(JSON.stringify({ valid: false, message: 'Missing key.' })); return output; }
    if (!deviceId) { output.setContent(JSON.stringify({ valid: false, message: 'Missing device ID.' })); return output; }

    // A successful activation is written before its response is returned. Do
    // not consume a device slot when response signing is not configured.
    if (!getResponseSecret_()) {
      output.setContent(JSON.stringify({
        valid: false,
        message: 'License server is not configured. Set RESPONSE_SECRET in Script Properties and redeploy the web app.'
      }));
      return output;
    }
    
    // Reject requests older than 5 minutes (replay protection)
    if (ts && Math.abs(Date.now() - ts) > 5 * 60 * 1000) {
      output.setContent(JSON.stringify({ valid: false, message: 'Request expired.' }));
      return output;
    }

    const sheet  = getSheet(!allowWrite);
    if (!sheet) {
      output.setContent(JSON.stringify(signedResponse(false, '', '', 'License key not found.', key, deviceId, null)));
      return output;
    }
    let rowIdx = findKeyRow(sheet, key);

    // ── Free a device slot (customer moving to a new phone) — POST only ──
    if (action === 'release' && !allowWrite) {
      output.setContent(JSON.stringify({ valid: false, message: 'Releasing a device needs a POST request.' }));
      return output;
    }
    if (action === 'release') {
      if (rowIdx !== -1) {
        withLock_(function () {
          const r = sheet.getDataRange().getValues()[rowIdx];
          const list = String(r[CONFIG.COL.DEVICE_IDS - 1] || '').split('|').filter(function (d) { return d && d !== deviceId; });
          sheet.getRange(rowIdx + 1, CONFIG.COL.DEVICE_IDS).setValue(list.join('|'));
          sheet.getRange(rowIdx + 1, CONFIG.COL.DEVICES_USED).setValue(list.length);
          if (String(r[CONFIG.COL.STATUS - 1]).toUpperCase() !== 'REVOKED') {
            sheet.getRange(rowIdx + 1, CONFIG.COL.STATUS).setValue(list.length ? 'ACTIVE' : 'AVAILABLE');
          }
          sheet.getRange(rowIdx + 1, CONFIG.COL.NOTES).setValue('Device released ' + new Date().toISOString().split('T')[0]);
          return {};
        });
      }
      output.setContent(JSON.stringify({ valid: true, message: 'Device released.' }));
      return output;
    }

    // ── Unknown key: register it automatically ──
    // The app has already verified the key's Ed25519 signature before calling
    // us, so you never have to paste keys into the sheet by hand. Forgetting to
    // used to lock paying customers out with "License key not found".
    if (rowIdx === -1 && action === 'activate' && allowWrite) {
      const payload = decodeKeyPayload_(rawKey);
      if (payload) {
        withLock_(function () {
          if (findKeyRow(sheet, key) !== -1) return {};
          const plan = normalizePlan(payload.p);
          const row = new Array(16).fill('');
          row[CONFIG.COL.BILLING - 1] = payload.e === 'LIFETIME' ? 'Lifetime' : payload.b === 'yearly' ? 'Yearly' : payload.b === 'monthly' ? 'Monthly' : 'Fixed';
          row[CONFIG.COL.SERIAL - 1] = sheet.getLastRow();
          row[CONFIG.COL.KEY - 1] = rawKey;
          row[CONFIG.COL.PLAN - 1] = plan;
          // Monthly / yearly keys: "31 DAYS" until first activation, then a real date.
          row[CONFIG.COL.EXPIRY - 1] = payload.e === 'TERM' ? (Number(payload.t) || 31) + ' DAYS' : (payload.e || 'LIFETIME');
          row[CONFIG.COL.MAX_DEVICES - 1] = payload.d || CONFIG.MAX_DEVICES[plan] || 1;
          row[CONFIG.COL.STATUS - 1] = 'AVAILABLE';
          row[CONFIG.COL.DEVICES_USED - 1] = 0;
          row[CONFIG.COL.NOTES - 1] = 'Order ' + (payload.o || '?') + ' (auto-registered)';
          sheet.appendRow(row);
          return {};
        });
        rowIdx = findKeyRow(sheet, key);
      }
    }
    // From here on only a POST "activate" may write to the sheet.
    const mayRegister = allowWrite && action === 'activate';
    
    // ── Key not found ──
    if (rowIdx === -1) {
      const resp = signedResponse(false, '', '', 'License key not found.', key, deviceId, null);
      output.setContent(JSON.stringify(resp));
      return output;
    }
    
    // ── Read row data ──
    const data       = sheet.getDataRange().getValues();
    const row        = data[rowIdx];
    const status     = String(row[CONFIG.COL.STATUS - 1]).toUpperCase().trim();
    const plan       = normalizePlan(row[CONFIG.COL.PLAN - 1]);
    let expiry       = fmtExpiry_(row[CONFIG.COL.EXPIRY - 1]);
    let expirySetNow = false;
    const maxDevices = parseInt(row[CONFIG.COL.MAX_DEVICES - 1]) || CONFIG.MAX_DEVICES[plan] || 1;
    const devicesRaw = String(row[CONFIG.COL.DEVICE_IDS - 1] || '').trim();
    const deviceList = devicesRaw ? devicesRaw.split('|').filter(Boolean) : [];
    
    // ── Revoked ──
    if (status === 'REVOKED') {
      const resp = signedResponse(false, '', '', 'This license has been revoked. Contact support.', key, deviceId, null);
      output.setContent(JSON.stringify(resp));
      return output;
    }
    
    // ── Monthly / yearly key used for the first time: the clock starts now ──
    const term = expiry.match(/^(\d+)\s*DAYS?$/i);
    if (term && mayRegister) {
      const d = new Date(Date.now() + 330 * 60000);          // India time
      d.setUTCDate(d.getUTCDate() + Number(term[1]));
      expiry = d.toISOString().slice(0, 10);
      sheet.getRange(rowIdx + 1, CONFIG.COL.EXPIRY).setNumberFormat('@').setValue(expiry);
      expirySetNow = true;
    }

    // ── Expired check ──
    if (expiry !== 'LIFETIME' && expiry && !term) {
      const expiryDate = new Date(expiry.replace(/-/g, '/'));
      if (!isNaN(expiryDate.getTime()) && expiryDate < new Date()) {
        const resp = signedResponse(false, plan, expiry, 'License expired on ' + expiry + '. Please renew.', key, deviceId, null);
        output.setContent(JSON.stringify(resp));
        return output;
      }
    }
    
    // ── Check if this device is already registered ──
    const alreadyRegistered = deviceList.includes(deviceId);
    
    if (alreadyRegistered) {
      // Existing device — just validate
      const resp = signedResponse(true, plan, expiry, 'License valid.', key, deviceId, {
        devicesUsed: deviceList.length,
        maxDevices: maxDevices,
        expirySetNow: expirySetNow,
      });
      output.setContent(JSON.stringify(resp));
      return output;
    }
    
    // ── Device not on this key ──
    // validate (GET or POST) and every GET only REPORT; they never register.
    // A device the seller removed from the sheet stays removed.
    if (!mayRegister) {
      const resp = signedResponse(false, plan, expiry, 'This device is not registered for this licence.', key, deviceId, {
        notRegistered: true,
        devicesUsed: deviceList.length,
        maxDevices: maxDevices,
      });
      output.setContent(JSON.stringify(resp));
      return output;
    }

    // ── New device — check device limit ──
    if (deviceList.length >= maxDevices) {
      const resp = signedResponse(false, plan, expiry,
        `Device limit reached (${maxDevices} device${maxDevices > 1 ? 's' : ''} allowed for ${plan} plan). ` +
        'Contact support to transfer or upgrade.',
        key, deviceId,
        { devicesUsed: deviceList.length, maxDevices: maxDevices }
      );
      output.setContent(JSON.stringify(resp));
      return output;
    }
    
    // ── Register new device ──
    const newDeviceList = [...deviceList, deviceId];
    const sheetRow = rowIdx + 1;  // +1 for header
    
    // Update: device IDs, devices used, status, sale date (if first activation)
    sheet.getRange(sheetRow, CONFIG.COL.DEVICE_IDS).setValue(newDeviceList.join('|'));
    sheet.getRange(sheetRow, CONFIG.COL.DEVICES_USED).setValue(newDeviceList.length);
    
    const newStatus = newDeviceList.length >= maxDevices ? 'USED_UP' : 'ACTIVE';
    sheet.getRange(sheetRow, CONFIG.COL.STATUS).setValue(newStatus);
    
    // Save customer info and sale date on first activation
    if (!row[CONFIG.COL.SALE_DATE - 1]) {
      sheet.getRange(sheetRow, CONFIG.COL.SALE_DATE).setValue(new Date().toISOString().split('T')[0]);
    }
    // Auto-fill customer info if provided by the app
    if (custEmail && !row[CONFIG.COL.CUSTOMER_EMAIL - 1]) {
      sheet.getRange(sheetRow, CONFIG.COL.CUSTOMER_EMAIL).setValue(custEmail);
    }
    if (custName && !row[CONFIG.COL.CUSTOMER_NAME - 1]) {
      sheet.getRange(sheetRow, CONFIG.COL.CUSTOMER_NAME).setValue(custName);
    }
    
    const resp = signedResponse(true, plan, expiry, 'License activated successfully!', key, deviceId, {
      devicesUsed: newDeviceList.length,
      maxDevices: maxDevices,
      firstActivation: true,
      expirySetNow: expirySetNow,
    });
    output.setContent(JSON.stringify(resp));
    
  } catch (err) {
    Logger.log('Error: ' + err.message + '\n' + err.stack);
    output.setContent(JSON.stringify({ valid: false, message: 'Server error. Please try again.', error: err.message }));
  }
  
  return output;
}

// ── ADMIN FUNCTIONS (run manually from Apps Script editor) ──────────────────

/**
 * Revoke a key — paste the key in and run this function.
 * In Apps Script editor: Edit → revokeKey → Run
 */
function revokeKey() {
  const KEY_TO_REVOKE = 'PASTE-FULL-SBX-KEY-HERE';  // ← change this
  const sheet = getSheet();
  const rowIdx = findKeyRow(sheet, KEY_TO_REVOKE);
  if (rowIdx === -1) { Logger.log('Key not found: ' + KEY_TO_REVOKE); return; }
  sheet.getRange(rowIdx + 1, CONFIG.COL.STATUS).setValue('REVOKED');
  sheet.getRange(rowIdx + 1, CONFIG.COL.NOTES).setValue('Revoked on ' + new Date().toISOString().split('T')[0]);
  Logger.log('Revoked: ' + KEY_TO_REVOKE);
}

/**
 * Remove a specific device from a key (e.g., customer lost phone / changed device).
 * Set KEY_TO_UPDATE and DEVICE_ID_TO_REMOVE below, then run.
 */
function removeDevice() {
  const KEY_TO_UPDATE      = 'PASTE-FULL-SBX-KEY-HERE'; // ← change
  const DEVICE_ID_TO_REMOVE = 'DEVICE-ID-HERE';               // ← change
  
  const sheet = getSheet();
  const rowIdx = findKeyRow(sheet, KEY_TO_UPDATE);
  if (rowIdx === -1) { Logger.log('Key not found'); return; }
  
  const data       = sheet.getDataRange().getValues();
  const row        = data[rowIdx];
  const devicesRaw = String(row[CONFIG.COL.DEVICE_IDS - 1] || '');
  const deviceList = devicesRaw.split('|').filter(d => d && d !== DEVICE_ID_TO_REMOVE);
  const maxDevices = parseInt(row[CONFIG.COL.MAX_DEVICES - 1]) || 1;
  
  sheet.getRange(rowIdx + 1, CONFIG.COL.DEVICE_IDS).setValue(deviceList.join('|'));
  sheet.getRange(rowIdx + 1, CONFIG.COL.DEVICES_USED).setValue(deviceList.length);
  sheet.getRange(rowIdx + 1, CONFIG.COL.STATUS).setValue(deviceList.length >= maxDevices ? 'USED_UP' : deviceList.length > 0 ? 'ACTIVE' : 'AVAILABLE');
  sheet.getRange(rowIdx + 1, CONFIG.COL.NOTES).setValue(`Device removed: ${DEVICE_ID_TO_REMOVE} on ${new Date().toISOString().split('T')[0]}`);
  Logger.log(`Device removed. Remaining: ${deviceList.length}`);
}

/**
 * Add customer info to a key after you sell it.
 * Run this manually after each sale to keep records clean.
 */
function updateCustomerInfo() {
  const KEY          = 'PASTE-FULL-SBX-KEY-HERE'; // ← change
  const CUSTOMER     = { name: 'Priya Sharma', phone: '9876543210', email: 'priya@example.com', amountPaid: 3999 };
  
  const sheet = getSheet();
  const rowIdx = findKeyRow(sheet, KEY);
  if (rowIdx === -1) { Logger.log('Key not found'); return; }
  
  const sheetRow = rowIdx + 1;
  sheet.getRange(sheetRow, CONFIG.COL.CUSTOMER_NAME).setValue(CUSTOMER.name);
  sheet.getRange(sheetRow, CONFIG.COL.CUSTOMER_PHONE).setValue(CUSTOMER.phone);
  sheet.getRange(sheetRow, CONFIG.COL.CUSTOMER_EMAIL).setValue(CUSTOMER.email);
  sheet.getRange(sheetRow, CONFIG.COL.AMOUNT_PAID).setValue(CUSTOMER.amountPaid);
  Logger.log('Customer info updated for: ' + KEY);
}

// Trial keys: the app has a built-in free trial now. To issue a longer trial
// by hand, run on your computer:  npm run issue -- --plan standard --days 14 --order TRIAL-1

/**
 * Validate a key manually (for support queries).
 * Logs full key info without modifying anything.
 */
function lookupKey() {
  const KEY = 'PASTE-FULL-SBX-KEY-HERE'; // ← change
  const sheet = getSheet();
  const rowIdx = findKeyRow(sheet, KEY);
  if (rowIdx === -1) { Logger.log('Key not found'); return; }
  const data = sheet.getDataRange().getValues();
  const row  = data[rowIdx];
  Logger.log(JSON.stringify({
    key:          row[CONFIG.COL.KEY - 1],
    plan:         row[CONFIG.COL.PLAN - 1],
    expiry:       row[CONFIG.COL.EXPIRY - 1],
    status:       row[CONFIG.COL.STATUS - 1],
    devicesUsed:  row[CONFIG.COL.DEVICES_USED - 1],
    maxDevices:   row[CONFIG.COL.MAX_DEVICES - 1],
    deviceIds:    row[CONFIG.COL.DEVICE_IDS - 1],
    customer:     row[CONFIG.COL.CUSTOMER_NAME - 1],
    phone:        row[CONFIG.COL.CUSTOMER_PHONE - 1],
    email:        row[CONFIG.COL.CUSTOMER_EMAIL - 1],
    saleDate:     row[CONFIG.COL.SALE_DATE - 1],
    amountPaid:   row[CONFIG.COL.AMOUNT_PAID - 1],
    notes:        row[CONFIG.COL.NOTES - 1],
  }, null, 2));
}