/**
 * Regions — what makes SaloonBossX a universal app.
 *
 * One table decides, per country: currency, number/date locale, phone rules,
 * the tax the salon charges (GST / VAT / Sales tax / IVA …), how customers pay
 * by QR, and which price tier the subscription is sold at.
 *
 * PURE MODULE — no React Native / Expo imports, so `node --test` can load it.
 * The app calls `setRegion(code)` once the saved setting is read (AppContext),
 * and every formatter reads the active region from here.
 */

export type PayScheme = 'upi' | 'link';
export type CompactStyle = 'indian' | 'intl';

export interface Region {
  code: string;            // ISO 3166-1 alpha-2
  name: string;
  flag: string;
  currency: string;        // ISO 4217
  symbol: string;          // shown before amounts
  locale: string;          // BCP-47 for numbers and dates
  decimals: number;        // minor units shown on bills
  dial: string;            // country calling code, digits only
  phoneLen: [number, number]; // national number length (without trunk 0)
  trunk0: boolean;         // national numbers may be written with a leading 0
  tax: {
    name: string;          // GST, VAT, Sales tax, IVA…
    idLabel: string;       // GSTIN, VAT number, ABN…
    idPattern?: RegExp;    // strict check only where we know the format
    idExample?: string;
    presets: number[];     // quick-pick rates (%)
    splitHalves?: [string, string]; // India: CGST + SGST
    note: string;
  };
  pay: { scheme: PayScheme; label: string; fieldLabel: string; placeholder: string };
  compact: CompactStyle;   // 1.2L / 3.4Cr (India) vs 120K / 3.4M
  hour12: boolean;
}

const r = (x: Region) => x;

const VAT = (name: string, presets: number[], idLabel = 'VAT number', note = 'Confirm the rate for salon services with your accountant.') =>
  ({ name, idLabel, presets, note });
const LINK = (label: string, fieldLabel = 'Payment link or ID', placeholder = 'https://pay.link/yoursalon') =>
  ({ scheme: 'link' as PayScheme, label, fieldLabel, placeholder });

export const REGIONS: Region[] = [
  r({ code: 'IN', name: 'India', flag: '🇮🇳', currency: 'INR', symbol: '₹', locale: 'en-IN', decimals: 2, dial: '91', phoneLen: [10, 10], trunk0: true,
      tax: { name: 'GST', idLabel: 'GSTIN', idPattern: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, idExample: '27ABCDE1234F1Z5',
        presets: [5, 18], splitHalves: ['CGST', 'SGST'], note: 'Salon and spa services are usually 5% (since 22 Sep 2025). Confirm your rate with your CA.' },
      pay: { scheme: 'upi', label: 'UPI', fieldLabel: 'UPI ID (for receipts)', placeholder: 'yourname@upi' }, compact: 'indian', hour12: true }),
  r({ code: 'US', name: 'United States', flag: '🇺🇸', currency: 'USD', symbol: '$', locale: 'en-US', decimals: 2, dial: '1', phoneLen: [10, 10], trunk0: false,
      tax: VAT('Sales tax', [6, 8.25], 'Tax ID / EIN', 'Many states do not tax salon services. Check your state rules.'),
      pay: LINK('Digital', 'Venmo / Cash App / Square link', 'https://venmo.com/u/yoursalon'), compact: 'intl', hour12: true }),
  r({ code: 'GB', name: 'United Kingdom', flag: '🇬🇧', currency: 'GBP', symbol: '£', locale: 'en-GB', decimals: 2, dial: '44', phoneLen: [10, 10], trunk0: true,
      tax: VAT('VAT', [20]), pay: LINK('Pay link', 'Payment link (SumUp, Stripe, PayPal)', 'https://paypal.me/yoursalon'), compact: 'intl', hour12: false }),
  r({ code: 'CA', name: 'Canada', flag: '🇨🇦', currency: 'CAD', symbol: 'C$', locale: 'en-CA', decimals: 2, dial: '1', phoneLen: [10, 10], trunk0: false,
      tax: VAT('GST/HST', [5, 13, 15], 'GST/HST number'), pay: LINK('Interac', 'Interac e-Transfer email or link', 'pay@yoursalon.ca'), compact: 'intl', hour12: true }),
  r({ code: 'AU', name: 'Australia', flag: '🇦🇺', currency: 'AUD', symbol: 'A$', locale: 'en-AU', decimals: 2, dial: '61', phoneLen: [9, 9], trunk0: true,
      tax: VAT('GST', [10], 'ABN'), pay: LINK('PayID', 'PayID (email or phone)', 'pay@yoursalon.com.au'), compact: 'intl', hour12: true }),
  r({ code: 'NZ', name: 'New Zealand', flag: '🇳🇿', currency: 'NZD', symbol: 'NZ$', locale: 'en-NZ', decimals: 2, dial: '64', phoneLen: [8, 10], trunk0: true,
      tax: VAT('GST', [15], 'GST number'), pay: LINK('Pay link'), compact: 'intl', hour12: true }),
  r({ code: 'IE', name: 'Ireland', flag: '🇮🇪', currency: 'EUR', symbol: '€', locale: 'en-IE', decimals: 2, dial: '353', phoneLen: [9, 9], trunk0: true,
      tax: VAT('VAT', [13.5, 23]), pay: LINK('Pay link'), compact: 'intl', hour12: false }),
  r({ code: 'DE', name: 'Germany', flag: '🇩🇪', currency: 'EUR', symbol: '€', locale: 'de-DE', decimals: 2, dial: '49', phoneLen: [10, 11], trunk0: true,
      tax: VAT('MwSt', [19, 7], 'USt-IdNr.'), pay: LINK('PayPal'), compact: 'intl', hour12: false }),
  r({ code: 'FR', name: 'France', flag: '🇫🇷', currency: 'EUR', symbol: '€', locale: 'fr-FR', decimals: 2, dial: '33', phoneLen: [9, 9], trunk0: true,
      tax: VAT('TVA', [20], 'N° TVA'), pay: LINK('Lien de paiement'), compact: 'intl', hour12: false }),
  r({ code: 'ES', name: 'Spain', flag: '🇪🇸', currency: 'EUR', symbol: '€', locale: 'es-ES', decimals: 2, dial: '34', phoneLen: [9, 9], trunk0: false,
      tax: VAT('IVA', [21], 'NIF / CIF'), pay: LINK('Bizum', 'Bizum phone or payment link', '+34 600 000 000'), compact: 'intl', hour12: false }),
  r({ code: 'IT', name: 'Italy', flag: '🇮🇹', currency: 'EUR', symbol: '€', locale: 'it-IT', decimals: 2, dial: '39', phoneLen: [9, 10], trunk0: false,
      tax: VAT('IVA', [22], 'Partita IVA'), pay: LINK('Satispay / link'), compact: 'intl', hour12: false }),
  r({ code: 'NL', name: 'Netherlands', flag: '🇳🇱', currency: 'EUR', symbol: '€', locale: 'nl-NL', decimals: 2, dial: '31', phoneLen: [9, 9], trunk0: true,
      tax: VAT('BTW', [21, 9], 'BTW-nummer'), pay: LINK('Tikkie', 'Tikkie / iDEAL link', 'https://tikkie.me/pay/…'), compact: 'intl', hour12: false }),
  r({ code: 'PT', name: 'Portugal', flag: '🇵🇹', currency: 'EUR', symbol: '€', locale: 'pt-PT', decimals: 2, dial: '351', phoneLen: [9, 9], trunk0: false,
      tax: VAT('IVA', [23], 'NIF'), pay: LINK('MB WAY', 'MB WAY phone or link', '+351 900 000 000'), compact: 'intl', hour12: false }),
  r({ code: 'AE', name: 'United Arab Emirates', flag: '🇦🇪', currency: 'AED', symbol: 'AED ', locale: 'en-AE', decimals: 2, dial: '971', phoneLen: [9, 9], trunk0: true,
      tax: VAT('VAT', [5], 'TRN'), pay: LINK('Pay link'), compact: 'intl', hour12: true }),
  r({ code: 'SA', name: 'Saudi Arabia', flag: '🇸🇦', currency: 'SAR', symbol: 'SAR ', locale: 'en-SA', decimals: 2, dial: '966', phoneLen: [9, 9], trunk0: true,
      tax: VAT('VAT', [15], 'VAT number'), pay: LINK('STC Pay / link'), compact: 'intl', hour12: true }),
  r({ code: 'QA', name: 'Qatar', flag: '🇶🇦', currency: 'QAR', symbol: 'QAR ', locale: 'en-QA', decimals: 2, dial: '974', phoneLen: [8, 8], trunk0: false,
      tax: VAT('Tax', [5], 'Tax ID', 'Qatar has no VAT today — leave tax off unless told otherwise.'), pay: LINK('Pay link'), compact: 'intl', hour12: true }),
  r({ code: 'KW', name: 'Kuwait', flag: '🇰🇼', currency: 'KWD', symbol: 'KD ', locale: 'en-KW', decimals: 3, dial: '965', phoneLen: [8, 8], trunk0: false,
      tax: VAT('Tax', [5], 'Tax ID', 'Kuwait has no VAT today — leave tax off unless told otherwise.'), pay: LINK('Pay link'), compact: 'intl', hour12: true }),
  r({ code: 'OM', name: 'Oman', flag: '🇴🇲', currency: 'OMR', symbol: 'OMR ', locale: 'en-OM', decimals: 3, dial: '968', phoneLen: [8, 8], trunk0: false,
      tax: VAT('VAT', [5], 'VATIN'), pay: LINK('Pay link'), compact: 'intl', hour12: true }),
  r({ code: 'BH', name: 'Bahrain', flag: '🇧🇭', currency: 'BHD', symbol: 'BD ', locale: 'en-BH', decimals: 3, dial: '973', phoneLen: [8, 8], trunk0: false,
      tax: VAT('VAT', [10], 'VAT account number'), pay: LINK('BenefitPay'), compact: 'intl', hour12: true }),
  r({ code: 'SG', name: 'Singapore', flag: '🇸🇬', currency: 'SGD', symbol: 'S$', locale: 'en-SG', decimals: 2, dial: '65', phoneLen: [8, 8], trunk0: false,
      tax: VAT('GST', [9], 'GST reg. no.'), pay: LINK('PayNow', 'PayNow UEN / mobile', 'UEN 201912345K'), compact: 'intl', hour12: true }),
  r({ code: 'MY', name: 'Malaysia', flag: '🇲🇾', currency: 'MYR', symbol: 'RM', locale: 'en-MY', decimals: 2, dial: '60', phoneLen: [9, 10], trunk0: true,
      tax: VAT('SST', [8], 'SST no.'), pay: LINK('DuitNow', 'DuitNow ID / link', 'DuitNow 0123456789'), compact: 'intl', hour12: true }),
  r({ code: 'ID', name: 'Indonesia', flag: '🇮🇩', currency: 'IDR', symbol: 'Rp', locale: 'id-ID', decimals: 0, dial: '62', phoneLen: [9, 12], trunk0: true,
      tax: VAT('PPN', [11, 12], 'NPWP'), pay: LINK('QRIS', 'QRIS / e-wallet link', 'https://…'), compact: 'intl', hour12: false }),
  r({ code: 'PH', name: 'Philippines', flag: '🇵🇭', currency: 'PHP', symbol: '₱', locale: 'en-PH', decimals: 2, dial: '63', phoneLen: [10, 10], trunk0: true,
      tax: VAT('VAT', [12], 'TIN'), pay: LINK('GCash', 'GCash / Maya number', '0917 000 0000'), compact: 'intl', hour12: true }),
  r({ code: 'TH', name: 'Thailand', flag: '🇹🇭', currency: 'THB', symbol: '฿', locale: 'th-TH', decimals: 2, dial: '66', phoneLen: [9, 9], trunk0: true,
      tax: VAT('VAT', [7], 'Tax ID'), pay: LINK('PromptPay', 'PromptPay ID', '081 000 0000'), compact: 'intl', hour12: false }),
  r({ code: 'PK', name: 'Pakistan', flag: '🇵🇰', currency: 'PKR', symbol: 'Rs ', locale: 'en-PK', decimals: 0, dial: '92', phoneLen: [10, 10], trunk0: true,
      tax: VAT('Sales tax', [16, 15], 'NTN / STRN'), pay: LINK('JazzCash', 'JazzCash / Easypaisa number', '0300 0000000'), compact: 'indian', hour12: true }),
  r({ code: 'BD', name: 'Bangladesh', flag: '🇧🇩', currency: 'BDT', symbol: '৳', locale: 'en-BD', decimals: 0, dial: '880', phoneLen: [10, 10], trunk0: true,
      tax: VAT('VAT', [15], 'BIN'), pay: LINK('bKash', 'bKash / Nagad number', '01700 000000'), compact: 'indian', hour12: true }),
  r({ code: 'LK', name: 'Sri Lanka', flag: '🇱🇰', currency: 'LKR', symbol: 'Rs ', locale: 'en-LK', decimals: 2, dial: '94', phoneLen: [9, 9], trunk0: true,
      tax: VAT('VAT', [18], 'VAT reg. no.'), pay: LINK('LankaQR'), compact: 'indian', hour12: true }),
  r({ code: 'NP', name: 'Nepal', flag: '🇳🇵', currency: 'NPR', symbol: 'Rs ', locale: 'en-NP', decimals: 2, dial: '977', phoneLen: [10, 10], trunk0: false,
      tax: VAT('VAT', [13], 'PAN / VAT no.'), pay: LINK('eSewa / Khalti', 'eSewa / Khalti ID'), compact: 'indian', hour12: true }),
  r({ code: 'NG', name: 'Nigeria', flag: '🇳🇬', currency: 'NGN', symbol: '₦', locale: 'en-NG', decimals: 2, dial: '234', phoneLen: [10, 10], trunk0: true,
      tax: VAT('VAT', [7.5], 'TIN'), pay: LINK('Transfer', 'Bank account / Paystack link', 'https://paystack.com/pay/yoursalon'), compact: 'intl', hour12: true }),
  r({ code: 'KE', name: 'Kenya', flag: '🇰🇪', currency: 'KES', symbol: 'KSh ', locale: 'en-KE', decimals: 2, dial: '254', phoneLen: [9, 9], trunk0: true,
      tax: VAT('VAT', [16], 'KRA PIN'), pay: LINK('M-Pesa', 'M-Pesa Till / Paybill', 'Till 123456'), compact: 'intl', hour12: true }),
  r({ code: 'GH', name: 'Ghana', flag: '🇬🇭', currency: 'GHS', symbol: 'GH₵', locale: 'en-GH', decimals: 2, dial: '233', phoneLen: [9, 9], trunk0: true,
      tax: VAT('VAT', [15], 'TIN'), pay: LINK('MoMo', 'Mobile Money number', '024 000 0000'), compact: 'intl', hour12: true }),
  r({ code: 'ZA', name: 'South Africa', flag: '🇿🇦', currency: 'ZAR', symbol: 'R', locale: 'en-ZA', decimals: 2, dial: '27', phoneLen: [9, 9], trunk0: true,
      tax: VAT('VAT', [15], 'VAT number'), pay: LINK('SnapScan / link'), compact: 'intl', hour12: false }),
  r({ code: 'EG', name: 'Egypt', flag: '🇪🇬', currency: 'EGP', symbol: 'E£', locale: 'en-EG', decimals: 2, dial: '20', phoneLen: [10, 10], trunk0: true,
      tax: VAT('VAT', [14], 'Tax reg. no.'), pay: LINK('InstaPay', 'InstaPay address', 'yoursalon@instapay'), compact: 'intl', hour12: true }),
  r({ code: 'TR', name: 'Türkiye', flag: '🇹🇷', currency: 'TRY', symbol: '₺', locale: 'tr-TR', decimals: 2, dial: '90', phoneLen: [10, 10], trunk0: true,
      tax: VAT('KDV', [20], 'Vergi No'), pay: LINK('Ödeme linki'), compact: 'intl', hour12: false }),
  r({ code: 'BR', name: 'Brazil', flag: '🇧🇷', currency: 'BRL', symbol: 'R$', locale: 'pt-BR', decimals: 2, dial: '55', phoneLen: [10, 11], trunk0: true,
      tax: VAT('ISS', [5, 2], 'CNPJ'), pay: LINK('PIX', 'Chave PIX', 'email@seusalao.com.br'), compact: 'intl', hour12: false }),
  r({ code: 'MX', name: 'Mexico', flag: '🇲🇽', currency: 'MXN', symbol: 'MX$', locale: 'es-MX', decimals: 2, dial: '52', phoneLen: [10, 10], trunk0: false,
      tax: VAT('IVA', [16], 'RFC'), pay: LINK('Transferencia', 'CLABE / link de pago', '012 345 678901234567'), compact: 'intl', hour12: true }),
  r({ code: 'CO', name: 'Colombia', flag: '🇨🇴', currency: 'COP', symbol: 'COL$', locale: 'es-CO', decimals: 0, dial: '57', phoneLen: [10, 10], trunk0: false,
      tax: VAT('IVA', [19], 'NIT'), pay: LINK('Nequi', 'Nequi / Daviplata', '300 000 0000'), compact: 'intl', hour12: true }),
  r({ code: 'CL', name: 'Chile', flag: '🇨🇱', currency: 'CLP', symbol: 'CLP$', locale: 'es-CL', decimals: 0, dial: '56', phoneLen: [9, 9], trunk0: false,
      tax: VAT('IVA', [19], 'RUT'), pay: LINK('Transferencia'), compact: 'intl', hour12: false }),
  r({ code: 'XX', name: 'Other country (US$)', flag: '🌍', currency: 'USD', symbol: '$', locale: 'en-US', decimals: 2, dial: '', phoneLen: [6, 14], trunk0: true,
      tax: VAT('Tax', [5, 10], 'Tax ID'), pay: LINK('Digital'), compact: 'intl', hour12: true }),
];

export const REGION_BY_CODE: Record<string, Region> = Object.fromEntries(REGIONS.map(x => [x.code, x]));

// ── Active region ────────────────────────────────────────────────────────────

let active: Region = REGION_BY_CODE.IN;
const listeners = new Set<() => void>();
/** Mirror for pure modules that cannot import this file (src/services/ai/analytics.ts). */
const mirror = (r: Region) => { try { (globalThis as any).__sbxRegion = { code: r.code, locale: r.locale, symbol: r.symbol }; } catch {} };
mirror(active);

export function getRegion(): Region { return active; }
export function setRegion(code: string | null | undefined): Region {
  const next = REGION_BY_CODE[String(code || '').toUpperCase()] || active;
  if (next !== active) { active = next; mirror(active); listeners.forEach(f => { try { f(); } catch {} }); }
  return active;
}
export function onRegionChange(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }

/**
 * Best guess for a fresh install, from the device locale ("en-GB" → GB).
 * Never throws; falls back to India (the original market) when unknown.
 */
export function detectRegionCode(localeTag?: string): string {
  let tag = localeTag || '';
  if (!tag) { try { tag = Intl.DateTimeFormat().resolvedOptions().locale || ''; } catch { tag = ''; } }
  const m = /[-_]([A-Z]{2})\b/i.exec(tag);
  const cc = m ? m[1].toUpperCase() : '';
  return REGION_BY_CODE[cc] ? cc : (cc ? 'XX' : 'IN');
}

/** Region whose currency symbol matches an old install's saved symbol. */
export function regionForSymbol(sym: string): string | null {
  const s = String(sym || '').trim();
  if (!s) return null;
  if (s === '₹' || /^rs\.?$/i.test(s)) return 'IN';
  const hit = REGIONS.find(x => x.symbol.trim() === s);
  return hit ? hit.code : null;
}

// ── Formatting ───────────────────────────────────────────────────────────────

export const appLocale = (): string => active.locale;
export const curSym = (): string => active.symbol;
export const curCode = (): string => active.currency;

function safeNum(n: unknown): number { const v = Number(n); return Number.isFinite(v) ? v : 0; }

/** Group digits the local way: 1,23,456 (IN) · 123,456 (US) · 123.456 (DE). */
export function fmtNumber(n: number, maxFrac = 2, minFrac = 0, region: Region = active): string {
  const v = safeNum(n);
  try { return v.toLocaleString(region.locale, { minimumFractionDigits: minFrac, maximumFractionDigits: maxFrac }); }
  catch { return v.toFixed(Math.min(maxFrac, 2)); }
}

/** ₹1,234 · $1,234.50 · 1.234,50 € (symbol always in front, as on receipts). */
export function fmtMoney(n: number, opts: { sym?: string; whole?: boolean; region?: Region } = {}): string {
  const region = opts.region || active;
  const sym = opts.sym ?? region.symbol;
  const v = safeNum(n);
  const frac = opts.whole ? 0 : region.decimals;
  return `${v < 0 ? '−' : ''}${sym}${fmtNumber(Math.abs(v), frac, 0, region)}`;
}

/** 1.2L / 3.4Cr for South Asia, 12.5K / 3.4M elsewhere. */
export function fmtCompact(n: number, sym = active.symbol, region: Region = active): string {
  const v = safeNum(n);
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  const one = (x: number) => x.toFixed(1).replace(/\.0$/, '');
  if (region.compact === 'indian') {
    if (a >= 1e7) return `${sign}${sym}${one(a / 1e7)}Cr`;
    if (a >= 1e5) return `${sign}${sym}${one(a / 1e5)}L`;
  } else {
    if (a >= 1e9) return `${sign}${sym}${one(a / 1e9)}B`;
    if (a >= 1e6) return `${sign}${sym}${one(a / 1e6)}M`;
    if (a >= 1e5) return `${sign}${sym}${one(a / 1e3)}K`;
  }
  return `${sign}${sym}${Number.isInteger(a) ? fmtNumber(a, 0) : fmtNumber(a, 2)}`;
}

// ── Local salon prices ───────────────────────────────────────────────────────

/**
 * Salon-price parity, NOT exchange rates: what a ₹300 Indian haircut "is" on a
 * local menu (≈ $30 in the US, £24 in the UK, AED 90 in Dubai). Used to scale
 * the starter service menus and the demo salon so they look real everywhere.
 */
export const SALON_PRICE_FACTOR: Record<string, number> = {
  INR: 1, USD: 0.1, GBP: 0.08, EUR: 0.085, CAD: 0.13, AUD: 0.15, NZD: 0.16,
  AED: 0.3, SAR: 0.3, QAR: 0.3, KWD: 0.025, OMR: 0.03, BHD: 0.03, SGD: 0.12,
  MYR: 0.2, IDR: 120, PHP: 2.5, THB: 2.5, PKR: 2.5, BDT: 1, LKR: 2.5, NPR: 1.4,
  NGN: 15, KES: 1.4, GHS: 0.15, ZAR: 0.9, EGP: 2, TRY: 2.5, BRL: 0.35, MXN: 1.2,
  COP: 300, CLP: 70,
};

/** Round to a price a salon would actually print: 29.5, 45, 120, 1,250, 35,000. */
export function nicePrice(v: number): number {
  const a = Math.abs(v);
  const step = a < 10 ? 0.5 : a < 100 ? 1 : a < 1000 ? 5 : a < 10000 ? 50 : a < 100000 ? 500 : 1000;
  return Math.max(step, Math.round(a / step) * step);
}

/** An Indian-market price (₹) as a typical price on this salon's local menu. */
export function localPrice(inr: number, region: Region = active): number {
  const f = SALON_PRICE_FACTOR[region.currency] ?? 0.1;
  if (f === 1) return inr;
  return nicePrice((Number(inr) || 0) * f);
}

/** Step used when bulk-changing menu prices: ₹10 in India, $1 in the US, Rp 1,000 in Indonesia. */
export function priceRoundStep(region: Region = active): number {
  const f = SALON_PRICE_FACTOR[region.currency] ?? 0.1;
  return f === 1 ? 10 : nicePrice(10 * f);
}

/** Notes counted at day close, largest first. */
const NOTES_BY_CURRENCY: Record<string, number[]> = {
  INR: [500, 200, 100, 50, 20, 10], PKR: [5000, 1000, 500, 100, 50, 10], BDT: [1000, 500, 200, 100, 50, 20],
  LKR: [5000, 1000, 500, 100, 50, 20], NPR: [1000, 500, 100, 50, 20, 10],
  USD: [100, 50, 20, 10, 5, 1], CAD: [100, 50, 20, 10, 5], AUD: [100, 50, 20, 10, 5], NZD: [100, 50, 20, 10, 5],
  SGD: [100, 50, 10, 5, 2], GBP: [50, 20, 10, 5], EUR: [100, 50, 20, 10, 5], AED: [500, 200, 100, 50, 20, 10, 5],
  SAR: [500, 100, 50, 10, 5, 1], QAR: [500, 100, 50, 10, 5, 1], KWD: [20, 10, 5, 1], OMR: [50, 20, 10, 5, 1], BHD: [20, 10, 5, 1],
  MYR: [100, 50, 20, 10, 5, 1], IDR: [100000, 50000, 20000, 10000, 5000, 2000], PHP: [1000, 500, 200, 100, 50, 20],
  THB: [1000, 500, 100, 50, 20], NGN: [1000, 500, 200, 100, 50], KES: [1000, 500, 200, 100, 50], GHS: [200, 100, 50, 20, 10, 5],
  ZAR: [200, 100, 50, 20, 10], EGP: [200, 100, 50, 20, 10, 5], TRY: [200, 100, 50, 20, 10, 5], BRL: [200, 100, 50, 20, 10, 5, 2],
  MXN: [1000, 500, 200, 100, 50, 20], COP: [100000, 50000, 20000, 10000, 5000, 2000], CLP: [20000, 10000, 5000, 2000, 1000],
};
export const cashNotes = (region: Region = active): number[] => NOTES_BY_CURRENCY[region.currency] || [100, 50, 20, 10, 5, 1];

// ── Phones ───────────────────────────────────────────────────────────────────

/**
 * Normalise a phone typed at the counter.
 *  - A local number for the salon's country → its national digits ("9876543210").
 *  - An international number (+44…, 0044…) for ANOTHER country → "+<cc><number>"
 *    so tourists and expats still get WhatsApp bills.
 * Returns '' when the input cannot be a phone number.
 */
export function normalisePhone(raw: string, region: Region = active): string {
  const s = String(raw || '').trim();
  let d = s.replace(/\D/g, '');
  if (!d) return '';
  const intl = s.startsWith('+') || d.startsWith('00');
  if (d.startsWith('00')) d = d.slice(2);
  const [min, max] = region.phoneLen;
  const okLocal = (x: string) => x.length >= min && x.length <= max && (region.code !== 'IN' || /^[6-9]/.test(x));

  if (region.dial && d.startsWith(region.dial) && okLocal(d.slice(region.dial.length)) && (intl || d.length > max)) {
    return d.slice(region.dial.length);
  }
  if (region.dial && d.startsWith('0' + region.dial) && okLocal(d.slice(region.dial.length + 1))) return d.slice(region.dial.length + 1);
  if (!intl) {
    if (region.trunk0 && d.startsWith('0') && okLocal(d.slice(1))) return d.slice(1);
    if (okLocal(d)) return d;
  }
  // Foreign number in full international form (E.164 allows 8–15 digits).
  if ((intl || !region.dial) && d.length >= 8 && d.length <= 15) return `+${d}`;
  return '';
}

/** Digits WhatsApp / tel: links need: country code + national number. */
export function internationalPhone(stored: string, region: Region = active): string {
  const s = String(stored || '').trim();
  if (!s) return '';
  if (s.startsWith('+')) return s.replace(/\D/g, '');
  const n = normalisePhone(s, region);
  if (!n) return s.replace(/\D/g, '');
  if (n.startsWith('+')) return n.slice(1);
  return `${region.dial}${n}`;
}

export function phoneHint(region: Region = active): string {
  const [min, max] = region.phoneLen;
  const len = min === max ? `${min}-digit` : `${min}–${max} digit`;
  return region.dial
    ? `Enter a ${len} mobile number (you can start with +${region.dial}${region.trunk0 ? ' or 0' : ''}).`
    : 'Enter the mobile number with its country code, e.g. +44 7700 900123.';
}

// ── Tax & payments ───────────────────────────────────────────────────────────

export const taxName = (): string => active.tax.name;
export const taxIdLabel = (): string => active.tax.idLabel;
export const splitsTax = (): boolean => !!active.tax.splitHalves;
export const payLabel = (): string => active.pay.label;
export const usesUpi = (): boolean => active.pay.scheme === 'upi';

export function validTaxId(id: string, region: Region = active): boolean {
  const v = String(id || '').trim().toUpperCase();
  if (!v) return true;
  if (region.tax.idPattern) return region.tax.idPattern.test(v);
  return /^[A-Z0-9][A-Z0-9 .\-/]{3,30}$/.test(v);
}
