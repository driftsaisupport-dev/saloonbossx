import React, { useContext, useMemo, useState } from 'react';
import { View, TouchableOpacity, StyleSheet, ScrollView, Alert, KeyboardAvoidingView, Platform, Switch, ActivityIndicator, Image } from 'react-native';
import { Text, TextInput } from '../theme/Text';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeScreen } from '../components/SafeScreen';
import { useTheme } from '../context/ThemeContext';
import { Radius } from '../theme/colors';
import { DatabaseService } from '../database/Database';
import { BUSINESS_TYPES, CATALOG, BusinessType, businessTypeTitle } from '../config/businessTypes';
import { BranchSyncService } from '../services/BranchSyncService';
import { DemoDataService } from '../services/DemoDataService';
import { LANGUAGES, changeLanguage } from '../i18n';
import { AppContext } from '../context/AppContext';
import { RegionPickerSheet } from '../components/RegionPicker';
import { getRegion, fmtMoney, REGION_BY_CODE } from '../config/regions';
import { tr, useTr } from '../i18n/tr';
import { GstFields, GstValues, saveGstValues, validateGst } from '../components/GstFields';

/**
 * First run. Five short steps, each answerable by a salon owner standing at
 * the counter: language → type of business → details → services → team.
 * Or one tap to "See a demo salon" with three months of realistic data.
 */
const OnboardingScreen = ({ onComplete }: { onComplete: () => void }) => {
  const { colors: c } = useTheme();
  useTr();
  const [step, setStep] = useState(0);
  const [lang, setLang] = useState('en');
  const [type, setType] = useState<BusinessType | null>(null);
  const [salonName, setSalonName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [gst, setGst] = useState<GstValues>({ enabled: false, gstin: '', rate: String(getRegion().tax.presets[0] ?? 5), inclusive: false });
  const { region, changeRegion } = useContext(AppContext);
  const [showRegion, setShowRegion] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [staffName, setStaffName] = useState('');
  const [staffList, setStaffList] = useState<string[]>([]);
  const [ownerWorks, setOwnerWorks] = useState(true);
  const oneTapCloud = BranchSyncService.hostedAvailable();
  const [cloudOn, setCloudOn] = useState(true);
  const [loading, setLoading] = useState(false);
  const [demo, setDemo] = useState<{ step: string; pct: number } | null>(null);

  const catalog = useMemo(() => (type ? CATALOG[type] : []), [type]);
  const categories = useMemo(() => [...new Set(catalog.map(s => s.category))], [catalog]);

  async function pickLang(code: string) {
    setLang(code);
    try { await changeLanguage(code); await DatabaseService.setSetting('language', code); } catch {}
  }

  function chooseType(t: BusinessType) {
    setType(t);
    setSelected(new Set(CATALOG[t].map((_, i) => i)));
  }

  async function finish() {
    if (!salonName.trim()) { Alert.alert(tr('Required'), tr('Enter salon name')); setStep(2); return; }
    const gstErr = validateGst(gst);
    if (gstErr) { Alert.alert(tr('Check GST details'), tr(gstErr)); setStep(2); return; }
    setLoading(true);
    try {
      await DatabaseService.updateSalonProfile({ name: salonName.trim(), owner_name: ownerName.trim(), phone: phone.trim(), city: city.trim() });
      await DatabaseService.setSetting('business_type', type || 'unisex');
      await saveGstValues(DatabaseService as any, gst);
      const existing = await DatabaseService.getServices(false) as any[];
      if (!existing.length) {
        const list = catalog.filter((_, i) => selected.has(i));
        for (const s of (list.length ? list : catalog.slice(0, 10))) await DatabaseService.addService(s);
      }
      // A solo parlour owner IS the stylist. Without at least one staff record
      // the old billing screen refused every bill ("Please assign a stylist").
      const names = [...staffList];
      if (ownerWorks || names.length === 0) names.unshift(ownerName.trim() || 'Owner');
      const existingStaff = await DatabaseService.getStaff(false) as any[];
      if (!existingStaff.length) {
        for (const n of names) await DatabaseService.addStaff({ name: n, role: n === (ownerName.trim() || 'Owner') ? 'Owner' : 'Stylist', commission_rate: n === (ownerName.trim() || 'Owner') ? 0 : 10, salary_type: 'commission' });
      }
      if (oneTapCloud && cloudOn) {
        // Finishes in the background as soon as there is internet (retries on every app open).
        await BranchSyncService.requestAutoEnable(true);
        setTimeout(() => { BranchSyncService.ensureAutoCloud().catch(() => {}); }, 4000);
      }
      await DatabaseService.setSetting('onboarding_complete', 'true');
      onComplete();
    } catch (e) { console.warn('[onboarding]', e); Alert.alert(tr('Setup not finished'), tr('Setup failed. Please try again.')); }
    finally { setLoading(false); }
  }

  async function startDemo(t: BusinessType) {
    setType(t);
    setDemo({ step: 'Starting…', pct: 0 });
    try {
      const bt = BUSINESS_TYPES.find(b => b.id === t);
      await DatabaseService.updateSalonProfile({ name: `Glow ${bt?.title.replace(/\s*\/.*$/, '') || 'Salon'} (Demo)`, owner_name: 'Demo Owner', phone: '', city: 'Navi Mumbai' });
      await DatabaseService.setSetting('business_type', t);
      await DemoDataService.load(t, p => setDemo(p));
      await DatabaseService.setSetting('onboarding_complete', 'true');
      onComplete();
    } catch (e: any) {
      Alert.alert('Demo failed', e?.message || 'Please try again.');
    } finally { setDemo(null); }
  }

  const input = [s.input, { backgroundColor: c.card, color: c.text, borderColor: c.border }];
  const canNext = step === 0 || (step === 1 && !!type) || (step === 2 && !!salonName.trim()) || step >= 3;

  if (demo) {
    return (
      <View style={[s.center, { backgroundColor: c.brandInk }]}>
        <Image source={require('../../assets/logo.png')} style={{ width: 90, height: 90, marginBottom: 20 }} resizeMode="contain" />
        <Text style={{ color: '#fff', fontSize: 20, fontWeight: '900' }}>{tr('Building your demo salon')}</Text>
        <Text style={{ color: '#B9AE96', marginTop: 6 }}>{demo.step}</Text>
        <View style={{ width: '80%', height: 8, backgroundColor: '#ffffff20', borderRadius: 4, marginTop: 20, overflow: 'hidden' }}>
          <View style={{ width: `${demo.pct}%` as any, height: 8, backgroundColor: c.brandGold }} />
        </View>
        <Text style={{ color: '#8A826F', fontSize: 12, marginTop: 14, textAlign: 'center', paddingHorizontal: 30 }}>
          {tr('About 75 days of bills, clients, staff and stock. You can clear it any time from Settings.')}
        </Text>
      </View>
    );
  }

  const steps: React.ReactNode[] = [
    // 0 — Welcome + language
    <ScrollView key="s0" contentContainerStyle={s.stepContent}>
      <View style={{ alignItems: 'center', marginBottom: 18 }}>
        <View style={{ backgroundColor: c.brandInk, borderRadius: 26, padding: 14, marginBottom: 14 }}>
          <Image source={require('../../assets/logo.png')} style={{ width: 70, height: 70 }} resizeMode="contain" />
        </View>
        <Text style={[s.stepTitle, { color: c.text, textAlign: 'center' }]}>{tr('Welcome to SaloonBossX')}</Text>
        <Text style={[s.stepSub, { color: c.textSecondary, textAlign: 'center', marginBottom: 6 }]}>{tr('Billing, clients, staff and reports — works without internet.')}</Text>
      </View>
      <Text style={[s.catLabel, { color: c.textMuted }]}>{tr('Where is your salon?')}</Text>
      <TouchableOpacity onPress={() => setShowRegion(true)} accessibilityRole="button"
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: c.primary, backgroundColor: c.card, marginBottom: 18 }}>
        <Text style={{ fontSize: 26 }}>{region.flag}</Text>
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.text, fontSize: 16, fontWeight: '800' }}>{region.name}</Text>
          <Text style={{ color: c.textMuted, fontSize: 12 }}>{region.currency} {region.symbol.trim()} · {region.tax.name} · {region.pay.label}</Text>
        </View>
        <MaterialCommunityIcons name="chevron-down" size={22} color={c.textMuted} />
      </TouchableOpacity>
      <Text style={[s.catLabel, { color: c.textMuted }]}>{tr('Choose your language')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {LANGUAGES.map(l => (
          <TouchableOpacity key={l.code} onPress={() => pickLang(l.code)}
            style={[s.langBtn, { backgroundColor: lang === l.code ? c.primary : c.card, borderColor: lang === l.code ? c.primary : c.border }]}>
            <Text style={{ color: lang === l.code ? c.onPrimary : c.text, fontSize: 17, fontWeight: '800' }}>{l.nativeName}</Text>
            <Text style={{ color: lang === l.code ? c.onPrimary : c.textMuted, opacity: lang === l.code ? 0.8 : 1, fontSize: 11 }}>{l.name}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={[s.trust, { backgroundColor: c.successLight }]}>
        {[tr('Works in 38 countries — your currency, tax & language'), tr('Your data stays yours — encrypted backup'), tr('Works offline, even with no network')].map(x => (
          <View key={x} style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginVertical: 3 }}>
            <MaterialCommunityIcons name="check-decagram" size={16} color={c.success} />
            <Text style={{ color: c.text, fontSize: 13, fontWeight: '600', flex: 1 }}>{x}</Text>
          </View>
        ))}
      </View>
    </ScrollView>,

    // 1 — Business type
    <ScrollView key="s1" contentContainerStyle={s.stepContent}>
      <Text style={[s.stepTitle, { color: c.text }]}>{tr('What kind of business?')}</Text>
      <Text style={[s.stepSub, { color: c.textSecondary }]}>{tr('We will load a ready service menu with typical prices. You can change anything later.')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {BUSINESS_TYPES.map(b => {
          const on = type === b.id;
          return (
            <TouchableOpacity key={b.id} onPress={() => chooseType(b.id)} activeOpacity={0.85}
              style={[s.typeCard, { backgroundColor: on ? c.primaryLight : c.card, borderColor: on ? c.primary : c.border }]}>
              <MaterialCommunityIcons name={b.icon as any} size={28} color={on ? c.primary : c.textSecondary} />
              <Text style={{ color: c.text, fontWeight: '800', marginTop: 8 }}>{businessTypeTitle(b.id, lang)}</Text>
              <Text style={{ color: c.textMuted, fontSize: 11.5, marginTop: 2 }}>{tr(b.blurb)}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <TouchableOpacity disabled={!type} onPress={() => type && startDemo(type)}
        style={[s.demoBtn, { borderColor: c.brandGold, opacity: type ? 1 : 0.5 }]}>
        <MaterialCommunityIcons name="play-circle-outline" size={22} color={c.brandGold} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.text, fontWeight: '800' }}>{tr('Just looking? See a demo salon')}</Text>
          <Text style={{ color: c.textMuted, fontSize: 12 }}>{type ? tr('Fills the app with sample bills, clients & reports') : tr('Pick a business type first')}</Text>
        </View>
      </TouchableOpacity>
    </ScrollView>,

    // 2 — Details
    <ScrollView key="s2" contentContainerStyle={s.stepContent} keyboardShouldPersistTaps="handled">
      <Text style={[s.stepTitle, { color: c.text }]}>{tr('Your salon')}</Text>
      <Text style={[s.stepSub, { color: c.textSecondary }]}>{tr('Shown on bills and WhatsApp messages')}</Text>
      <TextInput style={input} placeholder={tr('Salon name *')} placeholderTextColor={c.textMuted} value={salonName} onChangeText={setSalonName} />
      <TextInput style={input} placeholder={tr('Owner name')} placeholderTextColor={c.textMuted} value={ownerName} onChangeText={setOwnerName} />
      <TextInput style={input} placeholder={tr('Phone')} placeholderTextColor={c.textMuted} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <TextInput style={input} placeholder={tr('City / area')} placeholderTextColor={c.textMuted} value={city} onChangeText={setCity} />
      <View style={[s.toggleRow, { backgroundColor: c.card, borderColor: c.border, flexDirection: 'column', alignItems: 'stretch' }]}>
        <GstFields value={gst} onChange={setGst} compact />
        <Text style={{ color: c.textMuted, fontSize: 11.5, marginTop: 10 }}>{tr('You can change GST any time in Settings.')}</Text>
      </View>
    </ScrollView>,

    // 3 — Services
    <ScrollView key="s3" contentContainerStyle={s.stepContent}>
      <Text style={[s.stepTitle, { color: c.text }]}>{tr('Your services')}</Text>
      <Text style={[s.stepSub, { color: c.textSecondary }]}>{tr('{n} selected — untick what you do not offer. Prices can be edited later.', { n: selected.size })}</Text>
      {categories.map(cat => (
        <View key={cat} style={{ marginBottom: 12 }}>
          <Text style={[s.catLabel, { color: c.textMuted }]}>{cat}</Text>
          {catalog.map((sv, i) => sv.category !== cat ? null : (
            <TouchableOpacity key={i} style={[s.serviceChip, { backgroundColor: c.card, borderColor: selected.has(i) ? c.primary : c.border }]}
              onPress={() => setSelected(p => { const n = new Set(p); n.has(i) ? n.delete(i) : n.add(i); return n; })}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: c.text }}>{sv.name}</Text>
                <Text style={{ fontSize: 12, color: c.textMuted }}>{fmtMoney(sv.price)} · {sv.duration} min</Text>
              </View>
              <MaterialCommunityIcons name={selected.has(i) ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'} size={22} color={selected.has(i) ? c.primary : c.textLight} />
            </TouchableOpacity>
          ))}
        </View>
      ))}
    </ScrollView>,

    // 4 — Team
    <ScrollView key="s4" contentContainerStyle={s.stepContent} keyboardShouldPersistTaps="handled">
      <Text style={[s.stepTitle, { color: c.text }]}>{tr('Your team')}</Text>
      <Text style={[s.stepSub, { color: c.textSecondary }]}>{tr('Used for commission, attendance and staff reports')}</Text>
      <View style={[s.toggleRow, { backgroundColor: c.card, borderColor: c.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.text, fontWeight: '700' }}>{tr('I also serve clients myself')}</Text>
          <Text style={{ color: c.textMuted, fontSize: 12 }}>{tr('Adds you as a staff member so you can bill your own work')}</Text>
        </View>
        <Switch value={ownerWorks} onValueChange={setOwnerWorks} trackColor={{ true: c.primary + '70' }} thumbColor={ownerWorks ? c.primary : '#ccc'} />
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
        <TextInput style={[input, { flex: 1, marginBottom: 0 }]} placeholder={tr('Staff name')} placeholderTextColor={c.textMuted} value={staffName} onChangeText={setStaffName}
          onSubmitEditing={() => { if (staffName.trim()) { setStaffList(l => [...l, staffName.trim()]); setStaffName(''); } }} returnKeyType="done" />
        <TouchableOpacity style={[s.addStaffBtn, { backgroundColor: c.primary }]} onPress={() => { if (staffName.trim()) { setStaffList(l => [...l, staffName.trim()]); setStaffName(''); } }}>
          <MaterialCommunityIcons name="plus" size={22} color={c.onPrimary} />
        </TouchableOpacity>
      </View>
      {staffList.map((n, i) => (
        <View key={i} style={[s.staffRow, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={[s.staffAvatar, { backgroundColor: c.primaryLight }]}><Text style={{ fontWeight: '700', color: c.primary }}>{n[0]}</Text></View>
          <Text style={{ flex: 1, fontSize: 15, color: c.text, fontWeight: '500' }}>{n}</Text>
          <TouchableOpacity onPress={() => setStaffList(staffList.filter((_, idx) => idx !== i))}><MaterialCommunityIcons name="close-circle" size={20} color={c.textMuted} /></TouchableOpacity>
        </View>
      ))}
      {staffList.length === 0 && <Text style={{ textAlign: 'center', color: c.textMuted, marginTop: 16 }}>{tr('Working alone? Just tap Finish.')}</Text>}
      {oneTapCloud && (
        <View style={[s.toggleRow, { backgroundColor: c.successLight, borderColor: c.success + '55', marginTop: 20 }]}>
          <MaterialCommunityIcons name="cloud-lock-outline" size={26} color={c.success} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.text, fontWeight: '800' }}>{tr('Free cloud backup (recommended)')}</Text>
            <Text style={{ color: c.textMuted, fontSize: 12 }}>{tr('Encrypted daily backup — phone lost, data safe. Turns on by itself when internet is available.')}</Text>
          </View>
          <Switch value={cloudOn} onValueChange={setCloudOn} trackColor={{ true: c.success + '70' }} thumbColor={cloudOn ? c.success : '#ccc'} />
        </View>
      )}
      {oneTapCloud && cloudOn && (
        <Text style={{ color: c.textMuted, fontSize: 11.5, textAlign: 'center', lineHeight: 16 }}>
          {tr('Already use SaloonBossX on another phone? Turn this off, then Settings → Branches & Cloud → Join / new phone.')}
        </Text>
      )}
    </ScrollView>,
  ];

  const last = steps.length - 1;
  return (
    <SafeScreen keyboard={false}>
      <KeyboardAvoidingView style={[s.container, { backgroundColor: c.bg }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.progress}>{steps.map((_, i) => <View key={i} style={[s.dot, { backgroundColor: i <= step ? c.primary : c.border }, i === step && s.dotActive]} />)}</View>
        {steps[step]}
        <RegionPickerSheet visible={showRegion} current={region.code} onClose={() => setShowRegion(false)}
          onPick={async (code) => {
            await changeRegion(code);
            const r = REGION_BY_CODE[code];
            if (r) setGst(g => ({ ...g, rate: String(r.tax.presets[0] ?? g.rate) }));
          }} />
        <View style={[s.footer, { backgroundColor: c.card, borderTopColor: c.divider }]}>
          {step > 0 && (
            <TouchableOpacity style={s.backBtn} onPress={() => setStep(step - 1)}>
              <MaterialCommunityIcons name="arrow-left" size={18} color={c.textSecondary} /><Text style={{ color: c.textSecondary }}>{tr('Back')}</Text>
            </TouchableOpacity>
          )}
          <View style={{ flex: 1 }} />
          {step < last ? (
            <TouchableOpacity style={[s.nextBtn, { backgroundColor: c.primary, opacity: canNext ? 1 : 0.5 }]} disabled={!canNext} onPress={() => setStep(step + 1)}>
              <Text style={[s.nextBtnText, { color: c.onPrimary }]}>{tr('Next')}</Text><MaterialCommunityIcons name="arrow-right" size={18} color={c.onPrimary} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={[s.nextBtn, { backgroundColor: c.success }]} onPress={finish} disabled={loading}>
              {loading ? <ActivityIndicator color={c.onPrimary} /> : <><Text style={[s.nextBtnText, { color: c.onPrimary }]}>{tr('Finish')}</Text><MaterialCommunityIcons name="rocket-launch" size={18} color={c.onPrimary} /></>}
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeScreen>
  );
};

const s = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  progress: { flexDirection: 'row', justifyContent: 'center', gap: 8, paddingTop: 16, paddingBottom: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotActive: { width: 24 },
  stepContent: { padding: 22, paddingBottom: 110 },
  stepTitle: { fontSize: 24, fontWeight: '900', marginBottom: 4, letterSpacing: -0.5 },
  stepSub: { fontSize: 14, marginBottom: 20, lineHeight: 20 },
  input: { borderRadius: Radius.md, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, borderWidth: StyleSheet.hairlineWidth, marginBottom: 10 },
  catLabel: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 },
  langBtn: { width: '47%', borderRadius: 16, paddingVertical: 14, alignItems: 'center', borderWidth: 1.5 },
  typeCard: { width: '47.5%', borderRadius: 18, padding: 14, borderWidth: 1.5, minHeight: 118 },
  demoBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 16, padding: 14, marginTop: 18 },
  trust: { borderRadius: 16, padding: 14, marginTop: 20 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, padding: 14, borderWidth: StyleSheet.hairlineWidth, marginBottom: 12 },
  serviceChip: { flexDirection: 'row', alignItems: 'center', borderRadius: Radius.md, padding: 12, marginBottom: 6, borderWidth: 1 },
  addStaffBtn: { width: 48, height: 48, borderRadius: Radius.md, justifyContent: 'center', alignItems: 'center' },
  staffRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: Radius.md, padding: 12, marginBottom: 6, borderWidth: StyleSheet.hairlineWidth },
  staffAvatar: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  footer: { flexDirection: 'row', alignItems: 'center', padding: 16, borderTopWidth: StyleSheet.hairlineWidth },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 12, paddingHorizontal: 16 },
  nextBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 14, paddingHorizontal: 24, borderRadius: Radius.md, minWidth: 120, justifyContent: 'center' },
  nextBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
});

export default OnboardingScreen;
