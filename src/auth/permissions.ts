// ─────────────────────────────────────────────────────────────────────────────
// SaloonBossX — Role-Based Access Control catalogue
//
// A "permission" is a single capability key (e.g. `reports.financial`). The app
// gates menus, tabs, screens and sensitive actions on these keys.
//
// Every app user has a ROLE (a named preset) and, optionally, per-user
// OVERRIDES that the owner toggles individually. The owner account implicitly
// holds every permission and can never be locked out.
// ─────────────────────────────────────────────────────────────────────────────

export type PermKey =
  | 'dashboard.view'
  | 'dashboard.revenue'
  | 'calendar.view'
  | 'calendar.all_staff'
  | 'calendar.edit'
  | 'billing.create'
  | 'billing.discount'
  | 'billing.edit_price'
  | 'billing.history'
  | 'billing.void'
  | 'billing.dues'
  | 'queue.manage'
  | 'cash.close'
  | 'clients.view'
  | 'clients.edit'
  | 'clients.delete'
  | 'services.view'
  | 'services.edit'
  | 'inventory.view'
  | 'inventory.edit'
  | 'staff.view'
  | 'staff.manage'
  | 'staff.payroll'
  | 'attendance.view'
  | 'attendance.self'
  | 'attendance.manage'
  | 'expenses.view'
  | 'expenses.edit'
  | 'reports.view'
  | 'reports.financial'
  | 'reports.gst'
  | 'academy.view'
  | 'academy.manage'
  | 'academy.certificate'
  | 'marketing.view'
  | 'insights.view'
  | 'ai.view'
  | 'branches.view'
  | 'branches.manage'
  | 'settings.business'
  | 'settings.backup'
  | 'settings.users'
  | 'settings.attendance_rules';

export interface PermMeta {
  key: PermKey;
  label: string;
  hint: string;
  group: string;
}

// Catalogue drives the permission editor UI (grouped checkboxes).
export const PERMISSIONS: PermMeta[] = [
  { key: 'dashboard.view',   label: 'Open dashboard',        hint: 'See the home screen',                       group: 'Dashboard' },
  { key: 'dashboard.revenue',label: 'See revenue & cash',    hint: 'Today’s revenue, targets, cash register', group: 'Dashboard' },

  { key: 'calendar.view',    label: 'Open calendar',         hint: 'View the appointment calendar',             group: 'Calendar' },
  { key: 'calendar.all_staff',label:'See all staff bookings', hint: 'Otherwise only their own appointments',     group: 'Calendar' },
  { key: 'calendar.edit',    label: 'Add / edit bookings',    hint: 'Create, reschedule and cancel appointments', group: 'Calendar' },

  { key: 'billing.create',   label: 'Create bills',          hint: 'Open the billing screen and take payment',  group: 'Billing' },
  { key: 'billing.discount', label: 'Apply discounts',       hint: 'Give flat or % discounts on a bill',        group: 'Billing' },
  { key: 'billing.edit_price',label:'Override item prices',   hint: 'Change the price of a line item',           group: 'Billing' },
  { key: 'billing.history',  label: 'View bill history',      hint: 'Browse and reprint past bills',             group: 'Billing' },
  { key: 'billing.void',     label: 'Cancel bills',           hint: 'Cancel a bill by issuing a credit note',    group: 'Billing' },
  { key: 'billing.dues',     label: 'Pay-later & dues',       hint: 'Bill on credit (udhaar) and collect dues',  group: 'Billing' },
  { key: 'queue.manage',     label: 'Walk-in queue',          hint: 'Add walk-ins, call the next token, mark done', group: 'Billing' },
  { key: 'cash.close',       label: 'Day close / cash tally', hint: 'Count the drawer and close the day',         group: 'Money' },

  { key: 'clients.view',     label: 'View clients',          hint: 'Open the client list and profiles',         group: 'Clients' },
  { key: 'clients.edit',     label: 'Add / edit clients',    hint: 'Create and update client records',          group: 'Clients' },
  { key: 'clients.delete',   label: 'Deactivate clients',    hint: 'Remove clients from the active list',       group: 'Clients' },

  { key: 'services.view',    label: 'View services',         hint: 'See the service menu & prices',             group: 'Services & stock' },
  { key: 'services.edit',    label: 'Edit services',         hint: 'Add, edit and retire services',             group: 'Services & stock' },
  { key: 'inventory.view',   label: 'View inventory',        hint: 'See stock levels and products',             group: 'Services & stock' },
  { key: 'inventory.edit',   label: 'Edit inventory',        hint: 'Add stock, restock, adjust products',       group: 'Services & stock' },

  { key: 'staff.view',       label: 'View team',             hint: 'See the staff list',                        group: 'Team' },
  { key: 'staff.manage',     label: 'Manage team',           hint: 'Add / edit staff, roles and settings',      group: 'Team' },
  { key: 'staff.payroll',    label: 'See pay & commission',  hint: 'Salary, commission figures and pay slips',  group: 'Team' },
  { key: 'attendance.view',  label: 'View attendance',       hint: 'See attendance for the whole team',         group: 'Team' },
  { key: 'attendance.self',  label: 'Check self in / out',   hint: 'Mark their own attendance',                 group: 'Team' },
  { key: 'attendance.manage',label: 'Edit attendance',       hint: 'Manual entry and correcting others',        group: 'Team' },

  { key: 'expenses.view',    label: 'View expenses',         hint: 'See the expense log',                       group: 'Money' },
  { key: 'expenses.edit',    label: 'Add / delete expenses', hint: 'Record and remove expenses',                group: 'Money' },
  { key: 'reports.view',     label: 'Open reports',          hint: 'Access the Reports tab',                    group: 'Money' },
  { key: 'reports.financial',label: 'Financial reports',     hint: 'P&L, revenue, staff performance & payouts', group: 'Money' },
  { key: 'reports.gst',      label: 'GST tax reports',       hint: 'GSTR-1 / GSTR-3B summaries',                group: 'Money' },

  { key: 'academy.view',     label: 'Open academy',          hint: 'View courses, batches and students',        group: 'Academy' },
  { key: 'academy.manage',   label: 'Manage academy',        hint: 'Courses, batches, enrolment, fees',         group: 'Academy' },
  { key: 'academy.certificate',label:'Issue certificates & IDs', hint: 'Generate student certificates & ID cards', group: 'Academy' },

  { key: 'marketing.view',   label: 'Marketing Studio',      hint: 'Create & share promotional posts',          group: 'Growth' },
  { key: 'insights.view',    label: 'Business Insights',     hint: 'Smart trends, forecasts & recommendations', group: 'Growth' },
  { key: 'ai.view',          label: 'Boss AI assistant',     hint: 'Ask questions about the business, daily briefing', group: 'Growth' },
  { key: 'branches.view',    label: 'Branches (HQ view)',    hint: 'See all branches of the chain',             group: 'Growth' },
  { key: 'branches.manage',  label: 'Branch sync settings',  hint: 'Connect Google Drive, push price list',      group: 'Growth' },

  { key: 'settings.business',        label: 'Business settings',   hint: 'Salon profile, GST, currency, bill prefix', group: 'Settings' },
  { key: 'settings.backup',          label: 'Backup & restore',    hint: 'Create / restore data backups',            group: 'Settings' },
  { key: 'settings.attendance_rules',label: 'Attendance rules',    hint: 'Set full-day / half-day / absent policy',  group: 'Settings' },
  { key: 'settings.users',           label: 'Users & access',      hint: 'Create logins and set permissions',        group: 'Settings' },
];

export const PERM_GROUPS: string[] = PERMISSIONS.reduce<string[]>((acc, p) => {
  if (!acc.includes(p.group)) acc.push(p.group);
  return acc;
}, []);

export const ALL_PERM_KEYS: PermKey[] = PERMISSIONS.map(p => p.key);

// ── Role presets ────────────────────────────────────────────────────────────
export type RoleId = 'owner' | 'manager' | 'receptionist' | 'stylist' | 'trainer' | 'custom';

export const ROLE_LABELS: Record<RoleId, string> = {
  owner: 'Owner',
  manager: 'Manager',
  receptionist: 'Receptionist',
  stylist: 'Stylist / Staff',
  trainer: 'Academy Trainer',
  custom: 'Custom',
};

export const ROLE_DESCRIPTIONS: Record<RoleId, string> = {
  owner: 'Full access to everything. Cannot be restricted or removed.',
  manager: 'Runs the salon day to day. Everything except user management & license.',
  receptionist: 'Front desk: bookings, billing (no discounts), clients, check-in.',
  stylist: 'Sees only their own calendar, bills, attendance and pay.',
  trainer: 'Academy only: batches, students, attendance and certificates.',
  custom: 'Start from nothing and pick permissions by hand.',
};

const MANAGER: PermKey[] = [
  'dashboard.view', 'dashboard.revenue',
  'calendar.view', 'calendar.all_staff', 'calendar.edit',
  'billing.create', 'billing.discount', 'billing.edit_price', 'billing.history',
  'billing.void', 'billing.dues', 'queue.manage', 'cash.close',
  'clients.view', 'clients.edit', 'clients.delete',
  'services.view', 'services.edit', 'inventory.view', 'inventory.edit',
  'staff.view', 'staff.manage', 'staff.payroll',
  'attendance.view', 'attendance.self', 'attendance.manage',
  'expenses.view', 'expenses.edit',
  'reports.view', 'reports.financial', 'reports.gst',
  'academy.view', 'academy.manage', 'academy.certificate',
  'marketing.view', 'insights.view', 'ai.view', 'branches.view',
  'settings.business', 'settings.backup', 'settings.attendance_rules',
];

const RECEPTIONIST: PermKey[] = [
  'dashboard.view',
  'calendar.view', 'calendar.all_staff', 'calendar.edit',
  'billing.create', 'billing.history', 'billing.dues', 'queue.manage',
  'clients.view', 'clients.edit',
  'services.view', 'inventory.view',
  'staff.view', 'attendance.view', 'attendance.self',
  'expenses.view',
  'marketing.view',
];

const STYLIST: PermKey[] = [
  'dashboard.view',
  'calendar.view', 'calendar.edit',
  'billing.create', 'queue.manage',
  'clients.view',
  'services.view',
  'attendance.self',
];

const TRAINER: PermKey[] = [
  'dashboard.view',
  'calendar.view',
  'clients.view',
  'attendance.self',
  'academy.view', 'academy.manage', 'academy.certificate',
];

export const ROLE_PRESETS: Record<Exclude<RoleId, 'owner' | 'custom'>, PermKey[]> = {
  manager: MANAGER,
  receptionist: RECEPTIONIST,
  stylist: STYLIST,
  trainer: TRAINER,
};

// ── Resolution ──────────────────────────────────────────────────────────────
export interface StoredUserPerms {
  role: RoleId;
  /** JSON string in the DB. `{key: boolean}` — merged over the role preset. */
  overrides?: Record<string, boolean> | null;
  isOwner?: boolean;
}

/**
 * Keys added after custom roles already existed in the field. A custom user
 * saved before the key existed has no explicit value for it, so it is derived
 * from a permission they already had (`from`). Once the owner saves that user
 * again, overridesFromSet writes the key explicitly and this no longer applies.
 * (Preset roles get new keys straight from their preset.)
 */
const DERIVED_FOR_CUSTOM: { key: PermKey; from: PermKey }[] = [
  { key: 'queue.manage', from: 'billing.create' },
  // Before v5.6 the cash register (open / count) lived under dashboard.revenue.
  { key: 'cash.close', from: 'dashboard.revenue' },
];

export function resolvePermissions(u: StoredUserPerms): Set<PermKey> {
  if (u.isOwner || u.role === 'owner') return new Set(ALL_PERM_KEYS);
  const base = new Set<PermKey>(
    u.role === 'custom' ? [] : (ROLE_PRESETS[u.role as keyof typeof ROLE_PRESETS] || STYLIST)
  );
  const ov = u.overrides || {};
  if (u.role === 'custom') {
    for (const d of DERIVED_FOR_CUSTOM) {
      if (!(d.key in ov) && ov[d.from]) base.add(d.key);
    }
  }
  for (const k of Object.keys(ov)) {
    if (!ALL_PERM_KEYS.includes(k as PermKey)) continue;
    if (ov[k]) base.add(k as PermKey);
    else base.delete(k as PermKey);
  }
  return base;
}

export function presetFor(role: RoleId): Set<PermKey> {
  if (role === 'owner') return new Set(ALL_PERM_KEYS);
  if (role === 'custom') return new Set();
  return new Set(ROLE_PRESETS[role as keyof typeof ROLE_PRESETS] || []);
}

/** Diff a desired permission set against a role preset → minimal overrides map. */
export function overridesFromSet(role: RoleId, desired: Set<string>): Record<string, boolean> {
  const preset = presetFor(role);
  const out: Record<string, boolean> = {};
  for (const k of ALL_PERM_KEYS) {
    const want = desired.has(k);
    const has = preset.has(k);
    if (want !== has) out[k] = want;
  }
  // Custom roles: store derived keys explicitly so an unticked box stays unticked.
  if (role === 'custom') for (const d of DERIVED_FOR_CUSTOM) out[d.key] = desired.has(d.key);
  return out;
}
