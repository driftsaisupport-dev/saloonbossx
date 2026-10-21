/**
 * Output sanitisation. Every value that reaches a generated HTML invoice or a
 * CSV export must pass through here first.
 */

/** Escape a value for safe interpolation into invoice / certificate HTML. */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Tagged template that escapes every interpolated value. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): string {
  return strings.reduce(
    (out, chunk, i) => out + chunk + (i < values.length ? escapeHtml(values[i]) : ''),
    ''
  );
}

/**
 * Escape a single CSV cell.
 *
 * Two separate problems are handled:
 *  1. Quoting — embedded quotes must be doubled, and any value containing a
 *     comma, quote or newline must be wrapped.
 *  2. Formula injection — Excel and Sheets execute a cell that begins with
 *     = + - @ or a tab/CR. A vendor named "=cmd|..." would run on open.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  let s = String(value);

  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;

  return '"' + s.replace(/"/g, '""') + '"';
}

/** Build one CSV row from an array of values. */
export function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(',');
}

/** Build a whole CSV document. Prefixed with a BOM so Excel reads UTF-8. */
export function csvDocument(header: string[], rows: unknown[][]): string {
  return '\uFEFF' + [csvRow(header), ...rows.map(csvRow)].join('\n');
}

/** Normalise an Indian mobile number to the 91XXXXXXXXXX form wa.me expects. */
export function normalisePhone(raw: string): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 10) return '91' + digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  if (digits.length === 13 && digits.startsWith('091')) return digits.slice(1);
  return digits;
}

/**
 * Mask an identity document number for storage and display.
 * We keep only the last four digits — see docs/COMPLIANCE.md for why the full
 * number must never be persisted.
 */
export function maskIdNumber(raw: string): string {
  const digits = String(raw || '').replace(/\s/g, '');
  if (digits.length <= 4) return digits;
  return 'XXXX' + digits.slice(-4);
}
