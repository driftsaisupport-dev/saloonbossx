import { LicenseService } from '../services/LicenseService';
import type { PlanId } from '../services/LicenseService';

export interface PlanLimits {
  maxClients: number;
  maxStaff: number;
  hasInventory: boolean;
  hasLoyalty: boolean;
  hasMarketing: boolean;
  hasAdvancedReports: boolean;
  hasMultiLocation: boolean;
  hasAcademy: boolean;
  hasGSTReports: boolean;
  hasStaffManagement: boolean;
  /** Encrypted daily backup to the owner's Google Drive. Every plan — it is what makes owners trust an offline app. */
  hasCloudBackup: boolean;
  /** Boss AI assistant (offline). */
  hasAI: boolean;
  /** Public online booking page (Salon Pro and above). Solo gets the WhatsApp booking link. */
  hasOnlineBooking: boolean;
  /** v5.6 front-desk features — on every paid plan (Solo included). */
  hasQueue: boolean;
  hasWallet: boolean;
  hasPackages: boolean;
  hasNotes: boolean;
  hasDayClose: boolean;
}

/** v5.6 features every plan gets. Academy and multi-branch HQ stay plan-gated. */
const CORE_V56 = { hasQueue: true, hasWallet: true, hasPackages: true, hasNotes: true, hasDayClose: true } as const;

// FIX: Updated to use new plan names (solo/standard/multi/academy)
// Backward-compat: old keys (starter/pro/business) map to new via normalize
const LIMITS: Record<string, PlanLimits> = {
  // === NEW PLANS ===
  solo: {
    maxClients: 500,
    maxStaff: 1,
    hasInventory: true,
    hasLoyalty: false,
    hasMarketing: false,
    hasAdvancedReports: false,
    hasMultiLocation: false,
    hasAcademy: false,
    hasGSTReports: false,
    hasStaffManagement: false,
    hasCloudBackup: true,
    hasAI: true,
    hasOnlineBooking: false,
    ...CORE_V56,
  },
  standard: {
    maxClients: 99999,
    maxStaff: 20,
    hasInventory: true,
    hasLoyalty: true,
    hasMarketing: true,
    hasAdvancedReports: true,
    hasMultiLocation: false,
    hasAcademy: false,
    hasGSTReports: true,
    hasStaffManagement: true,
    hasCloudBackup: true,
    hasAI: true,
    hasOnlineBooking: true,
    ...CORE_V56,
  },
  multi: {
    maxClients: 99999,
    maxStaff: 99999,
    hasInventory: true,
    hasLoyalty: true,
    hasMarketing: true,
    hasAdvancedReports: true,
    hasMultiLocation: true,
    hasAcademy: false,
    hasGSTReports: true,
    hasStaffManagement: true,
    hasCloudBackup: true,
    hasAI: true,
    hasOnlineBooking: true,
    ...CORE_V56,
  },
  academy: {
    maxClients: 99999,
    maxStaff: 99999,
    hasInventory: true,
    hasLoyalty: true,
    hasMarketing: true,
    hasAdvancedReports: true,
    hasMultiLocation: true,
    hasAcademy: true,
    hasGSTReports: true,
    hasStaffManagement: true,
    hasCloudBackup: true,
    hasAI: true,
    hasOnlineBooking: true,
    ...CORE_V56,
  },
};

// Backward compat: map old plan names to new
const PLAN_NORMALIZE: Record<string, string> = {
  starter: 'solo',
  pro: 'standard',
  business: 'multi',
};

export const FeatureGate = {
  async getLimits(): Promise<PlanLimits> {
    try {
      const info = await LicenseService.getLicenseInfo();
      let plan = String(info?.plan || '').toLowerCase();
      // Normalize old plan names
      plan = PLAN_NORMALIZE[plan] ?? plan;
      return LIMITS[plan] ?? LIMITS.solo;
    } catch { return LIMITS.solo; }
  },

  async canAccess(feature: keyof PlanLimits): Promise<boolean> {
    const limits = await this.getLimits();
    const val = limits[feature];
    if (typeof val === 'boolean') return val;
    if (typeof val === 'number') return val > 0;
    return false;
  },

  async getCurrentPlan(): Promise<string> {
    try {
      const info = await LicenseService.getLicenseInfo();
      let plan = String(info?.plan || 'solo').toLowerCase();
      return PLAN_NORMALIZE[plan] ?? plan;
    } catch { return 'solo'; }
  },

  async getMaxClients(): Promise<number> {
    const l = await this.getLimits();
    return l.maxClients;
  },

  async getMaxStaff(): Promise<number> {
    const l = await this.getLimits();
    return l.maxStaff;
  },
};
