/**
 * Money maths in integer paise.
 *
 * Every rupee figure that is stored, compared or split goes through here.
 * Floating point rupees drift (0.1 + 0.2 !== 0.3, 1.005 * 100 = 100.4999…), and
 * on a GST invoice a one-paisa drift between CGST + SGST and the tax total is
 * exactly the kind of thing a CA flags. So: convert to whole paise, do integer
 * maths, convert back once at the end.
 *
 * PURE MODULE — no React Native / Expo imports, so `node --test` can load it
 * directly (see tests/money.logic.test.mjs). Keep it that way.
 */

/** Rupees → whole paise, rounding half away from zero (₹1.005 → 101 paise). */
export function toPaise(rupees: number | string | null | undefined): number {
  const n = Number(rupees);
  if (!Number.isFinite(n)) return 0;
  // toPrecision(12) strips binary noise such as 100.49999999999999 → 100.5.
  const scaled = parseFloat((Math.abs(n) * 100).toPrecision(12));
  const p = Math.round(scaled);
  return n < 0 ? -p : p;
}

/** Whole paise → rupees. */
export function fromPaise(paise: number): number {
  return Math.round(paise) / 100;
}

/** Round a rupee amount to 2 decimals the same way an invoice does. */
export function round2(rupees: number | string | null | undefined): number {
  return fromPaise(toPaise(rupees));
}

/** Exact sum of rupee amounts (summed in paise). */
export function addMoney(...amounts: (number | string | null | undefined)[]): number {
  return fromPaise(amounts.reduce<number>((s, a) => s + toPaise(a), 0));
}

/** a - b, exact. */
export function subMoney(a: number, b: number): number {
  return fromPaise(toPaise(a) - toPaise(b));
}

/** True when two rupee amounts differ by no more than `tolerance` rupees. */
export function moneyClose(a: number, b: number, tolerance = 0.009): boolean {
  return Math.abs(toPaise(a) - toPaise(b)) <= toPaise(tolerance);
}

// ── GST ─────────────────────────────────────────────────────────────────────

/**
 * Split a GST amount into CGST + SGST so that the two halves ALWAYS add back
 * to the tax total. The odd paisa (if any) goes to CGST.
 *   splitGst(10.01) → { cgst: 5.01, sgst: 5.00 }
 */
export function splitGst(tax: number): { cgst: number; sgst: number } {
  const t = toPaise(tax);
  const sign = t < 0 ? -1 : 1;
  const abs = Math.abs(t);
  const c = Math.ceil(abs / 2);
  return { cgst: fromPaise(sign * c), sgst: fromPaise(sign * (abs - c)) };
}

/** GST on a tax-exclusive taxable value: 1000 @ 5% → 50. */
export function gstOnExclusive(taxable: number, ratePct: number): number {
  return fromPaise(Math.round((toPaise(taxable) * (Number(ratePct) || 0)) / 100));
}

/**
 * Pull the GST back out of a tax-INCLUSIVE price:
 *   1050 incl. 5% → { taxable: 1000, tax: 50 }
 * taxable + tax always equals the gross exactly.
 */
export function gstFromInclusive(gross: number, ratePct: number): { taxable: number; tax: number } {
  const g = toPaise(gross);
  const r = Number(ratePct) || 0;
  const taxableP = Math.round((g * 100) / (100 + r));
  return { taxable: fromPaise(taxableP), tax: fromPaise(g - taxableP) };
}

/**
 * The figures a GST invoice prints for one bill.
 * Convention used by the app:
 *  - prices exclusive (default): taxable = subtotal − discount; total = taxable + tax − loyalty
 *  - prices inclusive:           subtotal already contains GST; taxable = subtotal − discount − tax
 */
export function invoiceTaxBreakup(bill: {
  subtotal?: number; discount_amount?: number; tax_amount?: number; prices_include_gst?: number | boolean;
  loyalty_discount?: number; ledger?: unknown;
}): { taxable: number; tax: number; cgst: number; sgst: number; loyaltyBeforeTax: boolean } {
  const sub = toPaise(bill.subtotal);
  const disc = toPaise(bill.discount_amount);
  const tax = toPaise(bill.tax_amount);
  const { cgst, sgst } = splitGst(fromPaise(tax));
  // v5.6+ bills take loyalty off BEFORE tax and record their taxable value in
  // the ledger (credit notes carry it negated). Older bills took loyalty off
  // after tax, so their taxable value is subtotal − discount (− tax if inclusive).
  const ledger = parseSplit(bill.ledger);
  const stored = (ledger as any).taxable;
  if (stored !== undefined && stored !== null && Number.isFinite(Number(stored))) {
    return { taxable: round2(stored), tax: fromPaise(tax), cgst, sgst, loyaltyBeforeTax: true };
  }
  const taxableP = bill.prices_include_gst ? sub - disc - tax : sub - disc;
  return { taxable: fromPaise(taxableP), tax: fromPaise(tax), cgst, sgst, loyaltyBeforeTax: false };
}

/**
 * Taxable value of a NEW bill (v5.6 convention: discount and loyalty come off
 * before tax). Sign follows the subtotal, so it also works for credit notes.
 */
export function billTaxableValue(b: {
  subtotal?: number; discount_amount?: number; loyalty_discount?: number; tax_amount?: number; prices_include_gst?: number | boolean;
}): number {
  const sign = toPaise(b.subtotal) < 0 ? -1 : 1;
  const base = Math.max(0, Math.abs(toPaise(b.subtotal)) - Math.abs(toPaise(b.discount_amount)) - Math.abs(toPaise(b.loyalty_discount)));
  const t = b.prices_include_gst ? base - Math.abs(toPaise(b.tax_amount)) : base;
  return fromPaise(sign * Math.max(0, t));
}

/**
 * The total a bill must come to, given its parts. createBill rejects a bill
 * whose total is more than ₹1 away from this — a screen bug must never be able
 * to write an invoice whose lines do not add up.
 */
export function expectedBillTotal(b: {
  subtotal: number; discount_amount?: number; tax_amount?: number; loyalty_discount?: number; prices_include_gst?: boolean | number;
}): number {
  const base = Math.max(0, toPaise(b.subtotal) - toPaise(b.discount_amount));
  const withTax = b.prices_include_gst ? base : base + toPaise(b.tax_amount);
  return fromPaise(Math.max(0, withTax - toPaise(b.loyalty_discount)));
}

// ── Loyalty ─────────────────────────────────────────────────────────────────

/** Points for an amount actually PAID: N points per full ₹100. */
export function loyaltyPointsFor(amountPaid: number, pointsPer100: number): number {
  const p = toPaise(amountPaid);
  if (p <= 0) return 0;
  return Math.floor(p / 10000) * Math.max(0, Math.floor(Number(pointsPer100) || 0));
}

// ── Payments ────────────────────────────────────────────────────────────────

export type PayKey = 'cash' | 'upi' | 'card' | 'wallet' | 'advance';
export const PAY_KEYS: PayKey[] = ['cash', 'upi', 'card', 'wallet', 'advance'];
export type PayParts = Record<PayKey, number>;

const zeroParts = (): PayParts => ({ cash: 0, upi: 0, card: 0, wallet: 0, advance: 0 });

function parseSplit(split: unknown): Record<string, unknown> {
  if (!split) return {};
  if (typeof split === 'string') {
    try { const o = JSON.parse(split); return o && typeof o === 'object' ? o : {}; } catch { return {}; }
  }
  return typeof split === 'object' ? (split as Record<string, unknown>) : {};
}

/**
 * How a stored bill was actually paid, by channel, in rupees.
 *
 * Rule ("explicit split wins"): when the bill is a split / pay-later bill, or
 * its payment_split names any channel, the split is the truth. Otherwise the
 * whole total went through payment_method. This reads every bill ever written:
 *   cash bill, split {}             → { cash: total }
 *   split bill {cash:200,upi:300}   → { cash:200, upi:300 }
 *   pay-later {cash:100}            → { cash:100 }   (the rest is amount_due)
 *   v5.6 {cash:400, wallet:100}     → { cash:400, wallet:100 }
 * Credit notes (negative total) come out negative.
 */
export function paymentParts(bill: { payment_method?: string; payment_split?: unknown; total?: number }): PayParts {
  const out = zeroParts();
  const method = String(bill.payment_method || 'cash').toLowerCase();
  const split = parseSplit(bill.payment_split);
  const total = toPaise(bill.total);
  const sign = total < 0 ? -1 : 1;
  const explicit = method === 'split' || method === 'due' || PAY_KEYS.some(k => toPaise(split[k] as number) !== 0);
  if (explicit) {
    for (const k of PAY_KEYS) out[k] = fromPaise(sign * Math.abs(toPaise(split[k] as number)));
    return out;
  }
  if ((PAY_KEYS as string[]).includes(method)) out[method as PayKey] = fromPaise(total);
  return out;
}

export interface PaymentAllocation {
  parts: PayParts;
  paidNow: number;
  amountDue: number;
  /** What to store in bills.payment_split. */
  storedSplit: Record<string, number>;
}

/**
 * Work out, and validate, how a NEW bill is paid. Throws an Error with a
 * message a salon owner can act on when the numbers do not work.
 */
export function allocatePayment(p: {
  method: string; split?: Record<string, unknown> | null; total: number; wallet?: number; advance?: number;
}): PaymentAllocation {
  const method = String(p.method || 'cash').toLowerCase();
  const split = parseSplit(p.split);
  const total = toPaise(p.total);
  const wallet = toPaise(p.wallet);
  const advance = toPaise(p.advance);
  if (total < 0) throw new Error('A bill total cannot be negative.');
  if (wallet < 0 || advance < 0) throw new Error('Wallet and advance amounts cannot be negative.');
  if (wallet + advance > total) {
    throw new Error(`Wallet + advance (${fromPaise(wallet + advance)}) is more than the bill total (${fromPaise(total)}).`);
  }
  const parts = zeroParts();
  parts.wallet = fromPaise(wallet);
  parts.advance = fromPaise(advance);
  let paidNowP: number;

  if (method === 'due') {
    for (const k of ['cash', 'upi', 'card'] as PayKey[]) {
      const v = toPaise(split[k] as number);
      if (v < 0) throw new Error('Advance amounts cannot be negative.');
      parts[k] = fromPaise(v);
    }
    paidNowP = toPaise(parts.cash) + toPaise(parts.upi) + toPaise(parts.card) + wallet + advance;
    if (paidNowP > total) throw new Error('Amount paid now cannot be more than the bill total.');
  } else if (method === 'split') {
    for (const k of ['cash', 'upi', 'card'] as PayKey[]) {
      const v = toPaise(split[k] as number);
      if (v < 0) throw new Error('Split amounts cannot be negative.');
      parts[k] = fromPaise(v);
    }
    const sum = toPaise(parts.cash) + toPaise(parts.upi) + toPaise(parts.card) + wallet + advance;
    // Same ₹1 tolerance the billing screen allows for rounding.
    if (Math.abs(sum - total) > 100) {
      throw new Error(`Split amounts (${fromPaise(sum)}) must add up to the bill total (${fromPaise(total)}).`);
    }
    paidNowP = total;
  } else if (method === 'wallet') {
    if (wallet + advance < total) {
      throw new Error(`Wallet covers only ${fromPaise(wallet + advance)} of ${fromPaise(total)}. Pick another method for the rest.`);
    }
    paidNowP = total;
  } else {
    const key: PayKey = (['cash', 'upi', 'card'] as string[]).includes(method) ? (method as PayKey) : 'cash';
    parts[key] = fromPaise(toPaise(parts[key]) + total - wallet - advance);
    paidNowP = total;
  }

  const amountDueP = Math.max(0, total - paidNowP);
  // Keep exactly what older versions stored when nothing new is involved, so
  // existing reports read these bills unchanged.
  let storedSplit: Record<string, number>;
  if (wallet > 0 || advance > 0 || method === 'wallet') {
    storedSplit = {};
    for (const k of PAY_KEYS) if (toPaise(parts[k]) !== 0) storedSplit[k] = parts[k];
  } else if (method === 'split') {
    storedSplit = { cash: parts.cash, upi: parts.upi, card: parts.card };
  } else if (method === 'due') {
    storedSplit = {};
    for (const k of ['cash', 'upi', 'card'] as PayKey[]) if (toPaise(parts[k]) !== 0) storedSplit[k] = parts[k];
  } else {
    storedSplit = {};
  }
  return { parts, paidNow: fromPaise(paidNowP), amountDue: fromPaise(amountDueP), storedSplit };
}

// ── Billing screen maths (shared with tests) ────────────────────────────────

/**
 * The bill totals the billing screen shows AND sends to createBill.
 *  • discount and loyalty both come off BEFORE tax (taxable = gross − discount − loyalty)
 *  • when prices include GST, tax is carved out of the net: taxable = net/(1+r)
 * `discountValue` / `pointsToRedeem` are already-parsed numbers (NaN → 0).
 * Package-covered lines carry price 0, so they add nothing to `gross`.
 */
export function computeBillTotals(p: {
  items: { price?: number; qty?: number }[]; discountType: 'flat' | 'percent'; discountValue: number; applyGST: boolean;
  ratePct: number; inclusive: boolean; clientPoints: number; redeem: boolean; pointsToRedeem: number;
}): { gross: number; discAmt: number; maxRedeem: number; loyaltyAmt: number; taxable: number; taxAmt: number; total: number } {
  const grossP = (p.items || []).reduce((s, i) => s + Math.round(toPaise(Number(i.price) || 0) * (Number(i.qty) || 1)), 0);
  const gross = fromPaise(grossP);
  const disc = Number.isFinite(Number(p.discountValue)) ? Math.max(0, Number(p.discountValue)) : 0;
  const discP = p.discountType === 'percent'
    ? Math.round((grossP * Math.min(disc, 100)) / 100)
    : Math.min(toPaise(disc), grossP);
  const afterDiscP = Math.max(0, grossP - discP);
  const maxRedeem = Math.max(0, Math.min(Math.floor(Number(p.clientPoints) || 0), Math.floor(afterDiscP / 100)));
  const pts = Math.max(0, Math.floor(Number(p.pointsToRedeem) || 0));
  const loyaltyAmt = p.redeem ? Math.min(pts, maxRedeem) : 0;
  const netP = Math.max(0, afterDiscP - loyaltyAmt * 100);
  const r = p.applyGST ? Math.max(0, Number(p.ratePct) || 0) : 0;
  let taxableP: number, taxP: number, totalP: number;
  if (!r) { taxableP = netP; taxP = 0; totalP = netP; }
  else if (p.inclusive) { const g = gstFromInclusive(fromPaise(netP), r); taxableP = toPaise(g.taxable); taxP = toPaise(g.tax); totalP = netP; }
  else { taxableP = netP; taxP = toPaise(gstOnExclusive(fromPaise(netP), r)); totalP = netP + taxP; }
  return {
    gross, discAmt: fromPaise(discP), maxRedeem, loyaltyAmt,
    taxable: fromPaise(taxableP), taxAmt: fromPaise(taxP), total: fromPaise(totalP),
  };
}

/**
 * How the billing screen splits a bill's total between the appointment
 * advance, the client's wallet and the method picked at the counter — and the
 * exact payment fields it sends to createBill (which re-validates them with
 * allocatePayment).
 *   walletRequested: null = field left empty (use the most the wallet can
 *   cover), NaN = not a number (walletInvalid).
 */
export function planBillPayment(p: {
  total: number; appointmentId?: number; aptAdvance?: number;
  walletBal?: number; useWallet?: boolean; walletRequested?: number | null;
  method: string; split?: number[]; dueCashNow?: number;
}): {
  advanceUsed: number; walletMax: number; walletUsed: number; walletInvalid: boolean; toCollect: number;
  coveredFully: boolean; usedMethod: string; splitData: Record<string, number>; dueAmount: number;
} {
  const totalP = Math.max(0, toPaise(p.total));
  const advP = p.appointmentId ? Math.min(Math.max(0, toPaise(p.aptAdvance)), totalP) : 0;
  const walletMaxP = Math.max(0, Math.min(toPaise(p.walletBal), totalP - advP));
  const req = p.walletRequested;
  const walletInvalid = !!p.useWallet && req !== null && req !== undefined && !Number.isFinite(Number(req));
  let walletP = 0;
  if (p.useWallet && !walletInvalid) {
    const want = req === null || req === undefined ? walletMaxP : toPaise(req);
    walletP = Math.max(0, Math.min(want, walletMaxP));
  }
  const collectP = Math.max(0, totalP - advP - walletP);
  const coveredFully = collectP === 0 && (walletP > 0 || advP > 0);
  const usedMethod = coveredFully ? 'wallet' : String(p.method || 'cash');
  let splitData: Record<string, number> = {};
  let dueP = 0;
  if (usedMethod === 'split') {
    const s = p.split || [];
    splitData = { cash: fromPaise(Math.max(0, toPaise(s[0]))), upi: fromPaise(Math.max(0, toPaise(s[1]))), card: fromPaise(Math.max(0, toPaise(s[2]))) };
  } else if (usedMethod === 'due') {
    // Never send more "paid now" than is left to collect (createBill refuses it).
    const nowP = Math.min(Math.max(0, toPaise(p.dueCashNow)), collectP);
    splitData = { cash: fromPaise(nowP) };
    dueP = collectP - nowP;
  }
  return {
    advanceUsed: fromPaise(advP), walletMax: fromPaise(walletMaxP), walletUsed: fromPaise(walletP), walletInvalid,
    toCollect: fromPaise(collectP), coveredFully, usedMethod, splitData, dueAmount: fromPaise(dueP),
  };
}

// ── Cash tally (day close) ──────────────────────────────────────────────────

export interface TallyInput {
  opening: number;
  /** Every bill CREATED that day, including ones later cancelled, plus credit notes issued that day. */
  bills: { payment_method?: string; payment_split?: unknown; total?: number; payment_status?: string }[];
  /** Pay-later money collected that day. */
  duePayments: { amount: number; method?: string }[];
  /** Wallet top-ups (kind 'topup' only — bonus credit is not money received). */
  walletTopups: { amount: number; method?: string }[];
  /** Appointment advances taken that day. */
  advances: { amount: number; method?: string }[];
  expenses: { amount: number; payment_method?: string }[];
}

export interface CashTally {
  opening_cash: number;
  cash_sales: number;
  cash_refunds: number;
  cash_dues: number;
  wallet_topups_cash: number;
  advances_cash: number;
  cash_expenses: number;
  expected_cash: number;
  /** All money received that day by channel (sales + dues + top-ups + advances, minus refunds). */
  received: { cash: number; upi: number; card: number };
  /** Non-cash settlement used on bills that day (info only). */
  wallet_spent: number;
  advance_adjusted: number;
}

const isCash = (m?: string) => !m || String(m).toLowerCase() === 'cash';

/**
 * Expected cash in the drawer for one day:
 *   opening + cash part of bills (incl. cash part of split / pay-later)
 *   − cash refunded on credit notes + cash dues collected + cash wallet top-ups
 *   + cash appointment advances − cash expenses
 * Wallet spend and adjusted advances are NOT cash — that money came in earlier.
 */
export function computeCashTally(input: TallyInput): CashTally {
  let salesP = 0, refundsP = 0, walletSpentP = 0, advAdjP = 0;
  const rec = { cash: 0, upi: 0, card: 0 };
  for (const b of input.bills || []) {
    const parts = paymentParts(b);
    const cash = toPaise(parts.cash);
    if (b.payment_status === 'credit_note' || toPaise(b.total) < 0) refundsP += -cash;
    else salesP += cash;
    rec.cash += cash; rec.upi += toPaise(parts.upi); rec.card += toPaise(parts.card);
    walletSpentP += toPaise(parts.wallet);
    advAdjP += toPaise(parts.advance);
  }
  const byMethod = (rows: { amount: number; method?: string; payment_method?: string }[]) => {
    let cash = 0;
    for (const r of rows || []) {
      const m = String(r.method ?? r.payment_method ?? 'cash').toLowerCase();
      const a = toPaise(r.amount);
      if (isCash(m)) cash += a;
      if (m === 'cash' || m === 'upi' || m === 'card') rec[m] += a;
    }
    return cash;
  };
  const duesP = byMethod(input.duePayments);
  const topupsP = byMethod(input.walletTopups);
  const advP = byMethod(input.advances);
  let expP = 0;
  for (const e of input.expenses || []) if (isCash(e.payment_method)) expP += toPaise(e.amount);
  const openingP = toPaise(input.opening);
  const expectedP = openingP + salesP - refundsP + duesP + topupsP + advP - expP;
  return {
    opening_cash: fromPaise(openingP),
    cash_sales: fromPaise(salesP),
    cash_refunds: fromPaise(refundsP),
    cash_dues: fromPaise(duesP),
    wallet_topups_cash: fromPaise(topupsP),
    advances_cash: fromPaise(advP),
    cash_expenses: fromPaise(expP),
    expected_cash: fromPaise(expectedP),
    received: { cash: fromPaise(rec.cash), upi: fromPaise(rec.upi), card: fromPaise(rec.card) },
    wallet_spent: fromPaise(walletSpentP),
    advance_adjusted: fromPaise(advAdjP),
  };
}
