/**
 * Branch sync through the owner's Google Drive.
 *
 * Every phone keeps working fully offline on its own encrypted database.
 * Whenever it has internet it quietly:
 *   1. pushes a small summary of its day / month (revenue, bills, staff,
 *      stock, dues, alerts) — this is what the head-office dashboard shows;
 *   2. once a day, pushes an encrypted full backup (lost phone = no data loss);
 *   3. picks up the head office's price list, if one was published.
 *
 * Transport is a tiny Google Apps Script the owner deploys in their own
 * Google account (google-apps-script/BranchSync.gs). No Google Cloud project,
 * no OAuth review, no server for the app seller to run or pay for.
 */
import * as Crypto from 'expo-crypto';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { DBX } from '../database/Database';
import { todayLocal, toLocalDateStr } from '../utils/helpers';
import { encryptBackup, decryptBackup, signRequest, bytesToHex, makeJoinCode, readJoinCode, authKey } from './sync/cloudCrypto';
import { BossAI } from './ai/BossAI';
import { CLOUD_URL } from '../config/sales';

export interface SyncConfig {
  url: string;
  chainId: string;
  chainName: string;
  secret: string;
  branchId: string;
  branchName: string;
  isHQ: boolean;
  pushSelf: boolean;        // HQ phone is also a billing counter
  autoSync: boolean;
  cloudBackup: boolean;
  acceptCatalog: boolean;
  sheetUrl?: string;
  folderUrl?: string;
  /** true = the seller's shared Cloud Bridge (one-tap setup); figures are encrypted. */
  hosted?: boolean;
  /** Cloud Bridge script version seen at setup / last ping. */
  scriptVersion?: number;
}

export interface BranchRecord { branchId: string; branchName: string; receivedAt: string; summary: any; stale?: boolean; ageMin?: number }
export interface SyncLogEntry { at: number; ok: boolean; what: string; msg?: string }

const K = {
  cfg: 'sync_config', lastPush: 'sync_last_push', lastBackup: 'sync_last_backup', lastPull: 'sync_last_pull',
  log: 'sync_log', catalogVer: 'sync_catalog_version', cache: 'sync_branches_cache',
  auto: 'cloud_auto_enable', autoTry: 'cloud_auto_last_try',
};
const PUSH_EVERY_MS = 15 * 60 * 1000;
const STALE_MIN = 6 * 60;

let running: Promise<any> | null = null;
let enabling: Promise<SyncConfig> | null = null;
let cfgCache: SyncConfig | null | undefined;

const appVersion = () => (Constants as any)?.expoConfig?.version || Application.nativeApplicationVersion || '5.0.0';
const rnd = (n: number) => bytesToHex(Crypto.getRandomBytes(n));

/** Accept a link pasted with spaces, quotes or a trailing slash / query. */
export function cleanUrl(u: string): string {
  let s = String(u || '').trim().replace(/^["'<]+|["'>]+$/g, '').replace(/\s+/g, '');
  s = s.replace(/[?#].*$/, '').replace(/\/+$/, '');
  if (/\/dev$/.test(s)) s = s.replace(/\/dev$/, '/exec');
  if (/script\.google\.com\/.+\/s\/[\w-]+$/.test(s)) s += '/exec';
  return s;
}

async function getJSON<T>(key: string, fallback: T): Promise<T> {
  try { const v = await DBX.getSetting(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}

async function log(ok: boolean, what: string, msg = '') {
  const list = await getJSON<SyncLogEntry[]>(K.log, []);
  list.unshift({ at: Date.now(), ok, what, msg: msg.slice(0, 160) });
  await DBX.setSetting(K.log, JSON.stringify(list.slice(0, 40))).catch(() => {});
}

async function call(cfg: Pick<SyncConfig, 'url' | 'chainId' | 'secret' | 'branchId' | 'hosted'>, action: string, payload: any = {}, extra: any = {}, timeoutMs = 45000): Promise<any> {
  if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(cfg.url)) {
    throw new Error('The link must be a Google Apps Script web-app URL (https://script.google.com/…/exec).');
  }
  const body = JSON.stringify(payload);
  const ts = Date.now();
  const sig = signRequest(action, cfg.chainId, cfg.branchId, ts, body, cfg.hosted ? authKey(cfg.secret) : cfg.secret);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ v: 1, action, chainId: cfg.chainId, branchId: cfg.branchId, ts, sig, payload: body, ...extra }),
      signal: ctrl.signal,
    });
  } catch (e: any) {
    throw new Error(e?.name === 'AbortError' ? 'Google Drive took too long to answer. Will retry automatically.' : 'No internet right now. Will sync automatically later.');
  } finally { clearTimeout(timer); }
  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); }
  catch {
    if (/<html/i.test(text)) {
      if (/unable to open|sorry/i.test(text) || res.status === 404) throw new Error('Google says "unable to open the file": the cloud link is wrong or was deleted. Use the /exec link of a deployment with "Who has access: Anyone".');
      throw new Error('Google returned a web page instead of data. Re-deploy the script with "Who has access: Anyone" and use the /exec link.');
    }
    throw new Error('Unexpected reply from Google. Try again in a minute.');
  }
  if (!data?.ok) {
    const map: Record<string, string> = {
      auth: 'The join / recovery key does not match. Paste the key again from head office or your WhatsApp.',
      unknown_chain: 'Head office has not finished setup on this Drive link yet.',
      taken: 'This script is already used by a different chain. Deploy a fresh copy of the script.',
      clock: 'This phone’s date/time is wrong. Turn on automatic date & time.',
      busy: 'Google Drive is busy. Will retry automatically.',
      unknown_action: 'This needs the new Cloud Bridge script. Open Branches & Cloud → Update your script.',
      bad_chain: 'This phone’s cloud settings are damaged. Disconnect and connect again.',
      server: 'Google had a hiccup. Will retry automatically.',
    };
    throw new Error(map[data?.error] || data?.message || 'Sync failed.');
  }
  return data;
}

// ── Summary of this branch (what HQ sees) ─────────────────────────────────
async function buildSummary(cfg: SyncConfig): Promise<any> {
  const today = todayLocal();
  const now = new Date();
  const monthStart = toLocalDateStr(new Date(now.getFullYear(), now.getMonth(), 1));
  const lmStart = toLocalDateStr(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const lmEnd = toLocalDateStr(new Date(now.getFullYear(), now.getMonth(), 0));
  const yesterday = toLocalDateStr(new Date(Date.now() - 86400000));
  const d35 = toLocalDateStr(new Date(Date.now() - 34 * 86400000));

  const [profile, todayStats, pay, monthPL, lastPL, yPL, daily, staff, top, low, dues, attendance, clientsN, target, mDetail] = await Promise.all([
    DBX.getSalonProfile().catch(() => ({})),
    DBX.getDashboardStats(today),
    DBX.getPaymentBreakdown(today, today).catch(() => []),
    DBX.getPLSummary(monthStart, today),
    DBX.getPLSummary(lmStart, lmEnd),
    DBX.getPLSummary(yesterday, yesterday),
    DBX.getRevenueByDateRange(d35, today).catch(() => []),
    DBX.getStaffPerformance(monthStart, today).catch(() => []),
    DBX.getTopServices(monthStart, today, 8).catch(() => []),
    DBX.getLowStockItems().catch(() => []),
    DBX.getDuesSummary(),
    DBX.getTodayAttendance().catch(() => []),
    DBX.countRows('clients'),
    DBX.getRevenueTarget().catch(() => 0),
    DBX.getDetailedPLReport(monthStart, today).catch(() => null),
  ]);
  const monthRows = (daily as any[]).filter(r => r.date >= monthStart);
  const monthBills = monthRows.reduce((s, r) => s + (r.bills || 0), 0);
  const lmRows = await DBX.getRevenueByDateRange(lmStart, lmEnd).catch(() => []) as any[];
  const byMethod: Record<string, number> = {};
  for (const p of pay as any[]) byMethod[p.payment_method] = (byMethod[p.payment_method] || 0) + (p.total || 0);
  const staffAll = await DBX.getStaff().catch(() => []) as any[];
  let alerts: any[] = [];
  try { alerts = (await BossAI.alerts()).filter(a => a.severity !== 'info').map(a => ({ title: a.title, severity: a.severity })); } catch {}
  let forecast: any = null;
  try { const f = await BossAI.forecast(); forecast = { projected: f.projected, target: f.target || target || 0, confidence: f.confidence }; } catch {}

  return {
    v: 1, generatedAt: new Date().toISOString(), appVersion: appVersion(),
    branchName: cfg.branchName, salonName: (profile as any)?.name || '', city: (profile as any)?.city || '',
    today: {
      date: today, revenue: todayStats.revenue, bills: todayStats.billCount, walkins: todayStats.walkInCount,
      appointments: todayStats.appointmentCount, expenses: todayStats.expenses,
      cash: byMethod.cash || 0, upi: byMethod.upi || 0, card: byMethod.card || 0, split: byMethod.split || 0, due: byMethod.due || 0,
    },
    yesterday: { revenue: yPL.revenue },
    month: {
      start: monthStart, revenue: monthPL.revenue, bills: monthBills, expenses: monthPL.expenses, profit: monthPL.profit,
      avgBill: monthBills ? Math.round(monthPL.revenue / monthBills) : 0, discount: mDetail?.totalDiscount || 0,
    },
    lastMonth: { revenue: lastPL.revenue, bills: lmRows.reduce((s, r) => s + (r.bills || 0), 0) },
    daily: (daily as any[]).map(r => ({ date: r.date, revenue: Math.round(r.revenue || 0), bills: r.bills || 0 })),
    staff: (staff as any[]).slice(0, 15).map(s => ({ name: s.name, revenue: Math.round(s.total_revenue || 0), bills: s.total_bills || 0, commission: Math.round(s.commission_earned || 0) })),
    topServices: (top as any[]).map(s => ({ name: s.name, count: s.count, revenue: Math.round(s.revenue) })),
    lowStock: (low as any[]).slice(0, 15).map(i => ({ name: i.name, qty: i.quantity, min: i.min_stock, unit: i.unit })),
    dues,
    attendanceToday: { present: (attendance as any[]).filter(a => a.status !== 'absent').length, total: staffAll.length },
    clients: { total: clientsN },
    alerts, forecast,
  };
}

export const BranchSyncService = {
  async getConfig(): Promise<SyncConfig | null> {
    if (cfgCache !== undefined) return cfgCache;
    cfgCache = await getJSON<SyncConfig | null>(K.cfg, null);
    return cfgCache;
  },

  async saveConfig(cfg: SyncConfig | null) {
    cfgCache = cfg;
    await DBX.setSetting(K.cfg, cfg ? JSON.stringify(cfg) : '');
  },

  async status() {
    const [cfg, lastPush, lastBackup, lastPull, logList] = await Promise.all([
      this.getConfig(), DBX.getSetting(K.lastPush), DBX.getSetting(K.lastBackup), DBX.getSetting(K.lastPull), getJSON<SyncLogEntry[]>(K.log, []),
    ]);
    return { cfg, lastPush: Number(lastPush) || 0, lastBackup: Number(lastBackup) || 0, lastPull: Number(lastPull) || 0, log: logList };
  },

  /** Head office: claim a freshly deployed script and create the chain. */
  async setupHQ(input: { url: string; chainName: string; branchName: string; pushSelf: boolean; hosted?: boolean }): Promise<SyncConfig> {
    const url = cleanUrl(input.url);
    const hosted = !!input.hosted;
    const cfg: SyncConfig = {
      url, chainId: rnd(8), chainName: input.chainName.trim() || 'My Salons', secret: rnd(32),
      branchId: rnd(6), branchName: input.branchName.trim() || 'Main branch', isHQ: true, pushSelf: input.pushSelf,
      autoSync: true, cloudBackup: true, acceptCatalog: false, hosted,
    };
    const r = await call(cfg, 'hello', hosted ? { hosted: true } : { chainName: cfg.chainName }, { claimSecret: hosted ? authKey(cfg.secret) : cfg.secret });
    if (hosted && Number(r.version || 0) < 4) throw new Error('The shared cloud runs an old script. Please contact support.');
    cfg.sheetUrl = r.sheetUrl; cfg.folderUrl = r.folderUrl; cfg.scriptVersion = Number(r.version) || 1;
    await this.saveConfig(cfg);
    await log(true, 'setup', 'Head office connected to Google Drive');
    this.syncNow({ force: true }).catch(() => {});
    return cfg;
  },

  /** A branch phone joins using the code HQ shared on WhatsApp. */
  async joinWithCode(code: string, branchName: string, opts: { asOwner?: boolean } = {}): Promise<SyncConfig> {
    const j = readJoinCode(String(code || '').replace(/\s+/g, '').replace(/^.*?(SBXJOIN1\.)/, '$1'));
    const cfg: SyncConfig = {
      url: j.url, chainId: j.chainId, chainName: j.chainName, secret: j.secret,
      branchId: rnd(6), branchName: branchName.trim() || (opts.asOwner ? 'Main' : 'Branch'), isHQ: !!opts.asOwner, pushSelf: true,
      autoSync: true, cloudBackup: true, acceptCatalog: !opts.asOwner,
      hosted: j.hosted || (!!CLOUD_URL && cleanUrl(CLOUD_URL) === cleanUrl(j.url)),
    };
    const r = await call(cfg, 'ping');
    cfg.scriptVersion = Number(r.version) || 1;
    await this.saveConfig(cfg);
    await log(true, 'setup', `Joined ${j.chainName || 'chain'} as ${cfg.branchName}`);
    // The owner's replacement phone restores first; syncing now would push an
    // empty salon as an extra "branch".
    if (!opts.asOwner) this.syncNow({ force: true }).catch(() => {});
    return cfg;
  },

  async joinCode(): Promise<string> {
    const cfg = await this.getConfig();
    if (!cfg) throw new Error('Not connected.');
    return makeJoinCode({ url: cfg.url, chainId: cfg.chainId, secret: cfg.secret, chainName: cfg.chainName, hosted: !!cfg.hosted });
  },

  async disconnect() {
    await this.saveConfig(null);
    await DBX.setSetting(K.cache, '').catch(() => {});
    await log(true, 'setup', 'Disconnected from Google Drive');
  },

  /**
   * Push summary (every 15 min at most), daily encrypted backup, pick up the
   * HQ price list. Safe to call often: it throttles itself and never throws.
   */
  async syncNow(opts: { force?: boolean; backup?: boolean } = {}): Promise<{ ok: boolean; message: string }> {
    if (running) return running;
    running = (async () => {
      const cfg = await this.getConfig();
      if (!cfg) return { ok: false, message: 'Not connected to Google Drive.' };
      const now = Date.now();
      const msgs: string[] = [];
      try {
        const lastPush = Number(await DBX.getSetting(K.lastPush)) || 0;
        if ((cfg.pushSelf || !cfg.isHQ) && (opts.force || now - lastPush > PUSH_EVERY_MS)) {
          const summary = await buildSummary(cfg);
          // Shared cloud: the figures are encrypted with the chain key, so
          // nobody but the owner's phones can read them.
          const payload = cfg.hosted
            ? { branchName: cfg.branchName, summary: {}, enc: encryptBackup(JSON.stringify(summary), cfg.secret, Crypto.getRandomBytes(16)) }
            : { branchName: cfg.branchName, summary };
          await call(cfg, 'push_summary', payload);
          await DBX.setSetting(K.lastPush, String(Date.now()));
          msgs.push('Figures sent');
        }

        if (cfg.cloudBackup && (cfg.pushSelf || !cfg.isHQ)) {
          const lastBackup = Number(await DBX.getSetting(K.lastBackup)) || 0;
          const due = toLocalDateStr(new Date(lastBackup || 0)) !== todayLocal();
          if (opts.backup || (due && (opts.force || now - lastBackup > 6 * 3600 * 1000))) {
            const r = await this.backupNow();
            msgs.push(r.message);
          }
        }

        // Online booking: publish menu + busy times, collect new requests.
        try {
          const n = await this.syncBookings(cfg);
          if (n > 0) msgs.push(`${n} new online booking${n > 1 ? 's' : ''}`);
        } catch (e: any) {
          if (/update your script/i.test(e?.message || '')) msgs.push(e.message);
        }

        if (!cfg.isHQ && cfg.acceptCatalog) {
          const since = Number(await DBX.getSetting(K.catalogVer)) || 0;
          const r = await call(cfg, 'get_catalog', { since });
          if (r.changed && r.catalog?.services) {
            const a = await DBX.applyCatalog(r.catalog.services);
            await DBX.setSetting(K.catalogVer, String(r.catalog.version));
            await log(true, 'catalog', `Price list from HQ: ${a.updated} updated, ${a.added} added`);
            msgs.push('Price list updated from HQ');
          }
        }
        if (msgs.length) await log(true, 'sync', msgs.join(' · '));
        return { ok: true, message: msgs.join(' · ') || 'Already up to date.' };
      } catch (e: any) {
        await log(false, 'sync', e?.message || String(e));
        return { ok: false, message: e?.message || 'Sync failed.' };
      }
    })();
    try { return await running; } finally { running = null; }
  },

  /**
   * Publish the booking profile and pull new requests. Cheap (two small
   * calls), so it runs on every sync and from the dashboard every few minutes.
   */
  async syncBookings(cfgIn?: SyncConfig): Promise<number> {
    const cfg = cfgIn || await this.getConfig();
    if (!cfg) return 0;
    const { BookingService } = require('./BookingService') as typeof import('./BookingService');
    const bcfg = await BookingService.getConfig();
    const already = Number(await DBX.getSetting('booking_published')) || 0;
    if (!bcfg.enabled && !already) return 0;   // never turned on — nothing to do
    const pub = await call(cfg, 'push_booking', await BookingService.buildProfile());
    if (pub?.slug) await DBX.setSetting('booking_slug', String(pub.slug)).catch(() => {});
    await DBX.setSetting('booking_published', bcfg.enabled ? String(Date.now()) : '');
    // Acknowledge what we stored last time (the cloud then wipes the customer's
    // details) and report accepted / declined requests (frees their slots).
    const ack = await getJSON<string[]>('booking_ack', []);
    const resolved = await getJSON<{ id: string; status: string }[]>('booking_resolved', []);
    const r = await call(cfg, 'get_bookings', { ack: ack.slice(0, 200), resolved: resolved.slice(0, 200) });
    const list = r.requests || [];
    const n = await BookingService.receive(list);   // stored first (duplicates ignored)…
    await DBX.setSetting('booking_ack', JSON.stringify(list.map((x: any) => String(x.id)))); // …then acknowledged next time
    if (resolved.length) {
      const sent = new Set(resolved.slice(0, 200).map(x => x.id));
      const left = (await getJSON<{ id: string; status: string }[]>('booking_resolved', [])).filter(x => !sent.has(x.id));
      await DBX.setSetting('booking_resolved', JSON.stringify(left));
    }
    return n;
  },

  /** Dashboard poll: at most every 3 minutes, silent on failure. */
  async checkBookings(): Promise<number> {
    const last = Number(await DBX.getSetting('booking_last_check')) || 0;
    if (Date.now() - last < 3 * 60 * 1000) return 0;
    await DBX.setSetting('booking_last_check', String(Date.now())).catch(() => {});
    try { return await this.syncBookings(); } catch { return 0; }
  },

  /** Script version deployed in the owner's account (1 = before online booking). */
  async scriptVersion(): Promise<number> {
    const cfg = await this.getConfig();
    if (!cfg) return 0;
    const r = await call(cfg, 'ping');
    const v = Number(r.version) || 1;
    if (cfg.scriptVersion !== v) await this.saveConfig({ ...cfg, scriptVersion: v }).catch(() => {});
    return v;
  },

  /** Is the seller's one-tap cloud available in this build? */
  hostedAvailable(): boolean { return /^https:\/\/script\.google\.com\/.+\/exec$/.test(CLOUD_URL); },

  /**
   * ONE TAP: backup + branches + online booking on the seller's shared cloud.
   * Names come from the salon profile. Safe to call twice.
   */
  async enableCloud(opts: { chainName?: string; branchName?: string } = {}): Promise<SyncConfig> {
    // One at a time: onboarding's auto-enable and a tap on "Turn on" must not create two salons.
    if (enabling) return enabling;
    enabling = this._enableCloud(opts);
    try { return await enabling; } finally { enabling = null; }
  },

  async _enableCloud(opts: { chainName?: string; branchName?: string }): Promise<SyncConfig> {
    const existing = await this.getConfig();
    if (existing) return existing;
    if (!this.hostedAvailable()) throw new Error('One-tap cloud is not set up in this app. Use "My own Google account" instead.');
    const p: any = await DBX.getSalonProfile().catch(() => ({}));
    const salon = String(opts.chainName || p?.name || 'My Salon').trim();
    const branch = String(opts.branchName || p?.city || p?.area || 'Main').trim();
    const cfg = await this.setupHQ({ url: CLOUD_URL, chainName: salon, branchName: branch, pushSelf: true, hosted: true });
    await DBX.setSetting(K.auto, '').catch(() => {});
    return cfg;
  },

  /** Ask for the cloud to be switched on automatically as soon as there is internet. */
  async requestAutoEnable(on = true) { await DBX.setSetting(K.auto, on ? 'true' : '').catch(() => {}); },

  /**
   * Called on app start / resume: if the owner said "yes" during setup but the
   * phone was offline, finish it now — silently, at most every 10 minutes.
   */
  async ensureAutoCloud(): Promise<boolean> {
    try {
      if (!this.hostedAvailable() || (await this.getConfig())) return false;
      if ((await DBX.getSetting(K.auto)) !== 'true') return false;
      const last = Number(await DBX.getSetting(K.autoTry)) || 0;
      if (Date.now() - last < 10 * 60 * 1000) return false;
      await DBX.setSetting(K.autoTry, String(Date.now()));
      await this.enableCloud();
      return true;
    } catch (e: any) {
      await log(false, 'setup', e?.message || 'Cloud setup will retry');
      return false;
    }
  },

  /** Called from App.tsx when the app goes to background / comes back. */
  async autoSync() {
    if (await this.ensureAutoCloud()) return;   // just connected — that already synced
    const cfg = await this.getConfig();
    if (!cfg?.autoSync) return;
    await this.syncNow().catch(() => {});
  },

  async backupNow(): Promise<{ ok: boolean; message: string }> {
    const cfg = await this.getConfig();
    if (!cfg) return { ok: false, message: 'Not connected.' };
    const json = await DBX.exportAllData();
    const blob = encryptBackup(json, cfg.secret, Crypto.getRandomBytes(16));
    const name = `${toLocalDateStr()}_${(cfg.branchName || 'branch').replace(/[^a-z0-9]+/gi, '-').slice(0, 30)}`;
    await call(cfg, 'push_backup', { name, label: (cfg.branchName || '').slice(0, 30), data: blob }, {}, 120000);
    await DBX.setSetting(K.lastBackup, String(Date.now()));
    await log(true, 'backup', `Encrypted backup saved to Drive (${Math.round(blob.length / 1024)} KB)`);
    return { ok: true, message: 'Backup saved to Google Drive' };
  },

  async listCloudBackups(allBranches = false): Promise<any[]> {
    const cfg = await this.getConfig();
    if (!cfg) return [];
    const r = await call(cfg, 'list_backups', allBranches ? { all: true, branchId: '' } : { branchId: cfg.branchId });
    return r.backups || [];
  },

  /** Replace this phone's data with a cloud backup (any branch of the chain). */
  async restoreCloudBackup(fileId: string, adoptBranchId?: string): Promise<{ success: boolean; message: string }> {
    const cfg = await this.getConfig();
    if (!cfg) return { success: false, message: 'Not connected.' };
    const r = await call(cfg, 'get_backup', { fileId }, {}, 120000);
    let json: string;
    try { json = decryptBackup(r.data, cfg.secret); }
    catch (e: any) { return { success: false, message: e?.message || 'Could not decrypt the backup.' }; }
    const res = await DBX.importData(json);
    if (res.success) {
      // A replacement phone takes over the old phone's place, so HQ shows one
      // branch (not a dead one + a new one) and backups continue in the same folder.
      const keepId = adoptBranchId && /^[a-z0-9]{4,40}$/i.test(adoptBranchId) ? adoptBranchId : cfg.branchId;
      // Always re-save: this phone's cloud identity must survive the restore.
      await this.saveConfig({ ...cfg, branchId: keepId });
      if (keepId !== cfg.branchId) await log(true, 'restore', 'This phone now continues as the restored branch');
      await log(true, 'restore', `Restored ${r.name}`); BossAI.invalidate();
    }
    return res;
  },

  // ── Head office ───────────────────────────────────────────────────────────
  async pullBranches(): Promise<BranchRecord[]> {
    const cfg = await this.getConfig();
    if (!cfg?.isHQ) throw new Error('Only the head-office phone can see all branches.');
    if (cfg.pushSelf) await this.syncNow({ force: true }).catch(() => {});
    const r = await call(cfg, 'pull_branches');
    const list: BranchRecord[] = (r.branches || []).map((b: any) => {
      if (b?.enc) {
        try { return { ...b, summary: JSON.parse(decryptBackup(b.enc, cfg.secret)), enc: undefined }; }
        catch { return { ...b, summary: {}, enc: undefined }; }
      }
      return b;
    });
    await DBX.setSetting(K.cache, JSON.stringify(list)).catch(() => {});
    await DBX.setSetting(K.lastPull, String(Date.now()));
    return this.decorate(list);
  },

  async getCachedBranches(): Promise<BranchRecord[]> {
    return this.decorate(await getJSON<BranchRecord[]>(K.cache, []));
  },

  decorate(list: BranchRecord[]): BranchRecord[] {
    return list.map(b => {
      const age = Math.round((Date.now() - Date.parse(b.receivedAt || b.summary?.generatedAt || 0 as any)) / 60000);
      return { ...b, ageMin: isFinite(age) ? age : 99999, stale: !isFinite(age) || age > STALE_MIN };
    }).sort((a, b) => (b.summary?.month?.revenue || 0) - (a.summary?.month?.revenue || 0));
  },

  async publishCatalog(note = ''): Promise<{ count: number }> {
    const cfg = await this.getConfig();
    if (!cfg?.isHQ) throw new Error('Only head office can publish the price list.');
    const services = await DBX.getCatalogForSync();
    await call(cfg, 'push_catalog', { services, note });
    await log(true, 'catalog', `Published ${services.length} services to all branches`);
    return { count: services.length };
  },

  async removeBranch(branchId: string) {
    const cfg = await this.getConfig();
    if (!cfg?.isHQ) return;
    await call(cfg, 'remove_branch', { branchId });
    const list = (await getJSON<BranchRecord[]>(K.cache, [])).filter(b => b.branchId !== branchId);
    await DBX.setSetting(K.cache, JSON.stringify(list));
  },

  async testConnection(): Promise<string> {
    const cfg = await this.getConfig();
    if (!cfg) throw new Error('Not connected.');
    const t = Date.now();
    await call(cfg, 'ping');
    return `Connected · ${Date.now() - t} ms`;
  },
};
