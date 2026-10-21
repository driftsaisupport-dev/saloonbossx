/**
 * The authoritative list of tables the backup must carry.
 *
 * This file exists because the previous backup hardcoded a table list inline
 * and it fell out of date: `attendance`, `campaigns` and `audit_log` were
 * created but never exported, so restoring a backup silently destroyed every
 * staff attendance record — which is what payroll is computed from.
 *
 * Rule: any CREATE TABLE added to Database.ts must be added here in the same
 * commit. The self-check below fails loudly in development if one is missed.
 */

/** Restore order matters — parents before children so foreign keys resolve. */
export const BACKUP_TABLES: string[] = [
  'salon_profile',
  'settings',
  'services',
  'staff',
  'clients',
  'client_wallet_txns',
  'client_notes',
  'memberships',
  'client_memberships',
  'appointments',
  'booking_requests',
  'bills',
  'due_payments',
  'inventory',
  'expenses',
  'reminders',
  'campaigns',
  'attendance',
  'walkin_queue',
  'day_close',
  'app_users',
  'academy_courses',
  'academy_batches',
  'academy_students',
  'academy_attendance',
  'academy_fees',
  'academy_assessments',
];

/**
 * Tables deliberately excluded from backup.
 *  - audit_log is device-local forensic history; restoring another device's
 *    audit trail onto this one would be actively misleading.
 *  - sqlite_sequence is managed by SQLite itself.
 */
export const EXCLUDED_TABLES = new Set(['audit_log', 'sqlite_sequence']);

/**
 * Settings keys stripped on export and ignored on import.
 *
 * license_plan and license_expiry used to live in the plaintext settings table
 * and travelled inside every backup, so editing one line of a backup JSON
 * upgraded the user to the academy tier for free. They now live in SecureStore,
 * and these keys are filtered here as a second line of defence against old
 * backups carrying stale values.
 */
export const NON_PORTABLE_SETTINGS = new Set([
  'license_plan',
  'license_expiry',
  'license_key',
  'license_device',
  'license_email',
  'license_name',
  'license_activated_at',
  'device_install_id',
  // Branch-sync identity is per device. Restoring a branch's backup onto the
  // head-office phone must not turn HQ into that branch.
  'sync_config',
  'sync_last_push',
  'sync_last_backup',
  'sync_last_pull',
  'sync_log',
  'sync_catalog_version',
  'sync_branches_cache',
  'cloud_auto_enable',
  'cloud_auto_last_try',
  'cloud_recovery_saved',
  'booking_published',
  'booking_last_check',
  'booking_ack',
  'booking_resolved',
  'booking_slug',
  'crash_log',
]);

/**
 * 5 — timestamps are local wall-clock time (v4 and earlier wrote UTC), and the
 *     due_payments table exists. Restoring a format-4 file converts on the way in.
 * 6 — v5.6: client wallet ledger, consultation notes, walk-in queue, day close,
 *     bill tax_rate / ledger columns. An older app refuses a format-6 file
 *     (it would silently drop the wallet balances customers paid for).
 */
export const BACKUP_FORMAT_VERSION = 6;

/**
 * Tables that are emptied when a backup does not carry them (an older backup),
 * so this phone's leftovers never point at bills/clients that no longer exist.
 * settings / salon_profile / app_users are handled separately.
 */
export const CLEAR_WHEN_ABSENT = new Set(
  BACKUP_TABLES.filter((t) => !['settings', 'salon_profile', 'app_users'].includes(t))
);

/** Compare the live schema against BACKUP_TABLES. Development guard only. */
export async function auditSchemaCoverage(
  db: { getAllAsync: (q: string) => Promise<any[]> }
): Promise<string[]> {
  const rows = await db.getAllAsync(
    "SELECT name FROM sqlite_master WHERE type='table'"
  );
  const live = rows.map((r: any) => String(r.name));
  return live.filter(
    (t) => !t.startsWith('sqlite_') && !EXCLUDED_TABLES.has(t) && !BACKUP_TABLES.includes(t)
  );
}
