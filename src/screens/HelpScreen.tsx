import React, { useMemo, useState } from 'react';
import { View, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { Text } from '../theme/Text';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeScreen } from '../components/SafeScreen';
import { Card, SearchBar, SectionLabel, Button } from '../components/UI';
import { useTheme } from '../context/ThemeContext';
import { LICENSE_PLANS, pricesFor, currencyOfPrices } from '../services/licensePlans';
import { contactSupport, SUPPORT_WHATSAPP, REFUND_DAYS } from '../config/sales';
import { CrashLog } from '../utils/crashLog';
import { fmtMoney, getRegion, REGION_BY_CODE, priceRoundStep } from '../config/regions';

/**
 * Every question owners asked on sales visits, answered inside the app — so
 * the buyer gets the answer at 10 pm without calling anyone.
 */
type QA = { q: string; a: string; go?: { label: string; route: string } };
const PCUR = () => currencyOfPrices(getRegion().currency);
const PR = () => pricesFor(PCUR());
const inr = (n: number) => fmtMoney(n, { region: PCUR() === getRegion().currency ? getRegion() : REGION_BY_CODE.US, whole: Number.isInteger(n) });

function faqs(): { group: string; items: QA[] }[] {
  const P = LICENSE_PLANS;
  return [
    { group: 'Price & buying', items: [
      { q: 'How much does it cost? Monthly or yearly?', a: `You choose, in your own currency (${PCUR()}). Solo ${inr(PR().solo.monthly)}/month or ${inr(PR().solo.yearly)}/year. Salon Pro: ${inr(PR().standard.monthly)}/month or ${inr(PR().standard.yearly)}/year. Chain (3 branches): ${inr(PR().multi.monthly)}/month or ${inr(PR().multi.yearly)}/year. Salon + Academy: ${inr(PR().academy.monthly)}/month or ${inr(PR().academy.yearly)}/year. Yearly = 2 months free. Same features either way; cloud backup and online booking included.` },
      { q: 'What happens when my monthly plan ends?', a: 'You get a reminder on the home screen 7 days before, and 3 extra days after the end date to renew. Nothing is ever deleted — after renewing you continue exactly where you stopped. Renewing early adds the new days after your current end date, so you lose nothing.' },
      { q: 'Can I switch from monthly to yearly?', a: 'Yes, any time: Settings → License & Plan → Renew / extend · Upgrade, and enter the new key. Your data stays as it is.' },
      { q: 'What if I don’t like it?', a: REFUND_DAYS > 0 ? `Full refund within ${REFUND_DAYS} days, no questions asked.` : 'Talk to us on WhatsApp — we will fix it or refund you.' },
      { q: 'Can I upgrade later?', a: 'Yes. Pay the difference and get a new key — all your data stays exactly as it is.' },
      { q: 'I have more than 3 branches.', a: `The Chain plan covers 3 branches. Extra branches are added to your plan — ask us on WhatsApp. Every branch gets its own phone and its own booking link.` },
      { q: 'Do future updates cost money?', a: 'Updates to your plan are free. Settings → Check for updates shows when a new version is out.' },
      { q: 'Can I see it working before I pay?', a: 'Yes — Settings → Demo salon fills the app with 75 days of realistic data so you can try every screen. "Start fresh" removes it.', go: { label: 'Why SaloonBossX', route: 'WhyUs' } },
    ] },
    { group: 'Your data & safety', items: [
      { q: 'Where is my data stored?', a: 'On your phone, in an encrypted database. With the free cloud on, an encrypted copy is saved every day. It is locked on your phone with your own key before upload — nobody else, not even us or Google, can read your customers or sales.' },
      { q: 'What if my phone is lost, stolen or broken?', a: 'Install the app on the new phone → Branches & Cloud → "Join / new phone" → paste your recovery key → turn on "owner’s new phone" → pick the latest backup. Everything is back in 2 minutes. Save the recovery key on WhatsApp the day you turn on the cloud (the setup checklist reminds you).', go: { label: 'Branches & Cloud', route: 'BranchHub' } },
      { q: 'How do I turn on cloud backup?', a: 'One tap: home screen checklist → "Turn on", or Branches & Cloud → "Turn on cloud". No Google login and nothing to install. If you chose it during first setup, it is already on.', go: { label: 'Branches & Cloud', route: 'BranchHub' } },
      { q: 'Can my staff see my income?', a: 'Only if you allow it. Each staff member logs in with their own PIN, and you choose what they can see. Revenue, reports and Boss AI money answers are hidden from staff by default.', go: { label: 'Users & Access', route: 'Users' } },
      { q: 'Can staff delete or change a bill?', a: 'No. Bills cannot be deleted (tax rules). Cancelling needs permission and creates a credit note, and Boss AI flags anyone cancelling or discounting more than usual.' },
      { q: 'Does it work without internet?', a: 'Yes, fully — billing, calendar, reports, Boss AI. Internet is only needed to send WhatsApp messages, sync branches and back up to Drive, which happen automatically when the network returns.' },
    ] },
    { group: 'Daily work', items: [
      { q: 'Can I bring in my existing customers?', a: 'Yes — Clients → the import button (or Settings → Import customers). Pick customers from your phone contacts, or load an Excel/CSV file with Name, Phone and Birthday. Duplicates are skipped automatically.', go: { label: 'Import customers', route: 'ImportClients' } },
      { q: 'Can I put my logo and my own message on bills?', a: 'Yes — Settings → Bill design & printer: logo, bill number prefix, a footer message (Instagram handle, terms), printer size, and a test print.', go: { label: 'Bill design', route: 'BillDesign' } },
      { q: 'How do I raise all prices at once?', a: `Services → % button → +5%, +10% or −10%. Prices are rounded to the nearest ${fmtMoney(priceRoundStep())}; old bills are not changed.` },
      { q: 'How fast is billing?', a: 'About 10 seconds: pick or add the client, tap a quick-add service, choose payment, done. The bill goes to the customer on WhatsApp as text or PDF.' },
      { q: 'Can I give credit (pay later)?', a: 'Yes. Choose "Pay later" on the bill (with an advance if any). Dues show on the home screen and the client profile; collect part or full later and send a WhatsApp reminder.' },
      { q: 'Will my thermal printer work?', a: 'Yes for 58 mm and 80 mm printers that have an Android print service (install the free RawBT app for most Bluetooth printers). Set it in Settings → Bill printer. A4 printing and PDF also work.' },
      { q: 'Does it make tax invoices (GST / VAT / sales tax)?', a: getRegion().code === 'IN' ? 'Yes — GST invoices with your GSTIN, CGST/SGST split, consecutive numbering each financial year, credit notes, and GSTR-1 / 3B summaries. If you are not GST registered, keep GST off.' : `Yes — ${getRegion().tax.name} invoices with your ${getRegion().tax.idLabel}, consecutive numbering, credit notes and a tax summary report. If you are not registered, keep tax off.` },
      { q: 'Can customers pay by QR?', a: getRegion().code === 'IN' ? 'Yes. Add your UPI ID in Salon Profile; the bill screen shows a QR with the exact amount for the customer to scan.' : `Yes. Add your ${getRegion().pay.fieldLabel} in Salon Profile; the bill screen shows a QR the customer scans to pay (${getRegion().pay.label}, PayPal, Stripe or any payment link).` },
      { q: 'Which languages and countries?', a: 'English, Spanish, Portuguese, French, Hindi, Marathi, Tamil, Telugu, Bengali, Gujarati and Kannada. 38 countries are built in (currency, tax, phone format, QR wallet) and any other country works in US$ — Settings → Country & currency.' },
    ] },
    { group: 'Customers & bookings', items: [
      { q: 'Can customers book appointments themselves?', a: 'Yes (Salon Pro and above). Tap "Start online booking — 1 tap": you get a link and QR poster right away. Customers pick a service and a free time; you accept in one tap and they get a WhatsApp confirmation. Free, no monthly fee.', go: { label: 'Online Booking', route: 'OnlineBooking' } },
      { q: 'A customer sees "Sorry, unable to open the file at present".', a: 'That is a Google page shown for old long script.google.com links (often on iPhones signed in to Google). Your link is now a short website link with your salon name — share it again from Online Booking → Share. Tap "Test" there to check it works like a customer’s phone would.', go: { label: 'Online Booking', route: 'OnlineBooking' } },
      { q: 'Can I change my booking link name?', a: 'Yes — Online Booking → Change link name. Old links keep working, so printed QR posters never break.', go: { label: 'Online Booking', route: 'OnlineBooking' } },
      { q: 'How do I get more Google reviews?', a: 'Paste your Google "Ask for reviews" link once (Settings → Google reviews). Every WhatsApp bill and printed bill then asks happy customers for a review with a link / QR, your booking page shows a "Google reviews" button, and Marketing has a one-tap "Ask recent customers for a review" campaign.', go: { label: 'Google reviews', route: 'BillDesign' } },
      { q: 'How do I get a "Book" button on Google Maps?', a: 'Google Business Profile → Edit profile → Bookings / Appointment links → paste your booking link.' },
      { q: 'Will it double-book?', a: 'No. Customers send a request for a free slot and you confirm it; the calendar blocks clashes for each stylist.' },
      { q: 'What marketing can I do from the app?', a: 'Marketing & Growth shows Boss AI campaigns built from your own data — due-back regulars, customers who stopped coming, birthdays, your quiet weekday, festivals, review requests. Each message is personal and goes from your WhatsApp one tap at a time (free). Plus a poster studio and photo / video posts with ready captions and hashtags.', go: { label: 'Marketing', route: 'Grow' } },
      { q: 'How do I bring old customers back?', a: 'Ask Boss AI "kaun customer nahi aaye?" or open Insights → Due back this week. Each client has a ready WhatsApp message — one tap to send.', go: { label: 'Boss AI', route: 'AIAssistant' } },
    ] },
    { group: 'Staff', items: [
      { q: 'How is commission calculated?', a: 'Each staff member has a commission % and a salary type (fixed, commission or both). Pay slips are calculated from their bills and attendance for the month.' },
      { q: 'How does attendance work?', a: 'Staff check in / out on their own login, or you mark it. Your rules decide full day, half day or absent based on hours worked.', go: { label: 'Attendance Rules', route: 'AttendanceRules' } },
    ] },
    { group: 'More than one salon', items: [
      { q: 'Can I watch all my branches from my phone?', a: 'Yes (Chain plan). Each branch syncs encrypted to the cloud; the HQ Dashboard shows today, this month, staff, stock, dues and alerts for every branch.', go: { label: 'HQ Dashboard', route: 'HQDashboard' } },
      { q: 'How do I add a branch?', a: 'On the owner’s phone: Branches & Cloud → "Add a branch phone" → send the link on WhatsApp. On the branch phone, tap the link → Open in SaloonBossX → Join. That is all — about 1 minute per branch.', go: { label: 'Branches & Cloud', route: 'BranchHub' } },
      { q: 'Can I change prices for all branches at once?', a: 'Yes — change them on the head-office phone and tap "Publish price list". Branches update on their next sync.' },
    ] },
    { group: 'Help & support', items: [
      { q: 'Who sets it up?', a: 'You can, in about 5 minutes: a checklist on the home screen has a one-tap button for cloud backup and online booking, and ticks itself as you go. We also do it free on a call if you prefer.' },
      { q: 'Something is not working.', a: 'Message us on WhatsApp from the button below with a screenshot — we usually reply the same day.' },
    ] },
  ];
}

export default function HelpScreen() {
  const { colors: c } = useTheme();
  const nav = useNavigation<any>();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const all = useMemo(faqs, []);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return all;
    return all.map(g => ({ ...g, items: g.items.filter(i => (i.q + ' ' + i.a).toLowerCase().includes(s)) })).filter(g => g.items.length);
  }, [q, all]);

  return (
    <SafeScreen>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <SearchBar value={q} onChangeText={setQ} placeholder="Search: backup, printer, udhaar, GST…" style={{ marginBottom: 14 }} />
        {filtered.map(g => (
          <View key={g.group}>
            <SectionLabel>{g.group}</SectionLabel>
            <Card padded={false}>
              {g.items.map((it, i) => {
                const isOpen = open === it.q || !!q;
                return (
                  <TouchableOpacity key={it.q} activeOpacity={0.8} onPress={() => setOpen(isOpen && !q ? null : it.q)}
                    style={{ padding: 14, borderTopWidth: i ? 0.5 : 0, borderTopColor: c.divider }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={{ color: c.text, fontWeight: '800', flex: 1 }}>{it.q}</Text>
                      <MaterialCommunityIcons name={isOpen ? 'chevron-up' : 'chevron-down'} size={20} color={c.textMuted} />
                    </View>
                    {isOpen && (
                      <>
                        <Text style={{ color: c.textSecondary, marginTop: 8, lineHeight: 20 }}>{it.a}</Text>
                        {it.go && <TouchableOpacity onPress={() => { try { nav.navigate(it.go!.route); } catch {} }}><Text style={{ color: c.primary, fontWeight: '800', marginTop: 8 }}>{it.go.label} ›</Text></TouchableOpacity>}
                      </>
                    )}
                  </TouchableOpacity>
                );
              })}
            </Card>
          </View>
        ))}
        {filtered.length === 0 && <Text style={{ color: c.textMuted, textAlign: 'center', marginTop: 30 }}>No answer found — ask us on WhatsApp.</Text>}
        {SUPPORT_WHATSAPP ? (
          <Button label="Ask us on WhatsApp" icon="whatsapp" color={c.whatsapp} style={{ marginTop: 10 }} onPress={async () => { try { await contactSupport(`Hi! I have a question about SaloonBossX.\n\n(${(await CrashLog.report().catch(() => '')).split('\n')[0]})`); } catch { Alert.alert('WhatsApp did not open', 'Please check that WhatsApp is installed.'); } }} />
        ) : null}
        {SUPPORT_WHATSAPP ? (
          <Button label="Something is broken — send report" icon="bug-outline" variant="ghost" style={{ marginTop: 6 }} onPress={async () => { try { await contactSupport(`Hi, something is not working in SaloonBossX:\n\n${await CrashLog.report().catch(() => '')}`); } catch { Alert.alert('WhatsApp did not open', 'Please check that WhatsApp is installed.'); } }} />
        ) : null}
      </ScrollView>
    </SafeScreen>
  );
}
