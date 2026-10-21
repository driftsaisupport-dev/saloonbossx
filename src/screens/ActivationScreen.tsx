import React, { useEffect, useState } from 'react';
import { View, TouchableOpacity, StyleSheet, ScrollView, Alert, Platform, Switch, Image, KeyboardAvoidingView, Keyboard, Share, ActivityIndicator, Modal } from 'react-native';
import { Text, TextInput } from '../theme/Text';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeScreen } from '../components/SafeScreen';
import { useTheme } from '../context/ThemeContext';
import { Radius, Shadow } from '../theme/colors';
import { LicenseService, LICENSE_PLANS, type PlanId } from '../services/LicenseService';
import { LAUNCH_LIMIT, BILLING_LABEL, SHOWN_BILLINGS, pricesFor, currencyOfPrices, yearlySavingPct, type Billing } from '../services/licensePlans';
import { cleanKey, licenseKeyIds } from '../services/licenseCrypto';
import * as Clipboard from 'expo-clipboard';
import { TRIAL_DAYS, REFUND_DAYS, SELLER_UPI, contactSupport, payByUpi } from '../config/sales';
import { useTr } from '../i18n/tr';
import i18n, { getLanguage } from '../i18n';
import { showError } from '../components/formUtils';
import { useChoiceSheet } from '../components/ChoiceSheet';
import { getRegion, fmtMoney, usesUpi, REGION_BY_CODE } from '../config/regions';

const PLAN_ORDER: PlanId[] = ['solo', 'standard', 'multi', 'academy'];
/**
 * Subscription prices are shown in the salon's own currency when we sell in
 * it, otherwise in US$ (see MONTHLY_PRICE_BOOK). `inr` kept as the name the
 * screen already used; it now formats any currency.
 */
const priceCurrency = () => currencyOfPrices(getRegion().currency);
const PRICES_NOW = () => pricesFor(priceCurrency());
const inr = (n: number) => {
  const cur = priceCurrency();
  const r = cur === getRegion().currency ? getRegion() : REGION_BY_CODE.US;
  return fmtMoney(n, { region: r, whole: Number.isInteger(n) });
};

const ActivationScreen = ({ onActivation }: { onActivation: () => void }) => {
  const { t } = useTranslation();
  const tr = useTr();
  const { colors: c } = useTheme();
  const choice = useChoiceSheet();
  const [showDiag, setShowDiag] = useState(false);
  const [buying, setBuying] = useState(false);
  // Legal text: languages without a translation show the English text (the
  // binding version) instead of a dead-end "see English version" line.
  const legal = (key: 'terms' | 'privacy') => {
    const lang = getLanguage();
    const own = i18n.exists(`${key}.content`, { lng: lang, fallbackLng: false } as any) ? t(`${key}.content`) : '';
    return own || i18n.t(`${key}.content`, { lng: 'en' });
  };
  const legalIsEnglishFallback = (key: 'terms' | 'privacy') => getLanguage() !== 'en' && !i18n.exists(`${key}.content`, { lng: getLanguage(), fallbackLng: false } as any);
  const [licenseKey, setLicenseKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [deviceId, setDeviceId] = useState('…');
  const [trial, setTrial] = useState<{ started: boolean; active: boolean; daysLeft: number; available: boolean } | null>(null);
  const [billing, setBilling] = useState<Billing>('yearly');
  const [status, setStatus] = useState<any>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    LicenseService.getDeviceId().then(setDeviceId).catch(() => {});
    LicenseService.getTrial().then(setTrial).catch(() => {});
    LicenseService.getStatus().then(async st => {
      setStatus(st);
      if (st?.billing === 'monthly') setBilling('monthly');
      if (!st.activated && !st.trial) {
        const info = await LicenseService.getLicenseInfo().catch(() => null);
        if (info?.key) setStatus({ ...st, lapsed: true });
      }
    }).catch(() => {});
  }, []);

  /** Paid by UPI and the seller extended the key in the sheet? Check without typing anything. */
  const checkAgain = async () => {
    if (checking) return;
    setChecking(true);
    try {
      await LicenseService.revalidate(true);
      const st = await LicenseService.getStatus();
      if (st.activated) { Alert.alert(tr('Renewed ✅'), st.expiry === 'LIFETIME' ? tr('Lifetime licence active.') : tr('Valid until {d}.', { d: st.expiry })); onActivation(); }
      else Alert.alert(tr('Not renewed yet'), tr('We could not find a renewal yet. Paste the new key you received, or message us on WhatsApp.'));
    } catch (e) {
      showError(e, 'Could not check', 'Could not reach the licence server. Check the internet and try again.');
    } finally { setChecking(false); }
  };

  const needTerms = () => {
    if (acceptedTerms) return false;
    Alert.alert(tr('One step first'), tr('Please accept the Terms & Conditions and Privacy Policy.'));
    return true;
  };

  const handleActivate = async () => {
    if (needTerms()) return;
    const key = cleanKey(licenseKey);
    if (!key) { Alert.alert(tr('Key needed'), tr('Paste the licence key you received after purchase.')); return; }
    if (loading) return;
    Keyboard.dismiss();
    setLoading(true);
    try {
      const result = await LicenseService.activateWithKey(key, email.trim(), name.trim());
      if (!result.success) setLicenseKey(key);
      if (result.success) {
        Alert.alert(t('common.success'), t('activation.activated'));
        onActivation();
      } else {
        Alert.alert(tr('Could not activate'), tr(result.message || 'Please check the key and try again.'), [
          { text: tr('OK'), style: 'cancel' },
          { text: tr('Get help'), onPress: () => { askHelp(result.message); } },
        ]);
      }
    } catch (e) {
      showError(e, 'Activation failed', 'Could not activate. Check the internet and try again.');
    } finally { setLoading(false); }
  };

  const handleTrial = async () => {
    if (needTerms() || loading) return;
    setLoading(true);
    try {
      const r = await LicenseService.startTrial();
      if (r.success) { onActivation(); }
      else Alert.alert(tr('Free trial'), tr(r.message || 'Could not start the trial.'));
    } catch (e) {
      showError(e, 'Free trial', 'Could not start the trial. Please try again.');
    } finally { setLoading(false); }
  };

  const handlePurchase = async (planId: PlanId) => {
    if (needTerms()) return;
    const plan = LICENSE_PLANS[planId];
    const price = PRICES_NOW()[planId][billing];
    const what = `${plan.name} · ${BILLING_LABEL[billing].name}`;
    const finish = async () => {
      if (buying) return;
      setBuying(true);
      try {
        const r = await LicenseService.purchaseViaWebCheckout(planId, email.trim(), name.trim(), billing);
        if (!r.success) Alert.alert(tr('Buy'), tr(r.message || 'Could not open the payment page.'));
      } catch (e) {
        showError(e, 'Could not open payment', 'Could not open the payment page. Check the internet and try again.');
      } finally { setBuying(false); }
    };

    const payUpi = async () => {
      try {
        const ok = await payByUpi({ planId, price, deviceId, billing });
        if (!ok) { finish(); return; }
        setTimeout(() => Alert.alert(
          tr('After paying'),
          tr('Send us the payment screenshot on WhatsApp with your Device ID. Your licence key comes back within minutes.'),
          [{ text: tr('Later'), style: 'cancel' },
           { text: tr('Send on WhatsApp'), onPress: () => { contactSupport(
            `I paid ${inr(price)} for SaloonBossX ${what}.\nDevice ID: ${deviceId}\nName: ${name || '-'}\nPhone/UPI ref: `).catch(() => {}); } }]
        ), 1200);
      } catch (e) { showError(e, 'UPI app did not open'); }
    };

    // Paying by UPI from this phone is the fastest route, and the payment
    // reference carries the device id so the right key comes back.
    if (SELLER_UPI && usesUpi()) {
      choice.open({
        title: `${what} — ${inr(price)}`,
        message: tr('How would you like to pay?'),
        options: [
          { label: tr('Pay by UPI now'), hint: tr('GPay, PhonePe, Paytm…'), icon: 'qrcode', tone: 'success', onPress: payUpi },
          { label: tr('Other ways'), hint: tr('Card, net banking'), icon: 'credit-card-outline', tone: 'neutral', onPress: finish },
        ],
      });
      return;
    }
    finish();
  };

  const askHelp = async (problem = '') => {
    try {
      const ok = await contactSupport(
        `Hi, I need help activating SaloonBossX.\nDevice ID: ${deviceId}\n` +
        (problem ? `Error: ${problem}\n` : '') + (email ? `Email: ${email}\n` : '')
      );
      if (!ok) await Share.share({ message: `SaloonBossX Device ID: ${deviceId}` });
    } catch (e) { showError(e, 'Could not open WhatsApp'); }
  };

  const trialEnded = !!trial?.started && !trial.active;

  return (
    <SafeScreen>
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView style={[s.container, { backgroundColor: c.bg }]} contentContainerStyle={{ paddingBottom: 80 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false}>
      <View style={[s.hero, { backgroundColor: c.brandInk }]}>
        <View style={s.heroGlow} />
        <Image source={require('../../assets/logo.png')} style={{ width: 108, height: 108 }} resizeMode="contain" />
        <Text style={s.logo}>Saloon<Text style={s.logoBold}>BossX</Text></Text>
        <Text style={s.tagline}>BEAUTY BUSINESS. SIMPLIFIED.</Text>
        <View style={s.trustRow}>
          <Text style={s.trustItem}>🔒 {tr('Data stays on your phone')}</Text>
          <Text style={s.trustItem}>📶 {tr('Works offline')}</Text>
          <Text style={s.trustItem}>💳 {tr('Monthly or yearly')}</Text>
        </View>
      </View>

      <View style={[s.launchCard, { backgroundColor: c.primary }]}>
        <Text style={[s.launchTitle, { color: c.onPrimary }]}>{tr('Launch offer — first {n} salons', { n: LAUNCH_LIMIT })}</Text>
        <Text style={[s.launchSub, { color: c.onPrimary }]}>{tr('From {p}/month — or save 2 months with yearly.', { p: inr(PRICES_NOW().solo.monthly) })}{REFUND_DAYS > 0 ? ` ${tr('{d}-day money-back guarantee.', { d: REFUND_DAYS })}` : ''}</Text>
      </View>

      {status?.activated && !status?.trial && (
        <TouchableOpacity activeOpacity={0.85} onPress={onActivation}
          style={[s.trialBtn, { backgroundColor: c.card, borderWidth: 1, borderColor: c.border }]}>
          <Text style={[s.trialTitle, { color: c.text, fontSize: 16 }]}>← {tr('Back to the app')}</Text>
          <Text style={[s.trialSub, { color: c.textMuted, textAlign: 'center' }]}>{status.expiry === 'LIFETIME' ? tr('Lifetime licence active') : tr('Current plan valid until {d}', { d: status.expiry })} · {tr('paste a new key below to renew or upgrade')}</Text>
        </TouchableOpacity>
      )}

      {status?.lapsed && (
        <View style={[s.notice, { backgroundColor: c.danger + '14', borderColor: c.danger }]}>
          <Text style={{ color: c.text, fontWeight: '800', fontSize: 15 }}>{status.expiry ? tr('Your plan ended on {d}', { d: status.expiry }) : tr('Your plan ended')}</Text>
          <Text style={{ color: c.textSecondary, fontSize: 13, marginTop: 4, lineHeight: 19 }}>
            {tr('Nothing is deleted — every bill, client and staff record is safe on this phone. Renew below and continue exactly where you left off.')}
          </Text>
          <TouchableOpacity onPress={checkAgain} disabled={checking} style={{ marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {checking ? <ActivityIndicator size="small" color={c.primary} /> : null}
            <Text style={{ color: c.primary, fontWeight: '800' }}>{checking ? tr('Checking…') : tr('I have already paid — check again')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {trialEnded && (
        <View style={[s.notice, { backgroundColor: c.warning + '18', borderColor: c.warning }]}>
          <Text style={{ color: c.text, fontWeight: '800', fontSize: 15 }}>{tr('Your free trial has ended')}</Text>
          <Text style={{ color: c.textSecondary, fontSize: 13, marginTop: 4, lineHeight: 19 }}>
            {tr('All your bills, clients and staff data are safe on this phone. Activate a licence and continue exactly where you left off.')}
          </Text>
        </View>
      )}

      {/* Terms */}
      <View style={[s.tcCard, { backgroundColor: c.card, borderColor: acceptedTerms ? c.success : c.border }]}>
        <View style={s.tcRow}>
          <Switch value={acceptedTerms} onValueChange={setAcceptedTerms} trackColor={{ false: c.surface, true: c.success + '40' }} thumbColor={acceptedTerms ? c.success : c.textMuted} />
          <Text style={[s.tcText, { color: c.text }]}>{tr('I accept the')}{' '}
            <Text style={{ color: c.primary, fontWeight: '700', textDecorationLine: 'underline' }} onPress={() => setShowTerms(true)}>{tr('Terms & Conditions')}</Text>
            {' '}{tr('and')}{' '}
            <Text style={{ color: c.primary, fontWeight: '700', textDecorationLine: 'underline' }} onPress={() => setShowPrivacy(true)}>{tr('Privacy Policy')}</Text>
          </Text>
        </View>
      </View>

      {/* Free trial */}
      {TRIAL_DAYS > 0 && trial && !trial.started && (
        <TouchableOpacity activeOpacity={0.85} onPress={handleTrial} disabled={loading}
          style={[s.trialBtn, { backgroundColor: c.success, opacity: acceptedTerms && !loading ? 1 : 0.6 }]}>
          {loading ? <ActivityIndicator color={c.onPrimary} /> : (<>
            <Text style={[s.trialTitle, { color: c.onPrimary }]}>{tr('Start {n}-day free trial', { n: TRIAL_DAYS })}</Text>
            <Text style={[s.trialSub, { color: c.onPrimary }]}>{tr('No payment, no key needed · Full Standard features')}</Text>
          </>)}
        </TouchableOpacity>
      )}

      {trial?.active && (
        <TouchableOpacity activeOpacity={0.85} onPress={onActivation}
          style={[s.trialBtn, { backgroundColor: c.card, borderWidth: 1, borderColor: c.border }]}>
          <Text style={[s.trialTitle, { color: c.text, fontSize: 16 }]}>← {tr('Continue free trial')}</Text>
          <Text style={[s.trialSub, { color: c.textMuted }]}>{trial.daysLeft === 1 ? tr('1 day left') : tr('{n} days left', { n: trial.daysLeft })}</Text>
        </TouchableOpacity>
      )}

      {/* Key entry */}
      <Text style={[s.sectionTitle, { color: c.text }]}>{t('activation.haveKey')}</Text>
      <View style={{ marginHorizontal: 20 }}>
        <TextInput
          style={[s.keyInput, { backgroundColor: c.card, color: c.text, borderColor: licenseKey.length > 5 ? c.primary : c.border }]}
          placeholder={tr('Paste your key here (starts with SBX-)')}
          placeholderTextColor={c.textMuted}
          value={licenseKey}
          // Keys are case-sensitive. Only strip spaces/new lines a WhatsApp copy may add.
          onChangeText={v => setLicenseKey(v.replace(/\s+/g, ''))}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          multiline
          keyboardType={Platform.OS === 'android' ? 'visible-password' : 'ascii-capable'}
          textAlignVertical="top"
        />
        <TouchableOpacity onPress={async () => {
            const k = cleanKey(await Clipboard.getStringAsync().catch(() => '') || '');
            if (/^SBX-/.test(k)) setLicenseKey(k);
            else Alert.alert(tr('Nothing to paste'), tr('Copy the key from WhatsApp first (long-press the message → Copy), then tap Paste key.'));
          }} style={{ alignSelf: 'flex-end', marginTop: -4, marginBottom: 10, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, backgroundColor: c.primary + '18' }}>
          <Text style={{ color: c.primary, fontWeight: '800' }}>📋 {tr('Paste key')}</Text>
        </TouchableOpacity>
        <TextInput style={[s.input, { backgroundColor: c.card, color: c.text, borderColor: c.border }]} placeholder={tr('Your name (optional)')} placeholderTextColor={c.textMuted} value={name} onChangeText={setName} autoCapitalize="words" />
        <TextInput style={[s.input, { backgroundColor: c.card, color: c.text, borderColor: c.border }]} placeholder={tr('Email used to buy (optional)')} placeholderTextColor={c.textMuted} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
        <TouchableOpacity
          style={[s.activateBtn, { backgroundColor: c.primary, opacity: acceptedTerms && licenseKey.length > 12 ? 1 : 0.5 }]}
          onPress={handleActivate}
          disabled={loading || !acceptedTerms || licenseKey.length <= 12}>
          {loading ? <ActivityIndicator color={c.onPrimary} /> : <Text style={[s.activateBtnText, { color: c.onPrimary }]}>🔑 {tr('Activate licence')}</Text>}
        </TouchableOpacity>
      </View>

      {/* Plans */}
      <View style={[s.divider]}><View style={[s.dividerLine, { backgroundColor: c.divider }]} /><Text style={{ paddingHorizontal: 12, color: c.textMuted, fontSize: 13 }}>{t('activation.choosePlan')}</Text><View style={[s.dividerLine, { backgroundColor: c.divider }]} /></View>

      <View style={[s.billRow, { backgroundColor: c.surface }]}>
        {SHOWN_BILLINGS.map(b => (
          <TouchableOpacity key={b} onPress={() => setBilling(b)} activeOpacity={0.85}
            style={[s.billBtn, billing === b && { backgroundColor: c.card, ...Shadow.sm }]}>
            <Text style={{ color: billing === b ? c.text : c.textMuted, fontWeight: '800', fontSize: 13.5 }}>{tr(BILLING_LABEL[b].name)}</Text>
            {b === 'yearly' && <Text style={{ color: c.success, fontWeight: '800', fontSize: 11 }}>{tr('2 months free')}</Text>}
            {b === 'monthly' && <Text style={{ color: c.textMuted, fontSize: 11 }}>{tr('flexible')}</Text>}
          </TouchableOpacity>
        ))}
      </View>
      <Text style={{ textAlign: 'center', color: c.textMuted, fontSize: 12, marginBottom: 14, marginHorizontal: 20 }}>
        {billing === 'monthly' ? tr('Pay every month, stop any time. Switch to yearly whenever you like — your data stays.') : tr('Pay for 10 months, use 12. All updates and new features included.')}
      </Text>

      {PLAN_ORDER.map(id => {
        const plan = LICENSE_PLANS[id];
        const best = id === 'standard';
        const price = PRICES_NOW()[id][billing];
        return (
          <View key={id} style={[s.planCard, { backgroundColor: c.card, borderColor: best ? c.primary : c.border, borderWidth: best ? 2 : 0.5 }]}>
            {best && <View style={[s.bestBadge, { backgroundColor: c.primary }]}><Text style={[s.bestBadgeText, { color: c.onPrimary }]}>{t('activation.bestValue')}</Text></View>}
            <View style={s.planHeader}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={[s.planName, { color: c.text }]}>{plan.name}</Text>
                <Text style={{ fontSize: 11.5, color: c.textMuted, marginTop: 2 }}>{tr(plan.tagline)}</Text>
              </View>
              <View>
                {billing === 'yearly' && <Text style={{ fontSize: 12.5, color: c.textMuted, textAlign: 'right', textDecorationLine: 'line-through' }}>{inr(PRICES_NOW()[id].monthly * 12)}</Text>}
                <Text style={[s.planPrice, { color: c.text }]}>{inr(price)}<Text style={{ fontSize: 13, color: c.textMuted, fontWeight: '600' }}>{tr(BILLING_LABEL[billing].per.trim())}</Text></Text>
                {billing === 'yearly' && <Text style={{ fontSize: 11, color: c.success, textAlign: 'right', fontWeight: '700' }}>{tr('{amt} a month, billed yearly', { amt: inr(Math.round(price / 12 * 100) / 100) })}</Text>}
                {billing === 'monthly' && <Text style={{ fontSize: 11, color: c.textMuted, textAlign: 'right' }}>{tr('{amt} a year', { amt: inr(price * 12) })}</Text>}
              </View>
            </View>
            {plan.features.filter(f => !f.startsWith('❌')).map((f, i) => (
              <View key={i} style={s.featureRow}>
                <MaterialCommunityIcons name="check-circle" size={16} color={plan.color} />
                <Text style={{ fontSize: 13, color: c.textSecondary, flex: 1 }}>{tr(f.replace(/^✅\s*/, ''))}</Text>
              </View>
            ))}
            <View style={[s.saveTag, { backgroundColor: c.successLight }]}>
              <Text style={{ color: c.success, fontWeight: '800', fontSize: 12 }}>
                {billing === 'yearly' ? tr('You save {p}% — 2 months free every year', { p: yearlySavingPct(id, priceCurrency()) }) : tr('Tip: yearly {a} saves {b} vs paying monthly', { a: inr(PRICES_NOW()[id].yearly), b: inr(price * 12 - PRICES_NOW()[id].yearly) })}
              </Text>
            </View>
            <TouchableOpacity style={[s.buyBtn, { backgroundColor: best ? c.primary : c.text, opacity: buying ? 0.6 : 1 }]} onPress={() => handlePurchase(id)} disabled={loading || buying} accessibilityRole="button">
              {buying ? <ActivityIndicator color={best ? c.onPrimary : c.bg} /> :
                <Text style={[s.buyBtnText, { color: best ? c.onPrimary : c.bg }]}>{SELLER_UPI ? `${tr('Buy')} ${tr(BILLING_LABEL[billing].name)} · ${inr(price)}` : t('activation.buyNow')}</Text>}
            </TouchableOpacity>
          </View>
        );
      })}

      {/* Device ID + help. Long-press the card for diagnostics (support only). */}
      <TouchableOpacity activeOpacity={1} onLongPress={() => setShowDiag(v => !v)} delayLongPress={1200}
        style={[s.deviceCard, { backgroundColor: c.card, borderColor: c.border }]}>
        <Text style={{ fontSize: 12, color: c.textMuted, fontWeight: '700', letterSpacing: 1 }}>{tr('YOUR DEVICE ID')}</Text>
        <Text selectable style={{ fontSize: 15, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', color: c.primary, letterSpacing: 1.5, fontWeight: '700', marginTop: 8 }}>{deviceId}</Text>
        {showDiag ? <Text style={{ fontSize: 11, color: c.textMuted, marginTop: 6 }}>diag: {licenseKeyIds().join(', ') || 'missing'}</Text> : null}
        <TouchableOpacity onPress={() => askHelp()} style={[s.helpBtn, { borderColor: c.primary }]}>
          <MaterialCommunityIcons name="whatsapp" size={18} color={c.primary} />
          <Text style={{ color: c.primary, fontWeight: '700' }}>{tr('Need help? Chat with support')}</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    </ScrollView>
    </KeyboardAvoidingView>

    {/* Terms / Privacy — a real Modal (an absolute overlay inside the ScrollView
        rendered at the top of the content, i.e. off-screen once scrolled). */}
    <Modal visible={showTerms || showPrivacy} transparent animationType="fade" statusBarTranslucent
      onRequestClose={() => { setShowTerms(false); setShowPrivacy(false); }}>
      <View style={[s.modalOverlay, { backgroundColor: c.overlay }]}>
        <View style={[s.modalContent, { backgroundColor: c.card }]}>
          <View style={s.modalHeader}>
            <Text style={[s.modalTitle, { color: c.text, flex: 1 }]}>{showTerms ? t('terms.title') : t('privacy.title')}</Text>
            <TouchableOpacity onPress={() => { setShowTerms(false); setShowPrivacy(false); }} accessibilityLabel={tr('Close')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <MaterialCommunityIcons name="close" size={24} color={c.text} />
            </TouchableOpacity>
          </View>
          {legalIsEnglishFallback(showTerms ? 'terms' : 'privacy') ? (
            <Text style={{ color: c.textMuted, fontSize: 12, marginBottom: 8 }}>{tr('Shown in English (the official version).')}</Text>
          ) : null}
          <ScrollView style={{ flexGrow: 0 }}>
            <Text style={{ fontSize: 13.5, color: c.textSecondary, lineHeight: 22 }}>{legal(showTerms ? 'terms' : 'privacy')}</Text>
          </ScrollView>
          <TouchableOpacity style={[s.acceptBtn, { backgroundColor: c.primary }]} onPress={() => { setAcceptedTerms(true); setShowTerms(false); setShowPrivacy(false); }}>
            <Text style={[s.buyBtnText, { color: c.onPrimary }]}>{tr('I Accept')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
    {choice.element}
    </SafeScreen>
  );
};

const s = StyleSheet.create({
  container: { flex: 1 },
  hero: { alignItems: 'center', paddingTop: 36, paddingBottom: 24, paddingHorizontal: 16, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, marginBottom: 18, overflow: 'hidden' },
  heroGlow: { position: 'absolute', top: 20, width: 200, height: 200, borderRadius: 100, backgroundColor: 'rgba(255,255,255,0.08)' },
  logo: { fontSize: 26, color: '#F0E6D2', fontWeight: '300', letterSpacing: 2, marginTop: 6 },
  logoBold: { fontWeight: '800', color: '#D9A441' },
  tagline: { fontSize: 10.5, color: '#9C8355', marginTop: 6, letterSpacing: 2, fontWeight: '700' },
  trustRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 14 },
  trustItem: { color: '#FFF', fontSize: 11, backgroundColor: 'rgba(255,255,255,0.12)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, overflow: 'hidden' },
  launchCard: { marginHorizontal: 20, marginBottom: 14, padding: 14, borderRadius: Radius.lg, alignItems: 'center' },
  launchTitle: { color: '#FFF', fontWeight: '900', fontSize: 15 },
  launchSub: { color: 'rgba(255,255,255,0.9)', fontSize: 12, marginTop: 4, textAlign: 'center', lineHeight: 17 },
  billRow: { flexDirection: 'row', marginHorizontal: 20, marginBottom: 8, padding: 4, borderRadius: 14, gap: 4 },
  billBtn: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 11 },
  saveTag: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, marginTop: 12 },
  notice: { marginHorizontal: 20, marginBottom: 14, padding: 14, borderRadius: Radius.lg, borderWidth: 1 },
  tcCard: { marginHorizontal: 20, padding: 14, borderRadius: Radius.lg, borderWidth: 1.5, marginBottom: 14 },
  tcRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tcText: { flex: 1, fontSize: 14, lineHeight: 20 },
  trialBtn: { marginHorizontal: 20, marginBottom: 18, paddingVertical: 16, paddingHorizontal: 16, borderRadius: Radius.lg, alignItems: 'center', ...Shadow.md },
  trialTitle: { color: '#FFF', fontSize: 18, fontWeight: '800' },
  trialSub: { color: 'rgba(255,255,255,0.9)', fontSize: 12, marginTop: 3 },
  sectionTitle: { fontSize: 17, fontWeight: '700', textAlign: 'center', marginBottom: 10, letterSpacing: -0.3 },
  keyInput: { borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 13, minHeight: 84, borderWidth: 1, marginBottom: 10, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  input: { borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, borderWidth: StyleSheet.hairlineWidth, marginBottom: 10 },
  activateBtn: { paddingVertical: 16, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  activateBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  planCard: { marginHorizontal: 20, marginBottom: 16, borderRadius: Radius.xl, padding: 18, ...Shadow.md },
  bestBadge: { position: 'absolute', top: -10, right: 16, paddingHorizontal: 14, paddingVertical: 5, borderRadius: 20 },
  bestBadgeText: { color: '#FFF', fontSize: 11, fontWeight: '700' },
  planHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  planName: { fontSize: 19, fontWeight: '800', letterSpacing: -0.5 },
  planPrice: { fontSize: 22, fontWeight: '800', textAlign: 'right', letterSpacing: -0.5 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 3 },
  buyBtn: { marginTop: 14, paddingVertical: 14, borderRadius: Radius.md, alignItems: 'center' },
  buyBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  divider: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, marginVertical: 22 },
  dividerLine: { flex: 1, height: 0.5 },
  deviceCard: { marginHorizontal: 20, marginTop: 8, padding: 18, borderRadius: Radius.lg, alignItems: 'center', borderWidth: 1, ...Shadow.sm },
  helpBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, paddingHorizontal: 14, paddingVertical: 10, borderRadius: Radius.md, borderWidth: 1 },
  modalOverlay: { flex: 1, justifyContent: 'center', padding: 16 },
  modalContent: { borderRadius: Radius.xl, padding: 20, maxHeight: '86%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 20, fontWeight: '700' },
  acceptBtn: { marginTop: 16, paddingVertical: 15, borderRadius: Radius.md, alignItems: 'center' },
});

export default ActivationScreen;
