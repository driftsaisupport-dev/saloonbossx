import React, { useState, useCallback } from 'react';
import { View, ScrollView, TouchableOpacity, Alert, Switch, StyleSheet } from 'react-native';
import { Text, TextInput } from '../theme/Text';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeScreen } from '../components/SafeScreen';
import { SectionLabel, Card } from '../components/UI';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { DatabaseService, DEFAULT_ATTENDANCE_RULES, AttendanceRules } from '../database/Database';
import { showError, isValidTime } from '../components/formUtils';
import { TimeField } from '../components/DateTimePicker';

const ACTIONS: { key: AttendanceRules['short_day_action']; label: string; hint: string }[] = [
  { key: 'half_day', label: 'Mark Half Day', hint: 'Counts as ½ a working day in pay slips.' },
  { key: 'absent',   label: 'Mark Absent',   hint: 'Counts as a full absent day — no pay for the day.' },
  { key: 'flag',     label: 'Flag for review', hint: 'Records Half Day but flags it so you decide later.' },
];

export default function AttendanceRulesScreen() {
  const { colors: c } = useTheme();
  const { user } = useAuth();
  const [r, setR] = useState<AttendanceRules>({ ...DEFAULT_ATTENDANCE_RULES });
  const [flagged, setFlagged] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);

  const [resolving, setResolving] = useState<number | null>(null);
  const load = useCallback(async () => {
    try {
      const [rules, fl] = await Promise.all([
        (DatabaseService as any).getAttendanceRules(),
        (DatabaseService as any).getFlaggedAttendance(),
      ]);
      setR(rules || { ...DEFAULT_ATTENDANCE_RULES }); setFlagged(fl || []);
    } catch (e) { showError(e, 'Could not load attendance rules'); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  function num(v: string, min = 0, max = 24) {
    const n = parseFloat(v.replace(/[^0-9.]/g, ''));
    if (isNaN(n)) return 0;
    return Math.max(min, Math.min(max, n));
  }

  async function save() {
    if (r.half_day_hours >= r.full_day_hours) {
      return Alert.alert('Check the hours', 'Half-day hours must be less than full-day hours.');
    }
    if (r.auto_checkout_enabled && !isValidTime(r.auto_checkout_time)) {
      return Alert.alert('Check the time', 'Pick a valid cut-off time.');
    }
    if (saving) return;
    setSaving(true);
    try {
      await (DatabaseService as any).setAttendanceRules(r);
      await (DatabaseService as any).logAudit({ id: user?.id, username: user?.username }, 'attendance_rules_updated', 'settings', 0,
        `full=${r.full_day_hours} half=${r.half_day_hours} short=${r.short_day_action}`);
      Alert.alert('✅ Saved', 'Attendance rules updated. They apply from the next check-out.');
    } catch (e) { showError(e, 'Rules not saved'); }
    finally { setSaving(false); }
  }

  async function resolveFlag(rec: any, status: string) {
    if (resolving) return;
    setResolving(rec.id);
    try {
      await (DatabaseService as any).setAttendanceStatus(rec.staff_id, rec.date, status, { username: user?.username });
      await (DatabaseService as any).logAudit({ id: user?.id, username: user?.username }, 'attendance_reviewed', 'attendance', rec.id, `${rec.staff_name} ${rec.date} → ${status}`).catch(() => {});
      load();
    } catch (e) { showError(e, 'Attendance not changed'); }
    finally { setResolving(null); }
  }

  const hourInput = (val: number, on: (n: number) => void) => (
    <TextInput
      keyboardType="numeric"
      value={String(val)}
      onChangeText={t => on(num(t))}
      style={{ backgroundColor: c.surface, color: c.text, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 16, fontWeight: '800', borderWidth: 1.5, borderColor: c.border, minWidth: 74, textAlign: 'center' }}
    />
  );

  return (
    <SafeScreen>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
        <Text style={{ color: c.textMuted, fontSize: 13, lineHeight: 19, marginBottom: 16 }}>
          When a staff member checks out, the app compares the hours they actually worked against these thresholds and sets their attendance status automatically.
        </Text>

        <Card>
          <Row c={c} title="Full day if worked at least" sub="e.g. 7 hours">
            {hourInput(r.full_day_hours, n => setR(x => ({ ...x, full_day_hours: n })))}
          </Row>
          <Divider c={c} />
          <Row c={c} title="Half day if worked at least" sub="Below full-day, but a real half-shift">
            {hourInput(r.half_day_hours, n => setR(x => ({ ...x, half_day_hours: n })))}
          </Row>
          <Divider c={c} />
          <Row c={c} title="Grace period (minutes)" sub="Late arrival still counts from shift start">
            {hourInput(r.grace_minutes, n => setR(x => ({ ...x, grace_minutes: Math.round(n) })))}
          </Row>
        </Card>

        <SectionLabel style={{ marginTop: 8 }}>If they worked less than half-day hours</SectionLabel>
        <View style={{ gap: 8, marginBottom: 12 }}>
          {ACTIONS.map(a => (
            <TouchableOpacity key={a.key} onPress={() => setR(x => ({ ...x, short_day_action: a.key }))}
              style={{ borderWidth: 1.5, borderRadius: 14, padding: 13, borderColor: r.short_day_action === a.key ? c.primary : c.border, backgroundColor: r.short_day_action === a.key ? c.primaryLight : c.card }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <MaterialCommunityIcons name={r.short_day_action === a.key ? 'radiobox-marked' : 'radiobox-blank'} size={18} color={r.short_day_action === a.key ? c.primary : c.textMuted} />
                <Text style={{ color: c.text, fontWeight: '800', fontSize: 14 }}>{a.label}</Text>
              </View>
              <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 4, marginLeft: 26 }}>{a.hint}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={{ color: c.text, fontWeight: '700', fontSize: 14 }}>Count Sundays as working days</Text>
              <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 2 }}>Affects the working-day total in pay slips.</Text>
            </View>
            <Switch value={r.count_sunday} onValueChange={v => setR(x => ({ ...x, count_sunday: v }))}
              trackColor={{ true: c.primary + '60', false: c.border }} thumbColor={r.count_sunday ? c.primary : '#f4f3f4'} />
          </View>
          <Divider c={c} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={{ color: c.text, fontWeight: '700', fontSize: 14 }}>Auto check-out reminder</Text>
              <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 2 }}>Warns staff still checked in after {r.auto_checkout_time}.</Text>
            </View>
            <Switch value={r.auto_checkout_enabled} onValueChange={v => setR(x => ({ ...x, auto_checkout_enabled: v }))}
              trackColor={{ true: c.primary + '60', false: c.border }} thumbColor={r.auto_checkout_enabled ? c.primary : c.textLight} />
          </View>
          {r.auto_checkout_enabled && (
            <View style={{ marginTop: 10 }}>
              <TimeField label="Cut-off time" value={r.auto_checkout_time} onChange={t => setR(x => ({ ...x, auto_checkout_time: t }))} minuteStep={15} />
            </View>
          )}
        </Card>

        <TouchableOpacity onPress={save} disabled={saving}
          style={{ backgroundColor: saving ? c.textMuted : c.primary, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 8, marginBottom: 24 }}>
          <Text style={{ color: c.onPrimary, fontWeight: '900', fontSize: 15 }}>{saving ? 'Saving…' : 'Save rules'}</Text>
        </TouchableOpacity>

        {flagged.length > 0 && (<>
          <SectionLabel>Flagged for review ({flagged.length})</SectionLabel>
          {flagged.map(f => (
            <Card key={f.id}>
              <Text style={{ color: c.text, fontWeight: '800', fontSize: 14 }}>{f.staff_name}</Text>
              <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 2 }}>
                {f.date} · {f.check_in || '—'}–{f.check_out || '—'} · {Number(f.hours_worked || 0).toFixed(1)}h
              </Text>
              {!!f.notes && <Text style={{ color: c.warning, fontSize: 12, marginTop: 4 }}>{f.notes}</Text>}
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                {['present', 'half_day', 'absent', 'leave'].map(st => (
                  <TouchableOpacity key={st} disabled={resolving === f.id} onPress={() => resolveFlag(f, st)}
                    style={{ flex: 1, backgroundColor: c.surface, borderRadius: 10, paddingVertical: 8, alignItems: 'center', borderWidth: 1, borderColor: c.border }}>
                    <Text style={{ color: c.textSecondary, fontWeight: '700', fontSize: 10.5, textTransform: 'capitalize' }}>
                      {st === 'half_day' ? 'Half' : st}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </Card>
          ))}
        </>)}
      </ScrollView>
    </SafeScreen>
  );
}

function Row({ c, title, sub, children }: any) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, gap: 12 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.text, fontWeight: '700', fontSize: 14 }}>{title}</Text>
        {sub ? <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 2 }}>{sub}</Text> : null}
      </View>
      {children}
    </View>
  );
}
function Divider({ c }: any) {
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.divider }} />;
}
