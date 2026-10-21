/**
 * Everything a seller changes lives here, fed from .env / eas.json via app.config.js.
 * Nothing in this file is secret.
 */
import Constants from 'expo-constants';
import { Linking } from 'react-native';
import { getRegion } from './regions';

const extra: any = Constants.expoConfig?.extra || {};

/** Your website checkout page. Plan, email and device id are appended as query params. */
export const BUY_URL: string = process.env.EXPO_PUBLIC_BUY_URL || extra.buyUrl || '';
/** WhatsApp number with country code, digits only, e.g. 919876543210. */
export const SUPPORT_WHATSAPP: string = (process.env.EXPO_PUBLIC_SUPPORT_WHATSAPP || extra.supportWhatsapp || '').replace(/\D/g, '');
export const SUPPORT_EMAIL: string = process.env.EXPO_PUBLIC_SUPPORT_EMAIL || extra.supportEmail || '';
/** Free trial length in days. 0 = no trial (launch default: sell, don't lend). */
export const TRIAL_DAYS: number = Number(process.env.EXPO_PUBLIC_TRIAL_DAYS ?? extra.trialDays ?? 0) || 0;

/** Your UPI id, so a salon owner can pay on the spot from their own phone. */
export const SELLER_UPI: string = process.env.EXPO_PUBLIC_SELLER_UPI || extra.sellerUpi || '';
export const SELLER_NAME: string = process.env.EXPO_PUBLIC_SELLER_NAME || extra.sellerName || 'SaloonBossX';
/**
 * "Make a copy" link of the Cloud Bridge template Sheet, e.g.
 * https://docs.google.com/spreadsheets/d/<ID>/copy — lets an owner create their
 * free cloud in one tap instead of pasting code. Empty = manual script path.
 */
export const CLOUD_TEMPLATE_URL: string = process.env.EXPO_PUBLIC_CLOUD_TEMPLATE_URL || extra.cloudTemplateUrl || '';

/**
 * Shared Cloud Bridge (BranchSync.gs deployed ONCE in the seller's Google
 * account: Execute as Me, Who has access: Anyone). When set, owners turn on
 * backup, branches and online booking with ONE tap — no Google steps at all.
 * Everything a salon stores there is encrypted on the phone first.
 * See HOSTED_CLOUD_SETUP.md. Empty = each owner deploys their own script.
 */
/**
 * Your free booking website (booking-site/ on GitHub Pages), e.g.
 * https://saloonbossx.github.io — gives every salon a short link with its name:
 * https://saloonbossx.github.io/glow-beauty-vashi. Empty = long script link.
 */
export const BOOKING_SITE: string = (process.env.EXPO_PUBLIC_BOOKING_SITE || extra.bookingSite || '').trim().replace(/\/+$/, '');

export const CLOUD_URL: string = (process.env.EXPO_PUBLIC_CLOUD_URL || extra.cloudUrl || '').trim();

/** Days of money-back guarantee shown on the activation screen. 0 hides it. */
export const REFUND_DAYS: number = Number(process.env.EXPO_PUBLIC_REFUND_DAYS ?? extra.refundDays ?? 7) || 0;

async function tryOpen(url: string): Promise<boolean> {
  try { await Linking.openURL(url); return true; } catch { return false; }
}

/** Open WhatsApp chat with support, prefilled. Falls back to email. */
export async function contactSupport(message: string): Promise<boolean> {
  const text = encodeURIComponent(message);
  if (SUPPORT_WHATSAPP) {
    if (await tryOpen(`whatsapp://send?phone=${SUPPORT_WHATSAPP}&text=${text}`)) return true;
    if (await tryOpen(`https://wa.me/${SUPPORT_WHATSAPP}?text=${text}`)) return true;
  }
  if (SUPPORT_EMAIL) {
    return tryOpen(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('SaloonBossX')}&body=${text}`);
  }
  return false;
}

/**
 * Open the buyer's UPI app with the amount and a reference already filled in.
 * The reference is the device id, so the payment you receive tells you exactly
 * which phone to issue the key for. Returns false if no UPI id is configured
 * or no UPI app is installed.
 */
export async function payByUpi(opts: { planId: string; price: number; deviceId: string; billing?: string }): Promise<boolean> {
  // UPI is India-only; everywhere else the buyer goes to the card checkout.
  if (!SELLER_UPI || getRegion().code !== 'IN') return false;
  const ref = `SBX${opts.deviceId.slice(0, 10)}`;
  const url =
    `upi://pay?pa=${encodeURIComponent(SELLER_UPI)}&pn=${encodeURIComponent(SELLER_NAME)}` +
    `&am=${opts.price.toFixed(2)}&cu=INR` +
    `&tn=${encodeURIComponent(`SaloonBossX ${opts.planId} ${opts.billing || 'lifetime'} ${opts.deviceId.slice(0, 8)}`)}&tr=${ref}`;
  return tryOpen(url);
}

/** Send the buyer to checkout: website first, then WhatsApp, then email. */
export async function openCheckout(opts: { planId: string; planName: string; price: number; currency?: string; country?: string; email: string; name: string; deviceId: string; billing?: string }): Promise<boolean> {
  const currency = opts.currency || getRegion().currency;
  const country = opts.country || getRegion().code;
  if (BUY_URL) {
    const sep = BUY_URL.includes('?') ? '&' : '?';
    const url = `${BUY_URL}${sep}plan=${encodeURIComponent(opts.planId)}&billing=${encodeURIComponent(opts.billing || 'yearly')}&amount=${opts.price}` +
      `&currency=${encodeURIComponent(currency)}&country=${encodeURIComponent(country)}` +
      `&email=${encodeURIComponent(opts.email)}&name=${encodeURIComponent(opts.name)}` +
      `&device=${encodeURIComponent(opts.deviceId)}`;
    if (await tryOpen(url)) return true;
  }
  return contactSupport(
    `Hi, I want to buy SaloonBossX ${opts.planName} — ${opts.billing === 'monthly' ? 'Monthly' : opts.billing === 'yearly' ? 'Yearly' : 'One-time'} (${currency} ${opts.price}).\nCountry: ${country}\n` +
    `Name: ${opts.name || '-'}\nEmail: ${opts.email || '-'}\nDevice ID: ${opts.deviceId}`
  );
}
