import React, { createContext, useState, useCallback, useEffect } from 'react';
import { DatabaseService } from '../database/Database';
import { todayLocal } from '../utils/helpers';
import { setRegion, getRegion, detectRegionCode, regionForSymbol, REGION_BY_CODE, curSym, type Region } from '../config/regions';

interface TodayStats {
  revenue: number;
  billCount: number;
  walkInCount: number;
  appointmentCount: number;
  completedAppointments: number;
  expenses: number;
}

interface AppContextType {
  currencySymbol: string;
  /** The salon's country: currency, tax, phone format, QR payments, prices. */
  region: Region;
  /** Switch country. Also resets the currency symbol to the country's own. */
  changeRegion: (code: string) => Promise<void>;
  todayStats: TodayStats | null;
  refresh: () => Promise<void>;
  setCurrencySymbol: (s: string) => void;
}

const DEFAULT_STATS: TodayStats = {
  revenue: 0, billCount: 0, walkInCount: 0,
  appointmentCount: 0, completedAppointments: 0, expenses: 0,
};

export const AppContext = createContext<AppContextType>({
  currencySymbol: curSym(),
  region: getRegion(),
  changeRegion: async () => {},
  todayStats: DEFAULT_STATS,
  refresh: async () => {},
  setCurrencySymbol: () => {},
});

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [currencySymbol, setCurrencySymbol] = useState(curSym());
  const [region, setRegionState] = useState<Region>(getRegion());

  /** Read the saved country; on an old install infer it from the saved symbol, on a new one from the phone's locale. */
  const loadRegion = useCallback(async (savedSymbol?: string, isNewInstall = false) => {
    let code = await DatabaseService.getSetting('region').catch(() => '');
    if (!code || !REGION_BY_CODE[code]) {
      code = (isNewInstall ? detectRegionCode() : regionForSymbol(savedSymbol || '')) || detectRegionCode();
      await DatabaseService.setSetting('region', code).catch(() => {});
      const fresh = isNewInstall || !savedSymbol;
      if (fresh && code !== 'IN') {
        const sym = REGION_BY_CODE[code].symbol;
        await DatabaseService.updateSalonProfile({ currency_symbol: sym, currency: REGION_BY_CODE[code].currency, country_code: '+' + REGION_BY_CODE[code].dial }).catch(() => {});
        setCurrencySymbol(sym);
      }
    }
    setRegionState(setRegion(code));
  }, []);

  const changeRegion = useCallback(async (code: string) => {
    const r = REGION_BY_CODE[code];
    if (!r) return;
    await DatabaseService.ensureReady();
    await DatabaseService.setSetting('region', code);
    await DatabaseService.updateSalonProfile({ currency_symbol: r.symbol, currency: r.currency, country_code: r.dial ? '+' + r.dial : '' });
    setRegionState(setRegion(code));
    setCurrencySymbol(r.symbol);
  }, []);
  const [todayStats, setTodayStats] = useState<TodayStats>(DEFAULT_STATS);

  const refresh = useCallback(async () => {
    try {
      await DatabaseService.ensureReady();
      const today = todayLocal();
      const [stats, profile] = await Promise.all([
        DatabaseService.getDashboardStats(today).catch(() => DEFAULT_STATS),
        DatabaseService.getSalonProfile().catch(() => null),
      ]);
      setTodayStats((stats as TodayStats) || DEFAULT_STATS);
      const p = profile as any;
      // FIX: Also read from settings as fallback so symbol is always in sync
      let sym = p?.currency_symbol || '';
      if (!sym) sym = (await DatabaseService.getSetting('currency_symbol').catch(() => '')) || '';
      await loadRegion(sym, !String(p?.name || '').trim());
      if (sym && !(sym === '₹' && getRegion().code !== 'IN')) setCurrencySymbol(sym);
    } catch (e) {
      console.error('AppContext refresh error:', e);
    }
  }, [loadRegion]);

  // FIX: Load currency symbol and stats on mount, not just on explicit refresh calls
  useEffect(() => {
    refresh();
  }, []);

  return (
    <AppContext.Provider value={{ currencySymbol, region, changeRegion, todayStats, refresh, setCurrencySymbol }}>
      {children}
    </AppContext.Provider>
  );
}
