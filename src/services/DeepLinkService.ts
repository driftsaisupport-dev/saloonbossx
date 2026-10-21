/**
 * Deep links that make cloud setup tap-only:
 *   saloonbossx://connect?u=<Apps Script /exec URL>   (from the QR in the owner's Sheet)
 *   saloonbossx://join?c=<join code>                  (from the WhatsApp join link)
 *
 * The link is parked in settings so it survives the PIN screen, then the app
 * jumps to Branches & Cloud with everything filled in.
 */
import * as Linking from 'expo-linking';
import { DBX } from '../database/Database';
import { parseSetupLink } from '../utils/setupLinks';
export { parseSetupLink };

type Listener = () => void;
const listeners = new Set<Listener>();

export const DeepLinkService = {
  async handle(url: string | null): Promise<boolean> {
    const p = url ? parseSetupLink(url) : null;
    if (!p) return false;
    await DBX.setSetting(p.kind === 'connect' ? 'pending_connect_url' : 'pending_join_code', p.value).catch(() => {});
    listeners.forEach(l => { try { l(); } catch {} });
    return true;
  },
  async pending(): Promise<{ connectUrl: string; joinCode: string }> {
    const [connectUrl, joinCode] = await Promise.all([DBX.getSetting('pending_connect_url'), DBX.getSetting('pending_join_code')]);
    return { connectUrl: connectUrl || '', joinCode: joinCode || '' };
  },
  async clear() {
    await DBX.setSetting('pending_connect_url', '').catch(() => {});
    await DBX.setSetting('pending_join_code', '').catch(() => {});
  },
  onLink(l: Listener) { listeners.add(l); return () => { listeners.delete(l); }; },
  /** Start listening; call once at boot after the database is ready. */
  start() {
    Linking.getInitialURL().then(u => this.handle(u)).catch(() => {});
    const sub = Linking.addEventListener('url', e => { this.handle(e.url); });
    return () => sub.remove();
  },
};
