/**
 * Boss AI — the owner's offline business assistant.
 *
 * Answers questions typed in English, Hinglish or Hindi from the salon's own
 * database, writes the morning briefing, predicts who is due back, suggests
 * add-ons at billing and flags discount / cancellation patterns.
 *
 * No internet, no API key, no subscription: intent.ts understands the
 * question, analytics.ts does the maths, and this file fetches the rows.
 */
import { DBX } from '../../database/Database';
import { todayLocal, toLocalDateStr } from '../../utils/helpers';
import {
  parseQuestion, previousPeriod, periodFor, Parsed, SUGGESTED_QUESTIONS,
} from './intent';
import {
  forecastMonth, buildBasket, suggestUpsell, clientRhythm, dueSoon, segmentClients, SEGMENT_INFO,
  leakageAlerts, seasonFor, upcomingOccasions, writeMessage, diffDays, Basket, Rhythm, Segment, Suggestion, Forecast, Alert,
} from './analytics';
import { appLocale, curSym, getRegion, fmtNumber } from '../../config/regions';

export interface AIClientRow { id: number; name: string; phone?: string; sub: string; message?: string }
export interface AIAnswer {
  text: string;
  bullets?: string[];
  tone?: 'success' | 'warning' | 'info' | 'danger';
  stats?: { label: string; value: string }[];
  clients?: AIClientRow[];
  actions?: { label: string; route: string; params?: any }[];
  copyText?: string;
}
export interface BriefingLine { icon: string; text: string; tone: 'success' | 'warning' | 'info' | 'danger' | 'primary'; route?: string }
export interface Briefing { headline: string; lines: BriefingLine[]; forecast?: Forecast; generatedAt: number }

interface Ctx {
  at: number;
  today: string;
  sym: string;
  salon: any;
  bills: any[];               // 180 days, valid only, items parsed
  basket: Basket;
  rhythm: Rhythm[];
  salonGap: number;
  daily: { date: string; revenue: number; bills: number }[]; // 120 days
  clients: any[];
  staff: any[];
  target: number;
  lastServiceByClient: Map<number, string>;
}

let cache: Ctx | null = null;
let loading: Promise<Ctx> | null = null;
const TTL = 90_000;

const pct = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 100) : 0);
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/** ₹12,400 · ₹3,45,000 · ₹1.2 Cr — Indian grouping, never "NaN". */
export function inr(n: number, sym = curSym()): string {
  const v = Math.round(Number(n) || 0);
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (getRegion().compact !== 'indian') {
    if (a >= 1e6) return `${sign}${sym}${(a / 1e6).toFixed(2).replace(/\.?0+$/, '')}M`;
    return `${sign}${sym}${fmtNumber(a, 0)}`;
  }
  if (a >= 1e7) return `${sign}${sym}${(a / 1e7).toFixed(2).replace(/\.?0+$/, '')} Cr`;
  // Hand-rolled en-IN grouping: Hermes builds without full ICU format plainly.
  const s = String(a);
  const last3 = s.slice(-3), rest = s.slice(0, -3);
  return `${sign}${sym}${rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' : ''}${last3}`;
}

async function loadCtx(force = false): Promise<Ctx> {
  if (!force && cache && Date.now() - cache.at < TTL) return cache;
  if (loading) return loading;
  loading = (async () => {
    const today = todayLocal();
    const since180 = toLocalDateStr(new Date(Date.now() - 180 * 86400000));
    const since120 = toLocalDateStr(new Date(Date.now() - 120 * 86400000));
    const [salon, bills, visitDays, daily, clients, staff, target, sym] = await Promise.all([
      DBX.getSalonProfile().catch(() => ({})),
      DBX.getBillsForAnalysis(since180),
      DBX.getClientVisitDays(toLocalDateStr(new Date(Date.now() - 540 * 86400000))),
      DBX.getRevenueByDateRange(since120, today).catch(() => []),
      DBX.getClientsLite(),
      DBX.getStaff().catch(() => []),
      DBX.getRevenueTarget().catch(() => 0),
      DBX.getSetting('currency_symbol').catch(() => curSym()),
    ]);
    const { list, salonGap } = clientRhythm(visitDays, today);
    const lastServiceByClient = new Map<number, string>();
    for (const b of bills) { // newest first
      if (!b.client_id || lastServiceByClient.has(b.client_id)) continue;
      const svc = (b.items || []).find((i: any) => i.type === 'service');
      if (svc) lastServiceByClient.set(b.client_id, svc.name);
    }
    const ctx: Ctx = {
      at: Date.now(), today, sym: (salon as any)?.currency_symbol || sym || curSym(), salon: salon || {},
      bills, basket: buildBasket(bills), rhythm: list, salonGap,
      daily: (daily as any[]).map(r => ({ date: r.date, revenue: Number(r.revenue) || 0, bills: Number(r.bills) || 0 })),
      clients, staff: staff as any[], target: Number(target) || 0, lastServiceByClient,
    };
    cache = ctx;
    return ctx;
  })();
  try { return await loading; } finally { loading = null; }
}

export const BossAI = {
  /** Call after a bill / client change so the next answer is fresh. */
  invalidate() { cache = null; },

  suggestions(lang: 'en' | 'hinglish' = 'en') {
    return SUGGESTED_QUESTIONS.map(q => (lang === 'hinglish' ? q.hi : q.en));
  },

  // ── Billing helpers ───────────────────────────────────────────────────────
  async upsell(currentItemNames: string[], activeServiceNames?: string[], max = 3): Promise<Suggestion[]> {
    try {
      const ctx = await loadCtx();
      if (ctx.basket.n < 15) return [];
      return suggestUpsell(currentItemNames, ctx.basket, { max, allowed: activeServiceNames });
    } catch { return []; }
  },

  /** Short "what to know about this client" line for the billing screen. */
  async clientSnapshot(clientId: number): Promise<{ line: string; favourite?: string; overdue?: number; segment?: string } | null> {
    try {
      const ctx = await loadCtx();
      const r = ctx.rhythm.find(x => x.client_id === clientId);
      const counts = new Map<string, number>();
      for (const b of ctx.bills) if (b.client_id === clientId) for (const i of b.items || []) if (i.type === 'service') counts.set(i.name, (counts.get(i.name) || 0) + 1);
      const fav = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (!r) return fav ? { line: `Usually takes ${fav}`, favourite: fav } : null;
      const since = diffDays(r.lastVisit, ctx.today);
      const client = ctx.clients.find(c => c.id === clientId);
      const seg = client ? segmentClients([client], [r], ctx.today, ctx.salonGap).get(clientId) : undefined;
      const parts = [
        since === 0 ? 'Visited today' : `Last visit ${since} day${since === 1 ? '' : 's'} ago`,
        r.personalGap ? `comes every ~${r.gap} days` : '',
        fav ? `usually ${fav}` : '',
      ].filter(Boolean);
      return { line: parts.join(' · '), favourite: fav, overdue: r.overdue, segment: seg ? SEGMENT_INFO[seg].label : undefined };
    } catch { return null; }
  },

  // ── Insights feeds ────────────────────────────────────────────────────────
  async forecast(hourNow = new Date().getHours()): Promise<Forecast> {
    const ctx = await loadCtx();
    return forecastMonth(ctx.daily, ctx.today, ctx.target, hourNow);
  },

  async dueBack(withinDays = 7): Promise<AIClientRow[]> {
    const ctx = await loadCtx();
    const byId = new Map(ctx.clients.map(c => [c.id, c]));
    return dueSoon(ctx.rhythm, withinDays).map(r => {
      const c = byId.get(r.client_id);
      if (!c || c.is_blacklisted) return null;
      const svc = ctx.lastServiceByClient.get(r.client_id) || 'visit';
      const since = diffDays(r.lastVisit, ctx.today);
      return {
        id: c.id, name: c.name, phone: c.phone,
        sub: `${r.overdue > 0 ? `${r.overdue}d late` : r.overdue === 0 ? 'due today' : `due in ${-r.overdue}d`} · every ~${r.gap}d · last ${svc}`,
        message: c.phone ? writeMessage('due_visit', { name: firstName(c.name), service: svc, days: since, salon: ctx.salon.name || 'our salon', phone: ctx.salon.phone || '' }, 'en') : undefined,
      } as AIClientRow;
    }).filter(Boolean).slice(0, 25) as AIClientRow[];
  },

  async segments(): Promise<{ seg: Segment; label: string; hint: string; action: string; count: number; revenue: number; clients: any[] }[]> {
    const ctx = await loadCtx();
    const map = segmentClients(ctx.clients, ctx.rhythm, ctx.today, ctx.salonGap);
    const order: Segment[] = ['champion', 'loyal', 'new', 'regular', 'at_risk', 'lost'];
    return order.map(seg => {
      const list = ctx.clients.filter(c => map.get(c.id) === seg).sort((a, b) => (b.total_spent || 0) - (a.total_spent || 0));
      return { seg, ...SEGMENT_INFO[seg], count: list.length, revenue: list.reduce((s, c) => s + (c.total_spent || 0), 0), clients: list };
    });
  },

  async alerts(): Promise<Alert[]> {
    const ctx = await loadCtx();
    const start = toLocalDateStr(new Date(Date.now() - 29 * 86400000));
    const [discounts, voids] = await Promise.all([DBX.getDiscountsByStaff(start, ctx.today), DBX.getVoidsByStaff(start, ctx.today)]);
    const recent = ctx.bills.filter(b => String(b.created_at).slice(0, 10) >= start);
    const walk = recent.length ? recent.filter(b => !b.client_id).length / recent.length : 0;
    return leakageAlerts({ discounts, voids, walkinShare: walk, totalBills: recent.length, sym: ctx.sym });
  },

  // ── Morning briefing ──────────────────────────────────────────────────────
  async briefing(opts: { money?: boolean } = {}): Promise<Briefing> {
    const money = opts.money !== false;
    const ctx = await loadCtx(true);
    const fmt = (n: number) => inr(n, ctx.sym);
    const lines: BriefingLine[] = [];
    const h = new Date().getHours();
    const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';

    const yesterday = toLocalDateStr(new Date(Date.now() - 86400000));
    const yRow = ctx.daily.find(r => r.date === yesterday);
    const tRow = ctx.daily.find(r => r.date === ctx.today);
    const fc = forecastMonth(ctx.daily, ctx.today, ctx.target, h);

    if (money) {
      if (yRow) {
        const dowAvg = fc.weekdayAvg[new Date(yesterday + 'T00:00:00').getDay()] || 0;
        const d = pct(yRow.revenue, dowAvg);
        lines.push({ icon: d >= 0 ? 'trending-up' : 'trending-down', tone: d >= 5 ? 'success' : d <= -10 ? 'warning' : 'info',
          text: `Yesterday ${fmt(yRow.revenue)} from ${yRow.bills} bills${dowAvg > 0 ? ` — ${Math.abs(d)}% ${d >= 0 ? 'above' : 'below'} a normal ${weekdayName(yesterday)}` : ''}.` });
      } else if (fc.historyDays > 3 && !fc.closedWeekdays.includes(new Date(yesterday + 'T00:00:00').getDay())) {
        lines.push({ icon: 'alert-circle-outline', tone: 'warning', text: 'No bills were recorded yesterday. If the salon was open, bills may have been missed.' });
      }
      if (tRow) lines.push({ icon: 'cash-register', tone: 'primary', text: `Today so far ${fmt(tRow.revenue)} · ${tRow.bills} bills.` });
      if (fc.historyDays >= 7) {
        if (fc.target) {
          lines.push({ icon: 'target', tone: fc.onTrack ? 'success' : 'warning', route: 'AIAssistant',
            text: fc.onTrack
              ? `On track: month-end around ${fmt(fc.projected)} vs target ${fmt(fc.target)}.`
              : `Month-end looks like ${fmt(fc.projected)} — ${fmt(fc.target - fc.projected)} short of target. Need ~${fmt(fc.neededPerDay || 0)}/day.` });
        } else {
          lines.push({ icon: 'chart-timeline-variant', tone: 'info', text: `Month-end forecast: ${fmt(fc.projected)} (${fmt(fc.mtd)} so far).` });
        }
      }
    }

    try {
      const appts = (await DBX.getAppointments(ctx.today) as any[]).filter(a => a.status !== 'cancelled');
      if (appts.length) lines.push({ icon: 'calendar-clock', tone: 'primary', route: 'Calendar', text: `${appts.length} appointment${appts.length === 1 ? '' : 's'} today${appts[0]?.start_time ? `, first at ${appts[0].start_time}` : ''}.` });
    } catch {}

    const due = await this.dueBack(7);
    if (due.length) lines.push({ icon: 'account-clock-outline', tone: 'info', route: 'AIAssistant',
      text: `${due.length} client${due.length === 1 ? ' is' : 's are'} due back this week — ${due.slice(0, 3).map(d => firstName(d.name)).join(', ')}${due.length > 3 ? '…' : '.'} Send a reminder.` });

    if (money) {
      const dues = await DBX.getDuesSummary();
      if (dues.amount > 0) lines.push({ icon: 'clock-alert-outline', tone: 'warning', route: 'BillHistory', text: `${fmt(dues.amount)} pending dues from ${dues.clients} client${dues.clients === 1 ? '' : 's'}.` });
    }

    try {
      const low = await DBX.getLowStockItems() as any[];
      if (low.length) lines.push({ icon: 'package-variant-closed', tone: 'warning', route: 'Inventory', text: `${low.length} product${low.length === 1 ? '' : 's'} low on stock (${low.slice(0, 2).map((i: any) => i.name).join(', ')}).` });
    } catch {}

    try {
      const bdays = (await DBX.getUpcomingBirthdays(0)) as any[];
      if (bdays.length) lines.push({ icon: 'cake-variant-outline', tone: 'success', text: `Birthday today: ${bdays.slice(0, 3).map((c: any) => firstName(c.name)).join(', ')}. Send a wish with an offer.` });
    } catch {}

    if (money) {
      const al = (await this.alerts()).filter(a => a.severity !== 'info');
      if (al.length) lines.push({ icon: 'shield-alert-outline', tone: 'danger', route: 'AIAssistant', text: `${al.length} thing${al.length === 1 ? '' : 's'} to check: ${al[0].title}.` });
    }

    if (!lines.length) lines.push({ icon: 'lightbulb-on-outline', tone: 'info', text: 'Start billing through the app — the briefing gets smarter every day.' });

    const occ = upcomingOccasions(ctx.today, 10)[0];
    if (occ) lines.push({ icon: 'party-popper', tone: 'info', route: 'Marketing', text: `${occ.name} in ${diffDays(ctx.today, occ.date)} days — idea: ${occ.idea}.` });

    return { headline: `${greet}${ctx.salon.owner_name ? `, ${firstName(ctx.salon.owner_name)}` : ''}!`, lines, forecast: fc, generatedAt: Date.now() };
  },

  // ── Ask ───────────────────────────────────────────────────────────────────
  async ask(question: string, perms: { money: boolean; branches?: boolean } = { money: true }): Promise<AIAnswer> {
    try {
      const ctx = await loadCtx();
      const p = parseQuestion(question, new Date(), {
        clients: ctx.clients.map(c => ({ id: c.id, name: c.name })),
        staff: ctx.staff.map((s: any) => ({ id: s.id, name: s.name })),
      });
      return await answer(p, ctx, perms);
    } catch (e: any) {
      return { text: 'Sorry, I could not read the data just now. Please try again.', tone: 'danger', bullets: [String(e?.message || e)] };
    }
  },
};

// ═══════════════════════════════════════════════════════════════════════════
function firstName(n: string) { return String(n || '').trim().split(/\s+/)[0] || 'there'; }
function weekdayName(d: string) { return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(d + 'T00:00:00').getDay()]; }

async function answer(p: Parsed, ctx: Ctx, perms: { money: boolean; branches?: boolean }): Promise<AIAnswer> {
  const H = p.lang === 'hinglish';
  const t = (en: string, hi: string) => (H ? hi : en);
  const fmt = (n: number) => inr(n, ctx.sym);
  // Early in the month "this month" has almost no data; when the owner did not
  // name a period, rankings use the last 30 days instead.
  if (!p.periodExplicit && p.period.key === 'this_month' && new Date().getDate() <= 5 &&
      ['top_staff', 'top_services', 'staff_one', 'payments', 'avg_bill', 'new_clients'].includes(p.intent)) {
    p = { ...p, period: periodFor('last_30', new Date()) };
  }
  const per = H ? p.period.labelHi : p.period.label;
  const moneyIntents = ['revenue', 'profit', 'expenses', 'forecast', 'payments', 'avg_bill', 'alerts', 'dues', 'branches', 'staff_one', 'top_staff'];
  if (!perms.money && moneyIntents.includes(p.intent)) {
    return { text: t('Money figures are only visible to the owner or a manager.', 'Paison ki jaankari sirf owner ya manager dekh sakte hain.'), tone: 'info' };
  }
  const salonName = ctx.salon.name || 'our salon';
  const phone = ctx.salon.phone || '';

  switch (p.intent) {
    case 'revenue':
    case 'bills':
    case 'avg_bill': {
      const pl = await DBX.getPLSummary(p.period.start, p.period.end);
      const rows = await DBX.getRevenueByDateRange(p.period.start, p.period.end) as any[];
      const bills = rows.reduce((s, r) => s + (r.bills || 0), 0);
      const avg = bills ? pl.revenue / bills : 0;
      const prev = previousPeriod(p.period);
      const plPrev = await DBX.getPLSummary(prev.start, prev.end);
      const ch = pct(pl.revenue, plPrev.revenue);
      void ch;
      const stats = [
        { label: t('Revenue', 'Collection'), value: fmt(pl.revenue) },
        { label: t('Bills', 'Bills'), value: String(bills) },
        { label: t('Avg bill', 'Avg bill'), value: fmt(avg) },
      ];
      if (p.intent === 'avg_bill') {
        return { text: t(`Average bill ${per} is ${fmt(avg)} across ${bills} bills.`, `${cap(per)} average bill ${fmt(avg)} hai (${bills} bills).`), stats,
          bullets: [t('Raise it with add-ons at billing — Boss AI suggests them automatically.', 'Billing ke time add-on suggest karein — Boss AI khud batata hai.')] };
      }
      // Today is not over, so a % against all of yesterday would mislead — show yesterday's figure instead.
      const cmp = p.period.key === 'today'
        ? (plPrev.revenue > 0 ? t(` Yesterday: ${fmt(plPrev.revenue)}.`, ` Kal: ${fmt(plPrev.revenue)}.`) : '')
        : plPrev.revenue > 0 ? t(` ${ch >= 0 ? '▲' : '▼'} ${Math.abs(ch)}% vs ${prev.label}.`, ` ${prev.labelHi} se ${Math.abs(ch)}% ${ch >= 0 ? 'zyada' : 'kam'}.`) : '';
      const text = p.intent === 'bills'
        ? t(`${plural(bills, 'bill')} ${per}, worth ${fmt(pl.revenue)}.`, `${cap(per)} ${bills} bills bane, total ${fmt(pl.revenue)}.`)
        : t(`Revenue ${per}: ${fmt(pl.revenue)} from ${plural(bills, 'bill')}.`, `${cap(per)} ka collection ${fmt(pl.revenue)} hai — ${bills} bills.`);
      return { text: text + cmp, stats, tone: ch >= 0 ? 'success' : 'warning', actions: [{ label: t('Open reports', 'Reports kholo'), route: 'Reports' }] };
    }

    case 'profit': {
      const r = await DBX.getDetailedPLReport(p.period.start, p.period.end);
      const top = (r.expensesByCategory || [])[0];
      return {
        text: r.grossProfit >= 0
          ? t(`Profit ${per}: ${fmt(r.grossProfit)} (${Math.round(r.profitMargin)}% margin).`, `${cap(per)} ka profit ${fmt(r.grossProfit)} hai (${Math.round(r.profitMargin)}% margin).`)
          : t(`Expenses ${per} are ${fmt(-r.grossProfit)} more than takings so far.`, `${cap(per)} abhi tak kharcha kamai se ${fmt(-r.grossProfit)} zyada hai.`)
            + (p.period.key === 'this_month' && new Date().getDate() <= 10 ? t(' Normal early in the month — rent and stock are paid up front.', ' Mahine ki shuruaat mein ye normal hai — rent aur stock pehle bharte hain.') : ''),
        tone: r.grossProfit >= 0 ? 'success' : 'danger',
        stats: [{ label: t('Revenue', 'Collection'), value: fmt(r.revenue) }, { label: t('Expenses', 'Kharcha'), value: fmt(r.expenses) }, { label: t('Profit', 'Profit'), value: fmt(r.grossProfit) }],
        bullets: [
          top ? t(`Biggest expense: ${top.category} ${fmt(top.total)}.`, `Sabse bada kharcha: ${top.category} ${fmt(top.total)}.`) : '',
          r.totalDiscount > 0 ? t(`Discounts given: ${fmt(r.totalDiscount)}.`, `Discount diya: ${fmt(r.totalDiscount)}.`) : '',
          r.expenses === 0 ? t('No expenses recorded — add rent, salaries and products for a true profit.', 'Koi kharcha entry nahi hai — rent, salary, products daalein tabhi sahi profit dikhega.') : '',
        ].filter(Boolean),
        actions: [{ label: t('Add expense', 'Kharcha jodo'), route: 'Expenses' }],
      };
    }

    case 'expenses': {
      const r = await DBX.getDetailedPLReport(p.period.start, p.period.end);
      return {
        text: t(`Expenses ${per}: ${fmt(r.expenses)}.`, `${cap(per)} ka kharcha ${fmt(r.expenses)} hai.`),
        bullets: (r.expensesByCategory || []).slice(0, 5).map((e: any) => `${e.category}: ${fmt(e.total)}`),
        actions: [{ label: t('Open expenses', 'Kharche dekho'), route: 'Expenses' }],
      };
    }

    case 'top_services': {
      const list = await DBX.getTopServices(p.period.start, p.period.end, 5) as any[];
      if (!list.length) return { text: t(`No services billed ${per} yet.`, `${cap(per)} abhi tak koi service bill nahi hui.`), tone: 'info' };
      return {
        text: t(`Top service ${per}: ${list[0].name}.`, `${cap(per)} sabse zyada chalne wali service: ${list[0].name}.`),
        bullets: list.map((s, i) => `${i + 1}. ${s.name} — ${s.count}× · ${fmt(s.revenue)}`),
        actions: [{ label: t('Promote it', 'Iska poster banao'), route: 'Marketing', params: { prefill: { template: 'service', headline: list[0].name } } }],
      };
    }

    case 'top_staff': {
      const list = (await DBX.getStaffPerformance(p.period.start, p.period.end) as any[]).filter(s => s.total_bills > 0);
      if (!list.length) return { text: t(`No staff sales ${per} yet.`, `${cap(per)} abhi tak staff ki koi sale nahi.`), tone: 'info' };
      return {
        text: t(`${list[0].name} leads ${per} with ${fmt(list[0].total_revenue)}.`, `${cap(per)} ${list[0].name} sabse aage — ${fmt(list[0].total_revenue)}.`),
        bullets: list.slice(0, 6).map((s, i) => `${i + 1}. ${s.name} — ${fmt(s.total_revenue)} · ${plural(s.total_bills, 'bill')} · commission ${fmt(s.commission_earned)}`),
        actions: [{ label: t('Staff screen', 'Staff dekho'), route: 'Staff' }],
      };
    }

    case 'staff_one': {
      const list = await DBX.getStaffPerformance(p.period.start, p.period.end) as any[];
      const s = list.find(x => x.id === p.nameId);
      if (!s) return { text: t(`${p.name} has no sales ${per}.`, `${p.name} ki ${per} koi sale nahi.`), tone: 'info' };
      const att = (await DBX.getAttendanceByRange(p.period.start, p.period.end) as any[]).filter(a => a.staff_id === p.nameId);
      const present = att.filter(a => a.status === 'present').length, half = att.filter(a => a.status === 'half_day').length;
      const rank = list.filter(x => x.total_bills > 0).findIndex(x => x.id === p.nameId) + 1;
      return {
        text: t(`${s.name} ${per}: ${fmt(s.total_revenue)} from ${s.total_bills} bills${rank ? ` — rank #${rank}` : ''}.`, `${s.name} ${per}: ${fmt(s.total_revenue)}, ${s.total_bills} bills${rank ? ` — rank #${rank}` : ''}.`),
        stats: [{ label: t('Commission', 'Commission'), value: fmt(s.commission_earned) }, { label: t('Present', 'Haazir'), value: `${present}${half ? ` + ${half}½` : ''}` }, { label: t('Avg bill', 'Avg bill'), value: fmt(s.total_bills ? s.total_revenue / s.total_bills : 0) }],
        actions: [{ label: t('Pay slip', 'Pay slip'), route: 'StaffPaySlip' }],
      };
    }

    case 'client_one': {
      const c = ctx.clients.find(x => x.id === p.nameId);
      if (!c) return { text: t('I could not find that client.', 'Ye client nahi mila.'), tone: 'info' };
      const r = ctx.rhythm.find(x => x.client_id === c.id);
      const dues = await DBX.getDueBills(c.id);
      const dueAmt = dues.reduce((s: number, b: any) => s + (b.amount_due || 0), 0);
      const since = c.last_visit ? diffDays(String(c.last_visit).slice(0, 10), ctx.today) : NaN;
      const counts = new Map<string, number>();
      for (const b of ctx.bills) if (b.client_id === c.id) for (const i of b.items || []) if (i.type === 'service') counts.set(i.name, (counts.get(i.name) || 0) + 1);
      const fav = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n);
      return {
        text: isNaN(since)
          ? t(`${c.name} has not visited yet.`, `${c.name} abhi tak nahi aaye.`)
          : t(`${c.name} last visited ${since === 0 ? 'today' : `${since} days ago`}.`, `${c.name} ${since === 0 ? 'aaj' : `${since} din pehle`} aaye the.`),
        stats: [
          { label: t('Visits', 'Visits'), value: String(c.total_visits || 0) },
          ...(perms.money ? [{ label: t('Spent', 'Kharch'), value: fmt(c.total_spent || 0) }] : []),
          { label: t('Points', 'Points'), value: String(c.loyalty_points || 0) },
        ],
        bullets: [
          r?.personalGap ? t(`Usually comes every ~${r.gap} days; next expected ${r.overdue > 0 ? `${r.overdue} days ago` : `in ${-r.overdue} days`}.`, `Aam taur par har ~${r.gap} din mein aate hain.`) : '',
          fav.length ? t(`Favourites: ${fav.join(', ')}.`, `Pasandida: ${fav.join(', ')}.`) : '',
          dueAmt > 0 && perms.money ? t(`Pending due: ${fmt(dueAmt)}.`, `Baaki: ${fmt(dueAmt)}.`) : '',
        ].filter(Boolean),
        clients: c.phone ? [{ id: c.id, name: c.name, phone: c.phone, sub: t('Send a message', 'Message bhejo'),
          message: writeMessage(since > (r?.gap || 45) ? 'winback' : 'due_visit', { name: firstName(c.name), salon: salonName, phone, offer: '10% off', service: fav[0] || 'visit', days: since }, p.lang) }] : undefined,
        actions: [{ label: t('Open profile', 'Profile kholo'), route: 'ClientDetail', params: { clientId: c.id } }],
      };
    }

    case 'lapsed': {
      const days = parseInt(await DBX.getSetting('reengage_days') || '45', 10) || 45;
      const list = await DBX.getTopAtRiskClients(days, 15);
      if (!list.length) return { text: t(`No valuable client has been away more than ${days} days. 👏`, `${days} din se zyada koi khaas client gayab nahi hai. 👏`), tone: 'success' };
      const lost = list.reduce((s: number, c: any) => s + (c.total_spent || 0), 0);
      return {
        text: t(`${list.length} good clients haven't come for ${days}+ days (lifetime ${fmt(lost)}).`, `${list.length} acche clients ${days}+ din se nahi aaye (inka total ${fmt(lost)}).`),
        tone: 'warning',
        clients: list.map((c: any, i: number) => ({
          id: c.id, name: c.name, phone: c.phone,
          sub: `${perms.money ? fmt(c.total_spent) + ' · ' : ''}${t('last', 'last')} ${c.last_visit ? `${diffDays(String(c.last_visit).slice(0, 10), ctx.today)}d` : '—'}`,
          message: c.phone ? writeMessage('winback', { name: firstName(c.name), salon: salonName, phone, offer: '15% off' }, p.lang, i) : undefined,
        })),
      };
    }

    case 'due_visits': {
      const list = await BossAI.dueBack(p.period.key === 'this_month' ? 14 : 7);
      if (!list.length) return { text: t('Nobody is due back right now based on their usual visit gap.', 'Abhi kisi ka aane ka time nahi hua hai.'), tone: 'info' };
      return {
        text: t(`${list.length} clients are due back based on how often they usually come. A reminder now fills next week's slots.`, `${list.length} clients ka aane ka time ho gaya hai. Abhi reminder bhejo, agle hafte ki booking bharegi.`),
        tone: 'info', clients: list,
      };
    }

    case 'dues': {
      const sum = await DBX.getDuesSummary();
      if (!sum.amount) return { text: t('No pending dues. Every bill is paid. ✅', 'Koi udhaar baaki nahi hai. ✅'), tone: 'success' };
      const bills = await DBX.getDueBills();
      const byClient = new Map<number, { name: string; phone: string; amt: number; bill: string }>();
      for (const b of bills) {
        const x = byClient.get(b.client_id) || { name: b.client_name, phone: b.client_phone, amt: 0, bill: b.bill_number };
        x.amt += b.amount_due; byClient.set(b.client_id, x);
      }
      return {
        text: t(`${fmt(sum.amount)} pending from ${sum.clients} clients (${sum.count} bills).`, `${sum.clients} clients ka ${fmt(sum.amount)} udhaar baaki hai (${sum.count} bills).`),
        tone: 'warning',
        clients: [...byClient.entries()].sort((a, b) => b[1].amt - a[1].amt).slice(0, 20).map(([id, x]) => ({
          id, name: x.name, phone: x.phone, sub: `${fmt(x.amt)} due`,
          message: x.phone ? writeMessage('due_payment', { name: firstName(x.name), salon: salonName, amount: fmt(x.amt), bill: x.bill, upi: ctx.salon.upi_id || phone }, p.lang) : undefined,
        })),
        actions: [{ label: t('Collect dues', 'Udhaar wasool karo'), route: 'BillHistory' }],
      };
    }

    case 'stock': {
      const [low, exp] = await Promise.all([DBX.getLowStockItems() as Promise<any[]>, DBX.getExpiringProducts(30)]);
      if (!low.length && !exp.length) return { text: t('Stock looks fine — nothing below the reorder level.', 'Stock theek hai — kuch khatam nahi ho raha.'), tone: 'success' };
      return {
        text: t(`${low.length} items low, ${exp.length} expiring within 30 days.`, `${low.length} cheezein khatam hone wali hain, ${exp.length} 30 din mein expire hongi.`),
        tone: 'warning',
        bullets: [...low.slice(0, 8).map((i: any) => `⚠️ ${i.name}: ${i.quantity} ${i.unit} (min ${i.min_stock})`), ...exp.slice(0, 4).map((i: any) => `⏳ ${i.name}: expires ${i.expiry_date}`)],
        actions: [{ label: t('Open inventory', 'Inventory kholo'), route: 'Inventory' }],
      };
    }

    case 'appointments': {
      const day = p.period.start === p.period.end ? p.period.start : ctx.today;
      const list = (await DBX.getAppointments(day) as any[]).filter(a => a.status !== 'cancelled');
      const nice = new Date(day + 'T00:00:00').toLocaleDateString(appLocale(), { weekday: 'short', day: 'numeric', month: 'short' });
      const isTomorrow = day === toLocalDateStr(new Date(Date.now() + 86400000));
      const label = day === ctx.today ? t('today', 'aaj') : isTomorrow ? t(`tomorrow (${nice})`, `kal (${nice})`) : t(`on ${nice}`, `${nice} ko`);
      if (!list.length) return { text: t(`No appointments ${label}.`, `${cap(label)} koi appointment nahi.`), tone: 'info', actions: [{ label: t('Open calendar', 'Calendar kholo'), route: 'Calendar' }] };
      return {
        text: t(`${list.length} appointments ${label}.`, `${cap(label)} ${list.length} appointments hain.`),
        bullets: list.slice(0, 12).map(a => `${a.start_time} · ${a.client_name || 'Walk-in'} · ${a.service_names || ''}${a.staff_name ? ` · ${a.staff_name}` : ''}`),
        actions: [{ label: t('Open calendar', 'Calendar kholo'), route: 'Calendar' }],
      };
    }

    case 'birthdays': {
      const [b, a] = await Promise.all([DBX.getUpcomingBirthdays(7) as Promise<any[]>, DBX.getUpcomingAnniversaries(7) as Promise<any[]>]);
      if (!b.length && !a.length) return { text: t('No birthdays or anniversaries in the next 7 days.', 'Agle 7 din mein koi birthday/anniversary nahi.'), tone: 'info' };
      return {
        text: t(`${b.length} birthdays and ${a.length} anniversaries this week.`, `Is hafte ${b.length} birthday aur ${a.length} anniversary.`),
        clients: [...b.map(c => ({ ...c, kind: 'birthday' })), ...a.map(c => ({ ...c, kind: 'anniv' }))].slice(0, 20).map((c: any) => ({
          id: c.id, name: c.name, phone: c.phone, sub: c.kind === 'birthday' ? `🎂 ${String(c.date_of_birth).slice(5)}` : `💍 ${String(c.anniversary).slice(5)}`,
          message: c.phone ? writeMessage('birthday', { name: firstName(c.name), salon: salonName, phone, offer: '20% off any service' }, p.lang) : undefined,
        })),
      };
    }

    case 'forecast': {
      const f = forecastMonth(ctx.daily, ctx.today, ctx.target, new Date().getHours());
      if (f.historyDays < 7) return { text: t('I need about a week of billing to forecast reliably. Keep billing through the app!', 'Sahi forecast ke liye kam se kam ek hafte ki billing chahiye.'), tone: 'info' };
      return {
        text: t(`Month-end estimate: ${fmt(f.projected)} (likely ${fmt(f.low)}–${fmt(f.high)}). ${fmt(f.mtd)} done so far.`, `Mahine ke end tak lagbhag ${fmt(f.projected)} hoga (${fmt(f.low)}–${fmt(f.high)}). Abhi tak ${fmt(f.mtd)}.`),
        tone: f.target ? (f.onTrack ? 'success' : 'warning') : 'info',
        bullets: [
          f.target ? (f.onTrack ? t(`You should cross your target of ${fmt(f.target)}. 🎯`, `Target ${fmt(f.target)} paar ho jayega. 🎯`) : t(`To hit ${fmt(f.target)} you need about ${fmt(f.neededPerDay || 0)} per open day.`, `Target ${fmt(f.target)} ke liye roz lagbhag ${fmt(f.neededPerDay || 0)} chahiye.`)) : t('Set a monthly target on the home screen to track it here.', 'Home screen par monthly target set karein.'),
          f.trendPct ? t(`Last 4 weeks are ${Math.abs(f.trendPct)}% ${f.trendPct > 0 ? 'up' : 'down'} on the 4 before.`, `Pichhle 4 hafte ${Math.abs(f.trendPct)}% ${f.trendPct > 0 ? 'upar' : 'neeche'}.`) : '',
          t(`Confidence: ${f.confidence} (${f.historyDays} days of history).`, `Bharosa: ${f.confidence} (${f.historyDays} din ka data).`),
        ].filter(Boolean),
      };
    }

    case 'best_day': {
      const f = forecastMonth(ctx.daily, ctx.today, 0);
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const open = f.weekdayAvg.map((v, i) => ({ i, v })).filter(x => !f.closedWeekdays.includes(x.i));
      if (f.historyDays < 14 || !open.length) return { text: t('Need two weeks of data to compare weekdays.', 'Din ki tulna ke liye 2 hafte ka data chahiye.'), tone: 'info' };
      const best = open.reduce((a, b) => (b.v > a.v ? b : a)), slow = open.reduce((a, b) => (b.v < a.v ? b : a));
      const full = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      return {
        text: t(`Busiest: ${full[best.i]} (~${fmt(best.v)}). Slowest: ${full[slow.i]} (~${fmt(slow.v)}).`, `Sabse accha din ${full[best.i]} (~${fmt(best.v)}), sabse dheema ${full[slow.i]} (~${fmt(slow.v)}).`),
        bullets: [...f.weekdayAvg.map((v, i) => `${days[i]}: ${f.closedWeekdays.includes(i) ? t('closed', 'band') : fmt(v)}`),
          t(`Idea: a "${full[slow.i]} special" offer to fill the slow day.`, `Idea: "${full[slow.i]} special" offer chalao.`)],
        copyText: writeMessage('slow_day', { day: full[slow.i], salon: salonName, offer: '20% off on hair spa & facials', phone }, p.lang),
        actions: [{ label: t('Make a poster', 'Poster banao'), route: 'Marketing', params: { prefill: { template: 'offer', headline: 'FLAT 20% OFF', subtext: `Every ${full[slow.i]}` } } }],
      };
    }

    case 'payments': {
      const list = await DBX.getPaymentBreakdown(p.period.start, p.period.end) as any[];
      const total = list.reduce((s, r) => s + (r.total || 0), 0);
      if (!total) return { text: t(`No payments ${per}.`, `${cap(per)} koi payment nahi.`), tone: 'info' };
      return {
        text: t(`Payments ${per}: ${fmt(total)}.`, `${cap(per)} ke payments: ${fmt(total)}.`),
        bullets: list.sort((a, b) => b.total - a.total).map(r => `${String(r.payment_method).toUpperCase()}: ${fmt(r.total)} (${Math.round((r.total / total) * 100)}%) · ${plural(r.count, 'bill')}`),
      };
    }

    case 'segments': {
      const segs = await BossAI.segments();
      return {
        text: t('Your clients, grouped by how they behave:', 'Aapke clients, unke vyavhaar ke hisaab se:'),
        bullets: segs.filter(s => s.count).map(s => `${s.label}: ${s.count}${perms.money ? ` · ${fmt(s.revenue)}` : ''} — ${s.action}`),
        clients: segs.find(s => s.seg === 'champion')?.clients.slice(0, 8).map(c => ({ id: c.id, name: c.name, phone: c.phone, sub: `${t('Champion', 'Champion')} · ${c.total_visits} visits` })),
      };
    }

    case 'alerts': {
      const al = await BossAI.alerts();
      if (!al.length) return { text: t('Nothing unusual in the last 30 days — discounts and cancellations look normal. ✅', 'Pichhle 30 din mein sab normal hai — discount aur cancel theek hain. ✅'), tone: 'success' };
      return { text: t(`${al.length} thing${al.length === 1 ? '' : 's'} worth checking:`, `${al.length} cheez${al.length === 1 ? '' : 'ein'} check karni chahiye:`), tone: al.some(a => a.severity === 'high') ? 'danger' : 'warning',
        bullets: al.map(a => `${a.severity === 'high' ? '🔴' : a.severity === 'medium' ? '🟠' : '🔵'} ${a.title} — ${a.detail}`),
        actions: [{ label: t('Bill history', 'Bill history'), route: 'BillHistory' }] };
    }

    case 'branches': {
      if (!perms.branches) return { text: t('Branch view is part of the Multi-Location plan. Connect your branches in Settings → Branches & Cloud.', 'Branch view Multi-Location plan mein hai. Settings → Branches & Cloud mein jodein.'), tone: 'info', actions: [{ label: t('Branches & Cloud', 'Branches & Cloud'), route: 'BranchHub' }] };
      const { BranchSyncService } = require('../BranchSyncService') as typeof import('../BranchSyncService');
      const all = await BranchSyncService.getCachedBranches();
      if (!all.length) return { text: t('No branch data yet. Pull the latest from Google Drive on the HQ screen.', 'Abhi branch data nahi hai. HQ screen par Drive se refresh karein.'), actions: [{ label: 'HQ Dashboard', route: 'HQDashboard' }] };
      const useToday = p.period.key === 'today';
      const rows = all.map(b => ({ name: b.branchName, v: useToday ? b.summary?.today?.revenue || 0 : b.summary?.month?.revenue || 0, bills: useToday ? b.summary?.today?.bills || 0 : b.summary?.month?.bills || 0, stale: b.stale }))
        .sort((a, b) => b.v - a.v);
      const total = rows.reduce((s, r) => s + r.v, 0);
      return {
        text: t(`All branches ${useToday ? 'today' : 'this month'}: ${fmt(total)}.`, `Saari branches ${useToday ? 'aaj' : 'is mahine'}: ${fmt(total)}.`),
        bullets: rows.map((r, i) => `${i + 1}. ${r.name}: ${fmt(r.v)} · ${r.bills} bills${r.stale ? t(' (not synced recently)', ' (sync purana)') : ''}`),
        actions: [{ label: 'HQ Dashboard', route: 'HQDashboard' }],
      };
    }

    case 'new_clients': {
      const list = ctx.clients.filter(c => { const d = String(c.created_at || '').slice(0, 10); return d >= p.period.start && d <= p.period.end; });
      return { text: t(`${list.length} new clients ${per}.`, `${cap(per)} ${list.length} naye clients.`),
        bullets: [t('Send each one a second-visit offer within 3 weeks — it is the cheapest way to make a regular.', 'Har naye client ko 3 hafte mein doosri visit ka offer bhejo.')],
        clients: list.slice(0, 15).map((c, i) => ({ id: c.id, name: c.name, phone: c.phone, sub: t('new', 'naya'), message: c.phone ? writeMessage('new_client', { name: firstName(c.name), salon: salonName, offer: '10% off', phone }, p.lang, i) : undefined })) };
    }

    case 'marketing': {
      const season = seasonFor(ctx.today);
      const occ = upcomingOccasions(ctx.today, 30);
      const msg = writeMessage('festival', { occasion: occ[0]?.name || season.title.split(' (')[0], salon: salonName, offer: 'Flat 20% off on facials & hair spa', phone }, p.lang, Math.floor(Math.random() * 2));
      return {
        text: t(`Season now: ${season.title}.`, `Abhi ka season: ${season.title}.`),
        bullets: [...season.ideas.map(i => `💡 ${i}`), ...occ.slice(0, 3).map(o => `📅 ${o.name} (${o.date}) — ${o.idea}`)],
        copyText: msg,
        actions: [{ label: t('Design a poster', 'Poster banao'), route: 'Marketing' }],
      };
    }

    case 'briefing': {
      const b = await BossAI.briefing({ money: perms.money });
      return { text: b.headline, bullets: b.lines.map(l => l.text) };
    }

    case 'help':
    case 'unknown':
    default:
      return {
        text: p.intent === 'help'
          ? t('Ask me anything about your salon — in English or Hinglish. For example:', 'Salon ke baare mein kuch bhi poochiye — English ya Hinglish mein. Jaise:')
          : t("I didn't quite get that. Try one of these:", 'Samajh nahi aaya. Inme se kuch poochiye:'),
        bullets: BossAI.suggestions(p.lang).slice(0, 8),
        tone: 'info',
      };
  }
}

function cap(s: string) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
