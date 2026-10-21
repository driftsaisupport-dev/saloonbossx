import { appLocale, curSym, fmtCompact, getRegion, normalisePhone, validTaxId } from '../config/regions';
// ── Local-date helpers ──────────────────────────────────────────────────────
// The SQLite layer stores/queries dates as `YYYY-MM-DD` in the device's LOCAL
// timezone. `new Date().toISOString().split('T')[0]` returns the UTC date, so in
// IST it flips to "tomorrow" at 05:30 — meaning "today's" dashboard/reports were
// wrong for the first 5.5 hours of every day. Always use these instead.
export const toLocalDateStr = (d: Date = new Date()): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export const todayLocal = (): string => toLocalDateStr(new Date());

/**
 * Parse a timestamp read from SQLite (`YYYY-MM-DD HH:MM:SS`, local time since
 * v5) into a Date. `new Date('2026-10-01 14:30:00')` is not a format the JS
 * spec guarantees — Hermes may return Invalid Date — while the `T` form without
 * an offset is defined as local time everywhere.
 */
export const parseDbDate = (v: any): Date => {
  if (v instanceof Date) return v;
  if (typeof v === 'number') return new Date(v);
  const s = String(v || '').trim();
  if (!s) return new Date(NaN);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T00:00:00`);
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) return new Date(s.replace(' ', 'T'));
  return new Date(s);
};

/** "01 Oct 2026, 8:05 pm" — for invoices and history rows. */
export const formatDateTime = (v: any): string => {
  const d = parseDbDate(v);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString(appLocale(), { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};

/** Whole days from a stored date to today (local). NaN when unknown. */
export const daysSince = (v: any): number => {
  const d = parseDbDate(v);
  if (isNaN(d.getTime())) return NaN;
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const n = new Date(); const b = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  return Math.round((b - a) / 86400000);
};

// Universal: symbol, digit grouping and compact units (L/Cr vs K/M) follow the
// salon's region (src/config/regions.ts). A symbol passed in still wins.
export const formatCurrency = (n: number, sym: string = curSym()): string => {
  if (n == null || isNaN(n)) return `${sym}0`;
  return fmtCompact(n, sym);
};

export const formatCurrencyFull = (n: number, sym: string = curSym()): string =>
  `${sym}${(Number(n) || 0).toLocaleString(appLocale(), { minimumFractionDigits: 0, maximumFractionDigits: getRegion().decimals })}`;

export const formatDate = (d: string | Date, f: 'short' | 'long' = 'short'): string => {
  const dt = typeof d === 'string' ? parseDbDate(d) : d;
  if (isNaN(dt.getTime())) return '';
  return f === 'short'
    ? dt.toLocaleDateString(appLocale(), { day: '2-digit', month: 'short', year: 'numeric' })
    : dt.toLocaleDateString(appLocale(), { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
};

export const formatTime = (t: string): string => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return t;
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

export const getInitials = (name: string): string =>
  name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);

export const generateTimeSlots = (start = '09:00', end = '21:00', interval = 30): string[] => {
  const slots: string[] = [];
  let [h, m] = start.split(':').map(Number);
  const [eH] = end.split(':').map(Number);
  while (h < eH) {
    slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    m += interval;
    if (m >= 60) { h++; m = 0; }
  }
  return slots;
};

export const getGreeting = (): string => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

/** Valid mobile for the salon's country (or a full +international number). */
export const validatePhone = (p: string): boolean => normalisePhone(p) !== '';

/** Tax id check for the salon's country (GSTIN in India, VAT no. in the UK…). Empty is OK. */
export const validateGSTIN = (id: string): boolean => validTaxId(String(id || '').replace(/\s/g, ''));

export const SERVICE_CATEGORIES = ['Hair', 'Skin', 'Nails', 'Makeup', 'Spa', 'Bridal', 'Men', 'Other'];

export const EXPENSE_CATEGORIES = [
  'Rent', 'Electricity', 'Water', 'Product Purchase', 'Staff Salary',
  'Marketing', 'Equipment', 'Maintenance', 'Laundry', 'Transport', 'Miscellaneous',
];

// FIX: Safe JSON parse helper to avoid try/catch repetition across the codebase
export const safeJSONParse = <T>(json: string, fallback: T): T => {
  try { return JSON.parse(json); } catch { return fallback; }
};
