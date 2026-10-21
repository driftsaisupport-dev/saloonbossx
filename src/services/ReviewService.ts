/**
 * Google reviews — the owner pastes their "Ask for reviews" link once; it then
 * appears on every WhatsApp bill, on printed / PDF bills (with a QR), on the
 * booking page and in review-request campaigns. No API, no cost.
 */
import { Linking } from 'react-native';
import { DBX } from '../database/Database';

const KEY = 'google_review_url';

export function isReviewUrl(u: string): boolean {
  const s = String(u || '').trim();
  return /^https:\/\/(g\.page\/r\/|maps\.app\.goo\.gl\/|goo\.gl\/maps\/|search\.google\.com\/local\/writereview|(www\.)?google\.[a-z.]+\/(maps|search)|g\.co\/kgs\/|business\.google\.com\/)/i.test(s);
}

/** Pull the first link out of whatever was pasted ("Leave us a review: https://g.page/r/…"). */
export function extractUrl(text: string): string {
  const m = String(text || '').match(/https:\/\/[^\s"'<>]+/);
  return m ? m[0].replace(/[).,]+$/, '') : '';
}

export const ReviewService = {
  async get(): Promise<string> {
    try { return (await DBX.getSetting(KEY)) || ''; } catch { return ''; }
  },
  async set(raw: string): Promise<string> {
    const url = extractUrl(raw);
    if (raw.trim() && !url) throw new Error('Paste the full link starting with https://');
    if (url && !isReviewUrl(url)) throw new Error('That does not look like a Google review link. It usually starts with https://g.page/r/');
    await DBX.setSetting(KEY, url);
    return url;
  },
  /** One line for WhatsApp messages; empty when no link is set. */
  async line(): Promise<string> {
    const u = await this.get();
    return u ? `\n\n⭐ Loved our service? Please rate us on Google (takes 10 sec):\n${u}` : '';
  },
  /** Helps the owner find their link: Google shows "Ask for reviews" on their own profile. */
  async findMyLink(salonName: string, city: string) {
    const q = encodeURIComponent(`${salonName} ${city || ''}`.trim());
    await Linking.openURL(`https://www.google.com/search?q=${q}`).catch(() => {});
  },
  reviewRequest(name: string, salon: string, url: string): string {
    const first = String(name || '').split(' ')[0] || 'there';
    return `Hi ${first}! 😊 Thank you for visiting ${salon}.\n\nIf you liked our service, could you give us a quick ⭐⭐⭐⭐⭐ review on Google? It really helps a small business like ours.\n\n👉 ${url}\n\nThank you! 🙏`;
  },
};
