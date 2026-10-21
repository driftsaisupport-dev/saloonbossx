import React, { useCallback, useState } from 'react';
import { View, TouchableOpacity, ActivityIndicator, Alert, Share } from 'react-native';
import { Text } from '../theme/Text';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { DBX } from '../database/Database';
import { BranchSyncService } from '../services/BranchSyncService';
import { BookingService } from '../services/BookingService';
import { FeatureGate } from '../utils/featureGate';
import { tr } from '../i18n/tr';

/**
 * "Set up your salon" checklist on the owner's home screen. Every step is
 * detected from real data, so it ticks itself — and disappears when done.
 */
type Step = { key: string; title: string; sub: string; done: boolean; route?: string; params?: any; action?: () => Promise<void> };

export function GettingStarted() {
  const { colors: c } = useTheme();
  const nav = useNavigation<any>();
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [hidden, setHidden] = useState(true);
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState('');
  const [tick, setTick] = useState(0);

  useFocusEffect(useCallback(() => {
    (async () => {
      try {
        const [h, p, n, cloud, booking, pro, isDemo, rk] = await Promise.all([
          DBX.getSetting('setup_hidden'), DBX.getSalonProfile() as Promise<any>, DBX.setupCounts(), BranchSyncService.getConfig(),
          BookingService.getConfig(), FeatureGate.canAccess('hasOnlineBooking'), DBX.getSetting('demo_mode'), DBX.getSetting('cloud_recovery_saved'),
        ]);
        const oneTap = BranchSyncService.hostedAvailable();
        const review = await DBX.getSetting('google_review_url').catch(() => '');
        if (h === 'true' || isDemo === 'true') { setHidden(true); return; }
        const list: Step[] = [
          { key: 'profile', title: tr('Salon details & logo'), sub: tr('Name, phone, address — shown on every bill'), done: !!(p?.name && p.name !== 'My Salon' && p?.phone && p?.address), route: 'Main', params: { screen: 'Settings' } },
          { key: 'upi', title: tr('UPI ID for QR payments'), sub: tr('Customers scan and pay the exact amount'), done: !!p?.upi_id, route: 'Main', params: { screen: 'Settings' } },
          { key: 'services', title: tr('Check your services & prices'), sub: tr('{n} services added', { n: n.services }), done: n.services >= 3, route: 'Services' },
          { key: 'clients', title: tr('Add your existing customers'), sub: tr('Import from phone contacts or Excel'), done: n.clients >= 10, route: 'ImportClients' },
          ...(n.staff > 1 ? [{ key: 'staff', title: tr('Give staff their own login'), sub: tr('Each staff gets a PIN; you control what they see'), done: n.users > 1, route: 'Users' }] : []),
          oneTap
            ? { key: 'cloud', title: tr('Turn on free cloud backup'), sub: tr('One tap · phone lost? Data is safe'), done: !!cloud, action: async () => {
                await BranchSyncService.enableCloud();
                Alert.alert(tr('Cloud is ON ✅'), tr('Next: save your recovery key on WhatsApp.'));
              } }
            : { key: 'cloud', title: tr('Turn on free Google Drive backup'), sub: tr('Phone lost? Data is safe'), done: !!cloud, route: 'BranchHub' },
          ...(cloud?.isHQ ? [{ key: 'recovery', title: tr('Save your recovery key'), sub: tr('On WhatsApp to yourself — for a lost phone'), done: !!rk, action: async () => {
                const code = await BranchSyncService.joinCode();
                await Share.share({ message: `🔐 SaloonBossX recovery key\n\nIf this phone is lost: install SaloonBossX → Settings → Branches & Cloud → "Join / new phone" → paste this key.\n\n${code}` });
                await DBX.setSetting('cloud_recovery_saved', String(Date.now()));
              } }] : []),
          ...(pro ? [{ key: 'booking', title: tr('Start online booking'), sub: tr('One tap · link + QR for WhatsApp, Instagram, Maps'), done: booking.enabled,
            ...(oneTap || cloud ? { action: async () => {
              const link = await BookingService.quickStart();
              Alert.alert(tr('Online booking is live ✅'), link, [{ text: 'OK' }, { text: tr('Share link'), onPress: () => { Share.share({ message: `Book your appointment online 💇‍♀️\n${link}` }).catch(() => {}); } }]);
            } } : { route: 'OnlineBooking' }) }] : []),
          { key: 'review', title: tr('Add your Google review link'), sub: tr('Every bill asks happy customers for 5 stars'), done: !!review, route: 'BillDesign' },
          { key: 'bill', title: tr('Make your first bill'), sub: tr('About 10 seconds'), done: n.bills > 0, route: 'Billing' },
        ];
        setSteps(list);
        setHidden(list.every(s => s.done));
      } catch { setHidden(true); }
    })();
  }, [tick]));

  async function runStep(s: Step) {
    if (s.action) {
      setWorking(s.key);
      try { await s.action(); }
      catch (e: any) {
        if (e?.message === 'NEEDS_OWN_CLOUD') nav.navigate('OnlineBooking');
        else Alert.alert(tr('Not done yet'), `${e?.message || 'No internet.'}\n\n${tr('Check the internet and tap again.')}`);
      } finally { setWorking(''); setTick(t => t + 1); }
      return;
    }
    if (s.route) nav.navigate(s.route, s.params);
  }

  if (hidden || !steps) return null;
  const done = steps.filter(s => s.done).length;
  const next = steps.find(s => !s.done);
  const pct = Math.round((done / steps.length) * 100);

  return (
    <View style={{ marginHorizontal: 16, marginBottom: 16, backgroundColor: c.card, borderRadius: 20, padding: 16, borderWidth: 1, borderColor: c.primary + '33' }}>
      <TouchableOpacity activeOpacity={0.8} onPress={() => setOpen(o => !o)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <MaterialCommunityIcons name="rocket-launch-outline" size={22} color={c.primary} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.text, fontWeight: '900', fontSize: 15 }}>{tr('Set up your salon')} · {done}/{steps.length}</Text>
          <View style={{ height: 6, backgroundColor: c.surface, borderRadius: 3, marginTop: 6, overflow: 'hidden' }}>
            <View style={{ width: `${pct}%` as any, height: 6, backgroundColor: c.primary }} />
          </View>
        </View>
        <MaterialCommunityIcons name={open ? 'chevron-up' : 'chevron-down'} size={22} color={c.textMuted} />
      </TouchableOpacity>

      {(open ? steps : next ? [next] : []).map(s => (
        <TouchableOpacity key={s.key} disabled={s.done || !!working} onPress={() => runStep(s)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, marginTop: 4, borderTopWidth: 0.5, borderTopColor: c.divider }}>
          <MaterialCommunityIcons name={s.done ? 'check-circle' : 'circle-outline'} size={22} color={s.done ? c.success : c.primary} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: s.done ? c.textMuted : c.text, fontWeight: '700', textDecorationLine: s.done ? 'line-through' : 'none' }}>{s.title}</Text>
            {!s.done && <Text style={{ color: c.textMuted, fontSize: 12 }}>{s.sub}</Text>}
          </View>
          {!s.done && (working === s.key ? <ActivityIndicator color={c.primary} /> : s.action
            ? <View style={{ backgroundColor: c.primary, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 }}><Text style={{ color: c.onPrimary, fontWeight: '800', fontSize: 12 }}>{s.key === 'recovery' ? tr('Save') : tr('Turn on')}</Text></View>
            : <MaterialCommunityIcons name="chevron-right" size={20} color={c.primary} />)}
        </TouchableOpacity>
      ))}
      {open && (
        <TouchableOpacity onPress={() => { DBX.setSetting('setup_hidden', 'true'); setHidden(true); }} style={{ marginTop: 8 }}>
          <Text style={{ color: c.textMuted, fontSize: 12, textAlign: 'center' }}>{tr('Hide this checklist')}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
