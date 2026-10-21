import { localPrice } from '../config/regions';
/**
 * Business type (setting 'business_type') + the matching starter service menu.
 * Thin layer over DatabaseService so Onboarding and Settings share one path.
 */
import { DatabaseService } from '../database/Database';
import {
  BusinessType, normaliseBusinessType, starterServices, missingServices, SvcSeed,
} from '../config/businessTypes';

export const BusinessTypeService = {
  /** The stored type, or null when the owner never chose one (older installs). */
  async getStored(): Promise<BusinessType | null> {
    try {
      const raw = await DatabaseService.getSetting('business_type');
      return raw ? normaliseBusinessType(raw) : null;
    } catch { return null; }
  },

  async get(): Promise<BusinessType> {
    return (await this.getStored()) || 'unisex';
  },

  async set(t: BusinessType): Promise<void> {
    await DatabaseService.setSetting('business_type', normaliseBusinessType(t));
  },

  /**
   * Starter services for `t` that are not on the menu yet (by name, active or
   * retired). `menuEmpty` tells the UI whether to offer them as "your menu"
   * or as "add the missing ones".
   */
  async starterPlan(t: BusinessType): Promise<{ toAdd: SvcSeed[]; menuEmpty: boolean }> {
    const existing = (await DatabaseService.getServices(false)) as any[];
    const names = (existing || []).map((x: any) => String(x?.name || ''));
    const local = starterServices(t).map(sv => ({ ...sv, price: localPrice(sv.price) }));
    return { toAdd: missingServices(local, names), menuEmpty: !existing?.length };
  },

  /** Adds the given services; returns how many were added. Skips names that appeared meanwhile. */
  async addServices(list: SvcSeed[]): Promise<number> {
    const existing = (await DatabaseService.getServices(false)) as any[];
    const todo = missingServices(list, (existing || []).map((x: any) => String(x?.name || '')));
    let n = 0;
    for (const sv of todo) { await DatabaseService.addService(sv); n++; }
    return n;
  },
};
