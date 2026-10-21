import React, { useMemo, useState } from 'react';
import { View, ScrollView, TouchableOpacity } from 'react-native';
import { Text, TextInput } from '../theme/Text';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeScreen } from '../components/SafeScreen';
import { Card, SectionLabel, Button } from '../components/UI';
import { useTheme } from '../context/ThemeContext';
import { LICENSE_PLANS, PlanId, pricesFor, currencyOfPrices } from '../services/licensePlans';
import { contactSupport, SUPPORT_WHATSAPP, REFUND_DAYS } from '../config/sales';
import { fmtMoney, localPrice, getRegion, curSym } from '../config/regions';

/**
 * "Why SaloonBossX" — the 60-second answer to "this is not for me".
 * Built for the sales visit: the owner types what THEY would pay elsewhere
 * and how many clients they lose, and sees the money in rupees.
 */
const inr = (n: number) => fmtMoney(Math.round(n), { whole: true });
/** Our yearly price per plan in the salon's currency (US$ where we do not sell in it). */
const ourYearly = (p: PlanId) => {
  const cur = currencyOfPrices(getRegion().currency);
  return cur === getRegion().currency ? pricesFor(cur)[p].yearly : localPrice(pricesFor('INR')[p].yearly);
};

const rows = (): { f: string; us: string; book: string; monthly: string }[] => [
  { f: 'Cost', us: `From ${inr(ourYearly('solo') / 12)}/month, billed yearly`, book: 'Free', monthly: `${inr(localPrice(1000))}–${inr(localPrice(2500))} every month` },
  { f: 'Works without internet', us: 'Yes, fully', book: 'Yes', monthly: 'Usually needs internet' },
  { f: 'Where your data lives', us: 'Your phone + encrypted cloud', book: 'Paper', monthly: 'Their server' },
  { f: `${getRegion().tax.name} invoice on WhatsApp in 10 sec`, us: 'Yes', book: 'No', monthly: 'Yes' },
  { f: 'Knows who is due back', us: 'Yes — Boss AI', book: 'No', monthly: 'Sometimes' },
  { f: 'Catches discount / cancel misuse', us: 'Yes — Boss AI', book: 'No', monthly: 'Rarely' },
  { f: 'All branches on one phone', us: 'Yes (Multi plan)', book: 'No', monthly: 'Higher plan' },
  { f: '11 languages, 38 countries', us: 'Yes — local currency, tax & phone', book: '—', monthly: 'Often English only' },
  { f: 'Pay-later / dues tracking', us: 'Yes', book: 'Separate diary', monthly: 'Sometimes' },
  { f: 'Customers book online 24×7', us: 'Yes — free link + QR', book: 'No', monthly: 'Yes' },
];

export default function WhyUsScreen() {
  const { colors: c } = useTheme();
  const [plan, setPlan] = useState<PlanId>('standard');
  const [monthly, setMonthly] = useState(String(localPrice(1000)));
  const [years, setYears] = useState(3);
  const [winback, setWinback] = useState('4');
  const [avgBill, setAvgBill] = useState(String(localPrice(600)));
  const [leak, setLeak] = useState(String(localPrice(2000)));

  const price = ourYearly(plan);
  const calc = useMemo(() => {
    const m = Number(monthly) || 0, wb = Number(winback) || 0, ab = Number(avgBill) || 0, lk = Number(leak) || 0;
    const subscription = m * 12 * years;
    const saved = Math.max(0, subscription - price * years);
    const extraYear = wb * ab * 12;
    const leakYear = lk * 12;
    const monthlyGain = wb * ab + lk;
    const paybackDays = monthlyGain > 0 ? Math.ceil(price / (monthlyGain / 30)) : 0;
    return { subscription, saved, extraYear, leakYear, paybackDays };
  }, [monthly, years, winback, avgBill, leak, price]);

  return (
    <SafeScreen keyboard>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <View style={{ backgroundColor: c.brandInk, borderRadius: 22, padding: 18, marginBottom: 14 }}>
          <Text style={{ color: c.brandGold, fontWeight: '900', fontSize: 12, letterSpacing: 1.5 }}>PREMIUM · MONTHLY OR YEARLY</Text>
          <Text style={{ color: '#fff', fontWeight: '900', fontSize: 22, marginTop: 6, lineHeight: 28 }}>Your salon’s manager, accountant and marketing assistant — in one app.</Text>
          <Text style={{ color: '#CFC8B8', fontSize: 13, marginTop: 8, lineHeight: 19 }}>Works offline. Data stays with you. {REFUND_DAYS > 0 ? `${REFUND_DAYS}-day money-back promise.` : ''}</Text>
        </View>

        <SectionLabel>Your money, worked out</SectionLabel>
        <Card>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {(Object.keys(LICENSE_PLANS) as PlanId[]).map(p => (
              <TouchableOpacity key={p} onPress={() => setPlan(p)} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: plan === p ? c.primary : c.surface }}>
                <Text style={{ color: plan === p ? c.onPrimary : c.textSecondary, fontWeight: '800', fontSize: 12 }}>{LICENSE_PLANS[p].name} {inr(ourYearly(p))}/yr</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
            <Field c={c} label={`Another app would cost (${curSym().trim()}/month)`} value={monthly} onChange={setMonthly} />
            <View style={{ width: 110 }}>
              <Text style={{ color: c.textMuted, fontSize: 11.5, fontWeight: '700', marginBottom: 5 }}>Over</Text>
              <View style={{ flexDirection: 'row', gap: 4 }}>
                {[1, 3, 5].map(y => (
                  <TouchableOpacity key={y} onPress={() => setYears(y)} style={{ flex: 1, paddingVertical: 11, borderRadius: 10, alignItems: 'center', backgroundColor: years === y ? c.primary : c.surface }}>
                    <Text style={{ color: years === y ? c.onPrimary : c.textSecondary, fontWeight: '800' }}>{y}y</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
            <Field c={c} label="Clients won back / month" value={winback} onChange={setWinback} hint="Boss AI reminders" />
            <Field c={c} label={`Average bill (${curSym().trim()})`} value={avgBill} onChange={setAvgBill} />
            <Field c={c} label={`Leakage stopped (${curSym().trim()}/mo)`} value={leak} onChange={setLeak} hint="discounts, cancels" />
          </View>

          <View style={{ backgroundColor: c.successLight, borderRadius: 14, padding: 14, gap: 6 }}>
            <Row l={`Other app for ${years} year${years > 1 ? 's' : ''}`} v={inr(calc.subscription)} c={c} />
            <Row l={`SaloonBossX ${LICENSE_PLANS[plan].name}, ${years} year${years > 1 ? 's' : ''}`} v={inr(price * years)} c={c} />
            <Row l="You keep" v={inr(calc.saved)} c={c} bold />
            <View style={{ height: 1, backgroundColor: c.success + '33', marginVertical: 4 }} />
            <Row l="Extra income from win-backs / year" v={inr(calc.extraYear)} c={c} />
            <Row l="Money saved from leakage / year" v={inr(calc.leakYear)} c={c} />
            {calc.paybackDays > 0 && (
              <Text style={{ color: c.success, fontWeight: '900', fontSize: 15, marginTop: 6 }}>
                The app pays for itself in about {calc.paybackDays} day{calc.paybackDays === 1 ? '' : 's'}.
              </Text>
            )}
          </View>
        </Card>

        <SectionLabel style={{ marginTop: 6 }}>Compared honestly</SectionLabel>
        <Card padded={false}>
          <View style={{ flexDirection: 'row', padding: 10, backgroundColor: c.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18 }}>
            <Text style={{ flex: 1.3, color: c.textMuted, fontSize: 11, fontWeight: '800' }}> </Text>
            <Text style={{ flex: 1, color: c.primary, fontSize: 11, fontWeight: '900' }}>SaloonBossX</Text>
            <Text style={{ flex: 0.8, color: c.textMuted, fontSize: 11, fontWeight: '800' }}>Register / diary</Text>
            <Text style={{ flex: 1, color: c.textMuted, fontSize: 11, fontWeight: '800' }}>Monthly-fee apps</Text>
          </View>
          {rows().map((r, i) => (
            <View key={r.f} style={{ flexDirection: 'row', padding: 10, borderTopWidth: 0.5, borderTopColor: c.divider, backgroundColor: i % 2 ? c.card : c.bg + '00' }}>
              <Text style={{ flex: 1.3, color: c.text, fontSize: 12, fontWeight: '700' }}>{r.f}</Text>
              <Text style={{ flex: 1, color: c.success, fontSize: 12, fontWeight: '800' }}>{r.us}</Text>
              <Text style={{ flex: 0.8, color: c.textMuted, fontSize: 12 }}>{r.book}</Text>
              <Text style={{ flex: 1, color: c.textMuted, fontSize: 12 }}>{r.monthly}</Text>
            </View>
          ))}
        </Card>

        <SectionLabel style={{ marginTop: 6 }}>What owners worry about</SectionLabel>
        {[
          ['cellphone-off', 'Phone lost or broken?', 'Daily encrypted backup in one tap. New phone → paste recovery key → restore in 2 minutes.'],
          ['account-hard-hat-outline', 'Staff misusing discounts?', 'Each staff logs in with their own PIN. Boss AI flags unusual discounts and cancelled bills.'],
          ['wifi-off', 'Network goes down?', 'Billing, WhatsApp bill (when back online) and reports never stop. Sync catches up later.'],
          ['printer-pos', 'Need a printed bill?', 'A4 PDF, or 58/80 mm thermal receipts through the printer’s Android print app.'],
          ['translate', 'Staff not comfortable in English?', 'Hindi, Marathi, Tamil, Telugu, Bengali, Gujarati, Kannada. Ask Boss AI in Hinglish.'],
        ].map(([icon, t, d]) => (
          <Card key={t}>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <MaterialCommunityIcons name={icon as any} size={26} color={c.primary} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.text, fontWeight: '800' }}>{t}</Text>
                <Text style={{ color: c.textSecondary, fontSize: 13, marginTop: 3, lineHeight: 18 }}>{d}</Text>
              </View>
            </View>
          </Card>
        ))}

        {SUPPORT_WHATSAPP ? (
          <Button label="Talk to us on WhatsApp" icon="whatsapp" color={c.whatsapp} style={{ marginTop: 6 }}
            onPress={() => contactSupport('Hi! I saw SaloonBossX and have a question.')} />
        ) : null}
      </ScrollView>
    </SafeScreen>
  );
}

// Defined outside the screen so the inputs keep focus while typing (a component
// declared inside render is a new type every keystroke and remounts).
function Field({ label, value, onChange, hint, c }: { label: string; value: string; onChange: (v: string) => void; hint?: string; c: any }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: c.textMuted, fontSize: 11.5, fontWeight: '700', marginBottom: 5 }}>{label}</Text>
      <TextInput value={value} onChangeText={v => onChange(v.replace(/[^0-9]/g, ''))} keyboardType="numeric"
        style={{ backgroundColor: c.surface, color: c.text, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, fontWeight: '800' }} />
      {hint ? <Text style={{ color: c.textMuted, fontSize: 10.5, marginTop: 3 }}>{hint}</Text> : null}
    </View>
  );
}

function Row({ l, v, c, bold }: { l: string; v: string; c: any; bold?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ color: c.textSecondary, fontSize: 13, fontWeight: bold ? '900' : '600', flex: 1 }}>{l}</Text>
      <Text style={{ color: bold ? c.success : c.text, fontSize: bold ? 17 : 13.5, fontWeight: '900' }}>{v}</Text>
    </View>
  );
}
