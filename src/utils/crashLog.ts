/**
 * Tiny on-phone crash log. Nothing is sent anywhere automatically — the owner
 * can tap "Send report" to share the last errors with support on WhatsApp.
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';

type Entry = { at: string; where: string; msg: string; stack?: string };
const mem: Entry[] = [];
const KEY = 'crash_log';

async function db() {
  try { return (require('../database/Database') as typeof import('../database/Database')).DBX; } catch { return null; }
}

export const CrashLog = {
  async record(err: any, where = 'app') {
    const e: Entry = {
      at: new Date().toISOString(), where,
      msg: String(err?.message || err || 'Unknown error').slice(0, 300),
      stack: String(err?.stack || '').split('\n').slice(0, 6).join('\n').slice(0, 800),
    };
    mem.unshift(e);
    mem.splice(15);
    try {
      const d = await db();
      if (!d) return;
      const prev = JSON.parse((await d.getSetting(KEY)) || '[]') as Entry[];
      await d.setSetting(KEY, JSON.stringify([e, ...prev].slice(0, 15)));
    } catch { /* the log must never cause a second error */ }
  },

  async list(): Promise<Entry[]> {
    try { const d = await db(); const v = d ? await d.getSetting(KEY) : ''; return v ? JSON.parse(v) : mem; } catch { return mem; }
  },

  async report(): Promise<string> {
    const list = await this.list();
    const v = (Constants as any)?.expoConfig?.version || '?';
    return [`SaloonBossX ${v} · ${Platform.OS} ${Platform.Version}`, ...list.slice(0, 5).map(e => `• ${e.at.slice(0, 16)} [${e.where}] ${e.msg}`)].join('\n');
  },

  /** Keep non-fatal JS errors from killing the app; remember fatal ones. */
  install() {
    const EU: any = (globalThis as any).ErrorUtils;
    if (!EU?.getGlobalHandler || (globalThis as any).__sbxCrashInstalled) return;
    (globalThis as any).__sbxCrashInstalled = true;
    const prev = EU.getGlobalHandler();
    EU.setGlobalHandler((error: any, isFatal?: boolean) => {
      CrashLog.record(error, isFatal ? 'fatal' : 'js').catch(() => {});
      if (isFatal) prev?.(error, isFatal);
    });
  },
};
