import React, { useContext, useState, useCallback, useRef } from 'react';
import { View, ScrollView, TouchableOpacity, Alert, RefreshControl, Keyboard } from 'react-native';
import type { TextInput as TextInputRef } from 'react-native';
import { Text, TextInput } from '../theme/Text';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { TabScreen as SafeScreen } from '../components/SafeScreen';
import { AppBar, Card, StatCard, SectionLabel, Pill } from '../components/UI';
import { useTheme } from '../context/ThemeContext';
import { AppContext } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { DatabaseService, DBX } from '../database/Database';
import { BossAI, Briefing } from '../services/ai/BossAI';
import { BranchSyncService } from '../services/BranchSyncService';
import { DemoDataService } from '../services/DemoDataService';
import { GettingStarted } from '../components/GettingStarted';
import { formatCurrency, toLocalDateStr } from '../utils/helpers';
import { WhatsAppService } from '../services/WhatsAppService';
import { FeatureGate } from '../utils/featureGate';
import { todayLocal, parseDbDate } from '../utils/helpers';
import { LicenseService } from '../services/LicenseService';
import { AppShellContext } from '../context/AppShellContext';
import { AppointmentReminderService, minutesUntil } from '../services/AppointmentReminderService';
import { tr, useTr, activeLocale } from '../i18n/tr';
import { parseAmount, cleanAmountInput, showError } from '../components/formUtils';
import { appEvents } from '../components/appEvents';
import { useBusy } from '../components/useBusy';
import { BusinessType, quickActionOrder, isWalkinFirst, QuickKey } from '../config/businessTypes';
import { BusinessTypeService } from '../services/BusinessTypeService';
import { appLocale } from '../config/regions';

// Reload the dashboard on focus only when it is older than this, or after a
// bill / appointment / expense changed somewhere (was: 15 queries + network
// on every single focus).
const STALE_MS = 60_000;

export default function DashboardScreen() {
  const { colors: c } = useTheme();
  useTr();
  const navigation = useNavigation<any>();
  const [hasAcademy, setHasAcademy] = useState(false);
  const [hasMarketing, setHasMarketing] = useState(false);
  const [hasInsights, setHasInsights] = useState(false);
  const [hasMulti, setHasMulti] = useState(false);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [mtd, setMtd] = useState(0);
  const [dues, setDues] = useState<{ amount: number; clients: number }>({ amount: 0, clients: 0 });
  const [hq, setHq] = useState<{ connected: boolean; isHQ: boolean; today: number; branches: number; lastBackup: number } | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [newBookings, setNewBookings] = useState(0);
  const { restart } = useContext(AppShellContext);
  const { currencySymbol, todayStats, refresh } = useContext(AppContext);
  const { can, user } = useAuth();
  const showMoney = can('dashboard.revenue');
  const isOwner = !!user?.isOwner;
  const [bizType, setBizType] = useState<BusinessType>('unisex');
  const [gstAdvice, setGstAdvice] = useState<{ currentRate: number; show: boolean } | null>(null);
  const [queueWaiting, setQueueWaiting] = useState<number | null>(null);
  const [dayClosed, setDayClosed] = useState<{ closed: boolean; difference: number } | null>(null);
  const [wallet, setWallet] = useState<{ clients: number; amount: number }>({ clients: 0, amount: 0 });
  const [gstBusy, runGst] = useBusy('GST rate not changed');
  const canQueue = can('queue.manage');
  const canDayClose = can('cash.close') || can('dashboard.revenue');
  const { resetToActivation } = useContext(AppShellContext);
  const [trialDays, setTrialDays] = useState(0);
  const [renewal, setRenewal] = useState<{ days: number; grace: boolean; expiry: string } | null>(null);

  const [profile,       setProfile]       = useState<any>({});
  const [reminders,     setReminders]     = useState<any[]>([]);
  const [birthdays,     setBirthdays]     = useState<any[]>([]);
  const [anniversaries, setAnniversaries] = useState<any[]>([]);
  const [lowStock,      setLowStock]      = useState<any[]>([]);
  const [expiringProds, setExpiringProds] = useState<any[]>([]);
  const [lapsed30,      setLapsed30]      = useState<any[]>([]);
  const [soonApts,      setSoonApts]      = useState<any[]>([]);
  const [refreshing,    setRefreshing]    = useState(false);
  const [reengageEnabled, setReengageEnabled] = useState(true);
  const [reengageDays,    setReengageDays]    = useState(30);
  const [reengageMessage, setReengageMessage] = useState(WhatsAppService.DEFAULT_REENGAGE_MESSAGE);

  const [target,        setTarget]        = useState(0);
  const [editingTarget, setEditingTarget] = useState(false);
  const [targetInput,   setTargetInput]   = useState('');
  const targetRef = useRef<TextInputRef>(null);

  const [cashReg,       setCashReg]       = useState<any>(null);
  const [editingCash,   setEditingCash]   = useState(false);
  const [cashInput,     setCashInput]     = useState('');
  const cashRef = useRef<TextInputRef>(null);

  const fmt = (n: number) => `${currencySymbol}${(n || 0).toLocaleString(appLocale(), { maximumFractionDigits: 0 })}`;
  const lastLoad = useRef(0);
  const dirty = useRef(true);
  const loading = useRef(false);
  const [savingTarget, setSavingTarget] = useState(false);
  const [savingCash, setSavingCash] = useState(false);
  React.useEffect(() => {
    const mark = () => { dirty.current = true; };
    const offs = [appEvents.on('bill:created', mark), appEvents.on('bill:voided', mark), appEvents.on('appointment:changed', mark),
      appEvents.on('expense:changed', mark), appEvents.on('inventory:changed', mark), appEvents.on('data:restored', mark), appEvents.on('client:changed', mark)];
    return () => offs.forEach(f => f());
  }, []);

  React.useEffect(() => {
    FeatureGate.canAccess('hasAcademy').then(setHasAcademy).catch(() => {});
    FeatureGate.canAccess('hasMarketing').then(setHasMarketing).catch(() => {});
    FeatureGate.canAccess('hasAdvancedReports').then(setHasInsights).catch(() => {});
    FeatureGate.canAccess('hasMultiLocation').then(setHasMulti).catch(() => {});
  }, []);
  // Cheap, always-fresh bits: walk-ins waiting and whether today is closed.
  const loadLive = useCallback(() => {
    // Business type can be changed in Settings; re-read it so the quick-action order follows at once.
    BusinessTypeService.get().then(setBizType).catch(() => {});
    if (can('queue.manage')) DBX.queueStats().then(st => setQueueWaiting(st?.waiting ?? 0)).catch(() => {});
    if (can('cash.close') || can('dashboard.revenue')) {
      DBX.getDayClose(todayLocal()).then(dc => setDayClosed({ closed: !!dc, difference: Number(dc?.difference) || 0 })).catch(() => {});
    }
  }, [can]);

  useFocusEffect(useCallback(() => {
    loadLive();
    if (dirty.current || Date.now() - lastLoad.current > STALE_MS) loadAll();
    // Trial countdown, and lock the app if the trial or an annual key ran out
    // while it was left open.
    LicenseService.getStatus().then(st => {
      if (!st.activated) { resetToActivation(); return; }
      setTrialDays(st.trial ? st.daysLeft : 0);
      setRenewal(!st.trial && (st.billing === 'monthly' || st.billing === 'yearly') && (st.grace || st.daysLeft <= 7) ? { days: st.daysLeft, grace: !!st.grace, expiry: st.expiry } : null);
    }).catch(() => {});
  }, []));

  /**
   * Every section loads on its own (Promise.allSettled): one failing query
   * used to blank the whole page; now that card just stays as it was.
   */
  async function loadAll() {
    if (loading.current) return;
    loading.current = true;
    dirty.current = false;
    try {
      await DatabaseService.ensureReady().catch(() => {});
      const today = todayLocal();
      const now = new Date();
      const val = <T,>(r: PromiseSettledResult<T>, fb: T): T => (r.status === 'fulfilled' ? r.value : fb);
      const canInv = can('inventory.view');
      const [ctx, rem, bday, anniv, stock, prof, tgt, cash, expiring, reDays, reMsg, reEnabled, pl, dueSum, demo, nb, apts] = await Promise.allSettled([
        Promise.resolve(refresh()),
        DatabaseService.getDueReminders(),
        DatabaseService.getUpcomingBirthdays(3),
        DatabaseService.getUpcomingAnniversaries(3),
        canInv ? DatabaseService.getLowStockItems() : Promise.resolve([]),
        DatabaseService.getSalonProfile(),
        (DatabaseService as any).getRevenueTarget(),
        (DatabaseService as any).getCashRegister(today),
        canInv ? (DatabaseService as any).getExpiringProducts(30) : Promise.resolve([]),
        DatabaseService.getSetting('reengage_days'),
        DatabaseService.getSetting('reengage_message'),
        DatabaseService.getSetting('reengage_enabled'),
        // month-to-date for the target bar
        DatabaseService.getPLSummary(toLocalDateStr(new Date(now.getFullYear(), now.getMonth(), 1)), today),
        DBX.getDuesSummary(),
        DemoDataService.isDemo(),
        DBX.countNewBookings(),
        can('calendar.view') ? DatabaseService.getAppointments(today) : Promise.resolve([]),
      ]);
      void ctx;
      setSoonApts(((val(apts, []) as any[]) || [])
        .filter(a => a.status === 'confirmed' && minutesUntil(a) > -10 && minutesUntil(a) <= 90)
        .sort((a, b) => minutesUntil(a) - minutesUntil(b)));
      if (rem.status === 'fulfilled') setReminders((rem.value as any[]) || []);
      if (bday.status === 'fulfilled') setBirthdays((bday.value as any[]) || []);
      if (anniv.status === 'fulfilled') setAnniversaries((anniv.value as any[]) || []);
      if (stock.status === 'fulfilled') setLowStock((stock.value as any[]) || []);
      if (prof.status === 'fulfilled') setProfile(prof.value || {});
      if (tgt.status === 'fulfilled') setTarget(Number(tgt.value) || 0);
      if (cash.status === 'fulfilled') setCashReg(cash.value);
      if (expiring.status === 'fulfilled') setExpiringProds(((expiring.value as any[]) || []).slice(0, 3));
      if (pl.status === 'fulfilled') setMtd((pl.value as any)?.revenue || 0);
      if (dueSum.status === 'fulfilled') setDues(dueSum.value as any);
      if (demo.status === 'fulfilled') setIsDemo(!!demo.value);
      if (nb.status === 'fulfilled') setNewBookings(Number(nb.value) || 0);

      // v5.6: business type (quick-action order), GST advice and wallet liability — owner only for the money bits.
      BusinessTypeService.get().then(setBizType).catch(() => {});
      if (user?.isOwner) {
        DBX.getGstAdvice().then(a => setGstAdvice(a)).catch(() => {});
        DBX.getWalletLiability().then(w => setWallet(w || { clients: 0, amount: 0 })).catch(() => {});
      }

      const days = parseInt(val(reDays, '') || '30', 10) || 30;
      const msg  = val(reMsg, '') || WhatsAppService.DEFAULT_REENGAGE_MESSAGE;
      const enabled = val(reEnabled, '') !== 'false';
      setReengageDays(days);
      setReengageMessage(msg);
      setReengageEnabled(enabled);
      lastLoad.current = Date.now();

      // Slow / network sections: never block the page.
      if (enabled) (DatabaseService as any).getLapsedClients(days).then((l: any[]) => setLapsed30((l || []).slice(0, 5))).catch(() => {});
      else setLapsed30([]);
      if (can('calendar.edit')) BranchSyncService.checkBookings().then(async n => { if (n) setNewBookings(await DBX.countNewBookings()); }).catch(() => {});
      BranchSyncService.status().then(async st => {
        if (st.cfg) {
          const cached = st.cfg.isHQ ? await BranchSyncService.getCachedBranches() : [];
          setHq({ connected: true, isHQ: st.cfg.isHQ, branches: cached.length, today: cached.reduce((s2, b) => s2 + (b.summary?.today?.revenue || 0), 0), lastBackup: st.lastBackup });
        } else setHq({ connected: false, isHQ: false, today: 0, branches: 0, lastBackup: 0 });
      }).catch(() => {});
      if (can('ai.view')) BossAI.briefing({ money: can('dashboard.revenue') }).then(setBriefing).catch(() => {});
    } catch (e) {
      console.warn('Dashboard loadAll:', e);
      dirty.current = true;
    } finally { loading.current = false; }
  }

  async function pullRefresh() { setRefreshing(true); dirty.current = true; await loadAll(); setRefreshing(false); }

  async function saveTarget() {
    if (savingTarget) return;
    const val = parseAmount(targetInput);
    if (isNaN(val) || val <= 0) { Alert.alert(tr('Check the amount'), tr('Please enter an amount greater than 0 (e.g. 1,50,000).')); return; }
    Keyboard.dismiss();
    setSavingTarget(true);
    try {
      await (DatabaseService as any).setRevenueTarget(val);
      setTarget(val); setEditingTarget(false); setTargetInput('');
    } catch (e) { showError(e, 'Target not saved'); }
    finally { setSavingTarget(false); }
  }
  function startEditTarget() {
    setTargetInput(target > 0 ? String(target) : '');
    setEditingTarget(true);
    setTimeout(() => targetRef.current?.focus(), 100);
  }

  async function openCashRegister() {
    if (savingCash) return;
    const amt = cashInput.trim() === '' ? 0 : parseAmount(cashInput);
    if (isNaN(amt)) { Alert.alert(tr('Check the amount'), tr('Opening cash must be a number that is 0 or more.')); return; }
    Keyboard.dismiss();
    setSavingCash(true);
    try {
      await (DatabaseService as any).openCashRegister(amt);
      const cash = await (DatabaseService as any).getCashRegister(todayLocal());
      setCashReg(cash); setEditingCash(false); setCashInput('');
    } catch (e) { showError(e, 'Cash not saved'); }
    finally { setSavingCash(false); }
  }
  function startEditCash() {
    setCashInput(cashReg?.opening > 0 ? String(cashReg.opening) : '');
    setEditingCash(true);
    setTimeout(() => cashRef.current?.focus(), 100);
  }

  function sendWish(client: any, type: 'birthday' | 'anniversary') {
    if (!client.phone) { Alert.alert('No phone', 'This client has no phone number.'); return; }
    const msg = type === 'birthday'
      ? `🎂 Happy Birthday ${client.name}! 🎉\n\nAs our birthday gift, enjoy a special surprise on your next visit at ${profile.name || 'our salon'}!\n\nBook now: ${profile.phone || ''}`
      : `💍 Happy Anniversary ${client.name}! 💐\n\nCelebrate your special day in style at ${profile.name || 'our salon'}.\n\nCall us: ${profile.phone || ''}`;
    Promise.resolve(WhatsAppService.sendMessage(client.phone, msg)).catch(e => showError(e, 'WhatsApp did not open'));
  }
  async function sendReminder(rem: any) {
    try {
      if (rem.client_phone) await WhatsAppService.sendMessage(rem.client_phone, rem.message);
      await DatabaseService.markReminderSent(rem.id);
      setReminders(p => p.filter(r => r.id !== rem.id));
    } catch (e) { showError(e, 'Reminder not sent'); }
  }
  function reactivateClient(client: any) {
    if (!client.phone) { Alert.alert('No phone', 'No phone number for this client.'); return; }
    const msg = WhatsAppService.fillTemplate(reengageMessage, {
      name: client.name || 'there',
      salon: profile.name || 'our salon',
      phone: profile.phone || '',
      days: reengageDays,
      last_visit: client.last_visit ? parseDbDate(client.last_visit).toLocaleDateString(appLocale()) : 'a while ago',
    });
    Alert.alert('Re-engage Client', `Send a WhatsApp message to ${client.name}?`,
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Send', onPress: () => { Promise.resolve(WhatsAppService.sendMessage(client.phone, msg)).catch(e => showError(e, 'WhatsApp did not open')); } }]);
  }

  const greeting = () => { const h = new Date().getHours(); return h < 12 ? tr('Good morning') : h < 17 ? tr('Good afternoon') : tr('Good evening'); };
  const rev = todayStats?.revenue ?? 0;
  const bills = todayStats?.billCount ?? 0;
  const walkins = todayStats?.walkInCount ?? 0;
  const apts = todayStats?.appointmentCount ?? 0;
  const doneApts = todayStats?.completedAppointments ?? 0;
  const targetPct = target > 0 ? Math.min(100, Math.round((mtd / target) * 100)) : 0;

  const TARGET_PRESETS = ['25000', '50000', '75000', '100000', '150000', '200000'];
  const CASH_PRESETS   = ['500', '1000', '2000', '5000', '10000'];

  type QuickTile = { key: QuickKey; icon: string; label: string; tone: string; onPress: () => void; badge?: number };
  const tiles: QuickTile[] = [
    ...(can('billing.create') ? [{ key: 'bill' as QuickKey, icon: 'receipt-text-outline', label: 'New Bill',  tone: c.primary, onPress: () => navigation.navigate('Billing') }] : []),
    ...(canQueue ? [{ key: 'queue' as QuickKey, icon: 'ticket-confirmation-outline', label: 'Walk-in queue', tone: c.warning, onPress: () => navigation.navigate('Queue'), badge: queueWaiting || 0 }] : []),
    ...(can('calendar.view') ? [{ key: 'calendar' as QuickKey, icon: bizType === 'home' ? 'home-map-marker' : 'calendar-plus', label: bizType === 'home' ? 'Home visits' : 'Calendar', tone: c.info, onPress: () => navigation.navigate('Calendar') }] : []),
    ...(can('clients.view') ? [{ key: 'clients' as QuickKey, icon: bizType === 'clinic' || bizType === 'bridal' ? 'clipboard-account-outline' : 'account-multiple-outline', label: bizType === 'clinic' || bizType === 'bridal' ? 'Clients & notes' : 'Clients', tone: c.accent, onPress: () => navigation.navigate('Clients') }] : []),
    ...(can('reports.view') ? [{ key: 'reports' as QuickKey, icon: 'chart-box-outline', label: 'Reports', tone: c.warning, onPress: () => navigation.navigate('Reports') }] : []),
    ...(can('expenses.view') ? [{ key: 'expenses' as QuickKey, icon: 'cash-minus', label: 'Expenses', tone: c.danger, onPress: () => navigation.navigate('Expenses') }] : []),
    ...(canDayClose ? [{ key: 'dayclose' as QuickKey, icon: 'cash-register', label: 'Day close', tone: c.success, onPress: () => navigation.navigate('DayClose') }] : []),
    ...(hasAcademy && can('academy.view') ? [{ key: 'academy' as QuickKey, icon: 'school-outline', label: 'Academy', tone: c.tierPlatinum, onPress: () => navigation.navigate('Academy') }] : []),
    ...(hasMarketing && can('marketing.view') ? [{ key: 'marketing' as QuickKey, icon: 'image-multiple-outline', label: 'Marketing', tone: c.accent, onPress: () => navigation.navigate('Grow') }] : []),
    ...(hasInsights && can('insights.view') ? [{ key: 'insights' as QuickKey, icon: 'lightbulb-on-outline', label: 'Insights', tone: c.tierGold, onPress: () => navigation.navigate('Insights') }] : []),
    ...(can('ai.view') ? [{ key: 'ai' as QuickKey, icon: 'robot-happy-outline', label: 'Boss AI', tone: c.brandGold, onPress: () => navigation.navigate('AIAssistant') }] : []),
    ...(can('calendar.edit') ? [{ key: 'bookings' as QuickKey, icon: 'web-clock', label: 'Bookings', tone: c.primary, onPress: () => navigation.navigate('OnlineBooking') }] : []),
    ...(can('billing.history') ? [{ key: 'dues' as QuickKey, icon: 'clock-alert-outline', label: 'Dues', tone: c.warning, onPress: () => navigation.navigate('BillHistory') }] : []),
    // HQ: branches overview once this phone is head office; a chain owner who has not connected yet is taken to setup.
    ...(hasMulti && can('branches.view') && hq?.isHQ ? [{ key: 'hq' as QuickKey, icon: 'office-building-marker-outline', label: 'Branches', tone: c.info, onPress: () => navigation.navigate('HQDashboard') }]
      : hasMulti && bizType === 'chain' && (can('branches.manage') || can('settings.backup')) ? [{ key: 'hq' as QuickKey, icon: 'office-building-cog-outline', label: 'Set up HQ', tone: c.info, onPress: () => navigation.navigate('BranchHub') }] : []),
  ];
  const order = quickActionOrder(bizType);
  const QUICK = [...tiles].sort((x, y) => order.indexOf(x.key) - order.indexOf(y.key));

  function switchGstTo5() {
    runGst(async () => {
      await DatabaseService.updateSalonProfile({ tax_rate: 5 });
      await DBX.dismissGstAdvice();
      setGstAdvice(null);
      Alert.alert(tr('GST changed to 5%'), tr('New bills will charge 5% GST on services. Check with your CA if you also sell products at other rates.'));
    });
  }
  function keepGst18() {
    runGst(async () => {
      await DBX.dismissGstAdvice();
      setGstAdvice(null);
    });
  }

  async function startFresh() {
    Alert.alert(tr('Clear demo data?'), tr('All demo bills, clients, staff and services will be deleted, and setup starts again for your real salon. Your login and licence stay.'), [
      { text: tr('Cancel'), style: 'cancel' },
      { text: tr('Start fresh'), style: 'destructive', onPress: async () => { await DemoDataService.clearAll(); restart(); } },
    ]);
  }

  return (
    <SafeScreen>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        keyboardShouldPersistTaps="always"
        automaticallyAdjustKeyboardInsets
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={pullRefresh} tintColor={c.primary} />}>

        <AppBar
          subtitle={greeting()}
          title={profile.name || tr('My Salon')}
          right={can('billing.create') ? (
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.primary, borderRadius: 14, paddingHorizontal: 15, paddingVertical: 10 }}
              onPress={() => navigation.navigate('Billing')} activeOpacity={0.85}>
              <MaterialCommunityIcons name="plus" size={16} color={c.onPrimary} />
              <Text style={{ color: c.onPrimary, fontWeight: '800', fontSize: 13 }}>{tr('New Bill')}</Text>
            </TouchableOpacity>
          ) : undefined}
        />

        {renewal && showMoney && (
          <TouchableOpacity activeOpacity={0.85} onPress={() => resetToActivation()}
            style={{ marginHorizontal: 16, marginBottom: 14, padding: 14, borderRadius: 16, backgroundColor: renewal.grace ? c.danger : c.warning, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <MaterialCommunityIcons name="calendar-refresh" size={22} color={c.onPrimary} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.onPrimary, fontWeight: '800', fontSize: 14 }}>
                {renewal.grace ? tr('Your plan has ended — renew now') : renewal.days === 0 ? tr('Your plan ends today') : tr('Your plan ends in {n} days', { n: renewal.days })}
              </Text>
              <Text style={{ color: c.onPrimary, opacity: 0.85, fontSize: 12 }}>{tr('Renew in 1 minute · all your data stays safe')}</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={22} color={c.onPrimary} />
          </TouchableOpacity>
        )}

        {trialDays > 0 && showMoney && (
          <TouchableOpacity activeOpacity={0.85} onPress={resetToActivation}
            style={{ marginHorizontal: 16, marginBottom: 14, padding: 14, borderRadius: 14, backgroundColor: c.primary, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <MaterialCommunityIcons name="crown-outline" size={22} color={c.onPrimary} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.onPrimary, fontWeight: '800', fontSize: 14 }}>{trialDays === 1 ? tr('Free trial: {n} day left', { n: 1 }) : tr('Free trial: {n} days left', { n: trialDays })}</Text>
              <Text style={{ color: c.onPrimary, opacity: 0.85, fontSize: 12, marginTop: 2 }}>{tr('Monthly or yearly plans. Your data stays.')}</Text>
            </View>
            <Text style={{ color: c.onPrimary, fontWeight: '800' }}>{tr('Buy ›')}</Text>
          </TouchableOpacity>
        )}

        {isOwner && gstAdvice?.show && (
          <View style={{ marginHorizontal: 16, marginBottom: 14, padding: 14, borderRadius: 16, backgroundColor: c.infoLight, borderWidth: 1, borderColor: c.info + '40' }}>
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
              <MaterialCommunityIcons name="percent-circle-outline" size={24} color={c.info} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.text, fontWeight: '800', fontSize: 14, lineHeight: 19 }}>
                  {tr('GST on salon services is 5% since 22 Sep 2025. Your bills use {rate}%.', { rate: gstAdvice.currentRate })}
                </Text>
                <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 4, lineHeight: 17 }}>{tr('Check with your CA if you also sell products at other rates.')}</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <TouchableOpacity disabled={gstBusy} onPress={switchGstTo5} activeOpacity={0.85} accessibilityRole="button"
                style={{ flex: 1, backgroundColor: c.info, borderRadius: 12, paddingVertical: 11, alignItems: 'center', opacity: gstBusy ? 0.6 : 1 }}>
                <Text style={{ color: c.onPrimary, fontWeight: '800' }}>{tr('Switch to 5%')}</Text>
              </TouchableOpacity>
              <TouchableOpacity disabled={gstBusy} onPress={keepGst18} activeOpacity={0.85} accessibilityRole="button"
                style={{ flex: 1, backgroundColor: c.card, borderRadius: 12, paddingVertical: 11, alignItems: 'center', borderWidth: 1, borderColor: c.border, opacity: gstBusy ? 0.6 : 1 }}>
                <Text style={{ color: c.textSecondary, fontWeight: '800' }}>{tr('Keep {rate}%', { rate: gstAdvice.currentRate })}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {isDemo && (
          <View style={{ marginHorizontal: 16, marginBottom: 14, padding: 14, borderRadius: 14, backgroundColor: c.warningLight, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <MaterialCommunityIcons name="flask-outline" size={22} color={c.warning} />
            <Text style={{ flex: 1, color: c.text, fontSize: 12.5, fontWeight: '600' }}>{tr('You are looking at a demo salon with sample data.')}</Text>
            {can('settings.business') && (
              <TouchableOpacity onPress={startFresh} style={{ backgroundColor: c.warning, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 }}>
                <Text style={{ color: c.onPrimary, fontWeight: '800', fontSize: 12 }}>{tr('Start fresh')}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {can('settings.business') && <GettingStarted />}

        {newBookings > 0 && can('calendar.edit') && (
          <TouchableOpacity activeOpacity={0.85} onPress={() => navigation.navigate('OnlineBooking')}
            style={{ marginHorizontal: 16, marginBottom: 14, padding: 14, borderRadius: 16, backgroundColor: c.primary, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <MaterialCommunityIcons name="calendar-alert" size={26} color={c.onPrimary} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.onPrimary, fontWeight: '900', fontSize: 15 }}>{tr('{n} new online booking request(s)', { n: newBookings })}</Text>
              <Text style={{ color: c.onPrimary, opacity: 0.85, fontSize: 12 }}>{tr('Tap to accept — the customer gets a WhatsApp confirmation')}</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={22} color={c.onPrimary} />
          </TouchableOpacity>
        )}

        {briefing && can('ai.view') && (
          <TouchableOpacity activeOpacity={0.9} onPress={() => navigation.navigate('AIAssistant')}
            style={{ marginHorizontal: 16, marginBottom: 16, borderRadius: 20, padding: 16, backgroundColor: c.brandInk }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <MaterialCommunityIcons name="robot-happy-outline" size={18} color={c.brandGold} />
              <Text style={{ color: c.brandGold, fontWeight: '900', fontSize: 12, letterSpacing: 1 }}>{tr('BOSS AI · TODAY')}</Text>
              <View style={{ flex: 1 }} />
              <Text style={{ color: '#8A826F', fontSize: 11, fontWeight: '700' }}>{tr('offline')}</Text>
            </View>
            {briefing.lines.slice(0, 4).map((l, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: 8, marginTop: 5 }}>
                <MaterialCommunityIcons name={l.icon as any} size={15} color={l.tone === 'danger' ? '#F2666B' : l.tone === 'warning' ? '#F5B454' : l.tone === 'success' ? '#34D399' : '#CFC8B8'} style={{ marginTop: 2 }} />
                <Text style={{ color: '#E9E2D2', fontSize: 13, flex: 1, lineHeight: 18 }}>{l.text}</Text>
              </View>
            ))}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12, backgroundColor: '#ffffff14', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 }}>
              <MaterialCommunityIcons name="message-question-outline" size={16} color="#B9AE96" />
              <Text style={{ color: '#B9AE96', marginLeft: 8, flex: 1, fontSize: 13 }}>{tr('Ask: aaj kitna hua? who is due back?')}</Text>
              <MaterialCommunityIcons name="chevron-right" size={18} color="#B9AE96" />
            </View>
          </TouchableOpacity>
        )}

        {hq?.isHQ && hasMulti && can('branches.view') && hq.branches > 0 && (
          <TouchableOpacity activeOpacity={0.85} onPress={() => navigation.navigate('HQDashboard')}
            style={{ marginHorizontal: 16, marginBottom: 14, padding: 14, borderRadius: 16, backgroundColor: c.infoLight, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <MaterialCommunityIcons name="office-building-marker-outline" size={26} color={c.info} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.text, fontWeight: '800' }}>{tr('All {n} branches today', { n: hq.branches })}: {formatCurrency(Math.round(hq.today), currencySymbol)}</Text>
              <Text style={{ color: c.textMuted, fontSize: 12 }}>{tr('Tap for the HQ dashboard')}</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={20} color={c.info} />
          </TouchableOpacity>
        )}

        {hq && !hq.connected && can('settings.backup') && !isDemo && (
          <TouchableOpacity activeOpacity={0.85} onPress={() => navigation.navigate('BranchHub')}
            style={{ marginHorizontal: 16, marginBottom: 14, padding: 14, borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.primary, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <MaterialCommunityIcons name="google-drive" size={24} color={c.primary} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.text, fontWeight: '800' }}>{tr('Protect your data — free cloud backup')}</Text>
              <Text style={{ color: c.textMuted, fontSize: 12 }}>{tr('One tap · daily encrypted backup · online booking')}</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={20} color={c.primary} />
          </TouchableOpacity>
        )}

        {/* Today stats */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 10, marginBottom: 18 }}>
          {showMoney && <StatCard icon="cash-multiple"   label={tr("Today's revenue")} value={fmt(rev)}        tone="success" />}
          <StatCard icon="receipt-text-outline" label={tr("Bills")}       value={String(bills)}   tone="primary" />
          <StatCard icon="walk"            label={tr("Walk-ins")}         value={String(walkins)} tone="warning" />
          <StatCard icon="calendar-check"  label={tr("Appointments")}     value={`${doneApts}/${apts}`} tone="info" />
          {showMoney && dues.amount > 0 && <StatCard icon="clock-alert-outline" label={tr('Pending dues ({n})', { n: dues.clients })} value={fmt(dues.amount)} tone="danger" onPress={() => navigation.navigate('BillHistory')} />}
          {showMoney && <StatCard icon="calendar-month-outline" label={tr('This month')} value={fmt(mtd)} tone="accent" onPress={() => navigation.navigate('Reports')} />}
        </View>

        {/* Walk-in queue + Day close entry tiles */}
        {(canQueue || canDayClose) && (
          <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginBottom: 16 }}>
            {canQueue && (
              <EntryTile icon="ticket-confirmation-outline" tone={c.warning} toneBg={c.warningLight}
                title={tr('Walk-in queue')}
                sub={queueWaiting == null ? tr('Give tokens') : queueWaiting === 0 ? tr('No one waiting') : tr('{n} waiting', { n: queueWaiting })}
                highlight={!!queueWaiting && isWalkinFirst(bizType)}
                onPress={() => navigation.navigate('Queue')} />
            )}
            {canDayClose && (() => {
              const late = new Date().getHours() >= 18;
              const closedNow = !!dayClosed?.closed;
              const diff = dayClosed?.difference || 0;
              const sub = closedNow
                ? (Math.round(diff * 100) === 0 ? tr('Closed ✓') : diff < 0 ? tr('Closed · short {amt}', { amt: fmt(Math.abs(diff)) }) : tr('Closed · excess {amt}', { amt: fmt(diff) }))
                : late ? tr('Not closed yet') : tr('Count the drawer at closing');
              return (
                <EntryTile icon={closedNow ? 'lock-check-outline' : 'cash-register'}
                  tone={closedNow ? c.success : late ? c.danger : c.success} toneBg={closedNow ? c.successLight : late ? c.dangerLight : c.successLight}
                  title={tr('Day close')} sub={sub} highlight={!closedNow && late}
                  onPress={() => navigation.navigate('DayClose')} />
              );
            })()}
          </View>
        )}

        {isOwner && showMoney && wallet.amount > 0 && (
          <TouchableOpacity activeOpacity={0.85} onPress={() => navigation.navigate('Reports')}
            style={{ marginHorizontal: 16, marginTop: -6, marginBottom: 16, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 14, backgroundColor: c.accentLight, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <MaterialCommunityIcons name="wallet-outline" size={20} color={c.accent} />
            <Text style={{ color: c.text, fontSize: 13, fontWeight: '700', flex: 1 }} numberOfLines={2}>
              {tr('Client wallets: {amt} held for {n} clients', { amt: fmt(wallet.amount), n: wallet.clients })}
            </Text>
          </TouchableOpacity>
        )}

        {/* Monthly target */}
        {showMoney && <View style={{ marginHorizontal: 16, marginBottom: 16 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <SectionLabel style={{ marginBottom: 0 }}>{tr('Monthly Target')}</SectionLabel>
            {!editingTarget && (
              <TouchableOpacity onPress={startEditTarget}>
                <Text style={{ color: c.primary, fontSize: 12.5, fontWeight: '700' }}>{target > 0 ? tr('Edit') : tr('+ Set target')}</Text>
              </TouchableOpacity>
            )}
          </View>

          {editingTarget ? (
            <Card>
              <Text style={{ color: c.textSecondary, fontSize: 13, marginBottom: 10 }}>{tr('Monthly revenue target ({sym})', { sym: currencySymbol })}</Text>
              <TextInput
                ref={targetRef}
                style={{ backgroundColor: c.surface, color: c.text, borderRadius: 12, padding: 14, fontSize: 22, fontWeight: '800', borderWidth: 1.5, borderColor: c.primary, marginBottom: 12 }}
                value={targetInput} onChangeText={v => setTargetInput(cleanAmountInput(v))}
                placeholder="e.g. 100000" placeholderTextColor={c.textMuted}
                keyboardType="decimal-pad" returnKeyType="done" onSubmitEditing={saveTarget} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                {TARGET_PRESETS.map(v => (
                  <TouchableOpacity key={v}
                    style={{ paddingHorizontal: 13, paddingVertical: 8, borderRadius: 999, backgroundColor: targetInput === v ? c.primary : c.primaryLight }}
                    onPress={() => setTargetInput(v)} activeOpacity={0.7}>
                    <Text style={{ color: targetInput === v ? c.onPrimary : c.primary, fontWeight: '700', fontSize: 12.5 }}>
                      {currencySymbol}{parseInt(v).toLocaleString(appLocale())}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity style={{ flex: 1, padding: 13, borderRadius: 12, backgroundColor: c.surface, alignItems: 'center' }}
                  onPress={() => { Keyboard.dismiss(); setEditingTarget(false); setTargetInput(''); }}>
                  <Text style={{ color: c.textSecondary, fontWeight: '700' }}>{tr('Cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={{ flex: 1, padding: 13, borderRadius: 12, backgroundColor: c.primary, alignItems: 'center', opacity: savingTarget ? 0.6 : 1 }} onPress={saveTarget} disabled={savingTarget}>
                  <Text style={{ color: c.onPrimary, fontWeight: '800' }}>{tr('Save target')}</Text>
                </TouchableOpacity>
              </View>
            </Card>
          ) : target > 0 ? (
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
                <Text style={{ color: c.text, fontWeight: '800', fontSize: 15 }}>{tr('{n}% of goal', { n: targetPct })}</Text>
                <Text style={{ color: c.textMuted, fontSize: 13 }}>{fmt(mtd)} / {fmt(target)}</Text>
              </View>
              <View style={{ height: 10, backgroundColor: c.surface, borderRadius: 5, overflow: 'hidden' }}>
                <View style={{ height: 10, borderRadius: 5, width: `${targetPct}%` as any,
                  backgroundColor: targetPct >= 100 ? c.success : targetPct >= 70 ? c.primary : c.warning }} />
              </View>
              <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 8 }}>
                {targetPct >= 100 ? tr('🎉 Target achieved — great work!') : tr('{amt} more to hit your goal', { amt: fmt(target - mtd) })}
                {briefing?.forecast && briefing.forecast.historyDays >= 7 && targetPct < 100 ? `  ·  ${tr('Forecast')}: ${fmt(briefing.forecast.projected)}` : ''}
              </Text>
            </Card>
          ) : (
            <TouchableOpacity style={{ backgroundColor: c.surface, borderRadius: 18, padding: 18, borderWidth: 1.5, borderColor: c.border, borderStyle: 'dashed', alignItems: 'center', gap: 6 }}
              onPress={startEditTarget}>
              <MaterialCommunityIcons name="target" size={26} color={c.textMuted} />
              <Text style={{ color: c.textSecondary, fontSize: 14, fontWeight: '700' }}>{tr('Set a monthly goal')}</Text>
              <Text style={{ color: c.textMuted, fontSize: 12 }}>{tr('Track your progress every day')}</Text>
            </TouchableOpacity>
          )}
        </View>}

        {/* Cash register */}
        {showMoney && <View style={{ marginHorizontal: 16, marginBottom: 16 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <SectionLabel style={{ marginBottom: 0 }}>{tr('Cash Register')}</SectionLabel>
            {!editingCash && (
              <TouchableOpacity onPress={startEditCash}>
                <Text style={{ color: c.primary, fontSize: 12.5, fontWeight: '700' }}>{cashReg?.opening > 0 ? tr('Update') : tr('+ Open register')}</Text>
              </TouchableOpacity>
            )}
          </View>

          {editingCash ? (
            <Card>
              <Text style={{ color: c.textSecondary, fontSize: 13, marginBottom: 10 }}>{tr('Opening cash in drawer ({sym})', { sym: currencySymbol })}</Text>
              <TextInput
                ref={cashRef}
                style={{ backgroundColor: c.surface, color: c.text, borderRadius: 12, padding: 14, fontSize: 22, fontWeight: '800', borderWidth: 1.5, borderColor: c.success, marginBottom: 12 }}
                value={cashInput} onChangeText={v => setCashInput(cleanAmountInput(v))}
                placeholder="e.g. 2000" placeholderTextColor={c.textMuted}
                keyboardType="decimal-pad" returnKeyType="done" onSubmitEditing={openCashRegister} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                {CASH_PRESETS.map(v => (
                  <TouchableOpacity key={v}
                    style={{ paddingHorizontal: 13, paddingVertical: 8, borderRadius: 999, backgroundColor: cashInput === v ? c.success : c.successLight }}
                    onPress={() => setCashInput(v)} activeOpacity={0.7}>
                    <Text style={{ color: cashInput === v ? c.onPrimary : c.success, fontWeight: '700', fontSize: 12.5 }}>
                      {currencySymbol}{parseInt(v).toLocaleString(appLocale())}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity style={{ flex: 1, padding: 13, borderRadius: 12, backgroundColor: c.surface, alignItems: 'center' }}
                  onPress={() => { Keyboard.dismiss(); setEditingCash(false); setCashInput(''); }}>
                  <Text style={{ color: c.textSecondary, fontWeight: '700' }}>{tr('Cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={{ flex: 1, padding: 13, borderRadius: 12, backgroundColor: c.success, alignItems: 'center', opacity: savingCash ? 0.6 : 1 }} onPress={openCashRegister} disabled={savingCash}>
                  <Text style={{ color: c.onPrimary, fontWeight: '800' }}>{tr('Open register')}</Text>
                </TouchableOpacity>
              </View>
            </Card>
          ) : (
            <Card padded={false} style={{ overflow: 'hidden' }}>
              {/* 2×2 grid — four amounts in one row truncated on 360dp phones */}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {[
                  { label: tr('Opening'),  val: fmt(cashReg?.opening || 0),  color: c.text,    bg: c.surface },
                  { label: tr('Sales'),    val: fmt(cashReg?.sales || 0),    color: c.success, bg: c.successLight },
                  { label: tr('Expenses'), val: fmt(cashReg?.expenses || 0), color: c.danger,  bg: c.dangerLight },
                  { label: tr('Closing'),  val: fmt(cashReg?.closing || 0),  color: c.primary, bg: c.primaryLight },
                ].map(({ label, val, color, bg }) => (
                  <View key={label} style={{ width: '50%', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 8, backgroundColor: bg }}>
                    <Text style={{ color, fontSize: 16, fontWeight: '900' }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{val}</Text>
                    <Text style={{ color: c.textSecondary, fontSize: 11, fontWeight: '800', marginTop: 3, textTransform: 'uppercase' }} numberOfLines={1}>{label}</Text>
                  </View>
                ))}
              </View>
            </Card>
          )}
        </View>}

        {/* Quick actions */}
        <View style={{ paddingHorizontal: 16 }}>
          <SectionLabel>{tr('Quick Actions')}</SectionLabel>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 8 }}>
            {QUICK.map((a) => (
              <TouchableOpacity key={a.label} style={{ width: '30.7%', aspectRatio: 1, borderRadius: 18, alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.card, borderWidth: 0.5, borderColor: c.borderLight }}
                onPress={a.onPress} activeOpacity={0.8}>
                <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: a.tone + '18', alignItems: 'center', justifyContent: 'center' }}>
                  <MaterialCommunityIcons name={a.icon as any} size={22} color={a.tone} />
                  {a.badge ? (
                    <View style={{ position: 'absolute', top: -6, right: -8, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: c.danger, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: c.onPrimary, fontSize: 11, fontWeight: '900' }}>{a.badge > 99 ? '99+' : a.badge}</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={{ color: c.textSecondary, fontSize: 11.5, fontWeight: '700', textAlign: 'center', paddingHorizontal: 4 }} numberOfLines={2}>{tr(a.label)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Alert sections */}
        <View style={{ paddingHorizontal: 16, marginTop: 10 }}>
          {soonApts.length > 0 && (
            <AlertGroup title={tr("Starting soon")} tone="primary" count={soonApts.length}>
              {soonApts.map((a: any) => {
                const m = minutesUntil(a);
                return (
                  <AlertRow key={a.id}
                    title={a.is_walkin ? tr('Walk-in') : (a.client_name || tr('Client'))}
                    sub={`${m <= 0 ? tr('Starting now') : m >= 60 ? `${tr('In {n}h', { n: Math.floor(m / 60) })}${m % 60 ? ` ${m % 60}m` : ''}` : tr('In {n} min', { n: m })} · ${a.start_time} · ${a.service_names || tr('Services')}${a.staff_name ? ` · ${a.staff_name}` : ''}`}
                    action={a.client_phone && !a.is_walkin ? tr('Message') : tr('View')} tone={a.client_phone && !a.is_walkin ? 'success' : 'primary'}
                    onPress={() => (a.client_phone && !a.is_walkin
                      ? AppointmentReminderService.sendUpcomingReminder(a)
                      : navigation.navigate('Calendar'))} />
                );
              })}
            </AlertGroup>
          )}
          {can('inventory.view') && lowStock.length > 0 && (
            <AlertGroup title={tr("Low stock")} tone="warning" count={lowStock.length} onViewAll={lowStock.length > 3 ? () => navigation.navigate('Inventory') : undefined}>
              {lowStock.slice(0, 3).map((item: any) => (
                <AlertRow key={item.id} title={item.name}
                  sub={tr('{qty} {unit} left · min {min} {unit}', { qty: item.quantity, unit: item.unit, min: item.min_stock })}
                  action={tr('Restock')} tone="warning" onPress={() => navigation.navigate('Inventory')} />
              ))}
            </AlertGroup>
          )}
          {can('inventory.view') && expiringProds.length > 0 && (
            <AlertGroup title={tr("Expiring soon")} tone="warning" count={expiringProds.length}>
              {expiringProds.map((item: any) => (
                <AlertRow key={item.id} title={item.name} sub={tr('Expires {date} · {qty} {unit}', { date: item.expiry_date, qty: item.quantity, unit: item.unit })}
                  action={tr('View')} tone="warning" onPress={() => navigation.navigate('Inventory')} />
              ))}
            </AlertGroup>
          )}
          {lapsed30.length > 0 && (
            <AlertGroup title={tr('Re-engage clients ({n}+ days)', { n: reengageDays })} tone="info" count={lapsed30.length}>
              {lapsed30.map((cl: any) => (
                <AlertRow key={cl.id} title={cl.name}
                  sub={tr('Last visit {date}', { date: cl.last_visit ? parseDbDate(cl.last_visit).toLocaleDateString(activeLocale()) : tr('never') })}
                  action={tr('Message')} tone="success" onPress={() => reactivateClient(cl)} />
              ))}
            </AlertGroup>
          )}
          {reminders.length > 0 && (
            <AlertGroup title={tr("Reminders due")} tone="primary" count={reminders.length}>
              {reminders.map((rem: any) => (
                <AlertRow key={rem.id} title={rem.client_name || 'Client'} sub={`${rem.service_name} · ${tr('due {date}', { date: rem.remind_date })}`}
                  action={tr('Send')} tone="primary" onPress={() => sendReminder(rem)} />
              ))}
            </AlertGroup>
          )}
          {birthdays.length > 0 && (
            <AlertGroup title={tr("Upcoming birthdays")} tone="accent" count={birthdays.length}>
              {birthdays.map((cl: any) => (
                <AlertRow key={cl.id} title={cl.name} sub={tr('Birthday {date}', { date: cl.date_of_birth?.slice(5) })}
                  action={tr('Wish')} tone="warning" onPress={() => sendWish(cl, 'birthday')} />
              ))}
            </AlertGroup>
          )}
          {anniversaries.length > 0 && (
            <AlertGroup title={tr("Upcoming anniversaries")} tone="accent" count={anniversaries.length}>
              {anniversaries.map((cl: any) => (
                <AlertRow key={cl.id} title={cl.name} sub={tr('Anniversary {date}', { date: cl.anniversary?.slice(5) })}
                  action={tr('Wish')} tone="danger" onPress={() => sendWish(cl, 'anniversary')} />
              ))}
            </AlertGroup>
          )}
        </View>
      </ScrollView>
    </SafeScreen>
  );
}

function EntryTile({ icon, tone, toneBg, title, sub, highlight, onPress }: {
  icon: string; tone: string; toneBg: string; title: string; sub: string; highlight?: boolean; onPress: () => void;
}) {
  const { colors: c } = useTheme();
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} accessibilityRole="button"
      style={{ flex: 1, borderRadius: 18, padding: 14, backgroundColor: c.card, borderWidth: highlight ? 1.5 : 0.5, borderColor: highlight ? tone : c.borderLight, minHeight: 96 }}>
      <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: toneBg, alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
        <MaterialCommunityIcons name={icon as any} size={21} color={tone} />
      </View>
      <Text style={{ color: c.text, fontSize: 14, fontWeight: '800' }} numberOfLines={1}>{title}</Text>
      <Text style={{ color: highlight ? tone : c.textMuted, fontSize: 12, fontWeight: highlight ? '800' : '600', marginTop: 2 }} numberOfLines={2}>{sub}</Text>
    </TouchableOpacity>
  );
}

function AlertGroup({ title, tone, count, children, onViewAll }: any) {
  const { colors: c } = useTheme();
  return (
    <View style={{ marginBottom: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <SectionLabel style={{ marginBottom: 0 }}>{title}</SectionLabel>
        <Pill label={String(count)} tone={tone} />
        <View style={{ flex: 1 }} />
        {onViewAll && <TouchableOpacity onPress={onViewAll}><Text style={{ color: c.primary, fontSize: 12.5, fontWeight: '700' }}>{tr('View all')}</Text></TouchableOpacity>}
      </View>
      <Card padded={false}>{children}</Card>
    </View>
  );
}

function AlertRow({ title, sub, action, tone, onPress }: any) {
  const { colors: c } = useTheme();
  const toneFg: Record<string, string> = { primary: c.primary, success: c.success, warning: c.warning, danger: c.danger, info: c.info };
  const fg = toneFg[tone] || c.primary;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', padding: 14, gap: 10, borderBottomWidth: 0.5, borderBottomColor: c.divider }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.text, fontSize: 14, fontWeight: '700' }} numberOfLines={1}>{title}</Text>
        <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 2 }} numberOfLines={2}>{sub}</Text>
      </View>
      <TouchableOpacity onPress={onPress} style={{ backgroundColor: fg + '18', paddingHorizontal: 13, paddingVertical: 7, borderRadius: 999 }}>
        <Text style={{ color: fg, fontSize: 12, fontWeight: '800' }}>{action}</Text>
      </TouchableOpacity>
    </View>
  );
}
