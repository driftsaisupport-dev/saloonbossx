/**
 * Business types offered at setup. Each brings a ready service menu priced for
 * a typical Indian mid-market salon, so a new owner bills within two minutes
 * instead of typing 25 services. Prices are starting points — owners edit
 * them in Services, and head office can override them for a whole chain.
 *
 * Stored as setting 'business_type'. Also drives the dashboard's quick-action
 * order (see quickActionOrder) so a barbershop sees the walk-in queue first
 * and a bridal studio sees appointments and client notes first.
 *
 * Pure data + small helpers — no imports, safe anywhere (incl. tests).
 */
export type BusinessType =
  | 'mens' | 'unisex' | 'parlour' | 'bridal' | 'spa' | 'nails'
  | 'clinic' | 'academy' | 'chain' | 'home';

export interface SvcSeed { name: string; category: string; price: number; duration: number }

export interface BusinessTypeMeta {
  id: BusinessType;
  title: string;
  titleHi: string;
  titleMr: string;
  icon: string;
  blurb: string;
}

/** In the order the owner sees them. */
export const BUSINESS_TYPES: BusinessTypeMeta[] = [
  { id: 'mens', title: "Men's salon / barbershop", titleHi: 'जेंट्स सैलून / नाई की दुकान', titleMr: 'जेंट्स सलून / न्हावी दुकान', icon: 'mustache', blurb: 'Haircut, beard, shave · walk-in tokens' },
  { id: 'unisex', title: 'Unisex salon', titleHi: 'यूनिसेक्स सैलून', titleMr: 'युनिसेक्स सलून', icon: 'account-multiple-outline', blurb: 'Hair, skin, nails for everyone' },
  { id: 'parlour', title: 'Ladies beauty parlour', titleHi: 'लेडीज़ ब्यूटी पार्लर', titleMr: 'लेडीज ब्युटी पार्लर', icon: 'face-woman-shimmer-outline', blurb: 'Threading, waxing, facials, hair' },
  { id: 'bridal', title: 'Bridal & makeup studio', titleHi: 'ब्राइडल और मेकअप स्टूडियो', titleMr: 'ब्रायडल आणि मेकअप स्टुडिओ', icon: 'diamond-stone', blurb: 'Bridal, party, mehendi, draping' },
  { id: 'spa', title: 'Spa & wellness', titleHi: 'स्पा और वेलनेस', titleMr: 'स्पा आणि वेलनेस', icon: 'spa-outline', blurb: 'Massages, scrubs, therapies' },
  { id: 'nails', title: 'Nail studio', titleHi: 'नेल स्टूडियो', titleMr: 'नेल स्टुडिओ', icon: 'hand-back-right-outline', blurb: 'Gel, extensions, nail art' },
  { id: 'clinic', title: 'Skin & hair clinic', titleHi: 'स्किन और हेयर क्लिनिक', titleMr: 'स्किन आणि हेअर क्लिनिक', icon: 'medical-bag', blurb: 'Peels, laser, PRP · consultation notes' },
  { id: 'academy', title: 'Salon academy', titleHi: 'सैलून अकादमी', titleMr: 'सलून अकादमी', icon: 'school-outline', blurb: 'Salon menu plus courses & students' },
  { id: 'chain', title: 'Multi-branch chain', titleHi: 'कई ब्रांच वाली चेन', titleMr: 'अनेक शाखांची चेन', icon: 'office-building-marker-outline', blurb: 'Several branches · one HQ view' },
  { id: 'home', title: 'Home-service beautician', titleHi: 'होम सर्विस ब्यूटीशियन', titleMr: 'होम सर्व्हिस ब्युटिशियन', icon: 'home-heart', blurb: 'Visits at the client\'s home' },
];

export const BUSINESS_TYPE_IDS: BusinessType[] = BUSINESS_TYPES.map(b => b.id);

/** Anything stored (or nothing) → a known type. Old installs default to unisex. */
export function normaliseBusinessType(raw: unknown): BusinessType {
  const v = String(raw || '').trim().toLowerCase();
  return (BUSINESS_TYPE_IDS as string[]).includes(v) ? (v as BusinessType) : 'unisex';
}

export function businessTypeMeta(t: unknown): BusinessTypeMeta {
  const id = normaliseBusinessType(t);
  return BUSINESS_TYPES.find(b => b.id === id) || BUSINESS_TYPES[1];
}

/** Title in the active language (hi / mr have their own; others use English). */
export function businessTypeTitle(t: unknown, lang = 'en'): string {
  const m = businessTypeMeta(t);
  return lang === 'hi' ? m.titleHi : lang === 'mr' ? m.titleMr : m.title;
}

const S = (name: string, category: string, price: number, duration: number): SvcSeed => ({ name, category, price, duration });

export const CATALOG: Record<BusinessType, SvcSeed[]> = {
  parlour: [
    S('Eyebrow Threading', 'Skin', 40, 10), S('Upper Lip Threading', 'Skin', 20, 5), S('Forehead Threading', 'Skin', 20, 5), S('Full Face Threading', 'Skin', 120, 20),
    S('Underarms Waxing', 'Skin', 80, 10), S('Full Arms Waxing (Regular)', 'Skin', 200, 20), S('Full Arms Waxing (Rica)', 'Skin', 350, 20),
    S('Full Legs Waxing (Regular)', 'Skin', 350, 30), S('Full Legs Waxing (Rica)', 'Skin', 600, 30), S('Full Body Waxing', 'Skin', 1500, 75),
    S('Face Bleach', 'Skin', 250, 20), S('D-Tan Pack', 'Skin', 500, 30), S('Cleanup', 'Skin', 400, 30),
    S('Fruit Facial', 'Skin', 600, 45), S('Gold Facial', 'Skin', 1200, 60), S('Diamond Facial', 'Skin', 1500, 60), S('O3+ Facial', 'Skin', 2500, 75),
    S('Manicure', 'Nails', 400, 30), S('Pedicure', 'Nails', 500, 40),
    S('Haircut (Women)', 'Hair', 350, 40), S('Blow Dry', 'Hair', 300, 25), S('Hair Spa', 'Hair', 800, 50), S('Henna (Hair)', 'Hair', 400, 60),
    S('Root Touch-up', 'Hair', 800, 60), S('Global Hair Colour', 'Hair', 2500, 120), S('Keratin Treatment', 'Hair', 4000, 150),
    S('Party Makeup', 'Makeup', 2500, 60), S('Saree Draping', 'Makeup', 500, 20), S('Mehendi (Both Hands)', 'Bridal', 600, 60), S('Bridal Makeup', 'Bridal', 12000, 180),
  ],
  unisex: [
    S('Haircut (Women)', 'Hair', 500, 45), S('Haircut (Men)', 'Men', 250, 30), S('Kids Haircut', 'Hair', 200, 20), S('Blow Dry', 'Hair', 350, 25),
    S('Hair Spa', 'Hair', 1200, 60), S('Global Hair Colour', 'Hair', 3000, 120), S('Highlights', 'Hair', 3500, 120), S('Root Touch-up', 'Hair', 1000, 60),
    S('Keratin Treatment', 'Hair', 5000, 150), S('Hair Smoothening', 'Hair', 4500, 180),
    S('Beard Trim', 'Men', 150, 15), S('Clean Shave', 'Men', 150, 20), S('Head Massage', 'Spa', 300, 20),
    S('Cleanup', 'Skin', 600, 30), S('Gold Facial', 'Skin', 1500, 60), S('De-Tan', 'Skin', 600, 30), S('Eyebrow Threading', 'Skin', 50, 10),
    S('Full Arms Waxing', 'Skin', 350, 20), S('Full Legs Waxing', 'Skin', 500, 30),
    S('Manicure', 'Nails', 600, 40), S('Pedicure', 'Nails', 800, 45), S('Party Makeup', 'Makeup', 3000, 60),
  ],
  mens: [
    S('Haircut', 'Men', 150, 25), S('Haircut + Beard', 'Men', 250, 35), S('Beard Trim / Styling', 'Men', 80, 15), S('Clean Shave', 'Men', 80, 15),
    S('Kids Haircut', 'Men', 120, 20), S('Hair Wash', 'Men', 80, 10), S('Head Massage', 'Spa', 200, 20),
    S('Hair Colour (Men)', 'Hair', 500, 45), S('Beard Colour', 'Men', 250, 20), S('Hair Spa (Men)', 'Hair', 500, 40),
    S('Facial (Men)', 'Skin', 600, 45), S('De-Tan (Men)', 'Skin', 400, 30), S('Cleanup (Men)', 'Skin', 350, 25),
    S('Hair Straightening', 'Hair', 1500, 90), S('Groom Package', 'Bridal', 3500, 150),
  ],
  spa: [
    S('Swedish Massage 60 min', 'Spa', 2000, 60), S('Deep Tissue Massage 60 min', 'Spa', 2500, 60), S('Aromatherapy 60 min', 'Spa', 2200, 60),
    S('Balinese Massage 60 min', 'Spa', 2500, 60), S('Thai Massage 60 min', 'Spa', 2500, 60), S('Foot Reflexology 30 min', 'Spa', 900, 30),
    S('Head, Neck & Shoulder 30 min', 'Spa', 900, 30), S('Body Scrub', 'Spa', 1800, 45), S('Body Polishing', 'Spa', 3000, 75),
    S('Couple Massage 60 min', 'Spa', 4500, 60), S('Steam Bath', 'Spa', 500, 20), S('Hydra Facial', 'Skin', 3500, 60),
  ],
  bridal: [
    S('Bridal HD Makeup', 'Bridal', 15000, 180), S('Airbrush Bridal Makeup', 'Bridal', 22000, 180), S('Engagement Makeup', 'Bridal', 8000, 120),
    S('Reception Makeup', 'Bridal', 9000, 120), S('Party Makeup', 'Makeup', 3000, 60), S('Family / Sider Makeup', 'Makeup', 2500, 60),
    S('Bridal Hairstyling', 'Hair', 2500, 60), S('Hairstyling', 'Hair', 1200, 40), S('Saree / Dupatta Draping', 'Makeup', 600, 20),
    S('Bridal Mehendi', 'Bridal', 5000, 240), S('Mehendi (Both Hands)', 'Bridal', 800, 60), S('Pre-Bridal Package', 'Bridal', 12000, 300),
    S('Nail Extensions', 'Nails', 2000, 90), S('Eyelash Extensions', 'Makeup', 1500, 60),
  ],
  nails: [
    S('Gel Polish', 'Nails', 800, 40), S('Acrylic Extensions', 'Nails', 1800, 90), S('Gel Extensions', 'Nails', 2200, 90), S('Nail Art (per finger)', 'Nails', 100, 10),
    S('Extension Refill', 'Nails', 1000, 60), S('Gel / Extension Removal', 'Nails', 400, 30), S('Manicure', 'Nails', 500, 30),
    S('Pedicure', 'Nails', 700, 45), S('Spa Pedicure', 'Nails', 1200, 60), S('French Tips', 'Nails', 1000, 50),
  ],
  clinic: [
    S('Doctor Consultation', 'Skin', 500, 20), S('Chemical Peel', 'Skin', 2500, 45), S('Hydra Facial', 'Skin', 3500, 60),
    S('Carbon Laser Peel', 'Skin', 3000, 45), S('Microdermabrasion', 'Skin', 2000, 45), S('Acne Scar Treatment', 'Skin', 4000, 60),
    S('Pigmentation Treatment', 'Skin', 3500, 45), S('Laser Hair Reduction (Underarms)', 'Skin', 2000, 20), S('Laser Hair Reduction (Full Face)', 'Skin', 3500, 30),
    S('Hair PRP (per session)', 'Hair', 5000, 60), S('Hair Loss Consultation', 'Hair', 500, 20), S('Scalp Treatment', 'Hair', 1500, 45),
    S('Dandruff Treatment', 'Hair', 1200, 40), S('Patch Test', 'Skin', 100, 10),
  ],
  academy: [],
  chain: [],
  home: [
    S('Eyebrow Threading', 'Skin', 50, 10), S('Upper Lip Threading', 'Skin', 30, 5), S('Full Arms Waxing (Rica)', 'Skin', 400, 25),
    S('Full Legs Waxing (Rica)', 'Skin', 650, 35), S('Underarms Waxing', 'Skin', 100, 10), S('Fruit Facial', 'Skin', 700, 50),
    S('Gold Facial', 'Skin', 1300, 60), S('Cleanup', 'Skin', 450, 30), S('Face Bleach', 'Skin', 300, 20),
    S('Manicure', 'Nails', 450, 30), S('Pedicure', 'Nails', 600, 45), S('Hair Spa', 'Hair', 900, 50),
    S('Henna (Hair)', 'Hair', 450, 60), S('Party Makeup (at home)', 'Makeup', 3000, 75), S('Saree Draping', 'Makeup', 500, 20),
    S('Home Visit Charge', 'Other', 100, 10),
  ],
};
CATALOG.academy = CATALOG.unisex;
CATALOG.chain = CATALOG.unisex;

export const STAFF_SEED: Record<BusinessType, { name: string; role: string }[]> = {
  parlour: [{ name: 'Priya', role: 'Senior Beautician' }, { name: 'Sana', role: 'Beautician' }, { name: 'Komal', role: 'Hair Stylist' }, { name: 'Meena', role: 'Trainee' }],
  unisex: [{ name: 'Priya', role: 'Senior Stylist' }, { name: 'Rahul', role: 'Hair Stylist' }, { name: 'Sana', role: 'Beautician' }, { name: 'Amit', role: 'Barber' }],
  mens: [{ name: 'Rahul', role: 'Senior Barber' }, { name: 'Amit', role: 'Barber' }, { name: 'Imran', role: 'Barber' }, { name: 'Sunil', role: 'Helper' }],
  spa: [{ name: 'Mary', role: 'Senior Therapist' }, { name: 'Lisa', role: 'Therapist' }, { name: 'Anjali', role: 'Therapist' }, { name: 'Rekha', role: 'Front Desk' }],
  bridal: [{ name: 'Neha', role: 'Lead Makeup Artist' }, { name: 'Riya', role: 'Makeup Artist' }, { name: 'Fatima', role: 'Mehendi Artist' }, { name: 'Pooja', role: 'Hair Stylist' }],
  nails: [{ name: 'Tina', role: 'Nail Technician' }, { name: 'Simran', role: 'Nail Artist' }, { name: 'Kavya', role: 'Nail Technician' }],
  clinic: [{ name: 'Dr. Mehta', role: 'Dermatologist' }, { name: 'Anita', role: 'Skin Therapist' }, { name: 'Rohit', role: 'Hair Therapist' }, { name: 'Kiran', role: 'Front Desk' }],
  chain: [{ name: 'Priya', role: 'Branch Manager' }, { name: 'Rahul', role: 'Hair Stylist' }, { name: 'Sana', role: 'Beautician' }, { name: 'Amit', role: 'Barber' }],
  home: [{ name: 'Pooja', role: 'Beautician' }, { name: 'Sneha', role: 'Beautician' }],
  academy: [{ name: 'Priya', role: 'Senior Stylist & Trainer' }, { name: 'Rahul', role: 'Hair Stylist' }, { name: 'Sana', role: 'Beautician' }, { name: 'Amit', role: 'Barber' }],
};

/** Services that commonly go together — used to make demo bills realistic (and the upsell AI meaningful). */
export const COMBOS: string[][] = [
  ['Haircut', 'Hair Spa'], ['Haircut', 'Head Massage'], ['Haircut', 'Beard'], ['Haircut', 'Blow Dry'],
  ['Facial', 'Threading'], ['Cleanup', 'Threading'], ['Pedicure', 'Manicure'], ['Waxing', 'Threading'],
  ['Hair Colour', 'Hair Spa'], ['Party Makeup', 'Draping'], ['Massage', 'Steam'], ['Gel', 'Nail Art'],
];

// ── Dashboard quick actions ───────────────────────────────────────────────
/**
 * Quick-action keys the dashboard knows. The dashboard decides which ones the
 * user may see (permissions, plan); this only decides the ORDER and which are
 * promoted to the front for the business type.
 */
export type QuickKey =
  | 'bill' | 'queue' | 'dayclose' | 'calendar' | 'clients' | 'reports' | 'expenses'
  | 'academy' | 'marketing' | 'insights' | 'ai' | 'bookings' | 'dues' | 'hq';

const DEFAULT_ORDER: QuickKey[] = [
  'bill', 'calendar', 'clients', 'queue', 'reports', 'expenses', 'dayclose',
  'academy', 'marketing', 'insights', 'ai', 'bookings', 'dues', 'hq',
];

const FRONT: Record<BusinessType, QuickKey[]> = {
  mens: ['queue', 'bill', 'dayclose'],
  unisex: ['bill', 'calendar', 'queue'],
  parlour: ['bill', 'calendar', 'clients'],
  bridal: ['calendar', 'clients', 'bill', 'bookings'],
  spa: ['calendar', 'bill', 'clients'],
  nails: ['calendar', 'bill', 'clients'],
  clinic: ['calendar', 'clients', 'bill'],
  academy: ['academy', 'bill', 'calendar'],
  chain: ['hq', 'bill', 'reports'],
  home: ['calendar', 'clients', 'bill'],
};

/** Every quick key, with the business type's favourites first. */
export function quickActionOrder(t: unknown): QuickKey[] {
  const front = FRONT[normaliseBusinessType(t)];
  return [...front, ...DEFAULT_ORDER.filter(k => !front.includes(k))];
}

/** Barbershops / budget salons live on walk-ins — the queue tile is promoted. */
export const isWalkinFirst = (t: unknown): boolean => {
  const v = normaliseBusinessType(t);
  return v === 'mens' || v === 'unisex';
};

/** Starter services for a type (a copy — callers may filter it). */
export function starterServices(t: unknown): SvcSeed[] {
  return [...(CATALOG[normaliseBusinessType(t)] || [])];
}

/** Services from `seed` whose name is not already in `existingNames` (case-insensitive). */
export function missingServices(seed: SvcSeed[], existingNames: string[]): SvcSeed[] {
  const have = new Set(existingNames.map(n => String(n || '').trim().toLowerCase()));
  return seed.filter(sv => !have.has(sv.name.trim().toLowerCase()));
}
