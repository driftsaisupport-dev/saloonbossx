import React, { useState, useCallback, useContext, useRef } from 'react';
import { View, FlatList, TouchableOpacity, Alert, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { Text, TextInput } from '../theme/Text';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeScreen } from '../components/SafeScreen';
import { ScreenHeader, SegmentedTabs, Chip, Avatar, BottomSheet, Button, EmptyState } from '../components/UI';
import { useTheme } from '../context/ThemeContext';
import { AppContext } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { DatabaseService } from '../database/Database';
import { csvRow } from '../utils/sanitize';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useTr } from '../i18n/tr';
import {
  localDateStr, parseAmount, cleanAmountInput, normaliseIndianPhone, isValidDateStr, isValidTime, timeToMin,
  showError, confirmAsync,
} from '../components/formUtils';
import { DateField, TimeField } from '../components/DateTimePicker';
import { useChoiceSheet } from '../components/ChoiceSheet';
import { appLocale, phoneHint, curSym } from '../config/regions';

const FS_DOC_DIR = (FileSystem as any).documentDirectory ?? (FileSystem as any).cacheDirectory ?? '';
const FS_UTF8 = (FileSystem as any).EncodingType?.UTF8 ?? 'utf8';

const ROLES = ['Owner', 'Manager', 'Senior Stylist', 'Stylist', 'Junior Stylist', 'Colorist', 'Nail Tech', 'Receptionist', 'Helper'];
const STATUSES = ['present', 'half_day', 'absent', 'leave'] as const;

type AttPeriod = 'today' | 'week' | 'month' | '3months' | '6months' | 'year';

function getAttRange(p: AttPeriod): { start: string; end: string; label: string } {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const today = localDateStr(now);
  if (p === 'today') return { start: today, end: today, label: 'Today' };
  if (p === 'week') { const s = new Date(now); s.setDate(s.getDate() - 6); return { start: localDateStr(s), end: today, label: 'Last 7 Days' }; }
  if (p === 'month') return { start: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`, end: today, label: 'This Month' };
  if (p === '3months') { const s = new Date(now); s.setMonth(s.getMonth() - 3); return { start: localDateStr(s), end: today, label: 'Last 3 Months' }; }
  if (p === '6months') { const s = new Date(now); s.setMonth(s.getMonth() - 6); return { start: localDateStr(s), end: today, label: 'Last 6 Months' }; }
  return { start: `${now.getFullYear()}-01-01`, end: today, label: 'This Year' };
}

const emptyForm = () => ({ name: '', phone: '', role: 'Stylist', commission_rate: '10', salary: '', pin_code: '', required_hours: '8', salary_type: 'commission' });

export default function StaffScreen() {
  const { colors: c } = useTheme();
  const tr = useTr();
  const navigation = useNavigation<any>();
  const { currencySymbol } = useContext(AppContext);
  const { user, can } = useAuth();
  const canManageStaff = can('staff.manage');
  const canPayroll = can('staff.payroll');
  const canManageAtt = can('attendance.manage');
  const canSelf = can('attendance.self');
  const choice = useChoiceSheet();

  const [staff,      setStaff]      = useState<any[]>([]);
  const [attRecords, setAttRecords] = useState<any[]>([]);
  const [showAdd,    setShowAdd]    = useState(false);
  const [editing,    setEditing]    = useState<any>(null);
  const [form,       setForm]       = useState(emptyForm());
  const [saving,     setSaving]     = useState(false);
  const [tab,        setTab]        = useState<'staff' | 'attendance'>('staff');
  const [attPeriod,  setAttPeriod]  = useState<AttPeriod>('today');
  const [showManual, setShowManual] = useState(false);
  const [manualForm, setManualForm] = useState({ staff_id: '', date: localDateStr(), check_in: '09:00', check_out: '18:00', status: 'present' });
  const [manualSaving, setManualSaving] = useState(false);
  const [perfMonth,  setPerfMonth]  = useState<any[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [attLoading, setAttLoading] = useState(false);
  const [exporting,  setExporting]  = useState(false);
  const [rowBusy,    setRowBusy]    = useState<number | null>(null);

  // The focus effect is created once; read the period through a ref so a
  // return to this screen reloads the period the chip shows (was: always Today).
  const periodRef = useRef<AttPeriod>('today');
  periodRef.current = attPeriod;

  const loadAttendance = useCallback(async (period: AttPeriod) => {
    setAttLoading(true);
    try {
      const { start, end } = getAttRange(period);
      const records = period === 'today'
        ? await DatabaseService.getTodayAttendance() as any[]
        : await DatabaseService.getAttendanceByRange(start, end) as any[];
      if (periodRef.current === period) setAttRecords(records || []);
    } catch (e) { showError(e, 'Could not load attendance'); }
    finally { setAttLoading(false); }
  }, []);

  const load = useCallback(async () => {
    try {
      const [s, perf] = await Promise.allSettled([
        DatabaseService.getStaff(),
        (() => {
          const today = new Date();
          const start = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
          return DatabaseService.getStaffPerformance(start, localDateStr(today));
        })(),
      ]);
      if (s.status === 'fulfilled') setStaff((s.value as any[]) || []);
      else showError(s.reason, 'Could not load staff');
      if (perf.status === 'fulfilled') setPerfMonth((perf.value as any[]) || []);
      await loadAttendance(periodRef.current);
    } finally { setLoading(false); }
  }, [loadAttendance]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function changePeriod(p: AttPeriod) {
    setAttPeriod(p);
    periodRef.current = p;
    loadAttendance(p);
  }

  function openNew() { if (!canManageStaff) return; setEditing(null); setForm(emptyForm()); setShowAdd(true); }
  function openEdit(item: any) {
    if (!canManageStaff) return;
    setEditing(item);
    setForm({ name: item.name, phone: item.phone || '', role: item.role, commission_rate: String(item.commission_rate ?? 0), salary: String(item.salary || 0), pin_code: item.pin_code || '', required_hours: String(item.required_hours || 8), salary_type: item.salary_type || 'commission' });
    setShowAdd(true);
  }

  async function save() {
    if (saving || !canManageStaff) return;
    if (!form.name.trim()) { Alert.alert(tr('Name needed'), tr('Staff name is required.')); return; }
    const phone = form.phone.trim() ? normaliseIndianPhone(form.phone) : '';
    if (form.phone.trim() && !phone) { Alert.alert(tr('Check the number'), `${phoneHint()} ${tr('Or leave it empty.')}`); return; }
    // Pay fields: keep what is stored when this user cannot see payroll.
    const rate = canPayroll ? parseAmount(form.commission_rate || '0') : Number(editing?.commission_rate ?? 10);
    if (isNaN(rate) || rate > 100) { Alert.alert(tr('Check commission'), tr('Commission rate must be between 0 and 100.')); return; }
    const salary = canPayroll ? (form.salary.trim() ? parseAmount(form.salary) : 0) : Number(editing?.salary || 0);
    if (isNaN(salary)) { Alert.alert(tr('Check salary'), tr('Salary must be a number that is 0 or more.')); return; }
    const pin = form.pin_code.trim();
    if (pin && !/^\d{4}$/.test(pin)) { Alert.alert(tr('Check PIN'), tr('Check-in PIN must be exactly 4 digits.')); return; }
    if (pin) {
      const clash = staff.find(s => s.pin_code === pin && s.id !== editing?.id);
      if (clash) { Alert.alert(tr('PIN already used'), tr('{name} already uses this check-in PIN. Pick a different one.', { name: clash.name })); return; }
    }
    setSaving(true);
    try {
      const data = {
        ...form, name: form.name.trim(), phone, pin_code: pin, commission_rate: rate, salary,
        required_hours: parseInt(form.required_hours) || 8,
        salary_type: canPayroll ? (form.salary_type || 'commission') : (editing?.salary_type || form.salary_type || 'commission'),
      };
      if (editing) await DatabaseService.updateStaff(editing.id, data);
      else await DatabaseService.addStaff(data);
      setShowAdd(false);
      load();
    } catch (e) { showError(e, 'Staff not saved'); }
    finally { setSaving(false); }
  }

  async function deactivate(item: any) {
    if (!canManageStaff) return;
    const ok = await confirmAsync('Deactivate staff', tr('Remove {name} from active staff? Their history will be preserved.', { name: item.name }), 'Deactivate', true);
    if (!ok) return;
    try { await DatabaseService.updateStaff(item.id, { is_active: 0 }); load(); }
    catch (e) { showError(e, 'Could not deactivate'); }
  }

  function openStaffMenu(item: any) {
    choice.open({
      title: item.name,
      options: [
        { label: tr('Edit details'), icon: 'pencil-outline', onPress: () => openEdit(item) },
        ...(canPayroll ? [{ label: tr('Pay slip'), icon: 'file-document-outline', onPress: () => navigation.navigate('StaffPaySlip', { staffId: item.id }) }] : []),
        { label: tr('Deactivate'), icon: 'account-off-outline', tone: 'danger' as const, onPress: () => deactivate(item) },
      ],
    });
  }

  const canMarkFor = (staffId: number) => canManageAtt || (canSelf && !!user?.staffId && user.staffId === staffId);

  async function checkIn(staffId: number) {
    if (rowBusy) return;
    setRowBusy(staffId);
    try {
      const r = await (DatabaseService as any).staffCheckIn(staffId, { username: user?.username }, canManageAtt && user?.staffId !== staffId ? 'manual' : 'self');
      Alert.alert(r?.success ? `✅ ${tr('Checked in')}` : tr('Already done'), tr(r?.message || ''));
      loadAttendance(periodRef.current);
    } catch (e) { showError(e, 'Check-in failed'); }
    finally { setRowBusy(null); }
  }

  async function checkOut(staffId: number) {
    if (rowBusy) return;
    setRowBusy(staffId);
    try {
      // Policy-aware checkout — status decided by the owner's Attendance Rules.
      const r = await (DatabaseService as any).staffCheckOut(staffId, { username: user?.username }, canManageAtt && user?.staffId !== staffId ? 'manual' : 'self');
      const icon = r?.status === 'present' ? '✅' : r?.status === 'absent' ? '⚠️' : '⏰';
      Alert.alert(r?.success ? `${icon} ${tr('Checked out')}` : tr('Note'),
        tr(r?.message || 'Checked out.') + (r?.review ? `\n\n${tr('Flagged for your review in Settings → Attendance Rules.')}` : ''));
      loadAttendance(periodRef.current);
    } catch (e) { showError(e, 'Check-out failed'); }
    finally { setRowBusy(null); }
  }

  const statusLabel = (st: string) => st === 'half_day' ? tr('Half day') : st === 'present' ? tr('Present') : st === 'absent' ? tr('Absent') : st === 'leave' ? tr('Leave') : tr(st || 'Not recorded');

  function overrideStatus(rec: any) {
    if (!canManageAtt) return;
    choice.open({
      title: tr('Set attendance'),
      message: `${rec.staff_name} · ${rec.date}`,
      options: STATUSES.map(st => ({
        label: statusLabel(st),
        icon: st === 'present' ? 'check-circle' : st === 'half_day' ? 'circle-half-full' : st === 'absent' ? 'close-circle' : 'beach',
        tone: st === 'present' ? 'success' as const : st === 'absent' ? 'danger' as const : st === 'leave' ? 'info' as const : 'warning' as const,
        selected: rec.status === st,
        onPress: async () => {
          try {
            await (DatabaseService as any).setAttendanceStatus(rec.staff_id, rec.date, st, { username: user?.username });
            loadAttendance(periodRef.current);
          } catch (e) { showError(e, 'Attendance not changed'); }
        },
      })),
    });
  }

  async function saveManual() {
    if (manualSaving) return;
    const f = manualForm;
    if (!f.staff_id) { Alert.alert(tr('Pick staff'), tr('Select a staff member.')); return; }
    if (!isValidDateStr(f.date)) { Alert.alert(tr('Check the date'), tr('Pick a date from the calendar.')); return; }
    if (f.date > localDateStr()) { Alert.alert(tr('Check the date'), tr('Attendance cannot be recorded for a future date.')); return; }
    const needsTimes = f.status === 'present' || f.status === 'half_day';
    if (needsTimes) {
      if (!isValidTime(f.check_in)) { Alert.alert(tr('Check-in time needed'), tr('Pick the check-in time.')); return; }
      if (f.check_out && !isValidTime(f.check_out)) { Alert.alert(tr('Check-out time'), tr('Pick a valid check-out time.')); return; }
      if (f.check_out && timeToMin(f.check_out) <= timeToMin(f.check_in)) {
        Alert.alert(tr('Check the times'), tr('Check-out must be after check-in.')); return;
      }
    }
    setManualSaving(true);
    try {
      await DatabaseService.manualAttendance(parseInt(f.staff_id), f.date, needsTimes ? f.check_in : '', needsTimes ? f.check_out : '', f.status, { username: user?.username });
      setShowManual(false);
      loadAttendance(periodRef.current);
      Alert.alert(`✅ ${tr('Saved')}`, tr('Attendance recorded.'));
    } catch (e) { showError(e, 'Attendance not saved'); }
    finally { setManualSaving(false); }
  }

  async function shareCsv(fileName: string, csv: string, title: string) {
    const path = FS_DOC_DIR + fileName;
    await FileSystem.writeAsStringAsync(path, csv, { encoding: FS_UTF8 });
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(path, { mimeType: 'text/csv', dialogTitle: title });
    else Alert.alert(tr('Saved'), tr('Report saved on the phone.'));
  }

  async function exportAttendance() {
    if (exporting) return;
    setExporting(true);
    try {
      const { start, end, label } = getAttRange(attPeriod);
      const records = await DatabaseService.getAttendanceByRange(start, end) as any[];
      const lines: string[] = [`SaloonBossX Attendance Report — ${label} (${start} to ${end})`, ''];
      lines.push(csvRow(['Staff Name', 'Role', 'Date', 'Check In', 'Check Out', 'Status', 'Notes']));
      records.forEach((r: any) => lines.push(csvRow([r.staff_name, r.role || '', r.date, r.check_in || '', r.check_out || '', r.status, r.notes || ''])));
      const summary: Record<string, { present: number; absent: number; half: number; leave: number }> = {};
      records.forEach((r: any) => {
        const s = (summary[r.staff_name] ||= { present: 0, absent: 0, half: 0, leave: 0 });
        if (r.status === 'present') s.present++;
        else if (r.status === 'absent') s.absent++;
        else if (r.status === 'half_day') s.half++;
        else if (r.status === 'leave') s.leave++;
      });
      lines.push('', 'ATTENDANCE SUMMARY', csvRow(['Staff Name', 'Present', 'Absent', 'Half Day', 'Leave', 'Total Days']));
      Object.entries(summary).forEach(([name, s]) => lines.push(csvRow([name, s.present, s.absent, s.half, s.leave, s.present + s.absent + s.half + s.leave])));
      await shareCsv(`SaloonBossX_Attendance_${label.replace(/\s+/g, '_')}_${start}.csv`, '﻿' + lines.join('\n'), `Attendance Report — ${label}`);
    } catch (e) { showError(e, 'Export failed'); }
    finally { setExporting(false); }
  }

  async function exportPerformance() {
    if (exporting) return;
    setExporting(true);
    try {
      const today = new Date();
      const start = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
      const csv = await DatabaseService.exportStaffPerformanceCSV(start, localDateStr(today));
      await shareCsv(`Staff_Performance_${today.getFullYear()}_${String(today.getMonth() + 1).padStart(2, '0')}.csv`, csv, 'Staff Performance Export');
    } catch (e) { showError(e, 'Export failed'); }
    finally { setExporting(false); }
  }

  const perfMap: Record<number, any> = {};
  perfMonth.forEach(p => { perfMap[p.id] = p; });

  const today = localDateStr();
  const staffAttToday: Record<number, any> = {};
  attRecords.filter(r => r.date === today).forEach(r => { staffAttToday[r.staff_id] = r; });

  const statusTone = (st?: string) => st === 'present' ? [c.success, c.successLight] : st === 'absent' ? [c.danger, c.dangerLight] : st === 'leave' ? [c.info, c.infoLight] : st ? [c.warning, c.warningLight] : [c.textMuted, c.surface];

  const iconBtn = { width: 40, height: 40, borderRadius: 12, alignItems: 'center' as const, justifyContent: 'center' as const };

  return (
    <SafeScreen>
      <ScreenHeader title={tr('Staff & Attendance')} onBack={() => navigation.goBack()}
        right={
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {tab === 'staff' && canPayroll && (
              <>
                <TouchableOpacity style={[iconBtn, { backgroundColor: c.primaryLight }]} onPress={() => navigation.navigate('StaffPaySlip')} accessibilityLabel={tr('Pay slip')}>
                  <MaterialCommunityIcons name="file-document-outline" size={19} color={c.primary} />
                </TouchableOpacity>
                <TouchableOpacity style={[iconBtn, { backgroundColor: c.surface }]} onPress={exportPerformance} disabled={exporting} accessibilityLabel={tr('Export performance')}>
                  {exporting ? <ActivityIndicator size="small" color={c.primary} /> : <MaterialCommunityIcons name="export-variant" size={19} color={c.primary} />}
                </TouchableOpacity>
              </>
            )}
            {tab === 'attendance' && (
              <TouchableOpacity style={[iconBtn, { backgroundColor: c.successLight }]} onPress={exportAttendance} disabled={exporting} accessibilityLabel={tr('Export attendance')}>
                {exporting ? <ActivityIndicator size="small" color={c.success} /> : <MaterialCommunityIcons name="microsoft-excel" size={19} color={c.success} />}
              </TouchableOpacity>
            )}
            {canManageStaff && tab === 'staff' && (
              <TouchableOpacity style={[iconBtn, { backgroundColor: c.primary }]} onPress={openNew} accessibilityLabel={tr('Add staff')}>
                <MaterialCommunityIcons name="plus" size={20} color={c.onPrimary} />
              </TouchableOpacity>
            )}
          </View>
        }
      />

      <View style={{ paddingHorizontal: 16, marginVertical: 12 }}>
        <SegmentedTabs value={tab} onChange={(k) => setTab(k as 'staff' | 'attendance')}
          tabs={[{ key: 'staff', label: tr('Staff') }, { key: 'attendance', label: tr('Attendance') }]} />
      </View>

      {tab === 'attendance' && (
        <View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }} contentContainerStyle={{ paddingHorizontal: 16, paddingRight: 8 }}>
            {([['today', 'Today'], ['week', '7 Days'], ['month', 'Month'], ['3months', '3 Months'], ['6months', '6 Months'], ['year', 'Year']] as [AttPeriod, string][]).map(([k, l]) => (
              <Chip key={k} label={tr(l)} active={attPeriod === k} onPress={() => changePeriod(k)} />
            ))}
          </ScrollView>
        </View>
      )}

      {loading
        ? <ActivityIndicator color={c.primary} style={{ marginTop: 40 }} />
        : tab === 'staff' ? (
          <FlatList
            data={staff}
            keyExtractor={i => String(i.id)}
            contentContainerStyle={{ padding: 16, paddingTop: 0, paddingBottom: 40 }}
            ListEmptyComponent={
              <EmptyState icon="account-group-outline" title={tr('No staff added yet')}
                subtitle={canManageStaff ? tr('Add your first staff member to assign bills and track attendance.') : tr('Ask the owner to add staff.')}
                actionLabel={canManageStaff ? tr('Add staff') : undefined} onAction={canManageStaff ? openNew : undefined} />
            }
            renderItem={({ item }) => {
              const perf = perfMap[item.id];
              return (
                <TouchableOpacity
                  style={{ backgroundColor: c.card, borderRadius: 16, padding: 16, paddingRight: 8, marginBottom: 12, borderWidth: 1, borderColor: c.border }}
                  disabled={!canManageStaff}
                  onPress={() => openEdit(item)}
                  onLongPress={() => openStaffMenu(item)}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ marginRight: 14 }}><Avatar name={item.name} size={48} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: c.text, fontSize: 16, fontWeight: '700' }}>{item.name}</Text>
                      <Text style={{ color: c.textMuted, fontSize: 13, marginTop: 2 }}>{tr(item.role)}  •  {item.phone || tr('No phone')}</Text>
                      {canPayroll && (
                        <Text style={{ color: c.textMuted, fontSize: 12 }}>{tr('Commission')}: {item.commission_rate}%{item.salary > 0 ? `  •  ${tr('Salary')}: ${currencySymbol}${Number(item.salary).toLocaleString(appLocale())}` : ''}</Text>
                      )}
                    </View>
                    {canManageStaff && (
                      <TouchableOpacity onPress={() => openStaffMenu(item)} style={{ padding: 10 }} accessibilityLabel={tr('More options')}>
                        <MaterialCommunityIcons name="dots-vertical" size={20} color={c.textMuted} />
                      </TouchableOpacity>
                    )}
                  </View>
                  {perf && (
                    <View style={{ flexDirection: 'row', gap: 10, marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.divider, marginRight: 8 }}>
                      <View style={{ flex: 1, alignItems: 'center' }}>
                        <Text style={{ color: c.textMuted, fontSize: 10.5, fontWeight: '700', textTransform: 'uppercase' }}>{tr('Revenue')}</Text>
                        <Text style={{ color: c.success, fontSize: 15, fontWeight: '900', marginTop: 3 }} numberOfLines={1} adjustsFontSizeToFit>{currencySymbol}{Math.round(perf.total_revenue || 0).toLocaleString(appLocale())}</Text>
                      </View>
                      {canPayroll && (
                        <View style={{ flex: 1, alignItems: 'center' }}>
                          <Text style={{ color: c.textMuted, fontSize: 10.5, fontWeight: '700', textTransform: 'uppercase' }}>{tr('Commission')}</Text>
                          <Text style={{ color: c.primary, fontSize: 15, fontWeight: '900', marginTop: 3 }} numberOfLines={1} adjustsFontSizeToFit>{currencySymbol}{Math.round(perf.commission_earned || 0).toLocaleString(appLocale())}</Text>
                        </View>
                      )}
                      <View style={{ flex: 1, alignItems: 'center' }}>
                        <Text style={{ color: c.textMuted, fontSize: 10.5, fontWeight: '700', textTransform: 'uppercase' }}>{tr('Bills')}</Text>
                        <Text style={{ color: c.text, fontSize: 15, fontWeight: '900', marginTop: 3 }}>{perf.total_bills}</Text>
                      </View>
                    </View>
                  )}
                </TouchableOpacity>
              );
            }}
          />
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 0, paddingBottom: 40 }}>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
              {canManageAtt && <TouchableOpacity style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.surface, borderRadius: 12, padding: 13, borderWidth: 1, borderColor: c.border }}
                onPress={() => { setManualForm({ staff_id: '', date: localDateStr(), check_in: '09:00', check_out: '18:00', status: 'present' }); setShowManual(true); }}>
                <MaterialCommunityIcons name="calendar-edit" size={20} color={c.primary} />
                <Text style={{ color: c.primary, fontWeight: '700', fontSize: 13 }}>{tr('Manual entry')}</Text>
              </TouchableOpacity>}
              <View style={{ backgroundColor: c.surface, borderRadius: 12, padding: 13, borderWidth: 1, borderColor: c.border, alignItems: 'center', minWidth: 80 }}>
                <Text style={{ color: c.textMuted, fontSize: 10.5, fontWeight: '700' }}>{tr('RECORDS')}</Text>
                {attLoading ? <ActivityIndicator size="small" color={c.primary} /> : <Text style={{ color: c.text, fontSize: 16, fontWeight: '900' }}>{attRecords.length}</Text>}
              </View>
            </View>

            {attPeriod === 'today' ? (
              staff.map(item => {
                const att = staffAttToday[item.id];
                const [fg, bg] = statusTone(att?.status);
                const mayMark = canMarkFor(item.id);
                return (
                  <TouchableOpacity key={item.id} activeOpacity={att && canManageAtt ? 0.7 : 1} disabled={!att || !canManageAtt}
                    onPress={() => att && overrideStatus({ ...att, staff_name: item.name, staff_id: item.id })}
                    style={{ backgroundColor: c.card, borderRadius: 14, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: c.border }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: att || mayMark ? 10 : 0 }}>
                      <View style={{ marginRight: 12 }}><Avatar name={item.name} size={40} /></View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: c.text, fontSize: 15, fontWeight: '700' }}>{item.name}</Text>
                        <Text style={{ color: c.textMuted, fontSize: 12 }}>{tr(item.role)}</Text>
                      </View>
                      <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 16, backgroundColor: bg }}>
                        <Text style={{ color: fg, fontSize: 12, fontWeight: '700' }}>{att ? statusLabel(att.status) : tr('Not recorded')}</Text>
                      </View>
                    </View>
                    {att && (
                      <Text style={{ color: c.textMuted, fontSize: 12, marginBottom: 10, marginLeft: 52 }}>
                        {tr('In')}: {att.check_in || '—'}  •  {tr('Out')}: {att.check_out || tr('Still working')}
                      </Text>
                    )}
                    {mayMark && (
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        {!att && (
                          <TouchableOpacity disabled={rowBusy === item.id} style={{ flex: 1, backgroundColor: c.successLight, borderRadius: 10, padding: 11, alignItems: 'center' }} onPress={() => checkIn(item.id)}>
                            {rowBusy === item.id ? <ActivityIndicator size="small" color={c.success} /> : <Text style={{ color: c.success, fontWeight: '700', fontSize: 13 }}>✅ {tr('Check in')}</Text>}
                          </TouchableOpacity>
                        )}
                        {att && !att.check_out && (
                          <TouchableOpacity disabled={rowBusy === item.id} style={{ flex: 1, backgroundColor: c.dangerLight, borderRadius: 10, padding: 11, alignItems: 'center' }} onPress={() => checkOut(item.id)}>
                            {rowBusy === item.id ? <ActivityIndicator size="small" color={c.danger} /> : <Text style={{ color: c.danger, fontWeight: '700', fontSize: 13 }}>🚪 {tr('Check out')}</Text>}
                          </TouchableOpacity>
                        )}
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })
            ) : (
              attRecords.length === 0
                ? <Text style={{ color: c.textMuted, textAlign: 'center', marginTop: 40 }}>{attLoading ? tr('Loading…') : tr('No attendance records for this period')}</Text>
                : attRecords.map((rec: any, i: number) => {
                  const [fg, bg] = statusTone(rec.status);
                  return (
                    <TouchableOpacity key={rec.id ?? `${rec.staff_id}-${rec.date}-${i}`} activeOpacity={canManageAtt ? 0.6 : 1} disabled={!canManageAtt} onPress={() => overrideStatus(rec)}
                      style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: c.card, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: rec.needs_review ? c.warning : c.border }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: c.text, fontSize: 14, fontWeight: '700' }}>{rec.staff_name}</Text>
                        <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 2 }}>
                          {rec.date}  •  {rec.check_in || '—'} – {rec.check_out || '—'}
                          {rec.hours_worked ? `  •  ${Number(rec.hours_worked).toFixed(1)}h` : ''}
                        </Text>
                        {!!rec.needs_review && <Text style={{ color: c.warning, fontSize: 11.5, marginTop: 2, fontWeight: '700' }}>{tr('Needs review — tap to set')}</Text>}
                      </View>
                      <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, backgroundColor: bg }}>
                        <Text style={{ color: fg, fontSize: 11.5, fontWeight: '700' }}>{statusLabel(rec.status)}</Text>
                      </View>
                      {canManageAtt && <MaterialCommunityIcons name="chevron-right" size={18} color={c.textMuted} style={{ marginLeft: 4 }} />}
                    </TouchableOpacity>
                  );
                })
            )}
            {staff.length === 0 && <Text style={{ color: c.textMuted, textAlign: 'center', marginTop: 40 }}>{tr('No staff members yet.')}</Text>}
          </ScrollView>
        )
      }

      {/* Add/Edit Staff */}
      <BottomSheet visible={showAdd} onClose={() => setShowAdd(false)} title={editing ? tr('Edit staff') : tr('Add staff member')}
        footer={<View style={{ flexDirection: 'row', gap: 10 }}>
          <Button label={tr('Cancel')} variant="subtle" color={c.textSecondary} onPress={() => setShowAdd(false)} style={{ flex: 1 }} />
          <Button label={saving ? tr('Saving…') : tr('Save')} icon="check" onPress={save} loading={saving} disabled={saving} style={{ flex: 1.4 }} />
        </View>}>
        {([
          { key: 'name', label: `${tr('Full name')} *`, kb: 'default' },
          { key: 'phone', label: tr('Mobile number'), kb: 'phone-pad' },
          ...(canPayroll ? [
            { key: 'commission_rate', label: tr('Commission rate (%)'), kb: 'decimal-pad' },
            { key: 'salary', label: tr('Monthly salary (optional)'), kb: 'decimal-pad' },
          ] : []),
          { key: 'pin_code', label: tr('Check-in PIN (4 digits, unique)'), kb: 'number-pad' },
        ] as { key: string; label: string; kb: string }[]).map(({ key, label, kb }) => (
          <View key={key} style={{ marginBottom: 14 }}>
            <Text style={{ color: c.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>{label}</Text>
            <TextInput
              style={{ backgroundColor: c.surface, color: c.text, borderRadius: 10, padding: 12, fontSize: 14, borderWidth: 1, borderColor: c.border }}
              value={(form as any)[key]}
              onChangeText={v => setForm((f: any) => ({ ...f, [key]: key === 'pin_code' ? v.replace(/\D/g, '').slice(0, 4) : (key === 'commission_rate' || key === 'salary') ? cleanAmountInput(v) : v }))}
              keyboardType={kb as any}
              secureTextEntry={key === 'pin_code'}
              maxLength={key === 'pin_code' ? 4 : key === 'phone' ? 16 : undefined}
              placeholderTextColor={c.textMuted}
            />
          </View>
        ))}
        <Text style={{ color: c.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 8 }}>{tr('Role')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12 }}>
          {ROLES.map(r => (
            <TouchableOpacity key={r} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, marginRight: 8, marginBottom: 8, backgroundColor: form.role === r ? c.primary : c.surface, borderWidth: 1, borderColor: form.role === r ? c.primary : c.border }}
              onPress={() => setForm((f: any) => ({ ...f, role: r }))}>
              <Text style={{ color: form.role === r ? c.onPrimary : c.textSecondary, fontSize: 13, fontWeight: '600' }}>{tr(r)}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={{ color: c.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 8 }}>{tr('Required working hours / day')}</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
          {[8, 9, 10, 12].map(h => {
            const on = form.required_hours === String(h);
            return (
              <TouchableOpacity key={h} style={{ flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center', backgroundColor: on ? c.primary : c.surface, borderWidth: 1, borderColor: on ? c.primary : c.border }}
                onPress={() => setForm((f: any) => ({ ...f, required_hours: String(h) }))}>
                <Text style={{ color: on ? c.onPrimary : c.textSecondary, fontWeight: '700', fontSize: 14 }}>{h} {tr('hr')}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={{ color: c.textMuted, fontSize: 11.5, marginBottom: 16 }}>
          💡 {tr('On check-out the app sets Full / Half / Absent automatically using the thresholds in Settings → Attendance Rules.')}
        </Text>

        {canPayroll && (<>
          <Text style={{ color: c.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 8 }}>{tr('Salary type')}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
            {[
              { key: 'commission', label: `% ${tr('Commission')}` },
              { key: 'fixed', label: `${curSym().trim()} ${tr('Fixed')}` },
              { key: 'hybrid', label: `⚡ ${tr('Fixed + %')}` },
            ].map(({ key, label }) => {
              const on = form.salary_type === key;
              return (
                <TouchableOpacity key={key} style={{ flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center', backgroundColor: on ? c.primary : c.surface, borderWidth: 1, borderColor: on ? c.primary : c.border }}
                  onPress={() => setForm((f: any) => ({ ...f, salary_type: key }))}>
                  <Text style={{ color: on ? c.onPrimary : c.textSecondary, fontWeight: '700', fontSize: 12, textAlign: 'center' }}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </>)}
        {editing && (
          <Button label={tr('Deactivate staff member')} icon="account-off-outline" variant="outline" color={c.danger}
            onPress={() => { const it = editing; setShowAdd(false); setTimeout(() => deactivate(it), 250); }} />
        )}
      </BottomSheet>

      {/* Manual Attendance */}
      <BottomSheet visible={showManual} onClose={() => setShowManual(false)} title={tr('Record attendance')}
        footer={<Button label={tr('Save attendance')} icon="check" onPress={saveManual} loading={manualSaving} disabled={manualSaving} />}>
        <Text style={{ color: c.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 8 }}>{tr('Staff member')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>
          {staff.map(s => {
            const on = manualForm.staff_id === String(s.id);
            return (
              <TouchableOpacity key={s.id} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, marginRight: 8, marginBottom: 8, backgroundColor: on ? c.primary : c.surface, borderWidth: 1, borderColor: on ? c.primary : c.border }}
                onPress={() => setManualForm(f => ({ ...f, staff_id: String(s.id) }))}>
                <Text style={{ color: on ? c.onPrimary : c.textSecondary, fontSize: 13, fontWeight: '600' }}>{s.name}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <DateField label={tr('Date')} value={manualForm.date} onChange={v => setManualForm(f => ({ ...f, date: v }))} maxDate={today} />
        <Text style={{ color: c.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 8 }}>{tr('Status')}</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
          {STATUSES.map(s => {
            const on = manualForm.status === s;
            return (
              <TouchableOpacity key={s} style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: on ? c.primary : c.surface, borderWidth: 1, borderColor: on ? c.primary : c.border }}
                onPress={() => setManualForm(f => ({ ...f, status: s }))}>
                <Text style={{ color: on ? c.onPrimary : c.textSecondary, fontSize: 12, fontWeight: '700' }} numberOfLines={1} adjustsFontSizeToFit>{statusLabel(s)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {(manualForm.status === 'present' || manualForm.status === 'half_day') && (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}><TimeField label={tr('Check in')} value={manualForm.check_in} onChange={v => setManualForm(f => ({ ...f, check_in: v }))} /></View>
            <View style={{ flex: 1 }}><TimeField label={tr('Check out')} value={manualForm.check_out} onChange={v => setManualForm(f => ({ ...f, check_out: v }))} allowClear
              minTime={isValidTime(manualForm.check_in) ? manualForm.check_in : undefined}
              error={manualForm.check_out && isValidTime(manualForm.check_in) && timeToMin(manualForm.check_out) <= timeToMin(manualForm.check_in) ? tr('Must be after check-in') : undefined} /></View>
          </View>
        )}
      </BottomSheet>
      {choice.element}
    </SafeScreen>
  );
}
