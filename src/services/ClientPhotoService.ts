import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';

/**
 * Consultation photos (before / after, patch tests, nail art, bridal looks).
 *
 * The image picker / camera hands back a TEMPORARY file in the cache, which
 * Android and iOS may delete at any time. savePhoto() copies it into the app's
 * own documents folder under a random name and returns that stable URI, which
 * is what client_notes.photo_uri stores.
 *
 * Photos are NOT part of the JSON backup (they would make it huge); the
 * backup carries a warning saying so — see DatabaseService.getBackupWarnings().
 */

const DIR = () => (FileSystem.documentDirectory || '') + 'client-photos/';

async function ensureDir() {
  const info = await FileSystem.getInfoAsync(DIR());
  if (!info.exists) await FileSystem.makeDirectoryAsync(DIR(), { intermediates: true });
}

/** True only for files inside our own client-photos folder (no "../" escapes). */
export function isClientPhotoUri(uri: string): boolean {
  const u = String(uri || '');
  if (!u || !DIR() || !u.startsWith(DIR())) return false;
  const rest = u.slice(DIR().length);
  return /^[A-Za-z0-9-]+\.(jpg|jpeg|png|webp)$/i.test(rest);
}

export const ClientPhotoService = {
  folder(): string { return DIR(); },

  /**
   * Copy a picked/captured image into permanent app storage.
   * @returns the stable file:// URI to store on the note.
   */
  async savePhoto(tempUri: string): Promise<string> {
    if (!tempUri) throw new Error('No photo was chosen.');
    const ext = (/\.(png|webp|jpe?g)(\?|$)/i.exec(tempUri)?.[1] || 'jpg').toLowerCase().replace('jpeg', 'jpg');
    await ensureDir();
    const target = `${DIR()}${Crypto.randomUUID()}.${ext}`;
    try {
      await FileSystem.copyAsync({ from: tempUri, to: target });
    } catch (e: any) {
      throw new Error(`Could not save the photo on this phone (${e?.message || 'copy failed'}). Check free storage and try again.`);
    }
    const info: any = await FileSystem.getInfoAsync(target);
    if (!info?.exists || !(info.size > 0)) throw new Error('The photo could not be saved (empty file). Please take it again.');
    return target;
  },

  /**
   * Delete a saved photo. Refuses anything outside the client-photos folder,
   * so a bad URI can never delete other app files. Returns true if removed.
   */
  async deletePhoto(uri: string): Promise<boolean> {
    if (!isClientPhotoUri(uri)) return false;
    await FileSystem.deleteAsync(uri, { idempotent: true });
    return true;
  },

  /** How many photos are stored (for the backup warning). */
  async count(): Promise<number> {
    try {
      const info = await FileSystem.getInfoAsync(DIR());
      if (!info.exists) return 0;
      return (await FileSystem.readDirectoryAsync(DIR())).length;
    } catch { return 0; }
  },
};

export default ClientPhotoService;
