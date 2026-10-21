import type * as SQLite from 'expo-sqlite';

/**
 * Ordered migrations, keyed off PRAGMA user_version.
 *
 * Database.ts grew three separate `Object.assign` merges and two reassignments
 * of `initialize`, each attaching its own migration step. Ordering depended on
 * module evaluation order, and a method added by a later patch could be called
 * before the columns it writes to existed — `addStaff` writes `required_hours`
 * and `salary_type`, which only appear in the v3 patch.
 *
 * Every future schema change goes here, at the end, with a new version number.
 * Nowhere else.
 */

export interface Migration {
  version: number;
  name: string;
  up: (db: SQLite.SQLiteDatabase) => Promise<void>;
}

/**
 * Errors a migration may safely ignore. Anything else (disk full, corrupt
 * page, SQLCipher key problem) must abort the migration so user_version is NOT
 * bumped past work that never happened.
 */
export function isIgnorableSchemaError(e: unknown): boolean {
  const msg = String((e as any)?.message ?? e ?? '');
  return /duplicate column name|no such table/i.test(msg);
}

/** Add a column only if it is missing. Safe to re-run. */
async function addColumn(
  db: SQLite.SQLiteDatabase,
  table: string,
  column: string,
  definition: string
) {
  try {
    const cols: any[] = await db.getAllAsync(`PRAGMA table_info(${table})`);
    // PRAGMA table_info on a missing table returns no rows rather than failing.
    if (!cols.length) return; /* table not created on this install — its CREATE TABLE will carry the column */
    if (cols.some((c) => c.name === column)) return;
    await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (e) {
    if (isIgnorableSchemaError(e)) return;
    throw new Error(`Could not add ${table}.${column}: ${(e as any)?.message || e}`);
  }
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'staff working hours and salary type',
    up: async (db) => {
      await addColumn(db, 'staff', 'required_hours', "REAL DEFAULT 8");
      await addColumn(db, 'staff', 'salary_type', "TEXT DEFAULT 'fixed'");
      await addColumn(db, 'staff', 'working_days', "TEXT DEFAULT ''");
      await addColumn(db, 'attendance', 'status', "TEXT DEFAULT 'present'");
      await addColumn(db, 'attendance', 'hours_worked', 'REAL DEFAULT 0');
      await addColumn(db, 'attendance', 'flagged', 'INTEGER DEFAULT 0');
    },
  },
  {
    version: 2,
    name: 'client allergies and referral source',
    up: async (db) => {
      await addColumn(db, 'clients', 'allergies', "TEXT DEFAULT ''");
      await addColumn(db, 'clients', 'referral_source', "TEXT DEFAULT ''");
      await addColumn(db, 'clients', 'is_blacklisted', 'INTEGER DEFAULT 0');
    },
  },
  {
    version: 3,
    name: 'bill payment split and walk-in flag',
    up: async (db) => {
      await addColumn(db, 'bills', 'payment_split', "TEXT DEFAULT '{}'");
      await addColumn(db, 'bills', 'is_walkin', 'INTEGER DEFAULT 0');
      await addColumn(db, 'bills', 'loyalty_discount', 'REAL DEFAULT 0');
    },
  },
  {
    version: 4,
    name: 'financial-year invoice counters',
    up: async (db) => {
      await seedFyCounterFromLegacy(db);
    },
  },
  {
    version: 5,
    name: 'mask stored identity numbers',
    up: async (db) => {
      // Earlier versions stored full 12-digit Aadhaar numbers. Private entities
      // are restricted from retaining these — see docs/COMPLIANCE.md. Truncate
      // everything already on disk to the last four digits. Irreversible by
      // design; there is no legitimate reason to keep the rest.
      await maskIdentityNumbers(db);
    },
  },
  {
    version: 6,
    name: 'credit notes and membership sales',
    up: async (db) => {
      await addColumn(db, 'bills', 'voided_by_bill_id', 'INTEGER DEFAULT 0');
      await addColumn(db, 'client_memberships', 'bill_id', 'INTEGER DEFAULT 0');
      await addColumn(db, 'client_memberships', 'value_remaining', 'REAL DEFAULT 0');
      await addColumn(db, 'client_memberships', 'value_total', 'REAL DEFAULT 0');
      await db.execAsync(
        'CREATE INDEX IF NOT EXISTS idx_bills_status ON bills(payment_status)'
      );
      await db.execAsync(
        'CREATE INDEX IF NOT EXISTS idx_cm_client ON client_memberships(client_id)'
      );
    },
  },
  {
    version: 7,
    name: 'local timestamps, pay-later dues, branch sync bookkeeping',
    up: async (db) => {
      // 1. Timestamps. Every created_at / last_visit used to be written with
      //    datetime('now'), which is UTC. Screens parsed that string as LOCAL
      //    time, so every printed invoice showed a time 5h30m behind in India,
      //    and bills after midnight landed on the wrong day. Convert history
      //    once; all new writes are local.
      await convertTimestampsToLocal(db);

      // 2. Pay later / udhaar.
      await addColumn(db, 'bills', 'amount_due', 'REAL DEFAULT 0');
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS due_payments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          bill_id INTEGER NOT NULL,
          client_id INTEGER DEFAULT 0,
          amount REAL NOT NULL,
          method TEXT DEFAULT 'cash',
          date TEXT NOT NULL,
          note TEXT DEFAULT '',
          created_at TEXT DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_due_payments_date ON due_payments(date);
        CREATE INDEX IF NOT EXISTS idx_bills_due ON bills(amount_due);
      `);

      // 3. Services get a stable key so a chain's head office can push one
      //    price list to every branch without duplicating rows.
      await addColumn(db, 'services', 'sync_key', "TEXT DEFAULT ''");
    },
  },
  {
    version: 8,
    name: 'online booking requests',
    up: async (db) => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS booking_requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          remote_id TEXT UNIQUE,
          name TEXT DEFAULT '',
          phone TEXT DEFAULT '',
          services TEXT DEFAULT '[]',
          staff_id INTEGER DEFAULT 0,
          date TEXT DEFAULT '',
          time TEXT DEFAULT '',
          duration INTEGER DEFAULT 30,
          note TEXT DEFAULT '',
          status TEXT DEFAULT 'new',
          appointment_id INTEGER DEFAULT 0,
          source TEXT DEFAULT 'online',
          created_at TEXT DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_booking_status ON booking_requests(status);
      `);
    },
  },
  {
    version: 9,
    name: 'v5.6: bill tax rate, wallet, packages, queue, notes, day close, appointment extras, auth hardening',
    up: async (db) => {
      // ── Bills: the bill's own GST rate (reprints must not use today's rate),
      //    tax-inclusive flag, and a ledger of side effects (stock, wallet,
      //    packages, advance) so a void reverses exactly what was done.
      await addColumn(db, 'bills', 'tax_rate', 'REAL DEFAULT 0');
      await addColumn(db, 'bills', 'prices_include_gst', 'INTEGER DEFAULT 0');
      await addColumn(db, 'bills', 'ledger', "TEXT DEFAULT '{}'");
      await backfillBillTaxRates(db);

      // ── Appointments: advance taken, home service.
      await addColumn(db, 'appointments', 'advance_amount', 'REAL DEFAULT 0');
      await addColumn(db, 'appointments', 'advance_method', "TEXT DEFAULT ''");
      await addColumn(db, 'appointments', 'advance_used', 'REAL DEFAULT 0');
      await addColumn(db, 'appointments', 'address', "TEXT DEFAULT ''");
      await addColumn(db, 'appointments', 'travel_charge', 'REAL DEFAULT 0');

      // ── Clients: prepaid wallet + no-show history.
      await addColumn(db, 'clients', 'wallet_balance', 'REAL DEFAULT 0');
      await addColumn(db, 'clients', 'no_show_count', 'INTEGER DEFAULT 0');
      await recountNoShows(db);

      // ── Packages: sessions for one service, or a rupee value.
      await addColumn(db, 'memberships', 'service_id', 'INTEGER DEFAULT 0');
      await addColumn(db, 'memberships', 'value_amount', 'REAL DEFAULT 0');
      await addColumn(db, 'client_memberships', 'paid_amount', 'REAL DEFAULT 0');
      await addColumn(db, 'client_memberships', 'payment_method', "TEXT DEFAULT ''");

      // ── Logins: iteration count stored with each hash so it can be raised.
      await addColumn(db, 'app_users', 'pin_iter', 'INTEGER DEFAULT 10000');
      await addColumn(db, 'app_users', 'recovery_iter', 'INTEGER DEFAULT 10000');

      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS client_wallet_txns (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          client_id INTEGER NOT NULL,
          amount REAL NOT NULL,
          kind TEXT NOT NULL,
          bill_id INTEGER DEFAULT 0,
          method TEXT DEFAULT '',
          note TEXT DEFAULT '',
          created_by TEXT DEFAULT '',
          created_at TEXT DEFAULT (datetime('now','localtime'))
        );
        CREATE TABLE IF NOT EXISTS walkin_queue (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          token_no INTEGER NOT NULL,
          date TEXT NOT NULL,
          client_id INTEGER DEFAULT 0,
          client_name TEXT DEFAULT '',
          phone TEXT DEFAULT '',
          service_note TEXT DEFAULT '',
          staff_id INTEGER DEFAULT 0,
          status TEXT DEFAULT 'waiting',
          created_at TEXT DEFAULT (datetime('now','localtime')),
          called_at TEXT DEFAULT '',
          done_at TEXT DEFAULT '',
          UNIQUE(date, token_no)
        );
        CREATE TABLE IF NOT EXISTS client_notes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          client_id INTEGER NOT NULL,
          kind TEXT DEFAULT 'note',
          text TEXT DEFAULT '',
          photo_uri TEXT DEFAULT '',
          tag TEXT DEFAULT '',
          created_by TEXT DEFAULT '',
          created_at TEXT DEFAULT (datetime('now','localtime'))
        );
        CREATE TABLE IF NOT EXISTS day_close (
          date TEXT PRIMARY KEY,
          opening_cash REAL DEFAULT 0,
          cash_sales REAL DEFAULT 0,
          cash_dues REAL DEFAULT 0,
          wallet_topups_cash REAL DEFAULT 0,
          advances_cash REAL DEFAULT 0,
          cash_refunds REAL DEFAULT 0,
          cash_expenses REAL DEFAULT 0,
          expected_cash REAL DEFAULT 0,
          counted_cash REAL DEFAULT 0,
          difference REAL DEFAULT 0,
          note TEXT DEFAULT '',
          details TEXT DEFAULT '{}',
          closed_by TEXT DEFAULT '',
          closed_at TEXT DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_wallet_client ON client_wallet_txns(client_id);
        CREATE INDEX IF NOT EXISTS idx_wallet_created ON client_wallet_txns(created_at);
        CREATE INDEX IF NOT EXISTS idx_queue_date ON walkin_queue(date);
        CREATE INDEX IF NOT EXISTS idx_notes_client ON client_notes(client_id);
        CREATE INDEX IF NOT EXISTS idx_due_payments_bill ON due_payments(bill_id);
        CREATE INDEX IF NOT EXISTS idx_bills_status_created ON bills(payment_status, created_at);
        CREATE INDEX IF NOT EXISTS idx_appointments_date_staff ON appointments(date, staff_id);
        CREATE INDEX IF NOT EXISTS idx_appointments_created ON appointments(created_at);
      `);
    },
  },
  {
    version: 10,
    name: 'v5.6: queue token billed once, advance refunds',
    up: async (db) => {
      // A walk-in token remembers the bill made for it, so it cannot be billed twice.
      await addColumn(db, 'walkin_queue', 'bill_id', 'INTEGER DEFAULT 0');
      // An advance on a cancelled / no-show booking can be marked as given back.
      await addColumn(db, 'appointments', 'advance_refunded', 'REAL DEFAULT 0');
      await addColumn(db, 'appointments', 'advance_refund_method', "TEXT DEFAULT ''");
      await addColumn(db, 'appointments', 'advance_refunded_at', "TEXT DEFAULT ''");
    },
  },
];

/**
 * Shift UTC timestamps written by v4.x and earlier to local time. Shared by
 * migration 7 and by restoring an old (format < 5) backup.
 */
export async function convertTimestampsToLocal(db: SQLite.SQLiteDatabase) {
  const jobs: [string, string][] = [
    ['bills', 'created_at'],
    ['clients', 'created_at'],
    ['clients', 'last_visit'],
    ['clients', 'updated_at'],
    ['appointments', 'created_at'],
    ['expenses', 'created_at'],
    ['inventory', 'last_restocked'],
    ['client_memberships', 'created_at'],
  ];
  for (const [table, col] of jobs) {
    try {
      await db.execAsync(
        `UPDATE ${table} SET ${col} = datetime(${col}, 'localtime') ` +
        `WHERE ${col} IS NOT NULL AND ${col} != '' AND length(${col}) >= 19`
      );
    } catch (e) {
      // Only a missing table/column on an old install is expected here.
      if (isIgnorableSchemaError(e) || /no such column/i.test(String((e as any)?.message))) continue;
      throw e;
    }
  }
}

/**
 * Truncate stored identity numbers to the last four digits. Shared by
 * migration 5 and by re-importing a pre-v5 plaintext database.
 */
export async function maskIdentityNumbers(db: SQLite.SQLiteDatabase) {
  let rows: any[] = [];
  try {
    rows = await db.getAllAsync(
      "SELECT id, aadhar FROM academy_students WHERE aadhar IS NOT NULL AND aadhar != ''"
    );
  } catch (e) {
    if (isIgnorableSchemaError(e)) return; /* academy tables not created on this install */
    throw e;
  }
  for (const r of rows) {
    const digits = String(r.aadhar).replace(/\s/g, '');
    if (digits.length <= 4 || digits.startsWith('XXXX')) continue;
    await db.runAsync('UPDATE academy_students SET aadhar=? WHERE id=?', 'XXXX' + digits.slice(-4), r.id);
  }
}

/**
 * Carry the old flat invoice counter into the current financial year so
 * numbering continues rather than restarting at 1 for salons upgrading
 * mid-year. Used by migration 4 and when re-importing a pre-v4 database.
 */
export async function seedFyCounterFromLegacy(db: SQLite.SQLiteDatabase) {
  const now = new Date();
  const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const fy = `${String(startYear).slice(-2)}-${String(startYear + 1).slice(-2)}`;
  const existing: any = await db.getFirstAsync('SELECT value FROM settings WHERE key=?', `bill_counter_${fy}`);
  if (existing) return;
  const legacy: any = await db.getFirstAsync("SELECT value FROM settings WHERE key='bill_counter'");
  const seed = legacy ? Math.max(0, parseInt(legacy.value || '1', 10) - 1) : 0;
  await db.runAsync('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)', `bill_counter_${fy}`, String(seed));
}

/**
 * Bills written before v5.6 have no tax_rate. Derive it from the bill's own
 * figures and snap to the nearest GST slab when within half a point, so a
 * reprint shows the rate that was actually charged. Idempotent: only touches
 * rows whose rate is still 0 while they carry tax.
 */
export async function backfillBillTaxRates(db: SQLite.SQLiteDatabase) {
  await db.execAsync(`
    UPDATE bills SET tax_rate = ROUND(ABS(tax_amount) * 100.0 / ABS(subtotal - discount_amount), 1)
     WHERE COALESCE(tax_rate,0) = 0 AND tax_amount <> 0 AND (subtotal - discount_amount) <> 0
       AND COALESCE(prices_include_gst,0) = 0;
  `);
  for (const slab of [5, 12, 18, 28, 40]) {
    await db.runAsync('UPDATE bills SET tax_rate=? WHERE tax_rate BETWEEN ? AND ? AND tax_rate<>?', slab, slab - 0.5, slab + 0.5, slab);
  }
}

/** clients.no_show_count from the appointment history (idempotent). */
export async function recountNoShows(db: SQLite.SQLiteDatabase) {
  await db.execAsync(`
    UPDATE clients SET no_show_count = (
      SELECT COUNT(*) FROM appointments a
       WHERE a.client_id = clients.id AND a.status IN ('no_show','no-show'));
  `);
}

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

/** Runs `fn` inside one write transaction (Database.ts passes its write-lock wrapper). */
export type TxnRunner = <T>(fn: (tx: SQLite.SQLiteDatabase) => Promise<T>) => Promise<T>;

/** Fallback runner for callers that do not share a write lock (tests, tools). */
function plainTxn(db: SQLite.SQLiteDatabase): TxnRunner {
  return async <T>(fn: (tx: SQLite.SQLiteDatabase) => Promise<T>): Promise<T> => {
    await db.execAsync('BEGIN IMMEDIATE');
    try {
      const r = await fn(db);
      await db.execAsync('COMMIT');
      return r;
    } catch (e) {
      try { await db.execAsync('ROLLBACK'); } catch { /* already closed */ }
      throw e;
    }
  };
}

/**
 * Run every migration newer than the database's recorded version, in order,
 * each in its own transaction so a failure part-way leaves a consistent state
 * and the version number reflects exactly what succeeded.
 *
 * `runInTxn` must be the app's write-lock transaction wrapper so a migration
 * can never interleave with another write on the shared connection.
 */
export async function runMigrations(db: SQLite.SQLiteDatabase, runInTxn?: TxnRunner): Promise<number> {
  const txn = runInTxn || plainTxn(db);
  const row: any = await db.getFirstAsync('PRAGMA user_version');
  let current = Number(row?.user_version ?? 0);

  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    try {
      await txn(async (tx) => {
        await m.up(tx);
        await tx.execAsync(`PRAGMA user_version = ${m.version}`);
      });
      current = m.version;
    } catch (e) {
      throw new Error(`Migration ${m.version} (${m.name}) failed: ${(e as any)?.message}`);
    }
  }

  return current;
}
