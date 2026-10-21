import * as Application from 'expo-application';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Crypto from 'expo-crypto';
import { Platform, Linking } from 'react-native';
import Constants from 'expo-constants';
import { DatabaseService } from '../database/Database';
import { base64ToBytes, bytesToHex } from '../utils/bytes';
import { appLocale } from '../config/regions';

/**
 * SHA-256 of a file's actual BYTES, as lower-case hex.
 *
 * The old code hashed the base64 TEXT of the file, which never equals the
 * published sha256 of the APK — so every update failed verification (or, had
 * someone "fixed" it by publishing the hash of the base64, verified nothing).
 */
export async function sha256OfFile(uri: string): Promise<string> {
  let bytes: Uint8Array | null = null;
  try {
    // New expo-file-system API: reads the raw bytes natively.
    const { File } = require('expo-file-system');
    bytes = await new File(uri).bytes();
  } catch {
    bytes = null;
  }
  if (!bytes) {
    const b64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
    bytes = base64ToBytes(b64);
  }
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes as any);
  return bytesToHex(digest);
}

/** Last release JSON GitHub sent us, so a 304 Not Modified can be answered from cache. */
const RELEASE_CACHE_KEY = 'update_release_json';

/**
 * Updates.
 *
 * Three things were broken before:
 *
 *  1. Pushing commits to GitHub did nothing. The code polls the releases API,
 *     which only answers once a Release is published with the APK attached.
 *  2. CURRENT_VERSION was a hardcoded string that had to be kept in sync with
 *     app.json by hand, so it silently drifted.
 *  3. Even on detection nothing could be installed — no expo-updates for
 *     JavaScript changes, and no REQUEST_INSTALL_PACKAGES for binaries.
 *
 * Now there are two lanes. Most releases are JavaScript only and go out over
 * the air through expo-updates, which is what "push and it reaches the app"
 * actually means. Native changes need a new binary, handled below.
 */

const REPO =
  process.env.EXPO_PUBLIC_UPDATE_REPO ||
  (Constants.expoConfig?.extra as any)?.updateRepo ||
  '';

const API = REPO ? `https://api.github.com/repos/${REPO}/releases/latest` : '';

export interface ReleaseInfo {
  available: boolean;
  version: string;
  currentVersion: string;
  notes: string;
  apkUrl: string;
  sha256: string;
  sizeMb: number;
  mandatory: boolean;
}

export interface UpdateInfo {
  available: boolean;
  latestVersion: string;
  publishedAt: string;
  downloadUrl: string;
  releasePageUrl: string;
}

export const CURRENT_VERSION = currentVersion();

/** Single source of truth. Read from the binary, never hardcoded. */
export function currentVersion(): string {
  return (
    Application.nativeApplicationVersion ||
    Constants.expoConfig?.version ||
    '0.0.0'
  );
}

/** Semver compare. Returns true when b is newer than a. */
function isNewer(a: string, b: string): boolean {
  const pa = a.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (y > x) return true;
    if (y < x) return false;
  }
  return false;
}

/** GitHub release JSON → ReleaseInfo, or null when there is nothing newer to install. */
function parseRelease(data: any, current: string): ReleaseInfo | null {
  const version = String(data?.tag_name || '').replace(/^v/, '');
  if (!version || !isNewer(current, version)) return null;
  const asset = (data.assets || []).find((a: any) => String(a.name).endsWith('.apk'));
  if (!asset) return null;
  const body = String(data.body || '');
  // The release notes carry the APK hash and an optional minimum version.
  // Verifying the hash is not optional: downloading and installing an
  // arbitrary APK without checking it is a remote code execution channel
  // into your own product.
  const shaMatch = body.match(/sha256:\s*([a-fA-F0-9]{64})/);
  const minMatch = body.match(/min-version:\s*([\d.]+)/);
  return {
    available: true,
    version,
    currentVersion: current,
    notes: body.replace(/sha256:.*/gi, '').replace(/min-version:.*/gi, '').trim(),
    apkUrl: asset.browser_download_url,
    sha256: shaMatch ? shaMatch[1].toLowerCase() : '',
    sizeMb: Math.round(((asset.size || 0) / 1048576) * 10) / 10,
    mandatory: minMatch ? isNewer(current, minMatch[1]) : false,
  };
}

export const UpdateService = {
  // ── Lane 1: over-the-air JavaScript updates ───────────────────────────────

  /**
   * Fetch and stage an OTA update. Applies on the next launch rather than
   * reloading mid-shift — a salon owner half way through a bill will not thank
   * you for restarting the app.
   */
  async checkOTA(): Promise<{ available: boolean; message: string }> {
    try {
      const Updates = require('expo-updates');
      if (!Updates.isEnabled) return { available: false, message: '' };

      const check = await Updates.checkForUpdateAsync();
      if (!check.isAvailable) return { available: false, message: 'You are up to date.' };

      await Updates.fetchUpdateAsync();
      await DatabaseService.setSetting('ota_pending', '1');
      return {
        available: true,
        message: 'An update is ready. It will be applied next time you open the app.',
      };
    } catch {
      return { available: false, message: '' };
    }
  },

  /** Apply a staged OTA update. Call from a deliberate user action only. */
  async applyOTA(): Promise<void> {
    try {
      const Updates = require('expo-updates');
      await DatabaseService.setSetting('ota_pending', '');
      await Updates.reloadAsync();
    } catch { /* not an OTA build */ }
  },

  async hasPendingOTA(): Promise<boolean> {
    return (await DatabaseService.getSetting('ota_pending')) === '1';
  },

  // ── Lane 2: binary updates ────────────────────────────────────────────────

  /**
   * Check GitHub for a newer APK.
   *
   * Uses a cached ETag. Unauthenticated GitHub API calls are limited to 60 per
   * hour per IP, and a salon's shared wifi or a carrier NAT can put many
   * customers behind one address.
   */
  async checkBinary(): Promise<ReleaseInfo> {
    const current = currentVersion();
    const none: ReleaseInfo = {
      available: false, version: current, currentVersion: current,
      notes: '', apkUrl: '', sha256: '', sizeMb: 0, mandatory: false,
    };

    if (!API || Platform.OS !== 'android') return none;

    try {
      const etag = await DatabaseService.getSetting('update_etag');
      const cached = await DatabaseService.getSetting(RELEASE_CACHE_KEY);
      const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
      // Only send the ETag when we can answer a 304 from our cached copy.
      if (etag && cached) headers['If-None-Match'] = etag;

      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(API, { headers, signal: ctrl.signal });
      clearTimeout(t);

      let data: any;
      if (res.status === 304) {
        // Not modified: the release we cached last time is still the latest.
        try { data = JSON.parse(cached); } catch { return none; }
      } else {
        if (!res.ok) return none;
        data = await res.json();
        const newEtag = res.headers.get('etag');
        // Cache only what we use; the full GitHub payload can be large.
        const slim = {
          tag_name: data?.tag_name, body: data?.body,
          assets: (data?.assets || []).map((a: any) => ({ name: a.name, size: a.size, browser_download_url: a.browser_download_url })),
        };
        await DatabaseService.setSetting(RELEASE_CACHE_KEY, JSON.stringify(slim));
        await DatabaseService.setSetting('update_etag', newEtag || '');
      }
      return parseRelease(data, current) || none;
    } catch {
      return none;
    }
  },

  /**
   * Download an APK, verify its hash, then hand it to the system installer.
   * Refuses to install anything unverified.
   */
  async downloadAndInstall(
    info: ReleaseInfo,
    onProgress?: (pct: number) => void
  ): Promise<{ success: boolean; message: string }> {
    if (Platform.OS !== 'android') {
      return { success: false, message: 'On iPhone, updates come through the App Store.' };
    }
    if (!info.apkUrl) return { success: false, message: 'No download available.' };
    if (!info.sha256) {
      return {
        success: false,
        message: 'This release is missing its verification hash, so it cannot be installed safely.',
      };
    }

    const target = FileSystem.cacheDirectory + `SaloonBossX-${info.version}.apk`;

    try {
      await FileSystem.deleteAsync(target, { idempotent: true });

      const task = FileSystem.createDownloadResumable(
        info.apkUrl,
        target,
        {},
        (p) => {
          if (onProgress && p.totalBytesExpectedToWrite > 0) {
            onProgress(Math.round((p.totalBytesWritten / p.totalBytesExpectedToWrite) * 100));
          }
        }
      );

      const result = await task.downloadAsync();
      if (!result?.uri) return { success: false, message: 'Download did not finish.' };

      const digest = await sha256OfFile(result.uri);

      if (digest.toLowerCase() !== info.sha256.toLowerCase()) {
        await FileSystem.deleteAsync(result.uri, { idempotent: true });
        return {
          success: false,
          message: 'The downloaded file did not match its signature and was deleted. Try again on a different network.',
        };
      }

      const contentUri = await FileSystem.getContentUriAsync(result.uri);
      await IntentLauncher.startActivityAsync('android.intent.action.INSTALL_PACKAGE', {
        data: contentUri,
        flags: 1,
      });

      return { success: true, message: 'Installer opened.' };
    } catch (e: any) {
      return { success: false, message: e?.message || 'Could not download the update.' };
    }
  },

  /** Fallback when in-app install is blocked — open the release page. */
  async openReleasePage() {
    if (!REPO) return;
    await Linking.openURL(`https://github.com/${REPO}/releases/latest`);
  },

  /**
   * One call for the UI. OTA first because it is instant and free; a binary
   * check only matters when native code changed.
   */
  async checkAll(): Promise<{
    ota: boolean; binary: ReleaseInfo | null; message: string;
  }> {
    const ota = await this.checkOTA();
    if (ota.available) return { ota: true, binary: null, message: ota.message };

    const binary = await this.checkBinary();
    return {
      ota: false,
      binary: binary.available ? binary : null,
      message: binary.available
        ? `Version ${binary.version} is available.`
        : 'You are up to date.',
    };
  },

    async checkForUpdate(): Promise<UpdateInfo> {
      const result = await this.checkBinary();
      return {
        available: result.available,
        latestVersion: result.version,
        publishedAt: '',
        downloadUrl: result.apkUrl,
        releasePageUrl: REPO ? `https://github.com/${REPO}/releases/latest` : '',
      };
    },

    async forceCheck(): Promise<UpdateInfo> {
      return this.checkForUpdate();
    },

    formatPublishedDate(value: string): string {
      if (!value) return 'recently';
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? 'recently' : date.toLocaleDateString(appLocale());
    },
};

export default UpdateService;
