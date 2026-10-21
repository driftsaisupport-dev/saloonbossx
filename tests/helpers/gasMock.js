// Runs the real google-apps-script/BranchSync.gs in a vm with in-memory Google service mocks.
// Runs the REAL google-apps-script/BranchSync.gs inside a vm with in-memory
// Google service mocks, and exposes a fetch() that hits doPost like the web app.
const fs = require('fs'), vm = require('vm'), crypto = require('crypto');
let nextId = 1;
class File { constructor(name, content, parent) { this.id = 'f' + nextId++; this.name = name; this.content = String(content); this.parent = parent; this.trashed = false; this.updated = new Date(Date.now() + nextId); }
  getId() { return this.id; } getName() { return this.name; } isTrashed() { return this.trashed; } setTrashed(v) { this.trashed = v; }
  setContent(c) { this.content = String(c); this.updated = new Date(Date.now() + nextId++); } getSize() { return this.content.length; }
  getLastUpdated() { return this.updated; } getBlob() { const s = this.content; return { getDataAsString: () => s }; }
  getParents() { return iter([this.parent]); } moveTo(f) { this.parent = f; } getUrl() { return 'https://drive/' + this.id; } }
class Folder { constructor(name, parent) { this.id = 'd' + nextId++; this.name = name; this.parent = parent; this.files = []; this.folders = []; }
  getId() { return this.id; } getName() { return this.name; } getUrl() { return 'https://drive/folders/' + this.id; }
  getParents() { return iter(this.parent ? [this.parent] : []); }
  getFoldersByName(n) { return iter(this.folders.filter(f => f.name === n)); } getFolders() { return iter(this.folders); }
  createFolder(n) { const f = new Folder(n, this); this.folders.push(f); allFolders[f.id] = f; return f; }
  getFilesByName(n) { return iter(this.files.filter(f => f.name === n && !f.trashed)); } getFiles() { return iter(this.files); }
  createFile(n, c) { const f = new File(n, c, this); this.files.push(f); allFiles[f.id] = f; return f; } }
const iter = a => { let i = 0; return { hasNext: () => i < a.length, next: () => a[i++] }; };
const allFiles = {}, allFolders = {}; const rootDrive = new Folder('My Drive', null);
const props = new Map();
const cache = new Map();
const signed = buf => Array.from(buf).map(b => (b > 127 ? b - 256 : b));
class Sheet { constructor(n) { this.n = n; this.rows = []; } setName(n) { this.n = n; } getName() { return this.n; }
  appendRow(r) { this.rows.push([...r]); } setFrozenRows() {} hideColumns() {} getLastRow() { return this.rows.length; }
  getRange(r, c, nr = 1, nc = 1) { const sh = this; return {
    setFontWeight() { return this; }, setBackground() { return this; }, setFontColor() { return this; },
    setValue(v) { (sh.rows[r - 1] ||= [])[c - 1] = v; return this; },
    setValues(vals) { vals.forEach((row, i) => row.forEach((v, j) => { (sh.rows[r - 1 + i] ||= [])[c - 1 + j] = v; })); return this; },
    getValues() { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push((sh.rows[r - 1 + i] || [])[c - 1 + j] ?? ''); out.push(row); } return out; },
    getDisplayValues() { return this.getValues().map(r2 => r2.map(String)); } }; } }
const sheets = {};
const ctx = {
  console, JSON, Date, Math, String, Number, Object, Array,
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  CacheService: { getScriptCache: () => ({ get: k => cache.get(k) ?? null, put: (k, v) => cache.set(k, String(v)) }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props.get(k) ?? null, setProperty: (k, v) => props.set(k, String(v)), deleteProperty: k => props.delete(k), getKeys: () => [...props.keys()] }) },
  DriveApp: { createFolder: n => rootDrive.createFolder(n), getFolderById: id => { if (!allFolders[id]) throw new Error('nf'); return allFolders[id]; }, getFileById: id => { if (!allFiles[id]) throw new Error('nf'); return allFiles[id]; } },
  SpreadsheetApp: { create: name => { const id = 's' + nextId++; const ss = { name, sh: [new Sheet('Sheet1')], getId: () => id, getUrl: () => 'https://sheets/' + id, getSheets() { return this.sh; }, insertSheet(n) { const s = new Sheet(n); this.sh.push(s); return s; }, getSheetByName(n) { return this.sh.find(s => s.n === n); } }; sheets[id] = ss; allFiles[id] = new File(name, '', rootDrive); allFiles[id].id = id; return ss; }, openById: id => sheets[id] },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (alg, s) => signed(crypto.createHash('sha256').update(s, 'utf8').digest()),
    formatDate: (d, tz, f) => new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10),
    getUuid: () => crypto.randomUUID(),
    computeHmacSha256Signature: (msg, key) => signed(crypto.createHmac('sha256', key).update(msg, 'utf8').digest()),
  },
  HtmlService: { XFrameOptionsMode: { ALLOWALL: 1 }, createHtmlOutput: h => ({ html: h, setTitle(t) { this.title = t; return this; }, addMetaTag() { return this; }, setXFrameOptionsMode() { return this; } }) },
  ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TESTDEPLOY/exec' }) },
  SpreadsheetAppUi: null,
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ text: t, setMimeType() { return this; } }) },
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(require('path').join(__dirname, '..', '..', 'google-apps-script', 'BranchSync.gs'), 'utf8'), ctx);
exports.calls = [];
exports.fetch = async (url, opts) => {
  const out = ctx.doPost({ postData: { contents: opts.body } });
  exports.calls.push(JSON.parse(opts.body).action);
  return { text: async () => out.text, json: async () => JSON.parse(out.text) };
};
exports.sheets = sheets; exports.ctx = ctx; exports.rootDrive = rootDrive;
