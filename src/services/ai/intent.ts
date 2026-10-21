/**
 * Boss AI — question understanding, fully offline.
 *
 * Owners type the way they talk: "aaj kitna hua", "pichle mahine ka profit",
 * "Priya kab aayi thi", "stock khatam", "आज की कमाई". This maps English,
 * Hinglish and common Hindi words to an intent + a date range. It is a
 * keyword scorer, not a language model, so it is predictable, instant and
 * never invents numbers — the answer always comes from the database.
 *
 * No imports, so it runs in plain Node for tests.
 */

export type Intent =
  | 'revenue' | 'bills' | 'profit' | 'expenses' | 'top_services' | 'top_staff' | 'staff_one'
  | 'client_one' | 'lapsed' | 'due_visits' | 'dues' | 'stock' | 'appointments' | 'birthdays'
  | 'forecast' | 'best_day' | 'payments' | 'segments' | 'alerts' | 'branches' | 'briefing'
  | 'avg_bill' | 'new_clients' | 'marketing' | 'help' | 'unknown';

export type PeriodKey = 'today' | 'yesterday' | 'tomorrow' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'last_7' | 'last_30' | 'last_90' | 'this_year' | 'month';

export interface Period { key: PeriodKey; start: string; end: string; label: string; labelHi: string }

export interface Parsed {
  intent: Intent;
  period: Period;
  periodExplicit: boolean;
  lang: 'en' | 'hinglish';
  name?: string;          // matched client / staff name
  nameId?: number;
  compare: boolean;
  raw: string;
}

const KW: Record<Exclude<Intent, 'unknown' | 'staff_one' | 'client_one'>, string[]> = {
  revenue: ['revenue', 'sale', 'sales', 'collection', 'collect', 'income', 'earning', 'earn', 'kamai', 'kamaya', 'kamaai', 'dhanda', 'dhandha', 'galla', 'turnover', 'kitna hua', 'kitna aaya', 'kitne paise', 'paisa', 'paise', 'कमाई', 'बिक्री', 'कलेक्शन', 'धंधा', 'कितना'],
  bills: ['bills', 'bill count', 'kitne bill', 'how many bill', 'footfall', 'customers came', 'kitne customer', 'kitne client', 'kitne log', 'invoices', 'बिल'],
  profit: ['profit', 'munafa', 'munaafa', 'fayda', 'faayda', 'margin', 'net', 'bachat', 'loss', 'nuksan', 'मुनाफा', 'फायदा'],
  expenses: ['expense', 'expenses', 'kharcha', 'kharche', 'kharch', 'spend', 'spent on', 'cost', 'rent', 'खर्च', 'खर्चा'],
  top_services: ['top service', 'best service', 'popular', 'sabse zyada', 'sabse jyada', 'which service', 'kaunsi service', 'konsi service', 'best seller', 'bestseller', 'services chal', 'service chal', 'सर्विस'],
  top_staff: ['staff', 'stylist', 'stylists', 'team', 'accha staff', 'top staff', 'best staff', 'best stylist', 'top stylist', 'staff performance', 'kaun sabse', 'kon sabse', 'leaderboard', 'employee', 'karigar', 'staff ranking', 'स्टाफ'],
  lapsed: ['lapsed', 'lost client', 'lost customer', 'not visited', 'nahi aaye', 'nahi aaya', 'nahi aayi', 'inactive', 'missing', 'gone quiet', 'wapas', 'win back', 'winback', 'churn', 'chale gaye', 'nahi aate'],
  due_visits: ['due for visit', 'due this week', 'aane wale', 'aane waale', 'aane wala', 'aane wali', 'kaun aane', 'kon aane', 'should come', 'coming back', 'next visit', 'expected', 'kaun aayega', 'kon aayega', 'reminder bhej', 'follow up', 'followup', 'call list', 'who to call', 'kisko call'],
  dues: ['due', 'dues', 'udhaar', 'udhar', 'udhari', 'baki', 'baaki', 'pending payment', 'outstanding', 'credit', 'bakaya', 'उधार', 'बकाया', 'बाकी'],
  stock: ['stock', 'inventory', 'maal', 'saman', 'samaan', 'khatam', 'low stock', 'reorder', 'product', 'expire', 'expiry', 'स्टॉक', 'माल'],
  appointments: ['appointment', 'appointments', 'booking', 'bookings', 'schedule', 'slot', 'slots', 'अपॉइंटमेंट', 'बुकिंग'],
  birthdays: ['birthday', 'birthdays', 'janamdin', 'janmdin', 'bday', 'anniversary', 'जन्मदिन'],
  forecast: ['forecast', 'predict', 'prediction', 'month end', 'kitna hoga', 'target', 'projection', 'estimate', 'expected revenue', 'lakshya', 'goal', 'टारगेट'],
  best_day: ['best day', 'slow day', 'slowest', 'busiest', 'kaunsa din', 'konsa din', 'which day', 'weekday', 'din accha', 'rush'],
  payments: ['upi', 'cash', 'card', 'payment mode', 'payment method', 'online payment', 'gpay', 'phonepe', 'paytm', 'नकद'],
  segments: ['segment', 'segments', 'champion', 'loyal', 'vip', 'best customer', 'best client', 'top client', 'top customer', 'regular customer', 'pakke customer'],
  alerts: ['alert', 'alerts', 'leak', 'leakage', 'theft', 'chori', 'fraud', 'discount', 'cancelled', 'cancel', 'suspicious', 'gadbad', 'galat'],
  branches: ['branch', 'branches', 'all salon', 'all outlet', 'outlets', 'chain', 'saare salon', 'sabhi salon', 'har branch', 'locations', 'शाखा'],
  briefing: ['business', 'briefing', 'summary', 'report', 'overview', 'how is business', 'kaisa chal', 'kya haal', 'status', 'update', 'good morning', 'aaj ka hisaab', 'hisaab', 'hisab', 'हिसाब'],
  avg_bill: ['average bill', 'avg bill', 'average ticket', 'ticket size', 'per customer', 'per client', 'aov', 'average spend', 'ek customer kitna'],
  new_clients: ['new client', 'new customer', 'naye customer', 'naye client', 'naya customer', 'first visit', 'नए ग्राहक'],
  marketing: ['offer', 'campaign', 'marketing', 'promotion', 'poster', 'message likh', 'whatsapp message', 'festival', 'diwali', 'idea', 'ideas', 'kya offer', 'grow', 'badhana', 'increase sales', 'more customers', 'zyada customer'],
  help: ['help', 'what can you', 'kya kar sakte', 'kya puch', 'madad', 'commands', 'examples'],
};

const HINGLISH_MARKERS = ['aaj', 'kal', 'kitna', 'kitne', 'kaun', 'kon', 'hua', 'hai', 'tha', 'thi', 'mahine', 'mahina', 'hafte', 'hafta', 'ka', 'ki', 'ke', 'kya', 'kab', 'nahi', 'sabse', 'pichle', 'pichhle', 'wala', 'wale', 'wali', 'kharcha', 'kamai', 'udhaar', 'baki', 'baaki', 'batao', 'bata', 'koi', 'aur', 'mein', 'kaise', 'kaunsa', 'kaunsi', 'chahiye', 'dikhao', 'do', 'hoga', 'aaye', 'aayi'];

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_FULL = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

export function periodFor(key: PeriodKey, now: Date, monthIndex?: number): Period {
  const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const shift = (n: number) => { const x = new Date(d0); x.setDate(x.getDate() + n); return x; };
  const monday = shift(-((d0.getDay() + 6) % 7));
  switch (key) {
    case 'today': return { key, start: ymd(d0), end: ymd(d0), label: 'today', labelHi: 'aaj' };
    case 'yesterday': return { key, start: ymd(shift(-1)), end: ymd(shift(-1)), label: 'yesterday', labelHi: 'kal' };
    case 'tomorrow': return { key, start: ymd(shift(1)), end: ymd(shift(1)), label: 'tomorrow', labelHi: 'kal' };
    case 'this_week': return { key, start: ymd(monday), end: ymd(d0), label: 'this week', labelHi: 'is hafte' };
    case 'last_week': { const s = new Date(monday); s.setDate(s.getDate() - 7); const e = new Date(monday); e.setDate(e.getDate() - 1); return { key, start: ymd(s), end: ymd(e), label: 'last week', labelHi: 'pichhle hafte' }; }
    case 'last_month': { const s = new Date(d0.getFullYear(), d0.getMonth() - 1, 1); const e = new Date(d0.getFullYear(), d0.getMonth(), 0); return { key, start: ymd(s), end: ymd(e), label: 'last month', labelHi: 'pichhle mahine' }; }
    case 'last_7': return { key, start: ymd(shift(-6)), end: ymd(d0), label: 'in the last 7 days', labelHi: 'pichhle 7 din' };
    case 'last_30': return { key, start: ymd(shift(-29)), end: ymd(d0), label: 'in the last 30 days', labelHi: 'pichhle 30 din' };
    case 'last_90': return { key, start: ymd(shift(-89)), end: ymd(d0), label: 'in the last 3 months', labelHi: 'pichhle 3 mahine' };
    case 'this_year': return { key, start: `${d0.getFullYear()}-01-01`, end: ymd(d0), label: 'this year', labelHi: 'is saal' };
    case 'month': {
      const m = monthIndex ?? d0.getMonth();
      const y = m > d0.getMonth() ? d0.getFullYear() - 1 : d0.getFullYear();
      const s = new Date(y, m, 1), e = new Date(y, m + 1, 0);
      const end = e > d0 ? d0 : e;
      const nm = MONTH_FULL[m][0].toUpperCase() + MONTH_FULL[m].slice(1);
      return { key, start: ymd(s), end: ymd(end), label: `${nm} ${y}`, labelHi: `${nm} ${y}` };
    }
    case 'this_month':
    default: return { key: 'this_month', start: ymd(new Date(d0.getFullYear(), d0.getMonth(), 1)), end: ymd(d0), label: 'this month', labelHi: 'is mahine' };
  }
}

const has = (t: string, w: string) => {
  if (/[^\x00-\x7F]/.test(w)) return t.includes(w);           // Devanagari: substring
  if (w.includes(' ')) return t.includes(w);
  return new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(t);
};

function detectPeriod(t: string, now: Date, intentHint: Intent): { period: Period; explicit: boolean } {
  const P = (k: PeriodKey, m?: number) => ({ period: periodFor(k, now, m), explicit: true });
  if (/(last|pichle|pichhle|previous)\s*(7|seven|saat)\s*(days|din)/.test(t)) return P('last_7');
  if (/(last|pichle|pichhle)\s*(30|thirty|tees)\s*(days|din)/.test(t)) return P('last_30');
  if (/(last|pichle|pichhle)\s*(3|three|teen)\s*(months|mahine)/.test(t) || has(t, 'quarter')) return P('last_90');
  if (has(t, 'last month') || has(t, 'pichle mahine') || has(t, 'pichhle mahine') || has(t, 'previous month') || has(t, 'pichla mahina') || t.includes('पिछले महीने')) return P('last_month');
  if (has(t, 'this month') || has(t, 'is mahine') || has(t, 'is month') || has(t, 'mahine ka') || has(t, 'month') || has(t, 'mahina') || t.includes('इस महीने')) return P('this_month');
  if (has(t, 'last week') || has(t, 'pichle hafte') || has(t, 'pichhle hafte') || has(t, 'previous week')) return P('last_week');
  if (has(t, 'this week') || has(t, 'is hafte') || has(t, 'hafte') || has(t, 'week') || has(t, 'hafta')) return P('this_week');
  if (has(t, 'this year') || has(t, 'is saal') || has(t, 'year') || has(t, 'saal')) return P('this_year');
  if (has(t, 'yesterday') || t.includes('कल')) return P('yesterday');
  if (has(t, 'tomorrow')) return P('tomorrow');
  if (has(t, 'kal')) return P(intentHint === 'appointments' || intentHint === 'birthdays' ? 'tomorrow' : 'yesterday');
  if (has(t, 'today') || has(t, 'aaj') || has(t, 'abhi tak') || t.includes('आज')) return P('today');
  for (let i = 0; i < 12; i++) {
    if (has(t, MONTH_FULL[i]) || (MONTHS[i] !== 'may' && has(t, MONTHS[i]))) return P('month', i);
  }
  return { period: periodFor(intentHint === 'appointments' || intentHint === 'revenue' || intentHint === 'bills' || intentHint === 'briefing' ? 'today' : 'this_month', now), explicit: false };
}

/**
 * Parse a question. `names` lets it recognise a client or staff member by name
 * ("Priya kab aayi", "Rahul ka performance"). Longest name match wins.
 */
export function parseQuestion(raw: string, now: Date = new Date(), names: { clients?: { id: number; name: string }[]; staff?: { id: number; name: string }[] } = {}): Parsed {
  const t = ' ' + String(raw || '').toLowerCase().replace(/[?!.,।]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  const lang: 'en' | 'hinglish' = /[ऀ-ॿ]/.test(t) || HINGLISH_MARKERS.filter(w => t.includes(w)).length >= 2 ? 'hinglish' : 'en';

  // Score intents by keyword hits (longer keywords weigh more).
  const scores = new Map<Intent, number>();
  for (const [intent, words] of Object.entries(KW) as [Intent, string[]][]) {
    let s = 0;
    for (const w of words) if (has(t, w)) s += w.length >= 8 ? 3 : w.length >= 5 ? 2 : 1;
    if (s) scores.set(intent, s);
  }

  // Name matching — staff first (fewer, more specific), then clients.
  const match = (list?: { id: number; name: string }[]) => {
    let best: { id: number; name: string } | undefined;
    for (const p of list || []) {
      const n = String(p.name || '').toLowerCase().trim();
      if (n.length < 3) continue;
      const first = n.split(' ')[0];
      if (t.includes(` ${n} `) || t.includes(` ${n}`) || (first.length >= 4 && has(t, first))) {
        if (!best || n.length > best.name.length) best = p;
      }
    }
    return best;
  };
  const staff = match(names.staff);
  const client = staff ? undefined : match(names.clients);

  let intent: Intent = 'unknown';
  let top = 0;
  for (const [k, v] of scores) if (v > top) { top = v; intent = k; }

  // Tie-breaks that matter in practice.
  if (scores.has('profit')) intent = 'profit';
  else if (scores.has('forecast') && (scores.get('forecast') || 0) >= (scores.get('revenue') || 0)) intent = 'forecast';
  else if (scores.has('due_visits')) intent = 'due_visits';
  else if (scores.has('dues') && !scores.has('due_visits') && (scores.get('dues') || 0) >= top - 1 && !/due for|due this/.test(t)) intent = 'dues';
  if (intent === 'alerts' && scores.has('top_staff')) intent = 'alerts';
  if (scores.has('branches') && (intent === 'revenue' || intent === 'unknown' || intent === 'briefing' || intent === 'bills')) intent = 'branches';

  if (staff && (intent === 'unknown' || intent === 'top_staff' || intent === 'revenue' || intent === 'bills')) intent = 'staff_one';
  if (client && (intent === 'unknown' || intent === 'bills' || intent === 'revenue' || intent === 'dues' || /kab|last visit|aayi|aaya|visit|history/.test(t))) intent = 'client_one';

  const { period, explicit } = detectPeriod(t, now, intent);
  if (intent === 'unknown' && explicit) intent = 'revenue'; // "aaj?" / "yesterday" alone → takings

  const compare = /( vs |versus|compare|compared|tulna|se zyada|se kam|than last|better than|growth|badha|ghata|increase|decrease)/.test(t);

  return {
    intent, period, periodExplicit: explicit, lang, compare, raw,
    name: (staff || client)?.name, nameId: (staff || client)?.id,
  };
}

/** Same-length window immediately before `p` — for "vs last period" comparisons. */
export function previousPeriod(p: Period): Period {
  const s = new Date(p.start + 'T00:00:00'), e = new Date(p.end + 'T00:00:00');
  if (p.key === 'this_month' || p.key === 'month') {
    const ps = new Date(s.getFullYear(), s.getMonth() - 1, 1);
    const pe = new Date(ps.getFullYear(), ps.getMonth(), Math.min(e.getDate(), new Date(ps.getFullYear(), ps.getMonth() + 1, 0).getDate()));
    return { key: 'month', start: ymd(ps), end: ymd(pe), label: 'the same days last month', labelHi: 'pichhle mahine isi samay tak' };
  }
  if (p.key === 'today') { const y = new Date(s); y.setDate(y.getDate() - 1); return { key: 'yesterday', start: ymd(y), end: ymd(y), label: 'yesterday', labelHi: 'kal' }; }
  if (p.key === 'yesterday') { const y = new Date(s); y.setDate(y.getDate() - 1); return { key: 'yesterday', start: ymd(y), end: ymd(y), label: 'the day before', labelHi: 'parson' }; }
  if (p.key === 'this_week') { const ps = new Date(s); ps.setDate(ps.getDate() - 7); const pe = new Date(e); pe.setDate(pe.getDate() - 7); return { key: 'last_week', start: ymd(ps), end: ymd(pe), label: 'the same days last week', labelHi: 'pichhle hafte isi samay tak' }; }
  const len = Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
  const pe = new Date(s); pe.setDate(pe.getDate() - 1);
  const ps = new Date(pe); ps.setDate(ps.getDate() - (len - 1));
  return { key: p.key, start: ymd(ps), end: ymd(pe), label: 'the period before', labelHi: 'usse pehle' };
}

export const SUGGESTED_QUESTIONS: { en: string; hi: string }[] = [
  { en: "How much did we make today?", hi: 'Aaj kitna collection hua?' },
  { en: 'Profit this month', hi: 'Is mahine ka profit kitna hai?' },
  { en: 'Month-end forecast', hi: 'Mahine ke end tak kitna hoga?' },
  { en: 'Who is due for a visit this week?', hi: 'Is hafte kaun aane wala hai?' },
  { en: 'Top staff this month', hi: 'Sabse accha staff kaun hai?' },
  { en: 'Which clients stopped coming?', hi: 'Kaun se customer nahi aaye?' },
  { en: 'Pending dues', hi: 'Kitna udhaar baaki hai?' },
  { en: 'Any suspicious discounts or cancellations?', hi: 'Koi gadbad discount ya cancel?' },
  { en: 'Best selling services', hi: 'Kaunsi service sabse zyada chalti hai?' },
  { en: 'Give me an offer idea', hi: 'Koi offer idea do' },
];
