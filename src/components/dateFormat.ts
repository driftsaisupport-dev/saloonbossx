// Re-exports used by the pickers so they don't pull Alert/tr from formUtils.
export { localDateStr, parseLocalDate, isValidDateStr, prettyDate, isValidTime } from './formUtils';

/** "14:30" → "2:30 PM". */
export function formatTime12(t: string): string {
  const [h, m] = String(t || '').split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return t || '';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}
