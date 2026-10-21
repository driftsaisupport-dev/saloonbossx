/** Plan catalogue. Pure data — no crypto, no IO. */

export type PlanId = 'solo' | 'standard' | 'multi' | 'academy';
export type LicensePlan = PlanId;

/**
 * Launch pricing. `price` is what the customer pays now; `mrp` is the regular
 * price, shown struck through. Change both here — the activation screen, the
 * checkout link and the WhatsApp message all read from this one place.
 */
export const LAUNCH_LIMIT = 99;

export const LICENSE_PLANS: Record<PlanId, {
  name: string; price: number; mrp: number; maxDevices: number; tagline: string;
  features: string[]; color: string;
}> = {
  // `price` / `mrp` are legacy INR one-time figures kept for old keys and the
  // key tools. What a salon actually pays now comes from MONTHLY_PRICE_BOOK.
  solo: {
    name: 'Solo',
    price: 1999,
    mrp: 3999,
    maxDevices: 1,
    tagline: 'Home studio, freelancer, barber or makeup artist — one person, one phone',
    color: '#10B981',
    features: [
      '✅ 10-second bills on WhatsApp, PDF & thermal print',
      '✅ Clients, history, birthdays & loyalty',
      '✅ Appointment calendar + reminders',
      '✅ Pay-later dues with WhatsApp reminders',
      '✅ Boss AI assistant (offline)',
      '✅ Daily encrypted backup to your Google Drive',
      '✅ WhatsApp booking link & QR poster',
      '❌ Staff logins, commission & payroll',
      '❌ Online booking page',
    ],
  },
  standard: {
    name: 'Salon Pro',
    price: 5999,
    mrp: 11999,
    maxDevices: 1,
    tagline: 'The complete premium app for one salon, spa or barbershop with staff',
    color: '#A84F18',
    features: [
      '✅ Everything in Solo',
      '✅ Online booking page — customers book 24×7',
      '✅ Staff PIN logins, attendance, commission, pay slips',
      '✅ Boss AI leakage guard (discounts & cancelled bills)',
      '✅ Tax invoices (GST · VAT · Sales tax) & tax reports',
      '✅ Packages, memberships & inventory',
      '✅ Marketing posters & win-back campaigns',
      '✅ 38 countries + rest of world: local currency, tax, phone & QR pay',
    ],
  },
  multi: {
    name: 'Chain',
    price: 12999,
    mrp: 24999,
    maxDevices: 3,
    tagline: 'Up to 3 branches on one HQ dashboard (extra branches available)',
    color: '#F59E0B',
    features: [
      '✅ Everything in Salon Pro, for every branch',
      '✅ HQ dashboard: all branches live on one phone',
      '✅ One price list pushed to every branch',
      '✅ Branch comparison, chain-wide staff ranking',
      '✅ Google Sheet dashboard for your laptop',
      '✅ Online booking link for each branch',
      '✅ Priority WhatsApp support',
    ],
  },
  academy: {
    name: 'Salon + Academy',
    price: 9999,
    mrp: 19999,
    maxDevices: 2,
    tagline: 'Salon Pro plus your beauty, hair or barber academy',
    color: '#8B5CF6',
    features: [
      '✅ Everything in Salon Pro',
      '✅ Courses, batches & student enrolment',
      '✅ Student attendance, fees & receipts',
      '✅ Assessments & certificates with your signature',
      '✅ Salon + academy on 2 phones, one dashboard',
    ],
  },
};

// ── Billing options ─────────────────────────────────────────────────────────
// Universal edition (v6): subscriptions only — Monthly or Yearly, priced in the
// salon's own currency. Yearly = 10 × monthly (two months free), so most owners
// pick Yearly. Every option unlocks exactly the same features. Lifetime keys
// sold before v6 keep working; they are just not offered any more.
export type Billing = 'monthly' | 'yearly' | 'lifetime';
export const BILLINGS: Billing[] = ['monthly', 'yearly', 'lifetime'];
export const SHOWN_BILLINGS: Billing[] = ['monthly', 'yearly'];
/** Days a term key adds. A few extra days so a renewal paid a little late never interrupts work. */
export const TERM_DAYS: Record<Exclude<Billing, 'lifetime'>, number> = { monthly: 31, yearly: 366 };
export const BILLING_LABEL: Record<Billing, { name: string; per: string; short: string }> = {
  monthly: { name: 'Monthly', per: '/month', short: 'Monthly' },
  yearly: { name: 'Yearly', per: '/year', short: 'Yearly' },
  lifetime: { name: 'One-time', per: ' one-time', short: 'Lifetime' },
};

/**
 * Monthly price per plan in each currency we sell in. Tiers follow local
 * purchasing power (premium in USD/GBP/EUR/Gulf, adjusted in South Asia, Africa
 * and LatAm) and sit at or above the local market leaders' entry plans.
 * Yearly is derived: 10 × monthly. Edit THIS table to reprice a country.
 */
export const MONTHLY_PRICE_BOOK: Record<string, Record<PlanId, number>> = {
  USD: { solo: 19,    standard: 39,    multi: 99,     academy: 59 },
  GBP: { solo: 15,    standard: 32,    multi: 79,     academy: 49 },
  EUR: { solo: 17,    standard: 35,    multi: 89,     academy: 55 },
  CAD: { solo: 25,    standard: 52,    multi: 129,    academy: 79 },
  AUD: { solo: 29,    standard: 59,    multi: 149,    academy: 89 },
  NZD: { solo: 32,    standard: 65,    multi: 159,    academy: 95 },
  AED: { solo: 69,    standard: 139,   multi: 349,    academy: 219 },
  SAR: { solo: 69,    standard: 139,   multi: 349,    academy: 219 },
  QAR: { solo: 69,    standard: 139,   multi: 349,    academy: 219 },
  KWD: { solo: 5.9,   standard: 11.9,  multi: 29.9,   academy: 17.9 },
  OMR: { solo: 7.5,   standard: 14.9,  multi: 37.9,   academy: 22.9 },
  BHD: { solo: 7.5,   standard: 14.9,  multi: 37.9,   academy: 22.9 },
  SGD: { solo: 25,    standard: 52,    multi: 129,    academy: 79 },
  MYR: { solo: 59,    standard: 119,   multi: 299,    academy: 179 },
  IDR: { solo: 149000, standard: 299000, multi: 749000, academy: 449000 },
  PHP: { solo: 699,   standard: 1399,  multi: 3499,   academy: 2099 },
  THB: { solo: 499,   standard: 999,   multi: 2499,   academy: 1499 },
  INR: { solo: 499,   standard: 999,   multi: 2499,   academy: 1499 },
  PKR: { solo: 2499,  standard: 4999,  multi: 12499,  academy: 7499 },
  BDT: { solo: 999,   standard: 1999,  multi: 4999,   academy: 2999 },
  LKR: { solo: 2999,  standard: 5999,  multi: 14999,  academy: 8999 },
  NPR: { solo: 999,   standard: 1999,  multi: 4999,   academy: 2999 },
  NGN: { solo: 9999,  standard: 19999, multi: 49999,  academy: 29999 },
  KES: { solo: 1499,  standard: 2999,  multi: 7499,   academy: 4499 },
  GHS: { solo: 149,   standard: 299,   multi: 749,    academy: 449 },
  ZAR: { solo: 249,   standard: 499,   multi: 1299,   academy: 749 },
  EGP: { solo: 499,   standard: 999,   multi: 2499,   academy: 1499 },
  TRY: { solo: 599,   standard: 1199,  multi: 2999,   academy: 1799 },
  BRL: { solo: 79,    standard: 159,   multi: 399,    academy: 239 },
  MXN: { solo: 299,   standard: 599,   multi: 1499,   academy: 899 },
  COP: { solo: 59000, standard: 119000, multi: 299000, academy: 179000 },
  CLP: { solo: 14900, standard: 29900, multi: 74900,  academy: 44900 },
};
export const YEARLY_MONTHS = 10;
/** Extra branch on Chain, per month, as a share of the Salon Pro monthly price. */
export const EXTRA_BRANCH_SHARE = 0.75;

const roundMoney = (n: number) => Math.round(n * 100) / 100;

/** Prices for one currency (falls back to USD). Lifetime = 2 × yearly (legacy keys only). */
export function pricesFor(currency = 'INR'): Record<PlanId, Record<Billing, number>> {
  const book = MONTHLY_PRICE_BOOK[currency] || MONTHLY_PRICE_BOOK.USD;
  const out = {} as Record<PlanId, Record<Billing, number>>;
  (Object.keys(book) as PlanId[]).forEach(id => {
    const m = book[id];
    const y = roundMoney(m * YEARLY_MONTHS);
    out[id] = { monthly: m, yearly: y, lifetime: roundMoney(y * 2) };
  });
  return out;
}
export const currencyOfPrices = (currency: string) => (MONTHLY_PRICE_BOOK[currency] ? currency : 'USD');

/** INR table — what the key tools and the price tests read. */
export const PRICES: Record<PlanId, Record<Billing, number>> = pricesFor('INR');

export function priceOf(plan: PlanId, billing: Billing, currency = 'INR'): number {
  return pricesFor(currency)[plan]?.[billing] ?? LICENSE_PLANS[plan].price;
}
/** Yearly saving vs paying monthly (≈17% — two months free). */
export function yearlySavingPct(plan: PlanId, currency = 'INR'): number {
  const p = pricesFor(currency)[plan];
  return Math.round((1 - p.yearly / (p.monthly * 12)) * 100);
}
/** Months of monthly payments after which yearly is cheaper. */
export function breakEvenMonths(plan: PlanId, currency = 'INR'): number {
  const p = pricesFor(currency)[plan];
  return Math.ceil(p.yearly / p.monthly);
}
export function perMonthOfYearly(plan: PlanId, currency = 'INR'): number {
  return roundMoney(pricesFor(currency)[plan].yearly / 12);
}

type OnlineResult = {
  reached: boolean;
  valid: boolean;
  plan: string;
  expiry: string;
  message: string;
  error: string;
  devicesUsed?: number;
  maxDevices?: number;
};

