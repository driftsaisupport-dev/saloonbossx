/**
 * Online booking — customers book themselves, the salon confirms in the app.
 *
 *  Customer                     Owner's Google Drive (free)          Salon phone
 *  ────────                     ───────────────────────────          ───────────
 *  opens booking link  ───────▶ page shows menu + free slots ◀────── publishes menu, hours,
 *  (WhatsApp / Insta / Maps / QR)                                    busy blocks on every sync
 *  picks service, time ───────▶ request saved                ──────▶ pulled on sync → notification
 *                                                                    Accept → calendar + WhatsApp
 *
 * No server for the seller, no monthly fee: it rides on the same Apps Script
 * as Branches & Cloud. Without Drive the salon still gets a WhatsApp booking
 * link + QR.
 */
import * as Notifications from 'expo-notifications';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { DBX } from '../database/Database';
import { toLocalDateStr, todayLocal } from '../utils/helpers';
import { upiQrSvg } from '../utils/invoice';
import { escapeHtml as esc } from '../utils/sanitize';
import { WhatsAppService } from './WhatsAppService';
import { BossAI } from './ai/BossAI';
import { BOOKING_SITE, CLOUD_URL } from '../config/sales';
import { ReviewService } from './ReviewService';
import { appLocale, curSym, getRegion, internationalPhone } from '../config/regions';

export interface BookingConfig {
  enabled: boolean;
  open: string;            // "10:00"
  close: string;           // "21:00"
  closedDays: number[];    // 0 = Sunday
  slot: number;            // minutes between start times
  leadMin: number;         // earliest booking from now
  maxDays: number;         // how far ahead
  serviceKeys: string[];   // empty = all active services
  note: string;            // shown on the page
}

export const DEFAULT_BOOKING: BookingConfig = {
  enabled: false, open: '10:00', close: '21:00', closedDays: [], slot: 30, leadMin: 60, maxDays: 14, serviceKeys: [], note: '',
};

const pad = (n: number) => String(n).padStart(2, '0');
const toMin = (t: string) => { const [h, m] = String(t).split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const toHM = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
export const slugify = (v: string) => String(v || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const digits10 = (p: string) => String(p || '').replace(/\D/g, '').slice(-10);

/** A weekday with (almost) no bills in the last 8 weeks is the salon's off day. */
async function guessClosedDays(): Promise<number[]> {
  try {
    const from = toLocalDateStr(new Date(Date.now() - 56 * 86400000));
    const rows = await DBX.getRevenueByDateRange(from, todayLocal()) as any[];
    const open = new Array(7).fill(0);
    let days = 0;
    for (const r of rows) {
      if (!(r.bills > 0)) continue;
      days++;
      const [y, m, d] = String(r.date).split('-').map(Number);
      open[new Date(y, m - 1, d).getDay()]++;
    }
    if (days < 20) return [];
    return open.map((n, i) => (n <= 1 ? i : -1)).filter(i => i >= 0).slice(0, 2);
  } catch { return []; }
}

/** Tell the cloud on the next sync that this request is handled, so its slot frees up. */
async function queueResolved(remoteId: any, status: 'accepted' | 'declined') {
  if (!remoteId) return;
  try {
    const v = await DBX.getSetting('booking_resolved');
    const list: { id: string; status: string }[] = v ? JSON.parse(v) : [];
    const next = [...list.filter(x => x.id !== String(remoteId)), { id: String(remoteId), status }].slice(-300);
    await DBX.setSetting('booking_resolved', JSON.stringify(next));
  } catch { /* best effort — the slot is freed after 30 days anyway */ }
}

export const BookingService = {
  async getConfig(): Promise<BookingConfig> {
    try { const v = await DBX.getSetting('booking_config'); return { ...DEFAULT_BOOKING, ...(v ? JSON.parse(v) : {}) }; }
    catch { return { ...DEFAULT_BOOKING }; }
  },
  async saveConfig(c: BookingConfig) { await DBX.setSetting('booking_config', JSON.stringify(c)); },

  /** What the public page needs. Contains no client data — only free/busy times. */
  async buildProfile(): Promise<any> {
    const cfg = await this.getConfig();
    const [p, catalog, staff] = await Promise.all([DBX.getSalonProfile() as Promise<any>, DBX.getCatalogForSync(), DBX.getStaff() as Promise<any[]>]);
    const services = catalog.filter(s => s.is_active && (!cfg.serviceKeys.length || cfg.serviceKeys.includes(s.sync_key)))
      .map(s => ({ key: s.sync_key, name: s.name, category: s.category, price: s.price, duration: s.duration || 30 }));
    const from = todayLocal();
    const to = toLocalDateStr(new Date(Date.now() + cfg.maxDays * 86400000));
    const [reviewUrl, wantedSlug] = await Promise.all([ReviewService.get(), this.wantedSlug(p)]);
    return {
      v: 1, enabled: cfg.enabled, slug: wantedSlug, reviewUrl,
      salonName: p?.name || 'Salon', address: p?.address || '', city: p?.city || '',
      whatsapp: digits10(p?.phone || ''),
      // Universal edition: country, currency and time zone for the public page and the server checks.
      wa: internationalPhone(p?.phone || ''), dial: getRegion().dial, phoneLen: getRegion().phoneLen,
      sym: getRegion().symbol, locale: getRegion().locale, cur: getRegion().currency, country: getRegion().code,
      tzMin: -new Date().getTimezoneOffset(),
      services,
      staff: staff.filter(s => !/helper|front desk|reception/i.test(s.role || '')).map(s => ({ id: s.id, name: s.name })),
      hours: { open: cfg.open, close: cfg.close, closedDays: cfg.closedDays },
      slot: cfg.slot, leadMin: cfg.leadMin, maxDays: cfg.maxDays, note: cfg.note,
      busy: await DBX.getBusyBlocks(from, to),
    };
  },

  async bookingLink(): Promise<string> {
    const { BranchSyncService, cleanUrl } = require('./BranchSyncService') as typeof import('./BranchSyncService');
    const cfg = await BranchSyncService.getConfig();
    if (!cfg) return '';
    // Short link with the salon's name on the booking website.
    const slug = await DBX.getSetting('booking_slug').catch(() => '');
    // Only the seller's shared cloud is behind the booking website; an owner's
    // own script keeps its long link.
    if (BOOKING_SITE && slug && (cfg.hosted || cleanUrl(cfg.url) === cleanUrl(CLOUD_URL))) return `${BOOKING_SITE}/${slug}`;
    // v4 shared cloud: the key names the salon AND the branch. Older own-scripts: branch only.
    const key = cfg.hosted || (cfg.scriptVersion || 0) >= 4 ? `${cfg.chainId}-${cfg.branchId}` : cfg.branchId;
    return `${cfg.url}?book=${key}`;
  },

  /**
   * Opens the public booking data exactly like a customer's phone would (no
   * Google login involved) and says in plain words whether the link works.
   */
  async testLink(): Promise<{ ok: boolean; message: string; level?: 'ok' | 'warn' | 'error'; link?: string }> {
    const { BranchSyncService, cleanUrl } = require('./BranchSyncService') as typeof import('./BranchSyncService');
    const cfg = await BranchSyncService.getConfig();
    if (!cfg) return { ok: false, level: 'error', message: 'Cloud is not connected yet.' };
    const get = async (url: string, ms = 25000) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), ms);
      try { const r = await fetch(url, { signal: ctrl.signal }); return { status: r.status, text: await r.text() }; }
      finally { clearTimeout(t); }
    };
    try {
      // 1 · the cloud script (exactly what the booking website asks for)
      const key = `${cfg.chainId}-${cfg.branchId}`;
      const a = await get(`${cfg.url}?api=1&s=${encodeURIComponent(key)}`);
      if (/unable to open the file/i.test(a.text)) return { ok: false, level: 'error', message: 'Google says "unable to open the file": the cloud script link is wrong or its deployment was deleted. The /exec link must be deployed with "Who has access: Anyone".' };
      let d: any; try { d = JSON.parse(a.text); } catch { return { ok: false, level: 'error', message: 'The cloud script is not public. Deploy it with "Who has access: Anyone" and use the /exec link.' }; }
      if (d.ok && !d.profile) {
        return { ok: false, level: 'error', message: 'The cloud script is an old version (no short links, no booking website). Update it: script.google.com → paste the new BranchSync.gs → Deploy → Manage deployments → ✏️ → New version.' };
      }
      if (!d.ok) return { ok: false, level: 'error', message: d.message || 'Booking is not switched on yet. Tap "Save & publish".' };
      const what = `${d.profile.salonName || ''} · ${d.profile.services?.length || 0} services`;

      // 2 · the link customers actually open
      const link = await this.bookingLink();
      if (/script\.google(usercontent)?\.com/.test(link)) {
        const why = !BOOKING_SITE ? 'the booking website is not set up in this app (EXPO_PUBLIC_BOOKING_SITE)'
          : !(cfg.hosted || cleanUrl(cfg.url) === cleanUrl(CLOUD_URL)) ? 'this salon uses its own Google script, which the booking website does not serve'
          : 'the short link name is not registered yet — tap "Save & publish" once';
        return { ok: false, level: 'warn', link, message: `Booking works (${what}), but your link is a long Google link. Phones signed in to Google often show "unable to open the file" for it. Short link missing because ${why}.` };
      }
      // short link: the website must be online and point at THIS cloud
      try {
        const c = await get(`${BOOKING_SITE}/config.js?t=${Date.now()}`, 15000);
        const m = c.text.match(/SBX_API\s*=\s*"([^"]*)"/);
        if (c.status >= 400 || !m) return { ok: false, level: 'error', link, message: `The booking website ${BOOKING_SITE.replace(/^https:\/\//, '')} is not online yet (or config.js is missing). Upload the 4 files from booking-site/dist and turn on GitHub Pages.` };
        if (cleanUrl(m[1]) !== cleanUrl(cfg.url)) return { ok: false, level: 'error', link, message: 'The booking website points to a different cloud script. Run "npm run booking-site" with the current cloud link and upload config.js again.' };
      } catch {
        return { ok: true, level: 'warn', link, message: `Cloud works (${what}). Could not reach the booking website from this phone right now — open the link once to check.` };
      }
      return { ok: true, level: 'ok', link, message: `Working ✅ ${what}. Customers open ${link.replace(/^https:\/\//, '')}` };
    } catch (e: any) {
      return { ok: false, level: 'error', message: e?.name === 'AbortError' ? 'The cloud took too long. Check the internet and try again.' : 'No internet right now.' };
    }
  },

  /** "glow-beauty-parlour-vashi" — from the salon name + area, or what the owner typed. */
  async wantedSlug(profile?: any): Promise<string> {
    const custom = await DBX.getSetting('booking_slug_wanted').catch(() => '');
    if (custom) return slugify(custom);
    const p: any = profile || await DBX.getSalonProfile().catch(() => ({}));
    const full = slugify(String(p?.name || 'salon').replace(/\(demo\)/i, ''));
    // Short and recognisable: "Glow Beauty Parlour & Unisex Salon" → "glow-beauty"
    const GENERIC = /^(the|and|of|by|parlour|parlor|parlours|salon|salons|saloon|unisex|studio|studios|spa|family|ladies|gents|mens|womens|pvt|ltd|llp|centre|center|zone|point|hub|lounge|official|india)$/;
    const words = full.split('-').filter(w => w && !GENERIC.test(w));
    let name = words.join('-');
    if (name.replace(/-/g, '').length < 3) name = full;
    name = name.split('-').reduce((acc, w) => (acc.length + w.length + 1 > 22 && acc ? acc : acc ? `${acc}-${w}` : w), '');
    const area = slugify(p?.city || '');
    const areaShort = area.split('-')[0];
    return slugify(areaShort && !name.includes(areaShort) ? `${name}-${areaShort}` : name).slice(0, 32).replace(/-+$/, '');
  },

  /**
   * ONE TAP "Start online booking": switches on the cloud if needed, picks
   * sensible hours (weekly off day learnt from past bills), publishes the page
   * and returns the link. Throws a plain-language message on failure.
   */
  async quickStart(): Promise<string> {
    const { BranchSyncService } = require('./BranchSyncService') as typeof import('./BranchSyncService');
    let sync = await BranchSyncService.getConfig();
    if (!sync) {
      if (!BranchSyncService.hostedAvailable()) throw new Error('NEEDS_OWN_CLOUD');
      sync = await BranchSyncService.enableCloud();
    }
    const cur = await this.getConfig();
    const next: BookingConfig = { ...cur, enabled: true };
    if (!cur.closedDays.length) next.closedDays = await guessClosedDays();
    await this.saveConfig(next);
    await DBX.setSetting('booking_last_check', '0').catch(() => {});
    await BranchSyncService.syncBookings(sync);
    return this.bookingLink();
  },

  /** Works with no Drive at all: WhatsApp opens with a ready booking message. */
  async whatsappLink(): Promise<string> {
    const p: any = await DBX.getSalonProfile();
    const ph = digits10(p?.phone || '');
    if (ph.length !== 10) return '';
    return `https://wa.me/91${ph}?text=${encodeURIComponent(`Hi ${p?.name || ''}! I want to book an appointment.\nService: \nDay & time: `)}`;
  },

  /** Store requests pulled from Drive; notify the salon. Returns how many were new. */
  async receive(list: any[]): Promise<number> {
    const n = await DBX.saveBookingRequests(list);
    if (n > 0) {
      try {
        const first = list[0];
        await Notifications.scheduleNotificationAsync({
          content: {
            title: n === 1 ? '📅 New online booking' : `📅 ${n} new online bookings`,
            body: n === 1 ? `${first.name} · ${(first.services || []).map((s: any) => s.name).join(', ')} · ${first.date} ${first.time}` : 'Tap to accept them',
            data: { screen: 'OnlineBooking' },
          },
          trigger: null,
        });
      } catch { /* notifications not permitted */ }
    }
    return n;
  },

  /**
   * Accept: add the client if new, put the booking in the calendar with the
   * chosen stylist (or the first one free), and open WhatsApp to confirm.
   */
  async accept(req: any): Promise<{ ok: boolean; message: string; appointmentId?: number }> {
    const services = await DBX.getServices() as any[];
    const names: string[] = (req.services || []).map((s: any) => s.name);
    const ids = (req.services || []).map((s: any) => services.find(x => x.sync_key === s.key || String(x.name).toLowerCase() === String(s.name).toLowerCase())?.id).filter(Boolean);
    const total = (req.services || []).reduce((a: number, s: any) => a + (Number(s.price) || 0), 0);

    let client = await DBX.findClientByPhone(req.phone);
    if (!client) {
      const id = await DBX.addClient({ name: req.name, phone: req.phone, referral_source: 'Online booking' });
      client = await DBX.getClient(Number(id));
    }
    const staff = await DBX.getStaff() as any[];
    const order = req.staff_id ? [staff.find(s => s.id === req.staff_id), ...staff.filter(s => s.id !== req.staff_id)] : staff;
    const end = toHM(toMin(req.time) + (Number(req.duration) || 30));
    let apptId = 0, usedStaff: any = null, lastErr = '';
    for (const st of order.filter(Boolean)) {
      try {
        apptId = Number(await DBX.addAppointment({
          client_id: client?.id || 0, staff_id: st.id, service_ids: ids, service_names: names.join(', '),
          date: req.date, start_time: req.time, end_time: end, total_amount: total,
          notes: `Online booking ${req.remote_id || ''}${req.note ? ` · ${req.note}` : ''}`,
        }));
        usedStaff = st; break;
      } catch (e: any) { lastErr = e?.message || ''; }
      if (req.staff_id) break; // customer asked for this stylist — do not silently swap
    }
    if (!apptId) {
      return { ok: false, message: /CONFLICT/.test(lastErr) ? 'That time is already booked. Use "Suggest another time".' : (lastErr || 'Could not add to the calendar.') };
    }
    await DBX.setBookingStatus(req.id, 'accepted', apptId);
    await queueResolved(req.remote_id, 'accepted');
    BossAI.invalidate();
    const p: any = await DBX.getSalonProfile();
    const nice = new Date(`${req.date}T00:00:00`).toLocaleDateString(appLocale(), { weekday: 'short', day: 'numeric', month: 'short' });
    WhatsAppService.sendMessage(req.phone,
      `Hi ${String(req.name).split(' ')[0]}! ✅ Your booking at ${p?.name || 'our salon'} is confirmed.\n\n📅 ${nice}, ${req.time}\n💇 ${names.join(', ')}${usedStaff ? `\n👤 ${usedStaff.name}` : ''}\n\nSee you soon! Reply here if you need to change the time.${p?.address ? `\n📍 ${p.address}` : ''}`);
    return { ok: true, message: 'Added to the calendar. WhatsApp confirmation opened.', appointmentId: apptId };
  },

  async decline(req: any, reason: 'full' | 'closed' = 'full') {
    await DBX.setBookingStatus(req.id, 'declined');
    await queueResolved(req.remote_id, 'declined');
    const p: any = await DBX.getSalonProfile();
    const link = await this.bookingLink();
    WhatsAppService.sendMessage(req.phone,
      `Hi ${String(req.name).split(' ')[0]}, thank you for booking with ${p?.name || 'us'} 🙏 Sorry, ${reason === 'closed' ? 'we are closed' : 'we are fully booked'} at ${req.time} on ${req.date}.${link ? `\nPlease pick another time here: ${link}` : ' Please reply with another time that suits you.'}`);
  },

  /** Free start times on a date for a duration — used for "suggest another time". */
  async freeSlots(date: string, duration: number, max = 4): Promise<string[]> {
    const cfg = await this.getConfig();
    const busy = (await DBX.getBusyBlocks(date, date))[date] || [];
    const staffN = Math.max(1, ((await DBX.getStaff()) as any[]).length);
    const out: string[] = [];
    const now = new Date();
    for (let m = toMin(cfg.open); m + duration <= toMin(cfg.close) && out.length < max; m += cfg.slot) {
      if (date === todayLocal() && m < now.getHours() * 60 + now.getMinutes() + cfg.leadMin) continue;
      const e = m + duration;
      const overlapping = busy.filter(b => toMin(b.s) < e && m < toMin(b.e)).length;
      if (overlapping < staffN) out.push(toHM(m));
    }
    return out;
  },

  async suggest(req: any) {
    let slots = await this.freeSlots(req.date, Number(req.duration) || 30);
    let date = req.date;
    if (!slots.length) { date = toLocalDateStr(new Date(new Date(`${req.date}T00:00:00`).getTime() + 86400000)); slots = await this.freeSlots(date, Number(req.duration) || 30); }
    await DBX.setBookingStatus(req.id, 'suggested');
    await queueResolved(req.remote_id, 'declined');
    const p: any = await DBX.getSalonProfile();
    WhatsAppService.sendMessage(req.phone,
      `Hi ${String(req.name).split(' ')[0]}! Thanks for booking with ${p?.name || 'us'} 🙏 ${req.time} on ${req.date} is taken.\n${slots.length ? `We can do ${date}: ${slots.join(', ')}.\nReply with the time that suits you 😊` : 'Please reply with another day and time.'}`);
  },

  /** Printable A5 poster: "Scan to book" with QR + top services. */
  async sharePoster(): Promise<void> {
    const [p, link, wa, catalog] = await Promise.all([DBX.getSalonProfile() as Promise<any>, this.bookingLink(), this.whatsappLink(), DBX.getServices() as Promise<any[]>]);
    const target = link || wa;
    if (!target) throw new Error('Add the salon phone number (Settings → Salon Profile) or connect Google Drive first.');
    const qr = upiQrSvg(target, 6);
    // Best sellers first (what walk-in customers actually come for), not the
    // first rows of the menu (which is often ₹12,000 bridal makeup).
    const sold = await DBX.getTopServices(toLocalDateStr(new Date(Date.now() - 90 * 86400000)), todayLocal(), 8).catch(() => []) as any[];
    const top = [...sold.map(t => catalog.find(c => c.name === t.name)).filter(Boolean), ...[...catalog].sort((a, b) => a.price - b.price)]
      .filter((s, i, a) => a.indexOf(s) === i).slice(0, 8);
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      @page{size:A5;margin:10mm}body{font-family:Helvetica,Arial,sans-serif;text-align:center;color:#111}
      .top{background:#0b0b0b;color:#fff;border-radius:14px;padding:18px}.top h1{margin:0;font-size:28px}.gold{color:#d9a441;font-weight:800;letter-spacing:2px}
      .qr{margin:18px auto}.qr svg{width:230px;height:230px}.big{font-size:22px;font-weight:900;margin:6px 0}
      table{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}td{padding:5px;border-bottom:1px solid #eee;text-align:left}td.r{text-align:right;font-weight:700}
      .f{color:#888;font-size:11px;margin-top:10px}
    </style></head><body>
      <div class="top"><div class="gold">BOOK ONLINE · 24×7</div><h1>${esc(p?.name || 'Our Salon')}</h1><div>${esc([p?.address, p?.city].filter(Boolean).join(', '))}</div></div>
      <div class="big">📱 Scan to book your appointment</div>
      <div class="qr">${qr}</div>
      <div>${link ? 'Pick your service & time — we confirm on WhatsApp' : 'Opens WhatsApp with a booking message'}</div>
      <table>${top.map(s => `<tr><td>${esc(s.name)}</td><td class="r">${esc(curSym())}${Number(s.price).toLocaleString(appLocale())}</td></tr>`).join('')}</table>
      <div class="f">${p?.phone ? `Call / WhatsApp: ${esc(p.phone)}` : ''}</div>
    </body></html>`;
    const { uri } = await Print.printToFileAsync({ html });
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Booking QR poster' });
  },
};
