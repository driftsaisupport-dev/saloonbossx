/**
 * Small business rules that are easy to get wrong and easy to test.
 *
 * PURE MODULE — no React Native / Expo imports, so `node --test` can import it
 * directly. Database.ts calls these; tests/rules.test.mjs checks them.
 */

// ── Dates & times ───────────────────────────────────────────────────────────

const pad2 = (n: number) => String(n).padStart(2, '0');

/** "2026-02-28" ok, "2026-02-31" / "2026-2-3" / "" not. */
export function isValidYmd(s: unknown): boolean {
  const m = String(s ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(y, mo, 0).getDate();
}

/** "09:30" / "23:59" ok, "24:00" / "9:30" / "12:60" not. */
export function isValidHHMM(s: unknown): boolean {
  const m = String(s ?? '').match(/^(\d{2}):(\d{2})$/);
  return !!m && +m[1] <= 23 && +m[2] <= 59;
}

export function hhmmToMin(s: string): number {
  const m = String(s).match(/^(\d{1,2}):(\d{2})/);
  return m ? +m[1] * 60 + +m[2] : NaN;
}

export function minToHHMM(min: number): string {
  return `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
}

export function ymd(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Calendar day arithmetic on "YYYY-MM-DD" in local time. */
export function addDaysYmd(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return ymd(new Date(y, m - 1, d + n));
}

/**
 * Index-friendly bounds for a local date range on a `created_at` column:
 *   created_at >= start AND created_at < endExclusive
 * (`date(created_at)=?` cannot use the index; this can.)
 */
export function stampRange(startYmd: string, endYmd: string = startYmd): [string, string] {
  return [`${startYmd} 00:00:00`, `${addDaysYmd(endYmd, 1)} 00:00:00`];
}

/** Local Date for "YYYY-MM-DD" + "HH:MM". */
export function localDateTime(day: string, hhmm: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  const mins = hhmmToMin(hhmm);
  return new Date(y, m - 1, d, Math.floor(mins / 60), mins % 60, 0, 0);
}

/** Do [aStart,aEnd) and [bStart,bEnd) overlap? Times are "HH:MM". */
export function timesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return hhmmToMin(aStart) < hhmmToMin(bEnd) && hhmmToMin(bStart) < hhmmToMin(aEnd);
}

/** Indian financial year label: 1 Apr – 31 Mar. 5 May 2026 → "26-27". */
export function financialYear(d: Date = new Date()): string {
  const y = d.getFullYear();
  const start = d.getMonth() >= 3 ? y : y - 1;
  return `${String(start).slice(-2)}-${String(start + 1).slice(-2)}`;
}

// ── Login lockout ───────────────────────────────────────────────────────────

/** Wrong answers allowed before the first lock. */
export const MAX_FREE_ATTEMPTS = 5;

/**
 * Lock length after `fails` consecutive wrong PINs / recovery answers:
 * nothing for the first 4, then 5 min, 10, 20, 40 … capped at 24 h.
 */
export function lockoutMinutes(fails: number): number {
  if (fails < MAX_FREE_ATTEMPTS) return 0;
  return Math.min(24 * 60, 5 * Math.pow(2, fails - MAX_FREE_ATTEMPTS));
}

export function lockState(fails: number, lockedUntil: string, nowMs: number = Date.now()):
  { locked: boolean; until: string; attemptsLeft: number } {
  const untilMs = lockedUntil ? Date.parse(lockedUntil) : NaN;
  const locked = Number.isFinite(untilMs) && nowMs < untilMs;
  if (locked) return { locked: true, until: lockedUntil, attemptsLeft: 0 };
  const f = Math.max(0, Number(fails) || 0);
  return { locked: false, until: '', attemptsLeft: f < MAX_FREE_ATTEMPTS ? MAX_FREE_ATTEMPTS - f : 1 };
}

// ── Payroll ─────────────────────────────────────────────────────────────────

/**
 * Fixed salary prorated by attendance, never above the base salary. Working on
 * a weekly-off day does not create overtime unless a separate rule pays for it.
 */
export function proratedFixedSalary(base: number, workingDays: number, effectiveDays: number): number {
  const b = Math.max(0, Number(base) || 0);
  if (!(workingDays > 0)) return b;
  const days = Math.max(0, Math.min(Number(effectiveDays) || 0, workingDays));
  return (b / workingDays) * days;
}

// ── Walk-in queue ───────────────────────────────────────────────────────────

/**
 * Next token for `day`. Tokens restart at 1 every day: pass the highest token
 * already issued FOR THAT DAY (0 or null when none).
 */
export function nextTokenNo(maxTokenToday: number | null | undefined): number {
  const n = Math.floor(Number(maxTokenToday) || 0);
  return n > 0 ? n + 1 : 1;
}

export const QUEUE_STATUSES = ['waiting', 'serving', 'done', 'left'] as const;
export type QueueStatus = typeof QUEUE_STATUSES[number];

export function computeQueueStats(rows: { status: string; created_at?: string; called_at?: string }[]):
  { waiting: number; serving: number; done: number; left: number; avgWaitMin: number } {
  const out = { waiting: 0, serving: 0, done: 0, left: 0, avgWaitMin: 0 };
  let waitSum = 0, waitN = 0;
  for (const r of rows || []) {
    if (r.status in out) (out as any)[r.status]++;
    if (r.called_at && r.created_at) {
      const a = Date.parse(String(r.created_at).replace(' ', 'T'));
      const b = Date.parse(String(r.called_at).replace(' ', 'T'));
      if (Number.isFinite(a) && Number.isFinite(b) && b >= a) { waitSum += (b - a) / 60000; waitN++; }
    }
  }
  out.avgWaitMin = waitN ? Math.round(waitSum / waitN) : 0;
  return out;
}

// ── Invoice numbering ───────────────────────────────────────────────────────

/** Highest trailing serial among existing numbers, e.g. "SOS/CN-26-27/00012" → 12. */
export function maxSerial(numbers: string[]): number {
  let max = 0;
  for (const n of numbers || []) {
    const m = String(n).match(/(\d+)\s*$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
}

// ── SQL identifiers ─────────────────────────────────────────────────────────

/** Quote a column/table name for SQL. Throws on anything that is not a plain identifier. */
export function quoteIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(name))) throw new Error(`Invalid column name "${name}".`);
  return `"${name}"`;
}
