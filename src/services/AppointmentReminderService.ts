/**
 * AppointmentReminderService — tells the owner, on this device, when a booked
 * appointment is 1 hour and 30 minutes away, and lets them WhatsApp the client
 * an auto-written "your appointment is in X" message in one tap.
 *
 * Everything is a local notification: no server, works offline.
 */
import { Alert, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { DatabaseService } from '../database/Database';
import { WhatsAppService } from './WhatsAppService';
import { toLocalDateStr } from '../utils/helpers';
import { appLocale } from '../config/regions';

const CHANNEL_ID = 'appointments';
const CATEGORY_ID = 'appointment-reminder';
const ACTION_SEND = 'send-whatsapp';
const LEAD_MINUTES = [60, 30];
// iOS keeps at most 64 pending local notifications; leave room for the backup nudge.
const MAX_APPOINTMENTS_SCHEDULED = 28;
const WINDOW_DAYS = 7;

export interface ReminderAppointment {
  id: number;
  date: string;        // YYYY-MM-DD
  start_time: string;  // HH:MM
  client_name?: string;
  client_phone?: string;
  staff_name?: string;
  service_names?: string;
  is_walkin?: number | boolean;
  status?: string;
}

const idFor = (aptId: number, minutes: number) => `sbx-apt-${aptId}-${minutes}`;

function startOf(apt: { date: string; start_time: string }): Date {
  const [y, mo, d] = apt.date.split('-').map(Number);
  const [h, mi] = apt.start_time.split(':').map(Number);
  return new Date(y, (mo || 1) - 1, d || 1, h || 0, mi || 0, 0, 0);
}

export function minutesUntil(apt: { date: string; start_time: string }): number {
  return Math.round((startOf(apt).getTime() - Date.now()) / 60000);
}

async function salonInfo(): Promise<{ name: string; phone: string }> {
  try {
    const p: any = await DatabaseService.getSalonProfile();
    return { name: p?.name || 'our salon', phone: p?.phone || '' };
  } catch { return { name: 'our salon', phone: '' }; }
}

export const AppointmentReminderService = {
  /** Foreground display, Android channel and the "Send message" button. Safe to call repeatedly. */
  async init() {
    try {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false,
        }),
      });
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
          name: 'Appointment reminders',
          importance: Notifications.AndroidImportance.HIGH,
        });
      }
      await Notifications.setNotificationCategoryAsync(CATEGORY_ID, [
        { identifier: ACTION_SEND, buttonTitle: 'Send message', options: { opensAppToForeground: true } },
      ]);
    } catch { /* notifications unavailable on this device */ }
  },

  async ensurePermission(): Promise<boolean> {
    try {
      const cur = await Notifications.getPermissionsAsync();
      if (cur.granted) return true;
      if (!cur.canAskAgain) return false;
      const req = await Notifications.requestPermissionsAsync();
      return !!req.granted;
    } catch { return false; }
  },

  async cancelForAppointment(aptId: number) {
    for (const m of LEAD_MINUTES) {
      await Notifications.cancelScheduledNotificationAsync(idFor(aptId, m)).catch(() => {});
    }
  },

  /** Replaces any existing reminders for this appointment with 1h + 30m ones (only those still in the future). */
  async scheduleForAppointment(apt: ReminderAppointment) {
    try {
      await this.cancelForAppointment(apt.id);
      if (apt.status && apt.status !== 'confirmed') return;
      if (!(await this.ensurePermission())) return;

      const start = startOf(apt);
      const salon = await salonInfo();
      const who = apt.is_walkin ? 'Walk-in' : (apt.client_name || 'Client');

      for (const m of LEAD_MINUTES) {
        const at = new Date(start.getTime() - m * 60000);
        if (at.getTime() <= Date.now() + 5000) continue;
        const label = m === 60 ? '1 hour' : `${m} minutes`;
        const message = apt.client_phone
          ? WhatsAppService.buildUpcomingReminder(apt.client_name || 'there', salon.name, m, apt.start_time, apt.service_names || '', apt.staff_name || '')
          : '';
        await Notifications.scheduleNotificationAsync({
          identifier: idFor(apt.id, m),
          content: {
            title: `Appointment in ${label}`,
            body: `${who} · ${apt.service_names || 'Service'} at ${apt.start_time}${apt.staff_name ? ` with ${apt.staff_name}` : ''}.${apt.client_phone ? ' Tap to message them.' : ''}`,
            categoryIdentifier: apt.client_phone ? CATEGORY_ID : undefined,
            data: { type: 'appointment_reminder', appointmentId: apt.id, phone: apt.client_phone || '', message, client: who },
          },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: CHANNEL_ID },
        });
      }
    } catch { /* not permitted / unavailable — the in-app "Starting soon" list still works */ }
  },

  /**
   * Rebuilds reminders for the next few days from the database. Run on launch and
   * whenever the app comes to the foreground so a restored backup, an edited time,
   * or a rolling 64-notification limit never leaves an appointment without one.
   */
  async syncUpcoming() {
    try {
      const rows: any[] = [];
      for (let i = 0; i <= WINDOW_DAYS; i++) {
        const d = new Date(); d.setDate(d.getDate() + i);
        rows.push(...(await DatabaseService.getAppointments(toLocalDateStr(d)) as any[]));
      }
      const upcoming = rows
        .filter(a => a.status === 'confirmed' && minutesUntil(a) > 30)
        .sort((a, b) => startOf(a).getTime() - startOf(b).getTime())
        .slice(0, MAX_APPOINTMENTS_SCHEDULED);
      for (const a of upcoming) await this.scheduleForAppointment(a);
    } catch { /* ignore */ }
  },

  /** Confirmation sent to the client right after booking. */
  async sendConfirmation(apt: ReminderAppointment & { end_time?: string }) {
    if (!apt.client_phone) { Alert.alert('No phone number', 'This client has no phone number saved.'); return; }
    const salon = await salonInfo();
    const dateLabel = new Date(`${apt.date}T00:00:00`).toLocaleDateString(appLocale(), { weekday: 'short', day: 'numeric', month: 'short' });
    const text = WhatsAppService.buildAppointmentConfirmation(
      apt.client_name || 'there', salon.name, dateLabel,
      apt.end_time ? `${apt.start_time} – ${apt.end_time}` : apt.start_time,
      apt.staff_name || '', apt.service_names || '');
    await WhatsAppService.sendMessage(apt.client_phone, text);
  },

  /** "Your appointment is in X" message for an appointment, worded from the real time left. */
  async sendUpcomingReminder(apt: ReminderAppointment) {
    if (!apt.client_phone) { Alert.alert('No phone number', 'This client has no phone number saved.'); return; }
    const salon = await salonInfo();
    const text = WhatsAppService.buildUpcomingReminder(
      apt.client_name || 'there', salon.name, minutesUntil(apt), apt.start_time, apt.service_names || '', apt.staff_name || '');
    await WhatsAppService.sendMessage(apt.client_phone, text);
  },

  /** A tap that launched the app from a closed state arrives before any listener exists. */
  async handleLaunchResponse() {
    try {
      const last = await Notifications.getLastNotificationResponseAsync();
      if (!last) return;
      const key = `${last.notification.request.identifier}:${last.notification.date}`;
      if ((await DatabaseService.getSetting('last_apt_notif_handled')) === key) return;
      if (this.handleResponse(last)) await DatabaseService.setSetting('last_apt_notif_handled', key);
    } catch { /* ignore */ }
  },

  /** Handles a tap on an appointment reminder notification. Returns true if it was one. */
  handleResponse(response: Notifications.NotificationResponse): boolean {
    const data: any = response?.notification?.request?.content?.data;
    if (data?.type !== 'appointment_reminder') return false;
    if (!data.phone || !data.message) return true;
    const send = () => WhatsAppService.sendMessage(data.phone, data.message);
    if (response.actionIdentifier === ACTION_SEND) { send(); return true; }
    Alert.alert('Send reminder?', `Message ${data.client} on WhatsApp:\n\n${data.message}`, [
      { text: 'Not now', style: 'cancel' },
      { text: 'Send on WhatsApp', onPress: send },
    ]);
    return true;
  },
};
