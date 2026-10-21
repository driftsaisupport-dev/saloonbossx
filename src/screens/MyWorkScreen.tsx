import React, { useState, useCallback, useContext } from 'react';
import { View, ScrollView, TouchableOpacity, Alert, RefreshControl, StyleSheet } from 'react-native';
import { Text } from '../theme/Text';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { TabScreen as SafeScreen } from '../components/SafeScreen';
import { showError } from '../components/formUtils';
import { useTr } from '../i18n/tr';
import { AppBar, Card, StatCard, SectionLabel } from '../components/UI';
import { useTheme } from '../context/ThemeContext';
import { AppContext } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { DatabaseService, DBX } from '../database/Database';
import { todayLocal, formatTime, getGreeting } from '../utils/helpers';
import { appLocale } from '../config/regions';

export default function MyWorkScreen() {
  const { colors: c } = useTheme();
  const navigation = useNavigation<any>();
  const { user, can, lock, logout } = useAuth();
  const tr = useTr();
  const { currencySymbol } = useContext(AppContext);

  const [appts, setAppts] = useState<any[]>([]);
  const [att, setAtt] = useState<any>(null);
  const [perf, setPerf] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [queueWaiting, setQueueWaiting] = useState<number | null>(null);

  const staffId = user?.staffId || 0;

  const load = useCallback(async () => {
    // Queue count is shown even for logins without a staff record.
    if (can('queue.manage')) DBX.queueStats().then(st => setQueueWaiting(st?.waiting ?? 0)).catch(() => setQueueWaiting(null));
    if (!staffId) { setAppts([]); return; }
    try {
      await DatabaseService.ensureReady();
      const today = todayLocal();
      const d = new Date();
      const monthStart = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
      const [a, todayAtt, perfRows] = await Promise.all([
        (DatabaseService as any).getStaffDayAppointments(staffId, today),
        (DatabaseService as any).getTodayAttendance(),
        DatabaseService.getStaffPerformance(monthStart, today),
      ]);
      setAppts(a as any[]);
      setAtt((todayAtt as any[]).find(r => r.staff_id === staffId) || null);
      setPerf((perfRows as any[]).find(r => r.id === staffId) || null);
    } catch (e) { console.warn('MyWork load:', e); }
  }, [staffId, can]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function checkIn() {
    setBusy(true);
    try {
      const r = await (DatabaseService as any).staffCheckIn(staffId, { username: user?.username }, 'self');
      Alert.alert(r?.success ? `✅ ${tr('Checked in')}` : tr('Note'), tr(r?.message || ''));
      await load();
    } catch (e) { showError(e, 'Check-in failed'); }
    finally { setBusy(false); }
  }
  async function checkOut() {
    setBusy(true);
    try {
      const r = await (DatabaseService as any).staffCheckOut(staffId, { username: user?.username }, 'self');
      Alert.alert(r?.success ? `🚪 ${tr('Checked out')}` : tr('Note'), tr(r?.message || ''));
      await load();
    } catch (e) { showError(e, 'Check-out failed'); }
    finally { setBusy(false); }
  }

  const statusColor = att?.status === 'present' ? c.success : att?.status === 'half_day' ? c.warning : att?.status === 'absent' ? c.danger : c.textMuted;
  const showPay = can('staff.payroll') || can('attendance.self');

  return (
    <SafeScreen>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={c.primary} />}>
        <AppBar
          subtitle={getGreeting()}
          title={user?.displayName || tr('My Work')}
          right={
            <TouchableOpacity accessibilityLabel={tr('Account')} onPress={() => Alert.alert(tr('Account'), user?.displayName || '', [
              { text: tr('Cancel'), style: 'cancel' },
              { text: tr('Lock app'), onPress: lock },
              { text: tr('Sign out'), style: 'destructive', onPress: () => { logout().catch(e => showError(e, 'Could not sign out')); } },
            ])} style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }}>
              <MaterialCommunityIcons name="account-circle-outline" size={22} color={c.primary} />
            </TouchableOpacity>
          }
        />

        {/* Big, obvious New Bill for staff who may bill */}
        {can('billing.create') && (
          <TouchableOpacity onPress={() => navigation.navigate('Billing', { reset: true })} activeOpacity={0.85} accessibilityRole="button"
            style={{ marginHorizontal: 16, marginBottom: 16, backgroundColor: c.primary, borderRadius: 18, paddingVertical: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <MaterialCommunityIcons name="receipt-text-plus-outline" size={26} color={c.onPrimary} />
            <Text style={{ color: c.onPrimary, fontSize: 18, fontWeight: '900' }}>{tr('New Bill')}</Text>
          </TouchableOpacity>
        )}

        {/* Walk-in queue for barbers / front desk */}
        {can('queue.manage') && (
          <TouchableOpacity onPress={() => navigation.navigate('Queue')} activeOpacity={0.85} accessibilityRole="button"
            style={{ marginHorizontal: 16, marginBottom: 16, backgroundColor: c.card, borderRadius: 18, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: c.borderLight }}>
            <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: c.warningLight, alignItems: 'center', justifyContent: 'center' }}>
              <MaterialCommunityIcons name="ticket-confirmation-outline" size={24} color={c.warning} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.text, fontSize: 16, fontWeight: '800' }}>{tr('Walk-in queue')}</Text>
              <Text style={{ color: c.textMuted, fontSize: 12.5, marginTop: 2 }}>
                {queueWaiting == null ? tr('Tokens for walk-in customers') : queueWaiting === 0 ? tr('No one waiting') : tr('{n} waiting', { n: queueWaiting })}
              </Text>
            </View>
            {queueWaiting ? (
              <View style={{ minWidth: 30, height: 30, borderRadius: 15, paddingHorizontal: 8, backgroundColor: c.warning, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: c.onPrimary, fontWeight: '900' }}>{queueWaiting}</Text>
              </View>
            ) : null}
            <MaterialCommunityIcons name="chevron-right" size={22} color={c.textLight} />
          </TouchableOpacity>
        )}

        {!staffId && (
          <View style={{ marginHorizontal: 16, marginBottom: 16 }}>
            <Card><Text style={{ color: c.textMuted, fontSize: 13 }}>
              {tr('Your login isn’t linked to a staff record yet. Ask the owner to link it in Settings → Users & Access.')}
            </Text></Card>
          </View>
        )}

        {/* Attendance */}
        {can('attendance.self') && staffId > 0 && (
          <View style={{ marginHorizontal: 16, marginBottom: 16 }}>
            <SectionLabel>{tr('My attendance today')}</SectionLabel>
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: statusColor }} />
                <Text style={{ color: c.text, fontWeight: '800', fontSize: 15, textTransform: 'capitalize' }}>
                  {att ? (att.status === 'half_day' ? 'Half day' : att.status) : 'Not checked in'}
                </Text>
              </View>
              {att && (
                <Text style={{ color: c.textMuted, fontSize: 12.5, marginTop: 6 }}>
                  In: {formatTime(att.check_in) || '—'}   ·   Out: {att.check_out ? formatTime(att.check_out) : 'still in'}
                  {att.hours_worked ? `   ·   ${Number(att.hours_worked).toFixed(1)}h` : ''}
                </Text>
              )}
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                {!att?.check_in && (
                  <TouchableOpacity disabled={busy} style={{ flex: 1, backgroundColor: c.successLight, borderRadius: 12, paddingVertical: 12, alignItems: 'center' }} onPress={checkIn}>
                    <Text style={{ color: c.success, fontWeight: '800' }}>✅ Check in</Text>
                  </TouchableOpacity>
                )}
                {att?.check_in && !att?.check_out && (
                  <TouchableOpacity disabled={busy} style={{ flex: 1, backgroundColor: c.dangerLight, borderRadius: 12, paddingVertical: 12, alignItems: 'center' }} onPress={checkOut}>
                    <Text style={{ color: c.danger, fontWeight: '800' }}>🚪 Check out</Text>
                  </TouchableOpacity>
                )}
                {att?.check_out && (
                  <Text style={{ color: c.textMuted, fontSize: 12.5, flex: 1, textAlign: 'center', paddingVertical: 12 }}>Done for today 👍</Text>
                )}
              </View>
            </Card>
          </View>
        )}

        {/* This month */}
        <View style={{ marginHorizontal: 16, marginBottom: 8 }}>
          <SectionLabel>{tr('My month so far')}</SectionLabel>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            <StatCard icon="receipt-text-outline" label={tr('Bills')} value={String(perf?.total_bills || 0)} tone="primary" />
            {showPay
              ? <StatCard icon="cash-multiple" label={tr('My commission')} value={`${currencySymbol}${Math.round(perf?.commission_earned || 0).toLocaleString(appLocale())}`} tone="success" />
              : <StatCard icon="star-outline" label={tr('Revenue handled')} value={perf ? `${currencySymbol}${Math.round(perf.total_revenue || 0).toLocaleString(appLocale())}` : '—'} tone="success" />}
          </View>
          {showPay && (
            <TouchableOpacity style={{ marginTop: 4, backgroundColor: c.surface, borderRadius: 12, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 10 }}
              onPress={() => navigation.navigate('StaffPaySlip')}>
              <MaterialCommunityIcons name="file-document-outline" size={19} color={c.primary} />
              <Text style={{ color: c.primary, fontWeight: '700', fontSize: 13 }}>{tr('Generate my pay slip')}</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Today's appointments */}
        <View style={{ marginHorizontal: 16, marginTop: 12 }}>
          <SectionLabel>{tr('My appointments today')}</SectionLabel>
          {appts.length === 0 ? (
            <Card><Text style={{ color: c.textMuted, fontSize: 13 }}>No appointments booked for you today.</Text></Card>
          ) : appts.map(a => (
            <Card key={a.id}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: c.text, fontWeight: '800', fontSize: 14 }}>{a.client_name || 'Walk-in'}</Text>
                <Text style={{ color: c.primary, fontWeight: '800', fontSize: 13 }}>{formatTime(a.start_time)}</Text>
              </View>
              <Text style={{ color: c.textMuted, fontSize: 12.5, marginTop: 4 }}>
                {a.service_names || 'Service'}   ·   {formatTime(a.start_time)}–{formatTime(a.end_time)}
              </Text>
              <Text style={{ color: c.textLight, fontSize: 11.5, marginTop: 2, textTransform: 'capitalize' }}>{a.status}</Text>
            </Card>
          ))}
        </View>
      </ScrollView>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({});
