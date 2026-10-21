/** Pure module (tested straight from Node): reads the salon's region from the
 *  global that src/config/regions.ts keeps up to date, with India as fallback. */
const regionLocale_ = (): string => (globalThis as any).__sbxRegion?.locale || 'en-IN';
const regionSym_ = (): string => (globalThis as any).__sbxRegion?.symbol || '₹';
/**
 * Boss AI — on-device analytics.
 *
 * Everything here is plain arithmetic over the salon's own bills: no network,
 * no model download, no API key, no per-use cost. It runs in a few
 * milliseconds on a cheap Android phone and works in airplane mode.
 *
 * This file must stay free of React Native imports so `npm test` can run it in
 * plain Node (tests/ai.test.mjs).
 */

export interface DayRow { date: string; revenue: number; bills?: number }
export interface BillLite { id?: number; client_id?: number; staff_id?: number; items: { name: string; type?: string; qty?: number; price?: number }[]; created_at?: string; total?: number }
export interface VisitDay { client_id: number; d: string; spent?: number }
export interface ClientLite { id: number; name: string; phone?: string; total_visits?: number; total_spent?: number; last_visit?: string; is_blacklisted?: number }

// ── date helpers (local, string based — no timezone traps) ─────────────────
export const ymd = (d: Date): string => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
export const parseYmd = (s: string): Date => {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};
export const addDays = (s: string, n: number): string => {
  const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d);
};
export const diffDays = (a: string, b: string): number =>
  Math.round((parseYmd(b).getTime() - parseYmd(a).getTime()) / 86400000);

const median = (xs: number[]): number => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round = (n: number) => Math.round(n);

// ═══ 1. REVENUE FORECAST ════════════════════════════════════════════════════
export interface Forecast {
  mtd: number;
  projected: number;
  low: number;
  high: number;
  daysLeft: number;
  avgDaily: number;
  weekdayAvg: number[];      // index 0 = Sunday
  trendPct: number;          // last 4 weeks vs the 4 before, damped
  confidence: 'low' | 'medium' | 'high';
  historyDays: number;
  target?: number;
  neededPerDay?: number;
  onTrack?: boolean;
  closedWeekdays: number[];  // weekdays with no sales in the history window
}

/**
 * Month-end projection. Uses a weekday profile (Sunday rush vs Tuesday lull)
 * from up to 8 weeks of history, with missing days counted as zero so a
 * weekly closing day is learnt rather than averaged away, nudged by the recent
 * trend. Today's own takings are taken as-is plus the expected remainder.
 */
export function forecastMonth(rows: DayRow[], today: string, target = 0, hourNow = 15): Forecast {
  const byDate = new Map<string, number>();
  for (const r of rows) byDate.set(String(r.date).slice(0, 10), (byDate.get(String(r.date).slice(0, 10)) || 0) + (Number(r.revenue) || 0));

  const dates = [...byDate.keys()].filter(d => d < today).sort();
  const first = dates[0];
  const windowStart = first ? (diffDays(first, today) > 56 ? addDays(today, -56) : first) : today;
  const historyDays = first ? diffDays(first, today) : 0;

  const sums = [0, 0, 0, 0, 0, 0, 0], counts = [0, 0, 0, 0, 0, 0, 0], open = [0, 0, 0, 0, 0, 0, 0];
  for (let d = windowStart; d < today; d = addDays(d, 1)) {
    const dow = parseYmd(d).getDay();
    const v = byDate.get(d) || 0;
    sums[dow] += v; counts[dow] += 1; if (v > 0) open[dow] += 1;
  }
  const totalDays = counts.reduce((a, b) => a + b, 0);
  const totalRev = sums.reduce((a, b) => a + b, 0);
  const avgDaily = totalDays ? totalRev / totalDays : 0;
  const weekdayAvg = sums.map((s, i) => (counts[i] >= 2 ? s / counts[i] : avgDaily));
  const closedWeekdays = counts.map((n, i) => (n >= 3 && open[i] === 0 ? i : -1)).filter(i => i >= 0);

  // Trend: last 28 days vs the 28 before.
  let last = 0, prev = 0;
  for (const [d, v] of byDate) {
    const age = diffDays(d, today);
    if (age >= 1 && age <= 28) last += v; else if (age > 28 && age <= 56) prev += v;
  }
  const rawTrend = prev > 0 ? (last - prev) / prev : 0;
  const trend = clamp(rawTrend, -0.3, 0.3) * 0.5; // damped

  const t = parseYmd(today);
  const monthStart = ymd(new Date(t.getFullYear(), t.getMonth(), 1));
  const monthEnd = ymd(new Date(t.getFullYear(), t.getMonth() + 1, 0));
  let mtd = 0;
  for (const [d, v] of byDate) if (d >= monthStart && d <= today) mtd += v;

  const todaySoFar = byDate.get(today) || 0;
  const remainFrac = clamp((21 - hourNow) / 11, 0, 1);
  let expected = Math.max(0, weekdayAvg[t.getDay()] * (1 + trend) - todaySoFar) * remainFrac;
  const daysLeft = diffDays(today, monthEnd);
  for (let d = addDays(today, 1); d <= monthEnd; d = addDays(d, 1)) {
    expected += weekdayAvg[parseYmd(d).getDay()] * (1 + trend);
  }
  const projected = mtd + expected;
  const confidence: Forecast['confidence'] = historyDays < 14 ? 'low' : historyDays < 45 ? 'medium' : 'high';
  const spread = confidence === 'high' ? 0.08 : confidence === 'medium' ? 0.15 : 0.3;

  const out: Forecast = {
    mtd: round(mtd), projected: round(projected),
    low: round(mtd + expected * (1 - spread)), high: round(mtd + expected * (1 + spread)),
    daysLeft, avgDaily: round(avgDaily), weekdayAvg: weekdayAvg.map(round),
    trendPct: Math.round(rawTrend * 100), confidence, historyDays, closedWeekdays,
  };
  if (target > 0) {
    out.target = target;
    out.onTrack = projected >= target;
    const openDaysLeft = (() => {
      let n = 0;
      for (let d = addDays(today, 1); d <= monthEnd; d = addDays(d, 1)) if (!closedWeekdays.includes(parseYmd(d).getDay())) n++;
      return Math.max(1, n + (remainFrac > 0.2 ? 1 : 0));
    })();
    out.neededPerDay = round(Math.max(0, target - mtd) / openDaysLeft);
  }
  return out;
}

// ═══ 2. "CUSTOMERS WHO TOOK X ALSO TOOK Y" ══════════════════════════════════
export interface Basket { n: number; item: Map<string, number>; pair: Map<string, Map<string, number>>; display: Map<string, string> }

const norm = (s: string) => String(s || '').trim().toLowerCase();

export function buildBasket(bills: BillLite[]): Basket {
  const item = new Map<string, number>();
  const pair = new Map<string, Map<string, number>>();
  const display = new Map<string, string>();
  let n = 0;
  for (const b of bills) {
    const names = [...new Set((b.items || []).map(i => { const k = norm(i.name); if (k && !display.has(k)) display.set(k, String(i.name).trim()); return k; }).filter(Boolean))];
    if (!names.length) continue;
    n++;
    for (const a of names) {
      item.set(a, (item.get(a) || 0) + 1);
      for (const c of names) {
        if (a === c) continue;
        let m = pair.get(a); if (!m) { m = new Map(); pair.set(a, m); }
        m.set(c, (m.get(c) || 0) + 1);
      }
    }
  }
  return { n, item, pair, display };
}

export interface Suggestion { name: string; confidence: number; lift: number; because?: string; reason: string }

/**
 * Up to `max` add-on suggestions for the items already on a bill. A pairing
 * needs at least `minSupport` bills behind it, so one odd combination never
 * becomes a "suggestion". With an empty bill it falls back to best sellers.
 */
export function suggestUpsell(current: string[], basket: Basket, opts: { max?: number; minSupport?: number; minConfidence?: number; allowed?: string[] } = {}): Suggestion[] {
  const max = opts.max ?? 3, minSupport = opts.minSupport ?? 3, minConf = opts.minConfidence ?? 0.12;
  const allowed = opts.allowed ? new Set(opts.allowed.map(norm)) : null;
  const have = new Set(current.map(norm));
  const best = new Map<string, Suggestion>();

  if (have.size === 0) {
    return [...basket.item.entries()]
      .filter(([k]) => !allowed || allowed.has(k))
      .sort((a, b) => b[1] - a[1]).slice(0, max)
      .map(([k, v]) => ({ name: basket.display.get(k) || k, confidence: basket.n ? v / basket.n : 0, lift: 1, reason: `Best seller — on ${Math.round((v / Math.max(1, basket.n)) * 100)}% of bills` }));
  }
  for (const a of have) {
    const ca = basket.item.get(a) || 0;
    const m = basket.pair.get(a);
    if (!m || ca < minSupport) continue;
    for (const [b, cab] of m) {
      if (have.has(b) || cab < minSupport) continue;
      if (allowed && !allowed.has(b)) continue;
      const conf = cab / ca;
      if (conf < minConf) continue;
      const base = (basket.item.get(b) || 0) / Math.max(1, basket.n);
      const lift = base > 0 ? conf / base : 1;
      const prev = best.get(b);
      if (!prev || conf > prev.confidence) {
        const A = basket.display.get(a) || a, B = basket.display.get(b) || b;
        best.set(b, { name: B, confidence: conf, lift, because: A, reason: `${Math.round(conf * 100)}% of ${A} clients also take ${B}` });
      }
    }
  }
  return [...best.values()].sort((x, y) => y.confidence * Math.min(y.lift, 3) - x.confidence * Math.min(x.lift, 3)).slice(0, max);
}

// ═══ 3. CLIENT RHYTHM — WHO IS DUE BACK ═════════════════════════════════════
export interface Rhythm { client_id: number; visits: number; lastVisit: string; gap: number; nextDue: string; overdue: number; spent: number; personalGap: boolean }

/** Median gap between each client's visits; one-visit clients borrow the salon-wide median. */
export function clientRhythm(days: VisitDay[], today: string): { list: Rhythm[]; salonGap: number } {
  const by = new Map<number, { d: string; spent: number }[]>();
  for (const v of days) {
    if (!v.client_id) continue;
    const arr = by.get(v.client_id) || []; arr.push({ d: String(v.d).slice(0, 10), spent: Number(v.spent) || 0 }); by.set(v.client_id, arr);
  }
  const allGaps: number[] = [];
  const perClient = new Map<number, number[]>();
  for (const [id, arr] of by) {
    arr.sort((a, b) => (a.d < b.d ? -1 : 1));
    const gaps: number[] = [];
    for (let i = 1; i < arr.length; i++) { const g = diffDays(arr[i - 1].d, arr[i].d); if (g >= 3) gaps.push(g); }
    perClient.set(id, gaps); allGaps.push(...gaps);
  }
  const salonGap = Math.round(clamp(isNaN(median(allGaps)) ? 35 : median(allGaps), 10, 120));
  const list: Rhythm[] = [];
  for (const [id, arr] of by) {
    const gaps = perClient.get(id) || [];
    const personal = gaps.length >= 1;
    const gap = Math.round(clamp(personal ? median(gaps) : salonGap, 7, 180));
    const lastVisit = arr[arr.length - 1].d;
    const nextDue = addDays(lastVisit, gap);
    list.push({ client_id: id, visits: arr.length, lastVisit, gap, nextDue, overdue: diffDays(nextDue, today), spent: arr.reduce((s, x) => s + x.spent, 0), personalGap: personal });
  }
  return { list, salonGap };
}

/** Clients whose usual gap says they should be back within the next `withinDays` (or are a little late). */
export function dueSoon(r: Rhythm[], withinDays = 7, graceLate = 21): Rhythm[] {
  return r.filter(x => x.overdue >= -withinDays && x.overdue <= graceLate)
    .sort((a, b) => b.spent - a.spent);
}

// ═══ 4. SEGMENTS (RFM, salon-flavoured) ══════════════════════════════════════
export type Segment = 'champion' | 'loyal' | 'new' | 'regular' | 'at_risk' | 'lost';
export const SEGMENT_INFO: Record<Segment, { label: string; hint: string; action: string }> = {
  champion: { label: 'Champions', hint: 'Frequent, recent, high spenders', action: 'Thank them, offer a membership or referral reward' },
  loyal:    { label: 'Loyal',     hint: 'Come back regularly',             action: 'Upsell a package or premium service' },
  new:      { label: 'New',       hint: 'First visit in the last 45 days', action: 'Second-visit offer within 3 weeks' },
  regular:  { label: 'Regular',   hint: 'Steady, nothing unusual',          action: 'Normal reminders' },
  at_risk:  { label: 'At risk',   hint: 'Later than their usual gap',      action: 'Personal WhatsApp with a small offer — now' },
  lost:     { label: 'Lost',      hint: 'Not seen for a long time',        action: 'Win-back campaign with a strong offer' },
};

export function segmentClients(clients: ClientLite[], rhythm: Rhythm[], today: string, salonGap = 35): Map<number, Segment> {
  const rm = new Map(rhythm.map(r => [r.client_id, r]));
  const spends = clients.map(c => Number(c.total_spent) || 0).filter(v => v > 0).sort((a, b) => b - a);
  const top20 = spends.length ? spends[Math.max(0, Math.floor(spends.length * 0.2) - 1)] : Infinity;
  const out = new Map<number, Segment>();
  for (const c of clients) {
    const r = rm.get(c.id);
    const visits = r?.visits ?? (Number(c.total_visits) || 0);
    const last = r?.lastVisit || String(c.last_visit || '').slice(0, 10);
    if (!last || visits === 0) continue;
    const since = diffDays(last, today);
    const gap = r?.gap || salonGap;
    const spent = Number(c.total_spent) || r?.spent || 0;
    let seg: Segment;
    if (since > Math.max(3 * gap, 120)) seg = 'lost';
    else if (visits >= 2 && since > Math.max(1.5 * gap, 30)) seg = 'at_risk';
    else if (visits === 1 && since <= 45) seg = 'new';
    else if (visits >= 5 && spent >= top20 && since <= Math.max(1.5 * gap, 45)) seg = 'champion';
    else if (visits >= 3 && since <= 1.5 * gap) seg = 'loyal';
    else seg = 'regular';
    out.set(c.id, seg);
  }
  return out;
}

// ═══ 5. LEAKAGE GUARD — discounts, cancellations, missing customer data ═════
export interface Alert { id: string; severity: 'high' | 'medium' | 'info'; title: string; detail: string }

export function leakageAlerts(input: {
  discounts: { staff_id: number; staff_name?: string; bills: number; discounted: number; discount: number; gross: number }[];
  voids: { staff_id: number; staff_name?: string; voids: number; amount: number }[];
  walkinShare?: number; totalBills?: number; sym?: string;
}): Alert[] {
  const sym = input.sym || regionSym_();
  const fmt = (n: number) => `${sym}${Math.round(n).toLocaleString(regionLocale_())}`;
  const alerts: Alert[] = [];
  const totalDisc = input.discounts.reduce((s, r) => s + (r.discount || 0), 0);
  const totalGross = input.discounts.reduce((s, r) => s + (r.gross || 0), 0);
  const teamRate = totalGross > 0 ? totalDisc / totalGross : 0;
  for (const r of input.discounts) {
    if (!r.gross || r.discounted < 3) continue;
    const rate = r.discount / r.gross;
    if (rate > Math.max(teamRate * 2, teamRate + 0.05) && rate > 0.06) {
      alerts.push({
        id: `disc_${r.staff_id}`, severity: rate > 0.15 ? 'high' : 'medium',
        title: `${r.staff_name || 'A staff member'} gives ${Math.round(rate * 100)}% discount`,
        detail: `Team average is ${Math.round(teamRate * 100)}%. ${fmt(r.discount)} given on ${r.discounted} bills in the last 30 days. Check if these were approved.`,
      });
    }
  }
  const totalBills = Math.max(1, input.totalBills || input.discounts.reduce((s, r) => s + (r.bills || 0), 0));
  for (const v of input.voids) {
    if (v.voids >= 3 || (v.voids >= 2 && v.voids / totalBills > 0.03)) {
      alerts.push({
        id: `void_${v.staff_id}`, severity: v.voids >= 5 ? 'high' : 'medium',
        title: `${v.voids} bills cancelled by ${v.staff_name || 'staff'}`,
        detail: `${fmt(v.amount)} cancelled in the last 30 days. Cancelled bills are a common way cash goes missing — review them in Bill History → Cancelled.`,
      });
    }
  }
  if ((input.walkinShare ?? 0) > 0.5 && totalBills >= 20) {
    alerts.push({
      id: 'walkins', severity: 'info',
      title: `${Math.round((input.walkinShare || 0) * 100)}% of bills have no customer`,
      detail: 'Without a name and phone you cannot send reminders, birthday wishes or offers. Ask for the mobile number at billing — it takes 5 seconds.',
    });
  }
  return alerts;
}

// ═══ 6. SEASONS & OCCASIONS (India) ══════════════════════════════════════════
export interface Occasion { date: string; name: string; idea: string }

const nthWeekday = (y: number, m: number, weekday: number, n: number) => {
  const d = new Date(y, m, 1);
  const shift = (weekday - d.getDay() + 7) % 7;
  return new Date(y, m, 1 + shift + (n - 1) * 7);
};

/**
 * Fixed and calculable dates only. Lunar festivals (Diwali, Holi, Eid, Karwa
 * Chauth…) move every year, so they are offered as a season in seasonFor()
 * instead of a date that could be wrong on a customer-facing poster.
 */
export function upcomingOccasions(today: string, within = 21): Occasion[] {
  const t = parseYmd(today);
  const out: Occasion[] = [];
  for (const y of [t.getFullYear(), t.getFullYear() + 1]) {
    const list: Occasion[] = [
      { date: ymd(new Date(y, 0, 1)), name: 'New Year', idea: 'New Year glow-up offers' },
      { date: ymd(new Date(y, 1, 14)), name: "Valentine's Day", idea: 'Couple spa / date-night makeover' },
      { date: ymd(new Date(y, 2, 8)), name: "Women's Day", idea: 'Ladies-only discount or free add-on' },
      { date: ymd(nthWeekday(y, 4, 0, 2)), name: "Mother's Day", idea: 'Mother-daughter combo package' },
      { date: ymd(nthWeekday(y, 5, 0, 3)), name: "Father's Day", idea: 'Grooming combo for dads' },
      { date: ymd(nthWeekday(y, 7, 0, 1)), name: 'Friendship Day', idea: 'Bring-a-friend: both get 15% off' },
      { date: ymd(new Date(y, 7, 15)), name: 'Independence Day', idea: 'Freedom sale on hair spa & facials' },
      { date: ymd(new Date(y, 11, 25)), name: 'Christmas', idea: 'Party-ready makeup & hair' },
      { date: ymd(new Date(y, 11, 31)), name: "New Year's Eve", idea: 'Party makeup slots — book early' },
    ];
    for (const o of list) { const dd = diffDays(today, o.date); if (dd >= 0 && dd <= within) out.push(o); }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function seasonFor(today: string): { title: string; ideas: string[] } {
  const m = parseYmd(today).getMonth();
  if (m === 9 || m === 10) return { title: 'Festive season (Navratri · Karwa Chauth · Diwali)', ideas: ['Pre-Diwali facial + mehendi combos', 'Karwa Chauth makeup slots — open bookings 2 weeks early', 'Festive hair colour offers', 'Gift vouchers for the season'] };
  if (m === 11 || m === 0 || m === 1) return { title: 'Wedding season', ideas: ['Bridal & pre-bridal packages', 'Family (mother / sister) makeup bundles', 'Groom grooming package', 'Party makeup for sangeet & reception'] };
  if (m === 2) return { title: 'Holi & spring', ideas: ['Post-Holi colour removal & hair spa', 'Skin detox facials', "Women's Day specials"] };
  if (m >= 3 && m <= 5) return { title: 'Summer', ideas: ['De-tan & cooling facials', 'Summer haircuts', 'Pedicure for sandal season', 'Students’ vacation offers'] };
  return { title: 'Monsoon', ideas: ['Anti-frizz & keratin treatments', 'Dandruff / scalp care hair spa', 'Rainy-day weekday discount', 'Teej & Raksha Bandhan mehendi + makeup'] };
}

// ═══ 7. MESSAGE WRITER ═══════════════════════════════════════════════════════
export type MsgKind = 'winback' | 'due_visit' | 'birthday' | 'festival' | 'slow_day' | 'review' | 'due_payment' | 'new_client';
export type Lang = 'en' | 'hinglish';

const TPL: Record<MsgKind, Record<Lang, string[]>> = {
  winback: {
    en: [
      'Hi {name}! We miss you at {salon} 💇 It has been a while — here is {offer} on your next visit. Reply to book your slot. {phone}',
      'Hello {name}, your favourite chair at {salon} is waiting! Come back this week and get {offer}. Call {phone} to book.',
      '{name}, a little pampering is overdue 😊 Enjoy {offer} at {salon} — valid for 7 days. Book: {phone}',
    ],
    hinglish: [
      'Hi {name}! {salon} mein aapki kami mehsoos ho rahi hai 💇 Agli visit par {offer}. Slot book karne ke liye reply karein. {phone}',
      'Namaste {name} ji, kaafi din ho gaye! Is hafte aaiye aur paaiye {offer} — sirf aapke liye. Booking: {phone}',
      '{name}, thoda pampering toh banta hai 😊 {salon} mein {offer}, 7 din tak valid. Call karein: {phone}',
    ],
  },
  due_visit: {
    en: ['Hi {name}! It is about time for your {service} at {salon}. Shall we book you in this week? Reply with a day & time. {phone}', 'Hello {name} 👋 Your last {service} was {days} days ago — perfect time for a touch-up! Book at {salon}: {phone}'],
    hinglish: ['Hi {name}! Aapke {service} ka time ho gaya hai 😊 Is hafte kab aana pasand karenge? Din aur time reply karein. {phone}', 'Namaste {name} ji, pichhli {service} ko {days} din ho gaye — touch-up ka perfect time! Booking: {phone}'],
  },
  birthday: {
    en: ['Happy Birthday {name}! 🎂 Celebrate with us — enjoy {offer} at {salon} this month. 🎉 {phone}'],
    hinglish: ['Janamdin ki dher saari shubhkamnayein {name}! 🎂 Is mahine {salon} mein aapke liye {offer}. 🎉 {phone}'],
  },
  festival: {
    en: ['✨ {occasion} special at {salon}! {offer}. Limited slots — book now: {phone}', 'Get festive-ready at {salon} 💫 {occasion} offer: {offer}. Call {phone} to reserve your slot.'],
    hinglish: ['✨ {occasion} special {salon} mein! {offer}. Slots limited hain — abhi book karein: {phone}', '{occasion} ke liye taiyaar ho jaiye 💫 {salon} mein {offer}. Booking ke liye call karein: {phone}'],
  },
  slow_day: {
    en: ['{day} Delight at {salon}! Visit any {day} this month and get {offer}. Book: {phone}'],
    hinglish: ['{day} special {salon} mein! Is mahine har {day} ko {offer}. Booking: {phone}'],
  },
  review: {
    en: ['Thank you for visiting {salon}, {name}! 🙏 If you loved your service, a quick Google review helps us a lot: {link}'],
    hinglish: ['{salon} aane ke liye dhanyavaad {name}! 🙏 Service pasand aayi ho toh ek Google review zaroor dein: {link}'],
  },
  due_payment: {
    en: ['Hi {name}, a gentle reminder from {salon}: {amount} is pending on bill {bill}. You can pay by UPI to {upi}. Thank you! 🙏'],
    hinglish: ['Namaste {name} ji, {salon} se ek chhota sa reminder: bill {bill} ka {amount} baaki hai. UPI se bhej sakte hain: {upi}. Dhanyavaad! 🙏'],
  },
  new_client: {
    en: ['Welcome to {salon}, {name}! 🌸 Your second visit gets {offer} — valid for 21 days. See you soon! {phone}'],
    hinglish: ['{salon} mein aapka swagat hai {name}! 🌸 Doosri visit par {offer} — 21 din tak valid. Jaldi milte hain! {phone}'],
  },
};

export function writeMessage(kind: MsgKind, vars: Record<string, string | number>, lang: Lang = 'en', variant = 0): string {
  const list = TPL[kind][lang] || TPL[kind].en;
  const tpl = list[Math.abs(variant) % list.length];
  return tpl.replace(/\{(\w+)\}/g, (_, k) => {
    const v = vars[k];
    return v === undefined || v === null || v === '' ? '' : String(v);
  }).replace(/\s+([.!,])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}

export function messageVariants(kind: MsgKind, lang: Lang = 'en'): number {
  return (TPL[kind][lang] || TPL[kind].en).length;
}
