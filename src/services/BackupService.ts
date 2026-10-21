import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { DatabaseService } from '../database/Database';
import { appLocale } from '../config/regions';

/**
 * Backup.
 *
 * The previous version only scheduled a daily notification reminding the user
 * to back up by hand. If they swiped it away, nothing happened — and the only
 * copy that existed lived in the app's private sandbox, which is deleted on
 * uninstall. A lost phone meant total data loss while the app claimed to be
 * backing up.
 *
 * Off-device backup with no paid cloud and no server has real limits, so this
 * stacks three free mechanisms instead of pretending one does everything:
 *
 *  1. Android Auto Backup — app.json now sets allowBackup true with rules that
 *     include this folder. Android silently uploads it to the user's own Drive
 *     and restores it when they set up a new phone. Zero config, zero cost.
 *     We back up the JSON export, never the SQLCipher file: its key lives in
 *     the Android Keystore and does not survive a device transfer, so a
 *     restored database would be undecryptable.
 *
 *  2. A folder the user picks once (Android SAF). We then write there every
 *     day with no prompt at all. This is the genuinely automatic one.
 *
 *  3. Email or share — one tap, works on both platforms. Truly zero-tap email
 *     needs an SMTP server, which is a paid service with upkeep, so one tap is
 *     the honest floor.
 */

const DIR = FileSystem.documentDirectory + 'backups/';
const LATEST = 'SaloonBossX_Backup_Latest.json';
const NOTIF_ID = 'sbx-backup-daily';
const KEEP_LOCAL = 7;

export type BackupDestination = 'folder' | 'email' | 'share' | 'none';

export interface BackupResult {
  success: boolean;
  message: string;
  uri?: string;
  bytes?: number;
}

async function ensureDir() {
  const info = await FileSystem.getInfoAsync(DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

export const BackupService = {
  // ── Writing ────────────────────────────────────────────────────────────────

  /** Write a backup into the app folder. Always the first step. */
  async createLocal(label = 'auto'): Promise<BackupResult> {
    try {
      await ensureDir();
      const json = await DatabaseService.exportAllData();
      const name = `SaloonBossX_${label}_${stamp()}.json`;
      const uri = DIR + name;

      await FileSystem.writeAsStringAsync(uri, json, { encoding: 'utf8' });
      // Never let an EMPTY database (e.g. a fresh one after a failed recovery)
      // overwrite a "Latest" backup that still holds the salon's data.
      if (!(await this._wouldEmptyLatest(json))) {
        await FileSystem.writeAsStringAsync(DIR + LATEST, json, { encoding: 'utf8' });
      }

      await DatabaseService.setSetting('last_backup_at', new Date().toISOString());
      await DatabaseService.setSetting('last_backup_bytes', String(json.length));

      await this.pruneLocal();
      return { success: true, message: 'Backup saved.', uri, bytes: json.length };
    } catch (e: any) {
      return { success: false, message: e?.message || 'Could not write the backup file.' };
    }
  },

  /** True when `json` has no clients and no bills but the current Latest backup does. */
  async _wouldEmptyLatest(json: string): Promise<boolean> {
    const count = (o: any) => (Array.isArray(o?.clients) ? o.clients.length : 0) + (Array.isArray(o?.bills) ? o.bills.length : 0);
    try {
      if (count(JSON.parse(json)) > 0) return false;
      const info = await FileSystem.getInfoAsync(DIR + LATEST);
      if (!info.exists) return false;
      return count(JSON.parse(await FileSystem.readAsStringAsync(DIR + LATEST, { encoding: 'utf8' }))) > 0;
    } catch { return false; }
  },

  /** Keep the last N dated files. The Latest file is never pruned. */
  async pruneLocal() {
    try {
      const files = (await FileSystem.readDirectoryAsync(DIR))
        .filter((f) => f.endsWith('.json') && f !== LATEST)
        .sort()
        .reverse();
      for (const f of files.slice(KEEP_LOCAL)) {
        await FileSystem.deleteAsync(DIR + f, { idempotent: true });
      }
    } catch { /* nothing to prune */ }
  },

  // ── Destination 2: a folder the user picks once ────────────────────────────

  /**
   * Ask for a folder, once. Android hands back a persistable permission that
   * survives reboots, so from then on backups land there with no prompt.
   */
  async chooseFolder(): Promise<BackupResult> {
    if (Platform.OS !== 'android') {
      return {
        success: false,
        message: 'Choosing a backup folder is Android only. On iPhone, use email or Files instead.',
      };
    }
    try {
      const SAF = (FileSystem as any).StorageAccessFramework;
      const perm = await SAF.requestDirectoryPermissionsAsync();
      if (!perm.granted) return { success: false, message: 'No folder chosen.' };

      await DatabaseService.setSetting('backup_folder_uri', perm.directoryUri);
      return { success: true, message: 'Backups will be saved to that folder every day.' };
    } catch (e: any) {
      return { success: false, message: e?.message || 'Could not open the folder picker.' };
    }
  },

  async getFolder(): Promise<string> {
    return (await DatabaseService.getSetting('backup_folder_uri')) || '';
  },

  async clearFolder() {
    await DatabaseService.setSetting('backup_folder_uri', '');
  },

  /** Write today's backup into the chosen folder. Silent, no user action. */
  async writeToFolder(json: string): Promise<BackupResult> {
    const dir = await this.getFolder();
    if (!dir) return { success: false, message: 'No backup folder chosen yet.' };

    try {
      const SAF = (FileSystem as any).StorageAccessFramework;
      const name = `SaloonBossX_${stamp()}`;
      const uri = await SAF.createFileAsync(dir, name, 'application/json');
      await SAF.writeAsStringAsync(uri, json, { encoding: 'utf8' });
      return { success: true, message: 'Saved to your backup folder.', uri };
    } catch (e: any) {
      // Permission is usually revoked because the folder was deleted or the
      // SD card removed. Clear it so the UI can prompt again rather than
      // failing silently every night.
      await this.clearFolder();
      return {
        success: false,
        message: 'Lost access to your backup folder. Choose it again in Settings.',
      };
    }
  },

  // ── Destination 3: email / share ───────────────────────────────────────────

  async getBackupEmail(): Promise<string> {
    return (await DatabaseService.getSetting('backup_email')) || '';
  },

  async setBackupEmail(email: string) {
    await DatabaseService.setSetting('backup_email', email.trim());
  },

  /**
   * Open the mail app with the backup attached and the address filled in.
   * One tap to send. No app on any OS can send mail silently without an SMTP
   * server behind it, and that would be a paid service with upkeep.
   */
  async emailBackup(uri: string): Promise<BackupResult> {
    try {
      const MailComposer = require('expo-mail-composer');
      if (!(await MailComposer.isAvailableAsync())) {
        return { success: false, message: 'No mail app is set up on this phone.' };
      }
      const to = await this.getBackupEmail();
      await MailComposer.composeAsync({
        recipients: to ? [to] : [],
        subject: `SaloonBossX backup — ${new Date().toLocaleDateString(appLocale())}`,
        body:
          'Your SaloonBossX backup is attached.\n\n' +
          'Keep this email. To restore, open SaloonBossX, go to Settings, ' +
          'then Restore backup, and pick this file.',
        attachments: [uri],
      });
      return { success: true, message: 'Mail app opened.' };
    } catch (e: any) {
      return { success: false, message: e?.message || 'Could not open the mail app.' };
    }
  },

  async shareBackup(uri: string): Promise<BackupResult> {
    try {
      if (!(await Sharing.isAvailableAsync())) {
        return { success: false, message: 'Sharing is not available on this device.' };
      }
      await Sharing.shareAsync(uri, {
        mimeType: 'application/json',
        dialogTitle: 'Save your SaloonBossX backup',
        UTI: 'public.json',
      });
      return { success: true, message: 'Backup shared.' };
    } catch (e: any) {
      return { success: false, message: e?.message || 'Could not share the backup.' };
    }
  },

  // ── The daily run ──────────────────────────────────────────────────────────

  /**
   * Run a backup to every destination the user has set up.
   * Called on app open and when the app goes to the background.
   */
  async runAuto(force = false): Promise<BackupResult> {
    const enabled = (await DatabaseService.getSetting('auto_backup_enabled')) !== 'false';
    if (!enabled && !force) return { success: false, message: 'Auto-backup is off.' };

    if (!force) {
      const last = await DatabaseService.getSetting('last_backup_at');
      if (last && Date.now() - new Date(last).getTime() < 20 * 60 * 60 * 1000) {
        return { success: true, message: 'Already backed up today.' };
      }
    }

    const local = await this.createLocal('auto');
    if (!local.success || !local.uri) return local;

    const folder = await this.getFolder();
    if (folder) {
      const json = await FileSystem.readAsStringAsync(local.uri, { encoding: 'utf8' });
      const r = await this.writeToFolder(json);
      if (r.success) {
        await DatabaseService.setSetting('last_offdevice_backup_at', new Date().toISOString());
        return { success: true, message: 'Backed up to your folder.', uri: local.uri };
      }
    }

    return {
      success: true,
      message: 'Backed up on this phone.',
      uri: local.uri,
      bytes: local.bytes,
    };
  },

  /** How stale is the off-device copy? Drives the dashboard warning. */
  async health(): Promise<{
    lastLocal: string; lastOffDevice: string; daysSinceOffDevice: number; level: 'ok' | 'warn' | 'bad';
  }> {
    const lastLocal = (await DatabaseService.getSetting('last_backup_at')) || '';
    const lastOff = (await DatabaseService.getSetting('last_offdevice_backup_at')) || '';

    const days = lastOff
      ? Math.floor((Date.now() - new Date(lastOff).getTime()) / 86400000)
      : 9999;

    return {
      lastLocal,
      lastOffDevice: lastOff,
      daysSinceOffDevice: days,
      level: days <= 3 ? 'ok' : days <= 7 ? 'warn' : 'bad',
    };
  },

  // ── Restore ────────────────────────────────────────────────────────────────

  /**
   * Restore from a file the user picks.
   *
   * A snapshot of the current data is written first. Restore is destructive and
   * people tap it by accident; without this there was no way back.
   */
  async restoreFromFile(): Promise<BackupResult> {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['application/json', 'text/plain', '*/*'],
        copyToCacheDirectory: true,
      });
      if (picked.canceled || !picked.assets?.[0]) {
        return { success: false, message: 'No file chosen.' };
      }

      const uri = picked.assets[0].uri;
      const json = await FileSystem.readAsStringAsync(uri, { encoding: 'utf8' });

      const snapshot = await this.createLocal('pre-restore');

      const result = await DatabaseService.importData(json);
      if (!result.success) return { success: false, message: result.message };

      return {
        success: true,
        message:
          result.message +
          (snapshot.success ? ' Your previous data was saved as a pre-restore backup.' : ''),
      };
    } catch (e: any) {
      return { success: false, message: e?.message || 'Could not read that file.' };
    }
  },

  async restoreBackup(): Promise<BackupResult> {
    return this.restoreFromFile();
  },

  /**
   * Look for a backup left behind by Android Auto Backup after a reinstall or
   * a new-phone transfer. Called once at startup when the database is empty.
   */
  async findRestorableBackup(): Promise<{ found: boolean; uri?: string; date?: string }> {
    try {
      const info = await FileSystem.getInfoAsync(DIR + LATEST);
      if (!info.exists) return { found: false };
      const json = await FileSystem.readAsStringAsync(DIR + LATEST, { encoding: 'utf8' });
      const parsed = JSON.parse(json);
      return { found: true, uri: DIR + LATEST, date: parsed.export_date };
    } catch {
      return { found: false };
    }
  },

  async restoreFromUri(uri: string): Promise<BackupResult> {
    try {
      const json = await FileSystem.readAsStringAsync(uri, { encoding: 'utf8' });
      const result = await DatabaseService.importData(json);
      return { success: result.success, message: result.message };
    } catch (e: any) {
      return { success: false, message: e?.message || 'Could not read that backup.' };
    }
  },

  // ── Recovery (database cannot be opened) ────────────────────────────────

  /**
   * Used by the startup recovery screen when the database cannot be opened.
   * The unreadable database is moved aside (never deleted), a fresh encrypted
   * database is created and the chosen backup is restored into it. No
   * "pre-restore" snapshot is taken here — there is nothing readable to save,
   * and writing one would overwrite the good automatic backup.
   */
  async recoverFromFile(): Promise<BackupResult> {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['application/json', 'text/plain', '*/*'],
        copyToCacheDirectory: true,
      });
      if (picked.canceled || !picked.assets?.[0]) return { success: false, message: 'No file chosen.' };
      const json = await FileSystem.readAsStringAsync(picked.assets[0].uri, { encoding: 'utf8' });
      const r = await DatabaseService.recoverFromBackupJson(json);
      return { success: r.success, message: r.message };
    } catch (e: any) {
      return { success: false, message: e?.message || 'Could not read that file.' };
    }
  },

  /** Same as recoverFromFile, using the app's own latest automatic backup. */
  async recoverFromLatestLocal(): Promise<BackupResult> {
    try {
      const info = await FileSystem.getInfoAsync(DIR + LATEST);
      if (!info.exists) return { success: false, message: 'No automatic backup was found on this phone.' };
      const json = await FileSystem.readAsStringAsync(DIR + LATEST, { encoding: 'utf8' });
      const r = await DatabaseService.recoverFromBackupJson(json);
      return { success: r.success, message: r.message };
    } catch (e: any) {
      return { success: false, message: e?.message || 'Could not read the automatic backup.' };
    }
  },

  async listLocal(): Promise<{ name: string; uri: string; size: number }[]> {
    try {
      await ensureDir();
      const files = await FileSystem.readDirectoryAsync(DIR);
      const out = [];
      for (const f of files.filter((x) => x.endsWith('.json')).sort().reverse()) {
        const info: any = await FileSystem.getInfoAsync(DIR + f);
        out.push({ name: f, uri: DIR + f, size: info.size || 0 });
      }
      return out;
    } catch {
      return [];
    }
  },

  async getBackupCount(): Promise<number> {
    const files = await this.listLocal();
    return files.filter((file) => file.name !== LATEST).length;
  },

  async getAutoBackupSettings(): Promise<{ enabled: boolean; hour: number }> {
    const enabled = (await DatabaseService.getSetting('auto_backup_enabled')) !== 'false';
    const rawHour = await DatabaseService.getSetting('auto_backup_hour');
    const storedHour = rawHour ? Number(rawHour) : NaN;
    return { enabled, hour: Number.isInteger(storedHour) && storedHour >= 0 && storedHour <= 23 ? storedHour : 1 };
  },

  // ── Reminder ───────────────────────────────────────────────────────────────

  /**
   * A nudge, not the backup itself. Only shown when the off-device copy is
   * actually stale — a daily notification that fires whether or not anything
   * is wrong gets dismissed on reflex and then ignored when it matters.
   */
  async scheduleReminder(hour = 21) {
    try {
      await DatabaseService.setSetting('auto_backup_hour', String(hour));
      await Notifications.cancelScheduledNotificationAsync(NOTIF_ID).catch(() => {});
      const { level } = await this.health();
      if (level === 'ok') return;

      await Notifications.scheduleNotificationAsync({
        identifier: NOTIF_ID,
        content: {
          title: 'Your salon data is not backed up',
          body:
            level === 'bad'
              ? 'It has been over a week. Tap to save a copy off this phone.'
              : 'Tap to save a copy off this phone.',
          data: { screen: 'Settings', section: 'backup' },
        },
        trigger: { hour, minute: 0, repeats: true } as any,
      });
    } catch { /* notifications not permitted */ }
  },

  async cancelReminder() {
    try { await Notifications.cancelScheduledNotificationAsync(NOTIF_ID); } catch { }
  },
};

export default BackupService;
