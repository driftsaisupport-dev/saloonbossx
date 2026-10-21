/**
 * Lightweight, pure-JS date & time pickers (no native dependency).
 *
 *   <DateField label="Birthday" value={dob} onChange={setDob} allowClear maxDate={today} />
 *   <TimeField label="Check-in" value={inT} onChange={setInT} />
 *
 * Values are always `YYYY-MM-DD` and `HH:MM` strings in LOCAL time — the same
 * format the data layer stores — so screens never have to parse free text.
 * The sheets (`DatePickerSheet`, `TimePickerSheet`) can also be opened on
 * their own, e.g. from a "Jump to date" button.
 */
import React from 'react';
import { View, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from '../theme/Text';
import { useTheme } from '../context/ThemeContext';
import { BottomSheet, Button } from './UI';
import { useTr } from '../i18n/tr';
import {
  localDateStr, parseLocalDate, isValidDateStr, prettyDate, formatTime12, isValidTime,
} from './dateFormat';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ═══ DATE PICKER SHEET ═══════════════════════════════════════════════════════
export function DatePickerSheet({ visible, onClose, value, onPick, title = 'Pick a date', minDate, maxDate }: {
  visible: boolean; onClose: () => void; value?: string; onPick: (date: string) => void;
  title?: string; minDate?: string; maxDate?: string;
}) {
  const { colors: c } = useTheme();
  const tr = useTr();
  const initial = isValidDateStr(value || '') ? parseLocalDate(value!) : new Date();
  const [ym, setYm] = React.useState({ y: initial.getFullYear(), m: initial.getMonth() });
  React.useEffect(() => {
    if (visible) {
      const d = isValidDateStr(value || '') ? parseLocalDate(value!) : new Date();
      setYm({ y: d.getFullYear(), m: d.getMonth() });
    }
  }, [visible, value]);

  const today = localDateStr();
  const first = new Date(ym.y, ym.m, 1);
  const daysIn = new Date(ym.y, ym.m + 1, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < first.getDay(); i++) cells.push(null);
  for (let d = 1; d <= daysIn; d++) cells.push(localDateStr(new Date(ym.y, ym.m, d)));
  while (cells.length % 7) cells.push(null);

  const shift = (months: number) => setYm(p => {
    const d = new Date(p.y, p.m + months, 1);
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const allowed = (d: string) => (!minDate || d >= minDate) && (!maxDate || d <= maxDate);
  const pick = (d: string) => { if (!allowed(d)) return; onPick(d); onClose(); };
  const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return localDateStr(d); })();

  return (
    <BottomSheet visible={visible} onClose={onClose} title={tr(title)}>
      <View style={dp.quickRow}>
        {allowed(today) && <QuickChip label={tr('Today')} onPress={() => pick(today)} />}
        {allowed(tomorrow) && <QuickChip label={tr('Tomorrow')} onPress={() => pick(tomorrow)} />}
      </View>
      <View style={dp.nav}>
        <NavBtn icon="chevron-double-left" onPress={() => shift(-12)} label="Previous year" />
        <NavBtn icon="chevron-left" onPress={() => shift(-1)} label="Previous month" />
        <Text style={[dp.month, { color: c.text }]}>{tr(MONTHS[ym.m])} {ym.y}</Text>
        <NavBtn icon="chevron-right" onPress={() => shift(1)} label="Next month" />
        <NavBtn icon="chevron-double-right" onPress={() => shift(12)} label="Next year" />
      </View>
      <View style={dp.grid}>
        {WEEKDAYS.map((w, i) => (
          <View key={`w${i}`} style={dp.cell}><Text style={[dp.wd, { color: c.textMuted }]}>{w}</Text></View>
        ))}
        {cells.map((d, i) => {
          if (!d) return <View key={`e${i}`} style={dp.cell} />;
          const sel = d === value;
          const isToday = d === today;
          const ok = allowed(d);
          return (
            <TouchableOpacity key={d} style={dp.cell} disabled={!ok} onPress={() => pick(d)} accessibilityLabel={prettyDate(d, true)}>
              <View style={[dp.day, sel && { backgroundColor: c.primary }, !sel && isToday && { borderWidth: 1.5, borderColor: c.primary }]}>
                <Text style={{ fontSize: 14.5, fontWeight: sel || isToday ? '800' : '600', color: sel ? c.onPrimary : ok ? c.text : c.textLight }}>
                  {Number(d.slice(8))}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </BottomSheet>
  );

  function NavBtn({ icon, onPress, label }: { icon: string; onPress: () => void; label: string }) {
    return (
      <TouchableOpacity onPress={onPress} style={[dp.navBtn, { backgroundColor: c.surface }]} accessibilityLabel={label} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
        <MaterialCommunityIcons name={icon as any} size={20} color={c.text} />
      </TouchableOpacity>
    );
  }
  function QuickChip({ label, onPress }: { label: string; onPress: () => void }) {
    return (
      <TouchableOpacity onPress={onPress} style={[dp.quick, { backgroundColor: c.primaryLight }]}>
        <Text style={{ color: c.primary, fontWeight: '800', fontSize: 13 }}>{label}</Text>
      </TouchableOpacity>
    );
  }
}

// ═══ TIME PICKER SHEET ═══════════════════════════════════════════════════════
export function TimePickerSheet({ visible, onClose, value, onPick, title = 'Pick a time', minuteStep = 5, minTime, maxTime }: {
  visible: boolean; onClose: () => void; value?: string; onPick: (time: string) => void;
  title?: string; minuteStep?: 5 | 10 | 15 | 30; minTime?: string; maxTime?: string;
}) {
  const { colors: c } = useTheme();
  const tr = useTr();
  const [h, setH] = React.useState<number | null>(null);
  const [m, setM] = React.useState<number>(0);
  React.useEffect(() => {
    if (visible) {
      if (isValidTime(value || '')) {
        const [hh, mm] = value!.split(':').map(Number);
        setH(hh); setM(Math.round(mm / minuteStep) * minuteStep % 60);
      } else { setH(null); setM(0); }
    }
  }, [visible, value, minuteStep]);

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: 60 / minuteStep }, (_, i) => i * minuteStep);
  const p2 = (n: number) => String(n).padStart(2, '0');
  const result = h == null ? '' : `${p2(h)}:${p2(m)}`;
  const inRange = (t: string) => (!minTime || t >= minTime) && (!maxTime || t <= maxTime);
  const hourLabel = (x: number) => `${x % 12 || 12} ${x < 12 ? 'AM' : 'PM'}`;

  return (
    <BottomSheet visible={visible} onClose={onClose} title={tr(title)}
      footer={<Button label={result ? `${tr('Set')} ${formatTime12(result)}` : tr('Pick an hour')} disabled={!result || !inRange(result)}
        onPress={() => { if (result && inRange(result)) { onPick(result); onClose(); } }} />}>
      <Text style={[tp.label, { color: c.textSecondary }]}>{tr('Hour')}</Text>
      <View style={tp.wrap}>
        {hours.map(x => {
          const on = x === h;
          const ok = inRange(`${p2(x)}:59`) && (!maxTime || `${p2(x)}:00` <= maxTime);
          return (
            <TouchableOpacity key={x} disabled={!ok} onPress={() => setH(x)}
              style={[tp.chip, { backgroundColor: on ? c.primary : c.surface, borderColor: on ? c.primary : c.border, opacity: ok ? 1 : 0.35 }]}>
              <Text style={{ color: on ? c.onPrimary : c.text, fontWeight: '700', fontSize: 13 }}>{hourLabel(x)}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={[tp.label, { color: c.textSecondary, marginTop: 14 }]}>{tr('Minutes')}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {minutes.map(x => {
          const on = x === m;
          return (
            <TouchableOpacity key={x} onPress={() => setM(x)}
              style={[tp.chip, { marginRight: 8, backgroundColor: on ? c.primary : c.surface, borderColor: on ? c.primary : c.border }]}>
              <Text style={{ color: on ? c.onPrimary : c.text, fontWeight: '700', fontSize: 13 }}>:{p2(x)}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      {result && !inRange(result) ? (
        <Text style={{ color: c.danger, marginTop: 10, fontSize: 12.5 }}>
          {minTime && maxTime ? tr('Pick a time between {a} and {b}', { a: formatTime12(minTime), b: formatTime12(maxTime) })
            : minTime ? tr('Pick a time after {a}', { a: formatTime12(minTime) }) : tr('Pick a time before {a}', { a: formatTime12(maxTime!) })}
        </Text>
      ) : null}
    </BottomSheet>
  );
}

// ═══ FIELDS ═════════════════════════════════════════════════════════════════
function FieldShell({ label, icon, text, placeholder, onPress, onClear, error, hint }: {
  label?: string; icon: string; text: string; placeholder: string; onPress: () => void;
  onClear?: () => void; error?: string; hint?: string;
}) {
  const { colors: c } = useTheme();
  return (
    <View style={{ marginBottom: 14 }}>
      {label ? <Text style={[fs.label, { color: c.textSecondary }]}>{label}</Text> : null}
      <TouchableOpacity onPress={onPress} activeOpacity={0.75} accessibilityRole="button" accessibilityLabel={label || placeholder}
        style={[fs.wrap, { backgroundColor: c.surface, borderColor: error ? c.danger : c.border }]}>
        <MaterialCommunityIcons name={icon as any} size={18} color={c.textMuted} />
        <Text style={{ flex: 1, fontSize: 15, color: text ? c.text : c.textMuted, fontWeight: text ? '600' : '400' }} numberOfLines={1}>
          {text || placeholder}
        </Text>
        {text && onClear ? (
          <TouchableOpacity onPress={onClear} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel="Clear">
            <MaterialCommunityIcons name="close-circle" size={18} color={c.textMuted} />
          </TouchableOpacity>
        ) : <MaterialCommunityIcons name="chevron-down" size={20} color={c.textMuted} />}
      </TouchableOpacity>
      {error ? <Text style={[fs.hint, { color: c.danger }]}>{error}</Text>
        : hint ? <Text style={[fs.hint, { color: c.textMuted }]}>{hint}</Text> : null}
    </View>
  );
}

export function DateField({ label, value, onChange, placeholder = 'Select date', minDate, maxDate, allowClear, error, hint, withYear = true }: {
  label?: string; value: string; onChange: (v: string) => void; placeholder?: string;
  minDate?: string; maxDate?: string; allowClear?: boolean; error?: string; hint?: string; withYear?: boolean;
}) {
  const tr = useTr();
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <FieldShell label={label} icon="calendar" text={value ? prettyDate(value, withYear) : ''} placeholder={tr(placeholder)}
        onPress={() => setOpen(true)} onClear={allowClear ? () => onChange('') : undefined} error={error} hint={hint} />
      <DatePickerSheet visible={open} onClose={() => setOpen(false)} value={value} onPick={onChange}
        title={label || 'Pick a date'} minDate={minDate} maxDate={maxDate} />
    </>
  );
}

export function TimeField({ label, value, onChange, placeholder = 'Select time', minuteStep = 5, minTime, maxTime, allowClear, error, hint }: {
  label?: string; value: string; onChange: (v: string) => void; placeholder?: string;
  minuteStep?: 5 | 10 | 15 | 30; minTime?: string; maxTime?: string; allowClear?: boolean; error?: string; hint?: string;
}) {
  const tr = useTr();
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <FieldShell label={label} icon="clock-outline" text={value ? formatTime12(value) : ''} placeholder={tr(placeholder)}
        onPress={() => setOpen(true)} onClear={allowClear ? () => onChange('') : undefined} error={error} hint={hint} />
      <TimePickerSheet visible={open} onClose={() => setOpen(false)} value={value} onPick={onChange}
        title={label || 'Pick a time'} minuteStep={minuteStep} minTime={minTime} maxTime={maxTime} />
    </>
  );
}

const dp = StyleSheet.create({
  quickRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  quick: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  nav: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  navBtn: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  month: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '800' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  wd: { fontSize: 12, fontWeight: '800' },
  day: { width: '86%', aspectRatio: 1, maxWidth: 44, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
});
const tp = StyleSheet.create({
  label: { fontSize: 12.5, fontWeight: '800', marginBottom: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, borderWidth: 1, minWidth: 64, alignItems: 'center' },
});
const fs = StyleSheet.create({
  label: { fontSize: 12.5, fontWeight: '700', marginBottom: 7 },
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 14, borderWidth: 1.5 },
  hint: { fontSize: 11.5, marginTop: 5, marginLeft: 2 },
});
