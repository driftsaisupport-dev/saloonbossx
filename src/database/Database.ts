import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import PBKDF2 from 'crypto-js/pbkdf2';
import { csvDocument, maskIdNumber } from '../utils/sanitize';
import {
  runMigrations, LATEST_VERSION, convertTimestampsToLocal, maskIdentityNumbers, isIgnorableSchemaError,
  seedFyCounterFromLegacy, backfillBillTaxRates, recountNoShows,
} from './migrations';
import {
  BACKUP_TABLES, NON_PORTABLE_SETTINGS, BACKUP_FORMAT_VERSION, CLEAR_WHEN_ABSENT, auditSchemaCoverage,
} from './schema';
import { createWriteLock, type WriteLock } from './writeLock';
import { ClientPhotoService, isClientPhotoUri } from '../services/ClientPhotoService';
import {
  round2, toPaise, fromPaise, addMoney, allocatePayment, expectedBillTotal, loyaltyPointsFor,
  computeCashTally, paymentParts, splitGst, invoiceTaxBreakup, billTaxableValue, type CashTally,
} from '../utils/money';
import {
  isValidYmd, isValidHHMM, hhmmToMin, minToHHMM, stampRange, addDaysYmd, localDateTime,
  financialYear, lockState, lockoutMinutes, proratedFixedSalary, nextTokenNo, computeQueueStats,
  QUEUE_STATUSES, maxSerial, quoteIdent,
} from '../utils/rules';
import { appLocale, curSym } from '../config/regions';

// ═══════════════════════════════════════════════════════════════════════════
// CONNECTION, WRITE LOCK, OPEN ERRORS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Why the database could not be opened. App.tsx shows a calm recovery screen
 * for these instead of a crash — and the data on disk is NEVER deleted.
 *  - key_unavailable  the phone's keystore did not give us the encryption key
 *                     (often temporary right after a reboot / OS update)
 *  - cannot_open      the key we have does not open the file
 *  - migration_failed moving an old unencrypted database into the encrypted
 *                     one did not complete; the old copy is kept as *.bak
 */
export type DatabaseOpenErrorCode = 'key_unavailable' | 'cannot_open' | 'migration_failed';

export class DatabaseOpenError extends Error {
  code: DatabaseOpenErrorCode;
  constructor(code: DatabaseOpenErrorCode, message: string) {
    super(message);
    this.name = 'DatabaseOpenError';
    this.code = code;
  }
}

export function isDatabaseOpenError(e: unknown): e is DatabaseOpenError {
  return !!e && ((e as any) instanceof DatabaseOpenError || (e as any)?.name === 'DatabaseOpenError');
}

// The open connection lives on globalThis so a Fast Refresh (which re-evaluates
// this module and would otherwise reset it without re-running the one-time boot
// in App.tsx) keeps working. `setDb` writes both places.
const G = globalThis as any;
let rawDb: SQLite.SQLiteDatabase = G.__sbxDb;
let initPromise: Promise<void> | null = G.__sbxInitPromise || null;
function setDb(x: SQLite.SQLiteDatabase) { rawDb = x; G.__sbxDb = x; }

/** The single write lock for the single connection (see writeLock.ts). */
const writeLock: WriteLock = G.__sbxWriteLock || (G.__sbxWriteLock = createWriteLock());

/**
 * `db` — the connection every function in this file uses. Reads go straight
 * through. Every WRITE waits for the write lock, so a stand-alone write can
 * never land inside (and be rolled back with) somebody else's transaction.
 *
 * Inside withWriteTxn(), use the `tx` handle you are given, never `db`, for
 * writes: `db` would wait for the lock the transaction already holds.
 */
const db = {
  getFirstAsync: (...a: any[]) => (rawDb as any).getFirstAsync(...a),
  getAllAsync: (...a: any[]) => (rawDb as any).getAllAsync(...a),
  runAsync: (...a: any[]) => writeLock.exclusive(() => (rawDb as any).runAsync(...a)),
  execAsync: (sql: string) => writeLock.exclusive(() => rawDb.execAsync(sql)),
} as unknown as SQLite.SQLiteDatabase;

/**
 * Run `fn` as ONE transaction: BEGIN IMMEDIATE → fn(tx) → COMMIT, or ROLLBACK
 * and rethrow. Serialised with every other write in the app.
 */
export async function withWriteTxn<T>(fn: (tx: SQLite.SQLiteDatabase) => Promise<T>): Promise<T> {
  if (!rawDb) throw new Error('The database is not open yet. Please wait a moment and try again.');
  return writeLock.withTxn(rawDb, fn);
}

const DB_NAME = 'SaloonBossX.db';
const KEY_NAME = 'db_encryption_key';
const sqliteDir = () => (FileSystem.documentDirectory || '') + 'SQLite/';
const dbPath = () => sqliteDir() + DB_NAME;
/** Rows rescued from a legacy plaintext DB, waiting to be imported into the encrypted one. */
const PLAINTEXT_EXPORT = () => sqliteDir() + DB_NAME + '.plaintext-export.json';
const DB_FILE_SUFFIXES = ['', '-wal', '-shm', '-journal'];

/**
 * A bill that counts as a sale. Cancelled originals and their credit notes are
 * excluded together, so a voided bill disappears from revenue, bill counts,
 * staff commission and top-services instead of being double counted (the
 * credit note re-lists the same items with positive prices).
 */
const VALID = "payment_status NOT IN ('cancelled','credit_note')";
const VALID_B = "b.payment_status NOT IN ('cancelled','credit_note')";
/** Revenue excluding GST — what the salon actually earns (GST belongs to the government). */
const NET_B = '(b.total - b.tax_amount)';
const NET = '(total - tax_amount)';
/** Loyalty tier from lifetime spend. */
const TIER_SQL = "CASE WHEN total_spent>=50000 THEN 'Platinum' WHEN total_spent>=20000 THEN 'Gold' WHEN total_spent>=5000 THEN 'Silver' ELSE 'Bronze' END";
/** Bookings may be entered up to this long after they started (walk-ins typed in late). */
const PAST_GRACE_MS = 30 * 60000;
const isNoShow = (s: unknown) => /^no[-_ ]?show$/i.test(String(s || ''));

/**
 * Transition safety for H2: createBill now deducts stock itself. Until the
 * billing screen stops calling deductStock() after createBill, the follow-up
 * call is absorbed here (same product, within 2 minutes, up to the quantity
 * just billed) instead of deducting twice.
 */
const stockCredits: Map<number, { qty: number; expires: number }> = G.__sbxStockCredits || (G.__sbxStockCredits = new Map());

/** Local wall-clock timestamp in SQLite's own `YYYY-MM-DD HH:MM:SS` form. */
const localStamp = (d: Date = new Date()): string => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

// Dates are stored/queried as local `YYYY-MM-DD`. `toISOString()` gives the UTC
// date, which is a day ahead in IST between 00:00 and 05:30 — use this instead.
const localDateStr = (d: Date = new Date()): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const parseJson = <T,>(s: unknown, fallback: T): T => {
  if (s == null || s === '') return fallback;
  if (typeof s !== 'string') return s as T;
  try { const v = JSON.parse(s); return (v ?? fallback) as T; } catch { return fallback; }
};

// ── Encryption key ─────────────────────────────────────────────────────────
// 256-bit random key for SQLCipher, generated ONCE (for a brand-new database)
// and kept in the OS keystore. Used as a raw key ("x'<hex>'") so SQLCipher
// skips its own PBKDF2 step.
//
// The old version generated a NEW key whenever the keystore read failed, then
// concluded the existing file was "plaintext", failed to read it, and deleted
// the database files — silent total data loss after a keystore hiccup. Now a
// key is only ever created when there is no database yet (or the existing one
// is provably plaintext), and nothing is ever deleted.

async function readDbKey(): Promise<string | null> {
  let k: string | null = null;
  try {
    k = await SecureStore.getItemAsync(KEY_NAME);
  } catch (e: any) {
    throw new DatabaseOpenError('key_unavailable',
      `The phone's secure storage did not respond (${e?.message || 'keystore error'}).`);
  }
  if (k == null || k === '') return null;
  if (!/^[0-9a-f]{64}$/.test(k)) {
    throw new DatabaseOpenError('key_unavailable', 'The stored database key is damaged.');
  }
  return k;
}

async function createDbKey(): Promise<string> {
  const k = Array.from(Crypto.getRandomBytes(32)).map((b) => b.toString(16).padStart(2, '0')).join('');
  try {
    await SecureStore.setItemAsync(KEY_NAME, k);
    // Read it back: an encrypted database whose key was never really saved is
    // unrecoverable on the next launch.
    if ((await SecureStore.getItemAsync(KEY_NAME)) !== k) throw new Error('read-back mismatch');
  } catch (e: any) {
    throw new DatabaseOpenError('key_unavailable',
      `Could not save the database key in the phone's secure storage (${e?.message || 'keystore error'}).`);
  }
  return k;
}

async function fileSize(uri: string): Promise<number> {
  try {
    const info: any = await FileSystem.getInfoAsync(uri);
    return info?.exists ? Number(info.size || 0) : 0;
  } catch { return 0; }
}

async function fileExists(uri: string): Promise<boolean> {
  try { return !!(await FileSystem.getInfoAsync(uri))?.exists; } catch { return false; }
}

async function isSQLCipher(): Promise<boolean> {
  try {
    const r: any = await rawDb.getFirstAsync('PRAGMA cipher_version');
    return !!(r && (r.cipher_version || Object.values(r)[0]));
  } catch { return false; }
}

async function canReadWithKey(key: string): Promise<boolean> {
  try {
    await rawDb.execAsync(`PRAGMA key = "x'${key}'";`);
    await rawDb.getFirstAsync('SELECT count(*) FROM sqlite_master');
    return true;
  } catch { return false; }
}

async function canReadWithoutKey(): Promise<boolean> {
  try {
    await rawDb.getFirstAsync('SELECT count(*) FROM sqlite_master');
    return true;
  } catch { return false; }
}

async function closeQuietly() {
  try { await rawDb?.closeAsync(); } catch { /* already closed */ }
}

/** Move a file aside (never delete). Returns the new name, or '' if there was nothing to move. */
async function moveAside(uri: string, suffix: string): Promise<string> {
  if (!(await fileExists(uri))) return '';
  let target = uri + suffix;
  if (await fileExists(target)) target = `${uri}${suffix}-${Date.now()}`;
  await FileSystem.moveAsync({ from: uri, to: target });
  return target;
}

// Keys whose values are sensitive (license entitlement + customer identity).
// These are transparently stored in the OS keystore/keychain instead of the
// plaintext settings table. getSetting/setSetting route them automatically, so
// callers do not change. Legacy plaintext values are migrated on first read.
const SECURE_KEYS = new Set<string>([
  'license_key',
  'license_device',
  'license_email',
  'license_name',
  'license_device_install_id',
  // Branch sync: holds the chain secret that signs Drive requests and
  // encrypts cloud backups. Never in the plaintext settings table.
  'sync_config',
]);

async function secureGet(key: string): Promise<string> {
  try {
    const v = await SecureStore.getItemAsync(key);
    if (v != null) return v;
  } catch { /* keystore unavailable — fall through to legacy */ }
  // One-time migration from the old plaintext settings row.
  try {
    const r: any = await db.getFirstAsync('SELECT value FROM settings WHERE key=?', key);
    const legacy = r?.value || '';
    if (legacy) {
      try {
        await SecureStore.setItemAsync(key, legacy);
        await db.runAsync('DELETE FROM settings WHERE key=?', key);
      } catch { /* keep legacy row if we cannot write the keystore */ }
    }
    return legacy;
  } catch { return ''; }
}

async function secureSet(key: string, value: string): Promise<void> {
  try {
    if (value) await SecureStore.setItemAsync(key, value);
    else await SecureStore.deleteItemAsync(key);
  } catch {
    // Keystore failed — fall back to the settings table so the app still works.
    await db.runAsync('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)', key, value);
    return;
  }
  // Remove any legacy plaintext copy; failure here is harmless (the keystore wins on read).
  await db.runAsync('DELETE FROM settings WHERE key=?', key).catch(() => {});
}

/** Options for importData. */
export interface ImportOptions {
  /**
   * Keep this phone's logins (app_users) instead of replacing them with the
   * ones in the file. DEFAULT TRUE. A restore that replaces logins lets anyone
   * with a hand-edited backup (e.g. a manager) give themselves an owner account,
   * so the UI must only pass `false` after the OWNER re-entered their PIN.
   * When this phone has no logins at all (fresh install) the file's logins are
   * always used.
   */
  keepLocalUsers?: boolean;
  /** @internal — moving this phone's own plaintext DB into the encrypted one. */
  _deviceMigration?: boolean;
  /** @internal — a settings row written inside the restore transaction. */
  _marker?: [string, string];
}

/** What createBill returns. */
export interface CreateBillResult {
  billNumber: string;
  billId: number;
  /** Product stock was deducted inside the bill transaction. The UI must NOT call deductStock() again. */
  stockHandled: true;
  /** Loyalty points actually credited now (on the amount paid now). */
  pointsEarned: number;
  /** Still owed on a pay-later bill. */
  amountDue: number;
  /** Paid from the client's prepaid wallet. */
  walletUsed: number;
  /** Wallet balance after this bill (only when wallet was used). */
  walletBalance?: number;
  /** Products that are now at or below their minimum stock. */
  lowStock: { id: number; name: string; quantity: number; unit: string }[];
  /** Appointment advance left over after this bill, credited to the client's wallet. */
  advanceToWallet: number;
}

export const DatabaseService = {
  _pendingSnapshot: null as string | null,

  async initialize(): Promise<void> {
    // Dedupe: multiple callers (App boot, a self-heal, a Fast Refresh) share one run.
    if (initPromise) return initPromise;
    initPromise = this._doInitialize();
    G.__sbxInitPromise = initPromise;
    try { await initPromise; }
    catch (e) { initPromise = null; G.__sbxInitPromise = null; throw e; }
  },

  /**
   * One ordered boot sequence. (It used to be four monkey-patched wrappers
   * around initialize() whose order depended on module evaluation, and the
   * rescued plaintext rows were re-imported BEFORE the later tables existed.)
   */
  async _doInitialize(): Promise<void> {
    await this._openEncrypted();
    await rawDb.execAsync(`PRAGMA journal_mode = WAL;`);
    await rawDb.execAsync(`PRAGMA foreign_keys = ON;`);
    await this.createTables();
    await this.runMigrations();          // legacy ALTERs (pre-versioning installs)
    await this.createIndexes();
    await (this as any).runMigrationsV3(); // academy tables
    await (this as any).runMigrationsV4(); // logins, audit log, attendance policy
    try {
      const applied = await runMigrations(rawDb, withWriteTxn);
      if (__DEV__) console.warn(`[db] schema at version ${applied} of ${LATEST_VERSION}`);
    } catch (e) {
      console.error('[db] migration failed:', e);
      throw e;
    }
    // Only now — every table and column exists, user_version is final — bring
    // in rows rescued from a legacy plaintext database.
    await this._finishPlaintextMigration();
    G.__sbxReady = true;
  },

  // Any DB call can await this — it's a no-op once the connection is live, and
  // it transparently (re)initialises if the module was reloaded without a boot.
  async ensureReady(): Promise<void> {
    if (initPromise) { await initPromise; return; }
    if (rawDb && G.__sbxReady) return;
    await this.initialize();
  },

  /**
   * Open the database with SQLCipher when the native build supports it.
   *
   *  no file yet            → create a key (once) and an encrypted database
   *  file + key opens it    → done
   *  file opens WITHOUT key → legacy plaintext DB: export it, move the files to
   *                           *.plaintext.bak, create the encrypted DB; the rows
   *                           are imported at the end of initialise
   *  anything else          → throw DatabaseOpenError. NOTHING is deleted.
   *
   * On builds without SQLCipher (Expo Go during development) it runs plaintext.
   */
  async _openEncrypted(): Promise<void> {
    const exists = (await fileSize(dbPath())) > 0 || (await fileSize(dbPath() + '-wal')) > 0;
    setDb(await SQLite.openDatabaseAsync(DB_NAME, { useNewConnection: true }));

    if (!(await isSQLCipher())) return; // dev / non-cipher build — run plaintext

    let key = await readDbKey(); // throws key_unavailable if the keystore errors

    if (!exists) {
      if (!key) key = await createDbKey();
      if (!(await canReadWithKey(key))) {
        await closeQuietly();
        throw new DatabaseOpenError('cannot_open', 'Could not create the encrypted database.');
      }
      return;
    }

    if (key && (await canReadWithKey(key))) return; // the normal case

    // The key (if any) did not open it. Only a database that opens with NO key
    // is a legacy plaintext one; anything else is a key problem we must not
    // "fix" by throwing data away.
    await closeQuietly();
    setDb(await SQLite.openDatabaseAsync(DB_NAME, { useNewConnection: true }));
    if (!(await canReadWithoutKey())) {
      await closeQuietly();
      throw new DatabaseOpenError(
        key ? 'cannot_open' : 'key_unavailable',
        key
          ? 'The saved key does not open this database.'
          : 'The encryption key for this database is missing from the phone\'s secure storage.'
      );
    }
    if (!key) key = await createDbKey();
    await this._migratePlaintextToEncrypted(key);
  },

  /**
   * Legacy plaintext → encrypted. The export is written to disk BEFORE the old
   * files are touched, the old files are renamed (never deleted until the
   * encrypted copy is verified), and the import happens only after every
   * migration has run — see _finishPlaintextMigration.
   */
  async _migratePlaintextToEncrypted(key: string): Promise<void> {
    const r: any = await rawDb.getFirstAsync(
      "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    );
    if ((r?.n || 0) > 0) {
      const uv: any = await rawDb.getFirstAsync('PRAGMA user_version');
      const json = await this.exportAllData({ deviceMigration: true });
      const snap = JSON.parse(json);
      snap.source_user_version = Number(uv?.user_version ?? 0);
      const tmp = PLAINTEXT_EXPORT() + '.tmp';
      await FileSystem.writeAsStringAsync(tmp, JSON.stringify(snap), { encoding: 'utf8' });
      await FileSystem.deleteAsync(PLAINTEXT_EXPORT(), { idempotent: true }); // a stale earlier attempt
      await FileSystem.moveAsync({ from: tmp, to: PLAINTEXT_EXPORT() });
    }
    try { await rawDb.execAsync('PRAGMA wal_checkpoint(TRUNCATE);'); } catch { /* not in WAL mode */ }
    await closeQuietly();
    for (const suffix of DB_FILE_SUFFIXES) {
      await moveAside(dbPath() + suffix, '.plaintext.bak');
    }
    setDb(await SQLite.openDatabaseAsync(DB_NAME, { useNewConnection: true }));
    if (!(await canReadWithKey(key))) {
      await closeQuietly();
      throw new DatabaseOpenError('migration_failed', 'Could not create the encrypted database. Your old data is kept as a .bak file.');
    }
  },

  /** Import rows rescued from the plaintext DB, verify them, then clean up. */
  async _finishPlaintextMigration(): Promise<void> {
    if (!(await fileExists(PLAINTEXT_EXPORT()))) return;
    const json = await FileSystem.readAsStringAsync(PLAINTEXT_EXPORT(), { encoding: 'utf8' });
    let snap: any;
    try { snap = JSON.parse(json); }
    catch {
      throw new DatabaseOpenError('migration_failed',
        'The saved copy of your old data could not be read. The original is kept as a .bak file — contact support.');
    }
    const marker = `plaintext_import_${snap.export_date || 'x'}`;
    const done: any = await rawDb.getFirstAsync('SELECT value FROM settings WHERE key=?', marker);
    if (!done?.value) {
      const res = await this.importData(json, { keepLocalUsers: false, _deviceMigration: true, _marker: [marker, '1'] });
      if (!res.success) {
        throw new DatabaseOpenError('migration_failed', `Moving your data into the encrypted database did not finish. ${res.message}`);
      }
      // Verify every table holds at least what the old file had.
      for (const t of BACKUP_TABLES) {
        const want = Array.isArray(snap[t]) ? snap[t].length : 0;
        if (!want) continue;
        const got: any = await rawDb.getFirstAsync(`SELECT COUNT(*) AS n FROM ${quoteIdent(t)}`);
        if ((got?.n || 0) < want) {
          throw new DatabaseOpenError('migration_failed',
            `Only ${got?.n || 0} of ${want} ${t} rows arrived in the encrypted database. The old copy is kept.`);
        }
      }
    }
    // Verified: the plaintext copies can go (they hold customer data unencrypted).
    for (const suffix of DB_FILE_SUFFIXES) {
      await FileSystem.deleteAsync(dbPath() + suffix + '.plaintext.bak', { idempotent: true }).catch(() => {});
    }
    await FileSystem.deleteAsync(PLAINTEXT_EXPORT(), { idempotent: true }).catch(() => {});
  },

  /**
   * Recovery screen → "Restore from backup file". Moves the unreadable
   * database aside (it is NEVER deleted — support can still recover it if the
   * key comes back), starts a fresh encrypted database and restores the given
   * backup into it. The old key, if any, is kept under another name.
   */
  async recoverFromBackupJson(json: string): Promise<{ success: boolean; message: string }> {
    let parsed: any;
    try { parsed = JSON.parse(json); } catch { return { success: false, message: 'That file is not a SaloonBossX backup (not valid JSON).' }; }
    if (parsed?.app !== 'SaloonBossX') return { success: false, message: 'That file is not a SaloonBossX backup.' };
    if (Number(parsed.format || 1) > BACKUP_FORMAT_VERSION) {
      return { success: false, message: 'This backup was made by a newer version of SaloonBossX. Update the app first.' };
    }
    await closeQuietly();
    const stamp = Date.now();
    for (const suffix of DB_FILE_SUFFIXES) {
      try { await moveAside(dbPath() + suffix, `.unreadable-${stamp}`); }
      catch (e: any) { return { success: false, message: `Could not set the old database aside: ${e?.message || e}` }; }
    }
    try {
      const oldKey = await SecureStore.getItemAsync(KEY_NAME);
      if (oldKey) {
        await SecureStore.setItemAsync(`${KEY_NAME}_old_${stamp}`, oldKey);
        await SecureStore.deleteItemAsync(KEY_NAME);
      }
    } catch { /* keystore unavailable — a new key cannot be stored either; initialise will say so */ }
    initPromise = null; G.__sbxInitPromise = null; G.__sbxReady = false;
    try {
      await this.initialize();
    } catch (e: any) {
      return { success: false, message: e?.message || 'Could not start a new database.' };
    }
    return this.importData(json, { keepLocalUsers: false });
  },

  async createTables(): Promise<void> {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS salon_profile (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT DEFAULT '', owner_name TEXT DEFAULT '', phone TEXT DEFAULT '', email TEXT DEFAULT '', address TEXT DEFAULT '', city TEXT DEFAULT '', state TEXT DEFAULT '', gst_number TEXT DEFAULT '', upi_id TEXT DEFAULT '', currency TEXT DEFAULT 'INR', currency_symbol TEXT DEFAULT '₹', tax_rate REAL DEFAULT 5.0, country_code TEXT DEFAULT '+91', profile_image TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT DEFAULT (datetime('now','localtime')));
      CREATE TABLE IF NOT EXISTS services (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category TEXT DEFAULT 'General', price REAL DEFAULT 0, duration INTEGER DEFAULT 30, description TEXT DEFAULT '', is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now','localtime')));
      CREATE TABLE IF NOT EXISTS clients (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT DEFAULT '', email TEXT DEFAULT '', gender TEXT DEFAULT '', date_of_birth TEXT DEFAULT '', anniversary TEXT DEFAULT '', address TEXT DEFAULT '', notes TEXT DEFAULT '', allergies TEXT DEFAULT '', preferred_stylist_id INTEGER DEFAULT 0, loyalty_points INTEGER DEFAULT 0, loyalty_tier TEXT DEFAULT 'Bronze', total_visits INTEGER DEFAULT 0, total_spent REAL DEFAULT 0, last_visit TEXT DEFAULT '', referral_source TEXT DEFAULT '', is_active INTEGER DEFAULT 1, is_vip INTEGER DEFAULT 0, is_blacklisted INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT DEFAULT (datetime('now','localtime')));
      CREATE TABLE IF NOT EXISTS staff (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT DEFAULT '', role TEXT DEFAULT 'Stylist', commission_rate REAL DEFAULT 10.0, salary REAL DEFAULT 0, pin_code TEXT DEFAULT '', is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now','localtime')));
      CREATE TABLE IF NOT EXISTS appointments (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER DEFAULT 0, staff_id INTEGER DEFAULT 0, service_ids TEXT DEFAULT '[]', service_names TEXT DEFAULT '', date TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, status TEXT DEFAULT 'confirmed', notes TEXT DEFAULT '', total_amount REAL DEFAULT 0, deposit_paid REAL DEFAULT 0, is_walkin INTEGER DEFAULT 0, converted_to_bill INTEGER DEFAULT 0, bill_id INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now','localtime')));
      CREATE TABLE IF NOT EXISTS bills (id INTEGER PRIMARY KEY AUTOINCREMENT, bill_number TEXT NOT NULL UNIQUE, client_id INTEGER DEFAULT 0, staff_id INTEGER DEFAULT 0, appointment_id INTEGER DEFAULT 0, items TEXT DEFAULT '[]', subtotal REAL DEFAULT 0, tax_amount REAL DEFAULT 0, discount_amount REAL DEFAULT 0, discount_type TEXT DEFAULT 'flat', loyalty_discount REAL DEFAULT 0, total REAL DEFAULT 0, payment_method TEXT DEFAULT 'cash', payment_split TEXT DEFAULT '{}', payment_status TEXT DEFAULT 'paid', notes TEXT DEFAULT '', loyalty_points_earned INTEGER DEFAULT 0, loyalty_points_used INTEGER DEFAULT 0, is_walkin INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now','localtime')));
      CREATE TABLE IF NOT EXISTS inventory (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, brand TEXT DEFAULT '', category TEXT DEFAULT 'General', quantity REAL DEFAULT 0, unit TEXT DEFAULT 'pcs', min_stock REAL DEFAULT 5, cost_price REAL DEFAULT 0, sell_price REAL DEFAULT 0, supplier TEXT DEFAULT '', expiry_date TEXT DEFAULT '', is_active INTEGER DEFAULT 1, last_restocked TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT DEFAULT (datetime('now','localtime')));
      CREATE TABLE IF NOT EXISTS attendance (id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id INTEGER NOT NULL, date TEXT NOT NULL, check_in TEXT DEFAULT '', check_out TEXT DEFAULT '', status TEXT DEFAULT 'present', notes TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now','localtime')));
      CREATE TABLE IF NOT EXISTS memberships (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, price REAL DEFAULT 0, duration_days INTEGER DEFAULT 365, max_sessions INTEGER DEFAULT 0, discount_percent REAL DEFAULT 0, is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now','localtime')));
      CREATE TABLE IF NOT EXISTS client_memberships (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER NOT NULL, membership_id INTEGER NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL, sessions_used INTEGER DEFAULT 0, sessions_total INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now','localtime')));
      CREATE TABLE IF NOT EXISTS expenses (id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL, amount REAL NOT NULL, description TEXT DEFAULT '', date TEXT NOT NULL, payment_method TEXT DEFAULT 'cash', vendor TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now','localtime')));
      CREATE TABLE IF NOT EXISTS campaigns (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, type TEXT DEFAULT 'custom', message TEXT DEFAULT '', target_segment TEXT DEFAULT 'all', status TEXT DEFAULT 'draft', sent_count INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now','localtime')));
      CREATE TABLE IF NOT EXISTS reminders (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER, client_name TEXT, client_phone TEXT, service_name TEXT, remind_date TEXT, message TEXT, is_sent INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now','localtime')));
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT DEFAULT '');
    `);
    await this.seedDefaults();
  },

  async createIndexes(): Promise<void> {
    const indexes = [
      `CREATE INDEX IF NOT EXISTS idx_bills_created_at ON bills (created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_bills_client_id ON bills (client_id)`,
      `CREATE INDEX IF NOT EXISTS idx_bills_staff_id ON bills (staff_id)`,
      `CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments (date)`,
      `CREATE INDEX IF NOT EXISTS idx_appointments_staff_id ON appointments (staff_id)`,
      `CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients (phone)`,
      `CREATE INDEX IF NOT EXISTS idx_clients_name ON clients (name)`,
      `CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance (date)`,
      `CREATE INDEX IF NOT EXISTS idx_attendance_staff_id ON attendance (staff_id)`,
      `CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses (date)`,
    ];
    for (const sql of indexes) {
      try { await db.execAsync(sql); }
      catch (e) { console.warn('[db] index skipped:', sql, (e as any)?.message); /* an index is an optimisation, never fatal */ }
    }
  },

  async runMigrations(): Promise<void> {
    const migrations = [
      `ALTER TABLE bills ADD COLUMN appointment_id INTEGER DEFAULT 0`,
      `ALTER TABLE bills ADD COLUMN loyalty_discount REAL DEFAULT 0`,
      `ALTER TABLE bills ADD COLUMN loyalty_points_used INTEGER DEFAULT 0`,
      `ALTER TABLE bills ADD COLUMN payment_split TEXT DEFAULT '{}'`,
      `ALTER TABLE bills ADD COLUMN is_walkin INTEGER DEFAULT 0`,
      `ALTER TABLE appointments ADD COLUMN service_names TEXT DEFAULT ''`,
      `ALTER TABLE appointments ADD COLUMN converted_to_bill INTEGER DEFAULT 0`,
      `ALTER TABLE appointments ADD COLUMN bill_id INTEGER DEFAULT 0`,
      `ALTER TABLE appointments ADD COLUMN deposit_paid REAL DEFAULT 0`,
      `ALTER TABLE clients ADD COLUMN referral_source TEXT DEFAULT ''`,
      `ALTER TABLE clients ADD COLUMN is_vip INTEGER DEFAULT 0`,
      `ALTER TABLE clients ADD COLUMN is_blacklisted INTEGER DEFAULT 0`,
      `ALTER TABLE salon_profile ADD COLUMN currency_symbol TEXT DEFAULT '₹'`,
      `ALTER TABLE salon_profile ADD COLUMN country_code TEXT DEFAULT '+91'`,
      `ALTER TABLE salon_profile ADD COLUMN profile_image TEXT DEFAULT ''`,
      `ALTER TABLE staff ADD COLUMN is_active INTEGER DEFAULT 1`,
      `ALTER TABLE inventory ADD COLUMN expiry_date TEXT DEFAULT ''`,
      `ALTER TABLE attendance ADD COLUMN notes TEXT DEFAULT ''`,
      `ALTER TABLE expenses ADD COLUMN vendor TEXT DEFAULT ''`,
    ];
    for (const sql of migrations) {
      try { await db.execAsync(sql); }
      catch (e) {
        // Expected on every launch after the first: the column already exists.
        if (isIgnorableSchemaError(e)) continue;
        throw new Error(`Database upgrade step failed (${sql}): ${(e as any)?.message || e}`);
      }
    }
  },

  async seedDefaults() {
    const p = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM salon_profile');
    // New installs start at 5% GST: Indian GST on salon / spa services fell
    // from 18% to 5% from 22 Sep 2025. Existing installs are NOT changed
    // silently — getGstAdvice() lets the UI suggest it instead.
    if (!p || p.count === 0) await db.runAsync('INSERT INTO salon_profile (name, tax_rate) VALUES (?, 5)', 'My Salon');
    const defs = [
      ['language', 'en'], ['currency_symbol', curSym()], ['bill_prefix', 'SOS'],
      ['bill_counter', '1'], ['loyalty_points_per_100', '10'],
      ['onboarding_complete', 'false'], ['last_backup', ''], ['tax_rate', '5'],
      // GST is OFF until the owner turns it on (many salons are not GST registered).
      ['gst_enabled', 'false'], ['support_whatsapp', ''], ['support_email', ''],
    ];
    for (const [k, v] of defs) {
      await db.runAsync('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)', k, v);
    }
  },

  // === SALON PROFILE ===
  async getSalonProfile() { return await db.getFirstAsync('SELECT * FROM salon_profile LIMIT 1'); },
  async updateSalonProfile(data: any) {
    const allowed = ['name', 'owner_name', 'phone', 'email', 'address', 'city', 'state', 'gst_number', 'upi_id', 'currency', 'currency_symbol', 'tax_rate', 'country_code', 'profile_image'];
    const filtered: any = {};
    for (const k of allowed) if (k in data) filtered[k] = data[k];
    const fields = Object.keys(filtered).map(k => `${k}=?`).join(',');
    if (!fields) return true;
    await db.runAsync(`UPDATE salon_profile SET ${fields}, updated_at=datetime('now','localtime') WHERE id=1`, ...(Object.values(filtered) as SQLite.SQLiteBindValue[]));
    if ('tax_rate' in data) await db.runAsync("INSERT OR REPLACE INTO settings (key,value) VALUES ('tax_rate',?)", String(data.tax_rate));
    if ('currency_symbol' in data) await db.runAsync("INSERT OR REPLACE INTO settings (key,value) VALUES ('currency_symbol',?)", String(data.currency_symbol));
    return true;
  },

  // === SERVICES ===
  async getServices(activeOnly = true) { return await db.getAllAsync(`SELECT * FROM services ${activeOnly ? 'WHERE is_active=1' : ''} ORDER BY category,name`); },
  async addService(d: any) {
    const r = await db.runAsync('INSERT INTO services (name,category,price,duration,description) VALUES (?,?,?,?,?)', d.name, d.category || 'General', d.price, d.duration || 30, d.description || '');
    return r.lastInsertRowId;
  },
  async updateService(id: number, d: any) {
    const allowed = ['name', 'category', 'price', 'duration', 'description', 'is_active'];
    const filtered: any = {};
    for (const k of allowed) if (k in d) filtered[k] = d[k];
    const f = Object.keys(filtered).map(k => `${k}=?`).join(',');
    if (!f) return true;
    await db.runAsync(`UPDATE services SET ${f} WHERE id=?`, ...(Object.values(filtered) as SQLite.SQLiteBindValue[]), id);
    return true;
  },
  async deleteService(id: number) { await db.runAsync('UPDATE services SET is_active=0 WHERE id=?', id); return true; },

  // === CLIENTS ===
  async getClients(search = '') {
    if (search) return await db.getAllAsync("SELECT * FROM clients WHERE is_active=1 AND (name LIKE ? OR phone LIKE ?) ORDER BY name", `%${search}%`, `%${search}%`);
    return await db.getAllAsync('SELECT * FROM clients WHERE is_active=1 ORDER BY name');
  },
  async getClient(id: number) { return await db.getFirstAsync('SELECT * FROM clients WHERE id=?', id); },
  async addClient(d: any) {
    const r = await db.runAsync(
      'INSERT INTO clients (name,phone,email,gender,date_of_birth,anniversary,address,notes,allergies,referral_source,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      d.name, d.phone || '', d.email || '', d.gender || '', d.date_of_birth || '', d.anniversary || '', d.address || '', d.notes || '', d.allergies || '', d.referral_source || '', d.created_at || localStamp()
    );
    return r.lastInsertRowId;
  },
  async updateClient(id: number, d: any) {
    const allowed = ['name', 'phone', 'email', 'gender', 'date_of_birth', 'anniversary', 'address', 'notes', 'allergies', 'preferred_stylist_id', 'is_vip', 'is_blacklisted', 'referral_source', 'is_active'];
    const filtered: any = {};
    for (const k of allowed) if (k in d) filtered[k] = d[k];
    const f = Object.keys(filtered).map(k => `${k}=?`).join(',');
    if (!f) return;
    await db.runAsync(`UPDATE clients SET ${f},updated_at=datetime('now','localtime') WHERE id=?`, ...(Object.values(filtered) as SQLite.SQLiteBindValue[]), id);
  },
  /**
   * Add one visit + spend (and loyalty points on `amount`) to a client. Kept
   * for older callers; createBill now does this inside its own transaction.
   */
  async updateClientStats(cid: number, amount: number) {
    await withWriteTxn(async (tx) => {
      const per100 = await this._pointsPer100(tx);
      await tx.runAsync(
        "UPDATE clients SET total_visits=total_visits+1, total_spent=total_spent+?, loyalty_points=loyalty_points+?, last_visit=? WHERE id=?",
        round2(amount), loyaltyPointsFor(amount, per100), localStamp(), cid
      );
      await tx.runAsync(`UPDATE clients SET loyalty_tier=${TIER_SQL} WHERE id=?`, cid);
    });
  },
  /** Spend loyalty points. Throws if the client does not have that many (no silent clamp). */
  async redeemLoyaltyPoints(clientId: number, points: number) {
    const pts = Math.max(0, Math.floor(Number(points) || 0));
    if (!pts) return;
    await withWriteTxn(async (tx) => {
      const c: any = await tx.getFirstAsync('SELECT name, loyalty_points FROM clients WHERE id=?', clientId);
      if (!c) throw new Error('Client not found.');
      if ((c.loyalty_points || 0) < pts) throw new Error(`${c.name} has only ${c.loyalty_points || 0} loyalty points.`);
      await tx.runAsync('UPDATE clients SET loyalty_points=loyalty_points-? WHERE id=?', pts, clientId);
    });
  },
  async _pointsPer100(conn: SQLite.SQLiteDatabase = rawDb): Promise<number> {
    const r: any = await conn.getFirstAsync("SELECT value FROM settings WHERE key='loyalty_points_per_100'");
    const n = parseInt(r?.value ?? '10', 10);
    return Number.isFinite(n) && n >= 0 ? n : 10;
  },
  async _currencySymbol(conn: SQLite.SQLiteDatabase = rawDb): Promise<string> {
    try { const r: any = await conn.getFirstAsync("SELECT value FROM settings WHERE key='currency_symbol'"); return r?.value || curSym(); }
    catch { return curSym(); }
  },

  // === STAFF ===
  async getStaff(activeOnly = true) { return await db.getAllAsync(`SELECT * FROM staff ${activeOnly ? 'WHERE is_active=1' : ''} ORDER BY name`); },
  /** Staff PIN codes must be unique (they identify who checks in). '' = no PIN. */
  async _assertStaffPinFree(pin: any, exceptId = 0) {
    const p = String(pin ?? '').trim();
    if (!p) return;
    const r: any = await db.getFirstAsync('SELECT name FROM staff WHERE pin_code=? AND id<>? AND is_active=1 LIMIT 1', p, exceptId);
    if (r) throw new Error(`PIN ${p} is already used by ${r.name}. Choose a different PIN.`);
  },
  async addStaff(d: any) {
    await this._assertStaffPinFree(d?.pin_code);
    const r = await db.runAsync(
      'INSERT INTO staff (name,phone,role,commission_rate,salary,pin_code,is_active,required_hours,salary_type) VALUES (?,?,?,?,?,?,1,?,?)',
      d.name, d.phone || '', d.role || 'Stylist', d.commission_rate || 10, d.salary || 0, d.pin_code || '',
      d.required_hours || 8, d.salary_type || 'commission'
    );
    return r.lastInsertRowId;
  },
  async updateStaff(id: number, d: any) {
    const allowed = ['name', 'phone', 'role', 'commission_rate', 'salary', 'pin_code', 'is_active', 'required_hours', 'salary_type'];
    const filtered: any = {};
    for (const k of allowed) if (k in d) filtered[k] = d[k];
    if ('pin_code' in filtered) await this._assertStaffPinFree(filtered.pin_code, id);
    else if (Number(filtered.is_active) === 1) {
      // Re-activating someone whose old PIN was given away meanwhile.
      const cur: any = await db.getFirstAsync('SELECT pin_code FROM staff WHERE id=?', id);
      await this._assertStaffPinFree(cur?.pin_code, id);
    }
    const f = Object.keys(filtered).map(k => `${k}=?`).join(',');
    if (!f) return;
    await db.runAsync(`UPDATE staff SET ${f} WHERE id=?`, ...(Object.values(filtered) as SQLite.SQLiteBindValue[]), id);
  },

  // === ATTENDANCE ===
  // Legacy check-in/out kept as thin wrappers. The real logic (24-hour times +
  // owner attendance policy) lives in staffCheckIn / staffCheckOut (v4 block).
  async checkIn(staffId: number, notes = '') {
    return await (this as any).staffCheckIn(staffId, null, 'self');
  },
  async checkOut(staffId: number) {
    return await (this as any).staffCheckOut(staffId, null, 'self');
  },
  async manualAttendance(staffId: number, date: string, checkIn: string, checkOut: string, status: string, by: any = null) {
    // UNIQUE(staff_id,date) is enforced from v4 — delete-then-insert keeps one row.
    const pad = (t: string) => {
      const m = String(t || '').match(/^(\d{1,2}):(\d{2})/);
      return m ? `${m[1].padStart(2, '0')}:${m[2]}` : (t || '');
    };
    const ci = pad(checkIn), co = pad(checkOut);
    let hrs = 0;
    if (ci && co) {
      const a = (parseInt(ci.slice(0, 2)) * 60 + parseInt(ci.slice(3))); const b = (parseInt(co.slice(0, 2)) * 60 + parseInt(co.slice(3)));
      hrs = Math.max(0, (b - a) / 60);
    }
    // One transaction: a failed insert must not leave the day with no record.
    await withWriteTxn(async (tx) => {
      await tx.runAsync('DELETE FROM attendance WHERE staff_id=? AND date=?', staffId, date);
      await tx.runAsync(
        "INSERT INTO attendance (staff_id,date,check_in,check_out,status,hours_worked,source,recorded_by) VALUES (?,?,?,?,?,?,'manual',?)",
        staffId, date, ci, co, status, Number(hrs.toFixed(2)), by?.username || ''
      );
    });
    return true;
  },
  async getTodayAttendance() {
    const today = localDateStr();
    return await db.getAllAsync('SELECT a.*,s.name as staff_name,s.role FROM attendance a JOIN staff s ON a.staff_id=s.id WHERE a.date=?', today);
  },
  async getAttendanceByRange(start: string, end: string) {
    return await db.getAllAsync('SELECT a.*,s.name as staff_name,s.role FROM attendance a JOIN staff s ON a.staff_id=s.id WHERE a.date>=? AND a.date<=? ORDER BY a.date DESC,s.name', start, end);
  },

  // === APPOINTMENTS ===
  /** One appointment with its client and staff names, or null. */
  async getAppointment(id: number) {
    if (!Number.isFinite(Number(id)) || Number(id) <= 0) return null;
    return await db.getFirstAsync(
      `SELECT a.*, c.name AS client_name, c.phone AS client_phone, s.name AS staff_name
         FROM appointments a
         LEFT JOIN clients c ON c.id = a.client_id
         LEFT JOIN staff s ON s.id = a.staff_id
        WHERE a.id = ?`, Number(id)) as any;
  },
  async getAppointments(date: string, staffId?: number) {
    const base = 'SELECT a.*,c.name as client_name,c.phone as client_phone,c.allergies as client_allergies,c.no_show_count as client_no_shows,s.name as staff_name FROM appointments a LEFT JOIN clients c ON a.client_id=c.id LEFT JOIN staff s ON a.staff_id=s.id';
    if (staffId) return await db.getAllAsync(`${base} WHERE a.date=? AND a.staff_id=? ORDER BY a.start_time`, date, staffId);
    return await db.getAllAsync(`${base} WHERE a.date=? ORDER BY a.start_time`, date);
  },

  /** Throws a clear error for an impossible date, bad times, or a time in the past. */
  _checkSlot(date: string, start: string, end: string, allowPast = false) {
    if (!isValidYmd(date)) throw new Error(`"${date}" is not a real date. Use YYYY-MM-DD, e.g. 2026-03-15.`);
    if (!isValidHHMM(start) || !isValidHHMM(end)) throw new Error('Times must look like 09:30 (24-hour HH:MM).');
    if (hhmmToMin(end) <= hhmmToMin(start)) throw new Error('The end time must be after the start time.');
    if (!allowPast && localDateTime(date, start).getTime() < Date.now() - PAST_GRACE_MS) {
      throw new Error(`${date} ${start} has already passed. Pick a time in the future.`);
    }
  },

  /** Inside a transaction: throw "<staff> is already booked at <time>" on overlap. */
  async _assertStaffFree(tx: SQLite.SQLiteDatabase, staffId: number, date: string, start: string, end: string, ignoreId = 0, prefix = '') {
    if (!staffId) return;
    const clash: any = await tx.getFirstAsync(
      `SELECT a.start_time, a.end_time, s.name AS staff_name
         FROM appointments a LEFT JOIN staff s ON s.id=a.staff_id
        WHERE a.staff_id=? AND a.date=? AND a.id<>?
          AND a.status NOT IN ('cancelled','no_show','no-show')
          AND a.start_time < ? AND a.end_time > ?
        ORDER BY a.start_time LIMIT 1`,
      staffId, date, ignoreId || 0, end, start
    );
    if (clash) {
      throw new Error(`${prefix}${clash.staff_name || 'This stylist'} is already booked at ${String(clash.start_time).slice(0, 5)}–${String(clash.end_time).slice(0, 5)}.`);
    }
  },

  /**
   * Book an appointment. Rejects impossible dates (2026-02-31), bad times,
   * times already past (30-minute grace for late entry; pass allow_past for
   * historical/demo data) and stylist clashes — the clash check runs inside the
   * write transaction so two phones-worth of taps cannot double-book.
   * Optional: advance_amount + advance_method ('cash'|'upi'|'card'),
   * address + travel_charge (home service).
   * Clash errors start with "CONFLICT:" (CalendarScreen relies on it).
   */
  async addAppointment(d: any) {
    const date = String(d.date || ''), start = String(d.start_time || ''), end = String(d.end_time || '');
    this._checkSlot(date, start, end, !!d.allow_past);
    const advance = round2(d.advance_amount ?? d.deposit_paid ?? 0);
    if (advance < 0) throw new Error('The advance cannot be negative.');
    const advMethod = advance > 0 ? String(d.advance_method || 'cash').toLowerCase() : '';
    if (advance > 0 && !['cash', 'upi', 'card'].includes(advMethod)) throw new Error('Advance must be paid by cash, UPI or card.');
    const travel = round2(d.travel_charge || 0);
    if (travel < 0) throw new Error('Travel charge cannot be negative.');
    return await withWriteTxn(async (tx) => {
      await this._assertStaffFree(tx, Number(d.staff_id) || 0, date, start, end, 0, 'CONFLICT: ');
      const r = await tx.runAsync(
        `INSERT INTO appointments (client_id,staff_id,service_ids,service_names,date,start_time,end_time,status,notes,total_amount,is_walkin,deposit_paid,advance_amount,advance_method,address,travel_charge,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        d.client_id || 0, d.staff_id || 0, JSON.stringify(d.service_ids || []), d.service_names || '', date, start, end,
        d.status || 'confirmed', d.notes || '', round2(d.total_amount || 0), d.is_walkin ? 1 : 0, advance, advance, advMethod,
        String(d.address || '').slice(0, 300), travel, localStamp()
      );
      return r.lastInsertRowId;
    });
  },

  /**
   * Change an appointment's status. Marking 'no_show' (or 'no-show') adds one
   * to the client's no_show_count; changing it back takes it off again.
   */
  async updateAppointmentStatus(id: number, status: string) {
    await withWriteTxn(async (tx) => {
      const a: any = await tx.getFirstAsync('SELECT status, client_id FROM appointments WHERE id=?', id);
      if (!a) throw new Error('Appointment not found.');
      await tx.runAsync('UPDATE appointments SET status=? WHERE id=?', status, id);
      const was = isNoShow(a.status), now = isNoShow(status);
      if (a.client_id && was !== now) {
        await tx.runAsync('UPDATE clients SET no_show_count=MAX(0, COALESCE(no_show_count,0)+?) WHERE id=?', now ? 1 : -1, a.client_id);
      }
    });
  },
  async markAppointmentConverted(id: number, billId: number) { await db.runAsync('UPDATE appointments SET converted_to_bill=1, bill_id=? WHERE id=?', billId, id); },
  async deleteAppointment(id: number) { await db.runAsync("UPDATE appointments SET status='cancelled' WHERE id=?", id); },

  // === BILLING ===
  /**
   * Indian financial year label for a date — 1 April to 31 March.
   * 12 Feb 2027 -> "26-27",  5 May 2026 -> "26-27".
   */
  _financialYear(d: Date = new Date()): string {
    return financialYear(d);
  },

  /**
   * Allocate the next invoice number. MUST be called inside the bill's
   * transaction with its `tx` handle — the counter is only advanced once the
   * bill row is written, so a failure never burns a number (GST Rule 46(b):
   * one consecutive series, no gaps).
   *
   * Each financial year starts its own series at 1 (or at the setting
   * `bill_start_number`). The old version re-seeded EVERY new year from the
   * legacy flat counter, so 1 April continued last year's numbers.
   */
  async _nextBillNumber(conn: SQLite.SQLiteDatabase = rawDb): Promise<{ billNumber: string; fy: string; next: number }> {
    const fy = this._financialYear();
    const pr: any = await conn.getFirstAsync("SELECT value FROM settings WHERE key='bill_prefix'");
    const prefix = pr?.value || 'SOS';
    const cr: any = await conn.getFirstAsync('SELECT value FROM settings WHERE key=?', `bill_counter_${fy}`);
    let num: number;
    if (cr) num = parseInt(cr.value || '0', 10) || 0;
    else {
      const st: any = await conn.getFirstAsync("SELECT value FROM settings WHERE key='bill_start_number'");
      num = Math.max(0, (parseInt(st?.value || '1', 10) || 1) - 1);
    }
    const fmt = (n: number) => `${prefix}/${fy}/${String(n).padStart(5, '0')}`;
    let next = num + 1;
    // Never collide with a number already on file (restored data, prefix switched back).
    for (let guard = 0; guard < 10000; guard++) {
      const ex = await conn.getFirstAsync('SELECT 1 AS x FROM bills WHERE bill_number=?', fmt(next));
      if (!ex) break;
      next++;
    }
    return { billNumber: fmt(next), fy, next };
  },

  /** Credit notes have their OWN series per financial year: SOS/CN-26-27/00001. */
  async _nextCreditNoteNumber(conn: SQLite.SQLiteDatabase): Promise<{ number: string; fy: string; next: number }> {
    const fy = this._financialYear();
    const pr: any = await conn.getFirstAsync("SELECT value FROM settings WHERE key='bill_prefix'");
    const prefix = pr?.value || 'SOS';
    const cr: any = await conn.getFirstAsync('SELECT value FROM settings WHERE key=?', `cn_counter_${fy}`);
    let num: number;
    if (cr) num = parseInt(cr.value || '0', 10) || 0;
    else {
      // First credit note of the year on this version: continue after any
      // credit note numbers older versions already issued this year.
      const rows: any[] = await conn.getAllAsync(
        "SELECT bill_number FROM bills WHERE payment_status='credit_note' AND bill_number LIKE ?", `%/CN-${fy}/%`
      );
      num = maxSerial(rows.map((r) => r.bill_number));
    }
    const fmt = (n: number) => `${prefix}/CN-${fy}/${String(n).padStart(5, '0')}`;
    let next = num + 1;
    for (let guard = 0; guard < 10000; guard++) {
      const ex = await conn.getFirstAsync('SELECT 1 AS x FROM bills WHERE bill_number=?', fmt(next));
      if (!ex) break;
      next++;
    }
    return { number: fmt(next), fy, next };
  },

  /** Kept for callers that only want to preview the next number. */
  async generateBillNumber(): Promise<string> {
    const { billNumber } = await this._nextBillNumber();
    return billNumber;
  },

  /**
   * Create a bill — ONE transaction for everything: invoice number, the bill
   * row, product stock, loyalty, wallet, packages, appointment advance and
   * conversion, client stats. Any failure rolls all of it back.
   *
   * Payload (all existing fields unchanged):
   *   items[]              { type:'service'|'product', id, name, price, qty,
   *                          package_cm_id?  ← line covered by a client package:
   *                          charged ₹0, one session (or `list_price`×qty of
   *                          value) is taken off the package }
   *   subtotal, tax_amount, discount_amount, discount_type, loyalty_discount, total
   *   payment_method       'cash'|'upi'|'card'|'split'|'due'|'wallet'
   *   payment_split        {cash,upi,card} for split / pay-later
   *   loyalty_points_used  checked against the client's balance INSIDE the txn
   *   wallet_used?         amount paid from the client's prepaid wallet
   *   advance_adjusted?    appointment advance applied to this bill (needs appointment_id)
   *   tax_rate?            GST % for this bill (default: salon profile rate)
   *   prices_include_gst?  1 when item prices already include GST
   *   appointment_id?      refused if that appointment is already billed
   *
   * Stock: every `type:'product'` line is deducted here; "Only N left of X"
   * if short. The result carries `stockHandled: true` — callers must not call
   * deductStock() afterwards.
   */
  async createBill(d: any): Promise<CreateBillResult> {
    const items: any[] = Array.isArray(d.items) ? d.items : [];
    if (!items.length) throw new Error('Add at least one service or product to the bill.');
    const clientId = Number(d.client_id) || 0;
    const appointmentId = Number(d.appointment_id) || 0;
    const queueId = Number(d.queue_id) || 0;
    const isWalkin = d.is_walkin ? 1 : 0;
    const pointsUsed = Math.max(0, Math.floor(Number(d.loyalty_points_used) || 0));
    const walletUsed = round2(d.wallet_used || 0);
    const advanceAdj = round2(d.advance_adjusted || 0);
    if (walletUsed < 0 || advanceAdj < 0) throw new Error('Wallet and advance amounts cannot be negative.');
    if (walletUsed > 0 && !clientId) throw new Error("Pick the client whose wallet pays for this bill.");
    if (pointsUsed > 0 && !clientId) throw new Error("Loyalty points can only be used on a client's bill.");
    if (advanceAdj > 0 && !appointmentId) throw new Error('An advance can only be adjusted on the bill made from its appointment.');
    // 1 point = 1 rupee: the loyalty discount can never be more than the points actually redeemed.
    if (toPaise(d.loyalty_discount || 0) > pointsUsed * 100) {
      throw new Error(`A loyalty discount of ${round2(d.loyalty_discount)} needs ${Math.ceil(Number(d.loyalty_discount) || 0)} points to be redeemed.`);
    }

    const inclusive = d.prices_include_gst ? 1 : 0;
    const subtotal = round2(d.subtotal || 0);
    const discount = round2(d.discount_amount || 0);
    const tax = round2(d.tax_amount || 0);
    const loyaltyDisc = round2(d.loyalty_discount || 0);
    const total = round2(d.total || 0);
    if (subtotal < 0 || discount < 0 || tax < 0 || loyaltyDisc < 0 || total < 0) {
      throw new Error('Bill amounts cannot be negative.');
    }

    // The lines must add up to the subtotal (package-covered lines count as 0).
    let linesP = 0;
    for (const it of items) {
      const qty = Number(it?.qty ?? 1);
      if (!(qty > 0)) throw new Error(`Quantity for ${it?.name || 'an item'} must be more than 0.`);
      if (Number(it?.price) < 0) throw new Error(`Price for ${it?.name || 'an item'} cannot be negative.`);
      if (!it?.package_cm_id) linesP += Math.round(toPaise(it?.price) * qty);
    }
    if (Math.abs(linesP - toPaise(subtotal)) > 100) {
      throw new Error(`The bill subtotal (${subtotal}) does not match its items (${fromPaise(linesP)}). Package-covered lines must be priced 0. Please re-check the bill.`);
    }
    const expected = expectedBillTotal({ subtotal, discount_amount: discount, tax_amount: tax, loyalty_discount: loyaltyDisc, prices_include_gst: inclusive });
    if (Math.abs(toPaise(expected) - toPaise(total)) > 100) {
      throw new Error(`The bill total (${total}) does not match subtotal, discount and GST (expected ${expected}). Please re-check the bill.`);
    }
    const pay = allocatePayment({ method: d.payment_method || 'cash', split: d.payment_split, total, wallet: walletUsed, advance: advanceAdj });
    if (pay.amountDue > 0 && !clientId) throw new Error('Pay-later bills need a client, so the due can be collected later.');
    const createdAt = d.created_at || localStamp();
    const today = String(createdAt).slice(0, 10);

    const res = await withWriteTxn(async (tx) => {
      const sym = await this._currencySymbol(tx);
      const { billNumber: bn, fy, next } = await this._nextBillNumber(tx);

      let rate = Number(d.tax_rate);
      if (!Number.isFinite(rate) || rate < 0) {
        const pr: any = await tx.getFirstAsync('SELECT tax_rate FROM salon_profile LIMIT 1');
        rate = Number(pr?.tax_rate ?? 0) || 0;
      }
      if (tax === 0) rate = 0; // GST not charged on this bill
      if (tax !== 0) {
        // GST is opt-in: a salon that has not turned GST on must never issue a
        // bill carrying GST (unregistered businesses cannot collect it).
        const gstOn: any = await tx.getFirstAsync("SELECT value FROM settings WHERE key='gst_enabled'");
        if (gstOn?.value === 'false') {
          throw new Error('GST is turned off for this salon, so this bill cannot include GST. Turn it on in Settings → GST if you are GST registered.');
        }
      }

      // Client: re-read balances now, inside the lock — never trust the screen's copy.
      let client: any = null;
      if (clientId) {
        client = await tx.getFirstAsync('SELECT id, name, loyalty_points, wallet_balance FROM clients WHERE id=?', clientId);
        if (!client) throw new Error('That client no longer exists. Pick the client again.');
        if (pointsUsed > (client.loyalty_points || 0)) {
          throw new Error(`${client.name} has only ${client.loyalty_points || 0} loyalty points.`);
        }
        if (toPaise(walletUsed) > toPaise(client.wallet_balance || 0)) {
          throw new Error(`${client.name}'s wallet has only ${sym}${round2(client.wallet_balance || 0)}.`);
        }
      }

      // Appointment: billed once only; the advance can be used once.
      let apt: any = null;
      let advToWalletP = 0;
      if (appointmentId) {
        apt = await tx.getFirstAsync('SELECT * FROM appointments WHERE id=?', appointmentId);
        if (!apt) throw new Error('That appointment no longer exists.');
        if (apt.converted_to_bill) throw new Error('This appointment is already billed');
        const left = toPaise(apt.advance_amount || 0) - toPaise(apt.advance_used || 0) - toPaise(apt.advance_refunded || 0);
        if (toPaise(advanceAdj) > left) throw new Error(`Only ${sym}${fromPaise(Math.max(0, left))} advance is left on this appointment.`);
        // The appointment can only be billed once, so any advance this bill does
        // not use would be stranded: a client's goes to their wallet (below);
        // a walk-in's stays listed in getAdvancesToRefund for the owner.
        if (clientId) advToWalletP = Math.max(0, left - toPaise(advanceAdj));
      }

      // Walk-in token: billed once only.
      if (queueId) {
        const q: any = await tx.getFirstAsync('SELECT id, token_no, bill_id FROM walkin_queue WHERE id=?', queueId);
        if (!q) throw new Error('That queue token no longer exists.');
        if (Number(q.bill_id) > 0) {
          const ob: any = await tx.getFirstAsync('SELECT bill_number FROM bills WHERE id=?', q.bill_id);
          throw new Error(`Token ${q.token_no} is already billed${ob?.bill_number ? ` (${ob.bill_number})` : ''}.`);
        }
      }

      const ledger: any = {
        ...(queueId ? { queue: queueId } : {}),
        ...(advToWalletP > 0 ? { advance_to_wallet: fromPaise(advToWalletP) } : {}),
        stock: [] as any[], packages: [] as any[], wallet: walletUsed, advance: advanceAdj,
        // Taxable value as printed on the invoice (loyalty comes off before tax).
        taxable: billTaxableValue({ subtotal, discount_amount: discount, loyalty_discount: loyaltyDisc, tax_amount: tax, prices_include_gst: inclusive }),
      };
      const lowStock: CreateBillResult['lowStock'] = [];
      const stored: any[] = [];
      for (const it of items) {
        const qty = Number(it.qty ?? 1);
        if (it.package_cm_id) {
          if (!clientId) throw new Error('A package can only be used on a client\'s bill.');
          const cm: any = await tx.getFirstAsync(
            `SELECT cm.*, m.name, m.service_id, m.discount_percent FROM client_memberships cm
               JOIN memberships m ON m.id=cm.membership_id WHERE cm.id=?`, Number(it.package_cm_id));
          if (!cm || !cm.is_active) throw new Error(`The package for ${it.name} is no longer active.`);
          if (cm.client_id !== clientId) throw new Error(`That package belongs to another client.`);
          if (cm.end_date < today) throw new Error(`${cm.name} expired on ${cm.end_date}.`);
          if (cm.service_id && Number(it.id) !== Number(cm.service_id)) {
            throw new Error(`${cm.name} can only be used for its own service, not ${it.name}.`);
          }
          let sessions = 0, value = 0;
          if ((cm.sessions_total || 0) > 0) {
            sessions = Math.ceil(qty);
            const left = cm.sessions_total - (cm.sessions_used || 0);
            if (sessions > left) throw new Error(`${cm.name} has only ${left} session${left === 1 ? '' : 's'} left.`);
            await tx.runAsync('UPDATE client_memberships SET sessions_used=sessions_used+? WHERE id=?', sessions, cm.id);
          } else if ((cm.value_total || 0) > 0) {
            let unit = Number(it.list_price);
            if (!(unit > 0) && it.type === 'service' && it.id) {
              const svc: any = await tx.getFirstAsync('SELECT price FROM services WHERE id=?', it.id);
              unit = Number(svc?.price || 0);
            }
            if (!(unit > 0)) unit = Number(it.price || 0);
            value = round2(unit * qty);
            if (toPaise(value) > toPaise(cm.value_remaining || 0)) {
              throw new Error(`Only ${sym}${round2(cm.value_remaining || 0)} is left on ${cm.name}.`);
            }
            await tx.runAsync('UPDATE client_memberships SET value_remaining=value_remaining-? WHERE id=?', value, cm.id);
          } else {
            throw new Error(`${cm.name} is a discount membership — it cannot cover a line. Apply its discount instead.`);
          }
          ledger.packages.push({ cm_id: cm.id, sessions, value });
          stored.push({ ...it, price: 0, list_price: Number(it.list_price) || Number(it.price) || 0, package_cm_id: cm.id, note: `Covered by package: ${cm.name}` });
          continue;
        }
        if (it.type === 'product' && it.id) {
          const p: any = await tx.getFirstAsync('SELECT id, name, quantity, unit, min_stock FROM inventory WHERE id=?', it.id);
          if (!p) throw new Error(`${it.name || 'A product'} is no longer in inventory. Remove it from the bill.`);
          const have = Number(p.quantity || 0);
          if (qty > have + 1e-9) throw new Error(`Only ${Math.max(0, have)} left of ${p.name}.`);
          await tx.runAsync("UPDATE inventory SET quantity=quantity-?, updated_at=? WHERE id=?", qty, localStamp(), p.id);
          ledger.stock.push({ id: p.id, qty });
          const after = have - qty;
          if (after <= Number(p.min_stock || 0)) lowStock.push({ id: p.id, name: p.name, quantity: after, unit: p.unit || '' });
        }
        stored.push(it);
      }

      const per100 = await this._pointsPer100(tx);
      // Points are earned on money actually received now. A pay-later bill
      // earns the rest when the due is collected (collectDue).
      const pointsEarned = clientId && !isWalkin ? loyaltyPointsFor(pay.paidNow, per100) : 0;
      // Never take a status from the caller: 'cancelled' / 'credit_note' would
      // hide a real sale from every report and make it impossible to void.
      const status = pay.amountDue > 0 ? 'due' : 'paid';

      const ins = await tx.runAsync(
        `INSERT INTO bills (bill_number,client_id,staff_id,appointment_id,items,subtotal,tax_amount,discount_amount,discount_type,
           loyalty_discount,total,payment_method,payment_split,payment_status,notes,loyalty_points_earned,loyalty_points_used,
           is_walkin,amount_due,tax_rate,prices_include_gst,ledger,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        bn, clientId, d.staff_id || 0, appointmentId, JSON.stringify(stored),
        subtotal, tax, discount, d.discount_type || 'flat',
        loyaltyDisc, total, d.payment_method || 'cash', JSON.stringify(pay.storedSplit), status, d.notes || '',
        pointsEarned, pointsUsed, isWalkin, pay.amountDue, rate, inclusive, JSON.stringify(ledger), createdAt
      );
      const billId = ins.lastInsertRowId;

      // Only now is the number actually consumed.
      await tx.runAsync('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)', `bill_counter_${fy}`, String(next));

      let walletBalance: number | undefined;
      if (clientId) {
        await tx.runAsync(
          'UPDATE clients SET total_visits=total_visits+1, total_spent=total_spent+?, last_visit=?, loyalty_points=loyalty_points+?-? WHERE id=?',
          total, createdAt, pointsEarned, pointsUsed, clientId
        );
        await tx.runAsync(`UPDATE clients SET loyalty_tier=${TIER_SQL} WHERE id=?`, clientId);
        if (walletUsed > 0) {
          await tx.runAsync('UPDATE clients SET wallet_balance=ROUND(wallet_balance-?,2) WHERE id=?', walletUsed, clientId);
          await tx.runAsync(
            "INSERT INTO client_wallet_txns (client_id,amount,kind,bill_id,method,note,created_by,created_at) VALUES (?,?,'spend',?,?,?,?,?)",
            clientId, -walletUsed, billId, 'wallet', `Bill ${bn}`, String(d.created_by || ''), createdAt
          );
          const c2: any = await tx.getFirstAsync('SELECT wallet_balance FROM clients WHERE id=?', clientId);
          walletBalance = round2(c2?.wallet_balance || 0);
        }
      }
      if (appointmentId) {
        await tx.runAsync(
          'UPDATE appointments SET converted_to_bill=1, bill_id=?, advance_used=COALESCE(advance_used,0)+? WHERE id=?',
          billId, fromPaise(toPaise(advanceAdj) + advToWalletP), appointmentId
        );
        if (advToWalletP > 0) {
          // Not new money: it was counted (cash / UPI / card) on the day the
          // advance was taken. method 'advance' keeps it out of the day-close
          // tally, and wallet top-ups are never revenue.
          const amt = fromPaise(advToWalletP);
          await tx.runAsync('UPDATE clients SET wallet_balance=ROUND(COALESCE(wallet_balance,0)+?,2) WHERE id=?', amt, clientId);
          await tx.runAsync(
            "INSERT INTO client_wallet_txns (client_id,amount,kind,bill_id,method,note,created_by,created_at) VALUES (?,?,'topup',?,'advance',?,?,?)",
            clientId, amt, billId, `Unused advance from booking #${appointmentId}`, String(d.created_by || ''), createdAt
          );
          const c3: any = await tx.getFirstAsync('SELECT wallet_balance FROM clients WHERE id=?', clientId);
          walletBalance = round2(c3?.wallet_balance || 0);
        }
      }
      if (queueId) {
        await tx.runAsync(
          "UPDATE walkin_queue SET bill_id=?, status='done', done_at=CASE WHEN COALESCE(done_at,'')='' THEN ? ELSE done_at END WHERE id=?",
          billId, localStamp(), queueId
        );
      }
      return { billNumber: bn, billId, pointsEarned, walletBalance, lowStock, stock: ledger.stock as { id: number; qty: number }[], advanceToWallet: fromPaise(advToWalletP) };
    });

    // Absorb a legacy follow-up deductStock() for the same lines (see stockCredits).
    for (const m of res.stock) {
      const c = stockCredits.get(m.id);
      const qty = (c && c.expires > Date.now() ? c.qty : 0) + m.qty;
      stockCredits.set(m.id, { qty, expires: Date.now() + 120000 });
    }
    return {
      billNumber: res.billNumber, billId: res.billId, stockHandled: true, pointsEarned: res.pointsEarned,
      amountDue: pay.amountDue, walletUsed, walletBalance: res.walletBalance, lowStock: res.lowStock,
      advanceToWallet: res.advanceToWallet,
    };
  },

  /**
   * Void a bill by issuing a credit note.
   *
   * A GST invoice must never be deleted or edited once issued — the number has
   * to stay in the series. Instead the original is marked cancelled and a
   * linked credit note (own CN series) reverses it. Everything the bill did is
   * undone from its ledger: exactly the stock it deducted, wallet spend
   * refunded to the wallet, package sessions/value restored, appointment
   * advance released. All state is re-read inside the transaction, so a
   * double tap cannot void twice. Credit notes themselves cannot be voided.
   */
  async voidBill(billId: number, reason: string, userId?: number) {
    const why = String(reason || '').trim() || 'No reason given';
    const out = await withWriteTxn(async (tx) => {
      const bill: any = await tx.getFirstAsync('SELECT * FROM bills WHERE id=?', billId);
      if (!bill) throw new Error('Bill not found.');
      if (bill.payment_status === 'cancelled') throw new Error('This bill is already cancelled.');
      if (bill.payment_status === 'credit_note') throw new Error('A credit note cannot be cancelled — it already reverses its original bill.');
      const ledger: any = parseJson(bill.ledger, {});
      const now = localStamp();

      if (ledger.package_sale) {
        const cm: any = await tx.getFirstAsync('SELECT * FROM client_memberships WHERE id=?', ledger.package_sale);
        if (cm && ((cm.sessions_used || 0) > 0 || toPaise(cm.value_remaining) < toPaise(cm.value_total))) {
          throw new Error('This package has already been used, so its sale cannot be cancelled. Adjust the package instead.');
        }
        if (cm) await tx.runAsync('UPDATE client_memberships SET is_active=0 WHERE id=?', cm.id);
      }

      const cn = await this._nextCreditNoteNumber(tx);
      // Everything the customer actually paid on this bill is given back:
      // what was paid at the counter (payment_split) PLUS any pay-later money
      // collected since (due_payments), by channel, so the day's cash tally
      // shows the real refund.
      const parts = paymentParts(bill);
      const refundP: Record<string, number> = {};
      for (const [k, v] of Object.entries(parts)) refundP[k] = Math.abs(toPaise(v));
      if (bill.payment_method === 'due' || toPaise(bill.total) > 0) {
        const dues: any[] = await tx.getAllAsync('SELECT amount, method FROM due_payments WHERE bill_id=?', billId).catch(() => []) as any[];
        for (const p of dues) {
          const k = ['cash', 'upi', 'card'].includes(String(p.method)) ? String(p.method) : 'cash';
          refundP[k] = (refundP[k] || 0) + Math.abs(toPaise(p.amount));
        }
      }
      const cnSplit: Record<string, number> = {};
      for (const [k, v] of Object.entries(refundP)) if (v !== 0) cnSplit[k] = -fromPaise(v);
      const origLedger = parseJson<any>(bill.ledger, {});
      const cnLedger: any = { voids: billId };
      if (origLedger && origLedger.taxable !== undefined && Number.isFinite(Number(origLedger.taxable))) cnLedger.taxable = -Math.abs(Number(origLedger.taxable));

      await tx.runAsync(
        "UPDATE bills SET payment_status='cancelled', amount_due=0, notes=? WHERE id=?",
        `${bill.notes || ''}\n[Cancelled: ${why}]`.trim(), billId
      );
      const ins = await tx.runAsync(
        `INSERT INTO bills (bill_number,client_id,staff_id,appointment_id,items,subtotal,tax_amount,discount_amount,discount_type,
           loyalty_discount,total,payment_method,payment_split,payment_status,notes,loyalty_points_earned,loyalty_points_used,
           is_walkin,tax_rate,prices_include_gst,ledger,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        cn.number, bill.client_id, bill.staff_id, 0, bill.items,
        -bill.subtotal, -bill.tax_amount, -bill.discount_amount, bill.discount_type,
        -bill.loyalty_discount, -bill.total, bill.payment_method, JSON.stringify(cnSplit), 'credit_note',
        `Credit note against ${bill.bill_number}. Reason: ${why}`,
        -(bill.loyalty_points_earned || 0), 0, bill.is_walkin, bill.tax_rate || 0, bill.prices_include_gst || 0,
        JSON.stringify(cnLedger), now
      );
      await tx.runAsync('UPDATE bills SET voided_by_bill_id=? WHERE id=?', ins.lastInsertRowId, billId);
      await tx.runAsync('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)', `cn_counter_${cn.fy}`, String(cn.next));

      // Stock: put back exactly what this bill took. Bills made before v5.6
      // did not record it (the screen deducted separately), so they restore
      // their product lines as before.
      if (Array.isArray(ledger.stock)) {
        for (const m of ledger.stock) await tx.runAsync('UPDATE inventory SET quantity=quantity+? WHERE id=?', Number(m.qty) || 0, m.id);
      } else {
        for (const it of parseJson<any[]>(bill.items, [])) {
          if (it?.type === 'product' && it.id) await tx.runAsync('UPDATE inventory SET quantity=quantity+? WHERE id=?', Number(it.qty || 1), it.id);
        }
      }
      for (const p of Array.isArray(ledger.packages) ? ledger.packages : []) {
        await tx.runAsync(
          'UPDATE client_memberships SET sessions_used=MAX(0,sessions_used-?), value_remaining=value_remaining+? WHERE id=?',
          Number(p.sessions) || 0, Number(p.value) || 0, p.cm_id
        );
      }
      const wallet = round2(ledger.wallet || 0);
      if (wallet > 0 && bill.client_id) {
        await tx.runAsync('UPDATE clients SET wallet_balance=ROUND(wallet_balance+?,2) WHERE id=?', wallet, bill.client_id);
        await tx.runAsync(
          "INSERT INTO client_wallet_txns (client_id,amount,kind,bill_id,method,note,created_by,created_at) VALUES (?,?,'refund',?,?,?,?,?)",
          bill.client_id, wallet, billId, 'wallet', `Bill ${bill.bill_number} cancelled`, String(userId || ''), now
        );
      }
      const advToWallet = round2(ledger.advance_to_wallet || 0);
      if (advToWallet > 0 && bill.client_id) {
        // Take back the unused advance this bill put in the wallet; it returns to the appointment.
        const cw: any = await tx.getFirstAsync('SELECT name, wallet_balance FROM clients WHERE id=?', bill.client_id);
        if (toPaise(cw?.wallet_balance || 0) < toPaise(advToWallet)) {
          throw new Error(`${cw?.name || 'The client'} has already spent the unused advance (${advToWallet}) this bill moved to the wallet. Top the wallet back up first, then cancel the bill.`);
        }
        await tx.runAsync('UPDATE clients SET wallet_balance=ROUND(wallet_balance-?,2) WHERE id=?', advToWallet, bill.client_id);
        await tx.runAsync(
          "INSERT INTO client_wallet_txns (client_id,amount,kind,bill_id,method,note,created_by,created_at) VALUES (?,?,'adjust',?,'advance',?,?,?)",
          bill.client_id, -advToWallet, billId, `Bill ${bill.bill_number} cancelled: advance back on booking #${bill.appointment_id}`, String(userId || ''), now
        );
      }
      if (bill.appointment_id) {
        // The appointment can be billed again correctly; its advance is free again.
        await tx.runAsync(
          'UPDATE appointments SET converted_to_bill=0, bill_id=0, advance_used=MAX(0,COALESCE(advance_used,0)-?) WHERE id=? AND bill_id=?',
          fromPaise(toPaise(ledger.advance || 0) + toPaise(advToWallet)), bill.appointment_id, billId
        );
      }
      if (ledger.queue) {
        // The token can be billed again correctly.
        await tx.runAsync('UPDATE walkin_queue SET bill_id=0 WHERE id=? AND bill_id=?', Number(ledger.queue) || 0, billId);
      }
      // Reverse the client's running totals so lifetime spend stays honest.
      // Points the client redeemed on this bill are handed back too.
      if (bill.client_id) {
        // A package sale never added a visit, so cancelling it takes none off.
        await tx.runAsync(
          'UPDATE clients SET total_spent=MAX(0,total_spent-?), total_visits=MAX(0,total_visits-?), loyalty_points=MAX(0,loyalty_points-?+?) WHERE id=?',
          bill.total || 0, ledger.package_sale ? 0 : 1, bill.loyalty_points_earned || 0, bill.loyalty_points_used || 0, bill.client_id
        );
        await tx.runAsync(`UPDATE clients SET loyalty_tier=${TIER_SQL} WHERE id=?`, bill.client_id);
      }
      return { creditNoteId: ins.lastInsertRowId, creditNoteNumber: cn.number, original: bill.bill_number };
    });
    try { await (this as any).logAudit({ id: userId || 0 }, 'bill.void', 'bill', billId, `${out.original} -> ${out.creditNoteNumber}`); } catch { /* audit is best effort */ }
    return { creditNoteId: out.creditNoteId, creditNoteNumber: out.creditNoteNumber };
  },

  async getBills(startDate?: string, endDate?: string, clientId?: number) {
    let q = 'SELECT b.*,c.name as client_name,c.phone as client_phone,s.name as staff_name FROM bills b LEFT JOIN clients c ON b.client_id=c.id LEFT JOIN staff s ON b.staff_id=s.id WHERE 1=1';
    const p: any[] = [];
    if (startDate) { q += ' AND b.created_at>=?'; p.push(startDate); }
    if (endDate) { q += ' AND b.created_at<?'; p.push(`${addDaysYmd(endDate.slice(0, 10), 1)} 00:00:00`); }
    if (clientId) { q += ' AND b.client_id=?'; p.push(clientId); }
    q += ' ORDER BY b.created_at DESC';
    const rows: any[] = await db.getAllAsync(q, ...p);
    return rows.map(r => ({
      ...r,
      items: parseJson<any[]>(r.items, []),
      payment_split: parseJson<any>(r.payment_split, {}),
      ledger: parseJson<any>(r.ledger, {}),
    }));
  },
  async getBill(id: number) {
    const r: any = await db.getFirstAsync('SELECT b.*,c.name as client_name,c.phone as client_phone,s.name as staff_name FROM bills b LEFT JOIN clients c ON b.client_id=c.id LEFT JOIN staff s ON b.staff_id=s.id WHERE b.id=?', id);
    if (!r) return null;
    return {
      ...r,
      items: parseJson<any[]>(r.items, []),
      payment_split: parseJson<any>(r.payment_split, {}),
      ledger: parseJson<any>(r.ledger, {}),
    };
  },

  /**
   * One page of bills for lists (newest first), WITHOUT the items JSON — fast
   * on a phone with years of bills (open one with getBill for its items).
   * `from` / `to` are YYYY-MM-DD, inclusive. status: 'paid' | 'due' (balance
   * still to collect) | 'cancelled' | 'credit_note' | 'void' (cancelled or
   * credit note) | undefined (all). `search` matches bill #, client name, phone.
   */
  async getBillsPage(o: { from?: string; to?: string; limit?: number; offset?: number; status?: string; search?: string } = {}):
    Promise<{ rows: any[]; hasMore: boolean }> {
    const limit = Math.max(1, Math.min(500, Math.floor(Number(o?.limit) || 50)));
    const offset = Math.max(0, Math.floor(Number(o?.offset) || 0));
    let q = `SELECT b.id, b.bill_number, b.client_id, b.staff_id, b.appointment_id, b.subtotal, b.tax_amount, b.discount_amount,
                    b.total, b.payment_method, b.payment_status, b.notes, b.is_walkin, b.amount_due, b.created_at,
                    c.name AS client_name, c.phone AS client_phone, s.name AS staff_name
               FROM bills b LEFT JOIN clients c ON b.client_id=c.id LEFT JOIN staff s ON b.staff_id=s.id WHERE 1=1`;
    const p: any[] = [];
    if (o?.from && isValidYmd(o.from.slice(0, 10))) { q += ' AND b.created_at>=?'; p.push(`${o.from.slice(0, 10)} 00:00:00`); }
    if (o?.to && isValidYmd(o.to.slice(0, 10))) { q += ' AND b.created_at<?'; p.push(`${addDaysYmd(o.to.slice(0, 10), 1)} 00:00:00`); }
    const st = String(o?.status || '');
    if (st === 'due') q += " AND b.payment_status='due' AND COALESCE(b.amount_due,0)>0";
    else if (st === 'void') q += " AND b.payment_status IN ('cancelled','credit_note')";
    else if (st) { q += ' AND b.payment_status=?'; p.push(st); }
    const term = String(o?.search || '').trim().slice(0, 60);
    if (term) { q += ' AND (b.bill_number LIKE ? OR c.name LIKE ? OR c.phone LIKE ?)'; p.push(`%${term}%`, `%${term}%`, `%${term}%`); }
    q += ' ORDER BY b.created_at DESC, b.id DESC LIMIT ? OFFSET ?';
    p.push(limit + 1, offset);
    const rows: any[] = await db.getAllAsync(q, ...p) as any[];
    return { rows: rows.slice(0, limit), hasMore: rows.length > limit };
  },

  // === INVENTORY ===
  async getInventory(search = '') {
    if (search) return await db.getAllAsync("SELECT * FROM inventory WHERE is_active=1 AND (name LIKE ? OR brand LIKE ?) ORDER BY category,name", `%${search}%`, `%${search}%`);
    return await db.getAllAsync('SELECT * FROM inventory WHERE is_active=1 ORDER BY category,name');
  },
  async getLowStockItems() { return await db.getAllAsync('SELECT * FROM inventory WHERE is_active=1 AND quantity<=min_stock ORDER BY quantity'); },
  async getRetailProducts() { return await db.getAllAsync('SELECT * FROM inventory WHERE is_active=1 AND sell_price>0 ORDER BY name'); },
  async addInventoryItem(d: any) {
    const r = await db.runAsync('INSERT INTO inventory (name,brand,category,quantity,unit,min_stock,cost_price,sell_price,supplier,expiry_date) VALUES (?,?,?,?,?,?,?,?,?,?)',
      d.name, d.brand || '', d.category || 'General', d.quantity || 0, d.unit || 'pcs', d.min_stock || 5, d.cost_price || 0, d.sell_price || 0, d.supplier || '', d.expiry_date || '');
    return r.lastInsertRowId;
  },
  async updateInventoryItem(id: number, d: any) {
    const allowed = ['name', 'brand', 'category', 'quantity', 'unit', 'min_stock', 'cost_price', 'sell_price', 'supplier', 'expiry_date', 'is_active'];
    const filtered: any = {};
    for (const k of allowed) if (k in d) filtered[k] = d[k];
    const f = Object.keys(filtered).map(k => `${k}=?`).join(',');
    if (!f) return;
    await db.runAsync(`UPDATE inventory SET ${f},updated_at=datetime('now','localtime') WHERE id=?`, ...(Object.values(filtered) as SQLite.SQLiteBindValue[]), id);
  },
  async restockInventory(id: number, qty: number) { await db.runAsync("UPDATE inventory SET quantity=quantity+?,last_restocked=datetime('now','localtime') WHERE id=?", qty, id); },
  /**
   * Take `quantity` off a product. Atomic and never below zero: returns false
   * (and changes nothing) when there is not enough stock. The old version
   * clamped at 0, while voidBill restored the full quantity → phantom stock.
   *
   * NOTE: createBill now deducts product stock itself (result.stockHandled).
   * A follow-up call for the same bill lines within 2 minutes is absorbed so
   * an older billing screen cannot deduct twice.
   */
  async deductStock(productId: number, quantity: number): Promise<boolean> {
    const q = Number(quantity) || 0;
    if (!(q > 0)) return false;
    const credit = stockCredits.get(productId);
    if (credit && credit.expires > Date.now() && credit.qty + 1e-9 >= q) {
      credit.qty -= q;
      if (credit.qty <= 1e-9) stockCredits.delete(productId);
      return true;
    }
    try {
      const r = await db.runAsync(
        "UPDATE inventory SET quantity=quantity-?, updated_at=datetime('now','localtime') WHERE id=? AND quantity>=?",
        q, productId, q
      );
      return (r?.changes || 0) > 0;
    } catch (e) { console.error('Deduct stock error:', e); return false; }
  },
  async getInventoryValue() {
    const r: any = await db.getFirstAsync('SELECT COALESCE(SUM(quantity*cost_price),0) as cost_value, COALESCE(SUM(quantity*sell_price),0) as sell_value FROM inventory WHERE is_active=1');
    return r || { cost_value: 0, sell_value: 0 };
  },

  // === EXPENSES ===
  async getExpenses(startDate?: string, endDate?: string) {
    let q = 'SELECT * FROM expenses WHERE 1=1';
    const p: any[] = [];
    if (startDate) { q += ' AND date>=?'; p.push(startDate); }
    if (endDate) { q += ' AND date<=?'; p.push(endDate); }
    q += ' ORDER BY date DESC, created_at DESC';
    return await db.getAllAsync(q, ...p);
  },
  async addExpense(d: any) {
    await db.runAsync('INSERT INTO expenses (category,amount,description,date,payment_method,vendor) VALUES (?,?,?,?,?,?)',
      d.category, d.amount, d.description || '', d.date, d.payment_method || 'cash', d.vendor || '');
    return true;
  },
  async deleteExpense(id: number) { await db.runAsync('DELETE FROM expenses WHERE id=?', id); },
  async getTotalExpenses(startDate: string, endDate: string) {
    const r: any = await db.getFirstAsync('SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE date>=? AND date<=?', startDate, endDate);
    return r?.total || 0;
  },

  // === REMINDERS ===
  async addReminder(data: { client_id: number; client_name: string; client_phone: string; service_name: string; remind_date: string; message: string }) {
    try {
      await db.runAsync('INSERT INTO reminders (client_id,client_name,client_phone,service_name,remind_date,message) VALUES (?,?,?,?,?,?)',
        data.client_id, data.client_name, data.client_phone, data.service_name, data.remind_date, data.message);
      return true;
    } catch (e) { console.error('Add reminder error:', e); return false; }
  },
  async getDueReminders() {
    try {
      const today = localDateStr();
      return await db.getAllAsync('SELECT * FROM reminders WHERE remind_date<=? AND is_sent=0 ORDER BY remind_date', today);
    } catch { return []; }
  },
  async markReminderSent(id: number) { try { await db.runAsync('UPDATE reminders SET is_sent=1 WHERE id=?', id); } catch { } },

  // === REPORTS & ANALYTICS ===
  // All bill reports filter `created_at >= 'D 00:00:00' AND created_at < 'D+1 00:00:00'`
  // (stampRange) so the created_at index is used; `date(created_at)=?` scanned
  // every bill ever written on each dashboard refresh.
  async getDashboardStats(date: string) {
    const [a, z] = stampRange(date);
    const rev: any = await db.getFirstAsync(
      `SELECT COALESCE(SUM(total),0) AS total, COALESCE(SUM(tax_amount),0) AS gst, COUNT(*) AS count,
              COALESCE(SUM(CASE WHEN is_walkin=1 THEN 1 ELSE 0 END),0) AS walkins
         FROM bills WHERE created_at>=? AND created_at<? AND ${VALID}`, a, z);
    const apt: any = await db.getFirstAsync("SELECT COUNT(*) as total, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed FROM appointments WHERE date=?", date);
    const exp: any = await db.getFirstAsync("SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE date=?", date);
    return {
      /** Billed today INCLUDING GST (what customers paid). */
      revenue: rev?.total || 0,
      /** Billed today excluding GST. */
      netRevenue: round2((rev?.total || 0) - (rev?.gst || 0)),
      gstCollected: round2(rev?.gst || 0),
      billCount: rev?.count || 0, walkInCount: rev?.walkins || 0,
      appointmentCount: apt?.total || 0, completedAppointments: apt?.completed || 0, expenses: exp?.total || 0,
    };
  },
  /** Per day: `revenue` is NET of GST (matches P&L); `gross` includes GST. */
  async getRevenueByDateRange(start: string, end: string) {
    const [a, z] = stampRange(start, end);
    return await db.getAllAsync(
      `SELECT substr(created_at,1,10) as date, ROUND(SUM(${NET}),2) as revenue, ROUND(SUM(total),2) as gross,
              ROUND(SUM(tax_amount),2) as gst, COUNT(*) as bills
         FROM bills WHERE created_at>=? AND created_at<? AND ${VALID}
        GROUP BY substr(created_at,1,10) ORDER BY date`, a, z);
  },
  /** Revenue and commission are on the bill amount EXCLUDING GST — GST is not the salon's income. */
  async getStaffPerformance(start: string, end: string) {
    const [a, z] = stampRange(start, end);
    return await db.getAllAsync(`
      SELECT s.id,s.name,s.role,s.commission_rate,
        COUNT(b.id) as total_bills,
        COALESCE(SUM(${NET_B}),0) as total_revenue,
        COALESCE(SUM(b.tax_amount),0) as gst_collected,
        COALESCE(SUM(${NET_B})*s.commission_rate/100,0) as commission_earned
      FROM staff s
      LEFT JOIN bills b ON s.id=b.staff_id AND b.created_at>=? AND b.created_at<? AND ${VALID_B}
      WHERE s.is_active=1 GROUP BY s.id ORDER BY total_revenue DESC`, a, z);
  },
  async getTopServices(start: string, end: string, limit = 10) {
    const [a, z] = stampRange(start, end);
    const bills = await db.getAllAsync<{ items: string }>(
      `SELECT items FROM bills WHERE created_at>=? AND created_at<? AND ${VALID}`, a, z
    );
    const serviceMap: Record<string, { name: string; count: number; revenue: number }> = {};
    for (const bill of bills) {
      let items: any[] = [];
      try { items = JSON.parse(bill.items || '[]'); } catch { continue; }
      for (const item of items) {
        if (item.type === 'service' && item.name) {
          if (!serviceMap[item.name]) serviceMap[item.name] = { name: item.name, count: 0, revenue: 0 };
          serviceMap[item.name].count += item.qty || 1;
          serviceMap[item.name].revenue += (item.price || 0) * (item.qty || 1);
        }
      }
    }
    return Object.values(serviceMap).sort((a, b) => b.revenue - a.revenue).slice(0, limit);
  },
  async getPaymentBreakdown(start: string, end: string) {
    const [a, z] = stampRange(start, end);
    return await db.getAllAsync(
      `SELECT payment_method, COUNT(*) as count, SUM(total) as total FROM bills WHERE created_at>=? AND created_at<? AND ${VALID} GROUP BY payment_method`,
      a, z
    );
  },
  /**
   * Profit & loss. `revenue` is NET of GST (GST collected is a liability to
   * the government, reported separately as `gstCollected`). Wallet top-ups and
   * package money not yet spent are liabilities too and are not in here.
   */
  async getPLSummary(start: string, end: string) {
    const [a, z] = stampRange(start, end);
    const rev: any = await db.getFirstAsync(
      `SELECT COALESCE(SUM(${NET}),0) as net, COALESCE(SUM(tax_amount),0) as gst, COALESCE(SUM(total),0) as gross
         FROM bills WHERE created_at>=? AND created_at<? AND ${VALID}`, a, z);
    const exp: any = await db.getFirstAsync("SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE date>=? AND date<=?", start, end);
    const revenue = round2(rev?.net || 0);
    const expenses = round2(exp?.total || 0);
    return { revenue, expenses, profit: round2(revenue - expenses), gstCollected: round2(rev?.gst || 0), grossBilled: round2(rev?.gross || 0) };
  },
  /**
   * End-of-day report. Existing fields unchanged (note `netCash` is billed
   * revenue − ALL expenses, kept for older screens). The true drawer figures:
   *   cashFromBills      cash bills + cash part of split / pay-later bills
   *   cashRefunds        cash given back on credit notes today
   *   cashDuesCollected  pay-later money collected in cash today
   *   cashWalletTopups   wallet top-ups paid in cash today
   *   cashAdvances       appointment advances taken in cash today
   *   cashExpenses       expenses paid in cash today
   *   netCashOnly        all of the above in − out (no opening float)
   *   expectedDrawer     opening float + netCashOnly
   */
  async getEndOfDayReport(date: string) {
    const stats = await this.getDashboardStats(date);
    const breakdown = await this.getPaymentBreakdown(date, date);
    const expenses = await this.getExpenses(date, date);
    const expTotal = (expenses as any[]).reduce((s: number, e: any) => s + (Number(e.amount) || 0), 0);
    const t: CashTally = await (this as any).getCashTally(date);
    const netCashOnly = round2(t.expected_cash - t.opening_cash);
    return {
      date, ...stats, paymentBreakdown: breakdown, expenses, expenseTotal: round2(expTotal),
      netCash: round2((stats.revenue || 0) - expTotal),
      cashFromBills: t.cash_sales,
      cashRefunds: t.cash_refunds,
      cashDuesCollected: t.cash_dues,
      cashWalletTopups: t.wallet_topups_cash,
      cashAdvances: t.advances_cash,
      cashExpenses: t.cash_expenses,
      netCashOnly,
      openingCash: t.opening_cash,
      expectedDrawer: t.expected_cash,
      upiReceived: t.received.upi,
      cardReceived: t.received.card,
    };
  },
  async getUpcomingBirthdays(days = 7) {
    const results: any[] = [];
    const today = new Date();
    for (let i = 0; i <= days; i++) {
      const d = new Date(today); d.setDate(today.getDate() + i);
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const rows = await db.getAllAsync(
        "SELECT * FROM clients WHERE is_active=1 AND date_of_birth!='' AND strftime('%m-%d',date_of_birth)=?", `${mm}-${dd}`
      );
      results.push(...rows);
    }
    return results;
  },
  async getUpcomingAnniversaries(days = 7) {
    const results: any[] = [];
    const today = new Date();
    for (let i = 0; i <= days; i++) {
      const d = new Date(today); d.setDate(today.getDate() + i);
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const rows = await db.getAllAsync(
        "SELECT * FROM clients WHERE is_active=1 AND anniversary!='' AND strftime('%m-%d',anniversary)=?", `${mm}-${dd}`
      );
      results.push(...rows);
    }
    return results;
  },

  // === MEMBERSHIPS ===
  async getMemberships() { return await db.getAllAsync('SELECT * FROM memberships WHERE is_active=1 ORDER BY name'); },

  // ── Packages (memberships) ────────────────────────────────────────────────
  // The schema and these helpers existed but nothing in the app ever called
  // them — there was no screen. Prepaid packages are how Indian salons take
  // cash up front, so this is now wired to PackagesScreen.

  /** Every package a client holds, with what is left on it. */
  async getClientPackages(clientId: number) {
    return await db.getAllAsync(
      `SELECT cm.*, m.name, m.discount_percent, m.price
         FROM client_memberships cm
         JOIN memberships m ON m.id = cm.membership_id
        WHERE cm.client_id = ? AND cm.is_active = 1
        ORDER BY cm.end_date DESC`,
      clientId
    );
  },

  /** Packages a client can still spend today. Drives the billing screen. */
  async getUsablePackages(clientId: number) {
    const today = localDateStr();
    return await db.getAllAsync(
      `SELECT cm.*, m.name, m.discount_percent
         FROM client_memberships cm
         JOIN memberships m ON m.id = cm.membership_id
        WHERE cm.client_id = ?
          AND cm.is_active = 1
          AND cm.end_date >= ?
          AND (cm.sessions_total = 0 OR cm.sessions_used < cm.sessions_total)
          AND (cm.value_total = 0 OR cm.value_remaining > 0)`,
      clientId, today
    );
  },

  /**
   * Spend sessions and/or rupee value off a package (outside a bill). Refuses
   * to go past what is left. Prefer billing with items[].package_cm_id, which
   * does this inside the bill and is reversed by voidBill.
   */
  async redeemPackage(clientMembershipId: number, sessions = 1, value = 0) {
    await withWriteTxn(async (tx) => {
      const cm: any = await tx.getFirstAsync(
        'SELECT cm.*, m.name FROM client_memberships cm JOIN memberships m ON m.id=cm.membership_id WHERE cm.id=?', clientMembershipId);
      if (!cm || !cm.is_active) throw new Error('That package is not active.');
      if (cm.end_date < localDateStr()) throw new Error(`${cm.name} expired on ${cm.end_date}.`);
      if (sessions > 0 && cm.sessions_total > 0 && cm.sessions_used + sessions > cm.sessions_total) {
        throw new Error(`${cm.name} has only ${cm.sessions_total - cm.sessions_used} sessions left.`);
      }
      if (value > 0 && toPaise(value) > toPaise(cm.value_remaining)) {
        throw new Error(`Only ${round2(cm.value_remaining)} is left on ${cm.name}.`);
      }
      await tx.runAsync(
        'UPDATE client_memberships SET sessions_used=sessions_used+?, value_remaining=value_remaining-? WHERE id=?',
        Math.max(0, sessions), Math.max(0, round2(value)), clientMembershipId
      );
    });
  },

  /**
   * A client's live packages (active, not expired, something left) with what
   * remains — for the billing screen's "use package" picker.
   *   kind: 'sessions' | 'value' | 'discount'
   */
  async getClientActivePackages(clientId: number): Promise<{
    id: number; membership_id: number; name: string; kind: 'sessions' | 'value' | 'discount';
    service_id: number; service_name: string; remaining_sessions: number; sessions_total: number;
    remaining_value: number; value_total: number; discount_percent: number;
    start_date: string; end_date: string; days_left: number;
  }[]> {
    const today = localDateStr();
    const rows: any[] = await db.getAllAsync(
      `SELECT cm.*, m.name, m.discount_percent, m.service_id, s.name AS service_name
         FROM client_memberships cm
         JOIN memberships m ON m.id = cm.membership_id
         LEFT JOIN services s ON s.id = m.service_id
        WHERE cm.client_id = ? AND cm.is_active = 1 AND cm.end_date >= ?
        ORDER BY cm.end_date`, clientId, today) as any[];
    const dayMs = 86400000;
    const t0 = new Date(`${today}T00:00:00`).getTime();
    return rows.map((r) => {
      const kind: 'sessions' | 'value' | 'discount' = r.sessions_total > 0 ? 'sessions' : r.value_total > 0 ? 'value' : 'discount';
      return {
        id: r.id, membership_id: r.membership_id, name: r.name, kind,
        service_id: r.service_id || 0, service_name: r.service_name || '',
        remaining_sessions: Math.max(0, (r.sessions_total || 0) - (r.sessions_used || 0)),
        sessions_total: r.sessions_total || 0,
        remaining_value: round2(r.value_remaining || 0), value_total: round2(r.value_total || 0),
        discount_percent: r.discount_percent || 0,
        start_date: r.start_date, end_date: r.end_date,
        days_left: Math.max(0, Math.round((new Date(`${r.end_date}T00:00:00`).getTime() - t0) / dayMs)),
      };
    }).filter((p) => p.kind === 'discount' || p.remaining_sessions > 0 || p.remaining_value > 0);
  },

  /** Packages running out of time, so the salon can call the client. */
  async getExpiringPackages(days = 30) {
    const today = localDateStr();
    const limit = localDateStr(new Date(Date.now() + days * 86400000));
    return await db.getAllAsync(
      `SELECT cm.*, m.name, c.name AS client_name, c.phone AS client_phone
         FROM client_memberships cm
         JOIN memberships m ON m.id = cm.membership_id
         JOIN clients c ON c.id = cm.client_id
        WHERE cm.is_active = 1 AND cm.end_date BETWEEN ? AND ?
        ORDER BY cm.end_date`,
      today, limit
    );
  },

  /**
   * Money taken for services not yet delivered.
   *
   * This belongs on the P&L. Package sales look like revenue on the day they
   * land, but they are a liability until the service is actually given — a
   * salon that spends it all in month one has a problem in month four.
   */
  async getPackageLiability(): Promise<{ count: number; amount: number }> {
    const today = localDateStr();
    const r: any = await db.getFirstAsync(
      `SELECT COUNT(*) AS count,
              COALESCE(SUM(
                CASE WHEN cm.value_total > 0 THEN cm.value_remaining
                     WHEN cm.sessions_total > 0
                       THEN (CASE WHEN cm.paid_amount > 0 THEN cm.paid_amount ELSE m.price END)
                            * (cm.sessions_total - cm.sessions_used) / cm.sessions_total
                     ELSE 0 END
              ), 0) AS amount
         FROM client_memberships cm
         JOIN memberships m ON m.id = cm.membership_id
        WHERE cm.is_active = 1 AND cm.end_date >= ?`,
      today
    );
    return { count: r?.count || 0, amount: Math.round(r?.amount || 0) };
  },

  async deactivatePackageTemplate(id: number) {
    await db.runAsync('UPDATE memberships SET is_active=0 WHERE id=?', id);
  },

  /**
   * Create a package template.
   *   sessions-based: max_sessions > 0 (optionally service_id: only that service)
   *   value-based:    value (or value_amount) > 0 — rupees the client can spend
   *   discount:       discount_percent > 0, no sessions / value
   * A template with none of these is treated as value-based worth its price
   * (that is how the packages screen describes it: "₹price of services").
   */
  async addMembership(d: any) {
    const sessions = Math.max(0, Math.floor(Number(d.max_sessions) || 0));
    let value = round2(d.value_amount ?? d.value ?? 0);
    const discount = Math.max(0, Number(d.discount_percent) || 0);
    const price = round2(d.price || 0);
    if (price < 0 || value < 0) throw new Error('Package price and value cannot be negative.');
    if (!sessions && !(value > 0) && !discount) value = price;
    if (sessions && value > 0) throw new Error('A package is either a number of sessions or a rupee value, not both.');
    await db.runAsync(
      'INSERT INTO memberships (name,price,duration_days,max_sessions,discount_percent,service_id,value_amount) VALUES (?,?,?,?,?,?,?)',
      String(d.name || '').trim() || 'Package', price, Math.max(1, Number(d.duration_days) || 365), sessions, discount,
      Number(d.service_id) || 0, value
    );
    return true;
  },

  /**
   * Sell / assign a package to a client — one transaction.
   * With `opts.paidAmount > 0` a sale bill (item type 'package') is created
   * in the normal invoice series, GST-inclusive at the profile rate when GST
   * is on; `opts.method` 'cash'|'upi'|'card'|'wallet' (wallet is debited).
   * Value-based packages credit `value_remaining`. Voiding that bill cancels
   * the package (only while unused).
   */
  async assignMembership(clientId: number, membershipId: number, opts: { paidAmount?: number; method?: string; soldBy?: string } = {}):
    Promise<{ ok: boolean; clientMembershipId?: number; billId?: number; billNumber?: string; message?: string }> {
    const m: any = await db.getFirstAsync('SELECT * FROM memberships WHERE id=?', membershipId);
    if (!m) return { ok: false, message: 'Package not found.' };
    if (!m.is_active) return { ok: false, message: 'This package is no longer sold.' };
    const paid = round2(opts.paidAmount ?? 0);
    if (paid < 0) return { ok: false, message: 'Amount paid cannot be negative.' };
    const method = String(opts.method || 'cash').toLowerCase();
    if (paid > 0 && !['cash', 'upi', 'card', 'wallet'].includes(method)) return { ok: false, message: 'Pay by cash, UPI, card or wallet.' };
    const start = localDateStr();
    const end = localDateStr(new Date(Date.now() + (m.duration_days || 365) * 86400000));
    let value = round2(m.value_amount || 0);
    if (!(m.max_sessions > 0) && !(value > 0) && !(m.discount_percent > 0)) value = round2(m.price || 0);
    try {
      return await withWriteTxn(async (tx) => {
        const client: any = await tx.getFirstAsync('SELECT id, name, wallet_balance FROM clients WHERE id=?', clientId);
        if (!client) throw new Error('Client not found.');
        const ins = await tx.runAsync(
          `INSERT INTO client_memberships (client_id,membership_id,start_date,end_date,sessions_total,value_total,value_remaining,paid_amount,payment_method,created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          clientId, membershipId, start, end, m.max_sessions || 0, value, value, paid, paid > 0 ? method : '', localStamp()
        );
        const cmId = ins.lastInsertRowId;
        if (!(paid > 0)) return { ok: true, clientMembershipId: cmId };

        const { billNumber, fy, next } = await this._nextBillNumber(tx);
        const gstOn: any = await tx.getFirstAsync("SELECT value FROM settings WHERE key='gst_enabled'");
        const pr: any = await tx.getFirstAsync('SELECT tax_rate FROM salon_profile LIMIT 1');
        const rate = gstOn?.value === 'false' ? 0 : Number(pr?.tax_rate || 0);
        // Package price is GST-inclusive: GST is due when an advance for services is received.
        const taxP = rate > 0 ? toPaise(paid) - Math.round((toPaise(paid) * 100) / (100 + rate)) : 0;
        const stamp = localStamp();
        const split: Record<string, number> = method === 'wallet' ? { wallet: paid } : {};
        if (method === 'wallet' && toPaise(paid) > toPaise(client.wallet_balance || 0)) {
          throw new Error(`${client.name}'s wallet has only ${round2(client.wallet_balance || 0)}.`);
        }
        const bill = await tx.runAsync(
          `INSERT INTO bills (bill_number,client_id,items,subtotal,tax_amount,total,payment_method,payment_split,payment_status,notes,
             tax_rate,prices_include_gst,ledger,created_at)
           VALUES (?,?,?,?,?,?,?,?,'paid',?,?,1,?,?)`,
          billNumber, clientId, JSON.stringify([{ type: 'package', id: membershipId, name: m.name, price: paid, qty: 1 }]),
          paid, fromPaise(taxP), paid, method, JSON.stringify(split), `Package sale: ${m.name}`, rate,
          JSON.stringify({ package_sale: cmId, wallet: method === 'wallet' ? paid : 0 }), stamp
        );
        await tx.runAsync('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)', `bill_counter_${fy}`, String(next));
        await tx.runAsync('UPDATE client_memberships SET bill_id=? WHERE id=?', bill.lastInsertRowId, cmId);
        await tx.runAsync('UPDATE clients SET total_spent=total_spent+?, last_visit=? WHERE id=?', paid, stamp, clientId);
        await tx.runAsync(`UPDATE clients SET loyalty_tier=${TIER_SQL} WHERE id=?`, clientId);
        if (method === 'wallet') {
          await tx.runAsync('UPDATE clients SET wallet_balance=ROUND(wallet_balance-?,2) WHERE id=?', paid, clientId);
          await tx.runAsync(
            "INSERT INTO client_wallet_txns (client_id,amount,kind,bill_id,method,note,created_by,created_at) VALUES (?,?,'spend',?,?,?,?,?)",
            clientId, -paid, bill.lastInsertRowId, 'wallet', `Package ${m.name}`, opts.soldBy || '', stamp
          );
        }
        return { ok: true, clientMembershipId: cmId, billId: bill.lastInsertRowId, billNumber };
      });
    } catch (e: any) {
      return { ok: false, message: e?.message || 'Could not sell the package.' };
    }
  },

  // === SETTINGS ===
  async getSetting(key: string): Promise<string> {
    if (SECURE_KEYS.has(key)) return secureGet(key);
    try {
      const r: any = await db.getFirstAsync('SELECT value FROM settings WHERE key=?', key);
      return r?.value || '';
    } catch { return ''; }
  },
  async setSetting(key: string, value: string) {
    if (SECURE_KEYS.has(key)) return secureSet(key, value);
    await db.runAsync('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)', key, value);
  },

  // === EXPORT / IMPORT ===
  /**
   * Whole-database JSON backup. `opts.deviceMigration` (internal) also keeps
   * device-only settings — used only when moving this phone's own plaintext
   * DB into the encrypted one.
   * The file carries `_warnings` (e.g. client photos are NOT included) that
   * the UI can show; see also getBackupWarnings().
   */
  async exportAllData(opts: { deviceMigration?: boolean } = {}) {
    const data: any = {
      app: 'SaloonBossX',
      version: '5.6.0',
      format: BACKUP_FORMAT_VERSION,
      export_date: new Date().toISOString(),
      tables: BACKUP_TABLES,
    };

    let rowTotal = 0;
    for (const t of BACKUP_TABLES) {
      try {
        const rows = await db.getAllAsync(`SELECT * FROM ${quoteIdent(t)}`);
        data[t] = t === 'settings' && !opts.deviceMigration
          ? rows.filter((r: any) => !NON_PORTABLE_SETTINGS.has(String(r.key)))
          : rows;
        rowTotal += (data[t] as any[]).length;
      } catch {
        // Table not present on this schema version. Record the gap rather than
        // writing an empty array that would look like "no data" on restore.
        data[t] = [];
        data._missing = [...(data._missing || []), t];
      }
    }
    data.row_count = rowTotal;
    data._warnings = await (this as any).getBackupWarnings().catch(() => []);

    if (__DEV__) {
      const uncovered = await auditSchemaCoverage(db as any);
      if (uncovered.length) {
        console.warn('[backup] tables missing from BACKUP_TABLES:', uncovered.join(', '));
      }
    }

    return JSON.stringify(data);
  },

  /** Things a backup does NOT contain, as sentences the UI can show. */
  async getBackupWarnings(): Promise<string[]> {
    const out: string[] = [];
    try {
      const r: any = await db.getFirstAsync("SELECT COUNT(*) AS n FROM client_notes WHERE COALESCE(photo_uri,'')<>''");
      const n = r?.n || 0;
      if (n > 0) {
        out.push(`Client photos are not included in backups. ${n} photo${n === 1 ? '' : 's'} stay on this phone only — the notes are backed up, the pictures are not.`);
      }
    } catch { /* table not created yet */ }
    return out;
  },

  /**
   * Restore a backup — all or nothing.
   *
   *  - Validated BEFORE anything is deleted (format, table names, rows).
   *  - Columns are taken from PRAGMA table_info: unknown keys in the file are
   *    dropped (a newer/older file restores; a crafted key cannot inject SQL)
   *    and every identifier is quoted.
   *  - One transaction. Any rejected row, or any table that had rows in the
   *    file but ends up empty, rolls the whole restore back.
   *  - Logins: see ImportOptions.keepLocalUsers (default: keep this phone's).
   */
  async importData(json: string, opts: ImportOptions = {}): Promise<{ success: boolean; message: string; warnings?: string[] }> {
    const keepLocalUsers = opts.keepLocalUsers !== false;
    const device = !!opts._deviceMigration;
    let parsed: any;
    try { parsed = JSON.parse(json); }
    catch { return { success: false, message: 'That file is not valid JSON.' }; }

    if (parsed?.app !== 'SaloonBossX') {
      return { success: false, message: 'That is not a SaloonBossX backup file.' };
    }
    const fmt = Number(parsed.format || 1);
    if (fmt > BACKUP_FORMAT_VERSION) {
      return { success: false, message: 'This backup was made by a newer version of SaloonBossX. Update the app, then restore.' };
    }
    const sourceUv = Number.isFinite(Number(parsed.source_user_version)) && parsed.source_user_version !== undefined
      ? Number(parsed.source_user_version) : null;

    // ── Validate before touching anything ────────────────────────────────
    const plan: { table: string; rows: { cols: string[]; vals: SQLite.SQLiteBindValue[] }[]; inFile: number }[] = [];
    const absent: string[] = [];
    const dropped: Record<string, Set<string>> = {};
    for (const table of BACKUP_TABLES) {
      const rows = parsed[table];
      if (rows === undefined || rows === null) { absent.push(table); continue; }
      if (!Array.isArray(rows)) return { success: false, message: `The backup is damaged: "${table}" is not a list.` };
      let info: any[];
      try { info = await db.getAllAsync(`PRAGMA table_info(${quoteIdent(table)})`) as any[]; }
      catch (e: any) { return { success: false, message: `Could not read the ${table} table on this phone: ${e?.message || e}` }; }
      if (!info.length) {
        if (rows.length) return { success: false, message: `This phone has no ${table} table yet. Open the app once more, then restore.` };
        continue;
      }
      const known = new Set(info.map((c) => String(c.name)));
      const prepared: { cols: string[]; vals: SQLite.SQLiteBindValue[] }[] = [];
      for (const row of rows) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) {
          return { success: false, message: `The backup is damaged: a ${table} row is not a record.` };
        }
        if (table === 'settings' && !device && NON_PORTABLE_SETTINGS.has(String((row as any).key))) continue;
        const cols: string[] = [], vals: SQLite.SQLiteBindValue[] = [];
        for (const [k, v] of Object.entries(row)) {
          if (!known.has(k)) { (dropped[table] ||= new Set()).add(k); continue; }
          cols.push(k);
          vals.push(v === undefined ? null : (typeof v === 'object' && v !== null ? JSON.stringify(v) : v) as SQLite.SQLiteBindValue);
        }
        if (!cols.length) return { success: false, message: `The backup is damaged: a ${table} row has no usable fields.` };
        prepared.push({ cols, vals });
      }
      plan.push({ table, rows: prepared, inFile: prepared.length });
    }

    const warnings: string[] = [];
    for (const [t, cols] of Object.entries(dropped)) {
      warnings.push(`Ignored unknown ${t} field${cols.size > 1 ? 's' : ''}: ${[...cols].slice(0, 5).join(', ')}`);
    }

    let inserted = 0;
    let usersKept = false;
    try {
      await withWriteTxn(async (tx) => {
        const localUsers: any = await tx.getFirstAsync('SELECT COUNT(*) AS n FROM app_users').catch(() => ({ n: 0 }));
        usersKept = keepLocalUsers && (localUsers?.n || 0) > 0;
        for (const { table, rows, inFile } of plan) {
          if (table === 'app_users' && usersKept) continue;
          const qt = quoteIdent(table);
          if (table === 'settings' && !device) {
            // Device-only settings (licence, cloud identity, sync state) stay on this phone.
            const keep = [...NON_PORTABLE_SETTINGS];
            await tx.runAsync(`DELETE FROM settings WHERE key NOT IN (${keep.map(() => '?').join(',')})`, ...keep);
          } else {
            await tx.execAsync(`DELETE FROM ${qt}`);
          }
          for (const r of rows) {
            try {
              await tx.runAsync(
                `INSERT OR REPLACE INTO ${qt} (${r.cols.map(quoteIdent).join(',')}) VALUES (${r.cols.map(() => '?').join(',')})`,
                ...r.vals
              );
              inserted++;
            } catch (e: any) {
              throw new Error(`A ${table} record could not be restored (${e?.message || 'rejected'}).`);
            }
          }
          if (inFile > 0) {
            const c: any = await tx.getFirstAsync(`SELECT COUNT(*) AS n FROM ${qt}`);
            if (!(c?.n > 0)) throw new Error(`The ${table} table came out empty although the backup has ${inFile} rows.`);
          }
        }
        // A table the file does not carry (older backup) is emptied so nothing
        // left over points at bills/clients that no longer exist.
        for (const t of absent) {
          if (!CLEAR_WHEN_ABSENT.has(t)) continue;
          try { await tx.execAsync(`DELETE FROM ${quoteIdent(t)}`); }
          catch (e) { if (!isIgnorableSchemaError(e)) throw e; }
        }
        // Data written by older versions → today's conventions.
        if (sourceUv !== null) {
          if (sourceUv < 7) await convertTimestampsToLocal(tx);
          if (sourceUv < 5) await maskIdentityNumbers(tx);
          if (sourceUv < 4) await seedFyCounterFromLegacy(tx);
        } else if (fmt < 5) {
          await convertTimestampsToLocal(tx);
        }
        await backfillBillTaxRates(tx);
        await recountNoShows(tx);
        if (opts._marker) await tx.runAsync('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)', opts._marker[0], opts._marker[1]);
      });
    } catch (e: any) {
      return { success: false, message: `Restore failed and nothing was changed. ${e?.message || 'Unknown error.'}` };
    }

    if (usersKept && Array.isArray(parsed.app_users) && parsed.app_users.length) {
      warnings.push("This phone's logins were kept; the logins in the backup were not restored.");
    }
    const note = warnings.length ? ` ${warnings.join(' ')}` : '';
    return { success: true, message: `Restored ${inserted} records.${note}`, warnings };
  },

  // === CSV EXPORTS ===
  async exportStaffPerformanceCSV(start: string, end: string): Promise<string> {
    const rows = await this.getStaffPerformance(start, end) as any[];
    return csvDocument(
      ['Name', 'Role', 'Total Bills', 'Total Revenue', 'Commission Rate (%)', 'Commission Earned'],
      rows.map((r: any) => [
        r.name, r.role || '', r.total_bills,
        (r.total_revenue || 0).toFixed(2), r.commission_rate,
        (r.commission_earned || 0).toFixed(2),
      ])
    );
  },
  async exportRevenueCSV(start: string, end: string): Promise<string> {
    const rows = await this.getRevenueByDateRange(start, end) as any[];
    return csvDocument(
      ['Date', 'Revenue', 'Bill Count'],
      rows.map((r: any) => [r.date, (r.revenue || 0).toFixed(2), r.bills])
    );
  },
  async exportExpensesCSV(start: string, end: string): Promise<string> {
    const rows = await this.getExpenses(start, end) as any[];
    return csvDocument(
      ['Date', 'Category', 'Amount', 'Description', 'Payment Method', 'Vendor'],
      rows.map((r: any) => [
        r.date, r.category, (r.amount || 0).toFixed(2),
        r.description || '', r.payment_method || '', r.vendor || '',
      ])
    );
  },
  async exportFullReportCSV(start: string, end: string, currencySymbol: string): Promise<string> {
    const [pl, staff, svcs, pay, revByDay, expenses] = await Promise.all([
      this.getPLSummary(start, end),
      this.getStaffPerformance(start, end),
      this.getTopServices(start, end),
      this.getPaymentBreakdown(start, end),
      this.getRevenueByDateRange(start, end),
      this.getExpenses(start, end),
    ]);
    let csv = `SaloonBossX Report,${start} to ${end}\n\n`;
    csv += `SUMMARY\nRevenue (excl. GST),${currencySymbol}${(pl.revenue).toFixed(2)}\nGST collected,${currencySymbol}${(pl.gstCollected || 0).toFixed(2)}\nExpenses,${currencySymbol}${(pl.expenses).toFixed(2)}\nProfit,${currencySymbol}${(pl.profit).toFixed(2)}\n\n`;
    csv += `DAILY REVENUE\nDate,Revenue,Bills\n`;
    csv += (revByDay as any[]).map(r => `${r.date},${(r.revenue || 0).toFixed(2)},${r.bills}`).join('\n') + '\n\n';
    csv += `STAFF PERFORMANCE\nName,Role,Bills,Revenue,Commission %,Commission Earned\n`;
    csv += (staff as any[]).map(s => `"${s.name}","${s.role}",${s.total_bills},${(s.total_revenue || 0).toFixed(2)},${s.commission_rate},${(s.commission_earned || 0).toFixed(2)}`).join('\n') + '\n\n';
    csv += `TOP SERVICES\nService,Count,Revenue\n`;
    csv += (svcs as any[]).map(s => `"${s.name}",${s.count},${(s.revenue || 0).toFixed(2)}`).join('\n') + '\n\n';
    csv += `PAYMENT METHODS\nMethod,Count,Total\n`;
    csv += (pay as any[]).map(p => `${p.payment_method},${p.count},${(p.total || 0).toFixed(2)}`).join('\n') + '\n\n';
    csv += `EXPENSES\nDate,Category,Amount,Description\n`;
    csv += (expenses as any[]).map((e: any) => `${e.date},"${e.category}",${(e.amount || 0).toFixed(2)},"${e.description || ''}"`).join('\n');
    return csv;
  },

  async getMonthlyComparison() {
    const results: { month: string; revenue: number; expenses: number }[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const start = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      const end = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${lastDay}`;
      const pl = await this.getPLSummary(start, end);
      results.push({ month: d.toLocaleDateString(appLocale(), { month: 'short', year: '2-digit' }), revenue: pl.revenue, expenses: pl.expenses });
    }
    return results;
  },
};

// === NEW FEATURES v2.3.0 ===

// Lapsed clients - not visited since given date
const DatabaseServiceExtended = {
  async getLapsedClients(daysSince: number) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysSince);
    const cutoffStr = localDateStr(cutoff);
    return await db.getAllAsync(
      `SELECT * FROM clients WHERE is_active=1 AND (last_visit='' OR last_visit IS NULL OR date(last_visit)<?) ORDER BY last_visit ASC`,
      cutoffStr
    );
  },

  // Highest-spending clients who have gone quiet — used by Business Insights
  // for a prioritised win-back list (biggest revenue risk first, not just oldest).
  async getTopAtRiskClients(daysSince: number, limit = 5) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysSince);
    const cutoffStr = localDateStr(cutoff);
    return await db.getAllAsync(
      `SELECT * FROM clients WHERE is_active=1 AND is_blacklisted=0 AND total_spent>0
       AND (last_visit='' OR last_visit IS NULL OR date(last_visit)<?)
       ORDER BY total_spent DESC LIMIT ?`,
      cutoffStr, limit
    );
  },

  // Items already below reorder point, or trending low (below 1.5x the
  // reorder point and not restocked in a while) — used by Business Insights.
  async getRestockCandidates(staleDays = 20) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - staleDays);
    const cutoffStr = localDateStr(cutoff);
    return await db.getAllAsync(
      `SELECT * FROM inventory WHERE is_active=1
       AND (quantity<=min_stock OR (quantity<=min_stock*1.5 AND (last_restocked='' OR last_restocked IS NULL OR date(last_restocked)<?)))
       ORDER BY quantity ASC`,
      cutoffStr
    );
  },

  // Marketing Studio history — reuses the existing `campaigns` table so every
  // poster generated in-app is logged for the "Recent posts" list.
  async logMarketingPost(d: { template: string; title: string; message: string }) {
    await db.runAsync(
      `INSERT INTO campaigns (name, type, message, target_segment, status) VALUES (?,?,?,?,?)`,
      d.title, d.template, d.message, 'social', 'created'
    );
  },
  async getMarketingHistory(limit = 20) {
    return await db.getAllAsync('SELECT * FROM campaigns ORDER BY created_at DESC LIMIT ?', limit);
  },

  // Revenue target
  async getRevenueTarget(): Promise<number> {
    try {
      const r: any = await db.getFirstAsync("SELECT value FROM settings WHERE key='revenue_target'");
      return parseFloat(r?.value || '0') || 0;
    } catch { return 0; }
  },
  async setRevenueTarget(amount: number) {
    await db.runAsync("INSERT OR REPLACE INTO settings (key,value) VALUES ('revenue_target',?)", String(amount));
  },

  // Cash register
  async openCashRegister(amount: number) {
    const today = localDateStr();
    await db.runAsync('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)', `cash_opening_${today}`, String(round2(amount)));
  },
  /**
   * Dashboard drawer summary (shape unchanged). Only CASH belongs in the
   * drawer: `sales` = cash from bills (incl. cash part of split / pay-later)
   * − cash refunds + cash dues collected + cash wallet top-ups + cash advances.
   * Same maths as getCashTally / day close.
   */
  async getCashRegister(date: string): Promise<{ opening: number; sales: number; expenses: number; closing: number }> {
    const t: CashTally = await (this as any).getCashTally(date);
    const sales = round2(t.cash_sales - t.cash_refunds + t.cash_dues + t.wallet_topups_cash + t.advances_cash);
    return { opening: t.opening_cash, sales, expenses: t.cash_expenses, closing: t.expected_cash };
  },

  // Staff pay slip
  async getStaffPaySlip(staffId: number, year: number, month: number) {
    const pad = (n: number) => String(n).padStart(2, '0');
    const start = `${year}-${pad(month)}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const end = `${year}-${pad(month)}-${lastDay}`;
    const staff: any = await db.getFirstAsync('SELECT * FROM staff WHERE id=?', staffId);
    const [ra, rz] = stampRange(start, end);
    // Commission on revenue EXCLUDING GST.
    const perf: any = await db.getFirstAsync(
      `SELECT COUNT(b.id) as bills, COALESCE(SUM(${NET_B}),0) as revenue, COALESCE(SUM(${NET_B})*s.commission_rate/100,0) as commission
       FROM staff s LEFT JOIN bills b ON s.id=b.staff_id AND b.created_at>=? AND b.created_at<? AND ${VALID_B}
       WHERE s.id=? GROUP BY s.id`, ra, rz, staffId
    );
    const attRows: any[] = await db.getAllAsync(
      `SELECT status, COUNT(*) as count FROM attendance WHERE staff_id=? AND date>=? AND date<=? GROUP BY status`,
      staffId, start, end
    ) as any[];
    const attSummary: Record<string, number> = {};
    attRows.forEach((r: any) => { attSummary[r.status] = r.count; });
    return {
      staff,
      period: { year, month, start, end, label: new Date(year, month - 1, 1).toLocaleDateString(appLocale(), { month: 'long', year: 'numeric' }) },
      performance: { bills: perf?.bills || 0, revenue: perf?.revenue || 0, commission: perf?.commission || 0 },
      attendance: { present: attSummary['present'] || 0, absent: attSummary['absent'] || 0, half_day: attSummary['half_day'] || 0, leave: attSummary['leave'] || 0 },
      salary: staff?.salary || 0,
      totalPay: (staff?.salary || 0) + (perf?.commission || 0),
    };
  },

  // Reschedule appointment
  /**
   * Move an appointment. Rejects impossible / past dates and times. When
   * `newEnd` is '' or missing the original duration is kept. Throws
   * "<staff> is already booked at <time>." on a clash (checked inside the txn).
   */
  async rescheduleAppointment(id: number, newDate: string, newStart: string, newEnd?: string) {
    await withWriteTxn(async (tx) => {
      const a: any = await tx.getFirstAsync('SELECT * FROM appointments WHERE id=?', id);
      if (!a) throw new Error('Appointment not found.');
      if (a.status === 'cancelled') throw new Error('This appointment was cancelled. Book a new one instead.');
      if (a.converted_to_bill) throw new Error('This appointment is already billed and cannot be moved.');
      let end = String(newEnd || '').trim();
      if (!end) {
        const dur = hhmmToMin(String(a.end_time)) - hhmmToMin(String(a.start_time));
        const startMin = hhmmToMin(newStart);
        if (!(dur > 0)) throw new Error('Could not work out the original length of this appointment. Enter an end time.');
        if (startMin + dur >= 24 * 60) throw new Error('That start time would end after midnight. Pick an earlier time.');
        end = minToHHMM(startMin + dur);
      }
      (DatabaseService as any)._checkSlot(newDate, newStart, end, false);
      await (DatabaseService as any)._assertStaffFree(tx, a.staff_id, newDate, newStart, end, id, '');
      await tx.runAsync("UPDATE appointments SET date=?, start_time=?, end_time=?, status=CASE WHEN status IN ('no_show','no-show') THEN 'confirmed' ELSE status END WHERE id=?",
        newDate, newStart, end, id);
      if (isNoShow(a.status) && a.client_id) {
        await tx.runAsync('UPDATE clients SET no_show_count=MAX(0,COALESCE(no_show_count,0)-1) WHERE id=?', a.client_id);
      }
    });
  },

  // Product expiry alerts
  async getExpiringProducts(withinDays = 30) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + withinDays);
    const cutoffStr = localDateStr(cutoff);
    const today = localDateStr();
    return await db.getAllAsync(
      `SELECT * FROM inventory WHERE is_active=1 AND expiry_date!='' AND expiry_date IS NOT NULL AND expiry_date>=? AND expiry_date<=? ORDER BY expiry_date`,
      today, cutoffStr
    );
  },
};

// Merge into DatabaseService
Object.assign(DatabaseService, DatabaseServiceExtended);

// === v3.0 EXTENDED FEATURES ===

const DatabaseServiceV3 = {

  // ─── INVENTORY: get single item ───────────────────────────────
  async getInventoryItem(id: number) {
    try { return await db.getFirstAsync('SELECT * FROM inventory WHERE id=?', id); }
    catch { return null; }
  },

  // ─── STAFF WORKING HOURS ─────────────────────────────────────
  // required_hours and salary_type added via migration in runMigrationsV3()
  async getStaffWithHours() {
    return await db.getAllAsync(`
      SELECT s.*,
        COALESCE(s.required_hours, 8) as required_hours,
        COALESCE(s.salary_type, 'commission') as salary_type
      FROM staff s WHERE s.is_active=1 ORDER BY s.name
    `);
  },

  async updateStaffWorkingHours(staffId: number, requiredHours: number, salaryType: string) {
    try {
      await db.runAsync(
        'UPDATE staff SET required_hours=?, salary_type=? WHERE id=?',
        requiredHours, salaryType, staffId
      );
      return true;
    } catch { return false; }
  },

  // Kept for backward compatibility — delegates to the v4 policy-aware check-out.
  async checkOutWithStatus(staffId: number, by: any = null): Promise<{ success: boolean; message: string; status: string; hoursWorked: number; review?: boolean }> {
    return await (this as any).staffCheckOut(staffId, by, 'self');
  },

  // Enhanced pay slip with working hours salary calculation
  async getStaffPaySlipV3(staffId: number, year: number, month: number) {
    const pad = (n: number) => String(n).padStart(2, '0');
    const start = `${year}-${pad(month)}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const end = `${year}-${pad(month)}-${lastDay}`;

    const staff: any = await db.getFirstAsync('SELECT * FROM staff WHERE id=?', staffId);
    const [ra, rz] = stampRange(start, end);
    // Commission on revenue EXCLUDING GST.
    const perf: any = await db.getFirstAsync(
      `SELECT COUNT(b.id) as bills, COALESCE(SUM(${NET_B}),0) as revenue,
              COALESCE(SUM(${NET_B})*s.commission_rate/100,0) as commission
       FROM staff s LEFT JOIN bills b ON s.id=b.staff_id AND b.created_at>=? AND b.created_at<? AND ${VALID_B}
       WHERE s.id=? GROUP BY s.id`, ra, rz, staffId
    );

    const attRows: any[] = await db.getAllAsync(
      `SELECT status, COUNT(*) as count FROM attendance WHERE staff_id=? AND date>=? AND date<=? GROUP BY status`,
      staffId, start, end
    ) as any[];
    const attSummary: Record<string, number> = {};
    attRows.forEach((r: any) => { attSummary[r.status] = r.count; });

    const present  = attSummary['present']  || 0;
    const halfDay  = attSummary['half_day'] || 0;
    const absent   = attSummary['absent']   || 0;
    const leave    = attSummary['leave']    || 0;
    const effectiveDays = present + (halfDay * 0.5);
    // Working days in the month — Sundays excluded unless the owner's attendance
    // rules say to count them.
    let countSunday = false;
    try { countSunday = !!(await (this as any).getAttendanceRules()).count_sunday; } catch {}
    let workingDaysInMonth = 0;
    for (let d = 1; d <= lastDay; d++) {
      const dayOfWeek = new Date(year, month - 1, d).getDay();
      if (countSunday || dayOfWeek !== 0) workingDaysInMonth++; // 0 = Sunday
    }

    // Salary calculation based on type
    const salaryType = staff?.salary_type || 'commission';
    const baseSalary = staff?.salary || 0;
    const commission = perf?.commission || 0;
    let calculatedSalary = 0;

    // Fixed part prorated by attendance and CAPPED at the base salary: days
    // worked on a weekly off (e.g. Sunday) are not overtime unless a rule says so.
    if (salaryType === 'fixed') {
      calculatedSalary = proratedFixedSalary(baseSalary, workingDaysInMonth, effectiveDays);
    } else if (salaryType === 'commission') {
      calculatedSalary = commission;
    } else { // hybrid
      calculatedSalary = proratedFixedSalary(baseSalary, workingDaysInMonth, effectiveDays) + commission;
    }

    return {
      staff,
      period: { year, month, start, end, label: new Date(year, month - 1, 1).toLocaleDateString(appLocale(), { month: 'long', year: 'numeric' }) },
      performance: { bills: perf?.bills || 0, revenue: perf?.revenue || 0, commission },
      attendance: { present, absent, half_day: halfDay, leave, effectiveDays, workingDaysInMonth },
      salary: baseSalary,
      salaryType,
      calculatedSalary: Math.round(calculatedSalary),
      totalPay: Math.round(calculatedSalary),
      requiredHours: staff?.required_hours || 8,
    };
  },

  // ─── ACADEMY TABLES ──────────────────────────────────────────
  async createAcademyTables() {
    try {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS academy_courses (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          category TEXT DEFAULT 'Hair',
          duration_days INTEGER DEFAULT 30,
          fee REAL DEFAULT 0,
          description TEXT DEFAULT '',
          seats_per_batch INTEGER DEFAULT 10,
          is_active INTEGER DEFAULT 1,
          created_at TEXT DEFAULT (datetime('now','localtime'))
        );
        CREATE TABLE IF NOT EXISTS academy_batches (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          course_id INTEGER NOT NULL,
          batch_name TEXT NOT NULL,
          start_date TEXT NOT NULL,
          end_date TEXT NOT NULL,
          trainer_id INTEGER DEFAULT 0,
          class_days TEXT DEFAULT 'Mon,Tue,Wed,Thu,Fri,Sat',
          class_time TEXT DEFAULT '10:00',
          status TEXT DEFAULT 'upcoming',
          created_at TEXT DEFAULT (datetime('now','localtime'))
        );
        CREATE TABLE IF NOT EXISTS academy_students (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          phone TEXT DEFAULT '',
          email TEXT DEFAULT '',
          address TEXT DEFAULT '',
          date_of_birth TEXT DEFAULT '',
          gender TEXT DEFAULT '',
          aadhar TEXT DEFAULT '',
          emergency_contact TEXT DEFAULT '',
          photo TEXT DEFAULT '',
          batch_id INTEGER NOT NULL,
          enrollment_date TEXT DEFAULT (date('now','localtime')),
          fee_paid REAL DEFAULT 0,
          fee_total REAL DEFAULT 0,
          fee_status TEXT DEFAULT 'pending',
          status TEXT DEFAULT 'active',
          notes TEXT DEFAULT '',
          created_at TEXT DEFAULT (datetime('now','localtime'))
        );
        CREATE TABLE IF NOT EXISTS academy_attendance (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          student_id INTEGER NOT NULL,
          batch_id INTEGER NOT NULL,
          date TEXT NOT NULL,
          status TEXT DEFAULT 'present',
          notes TEXT DEFAULT '',
          created_at TEXT DEFAULT (datetime('now','localtime')),
          UNIQUE(student_id, batch_id, date)
        );
        CREATE TABLE IF NOT EXISTS academy_fees (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          student_id INTEGER NOT NULL,
          amount REAL NOT NULL,
          payment_method TEXT DEFAULT 'cash',
          date TEXT DEFAULT (date('now','localtime')),
          notes TEXT DEFAULT '',
          receipt_number TEXT DEFAULT '',
          created_at TEXT DEFAULT (datetime('now','localtime'))
        );
        CREATE TABLE IF NOT EXISTS academy_assessments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          student_id INTEGER NOT NULL,
          batch_id INTEGER NOT NULL,
          subject TEXT NOT NULL,
          marks_obtained REAL DEFAULT 0,
          marks_total REAL DEFAULT 100,
          assessment_type TEXT DEFAULT 'practical',
          date TEXT DEFAULT (date('now','localtime')),
          notes TEXT DEFAULT '',
          created_at TEXT DEFAULT (datetime('now','localtime'))
        );
      `);
    } catch (e: any) {
      // Creating these tables only fails when something is badly wrong (disk, key) — do not hide it.
      throw new Error(`Could not create the academy tables: ${e?.message || e}`);
    }
  },

  // Academy Courses
  async getAcademyCourses() {
    try { return await db.getAllAsync('SELECT * FROM academy_courses WHERE is_active=1 ORDER BY name'); }
    catch { return []; }
  },
  async addAcademyCourse(data: any) {
    await db.runAsync(
      'INSERT INTO academy_courses (name,category,duration_days,fee,description,seats_per_batch) VALUES (?,?,?,?,?,?)',
      data.name, data.category||'Hair', data.duration_days||30, data.fee||0, data.description||'', data.seats_per_batch||10
    );
  },
  async updateAcademyCourse(id: number, data: any) {
    // Whitelist: column names are interpolated into SQL, so never take them from the caller.
    const allowed = ['name', 'category', 'duration_days', 'fee', 'description', 'seats_per_batch', 'is_active'];
    const filtered: any = {};
    for (const k of allowed) if (data && k in data) filtered[k] = data[k];
    const fields = Object.keys(filtered).map(k => `${k}=?`).join(',');
    if (!fields) return;
    await db.runAsync(`UPDATE academy_courses SET ${fields} WHERE id=?`, ...Object.values(filtered) as any, id);
  },

  // Academy Batches
  async getAcademyBatches(courseId?: number) {
    try {
      if (courseId) {
        return await db.getAllAsync(
          `SELECT b.*, c.name as course_name, c.fee as course_fee, c.seats_per_batch as capacity,
                  s.name as trainer_name,
                  (SELECT COUNT(*) FROM academy_students WHERE batch_id=b.id AND status='active') as enrolled_count
           FROM academy_batches b
           LEFT JOIN academy_courses c ON b.course_id=c.id
           LEFT JOIN staff s ON b.trainer_id=s.id
           WHERE b.course_id=? ORDER BY b.start_date DESC`, courseId
        );
      }
      return await db.getAllAsync(
        `SELECT b.*, c.name as course_name, c.fee as course_fee, c.seats_per_batch as capacity,
                s.name as trainer_name,
                (SELECT COUNT(*) FROM academy_students WHERE batch_id=b.id AND status='active') as enrolled_count
         FROM academy_batches b
         LEFT JOIN academy_courses c ON b.course_id=c.id
         LEFT JOIN staff s ON b.trainer_id=s.id
         ORDER BY b.start_date DESC`
      );
    } catch { return []; }
  },
  async addAcademyBatch(data: any) {
    await db.runAsync(
      'INSERT INTO academy_batches (course_id,batch_name,start_date,end_date,trainer_id,class_days,class_time,status) VALUES (?,?,?,?,?,?,?,?)',
      data.course_id, data.batch_name, data.start_date, data.end_date,
      data.trainer_id||0, data.class_days||'Mon,Tue,Wed,Thu,Fri,Sat', data.class_time||'10:00', data.status||'upcoming'
    );
  },

  // Academy Students
  async getAcademyStudents(batchId?: number) {
    try {
      if (batchId) {
        return await db.getAllAsync(
          `SELECT s.*, b.batch_name, c.name as course_name
           FROM academy_students s
           LEFT JOIN academy_batches b ON s.batch_id=b.id
           LEFT JOIN academy_courses c ON b.course_id=c.id
           WHERE s.batch_id=? ORDER BY s.name`, batchId
        );
      }
      return await db.getAllAsync(
        `SELECT s.*, b.batch_name, c.name as course_name
         FROM academy_students s
         LEFT JOIN academy_batches b ON s.batch_id=b.id
         LEFT JOIN academy_courses c ON b.course_id=c.id
         WHERE s.status='active' ORDER BY s.name`
      );
    } catch { return []; }
  },
  async addAcademyStudent(data: any) {
    await db.runAsync(
      `INSERT INTO academy_students
       (name,phone,email,address,date_of_birth,gender,aadhar,emergency_contact,photo,batch_id,fee_total,fee_paid,fee_status,notes,enrollment_date)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      data.name, data.phone||'', data.email||'', data.address||'',
      data.date_of_birth||'', data.gender||'', maskIdNumber(data.aadhar||''),
      data.emergency_contact||'', data.photo||'', data.batch_id, data.fee_total||0,
      data.fee_paid||0, data.fee_status||'pending', data.notes||'', localDateStr()
    );
  },
  async updateAcademyStudent(id: number, data: any) {
    const allowed = ['name','phone','email','address','date_of_birth','gender','aadhar',
      'emergency_contact','photo','fee_paid','fee_total','fee_status','status','notes'];
    const filtered: any = {};
    for (const k of allowed) if (k in data) filtered[k] = data[k];
    if (!Object.keys(filtered).length) return;
    const fields = Object.keys(filtered).map(k => `${k}=?`).join(',');
    await db.runAsync(`UPDATE academy_students SET ${fields} WHERE id=?`, ...Object.values(filtered) as any, id);
  },

  // Academy Fees
  async addAcademyFeePayment(data: any) {
    const receiptNum = `RCP-${Date.now().toString().slice(-6)}`;
    await db.runAsync(
      'INSERT INTO academy_fees (student_id,amount,payment_method,date,notes,receipt_number) VALUES (?,?,?,?,?,?)',
      data.student_id, data.amount, data.payment_method||'cash',
      data.date || localDateStr(), data.notes||'', receiptNum
    );
    // Update student fee_paid
    await db.runAsync(
      'UPDATE academy_students SET fee_paid=fee_paid+? WHERE id=?',
      data.amount, data.student_id
    );
    // Update fee status
    await db.runAsync(`
      UPDATE academy_students SET fee_status=
        CASE WHEN fee_paid>=fee_total THEN 'paid'
             WHEN fee_paid>0 THEN 'partial'
             ELSE 'pending' END
      WHERE id=?`, data.student_id
    );
    return receiptNum;
  },

  async getAcademyStudentFees(studentId: number) {
    try {
      return await db.getAllAsync('SELECT * FROM academy_fees WHERE student_id=? ORDER BY date DESC', studentId);
    } catch { return []; }
  },

  // Academy Attendance
  async markAcademyAttendance(studentId: number, batchId: number, date: string, status: string) {
    await db.runAsync(
      'INSERT OR REPLACE INTO academy_attendance (student_id,batch_id,date,status) VALUES (?,?,?,?)',
      studentId, batchId, date, status
    );
  },
  async getAcademyAttendance(batchId: number, date: string) {
    try {
      return await db.getAllAsync(
        `SELECT s.id as student_id, s.name, COALESCE(a.status,'not_marked') as status
         FROM academy_students s
         LEFT JOIN academy_attendance a ON s.id=a.student_id AND a.date=? AND a.batch_id=?
         WHERE s.batch_id=? AND s.status='active' ORDER BY s.name`,
        date, batchId, batchId
      );
    } catch { return []; }
  },

  // Academy Stats
  async getAcademyStats() {
    try {
      // Single-quoted literals: double quotes are identifiers in SQL, and
      // SQLCipher builds compiled without SQLITE_DQS reject them outright, which
      // made every academy stat silently read 0.
      const students: any = await db.getFirstAsync("SELECT COUNT(*) as count FROM academy_students WHERE status='active'");
      const batches: any  = await db.getFirstAsync("SELECT COUNT(*) as count FROM academy_batches WHERE status IN ('upcoming','ongoing')");
      const courses: any  = await db.getFirstAsync('SELECT COUNT(*) as count FROM academy_courses WHERE is_active=1');
      const fees: any     = await db.getFirstAsync("SELECT COALESCE(SUM(amount),0) as total FROM academy_fees WHERE date>=date('now','localtime','start of month')");
      const pending: any  = await db.getFirstAsync("SELECT COALESCE(SUM(fee_total-fee_paid),0) as total FROM academy_students WHERE status='active' AND fee_total>fee_paid");
      return {
        activeStudents: students?.count || 0,
        activeBatches: batches?.count || 0,
        totalCourses: courses?.count || 0,
        monthlyFees: fees?.total || 0,
        pendingFees: pending?.total || 0,
      };
    } catch { return { activeStudents: 0, activeBatches: 0, totalCourses: 0, monthlyFees: 0, pendingFees: 0 }; }
  },

  // ─── GST TAX REPORTS ──────────────────────────────────────────
  async getGSTReport(year: number, month: number) {
    const pad = (n: number) => String(n).padStart(2,'0');
    const start = `${year}-${pad(month)}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const end = `${year}-${pad(month)}-${pad(lastDay)}`;
    const [ra, rz] = stampRange(start, end);

    try {
      // Every invoice and credit note in the period (cancelled originals stay
      // listed with their credit notes so the series is complete for the CA).
      const bills: any[] = await db.getAllAsync(`
        SELECT b.id, b.bill_number, b.created_at, b.payment_status,
               b.subtotal, b.discount_amount, b.tax_amount, b.total, b.tax_rate, b.prices_include_gst,
               b.loyalty_discount, b.ledger, b.payment_method,
               COALESCE(c.name,'Walk-in') as client_name,
               COALESCE(c.phone,'') as client_phone,
               b.items
        FROM bills b
        LEFT JOIN clients c ON b.client_id=c.id
        WHERE b.created_at>=? AND b.created_at<?
        ORDER BY b.created_at DESC
      `, ra, rz) as any[];

      const profile: any = await db.getFirstAsync('SELECT * FROM salon_profile LIMIT 1');
      const taxRate = parseFloat(profile?.tax_rate ?? '5');

      // Summed in paise; CGST + SGST always equal the tax exactly.
      let taxableP = 0, taxP = 0, cgstP = 0, sgstP = 0, revenueP = 0;
      const byRate: Record<string, { rate: number; taxable: number; tax: number; cgst: number; sgst: number }> = {};

      const billDetails = bills.map((b: any) => {
        const br = invoiceTaxBreakup(b);
        taxableP += toPaise(br.taxable); taxP += toPaise(br.tax);
        cgstP += toPaise(br.cgst); sgstP += toPaise(br.sgst);
        revenueP += toPaise(b.total);
        const rate = Number(b.tax_rate || 0);
        const k = String(rate);
        const g = (byRate[k] ||= { rate, taxable: 0, tax: 0, cgst: 0, sgst: 0 });
        g.taxable = addMoney(g.taxable, br.taxable); g.tax = addMoney(g.tax, br.tax);
        g.cgst = addMoney(g.cgst, br.cgst); g.sgst = addMoney(g.sgst, br.sgst);
        return {
          bill_number: b.bill_number,
          date: b.created_at?.slice(0,10),
          client: b.client_name,
          status: b.payment_status,
          tax_rate: rate,
          prices_include_gst: !!b.prices_include_gst,
          taxable_value: br.taxable,
          cgst: br.cgst,
          sgst: br.sgst,
          total_tax: br.tax,
          total: b.total,
          payment: b.payment_method,
        };
      });

      const expensesTotal: any = await db.getFirstAsync(
        'SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE date>=? AND date<=?',
        start, end
      );

      return {
        period: { year, month, start, end, label: new Date(year, month-1, 1).toLocaleDateString(appLocale(), { month: 'long', year: 'numeric' }) },
        salon: profile,
        /** Current profile rate (bills carry their own rate — see bills[].tax_rate and byRate). */
        taxRate,
        summary: {
          totalBills: bills.length,
          totalRevenue: fromPaise(revenueP),
          totalTaxableValue: fromPaise(taxableP),
          totalCGST: fromPaise(cgstP),
          totalSGST: fromPaise(sgstP),
          totalTaxCollected: fromPaise(taxP),
          totalExpenses: expensesTotal?.total || 0,
          b2cTotal: fromPaise(revenueP),
          b2bTotal: 0,
        },
        byRate: Object.values(byRate).sort((x, y) => x.rate - y.rate),
        bills: billDetails,
      };
    } catch (e) { console.error('GST report error:', e); return null; }
  },

  async getGSTYearlySummary(year: number) {
    const results = [];
    for (let m = 1; m <= 12; m++) {
      const report = await (this as any).getGSTReport(year, m);
      if (report) results.push({ month: report.period.label, ...report.summary });
    }
    return results;
  },

  // ─── ENHANCED P&L ─────────────────────────────────────────────
  /**
   * Detailed P&L. `revenue` is NET of GST; `totalTax` is the GST collected
   * (a liability, not income); `grossBilled` is what customers paid.
   */
  async getDetailedPLReport(start: string, end: string) {
    const [ra, rz] = stampRange(start, end);
    try {
      const revenueByPayment: any[] = await db.getAllAsync(
        `SELECT payment_method, COUNT(*) as bills, COALESCE(SUM(total),0) as total, COALESCE(SUM(${NET}),0) as net
         FROM bills WHERE created_at>=? AND created_at<? AND ${VALID} GROUP BY payment_method`,
        ra, rz
      ) as any[];

      const expensesByCategory: any[] = await db.getAllAsync(
        `SELECT category, COUNT(*) as count, COALESCE(SUM(amount),0) as total
         FROM expenses WHERE date>=? AND date<=? GROUP BY category ORDER BY total DESC`,
        start, end
      ) as any[];

      const bills: any[] = await db.getAllAsync(
        `SELECT items FROM bills WHERE created_at>=? AND created_at<? AND ${VALID}`, ra, rz
      ) as any[];

      let serviceRevenue = 0, productRevenue = 0;
      bills.forEach((b: any) => {
        for (const i of parseJson<any[]>(b.items, [])) {
          const amt = (i.price || 0) * (i.qty || 1);
          if (i.type === 'service') serviceRevenue += amt;
          else productRevenue += amt;
        }
      });

      const agg: any = await db.getFirstAsync(
        `SELECT COALESCE(SUM(discount_amount),0) as disc, COALESCE(SUM(tax_amount),0) as tax,
                COALESCE(SUM(total),0) as gross, COALESCE(SUM(${NET}),0) as net, COALESCE(SUM(subtotal),0) as subtotal
           FROM bills WHERE created_at>=? AND created_at<? AND ${VALID}`, ra, rz);
      const totalExpenses: any = await db.getFirstAsync(
        'SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE date>=? AND date<=?',
        start, end
      );

      const revenue = round2(agg?.net || 0);
      const expenses = round2(totalExpenses?.total || 0);
      const grossProfit = round2(revenue - expenses);
      const profitMargin = revenue > 0 ? (grossProfit / revenue * 100) : 0;

      return {
        revenue,
        expenses,
        grossProfit,
        profitMargin,
        serviceRevenue: round2(serviceRevenue),
        productRevenue: round2(productRevenue),
        totalDiscount: round2(agg?.disc || 0),
        totalTax: round2(agg?.tax || 0),
        gstCollected: round2(agg?.tax || 0),
        grossBilled: round2(agg?.gross || 0),
        revenueByPayment,
        expensesByCategory,
      };
    } catch (e) {
      console.error('Detailed P&L error:', e);
      return { revenue: 0, expenses: 0, grossProfit: 0, profitMargin: 0, serviceRevenue: 0, productRevenue: 0, totalDiscount: 0, totalTax: 0, gstCollected: 0, grossBilled: 0, revenueByPayment: [], expensesByCategory: [] };
    }
  },

  // ─── v3 MIGRATIONS (call from initialize) ─────────────────────
  async runMigrationsV3() {
    const migs = [
      `ALTER TABLE staff ADD COLUMN required_hours INTEGER DEFAULT 8`,
      `ALTER TABLE staff ADD COLUMN salary_type TEXT DEFAULT 'commission'`,
      `ALTER TABLE attendance ADD COLUMN hours_worked REAL DEFAULT 0`,
    ];
    for (const sql of migs) {
      try { await db.execAsync(sql); }
      catch (e) { if (!isIgnorableSchemaError(e)) throw e; }
    }
    await (this as any).createAcademyTables();
  },
};

// Merge v3 into DatabaseService
Object.assign(DatabaseService, DatabaseServiceV3);

// (initialize() runs runMigrationsV3 itself, in order — see _doInitialize.)

// ═══════════════════════════════════════════════════════════════════════════
// v4 — MULTI-USER ACCOUNTS · ROLE-BASED ACCESS · ATTENDANCE POLICY · CERTIFICATES
// ═══════════════════════════════════════════════════════════════════════════

// 24-hour "HH:MM" for the current local time. Attendance stored this way so the
// check-in / check-out maths is unambiguous (the old code stored a localised
// "07:30 am" string and then parsed it as 24-hour, breaking every afternoon).
const nowHHMM = (d: Date = new Date()): string =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

// Minutes since midnight, tolerant of legacy "7:30 am" / "07:30 PM" / "07:30".
const hhmmToMinutes = (t: string): number => {
  if (!t) return NaN;
  const m = String(t).trim().toLowerCase().match(/^(\d{1,2}):(\d{2})\s*(am|pm)?/);
  if (!m) return NaN;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  return h * 60 + min;
};

export interface AttendanceRules {
  full_day_hours: number;
  half_day_hours: number;
  short_day_action: 'absent' | 'half_day' | 'flag';
  grace_minutes: number;
  count_sunday: boolean;
  auto_checkout_enabled: boolean;
  auto_checkout_time: string;
}

export const DEFAULT_ATTENDANCE_RULES: AttendanceRules = {
  full_day_hours: 7,
  half_day_hours: 4,
  short_day_action: 'half_day',
  grace_minutes: 15,
  count_sunday: false,
  auto_checkout_enabled: false,
  auto_checkout_time: '22:00',
};

export interface CertificateTemplate {
  layout: 'classic' | 'modern' | 'minimal';
  accent: string;
  title: string;
  body: string;
  signatory1_name: string;
  signatory1_title: string;
  signatory1_image: string;
  signatory2_name: string;
  signatory2_title: string;
  signatory2_image: string;
  seal_image: string;
  show_photo: boolean;
  show_verify_code: boolean;
}

export const DEFAULT_CERTIFICATE_TEMPLATE: CertificateTemplate = {
  layout: 'classic',
  accent: '#A84F18',
  title: 'Certificate of Completion',
  body: 'has successfully completed the professional training course {{course}} conducted from {{dates}}.',
  signatory1_name: '',
  signatory1_title: 'Director',
  signatory1_image: '',
  signatory2_name: '',
  signatory2_title: '',
  signatory2_image: '',
  seal_image: '',
  show_photo: true,
  show_verify_code: true,
};

/** Iterations of every hash written before v5.6. */
const LEGACY_HASH_ITERATIONS = 10000;
/**
 * Iterations for new PIN / recovery hashes. crypto-js runs in plain JS; 20 000
 * is ~2× the old cost (roughly 0.2–0.6 s on a mid-range Android under Hermes).
 * Raise only after timing a low-end phone — every unlock pays this.
 */
const PIN_HASH_ITERATIONS = 20000;

/** Constant-time string compare for hashes. */
const sameHash = (a: string, b: string): boolean => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

const DatabaseServiceV4 = {
  // ── crypto helpers ────────────────────────────────────────────────────────
  _randomSalt(): string {
    const bytes = Crypto.getRandomBytes(16);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  },
  /**
   * PBKDF2 (crypto-js default hasher, SHA-256 in crypto-js 4.2) over a PIN or
   * recovery answer. The iteration count is stored next to every hash
   * (app_users.pin_iter / recovery_iter) so it can be raised: old hashes keep
   * verifying at 10 000 and are upgraded on the next successful login. New
   * hashes use PIN_HASH_ITERATIONS. The real protection for a 4–6 digit PIN is
   * the escalating lockout below; the database itself is SQLCipher-encrypted.
   */
  _hashSecret(secret: string, salt: string, iterations: number = LEGACY_HASH_ITERATIONS): string {
    return PBKDF2(String(secret), salt, { keySize: 256 / 32, iterations: iterations || LEGACY_HASH_ITERATIONS }).toString();
  },
  _normUser(u: string): string {
    return String(u || '').trim().toLowerCase();
  },

  async runMigrationsV4() {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS app_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT DEFAULT '',
        pin_hash TEXT DEFAULT '',
        pin_salt TEXT DEFAULT '',
        role TEXT DEFAULT 'stylist',
        permissions TEXT DEFAULT '',
        staff_id INTEGER DEFAULT 0,
        is_owner INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        must_change_pin INTEGER DEFAULT 0,
        failed_attempts INTEGER DEFAULT 0,
        locked_until TEXT DEFAULT '',
        recovery_question TEXT DEFAULT '',
        recovery_hash TEXT DEFAULT '',
        recovery_salt TEXT DEFAULT '',
        pin_iter INTEGER DEFAULT 10000,
        recovery_iter INTEGER DEFAULT 10000,
        last_login TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now','localtime'))
      );
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER DEFAULT 0,
        username TEXT DEFAULT '',
        action TEXT NOT NULL,
        entity TEXT DEFAULT '',
        entity_id INTEGER DEFAULT 0,
        detail TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now','localtime'))
      );
    `);

    const migs = [
      `ALTER TABLE attendance ADD COLUMN hours_worked REAL DEFAULT 0`,
      `ALTER TABLE attendance ADD COLUMN recorded_by TEXT DEFAULT ''`,
      `ALTER TABLE attendance ADD COLUMN edited_by TEXT DEFAULT ''`,
      `ALTER TABLE attendance ADD COLUMN source TEXT DEFAULT 'manual'`,
      `ALTER TABLE attendance ADD COLUMN needs_review INTEGER DEFAULT 0`,
    ];
    for (const sql of migs) {
      try { await db.execAsync(sql); }
      catch (e) { if (!isIgnorableSchemaError(e)) throw e; }
    }

    // De-duplicate attendance (no UNIQUE constraint historically) then enforce it.
    try {
      await db.execAsync(`
        DELETE FROM attendance WHERE id NOT IN (
          SELECT MAX(id) FROM attendance GROUP BY staff_id, date
        );
      `);
      await db.execAsync(`CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_uniq ON attendance (staff_id, date)`);
    } catch (e) { console.warn('[DB] attendance dedupe/index:', e); }

    // Seed policy + certificate defaults (only if absent).
    try {
      const r: any = await db.getFirstAsync("SELECT value FROM settings WHERE key='attendance_rules'");
      if (!r?.value) {
        await db.runAsync('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)',
          'attendance_rules', JSON.stringify(DEFAULT_ATTENDANCE_RULES));
      }
      const c: any = await db.getFirstAsync("SELECT value FROM settings WHERE key='certificate_template'");
      if (!c?.value) {
        await db.runAsync('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)',
          'certificate_template', JSON.stringify(DEFAULT_CERTIFICATE_TEMPLATE));
      }
      await db.runAsync("INSERT OR IGNORE INTO settings (key,value) VALUES ('auto_lock_minutes','3')");
    } catch {}
  },

  // ── users ─────────────────────────────────────────────────────────────────
  async authListUsers(includeInactive = true): Promise<any[]> {
    const rows: any[] = await db.getAllAsync(
      `SELECT u.*, s.name AS staff_name, s.role AS staff_role
       FROM app_users u LEFT JOIN staff s ON u.staff_id = s.id
       ${includeInactive ? '' : 'WHERE u.is_active = 1'}
       ORDER BY u.is_owner DESC, u.display_name`
    ) as any[];
    return rows;
  },
  async authCountUsers(): Promise<number> {
    const r: any = await db.getFirstAsync('SELECT COUNT(*) AS n FROM app_users');
    return r?.n || 0;
  },
  async authCountActiveOwners(): Promise<number> {
    const r: any = await db.getFirstAsync("SELECT COUNT(*) AS n FROM app_users WHERE is_owner=1 AND is_active=1");
    return r?.n || 0;
  },
  async authGetUser(id: number): Promise<any> {
    return await db.getFirstAsync('SELECT * FROM app_users WHERE id=?', id);
  },
  async authGetUserByUsername(username: string): Promise<any> {
    return await db.getFirstAsync('SELECT * FROM app_users WHERE username=?', (this as any)._normUser(username));
  },

  async authCreateUser(d: {
    username: string; display_name: string; pin: string; role: string;
    permissions?: string; staff_id?: number; is_owner?: boolean;
    must_change_pin?: boolean; recovery_question?: string; recovery_answer?: string;
  }): Promise<{ ok: boolean; id?: number; message?: string }> {
    const username = (this as any)._normUser(d.username);
    if (!/^[a-z0-9._-]{3,20}$/.test(username)) {
      return { ok: false, message: 'Username must be 3–20 chars: letters, numbers, . _ -' };
    }
    if (!/^\d{4,6}$/.test(String(d.pin || ''))) {
      return { ok: false, message: 'PIN must be 4–6 digits.' };
    }
    const existing = await (this as any).authGetUserByUsername(username);
    if (existing) return { ok: false, message: 'That username is already taken.' };

    const salt = (this as any)._randomSalt();
    const pinHash = (this as any)._hashSecret(d.pin, salt, PIN_HASH_ITERATIONS);
    let recQ = '', recHash = '', recSalt = '';
    if (d.recovery_question && d.recovery_answer) {
      recQ = d.recovery_question.trim();
      recSalt = (this as any)._randomSalt();
      recHash = (this as any)._hashSecret(d.recovery_answer.trim().toLowerCase(), recSalt, PIN_HASH_ITERATIONS);
    }
    const res = await db.runAsync(
      `INSERT INTO app_users
        (username, display_name, pin_hash, pin_salt, role, permissions, staff_id, is_owner, is_active, must_change_pin, recovery_question, recovery_hash, recovery_salt, pin_iter, recovery_iter)
       VALUES (?,?,?,?,?,?,?,?,1,?,?,?,?,?,?)`,
      username, d.display_name || username, pinHash, salt, d.role || 'stylist',
      d.permissions || '', d.staff_id || 0, d.is_owner ? 1 : 0,
      d.must_change_pin ? 1 : 0, recQ, recHash, recSalt, PIN_HASH_ITERATIONS, PIN_HASH_ITERATIONS
    );
    return { ok: true, id: res.lastInsertRowId };
  },

  async authUpdateUser(id: number, d: any): Promise<{ ok: boolean; message?: string }> {
    const target: any = await (this as any).authGetUser(id);
    if (!target) return { ok: false, message: 'User not found.' };
    const allowed = ['display_name', 'role', 'permissions', 'staff_id', 'is_active'];
    const filtered: any = {};
    for (const k of allowed) if (k in d) filtered[k] = d[k];
    // Guard: never strip the last active owner.
    if (target.is_owner && (('is_active' in filtered && !filtered.is_active) || filtered.role === 'custom')) {
      const owners = await (this as any).authCountActiveOwners();
      if (owners <= 1) return { ok: false, message: 'This is the only owner account — it cannot be disabled or downgraded.' };
    }
    const f = Object.keys(filtered).map(k => `${k}=?`).join(',');
    if (!f) return { ok: true };
    await db.runAsync(`UPDATE app_users SET ${f} WHERE id=?`, ...(Object.values(filtered) as any[]), id);
    return { ok: true };
  },

  /**
   * Set a user's PIN. `actingUserId` (optional, for callers that know who is
   * signed in): an owner's PIN can then only be changed by an owner — a
   * manager with "Users & access" cannot take over the owner account. Old
   * callers (no actingUserId, e.g. self-service recovery) keep working.
   */
  async authSetPin(id: number, pin: string, mustChange = false, actingUserId?: number): Promise<{ ok: boolean; message?: string }> {
    if (!/^\d{4,6}$/.test(String(pin || ''))) return { ok: false, message: 'PIN must be 4–6 digits.' };
    if (actingUserId !== undefined && actingUserId !== null) {
      const target: any = await db.getFirstAsync('SELECT is_owner FROM app_users WHERE id=?', id);
      if (!target) return { ok: false, message: 'User not found.' };
      if (target.is_owner && Number(actingUserId) !== Number(id)) {
        const actor: any = await db.getFirstAsync('SELECT is_owner, is_active FROM app_users WHERE id=?', actingUserId);
        if (!actor?.is_owner || !actor?.is_active) return { ok: false, message: "Only the owner can change the owner's PIN." };
      }
    }
    const salt = (this as any)._randomSalt();
    const hash = (this as any)._hashSecret(pin, salt, PIN_HASH_ITERATIONS);
    await db.runAsync(
      'UPDATE app_users SET pin_hash=?, pin_salt=?, pin_iter=?, must_change_pin=?, failed_attempts=0, locked_until=\'\' WHERE id=?',
      hash, salt, PIN_HASH_ITERATIONS, mustChange ? 1 : 0, id
    );
    return { ok: true };
  },

  async authSetRecovery(id: number, question: string, answer: string): Promise<{ ok: boolean }> {
    const salt = (this as any)._randomSalt();
    const hash = (this as any)._hashSecret(String(answer).trim().toLowerCase(), salt, PIN_HASH_ITERATIONS);
    await db.runAsync('UPDATE app_users SET recovery_question=?, recovery_hash=?, recovery_salt=?, recovery_iter=? WHERE id=?',
      question.trim(), hash, salt, PIN_HASH_ITERATIONS, id);
    return { ok: true };
  },

  // ── shared wrong-guess counter (login, lock screen, recovery answer) ──────
  /** Lock state for the UI: is this account locked, until when, how many tries left. */
  async authLockStatus(userId: number): Promise<{ locked: boolean; until: string; attemptsLeft: number }> {
    const u: any = await db.getFirstAsync('SELECT failed_attempts, locked_until FROM app_users WHERE id=?', userId);
    if (!u) return { locked: false, until: '', attemptsLeft: 0 };
    return lockState(u.failed_attempts || 0, u.locked_until || '');
  },

  /** Count one wrong guess; locks for 5, 10, 20 … minutes (max 24 h) from the 5th. */
  async _authRegisterFailure(userId: number): Promise<{ locked: boolean; until: string; attemptsLeft: number }> {
    return await withWriteTxn(async (tx) => {
      const u: any = await tx.getFirstAsync('SELECT failed_attempts FROM app_users WHERE id=?', userId);
      const fails = (u?.failed_attempts || 0) + 1;
      const mins = lockoutMinutes(fails);
      const until = mins > 0 ? new Date(Date.now() + mins * 60000).toISOString() : '';
      await tx.runAsync('UPDATE app_users SET failed_attempts=?, locked_until=? WHERE id=?', fails, until, userId);
      return lockState(fails, until);
    });
  },

  async _authClearFailures(userId: number) {
    await db.runAsync("UPDATE app_users SET failed_attempts=0, locked_until='' WHERE id=?", userId);
  },

  /** Re-hash a correct PIN with the current iteration count (silent upgrade). */
  async _authUpgradePinHash(u: any, pin: string) {
    if ((u.pin_iter || LEGACY_HASH_ITERATIONS) >= PIN_HASH_ITERATIONS) return;
    try {
      const salt = (this as any)._randomSalt();
      await db.runAsync('UPDATE app_users SET pin_hash=?, pin_salt=?, pin_iter=? WHERE id=?',
        (this as any)._hashSecret(pin, salt, PIN_HASH_ITERATIONS), salt, PIN_HASH_ITERATIONS, u.id);
    } catch (e) { console.warn('[auth] pin hash upgrade skipped:', e); /* old hash still valid */ }
  },

  _lockMessage(until: string): string {
    const ms = Date.parse(until) - Date.now();
    const mins = Math.ceil(ms / 60000);
    return mins > 1 ? `Too many wrong tries. Locked for ${mins} more minutes.` : `Too many wrong tries. Try again in ${Math.max(1, Math.ceil(ms / 1000))}s.`;
  },

  /**
   * Check a recovery answer. Counts toward the same lockout as wrong PINs, and
   * returns false (without checking) while the account is locked.
   */
  async authVerifyRecovery(id: number, answer: string): Promise<boolean> {
    const u: any = await (this as any).authGetUser(id);
    if (!u?.recovery_hash) return false;
    if (lockState(u.failed_attempts || 0, u.locked_until || '').locked) return false;
    const ok = sameHash((this as any)._hashSecret(String(answer).trim().toLowerCase(), u.recovery_salt, u.recovery_iter || LEGACY_HASH_ITERATIONS), u.recovery_hash);
    if (!ok) await (this as any)._authRegisterFailure(id);
    return ok;
  },

  /**
   * Recovery in one step: correct answer → new PIN set and lockout cleared.
   * Wrong answer counts toward the lockout. Prefer this over
   * authVerifyRecovery + authSetPin.
   */
  async authRecoverPin(id: number, answer: string, newPin: string): Promise<{ ok: boolean; message?: string }> {
    const st = await (this as any).authLockStatus(id);
    if (st.locked) return { ok: false, message: (this as any)._lockMessage(st.until) };
    if (!/^\d{4,6}$/.test(String(newPin || ''))) return { ok: false, message: 'Choose a new 4–6 digit PIN.' };
    const ok = await (this as any).authVerifyRecovery(id, answer);
    if (!ok) {
      const after = await (this as any).authLockStatus(id);
      return { ok: false, message: after.locked ? (this as any)._lockMessage(after.until) : `That answer does not match. ${after.attemptsLeft} tr${after.attemptsLeft === 1 ? 'y' : 'ies'} left.` };
    }
    return await (this as any).authSetPin(id, newPin, false);
  },

  async authDeleteUser(id: number): Promise<{ ok: boolean; message?: string }> {
    const u: any = await (this as any).authGetUser(id);
    if (!u) return { ok: false, message: 'User not found.' };
    if (u.is_owner) {
      const owners = await (this as any).authCountActiveOwners();
      if (owners <= 1) return { ok: false, message: 'Cannot delete the only owner account.' };
    }
    await db.runAsync('DELETE FROM app_users WHERE id=?', id);
    return { ok: true };
  },

  // Login with escalating lockout after repeated failures.
  async authLogin(username: string, pin: string): Promise<{ ok: boolean; user?: any; message?: string }> {
    const u: any = await (this as any).authGetUserByUsername(username);
    if (!u) return { ok: false, message: 'No account with that username.' };
    if (!u.is_active) return { ok: false, message: 'This account has been disabled. Ask the owner.' };

    const st = lockState(u.failed_attempts || 0, u.locked_until || '');
    if (st.locked) return { ok: false, message: (this as any)._lockMessage(st.until) };

    const ok = sameHash((this as any)._hashSecret(pin, u.pin_salt, u.pin_iter || LEGACY_HASH_ITERATIONS), u.pin_hash);
    if (!ok) {
      const after = await (this as any)._authRegisterFailure(u.id);
      return {
        ok: false,
        message: after.locked ? (this as any)._lockMessage(after.until)
          : `Wrong PIN. ${after.attemptsLeft} tr${after.attemptsLeft === 1 ? 'y' : 'ies'} left before the account locks.`,
      };
    }

    await db.runAsync("UPDATE app_users SET failed_attempts=0, locked_until='', last_login=datetime('now','localtime') WHERE id=?", u.id);
    await (this as any)._authUpgradePinHash(u, pin);
    const fresh = await (this as any).authGetUser(u.id);
    return { ok: true, user: fresh };
  },

  /**
   * Verify the PIN for an already-known user (lock-screen re-entry). Same
   * lockout as login: returns false while locked (use authLockStatus to show why).
   */
  async authVerifyPin(id: number, pin: string): Promise<boolean> {
    const u: any = await (this as any).authGetUser(id);
    if (!u) return false;
    if (lockState(u.failed_attempts || 0, u.locked_until || '').locked) return false;
    const ok = sameHash((this as any)._hashSecret(pin, u.pin_salt, u.pin_iter || LEGACY_HASH_ITERATIONS), u.pin_hash);
    if (!ok) { await (this as any)._authRegisterFailure(id); return false; }
    if ((u.failed_attempts || 0) > 0) await (this as any)._authClearFailures(id);
    await (this as any)._authUpgradePinHash(u, pin);
    return true;
  },

  // ── audit log ─────────────────────────────────────────────────────────────
  async logAudit(actor: { id?: number; username?: string } | null, action: string, entity = '', entityId = 0, detail = '') {
    try {
      await db.runAsync(
        'INSERT INTO audit_log (user_id, username, action, entity, entity_id, detail) VALUES (?,?,?,?,?,?)',
        actor?.id || 0, actor?.username || 'system', action, entity, entityId, detail
      );
      // Keep the log bounded.
      await db.runAsync('DELETE FROM audit_log WHERE id < (SELECT MAX(id) - 4000 FROM audit_log)').catch(() => {});
    } catch {}
  },
  async getAuditLog(limit = 200): Promise<any[]> {
    try { return await db.getAllAsync('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?', limit) as any[]; }
    catch { return []; }
  },

  // ── attendance policy ─────────────────────────────────────────────────────
  async getAttendanceRules(): Promise<AttendanceRules> {
    try {
      const r: any = await db.getFirstAsync("SELECT value FROM settings WHERE key='attendance_rules'");
      const parsed = r?.value ? JSON.parse(r.value) : {};
      return { ...DEFAULT_ATTENDANCE_RULES, ...parsed };
    } catch { return { ...DEFAULT_ATTENDANCE_RULES }; }
  },
  async setAttendanceRules(rules: Partial<AttendanceRules>) {
    const merged = { ...(await (this as any).getAttendanceRules()), ...rules };
    await db.runAsync('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)', 'attendance_rules', JSON.stringify(merged));
    return merged;
  },

  // Check-in that always stores a 24-hour time and records who did it.
  async staffCheckIn(staffId: number, by: { username?: string } | null, source = 'self'): Promise<{ success: boolean; message: string }> {
    const today = localDateStr();
    const time = nowHHMM();
    const e: any = await db.getFirstAsync('SELECT id, check_in FROM attendance WHERE staff_id=? AND date=?', staffId, today);
    if (e && e.check_in) return { success: false, message: 'Already checked in today at ' + e.check_in };
    if (e) {
      await db.runAsync("UPDATE attendance SET check_in=?, status='present', source=?, recorded_by=? WHERE id=?",
        time, source, by?.username || '', e.id);
    } else {
      await db.runAsync(
        "INSERT INTO attendance (staff_id,date,check_in,status,source,recorded_by) VALUES (?,?,?,'present',?,?)",
        staffId, today, time, source, by?.username || ''
      );
    }
    return { success: true, message: 'Checked in at ' + time };
  },

  // Check-out that applies the owner's attendance policy.
  async staffCheckOut(staffId: number, by: { username?: string } | null, source = 'self'):
    Promise<{ success: boolean; message: string; status: string; hoursWorked: number; review?: boolean }> {
    const today = localDateStr();
    const rules = await (this as any).getAttendanceRules() as AttendanceRules;
    let att: any = await db.getFirstAsync('SELECT * FROM attendance WHERE staff_id=? AND date=?', staffId, today);

    if (att?.check_out) {
      return { success: false, message: `Already checked out at ${att.check_out}.`, status: att.status, hoursWorked: att.hours_worked || 0 };
    }
    if (!att) {
      return { success: false, message: 'No check-in found today. Please check in first.', status: 'absent', hoursWorked: 0 };
    }

    const outTime = nowHHMM();
    const inMin = hhmmToMinutes(att.check_in || '09:00');
    let outMin = hhmmToMinutes(outTime);
    if (!(outMin > inMin)) outMin = inMin; // clock skew guard
    const hoursWorked = Math.max(0, (outMin - inMin) / 60);

    let status = 'present';
    let review = 0;
    let note = '';
    if (hoursWorked >= rules.full_day_hours) {
      status = 'present';
    } else if (hoursWorked >= rules.half_day_hours) {
      status = 'half_day';
    } else {
      if (rules.short_day_action === 'absent') { status = 'absent'; }
      else if (rules.short_day_action === 'flag') { status = 'half_day'; review = 1; note = `Short day (${hoursWorked.toFixed(1)}h) — needs owner review`; }
      else { status = 'half_day'; }
    }

    await db.runAsync(
      'UPDATE attendance SET check_out=?, status=?, hours_worked=?, needs_review=?, notes=CASE WHEN ?<>\'\' THEN ? ELSE notes END, edited_by=? WHERE staff_id=? AND date=?',
      outTime, status, Number(hoursWorked.toFixed(2)), review, note, note, by?.username || '', staffId, today
    );

    const label = status === 'present' ? 'Full day ✅' : status === 'absent' ? 'Marked absent (short day)' : 'Half day';
    return {
      success: true,
      status,
      hoursWorked,
      review: !!review,
      message: `Checked out at ${outTime} · ${hoursWorked.toFixed(1)}h worked · ${label}`,
    };
  },

  // Owner override of a computed status.
  async setAttendanceStatus(staffId: number, date: string, status: string, by: { username?: string } | null) {
    await db.runAsync(
      "UPDATE attendance SET status=?, needs_review=0, edited_by=? WHERE staff_id=? AND date=?",
      status, by?.username || '', staffId, date
    );
    const exists: any = await db.getFirstAsync('SELECT id FROM attendance WHERE staff_id=? AND date=?', staffId, date);
    if (!exists) {
      await db.runAsync("INSERT INTO attendance (staff_id,date,status,source,recorded_by) VALUES (?,?,?,'manual',?)",
        staffId, date, status, by?.username || '');
    }
  },

  async getFlaggedAttendance(): Promise<any[]> {
    try {
      return await db.getAllAsync(
        `SELECT a.*, s.name AS staff_name FROM attendance a JOIN staff s ON a.staff_id=s.id
         WHERE a.needs_review=1 ORDER BY a.date DESC`
      ) as any[];
    } catch { return []; }
  },

  // Appointments for one staff member on a date (staff self-service view).
  async getStaffDayAppointments(staffId: number, date: string): Promise<any[]> {
    return await db.getAllAsync(
      `SELECT a.*, c.name AS client_name, c.phone AS client_phone
       FROM appointments a LEFT JOIN clients c ON a.client_id=c.id
       WHERE a.staff_id=? AND a.date=? AND a.status NOT IN ('cancelled')
       ORDER BY a.start_time`, staffId, date
    ) as any[];
  },

  // ── certificate template ──────────────────────────────────────────────────
  async getCertificateTemplate(): Promise<CertificateTemplate> {
    try {
      const r: any = await db.getFirstAsync("SELECT value FROM settings WHERE key='certificate_template'");
      const parsed = r?.value ? JSON.parse(r.value) : {};
      return { ...DEFAULT_CERTIFICATE_TEMPLATE, ...parsed };
    } catch { return { ...DEFAULT_CERTIFICATE_TEMPLATE }; }
  },
  async setCertificateTemplate(tpl: Partial<CertificateTemplate>) {
    const merged = { ...(await (this as any).getCertificateTemplate()), ...tpl };
    await db.runAsync('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)', 'certificate_template', JSON.stringify(merged));
    return merged;
  },
};

Object.assign(DatabaseService, DatabaseServiceV4);

// The init chain used to be monkey-patched here three more times (v4 tables,
// then the versioned migrations). It is now one ordered sequence in
// DatabaseService._doInitialize(); app_users is part of BACKUP_TABLES so the
// restore stays all-or-nothing.

// ═══════════════════════════════════════════════════════════════════════════
// v5 — PAY-LATER DUES · ANALYTICS FEEDS FOR BOSS AI · CHAIN CATALOG · DEMO DATA
// Typed: new code imports `DBX` instead of casting DatabaseService to any.
// ═══════════════════════════════════════════════════════════════════════════

const DatabaseServiceV5 = {
  // ── Pay later / udhaar ────────────────────────────────────────────────────
  async getDueBills(clientId?: number): Promise<any[]> {
    try {
      const base = `SELECT b.id, b.bill_number, b.client_id, b.total, b.amount_due, b.created_at,
                           c.name AS client_name, c.phone AS client_phone
                      FROM bills b LEFT JOIN clients c ON c.id=b.client_id
                     WHERE b.payment_status='due' AND b.amount_due > 0`;
      return clientId
        ? await db.getAllAsync(`${base} AND b.client_id=? ORDER BY b.created_at`, clientId) as any[]
        : await db.getAllAsync(`${base} ORDER BY b.created_at`) as any[];
    } catch { return []; }
  },

  async getDuesSummary(): Promise<{ count: number; amount: number; clients: number }> {
    try {
      const r: any = await db.getFirstAsync(
        `SELECT COUNT(*) AS n, COALESCE(SUM(amount_due),0) AS amt, COUNT(DISTINCT client_id) AS cl
           FROM bills WHERE payment_status='due' AND amount_due > 0`
      );
      return { count: r?.n || 0, amount: Math.round((r?.amt || 0) * 100) / 100, clients: r?.cl || 0 };
    } catch { return { count: 0, amount: 0, clients: 0 }; }
  },

  /**
   * Record money received against a pay-later bill. Partial payments allowed.
   * Bill status and amount due are re-read INSIDE the transaction, so two
   * quick taps cannot both collect the same due. Loyalty points for the newly
   * paid part are credited now (points are only ever earned on money received).
   */
  async collectDue(billId: number, amount: number, method: 'cash' | 'upi' | 'card', note = ''): Promise<{ ok: boolean; message: string; remaining: number }> {
    const amt = round2(amount || 0);
    if (!(amt > 0)) return { ok: false, message: 'Enter an amount greater than 0.', remaining: 0 };
    const m = String(method || 'cash').toLowerCase();
    if (!['cash', 'upi', 'card'].includes(m)) return { ok: false, message: 'Choose cash, UPI or card.', remaining: 0 };
    try {
      return await withWriteTxn(async (tx) => {
        const bill: any = await tx.getFirstAsync(
          'SELECT id, client_id, total, amount_due, payment_status, is_walkin, loyalty_points_earned FROM bills WHERE id=?', billId);
        if (!bill) return { ok: false, message: 'Bill not found.', remaining: 0 };
        if (bill.payment_status !== 'due' || !(bill.amount_due > 0)) return { ok: false, message: 'Nothing is due on this bill.', remaining: 0 };
        if (toPaise(amt) > toPaise(bill.amount_due)) return { ok: false, message: `Only ${round2(bill.amount_due)} is due on this bill.`, remaining: round2(bill.amount_due) };
        await tx.runAsync(
          'INSERT INTO due_payments (bill_id, client_id, amount, method, date, note, created_at) VALUES (?,?,?,?,?,?,?)',
          billId, bill.client_id || 0, amt, m, localDateStr(), note, localStamp()
        );
        const remaining = fromPaise(Math.max(0, toPaise(bill.amount_due) - toPaise(amt)));
        await tx.runAsync(
          "UPDATE bills SET amount_due=?, payment_status=CASE WHEN ?<=0 THEN 'paid' ELSE 'due' END WHERE id=?",
          remaining, remaining, billId
        );
        if (bill.client_id && !bill.is_walkin) {
          const per100 = await (DatabaseService as any)._pointsPer100(tx);
          const due = loyaltyPointsFor(round2(bill.total - remaining), per100);
          const extra = Math.max(0, due - (bill.loyalty_points_earned || 0));
          if (extra > 0) {
            await tx.runAsync('UPDATE bills SET loyalty_points_earned=loyalty_points_earned+? WHERE id=?', extra, billId);
            await tx.runAsync('UPDATE clients SET loyalty_points=loyalty_points+? WHERE id=?', extra, bill.client_id);
          }
        }
        return { ok: true, message: remaining > 0 ? `Collected. ${remaining} still due.` : 'Fully paid.', remaining };
      });
    } catch (e: any) {
      return { ok: false, message: e?.message || 'Could not record the payment.', remaining: 0 };
    }
  },

  async getDueCollections(start: string, end: string): Promise<any[]> {
    try {
      return await db.getAllAsync(
        `SELECT p.*, c.name AS client_name, b.bill_number FROM due_payments p
           LEFT JOIN clients c ON c.id=p.client_id LEFT JOIN bills b ON b.id=p.bill_id
          WHERE p.date>=? AND p.date<=? ORDER BY p.created_at DESC`, start, end
      ) as any[];
    } catch { return []; }
  },

  // ── Analytics feeds (Boss AI, branch summary) ─────────────────────────────
  /** Valid bills since a date, items parsed. Capped so huge histories stay fast. */
  async getBillsForAnalysis(since: string, limit = 5000): Promise<any[]> {
    try {
      const rows: any[] = await db.getAllAsync(
        `SELECT id, client_id, staff_id, items, subtotal, discount_amount, tax_amount, total, payment_method,
                payment_split, is_walkin, created_at
           FROM bills WHERE created_at>=? AND ${VALID}
          ORDER BY created_at DESC LIMIT ?`, `${since.slice(0, 10)} 00:00:00`, limit
      ) as any[];
      return rows.map(r => ({
        ...r,
        items: (() => { try { return JSON.parse(r.items || '[]'); } catch { return []; } })(),
      }));
    } catch { return []; }
  },

  /** One row per (client, visit day) — the raw material for next-visit prediction. */
  async getClientVisitDays(since: string): Promise<{ client_id: number; d: string; spent: number }[]> {
    try {
      return await db.getAllAsync(
        `SELECT client_id, substr(created_at,1,10) AS d, SUM(total) AS spent FROM bills
          WHERE client_id>0 AND created_at>=? AND ${VALID}
          GROUP BY client_id, substr(created_at,1,10) ORDER BY client_id, d`, `${since.slice(0, 10)} 00:00:00`
      ) as any[];
    } catch { return []; }
  },

  async getVoidsByStaff(start: string, end: string): Promise<any[]> {
    try {
      return await db.getAllAsync(
        `SELECT b.staff_id, s.name AS staff_name, COUNT(*) AS voids, COALESCE(SUM(b.total),0) AS amount
           FROM bills b LEFT JOIN staff s ON s.id=b.staff_id
          WHERE b.payment_status='cancelled' AND b.created_at>=? AND b.created_at<?
          GROUP BY b.staff_id ORDER BY voids DESC`, ...stampRange(start, end)
      ) as any[];
    } catch { return []; }
  },

  async getDiscountsByStaff(start: string, end: string): Promise<any[]> {
    try {
      return await db.getAllAsync(
        `SELECT b.staff_id, s.name AS staff_name, COUNT(*) AS bills,
                SUM(CASE WHEN b.discount_amount>0 THEN 1 ELSE 0 END) AS discounted,
                COALESCE(SUM(b.discount_amount),0) AS discount, COALESCE(SUM(b.subtotal),0) AS gross
           FROM bills b LEFT JOIN staff s ON s.id=b.staff_id
          WHERE b.created_at>=? AND b.created_at<? AND ${VALID_B}
          GROUP BY b.staff_id`, ...stampRange(start, end)
      ) as any[];
    } catch { return []; }
  },

  async getClientsLite(): Promise<any[]> {
    try {
      return await db.getAllAsync(
        `SELECT id, name, phone, total_visits, total_spent, last_visit, loyalty_points, is_vip,
                is_blacklisted, date_of_birth, created_at
           FROM clients WHERE is_active=1`
      ) as any[];
    } catch { return []; }
  },

  async countRows(table: string): Promise<number> {
    if (!/^[a-z_]+$/.test(table)) return 0;
    try { const r: any = await db.getFirstAsync(`SELECT COUNT(*) AS n FROM ${table}`); return r?.n || 0; }
    catch { return 0; }
  },

  /** Rebuild each client's visits / spend / last visit from their bills. */
  async recalculateClientStats(): Promise<void> {
    await db.execAsync(`
      UPDATE clients SET
        total_visits = (SELECT COUNT(*) FROM bills b WHERE b.client_id=clients.id AND b.payment_status NOT IN ('cancelled','credit_note')
                          AND COALESCE(b.ledger,'') NOT LIKE '%"package_sale"%'),
        total_spent  = COALESCE((SELECT SUM(total) FROM bills b WHERE b.client_id=clients.id AND b.payment_status NOT IN ('cancelled','credit_note')),0),
        last_visit   = COALESCE((SELECT MAX(created_at) FROM bills b WHERE b.client_id=clients.id AND b.payment_status NOT IN ('cancelled','credit_note')),'');
      UPDATE clients SET loyalty_tier = CASE
        WHEN total_spent>=50000 THEN 'Platinum' WHEN total_spent>=20000 THEN 'Gold'
        WHEN total_spent>=5000 THEN 'Silver' ELSE 'Bronze' END;
    `);
  },

  // ── Chain catalog (head office pushes one price list) ─────────────────────
  _newKey(): string {
    return Array.from(Crypto.getRandomBytes(6)).map(b => b.toString(16).padStart(2, '0')).join('');
  },

  /** HQ side: every active service, each given a stable sync_key. */
  async getCatalogForSync(): Promise<any[]> {
    const rows: any[] = await db.getAllAsync('SELECT * FROM services ORDER BY category, name') as any[];
    for (const r of rows) {
      if (!r.sync_key) {
        r.sync_key = (this as any)._newKey();
        await db.runAsync('UPDATE services SET sync_key=? WHERE id=?', r.sync_key, r.id);
      }
    }
    return rows.map(r => ({
      sync_key: r.sync_key, name: r.name, category: r.category, price: r.price,
      duration: r.duration, description: r.description || '', is_active: r.is_active ? 1 : 0,
    }));
  },

  /** Branch side: apply HQ's price list. Matches by sync_key, then by name. */
  async applyCatalog(list: any[]): Promise<{ added: number; updated: number }> {
    let added = 0, updated = 0;
    if (!Array.isArray(list)) return { added, updated };
    await withWriteTxn(async (tx) => {
      for (const it of list) {
        const name = String(it?.name || '').trim();
        if (!name) continue;
        const price = Math.max(0, Number(it.price) || 0);
        let row: any = it.sync_key
          ? await tx.getFirstAsync('SELECT id FROM services WHERE sync_key=?', String(it.sync_key))
          : null;
        if (!row) row = await tx.getFirstAsync('SELECT id FROM services WHERE lower(name)=lower(?)', name);
        if (row) {
          await tx.runAsync(
            'UPDATE services SET name=?, category=?, price=?, duration=?, description=?, is_active=?, sync_key=? WHERE id=?',
            name, it.category || 'General', price, Number(it.duration) || 30, it.description || '',
            it.is_active === 0 ? 0 : 1, String(it.sync_key || ''), row.id
          );
          updated++;
        } else if (it.is_active !== 0) {
          await tx.runAsync(
            'INSERT INTO services (name,category,price,duration,description,is_active,sync_key) VALUES (?,?,?,?,?,1,?)',
            name, it.category || 'General', price, Number(it.duration) || 30, it.description || '', String(it.sync_key || '')
          );
          added++;
        }
      }
    });
    return { added, updated };
  },

  // ── Demo data ─────────────────────────────────────────────────────────────
  /**
   * Wipe every business table so the owner can start fresh after trying the
   * demo salon. Logins, the licence and the salon profile are kept.
   */
  async wipeBusinessData(): Promise<void> {
    const tables = [
      'booking_requests', 'due_payments', 'bills', 'appointments', 'reminders', 'campaigns', 'client_memberships',
      'memberships', 'client_wallet_txns', 'client_notes', 'walkin_queue', 'day_close', 'clients', 'attendance',
      'expenses', 'inventory', 'services', 'staff',
      'academy_fees', 'academy_attendance', 'academy_assessments', 'academy_students',
      'academy_batches', 'academy_courses',
    ];
    await withWriteTxn(async (tx) => {
      for (const t of tables) {
        try { await tx.execAsync(`DELETE FROM ${t}`); }
        catch (e) { if (!isIgnorableSchemaError(e)) throw e; /* table absent on this install */ }
      }
      await tx.execAsync(`
        DELETE FROM settings WHERE key LIKE 'bill_counter_%' OR key LIKE 'cn_counter_%' OR key LIKE 'cash_opening_%'
          OR key IN ('revenue_target','demo_mode','bill_counter');
        DELETE FROM sqlite_sequence WHERE name IN ('bills','clients','services','staff','appointments','expenses','inventory','client_wallet_txns','walkin_queue','client_notes');
      `);
      await tx.runAsync('UPDATE app_users SET staff_id=0');
    });
    // Consultation photos belong to clients that no longer exist.
    try {
      const dir = (FileSystem.documentDirectory || '') + 'client-photos/';
      if (await fileExists(dir)) await FileSystem.deleteAsync(dir, { idempotent: true });
    } catch (e) { console.warn('[wipe] client photos left on disk:', e); }
  },

  // ── Online booking requests ──────────────────────────────────────────────
  /** Store requests pulled from the booking page. Ignores ones already stored. Returns how many were new. */
  async saveBookingRequests(list: any[]): Promise<number> {
    let n = 0;
    // Self-cleaning: handled requests older than 6 months are dropped.
    await db.runAsync("DELETE FROM booking_requests WHERE status!='new' AND created_at < datetime('now','localtime','-180 days')").catch(() => {});
    for (const r of list || []) {
      try {
        const res = await db.runAsync(
          `INSERT OR IGNORE INTO booking_requests (remote_id,name,phone,services,staff_id,date,time,duration,note,status,source,created_at)
           VALUES (?,?,?,?,?,?,?,?,?,'new','online',?)`,
          String(r.id), String(r.name || ''), String(r.phone || ''), JSON.stringify(r.services || []), Number(r.staffId) || 0,
          String(r.date || ''), String(r.time || ''), Number(r.duration) || 30, String(r.note || ''), localStamp()
        );
        if (res.changes) n++;
      } catch { /* malformed row */ }
    }
    return n;
  },

  async getBookingRequests(status?: string): Promise<any[]> {
    try {
      const rows: any[] = status
        ? await db.getAllAsync('SELECT * FROM booking_requests WHERE status=? ORDER BY date, time', status) as any[]
        : await db.getAllAsync("SELECT * FROM booking_requests ORDER BY CASE status WHEN 'new' THEN 0 ELSE 1 END, created_at DESC LIMIT 200") as any[];
      return rows.map(r => ({ ...r, services: (() => { try { return JSON.parse(r.services || '[]'); } catch { return []; } })() }));
    } catch { return []; }
  },

  async countNewBookings(): Promise<number> {
    try { const r: any = await db.getFirstAsync("SELECT COUNT(*) AS n FROM booking_requests WHERE status='new'"); return r?.n || 0; }
    catch { return 0; }
  },

  async setBookingStatus(id: number, status: string, appointmentId = 0) {
    await db.runAsync('UPDATE booking_requests SET status=?, appointment_id=? WHERE id=?', status, appointmentId, id);
  },

  /** Busy blocks for the booking page: times only, never client names. */
  async getBusyBlocks(from: string, to: string): Promise<Record<string, { s: string; e: string; staff: number }[]>> {
    const out: Record<string, { s: string; e: string; staff: number }[]> = {};
    try {
      const rows: any[] = await db.getAllAsync(
        "SELECT date, start_time, end_time, staff_id FROM appointments WHERE date>=? AND date<=? AND status NOT IN ('cancelled','no_show')", from, to
      ) as any[];
      for (const r of rows) (out[r.date] ||= []).push({ s: String(r.start_time).slice(0, 5), e: String(r.end_time).slice(0, 5), staff: r.staff_id || 0 });
    } catch {}
    return out;
  },

  /** Clients billed in the last N days (latest visit first) — for review requests. */
  async recentVisitors(days = 7): Promise<{ id: number; name: string; phone: string; last: string; spent: number }[]> {
    try {
      return await db.getAllAsync(
        `SELECT c.id, c.name, c.phone, MAX(b.created_at) AS last, SUM(b.total) AS spent
           FROM bills b JOIN clients c ON c.id=b.client_id
          WHERE ${VALID_B} AND b.created_at >= datetime('now','localtime',?) AND COALESCE(c.phone,'')!='' AND COALESCE(c.is_blacklisted,0)=0
          GROUP BY c.id ORDER BY last DESC LIMIT 200`, `-${Math.max(1, Math.round(days))} days`) as any[];
    } catch { return []; }
  },

  async findClientByPhone(phone: string): Promise<any> {
    const d = String(phone || '').replace(/\D/g, '').slice(-10);
    if (d.length < 10) return null;
    try { return await db.getFirstAsync("SELECT * FROM clients WHERE is_active=1 AND substr(replace(replace(phone,' ',''),'+',''),-10)=? LIMIT 1", d); }
    catch { return null; }
  },

  // ── Setup helpers ─────────────────────────────────────────────────────────
  /** Last 10 digits of every client phone — for de-duplicating imports. */
  async clientPhoneSet(): Promise<Set<string>> {
    const rows: any[] = await db.getAllAsync("SELECT phone FROM clients WHERE phone!=''") as any[];
    return new Set(rows.map(r => String(r.phone).replace(/\D/g, '').slice(-10)).filter(x => x.length === 10));
  },

  /** Import many clients in one transaction. Skips blanks and phones already on file. */
  async importClients(list: { name: string; phone?: string; date_of_birth?: string; notes?: string }[]): Promise<{ added: number; skipped: number }> {
    const have = await (this as any).clientPhoneSet() as Set<string>;
    let added = 0, skipped = 0;
    await withWriteTxn(async (tx) => {
      for (const c of list) {
        const name = String(c.name || '').trim().slice(0, 80);
        const ph = String(c.phone || '').replace(/\D/g, '').slice(-10);
        if (!name || (ph && have.has(ph))) { skipped++; continue; }
        const dob = /^\d{4}-\d{2}-\d{2}$/.test(String(c.date_of_birth || '')) ? String(c.date_of_birth) : '';
        await tx.runAsync(
          'INSERT INTO clients (name,phone,date_of_birth,notes,referral_source,created_at) VALUES (?,?,?,?,?,?)',
          name, ph, dob, String(c.notes || ''), 'Imported', localStamp()
        );
        if (ph) have.add(ph);
        added++;
      }
    });
    return { added, skipped };
  },

  /** Raise or cut every active service price by a percentage, rounded to a neat amount. */
  async bulkUpdatePrices(pct: number, roundTo = 10): Promise<number> {
    // One transaction: a failure half-way must not leave half the menu repriced.
    return await withWriteTxn(async (tx) => {
      const rows: any[] = await tx.getAllAsync('SELECT id, price FROM services WHERE is_active=1') as any[];
      for (const r of rows) {
        const raw = (Number(r.price) || 0) * (1 + pct / 100);
        const p = roundTo > 0 ? Math.max(0, Math.round(raw / roundTo) * roundTo) : Math.round(raw);
        await tx.runAsync('UPDATE services SET price=? WHERE id=?', p, r.id);
      }
      return rows.length;
    });
  },

  async setupCounts(): Promise<{ services: number; staff: number; clients: number; bills: number; users: number }> {
    const one = async (sql: string) => { try { const r: any = await db.getFirstAsync(sql); return r?.n || 0; } catch { return 0; } };
    return {
      services: await one('SELECT COUNT(*) AS n FROM services WHERE is_active=1'),
      staff: await one('SELECT COUNT(*) AS n FROM staff WHERE is_active=1'),
      clients: await one('SELECT COUNT(*) AS n FROM clients WHERE is_active=1'),
      bills: await one('SELECT COUNT(*) AS n FROM bills'),
      users: await one('SELECT COUNT(*) AS n FROM app_users WHERE is_active=1'),
    };
  },

};

Object.assign(DatabaseService, DatabaseServiceV5);

// ═══════════════════════════════════════════════════════════════════════════
// v5.6 — PREPAID WALLET · WALK-IN QUEUE · CONSULTATION NOTES · DAY CLOSE · GST ADVICE
// Every write here is one withWriteTxn() transaction; balances are re-read
// inside it. Errors are thrown as plain sentences a salon owner can act on.
// ═══════════════════════════════════════════════════════════════════════════

const PAY_METHODS = ['cash', 'upi', 'card'];
const NOTE_KINDS = ['note', 'formula', 'allergy', 'patch_test', 'photo'];
const NOTE_TAGS = ['before', 'after', ''];

const DatabaseServiceV6 = {
  // ── Prepaid wallet ("pay ₹5,000, get ₹5,500") ─────────────────────────────
  /**
   * Add money to a client's wallet. `amount` is the money received (counts
   * in that day's cash / UPI / card tally, NOT in revenue — it is a liability
   * until spent). `bonus` is free credit, recorded as a separate 'bonus' entry.
   */
  async walletTopUp(clientId: number, amount: number, method: string, bonus = 0, note = '', createdBy = ''):
    Promise<{ balance: number; topupTxnId: number; bonusTxnId: number }> {
    const amt = round2(amount), bon = round2(bonus || 0);
    const m = String(method || '').toLowerCase();
    if (!(amt > 0)) throw new Error('Enter the amount received (more than 0).');
    if (bon < 0) throw new Error('Bonus cannot be negative.');
    if (!PAY_METHODS.includes(m)) throw new Error('Top-up must be paid by cash, UPI or card.');
    return await withWriteTxn(async (tx) => {
      const c: any = await tx.getFirstAsync('SELECT id FROM clients WHERE id=?', clientId);
      if (!c) throw new Error('Client not found.');
      const stamp = localStamp();
      const t1 = await tx.runAsync(
        "INSERT INTO client_wallet_txns (client_id,amount,kind,bill_id,method,note,created_by,created_at) VALUES (?,?,'topup',0,?,?,?,?)",
        clientId, amt, m, String(note || '').slice(0, 200), createdBy, stamp);
      let bonusTxnId = 0;
      // Bonus credit is free value, never money received: it is not in the
      // day-close tally. When it is later SPENT on a bill, that bill's full total
      // counts as revenue / GST like any other bill (a deliberate choice — the
      // bonus is not treated as a discount). P&L and GST read bills only.
      if (bon > 0) {
        const t2 = await tx.runAsync(
          "INSERT INTO client_wallet_txns (client_id,amount,kind,bill_id,method,note,created_by,created_at) VALUES (?,?,'bonus',0,'bonus',?,?,?)",
          clientId, bon, `Bonus on top-up of ${amt}`, createdBy, stamp);
        bonusTxnId = t2.lastInsertRowId;
      }
      await tx.runAsync('UPDATE clients SET wallet_balance=ROUND(COALESCE(wallet_balance,0)+?,2) WHERE id=?', addMoney(amt, bon), clientId);
      const r: any = await tx.getFirstAsync('SELECT wallet_balance FROM clients WHERE id=?', clientId);
      return { balance: round2(r?.wallet_balance || 0), topupTxnId: t1.lastInsertRowId, bonusTxnId };
    });
  },

  /** Owner correction (+ or −). Refuses to take the balance below zero. A note is required. */
  async walletAdjust(clientId: number, delta: number, note: string, createdBy = ''): Promise<{ balance: number }> {
    const d = round2(delta);
    if (d === 0) throw new Error('Enter an amount to add or remove.');
    if (!String(note || '').trim()) throw new Error('Write a short reason for the adjustment.');
    return await withWriteTxn(async (tx) => {
      const c: any = await tx.getFirstAsync('SELECT name, wallet_balance FROM clients WHERE id=?', clientId);
      if (!c) throw new Error('Client not found.');
      const next = toPaise(c.wallet_balance || 0) + toPaise(d);
      if (next < 0) throw new Error(`${c.name}'s wallet has only ${round2(c.wallet_balance || 0)}.`);
      await tx.runAsync(
        "INSERT INTO client_wallet_txns (client_id,amount,kind,bill_id,method,note,created_by,created_at) VALUES (?,?,'adjust',0,'',?,?,?)",
        clientId, d, String(note).trim().slice(0, 200), createdBy, localStamp());
      await tx.runAsync('UPDATE clients SET wallet_balance=? WHERE id=?', fromPaise(next), clientId);
      return { balance: fromPaise(next) };
    });
  },

  async getWalletBalance(clientId: number): Promise<number> {
    const r: any = await db.getFirstAsync('SELECT wallet_balance FROM clients WHERE id=?', clientId);
    return round2(r?.wallet_balance || 0);
  },

  async getWalletTxns(clientId: number, limit = 50): Promise<any[]> {
    return await db.getAllAsync(
      `SELECT w.*, b.bill_number FROM client_wallet_txns w LEFT JOIN bills b ON b.id=w.bill_id
        WHERE w.client_id=? ORDER BY w.id DESC LIMIT ?`, clientId, Math.max(1, Math.min(500, limit))) as any[];
  },

  /** Money held for clients in wallets (a liability, like unused packages). */
  async getWalletLiability(): Promise<{ clients: number; amount: number }> {
    const r: any = await db.getFirstAsync(
      'SELECT COUNT(*) AS n, COALESCE(SUM(wallet_balance),0) AS amt FROM clients WHERE COALESCE(wallet_balance,0) > 0');
    return { clients: r?.n || 0, amount: round2(r?.amt || 0) };
  },

  // ── Walk-in queue / tokens ────────────────────────────────────────────────
  /** Add a walk-in. Tokens restart at 1 every day. */
  async queueAdd(d: { client_name?: string; phone?: string; client_id?: number; service_note?: string; staff_id?: number }):
    Promise<{ id: number; token_no: number }> {
    const name = String(d?.client_name || '').trim().slice(0, 60);
    const phone = String(d?.phone || '').replace(/[^\d+]/g, '').slice(0, 15);
    if (!name && !d?.client_id) throw new Error('Enter the customer\'s name.');
    const day = localDateStr();
    return await withWriteTxn(async (tx) => {
      let clientName = name;
      if (!clientName && d.client_id) {
        const c: any = await tx.getFirstAsync('SELECT name FROM clients WHERE id=?', d.client_id);
        clientName = c?.name || '';
      }
      const r: any = await tx.getFirstAsync('SELECT MAX(token_no) AS m FROM walkin_queue WHERE date=?', day);
      const token = nextTokenNo(r?.m);
      const ins = await tx.runAsync(
        `INSERT INTO walkin_queue (token_no,date,client_id,client_name,phone,service_note,staff_id,status,created_at)
         VALUES (?,?,?,?,?,?,?,'waiting',?)`,
        token, day, Number(d.client_id) || 0, clientName, phone, String(d.service_note || '').slice(0, 200),
        Number(d.staff_id) || 0, localStamp());
      return { id: ins.lastInsertRowId, token_no: token };
    });
  },

  async queueList(date: string = localDateStr()): Promise<any[]> {
    return await db.getAllAsync(
      `SELECT q.*, s.name AS staff_name FROM walkin_queue q LEFT JOIN staff s ON s.id=q.staff_id
        WHERE q.date=? ORDER BY CASE q.status WHEN 'serving' THEN 0 WHEN 'waiting' THEN 1 ELSE 2 END, q.token_no`, date) as any[];
  },

  /** waiting → serving (stamps called_at) → done / left (stamps done_at). */
  async queueSetStatus(id: number, status: string, staffId?: number): Promise<void> {
    if (!(QUEUE_STATUSES as readonly string[]).includes(status)) throw new Error('Status must be waiting, serving, done or left.');
    await withWriteTxn(async (tx) => {
      const q: any = await tx.getFirstAsync('SELECT * FROM walkin_queue WHERE id=?', id);
      if (!q) throw new Error('That token is no longer in the queue.');
      const stamp = localStamp();
      const calledAt = status === 'serving' && !q.called_at ? stamp : (status === 'waiting' ? '' : q.called_at || '');
      const doneAt = status === 'done' || status === 'left' ? stamp : '';
      await tx.runAsync('UPDATE walkin_queue SET status=?, called_at=?, done_at=?, staff_id=? WHERE id=?',
        status, calledAt, doneAt, staffId !== undefined ? Number(staffId) || 0 : q.staff_id, id);
    });
  },

  async queueStats(date: string = localDateStr()): Promise<{ waiting: number; serving: number; done: number; left: number; avgWaitMin: number }> {
    const rows: any[] = await db.getAllAsync('SELECT status, created_at, called_at FROM walkin_queue WHERE date=?', date) as any[];
    return computeQueueStats(rows);
  },

  // ── Consultation notes & photos ───────────────────────────────────────────
  /**
   * kind: 'note'|'formula'|'allergy'|'patch_test'|'photo'; tag: 'before'|'after'|''.
   * photo_uri must come from ClientPhotoService.savePhoto().
   */
  async addClientNote(d: { client_id: number; kind?: string; text?: string; photo_uri?: string; tag?: string; created_by?: string }): Promise<number> {
    const kind = String(d?.kind || 'note');
    const tag = String(d?.tag || '');
    if (!NOTE_KINDS.includes(kind)) throw new Error(`Unknown note type "${kind}".`);
    if (!NOTE_TAGS.includes(tag)) throw new Error('Photo tag must be before, after or empty.');
    const text = String(d?.text || '').trim().slice(0, 4000);
    const photo = String(d?.photo_uri || '');
    if (photo && !isClientPhotoUri(photo)) throw new Error('Save the photo with ClientPhotoService.savePhoto() first.');
    if (!text && !photo) throw new Error('Write something or add a photo.');
    const c: any = await db.getFirstAsync('SELECT id FROM clients WHERE id=?', d.client_id);
    if (!c) throw new Error('Client not found.');
    const r = await db.runAsync(
      'INSERT INTO client_notes (client_id,kind,text,photo_uri,tag,created_by,created_at) VALUES (?,?,?,?,?,?,?)',
      d.client_id, kind, text, photo, tag, String(d.created_by || ''), localStamp());
    if (kind === 'allergy' && text) {
      // Keep the billing screen's allergy alert in step with the consultation card.
      await db.runAsync(
        "UPDATE clients SET allergies=CASE WHEN COALESCE(allergies,'')='' THEN ? WHEN instr(allergies, ?)>0 THEN allergies ELSE allergies || '; ' || ? END WHERE id=?",
        text.slice(0, 200), text.slice(0, 200), text.slice(0, 200), d.client_id);
    }
    return r.lastInsertRowId;
  },

  async listClientNotes(clientId: number, kind?: string): Promise<any[]> {
    return kind
      ? await db.getAllAsync('SELECT * FROM client_notes WHERE client_id=? AND kind=? ORDER BY id DESC', clientId, kind) as any[]
      : await db.getAllAsync('SELECT * FROM client_notes WHERE client_id=? ORDER BY id DESC', clientId) as any[];
  },

  /** Delete a note and its photo file (photo removal only inside the client-photos folder). */
  async deleteClientNote(id: number): Promise<boolean> {
    const n: any = await db.getFirstAsync('SELECT client_id, kind, text, photo_uri FROM client_notes WHERE id=?', id);
    if (!n) return false;
    await db.runAsync('DELETE FROM client_notes WHERE id=?', id);
    if (n.kind === 'allergy' && n.text) {
      // addClientNote copied this text into clients.allergies (used by the bill
      // and calendar alerts). Take exactly that entry back out, leaving any
      // allergy text the owner typed on the client form untouched.
      try {
        const c: any = await db.getFirstAsync('SELECT allergies FROM clients WHERE id=?', n.client_id);
        const parts = String(c?.allergies || '').split(';').map((x: string) => x.trim()).filter(Boolean);
        const target = String(n.text).trim();
        const idx = parts.indexOf(target);
        if (idx >= 0) {
          parts.splice(idx, 1);
          await db.runAsync('UPDATE clients SET allergies=? WHERE id=?', parts.join('; '), n.client_id);
        }
      } catch (e) { console.warn('[notes] allergy text not cleared:', e); }
    }
    if (n.photo_uri) {
      try { await ClientPhotoService.deletePhoto(n.photo_uri); }
      catch (e) { console.warn('[notes] photo file not removed:', e); /* the note is gone; an orphan file is harmless */ }
    }
    return true;
  },

  // ── Advances on bookings that will not be billed ─────────────────────────
  /**
   * Cancelled / no-show bookings still holding an advance the salon took and
   * has neither used on a bill nor given back. Shown on Day close so the owner
   * can refund it; nothing is refunded automatically.
   */
  async getAdvancesToRefund(): Promise<any[]> {
    try {
      return await db.getAllAsync(
        `SELECT a.id, a.date, a.start_time, a.status, a.advance_method, a.client_id, c.name AS client_name, c.phone AS client_phone,
                ROUND(a.advance_amount - COALESCE(a.advance_used,0) - COALESCE(a.advance_refunded,0), 2) AS amount
           FROM appointments a LEFT JOIN clients c ON c.id=a.client_id
          WHERE ((a.status IN ('cancelled','no_show','no-show') AND COALESCE(a.converted_to_bill,0)=0)
                 OR COALESCE(a.converted_to_bill,0)=1)  -- billed walk-in: advance bigger than the bill
            AND a.advance_amount - COALESCE(a.advance_used,0) - COALESCE(a.advance_refunded,0) > 0.004
          ORDER BY a.date DESC, a.start_time DESC LIMIT 200`) as any[];
    } catch (e) { if (isIgnorableSchemaError(e) || /no such column/i.test(String((e as any)?.message))) return []; throw e; }
  },

  /**
   * Record that the unused advance of a cancelled / no-show booking was given
   * back (cash refunds come out of that day's expected drawer).
   */
  async markAdvanceRefunded(appointmentId: number, method: string): Promise<{ amount: number }> {
    const m = String(method || '').toLowerCase();
    if (!PAY_METHODS.includes(m)) throw new Error('Refund by cash, UPI or card.');
    return await withWriteTxn(async (tx) => {
      const a: any = await tx.getFirstAsync('SELECT * FROM appointments WHERE id=?', appointmentId);
      if (!a) throw new Error('Appointment not found.');
      if (!a.converted_to_bill && !['cancelled', 'no_show', 'no-show'].includes(String(a.status))) throw new Error('Only a cancelled or no-show booking\'s advance can be refunded.');
      const leftP = toPaise(a.advance_amount) - toPaise(a.advance_used) - toPaise(a.advance_refunded);
      if (leftP <= 0) throw new Error('Nothing is left to refund on this booking.');
      await tx.runAsync('UPDATE appointments SET advance_refunded=?, advance_refund_method=?, advance_refunded_at=? WHERE id=?',
        fromPaise(toPaise(a.advance_refunded) + leftP), m, localStamp(), appointmentId);
      return { amount: fromPaise(leftP) };
    });
  },

  // ── Day close / cash tally ────────────────────────────────────────────────
  /**
   * Expected cash in the drawer for `date` (see computeCashTally):
   * opening (the owner's float for that day if set, else the last day close's
   * counted cash, else 0) + cash bill payments incl. the cash part of splits
   * − cash refunds + cash dues collected + cash wallet top-ups + cash advances
   * − cash expenses. UPI / card / wallet figures are included for information.
   */
  async getCashTally(date: string): Promise<CashTally & { date: string; opening_source: 'set' | 'last_close' | 'none'; closed: any | null }> {
    if (!isValidYmd(date)) throw new Error(`"${date}" is not a valid date.`);
    const [a, z] = stampRange(date);
    let opening = 0;
    let source: 'set' | 'last_close' | 'none' = 'none';
    const set: any = await db.getFirstAsync('SELECT value FROM settings WHERE key=?', `cash_opening_${date}`);
    if (set?.value !== undefined && set?.value !== null && set.value !== '') {
      opening = round2(set.value); source = 'set';
    } else {
      const last: any = await db.getFirstAsync('SELECT counted_cash FROM day_close WHERE date<? ORDER BY date DESC LIMIT 1', date).catch(() => null);
      if (last) { opening = round2(last.counted_cash || 0); source = 'last_close'; }
    }
    const safe = async (q: string, ...p: any[]) => { try { return await db.getAllAsync(q, ...p) as any[]; } catch (e) { if (isIgnorableSchemaError(e)) return []; throw e; } };
    const tally = computeCashTally({
      opening,
      bills: await safe('SELECT payment_method, payment_split, total, payment_status FROM bills WHERE created_at>=? AND created_at<?', a, z),
      duePayments: await safe('SELECT amount, method FROM due_payments WHERE date=?', date),
      // method 'advance' = an unused booking advance moved to the wallet: that money was counted when the advance was taken.
      walletTopups: await safe("SELECT amount, method FROM client_wallet_txns WHERE kind='topup' AND COALESCE(method,'')<>'advance' AND created_at>=? AND created_at<?", a, z),
      // Advances taken that day, minus advances given back that day (cancelled / no-show bookings).
      advances: [
        ...await safe("SELECT advance_amount AS amount, advance_method AS method FROM appointments WHERE advance_amount>0 AND created_at>=? AND created_at<?", a, z),
        ...(await safe("SELECT advance_refunded AS amount, advance_refund_method AS method FROM appointments WHERE advance_refunded>0 AND advance_refunded_at>=? AND advance_refunded_at<?", a, z))
          .map((r: any) => ({ amount: -Math.abs(Number(r.amount) || 0), method: r.method })),
      ],
      expenses: await safe('SELECT amount, payment_method FROM expenses WHERE date=?', date),
    });
    const closed = await db.getFirstAsync('SELECT * FROM day_close WHERE date=?', date).catch(() => null);
    return { date, ...tally, opening_source: source, closed: closed || null };
  },

  /** Close the day: store the expected figure, what was counted and the difference. Re-closing overwrites. */
  async saveDayClose(date: string, countedCash: number, note = '', closedBy = ''): Promise<any> {
    if (!isValidYmd(date)) throw new Error(`"${date}" is not a valid date.`);
    const counted = round2(countedCash);
    if (!Number.isFinite(Number(countedCash)) || counted < 0) throw new Error('Enter the cash you counted (0 or more).');
    const t: any = await (this as any).getCashTally(date);
    const diff = fromPaise(toPaise(counted) - toPaise(t.expected_cash));
    await withWriteTxn(async (tx) => {
      await tx.runAsync(
        `INSERT OR REPLACE INTO day_close (date,opening_cash,cash_sales,cash_dues,wallet_topups_cash,advances_cash,cash_refunds,
           cash_expenses,expected_cash,counted_cash,difference,note,details,closed_by,closed_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        date, t.opening_cash, t.cash_sales, t.cash_dues, t.wallet_topups_cash, t.advances_cash, t.cash_refunds,
        t.cash_expenses, t.expected_cash, counted, diff, String(note || '').slice(0, 500),
        JSON.stringify({ received: t.received, wallet_spent: t.wallet_spent, advance_adjusted: t.advance_adjusted, opening_source: t.opening_source }),
        String(closedBy || ''), localStamp());
    });
    return await (this as any).getDayClose(date);
  },

  async getDayClose(date: string): Promise<any | null> {
    const r: any = await db.getFirstAsync('SELECT * FROM day_close WHERE date=?', date);
    return r ? { ...r, details: parseJson<any>(r.details, {}) } : null;
  },

  async listDayCloses(limit = 30): Promise<any[]> {
    const rows: any[] = await db.getAllAsync('SELECT * FROM day_close ORDER BY date DESC LIMIT ?', Math.max(1, Math.min(366, limit))) as any[];
    return rows.map((r) => ({ ...r, details: parseJson<any>(r.details, {}) }));
  },

  // ── GST rate advice ───────────────────────────────────────────────────────
  /**
   * GST on salon / spa services fell from 18% to 5% from 22 Sep 2025. Existing
   * installs are never changed silently; `show` is true when the profile is
   * still at 18% and the owner has not dismissed the advice.
   */
  async getGstAdvice(): Promise<{ currentRate: number; recommendedRate: 5; show: boolean }> {
    const p: any = await db.getFirstAsync('SELECT tax_rate FROM salon_profile LIMIT 1');
    const currentRate = Number(p?.tax_rate ?? 0) || 0;
    const dismissed: any = await db.getFirstAsync("SELECT value FROM settings WHERE key='gst_advice_dismissed'");
    const gstOn: any = await db.getFirstAsync("SELECT value FROM settings WHERE key='gst_enabled'");
    // Only relevant to salons that actually charge GST.
    return { currentRate, recommendedRate: 5, show: gstOn?.value !== 'false' && currentRate === 18 && dismissed?.value !== '1' };
  },

  async dismissGstAdvice(): Promise<void> {
    await db.runAsync("INSERT OR REPLACE INTO settings (key,value) VALUES ('gst_advice_dismissed','1')");
  },
};

Object.assign(DatabaseService, DatabaseServiceV6);


/** Typed handle to the full service, including the v5 additions. */
export const DBX = DatabaseService as typeof DatabaseService & typeof DatabaseServiceV5 & typeof DatabaseServiceV6 & {
  getRevenueTarget(): Promise<number>;
  getCashRegister(date: string): Promise<{ opening: number; sales: number; expenses: number; closing: number }>;
  getLapsedClients(days: number): Promise<any[]>;
  getTopAtRiskClients(days: number, limit?: number): Promise<any[]>;
  getRestockCandidates(staleDays?: number): Promise<any[]>;
  getExpiringProducts(withinDays?: number): Promise<any[]>;
  getInventoryItem(id: number): Promise<any>;
  manualAttendance(staffId: number, date: string, checkIn: string, checkOut: string, status: string, by?: any): Promise<boolean>;
  getDetailedPLReport(start: string, end: string): Promise<any>;
  logAudit(actor: any, action: string, entity?: string, entityId?: number, detail?: string): Promise<void>;
  rescheduleAppointment(id: number, newDate: string, newStart: string, newEnd?: string): Promise<void>;
  getStaffPaySlipV3(staffId: number, year: number, month: number): Promise<any>;
  getGSTReport(year: number, month: number): Promise<any>;
  authLogin(username: string, pin: string): Promise<{ ok: boolean; user?: any; message?: string }>;
  authVerifyPin(userId: number, pin: string): Promise<boolean>;
  authLockStatus(userId: number): Promise<{ locked: boolean; until: string; attemptsLeft: number }>;
  authVerifyRecovery(userId: number, answer: string): Promise<boolean>;
  authRecoverPin(userId: number, answer: string, newPin: string): Promise<{ ok: boolean; message?: string }>;
  authSetPin(userId: number, pin: string, mustChange?: boolean, actingUserId?: number): Promise<{ ok: boolean; message?: string }>;
};
