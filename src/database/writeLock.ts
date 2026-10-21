/**
 * One write lock for the one SQLite connection.
 *
 * The app shares a single expo-sqlite connection. SQLite transactions belong
 * to the CONNECTION, not to the JavaScript function that opened them, so before
 * this existed two overlapping calls (a double-tapped "Generate bill", a bill
 * saved while the background sync wrote a setting) interleaved like this:
 *
 *   createBill  BEGIN IMMEDIATE
 *   collectDue  BEGIN IMMEDIATE   → "cannot start a transaction within a transaction"
 *   collectDue  ROLLBACK          → rolls back createBill's half-written bill
 *   createBill  …keeps writing in autocommit mode, partial writes persist
 *
 * Now every transaction AND every stand-alone write goes through one FIFO
 * mutex. Inside a transaction, code must use the `tx` handle it is given
 * (the raw connection) — calling the gated `db` from inside would wait for the
 * lock it already holds. A watchdog turns such a mistake into a clear error
 * instead of a frozen app.
 *
 * PURE MODULE — no React Native imports, so the concurrency behaviour is tested
 * in node (tests/writeLock.test.mjs).
 */

export interface TxnConn {
  execAsync(sql: string): Promise<unknown>;
}

export interface WriteLock {
  /** Run `fn` with the lock held (no transaction). */
  exclusive<T>(fn: () => Promise<T>): Promise<T>;
  /** BEGIN IMMEDIATE → fn(conn) → COMMIT, or ROLLBACK and rethrow. Serialised. */
  withTxn<C extends TxnConn, T>(conn: C, fn: (tx: C) => Promise<T>): Promise<T>;
  /** True while a holder is running (for diagnostics). */
  readonly busy: boolean;
}

export function createWriteLock(opts: { waitTimeoutMs?: number } = {}): WriteLock {
  const waitTimeoutMs = opts.waitTimeoutMs ?? 30000;
  let tail: Promise<void> = Promise.resolve();
  let holders = 0;

  function acquire(): Promise<() => void> {
    let release!: () => void;
    const mine = new Promise<void>((r) => { release = r; });
    const prev = tail;
    tail = prev.then(() => mine);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ready = prev.then(() => {
      if (timer) clearTimeout(timer);
      holders++;
      let done = false;
      return () => { if (!done) { done = true; holders--; release(); } };
    });
    if (!(waitTimeoutMs > 0)) return ready;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(
        'The database is busy finishing another save. Please wait a moment and try again.'
      )), waitTimeoutMs);
    });
    // If we time out, still release our slot once it arrives so the queue keeps moving.
    return Promise.race([ready, timeout]).catch((e) => {
      ready.then((rel) => rel());
      throw e;
    });
  }

  return {
    get busy() { return holders > 0; },

    async exclusive<T>(fn: () => Promise<T>): Promise<T> {
      const release = await acquire();
      try { return await fn(); } finally { release(); }
    },

    async withTxn<C extends TxnConn, T>(conn: C, fn: (tx: C) => Promise<T>): Promise<T> {
      const release = await acquire();
      try {
        await conn.execAsync('BEGIN IMMEDIATE');
        let result: T;
        try {
          result = await fn(conn);
        } catch (e) {
          try { await conn.execAsync('ROLLBACK'); } catch { /* already rolled back by SQLite */ }
          throw e;
        }
        try {
          await conn.execAsync('COMMIT');
        } catch (e) {
          try { await conn.execAsync('ROLLBACK'); } catch { /* nothing open */ }
          throw e;
        }
        return result;
      } finally {
        release();
      }
    },
  };
}
