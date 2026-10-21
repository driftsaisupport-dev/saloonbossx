import { getRegion, internationalPhone } from '../config/regions';
import { Linking, Alert } from 'react-native';

export const WhatsAppService = {
  /**
   * Digits for wa.me / tel: links — country code + number. Works for every
   * country in src/config/regions.ts; a number saved as +44… is kept as is.
   * `countryCode` overrides the salon's own dial code (digits only).
   */
  formatPhone(phone: string, countryCode?: string): string {
    const raw = String(phone || '').trim();
    if (!raw.replace(/\D/g, '')) return '';
    if (countryCode && countryCode.replace(/\D/g, '') !== getRegion().dial) {
      const p = raw.replace(/\D/g, '').replace(/^00/, '').replace(/^0/, '');
      const cc = countryCode.replace(/\D/g, '');
      return raw.startsWith('+') || p.startsWith(cc) ? p : cc + p;
    }
    return internationalPhone(raw);
  },

  /** Opens WhatsApp. Returns false when the number is invalid or WhatsApp could not open. */
  async sendMessage(phone: string, message: string, countryCode?: string): Promise<boolean> {
    try {
      const formatted = this.formatPhone(phone, countryCode);
      if (!formatted || formatted.length < 10) {
        Alert.alert('Invalid Phone', 'No valid phone number available.');
        return false;
      }
      const encoded = encodeURIComponent(message);
      // Try WhatsApp app first
      const appUrl = `whatsapp://send?phone=${formatted}&text=${encoded}`;
      const canOpen = await Linking.canOpenURL(appUrl);
      if (canOpen) {
        await Linking.openURL(appUrl);
      } else {
        // Fallback to wa.me (opens browser, works on any device)
        await Linking.openURL(`https://wa.me/${formatted}?text=${encoded}`);
      }
      return true;
    } catch (e) {
      console.error('WhatsApp send error:', e);
      Alert.alert('Error', 'Could not open WhatsApp. Please check your phone number.');
      return false;
    }
  },

  async call(phone: string, countryCode?: string): Promise<void> {
    try {
      const formatted = this.formatPhone(phone, countryCode);
      if (!formatted) return;
      await Linking.openURL(`tel:+${formatted}`);
    } catch (e) {
      console.error('Call error:', e);
    }
  },

  buildAppointmentReminder(clientName: string, salonName: string, dateStr: string, time: string, staffName: string): string {
    return `Hi ${clientName}! 👋\n\nThis is a reminder for your appointment tomorrow:\n\n📅 Date: ${dateStr}\n⏰ Time: ${time}\n💇 With: ${staffName}\n🏪 At: ${salonName}\n\nSee you soon! Reply STOP to cancel.`;
  },

  buildAppointmentConfirmation(clientName: string, salonName: string, dateStr: string, time: string, staffName: string, services: string): string {
    return `Hi ${clientName}! 👋\n\nYour appointment at ${salonName} is confirmed ✅\n\n📅 Date: ${dateStr}\n⏰ Time: ${time}\n✂️ Service: ${services || 'Salon service'}\n💇 With: ${staffName || 'our team'}\n\nSee you soon!`;
  },

  // "Your appointment is in 1 hour / 30 minutes" — used by the owner-facing
  // reminder notification and the Send buttons on the Dashboard and Calendar.
  buildUpcomingReminder(clientName: string, salonName: string, minutesLeft: number, time: string, services: string, staffName: string): string {
    const when = minutesLeft <= 0 ? 'starting now'
      : minutesLeft >= 50 ? 'in 1 hour'
      : `in ${Math.max(5, Math.round(minutesLeft / 5) * 5)} minutes`;
    return `Hi ${clientName}! ⏰\n\nA quick reminder — your appointment for ${services || 'your service'} at ${salonName} is ${when} (${time})${staffName ? ` with ${staffName}` : ''}.\n\nSee you soon! ✂️`;
  },

  buildBirthdayWish(clientName: string, salonName: string, phone: string): string {
    return `🎂 Happy Birthday ${clientName}!\n\nWishing you a beautiful day from all of us at ${salonName}.\n\nAs our birthday gift, enjoy 15% OFF your next visit! 🎁\n\nBook: ${phone}`;
  },

  buildAnniversaryWish(clientName: string, salonName: string): string {
    return `💍 Happy Anniversary ${clientName}!\n\nCelebrate your special day in style at ${salonName}! Enjoy a complimentary add-on service on your next visit.\n\nWe can't wait to see you! ✨`;
  },

  buildBillReceipt(billNumber: string, salonName: string, total: number, currencySymbol: string): string {
    return `Thank you for visiting ${salonName}! 😊\n\nBill #${billNumber}\nTotal Paid: ${currencySymbol}${total}\n\nWe hope to see you again soon! ✂️`;
  },

  buildReappointmentReminder(clientName: string, salonName: string, lastVisitDate: string, phone: string): string {
    return `Hi ${clientName}! 💇\n\nIt's been a while since your last visit to ${salonName} on ${lastVisitDate}.\n\nTime for a fresh look? Book your next appointment:\n📞 ${phone}\n\nSee you soon! ✂️`;
  },

  // Default template for the owner-customizable "days since last visit" WhatsApp
  // reminder (Settings > WhatsApp Reminders). Kept here so Settings and
  // Dashboard both see the same default without duplicating the string.
  DEFAULT_REENGAGE_MESSAGE: "Hi {name}! 👋\n\nWe miss you at {salon}! It's been {days}+ days since your last visit.\n\nBook your appointment today and enjoy a special offer!\n\nCall us: {phone} 📞",

  // Replaces {name}/{salon}/{phone}/{days}/etc. placeholders in an
  // owner-written template. Unknown placeholders are left as-is rather than
  // stripped, so a typo is visible in the preview instead of silently eaten.
  fillTemplate(template: string, vars: Record<string, string | number>): string {
    return template.replace(/\{(\w+)\}/g, (match, key) =>
      Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match
    );
  },
};
