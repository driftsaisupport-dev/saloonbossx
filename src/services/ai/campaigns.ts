/**
 * Boss AI — marketing campaigns from the salon's OWN data, fully offline.
 *
 * Each idea says WHY (the number behind it), WHO (real clients with phone
 * numbers) and WHAT to send (a personalised message), plus a matching poster.
 * Sending is one WhatsApp chat at a time from the owner's own phone — free,
 * personal, and the way Indian salons already talk to customers. No bulk API.
 */
import { DBX, DatabaseService } from '../../database/Database';
import { BossAI } from './BossAI';
import { writeMessage, upcomingOccasions, seasonFor, MsgKind, Lang } from './analytics';
import { todayLocal } from '../../utils/helpers';
import type { MarketingPrefill } from '../MarketingTemplates';
import { appLocale, curSym } from '../../config/regions';

export interface CampaignClient { id: number; name: string; phone: string; sub?: string }
export interface CampaignIdea {
  id: string;
  icon: string;
  title: string;
  why: string;
  kind: MsgKind;
  offer: string;
  occasion?: string;
  day?: string;
  clients: CampaignClient[];
  poster?: MarketingPrefill;
  tone: 'primary' | 'success' | 'warning' | 'danger' | 'info';
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const first = (n: string) => String(n || '').trim().split(/\s+/)[0] || 'there';
const hasPhone = (c: any) => String(c?.phone || '').replace(/\D/g, '').length >= 10;

/** Personalised text for one client. */
export function messageFor(idea: Pick<CampaignIdea, 'kind' | 'offer' | 'occasion' | 'day'>, client: CampaignClient, salon: { name?: string; phone?: string }, lang: Lang = 'en', extra: Record<string, string> = {}): string {
  return writeMessage(idea.kind, {
    name: first(client.name), salon: salon.name || 'our salon', phone: salon.phone || '', offer: idea.offer,
    occasion: idea.occasion || '', day: idea.day || '', service: extra.service || 'visit', days: extra.days || '', link: extra.link || '',
  }, lang);
}

export async function campaignIdeas(): Promise<CampaignIdea[]> {
  const today = todayLocal();
  const ideas: CampaignIdea[] = [];
  const [due, segs, bdays, recent, reviewUrl, asked, fc] = await Promise.all([
    BossAI.dueBack(10).catch(() => []),
    BossAI.segments().catch(() => []),
    DatabaseService.getUpcomingBirthdays(7).catch(() => []) as Promise<any[]>,
    DBX.recentVisitors(10),
    DBX.getSetting('google_review_url').catch(() => ''),
    DBX.getSetting('review_asked').then(v => (v ? JSON.parse(v) : {})).catch(() => ({})),
    BossAI.forecast().catch(() => null),
  ]);

  // 1 · Google reviews from people who just visited (not asked in 60 days)
  const cutoff = Date.now() - 60 * 86400000;
  const toAsk = recent.filter(hasPhone).filter(c => !(asked[c.id] && asked[c.id] > cutoff));
  if (toAsk.length) {
    ideas.push({
      id: 'review', icon: 'star-circle', tone: 'warning', kind: 'review', offer: '',
      title: `Ask ${toAsk.length} recent customers for a Google review`,
      why: reviewUrl ? 'They visited in the last 10 days. Salons with more 5★ reviews rank higher on Google Maps.' : 'Add your Google review link first (Settings → Google reviews).',
      clients: toAsk.map(c => ({ id: c.id, name: c.name, phone: c.phone, sub: `visited ${String(c.last).slice(5, 10)}` })),
    });
  }

  // 2 · Due back (visit rhythm)
  const dueP = due.filter(hasPhone);
  if (dueP.length) {
    ideas.push({
      id: 'due', icon: 'calendar-clock', tone: 'primary', kind: 'due_visit', offer: '',
      title: `${dueP.length} regulars are due for their next visit`,
      why: 'Each client’s usual gap between visits says they should come this week.',
      clients: dueP.map(c => ({ id: c.id, name: c.name, phone: String(c.phone), sub: c.sub })),
    });
  }

  // 3 · Win-back (at risk + lost)
  const lostSeg = segs.filter(s => s.seg === 'at_risk' || s.seg === 'lost');
  const lost = lostSeg.flatMap(s => s.clients).filter(hasPhone).slice(0, 60);
  if (lost.length) {
    const value = lostSeg.reduce((a, s) => a + s.revenue, 0);
    ideas.push({
      id: 'winback', icon: 'account-heart', tone: 'danger', kind: 'winback', offer: '15% off',
      title: `Win back ${lost.length} customers who stopped coming`,
      why: `They have spent ${curSym()}${Math.round(value).toLocaleString(appLocale())} with you before. A personal offer brings 1 in 5 back.`,
      clients: lost.map((c: any) => ({ id: c.id, name: c.name, phone: c.phone, sub: c.last_visit ? `last visit ${String(c.last_visit).slice(0, 10)}` : '' })),
      poster: { template: 'offer', headline: 'We miss you!', subtext: '15% off your next visit', detail: 'Valid for 7 days' },
    });
  }

  // 4 · Birthdays this week
  const bd = bdays.filter(hasPhone);
  if (bd.length) {
    ideas.push({
      id: 'birthday', icon: 'cake-variant', tone: 'success', kind: 'birthday', offer: '20% off any service',
      title: `${bd.length} birthday${bd.length > 1 ? 's' : ''} in the next 7 days`,
      why: 'Birthday offers are the most-redeemed salon message.',
      clients: bd.map((c: any) => ({ id: c.id, name: c.name, phone: c.phone, sub: `🎂 ${String(c.date_of_birth).slice(5)}` })),
      poster: { template: 'birthday' },
    });
  }

  // 5 · Slow weekday
  if (fc && (fc as any).weekdayAvg) {
    const avg: number[] = (fc as any).weekdayAvg;
    const closed: number[] = (fc as any).closedWeekdays || [];
    const open = avg.map((v, i) => ({ v, i })).filter(x => !closed.includes(x.i) && x.v > 0);
    if (open.length >= 4) {
      const best = open.reduce((a, b) => (b.v > a.v ? b : a));
      const slow = open.reduce((a, b) => (b.v < a.v ? b : a));
      if (best.v > slow.v * 1.4) {
        const all = segs.filter(s => ['champion', 'loyal', 'regular', 'new'].includes(s.seg)).flatMap(s => s.clients).filter(hasPhone).slice(0, 80);
        ideas.push({
          id: 'slowday', icon: 'chart-line-variant', tone: 'info', kind: 'slow_day', offer: '20% off hair spa & facials', day: DAYS[slow.i],
          title: `Fill your quiet ${DAYS[slow.i]}s`,
          why: `${DAYS[slow.i]} earns ${curSym()}${Math.round(slow.v).toLocaleString(appLocale())} on average vs ${curSym()}${Math.round(best.v).toLocaleString(appLocale())} on ${DAYS[best.i]}.`,
          clients: all.map((c: any) => ({ id: c.id, name: c.name, phone: c.phone })),
          poster: { template: 'offer', headline: `${DAYS[slow.i]} Delight`, subtext: '20% off hair spa & facials', detail: `Every ${DAYS[slow.i]} this month` },
        });
      }
    }
  }

  // 6 · Festival / season
  const occ = upcomingOccasions(today, 21)[0];
  const season = seasonFor(today);
  const allP = segs.filter(s => s.seg !== 'lost').flatMap(s => s.clients).filter(hasPhone).slice(0, 120);
  if (allP.length) {
    const name = occ?.name || season.title.split(' (')[0];
    const idea = occ?.idea || season.ideas[0];
    ideas.push({
      id: 'festival', icon: 'party-popper', tone: 'warning', kind: 'festival', offer: idea, occasion: name,
      title: `${name} offer to ${allP.length} customers`,
      why: occ ? `${name} is on ${occ.date.slice(8)}/${occ.date.slice(5, 7)} — book them before your competitors do.` : `It is ${season.title} — ${season.ideas.slice(0, 2).join(', ')}.`,
      clients: allP.map((c: any) => ({ id: c.id, name: c.name, phone: c.phone })),
      poster: { template: 'festival', headline: name, subtext: idea },
    });
  }

  // 7 · Second visit for new customers
  const fresh = (segs.find(s => s.seg === 'new')?.clients || []).filter(hasPhone).slice(0, 60);
  if (fresh.length) {
    ideas.push({
      id: 'newclient', icon: 'account-plus', tone: 'success', kind: 'new_client', offer: '10% off',
      title: `Turn ${fresh.length} new customers into regulars`,
      why: 'A client who comes a second time is 3× more likely to become a regular.',
      clients: fresh.map((c: any) => ({ id: c.id, name: c.name, phone: c.phone })),
    });
  }
  return ideas;
}

/** Remember who got a review request so nobody is asked twice in 60 days. */
export async function markReviewAsked(ids: number[]) {
  try {
    const v = await DBX.getSetting('review_asked');
    const map: Record<string, number> = v ? JSON.parse(v) : {};
    const now = Date.now();
    for (const id of ids) map[id] = now;
    for (const k of Object.keys(map)) if (map[k] < now - 120 * 86400000) delete map[k];
    await DBX.setSetting('review_asked', JSON.stringify(map));
  } catch { /* best effort */ }
}

// ── Offline caption writer (posts, reels, status) ──────────────────────────
export type CaptionKind = 'work' | 'offer' | 'festival' | 'transformation' | 'team';
const HOOKS: Record<CaptionKind, string[]> = {
  work: ['Fresh look, fresh mood ✨', 'When the hair flip is just right 💁‍♀️', 'Glow that speaks for itself 🌟'],
  offer: ['Your sign to book that pampering session 💆‍♀️', 'Limited slots, unlimited glow ✨', 'Treat yourself — you deserve it 💖'],
  festival: ['Festive ready? We’ve got you ✨', 'Celebrate in style 🎉', 'Shine brighter this season 🪔'],
  transformation: ['Before ➡️ After. Need we say more? 😍', 'Swipe to see the magic ✨', 'Transformation Tuesday hits different 💫'],
  team: ['Meet the hands behind the magic 💇‍♀️', 'Our team, your glow ✨', 'Passion you can see in every detail 💖'],
};

export function writeCaptions(o: { kind: CaptionKind; salon: string; city?: string; service?: string; offer?: string; occasion?: string; phone?: string; bookingLink?: string }): string[] {
  const tagCity = (o.city || '').replace(/[^A-Za-z]/g, '');
  const svcTag = (o.service || '').replace(/[^A-Za-z]/g, '');
  const tags = ['#salon', '#beauty', '#hairstyle', '#makeup', tagCity && `#${tagCity}Salon`, tagCity && `#${tagCity}`, svcTag && `#${svcTag}`, '#glowup', '#selfcare']
    .filter(Boolean).join(' ');
  const cta = o.bookingLink ? `📲 Book online: ${o.bookingLink}` : o.phone ? `📞 Book: ${o.phone}` : '📲 DM to book';
  const where = `📍 ${o.salon}${o.city ? `, ${o.city}` : ''}`;
  const what = [o.service, o.offer, o.occasion && `${o.occasion} special`].filter(Boolean).join(' · ');
  return HOOKS[o.kind].map((hook, i) => [
    hook,
    what && (i === 1 ? `${what} 💫` : what),
    i === 2 ? 'Hinglish: Apna glow-up aaj hi book karein! 💖' : '',
    where, cta, '', tags,
  ].filter(x => x !== '' && x !== undefined && x !== null).join('\n').replace(/\n{3,}/g, '\n\n'));
}
