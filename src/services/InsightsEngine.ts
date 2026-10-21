/**
 * InsightsEngine — offline "smart insights" for the Business Insights screen.
 *
 * This is deliberately NOT a network AI call: it's a small set of rules and
 * averages computed from data already in the local SQLite database, so it
 * works with zero connectivity and no per-use cost. Every number here is
 * derived, never guessed — if there isn't enough history for a confident
 * read, the engine says so instead of inventing a trend.
 */
import { formatCurrency } from '../utils/helpers';
import { MarketingPrefill } from './MarketingTemplates';

export type InsightTone = 'success' | 'warning' | 'info' | 'danger';

export interface AtRiskClient {
  id: number; name: string; phone: string; total_spent: number; last_visit: string;
}
export interface RestockItem {
  id: number; name: string; quantity: number; unit: string; min_stock: number;
}

export interface Insight {
  id: string;
  icon: string;
  tone: InsightTone;
  title: string;
  detail: string;
  clients?: AtRiskClient[];
  items?: RestockItem[];
  navigateTo?: string;
  marketingPrefill?: MarketingPrefill;
}

interface DailyRevenueRow { date: string; revenue: number; bills: number }
interface ServiceRow { name: string; count: number; revenue: number }
interface StaffRow { id: number; name: string; total_revenue: number; total_bills: number }

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function buildInsights(input: {
  currencySymbol: string;
  dailyRevenue60: DailyRevenueRow[]; // last 60 days, any order, one row per day that had a bill
  start30: string; // YYYY-MM-DD cutoff separating "last 30 days" from the 30 days before that
  topServicesCurrent: ServiceRow[]; // last 30 days, sorted by revenue desc
  topServicesPrev: ServiceRow[]; // the 30 days before that
  staffPerf: StaffRow[]; // last 30 days, sorted by revenue desc
  atRiskClients: AtRiskClient[];
  restockItems: RestockItem[];
}): Insight[] {
  const { currencySymbol: sym } = input;
  const fmt = (n: number) => formatCurrency(n, sym);
  const insights: Insight[] = [];

  // ── Revenue trend & forecast ──────────────────────────────────────────
  const last30Rows = input.dailyRevenue60.filter(r => r.date >= input.start30);
  const prev30Rows = input.dailyRevenue60.filter(r => r.date < input.start30);
  const last30Sum = last30Rows.reduce((s, r) => s + (r.revenue || 0), 0);
  const prev30Sum = prev30Rows.reduce((s, r) => s + (r.revenue || 0), 0);

  if (last30Rows.length < 5) {
    insights.push({
      id: 'forecast_insufficient',
      icon: 'chart-line',
      tone: 'info',
      title: 'Still learning your business',
      detail: 'Keep billing through the app for a couple of weeks and insights here will get sharper — trends need some history to be reliable.',
    });
  } else {
    const avgDaily = last30Sum / 30;
    const changePct = prev30Sum > 0 ? ((last30Sum - prev30Sum) / prev30Sum) * 100 : 0;
    const dampened = clamp(changePct / 100, -0.3, 0.3) * 0.5;
    const forecast30 = avgDaily * 30 * (1 + dampened);
    const tone: InsightTone = changePct > 5 ? 'success' : changePct < -5 ? 'warning' : 'info';
    const trendWord = changePct > 5 ? 'trending up' : changePct < -5 ? 'trending down' : 'holding steady';
    insights.push({
      id: 'forecast',
      icon: changePct > 5 ? 'trending-up' : changePct < -5 ? 'trending-down' : 'chart-line',
      tone,
      title: prev30Sum > 0
        ? `Revenue ${trendWord}${prev30Sum > 0 ? ` ${Math.abs(Math.round(changePct))}%` : ''}`
        : 'Revenue pace this month',
      detail: prev30Sum > 0
        ? `${fmt(last30Sum)} in the last 30 days vs ${fmt(prev30Sum)} the 30 days before. At this pace, expect around ${fmt(forecast30)} next month.`
        : `${fmt(last30Sum)} in the last 30 days. At this pace, expect around ${fmt(forecast30)} next month.`,
    });
  }

  // ── At-risk high-value clients ────────────────────────────────────────
  if (input.atRiskClients.length > 0) {
    const topSpend = input.atRiskClients[0];
    insights.push({
      id: 'at_risk_clients',
      icon: 'account-alert-outline',
      tone: 'warning',
      title: input.atRiskClients.length === 1
        ? `${topSpend.name} hasn't visited in a while`
        : `${input.atRiskClients.length} valuable clients have gone quiet`,
      detail: `They've spent ${fmt(input.atRiskClients.reduce((s, c) => s + (c.total_spent || 0), 0))} with you in total but haven't been in recently. A quick win-back message often brings them straight back.`,
      clients: input.atRiskClients,
    });
  }

  // ── Restocking ─────────────────────────────────────────────────────────
  if (input.restockItems.length > 0) {
    const critical = input.restockItems.filter(i => i.quantity <= i.min_stock);
    insights.push({
      id: 'restock',
      icon: 'package-variant-closed',
      tone: critical.length > 0 ? 'danger' : 'warning',
      title: critical.length > 0
        ? `${critical.length} item${critical.length === 1 ? '' : 's'} below reorder level`
        : `${input.restockItems.length} item${input.restockItems.length === 1 ? '' : 's'} trending low`,
      detail: critical.length > 0
        ? `${critical.slice(0, 3).map(i => i.name).join(', ')}${critical.length > 3 ? ' and more' : ''} could run out soon. Restock before it affects a booking.`
        : `Usage looks steady but stock hasn't been topped up in a while. Worth a check before it becomes urgent.`,
      items: input.restockItems,
      navigateTo: 'Inventory',
    });
  }

  // ── Slowest / best day of week ─────────────────────────────────────────
  const byWeekday: Record<number, { sum: number; count: number }> = {};
  for (const row of input.dailyRevenue60) {
    const dow = new Date(`${row.date}T00:00:00`).getDay();
    if (!byWeekday[dow]) byWeekday[dow] = { sum: 0, count: 0 };
    byWeekday[dow].sum += row.revenue || 0;
    byWeekday[dow].count += 1;
  }
  const weekdayAverages = Object.entries(byWeekday)
    .map(([dow, v]) => ({ dow: Number(dow), avg: v.sum / v.count, count: v.count }))
    .filter(w => w.count >= 2);
  if (weekdayAverages.length >= 3) {
    const best = weekdayAverages.reduce((a, b) => (b.avg > a.avg ? b : a));
    const slow = weekdayAverages.reduce((a, b) => (b.avg < a.avg ? b : a));
    if (best.dow !== slow.dow && best.avg > 0) {
      insights.push({
        id: 'slow_day',
        icon: 'calendar-week',
        tone: 'info',
        title: `${WEEKDAYS[slow.dow]}s are your slowest day`,
        detail: `Averaging ${fmt(slow.avg)} vs ${fmt(best.avg)} on ${WEEKDAYS[best.dow]}s, your best. A ${WEEKDAYS[slow.dow]}-only offer could help even that out.`,
        navigateTo: 'Marketing',
        marketingPrefill: { template: 'offer', headline: 'FLAT 20% OFF', subtext: `Only on ${WEEKDAYS[slow.dow]}s` },
      });
    }
  }

  // ── Top / declining service ─────────────────────────────────────────────
  const currentNames = new Set(input.topServicesCurrent.map(s => s.name));
  const decliningService = input.topServicesPrev.find((s, i) => i < 5 && !currentNames.has(s.name));
  if (decliningService) {
    insights.push({
      id: 'declining_service',
      icon: 'trending-down',
      tone: 'warning',
      title: `"${decliningService.name}" has gone quiet`,
      detail: `It was one of your top sellers before, but hasn't had a booking in the last 30 days. A reminder post or a small offer could bring it back.`,
      navigateTo: 'Marketing',
      marketingPrefill: { template: 'service', headline: decliningService.name, subtext: 'We miss having you in for this — come back and try it again!' },
    });
  } else if (input.topServicesCurrent[0] && input.topServicesCurrent[0].revenue > 0) {
    const top = input.topServicesCurrent[0];
    insights.push({
      id: 'top_service',
      icon: 'star-outline',
      tone: 'success',
      title: `"${top.name}" is your top earner`,
      detail: `${top.count} sold for ${fmt(top.revenue)} in the last 30 days. Worth featuring in your next social post.`,
      navigateTo: 'Marketing',
      marketingPrefill: { template: 'service', headline: top.name },
    });
  }

  // ── Top staff ────────────────────────────────────────────────────────────
  const topStaff = input.staffPerf.find(s => s.total_revenue > 0);
  if (topStaff) {
    insights.push({
      id: 'top_staff',
      icon: 'account-star-outline',
      tone: 'success',
      title: `${topStaff.name} is leading the team`,
      detail: `${fmt(topStaff.total_revenue)} across ${topStaff.total_bills} bill${topStaff.total_bills === 1 ? '' : 's'} in the last 30 days.`,
    });
  }

  return insights;
}
