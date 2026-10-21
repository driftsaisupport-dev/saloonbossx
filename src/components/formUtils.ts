/**
 * Small, dependency-free form helpers shared by the screens.
 *
 * Lives in components/ (not utils/) on purpose — utils/ is owned by the data
 * layer. Everything here is pure and safe to call from any screen.
 */
import { Alert } from 'react-native';
import { tr } from '../i18n/tr';
import { appLocale, normalisePhone as normaliseRegionPhone } from '../config/regions';

// ── Money ───────────────────────────────────────────────────────────────────

/**
 * Parse an amount the way a salon owner anywhere types it.
 *   "1,500" → 1500    "₹ 1,50,000.50" → 150000.5    "€ 12,50" → 12.5    " 99 " → 99
 * Returns NaN for empty / non-numeric / negative input so callers can reject
 * it with a clear message. (parseFloat('1,500') is 1 — the bug this replaces.)
 */
export function parseAmount(raw: unknown, opts: { allowZero?: boolean; allowNegative?: boolean } = {}): number {
  if (typeof raw === 'number') {
    if (!isFinite(raw)) return NaN;
    if (raw < 0 && !opts.allowNegative) return NaN;
    if (raw === 0 && opts.allowZero === false) return NaN;
    return raw;
  }
  const s = normaliseDecimal(String(raw ?? '')
    .replace(/^\s*-?\s*(rs\.?|inr|[a-z]{3})\s*/i, m => (m.includes('-') ? '-' : ''))
    .replace(/[^0-9.,\-]/g, ''));
  if (!s) return NaN;
  if (!/^-?\d*\.?\d+$|^-?\d+\.$/.test(s)) return NaN;
  const n = Number(s);
  if (!isFinite(n)) return NaN;
  if (n < 0 && !opts.allowNegative) return NaN;
  if (n === 0 && opts.allowZero === false) return NaN;
  return Math.round(n * 100) / 100;
}

/** True when the salon's locale writes 1.5 as "1,5". */
export function usesDecimalComma(): boolean {
  try { return (1.5).toLocaleString(appLocale()).includes(','); } catch { return false; }
}

/**
 * Universal decimal handling: "1,500" → "1500" (thousands), "12,50" → "12.50"
 * (decimal comma, Europe/LatAm), "1.234,56" → "1234.56", "1,234.56" → "1234.56".
 */
export function normaliseDecimal(t: string): string {
  let s = t.trim();
  const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    // whichever comes last is the decimal mark
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    const commas = (s.match(/,/g) || []).length;
    const after = s.length - lastComma - 1;
    s = commas === 1 && after > 0 && after <= 2 ? s.replace(',', '.') : s.replace(/,/g, '');
  }
  return s;
}

/** parseAmount, but empty input → 0 (for optional fields). Still NaN on junk. */
export function parseOptionalAmount(raw: unknown): number {
  if (raw == null || String(raw).trim() === '') return 0;
  return parseAmount(raw);
}

/** Keep only characters a money field may contain while typing. */
export function cleanAmountInput(t: string): string {
  // Where the decimal mark is a comma (es, pt, fr, de…), the keypad types ","; treat it as ".".
  const raw = String(t || '').replace(/[^0-9.,]/g, '');
  const s = usesDecimalComma() ? raw.replace(/\./g, '').replace(/,/g, '.') : raw.replace(/,/g, '');
  // only one decimal point
  const i = s.indexOf('.');
  return i < 0 ? s : s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, '');
}

/** Whole, non-negative integer from text ("1,000" → 1000). NaN on junk. */
export function parseCount(raw: unknown): number {
  const n = parseAmount(raw);
  if (isNaN(n)) return NaN;
  return Math.floor(n);
}

export const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

// ── Phone ───────────────────────────────────────────────────────────────────

/**
 * Normalise a mobile number for the salon's country (src/config/regions.ts).
 *   India: "+91 98765 43210" → "9876543210"   UK: "07700 900123" → "7700900123"
 * A foreign number typed in full (+44…) is kept as "+447700900123".
 * Returns '' when the input is not a valid number.
 * (Name kept from the India-only edition so older call sites keep working.)
 */
export function normaliseIndianPhone(raw: string): string {
  return normaliseRegionPhone(raw);
}
export const normalisePhone = (raw: string) => normaliseRegionPhone(raw);

export const isValidPhone = (raw: string) => normaliseRegionPhone(raw) !== '';
export const isValidIndianPhone = (raw: string) => normaliseIndianPhone(raw) !== '';

/** Last 10 digits — the key the data layer uses to match phones. */
export const phoneKey = (raw: string) => String(raw || '').replace(/\D/g, '').slice(-10);

// ── Dates & times ───────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD in the device's LOCAL timezone (never toISOString, which is UTC). */
export const localDateStr = (d: Date = new Date()): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** HH:MM local. */
export const localTimeStr = (d: Date = new Date()): string => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** True for a real calendar date in YYYY-MM-DD form (rejects 2026-02-30). */
export function isValidDateStr(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d && y > 1900 && y < 2200;
}

/** Parse YYYY-MM-DD as a LOCAL date (midnight). Invalid → Invalid Date. */
export function parseLocalDate(s: string): Date {
  if (!isValidDateStr(s)) return new Date(NaN);
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** True for HH:MM, 00:00–23:59. */
export function isValidTime(t: string): boolean {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '').trim());
  if (!m) return false;
  const h = Number(m[1]), mi = Number(m[2]);
  return h >= 0 && h <= 23 && mi >= 0 && mi <= 59;
}

/** "9" → "09:00", "930" → "09:30", "9.30" → "09:30", "21:5" → null. Lenient for typed input. */
export function normaliseTime(raw: string): string | null {
  const s = String(raw || '').trim().replace('.', ':');
  if (/^\d{1,2}$/.test(s)) { const h = Number(s); return h <= 23 ? `${pad(h)}:00` : null; }
  if (/^\d{3,4}$/.test(s)) { const h = Number(s.slice(0, -2)), m = Number(s.slice(-2)); return h <= 23 && m <= 59 ? `${pad(h)}:${pad(m)}` : null; }
  if (/^\d{1,2}:\d{2}$/.test(s)) { const [h, m] = s.split(':').map(Number); return h <= 23 && m <= 59 ? `${pad(h)}:${pad(m)}` : null; }
  return null;
}

export const timeToMin = (t: string): number => {
  const [h, m] = String(t || '').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};
export const minToTime = (n: number): string => {
  const v = Math.max(0, Math.min(23 * 60 + 59, Math.round(n)));
  return `${pad(Math.floor(v / 60))}:${pad(v % 60)}`;
};

/** True when the date (and optional time) is before now. */
export function isPast(date: string, time?: string): boolean {
  const d = parseLocalDate(date);
  if (isNaN(d.getTime())) return false;
  if (!time) return localDateStr(d) < localDateStr(new Date());
  d.setHours(Math.floor(timeToMin(time) / 60), timeToMin(time) % 60, 0, 0);
  return d.getTime() < Date.now() - 60_000;
}

export function addDays(date: string, n: number): string {
  const d = parseLocalDate(date);
  d.setDate(d.getDate() + n);
  return localDateStr(d);
}

/** "Mon, 13 Oct" style for the picker fields. */
export function prettyDate(s: string, withYear = false): string {
  const d = parseLocalDate(s);
  if (isNaN(d.getTime())) return s || '';
  return d.toLocaleDateString(appLocale(), { weekday: 'short', day: '2-digit', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });
}

/** Indian financial year for a date: FY 2026-27 runs 1 Apr 2026 → 31 Mar 2027. */
export function indianFY(d: Date = new Date()): { startYear: number; start: string; end: string; label: string } {
  const startYear = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return {
    startYear,
    start: `${startYear}-04-01`,
    end: `${startYear + 1}-03-31`,
    label: `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`,
  };
}

// ── Errors ──────────────────────────────────────────────────────────────────

const TECHNICAL = /sqlite|syntax|undefined is not|null is not|cannot read prop|typeerror|referenceerror|native module|nativemodule|call to function|is not a function|unexpected token|json|constraint failed|no such (table|column)|errno|ENOENT|exception/i;

/**
 * Turn any thrown value into a sentence a salon owner can act on.
 * Messages the data layer throws on purpose ("That slot overlaps…") are shown
 * as-is; low-level technical errors become a calm generic line.
 */
export function friendlyError(e: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const msg = (e as any)?.message ?? (typeof e === 'string' ? e : '');
  const s = String(msg || '').trim();
  if (!s || s.length > 220 || TECHNICAL.test(s)) {
    if (/network|fetch|timeout|internet/i.test(s)) return tr('No internet connection. Check your network and try again.');
    return tr(fallback);
  }
  return tr(s);
}

/** Show a friendly error alert. Logs the raw error for the crash log. */
export function showError(e: unknown, title = 'Could not complete', fallback?: string) {
  try { console.warn('[ui]', title, e); } catch { /* ignore */ }
  Alert.alert(tr(title), friendlyError(e, fallback));
}

/** Promise-based confirm dialog (2 buttons — safe on Android). */
export function confirmAsync(title: string, message: string, okLabel = 'OK', destructive = false): Promise<boolean> {
  return new Promise(resolve => {
    Alert.alert(tr(title), tr(message), [
      { text: tr('Cancel'), style: 'cancel', onPress: () => resolve(false) },
      { text: tr(okLabel), style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}
