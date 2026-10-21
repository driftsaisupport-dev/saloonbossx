import { fmtMoney, localPrice } from '../config/regions';
/**
 * MarketingTemplates — poster/caption presets for the Marketing Studio.
 *
 * Every template is pure data + a caption builder. The screen renders the
 * poster from these values with plain React Native views (captured to a PNG
 * on share), so nothing here ever needs network access.
 */

export type TemplateKey = 'offer' | 'festival' | 'birthday' | 'service' | 'beforeAfter' | 'thanks' | 'open';

export interface SalonInfo { name?: string; phone?: string; city?: string }

/** A ready-made suggestion (e.g. from Business Insights) that pre-fills the Marketing Studio form. */
export interface MarketingPrefill {
  template: TemplateKey;
  headline?: string;
  subtext?: string;
  detail?: string;
}

export interface MarketingTemplate {
  key: TemplateKey;
  label: string;
  icon: string;
  emoji: string;
  accent: string;
  headlineLabel: string;
  headlinePlaceholder: string;
  headlineDefault: string;
  subtextLabel: string;
  subtextPlaceholder: string;
  subtextDefault: string;
  detailLabel?: string;
  detailPlaceholder?: string;
  photos?: 'single' | 'beforeAfter';
  /** What the headline field's raw text becomes on the poster (e.g. a client's name → "Happy Birthday {name}!"). Defaults to the raw value. */
  posterHeadline?: (headline: string) => string;
  caption: (v: { headline: string; subtext: string; detail: string }, salon: SalonInfo) => string;
}

const bookLine = (salon: SalonInfo) =>
  salon.phone ? `Book now: ${salon.phone}` : 'Book your appointment today!';

export const MARKETING_TEMPLATES: MarketingTemplate[] = [
  {
    key: 'offer',
    label: 'Special Offer',
    icon: 'tag-heart-outline',
    emoji: '🎉',
    accent: '#E5484D',
    headlineLabel: 'Offer headline',
    headlinePlaceholder: 'e.g. FLAT 20% OFF',
    headlineDefault: 'FLAT 20% OFF',
    subtextLabel: 'Offer details',
    subtextPlaceholder: 'e.g. On all hair colour services',
    subtextDefault: 'On all services this week',
    detailLabel: 'Valid till (optional)',
    detailPlaceholder: 'e.g. 30th Sep',
    caption: (v, s) => `🎉 ${v.headline}!\n\n${v.subtext}${v.detail ? `\nValid till ${v.detail}` : ''}\n\nAt ${s.name || 'our salon'}. ${bookLine(s)}`,
  },
  {
    key: 'festival',
    label: 'Festival Wish',
    icon: 'party-popper',
    emoji: '✨',
    accent: '#E0902F',
    headlineLabel: 'Festival',
    headlinePlaceholder: 'e.g. Happy Diwali!',
    headlineDefault: 'Happy Diwali!',
    subtextLabel: 'Message',
    subtextPlaceholder: 'e.g. Wishing you light and joy',
    subtextDefault: 'Wishing you and your family joy and prosperity',
    detailLabel: 'Special offer (optional)',
    detailPlaceholder: 'e.g. 15% off festive bookings',
    caption: (v, s) => `✨ ${v.headline}\n\n${v.subtext}, from all of us at ${s.name || 'our salon'}!${v.detail ? `\n\n🎁 ${v.detail}` : ''}\n\n${bookLine(s)}`,
  },
  {
    key: 'birthday',
    label: 'Birthday Wish',
    icon: 'cake-variant-outline',
    emoji: '🎂',
    accent: '#8B5CF6',
    headlineLabel: 'Client name (optional)',
    headlinePlaceholder: 'Leave blank for a general post',
    headlineDefault: '',
    subtextLabel: 'Birthday gift',
    subtextPlaceholder: 'e.g. 15% off your next visit',
    subtextDefault: 'Enjoy a special surprise on your next visit',
    posterHeadline: (headline) => `Happy Birthday${headline ? ` ${headline}` : ''}!`,
    caption: (v, s) => `🎂 Happy Birthday${v.headline ? ` ${v.headline}` : ''}!\n\nAs our gift, ${v.subtext.toLowerCase()} 🎁\n\nFrom all of us at ${s.name || 'our salon'}. ${bookLine(s)}`,
  },
  {
    key: 'service',
    label: 'Feature a Service',
    icon: 'star-outline',
    emoji: '💇',
    accent: '#A84F18',
    headlineLabel: 'Service name',
    headlinePlaceholder: 'e.g. Keratin Smoothening',
    headlineDefault: '',
    subtextLabel: 'Why they\'ll love it',
    subtextPlaceholder: 'e.g. Silky, frizz-free hair for months',
    subtextDefault: '',
    detailLabel: 'Price (optional)',
    get detailPlaceholder() { return `e.g. Starting ${fmtMoney(localPrice(2999), { whole: true })}`; },
    caption: (v, s) => `💇 Now booking: ${v.headline}\n\n${v.subtext}${v.detail ? `\n${v.detail}` : ''}\n\nAt ${s.name || 'our salon'}. ${bookLine(s)}`,
  },
  {
    key: 'beforeAfter',
    label: 'Before & After',
    icon: 'image-multiple-outline',
    emoji: '✨',
    accent: '#00B383',
    headlineLabel: 'Transformation',
    headlinePlaceholder: 'e.g. Balayage Transformation',
    headlineDefault: '',
    subtextLabel: 'Caption',
    subtextPlaceholder: 'e.g. Swipe to see the glow-up!',
    subtextDefault: '',
    photos: 'beforeAfter',
    posterHeadline: (headline) => headline || 'Transformation of the day',
    caption: (v, s) => `✨ ${v.headline || 'Transformation of the day'}\n\n${v.subtext}\n\nDone at ${s.name || 'our salon'}. ${bookLine(s)}`,
  },
  {
    key: 'thanks',
    label: 'Thank You',
    icon: 'heart-outline',
    emoji: '💜',
    accent: '#EC4899',
    headlineLabel: 'Headline',
    headlinePlaceholder: 'e.g. Thank you!',
    headlineDefault: 'Thank You!',
    subtextLabel: 'Message',
    subtextPlaceholder: 'e.g. We loved having you in today',
    subtextDefault: 'We loved having you in today. If you enjoyed your visit, a review means the world to us!',
    caption: (v, s) => `💜 ${v.headline}\n\n${v.subtext}\n\n— Team ${s.name || ''}`.trim(),
  },
  {
    key: 'open',
    label: "We're Open",
    icon: 'store-clock-outline',
    emoji: '🔔',
    accent: '#3E7BFA',
    headlineLabel: 'Headline',
    headlinePlaceholder: "e.g. We're Open!",
    headlineDefault: "We're Open!",
    subtextLabel: 'Announcement',
    subtextPlaceholder: 'e.g. New timings: 10 AM – 8 PM, all days',
    subtextDefault: '',
    caption: (v, s) => `🔔 ${v.headline}\n\n${v.subtext}\n\nAt ${s.name || 'our salon'}. ${bookLine(s)}`,
  },
];

export const ACCENT_CHOICES = ['#A84F18', '#E5484D', '#0FA968', '#E0902F', '#3E7BFA', '#8B5CF6', '#EC4899', '#111827'];

export function getTemplate(key: TemplateKey): MarketingTemplate {
  return MARKETING_TEMPLATES.find(t => t.key === key) || MARKETING_TEMPLATES[0];
}
