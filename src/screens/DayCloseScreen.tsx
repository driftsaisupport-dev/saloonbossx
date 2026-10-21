/**
 * Day close / cash tally.
 *
 *   Opening cash (+ where it came from)
 *   + cash from bills  − cash refunds  + cash dues collected
 *   + cash wallet top-ups  + cash advances  − cash expenses
 *   = Expected in drawer
 *
 * The owner counts the drawer (typing the total, or counting notes with the
 * denomination counter), sees "Short ₹X" / "Excess ₹X", adds a note and saves.
 * UPI / card / wallet figures are shown for information — they are not cash.
 * Re-closing a day overwrites it (data layer). History lists previous closes.
 */
import React, { useCallback, useContext, useMemo, useState } from 'react';
import { View, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Share, Linking, RefreshControl, Alert } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text, TextInput } from '../theme/Text';
import { SafeScreen } from '../components/SafeScreen';
import { ScreenHeader, Card, Button, Input, SectionLabel, Chip, IconButton } from '../components/UI';
import { DateField } from '../components/DateTimePicker';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { AppContext } from '../context/AppContext';
import { DatabaseService, DBX } from '../database/Database';
import { useTr } from '../i18n/tr';
import { useBusy } from '../components/useBusy';
import { useKeyboardInset } from '../components/useKeyboardInset';
import { parseAmount, cleanAmountInput, localDateStr, addDays, prettyDate, confirmAsync, showError } from '../components/formUtils';
import { parseDbDate } from '../utils/helpers';
import { Radius } from '../theme/colors';
import { appLocale, curSym, payLabel, fmtMoney, localPrice, cashNotes } from '../config/regions';

// Notes counted at day close follow the salon's currency (₹500… in India, $100… in the US).
const NOTES_OF = () => cashNotes();

const toPaise = (n: number) => Math.round((Number(n) || 0) * 100);

export default function DayCloseScreen() {
  const { colors: c } = useTheme();
  const tr = useTr();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { user, can } = useAuth();
  const canClose = can('cash.close');
  const { currencySymbol } = useContext(AppContext);
  const sym = currencySymbol || curSym();
  const kb = useKeyboardInset();

  // Re-read on every focus so a screen left open past midnight does not keep yesterday as "today".
  const [today, setToday] = useState(() => localDateStr());
  const [date, setDate] = useState<string>(() => {
    const d = String(route?.params?.date || '');
    return /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= today ? d : today;
  });
  const [tally, setTally] = useState<any>(null);
  const [refunds, setRefunds] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [salonName, setSalonName] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [counter, setCounter] = useState(false);
  const [denoms, setDenoms] = useState<Record<string, string>>({});
  const [coins, setCoins] = useState('');
  const [saving, runSave] = useBusy('Day not closed');
  const [sharing, runShare] = useBusy('Could not share');

  const money = (n: number) => `${n < 0 ? '−' : ''}${sym}${Math.abs(Number(n) || 0).toLocaleString(appLocale(), { maximumFractionDigits: 2 })}`;

  const load = useCallback(async (d: string) => {
    try {
      const [t, h, p, rf] = await Promise.all([
        DBX.getCashTally(d),
        DBX.listDayCloses(30).catch(() => []),
        DatabaseService.getSalonProfile().catch(() => null),
        DBX.getAdvancesToRefund().catch(() => []),
      ]);
      setTally(t);
      setRefunds((rf as any[]) || []);
      setHistory((h as any[]) || []);
      setSalonName(String((p as any)?.name || ''));
      // Prefill from an existing close so re-closing starts from what was counted.
      setCounted(t?.closed ? String(t.closed.counted_cash ?? '') : '');
      setNote(t?.closed?.note || '');
      setCounter(false); setDenoms({}); setCoins('');
      setLoadError(false);
    } catch (e) {
      console.warn('[dayclose] load', e);
      setLoadError(true);
    } finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => {
    const now = localDateStr();
    if (now !== today) {
      setToday(now);
      // The screen was showing "today" when the date rolled over: follow the new day.
      if (date === today) { setDate(now); return; }
    }
    load(date);
  }, [load, date, today]));

  async function pullRefresh() { setRefreshing(true); await load(date); setRefreshing(false); }

  function changeDate(d: string) {
    const now = localDateStr();
    if (now !== today) setToday(now);
    const next = d > now ? now : d;
    if (!next || next === date) return;
    setLoading(true);
    setDate(next);
  }

  // ── Counting ──────────────────────────────────────────────────────────────
  const denomTotal = useMemo(() => {
    let p = 0;
    for (const n of NOTES_OF()) {
      const q = Math.floor(Number(String(denoms[n] || '').replace(/\D/g, '')) || 0);
      p += q * n * 100;
    }
    const ci = parseAmount(coins || '0');
    if (!isNaN(ci)) p += toPaise(ci);
    return p / 100;
  }, [denoms, coins]);

  const countedNum = counter ? denomTotal : (counted.trim() === '' ? NaN : parseAmount(counted));
  const expected = Number(tally?.expected_cash || 0);
  const hasCount = Number.isFinite(countedNum);
  const diff = hasCount ? (toPaise(countedNum) - toPaise(expected)) / 100 : 0;

  function setDenom(n: number, v: string) {
    setDenoms(d => ({ ...d, [n]: v.replace(/\D/g, '').slice(0, 5) }));
  }
  function bump(n: number, by: number) {
    setDenoms(d => {
      const cur = Math.floor(Number(d[n] || 0) || 0);
      const next = Math.max(0, cur + by);
      return { ...d, [n]: next ? String(next) : '' };
    });
  }

  function diffLabel(d: number): string {
    if (toPaise(d) === 0) return tr('Matches exactly');
    return d < 0 ? tr('Short {amt}', { amt: money(Math.abs(d)) }) : tr('Excess {amt}', { amt: money(d) });
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  function save() {
    if (!canClose) return;
    runSave(async () => {
      if (!hasCount || countedNum < 0) {
        Alert.alert(tr('Count the cash'), tr('Enter the cash you counted in the drawer (0 or more).'));
        return;
      }
      // Re-read the expected figure: bills / top-ups may have landed since the
      // screen loaded, and saveDayClose stores the difference against the live figure.
      const fresh: any = await DBX.getCashTally(date).catch(() => null);
      const exp = fresh ? Number(fresh.expected_cash || 0) : expected;
      if (fresh) setTally(fresh);
      const liveDiff = (toPaise(countedNum) - toPaise(exp)) / 100;
      if (toPaise(liveDiff) !== 0) {
        const ok = await confirmAsync(
          liveDiff < 0 ? 'Cash is short' : 'Cash is extra',
          tr('{label} against the expected {exp}. Save the day close anyway? Add a note so you remember why.', { label: diffLabel(liveDiff), exp: money(exp) }),
          'Save',
        );
        if (!ok) return;
      }
      await DBX.saveDayClose(date, countedNum, note.trim(), user?.displayName || user?.username || '');
      await load(date);
      Alert.alert(tr('Day closed'), date === localDateStr()
        ? tr('{date} is closed. Tomorrow starts with {amt} in the drawer.', { date: prettyDate(date), amt: money(countedNum) })
        : tr('{date} is closed. {next} opens with {amt} in the drawer, unless an opening amount was set for it.', { date: prettyDate(date), next: prettyDate(addDays(date, 1)), amt: money(countedNum) }));
    });
  }

  /** Record that a held advance was given back (no money moves automatically). */
  function markRefunded(r: any) {
    const go = (method: string) => runSave(async () => {
      await DBX.markAdvanceRefunded(r.id, method);
      await load(date);
    });
    Alert.alert(tr('Advance given back?'), tr('{name}: {amt}. How was it returned?', { name: r.client_name || tr('Walk-in'), amt: money(r.amount) }), [
      { text: tr('Cancel'), style: 'cancel' },
      { text: tr('Cash'), onPress: () => go('cash') },
      { text: payLabel(), onPress: () => go('upi') },
      { text: tr('Card'), onPress: () => go('card') },
    ]);
  }

  // ── Share ─────────────────────────────────────────────────────────────────
  function summaryText(): string {
    const t = tally || {};
    const closed = t.closed;
    const cnt = closed ? Number(closed.counted_cash) : (hasCount ? countedNum : NaN);
    const d = closed ? Number(closed.difference) : (hasCount ? diff : NaN);
    const lines = [
      `🧾 ${tr('Day close')} — ${salonName || tr('Salon')}`,
      `📅 ${prettyDate(date, true)}`,
      '',
      `${tr('Opening cash')}: ${money(t.opening_cash)}`,
      `+ ${tr('Cash from bills')}: ${money(t.cash_sales)}`,
      ...(t.cash_refunds ? [`− ${tr('Cash refunds')}: ${money(t.cash_refunds)}`] : []),
      `+ ${tr('Cash dues collected')}: ${money(t.cash_dues)}`,
      `+ ${tr('Cash wallet top-ups')}: ${money(t.wallet_topups_cash)}`,
      `+ ${tr('Cash advances')}: ${money(t.advances_cash)}`,
      `− ${tr('Cash expenses')}: ${money(t.cash_expenses)}`,
      `= ${tr('Expected in drawer')}: ${money(t.expected_cash)}`,
      '',
      ...(Number.isFinite(cnt) ? [`💵 ${tr('Counted cash')}: ${money(cnt)}`, `${toPaise(d) === 0 ? '✅' : d < 0 ? '🔴' : '🟢'} ${diffLabel(d)}`, ''] : []),
      `${tr('UPI received')}: ${money(t.received?.upi)}`,
      `${tr('Card received')}: ${money(t.received?.card)}`,
      `${tr('Wallet used on bills')}: ${money(t.wallet_spent)}`,
      ...(closed?.note || note.trim() ? ['', `📝 ${closed?.note || note.trim()}`] : []),
    ];
    return lines.join('\n');
  }

  function share() {
    runShare(async () => {
      const text = summaryText();
      const wa = `whatsapp://send?text=${encodeURIComponent(text)}`;
      const canWa = await Linking.canOpenURL(wa).catch(() => false);
      if (canWa) { await Linking.openURL(wa); return; }
      await Share.share({ message: text });
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const header = (
    <ScreenHeader
      title={tr('Day close')}
      subtitle={date === today ? tr('Today') : prettyDate(date)}
      onBack={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Main'))}
      right={tally ? <IconButton icon="whatsapp" tone="success" onPress={share} loading={sharing} /> : undefined}
    />
  );

  if (loading && !tally) {
    return <SafeScreen>{header}<ActivityIndicator color={c.primary} style={{ marginTop: 60 }} /></SafeScreen>;
  }

  if (loadError && !tally) {
    return (
      <SafeScreen>
        {header}
        <View style={{ padding: 24, alignItems: 'center', gap: 12 }}>
          <MaterialCommunityIcons name="cash-remove" size={48} color={c.textLight} />
          <Text style={{ color: c.text, fontWeight: '800', fontSize: 16 }}>{tr('Cash figures did not load')}</Text>
          <Button label={tr('Try again')} icon="refresh" full={false} onPress={() => { setLoading(true); load(date); }} />
        </View>
      </SafeScreen>
    );
  }

  const t = tally || {};
  const closed = t.closed;
  const openingHint = t.opening_source === 'set' ? tr('Set on Home → Cash Register')
    : t.opening_source === 'last_close' ? tr('Counted at the last day close')
    : tr('Not set — open the register on Home');

  return (
    <SafeScreen>
      {header}
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 40 + kb }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={pullRefresh} tintColor={c.primary} />}>

        {/* Date */}
        <View style={{ flexDirection: 'row', marginBottom: 10 }}>
          <Chip label={tr('Today')} active={date === today} onPress={() => changeDate(today)} />
          <Chip label={tr('Yesterday')} active={date === addDays(today, -1)} onPress={() => changeDate(addDays(today, -1))} />
        </View>
        <DateField value={date} onChange={changeDate} maxDate={today} withYear />

        {/* Already closed */}
        {closed && (
          <View style={[s.banner, { backgroundColor: toPaise(closed.difference) < 0 ? c.dangerLight : c.successLight }]}>
            <MaterialCommunityIcons name="lock-check-outline" size={22} color={toPaise(closed.difference) < 0 ? c.danger : c.success} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.text, fontWeight: '800' }}>{tr('Day already closed')}</Text>
              <Text style={{ color: c.textSecondary, fontSize: 12.5, marginTop: 2 }}>
                {[closed.closed_at ? parseDbDate(closed.closed_at).toLocaleTimeString(appLocale(), { hour: 'numeric', minute: '2-digit' }) : '', closed.closed_by,
                  `${tr('Counted')} ${money(closed.counted_cash)}`, diffLabel(Number(closed.difference) || 0)].filter(Boolean).join(' · ')}
              </Text>
              {canClose ? <Text style={{ color: c.textMuted, fontSize: 11.5, marginTop: 4 }}>{tr('Saving again replaces this close.')}</Text> : null}
            </View>
          </View>
        )}

        {/* Breakdown */}
        <SectionLabel style={{ marginTop: 6 }}>{tr('Cash in the drawer')}</SectionLabel>
        <Card padded={false}>
          <Row label={tr('Opening cash')} hint={openingHint} value={money(t.opening_cash)} />
          <Row sign="+" label={tr('Cash from bills')} value={money(t.cash_sales)} tone="success" />
          {Number(t.cash_refunds) > 0 && <Row sign="−" label={tr('Cash refunds')} hint={tr('Cancelled bills paid back in cash')} value={money(t.cash_refunds)} tone="danger" />}
          <Row sign="+" label={tr('Cash dues collected')} value={money(t.cash_dues)} tone="success" />
          <Row sign="+" label={tr('Cash wallet top-ups')} value={money(t.wallet_topups_cash)} tone="success" />
          <Row sign="+" label={tr('Cash advances')} hint={tr('Booking advances taken in cash, less cash advances given back')} value={money(t.advances_cash)} tone="success" />
          <Row sign="−" label={tr('Cash expenses')} value={money(t.cash_expenses)} tone="danger" />
          <View style={[s.totalRow, { backgroundColor: c.primaryLight }]}>
            <Text style={{ color: c.primary, fontWeight: '900', fontSize: 15, flex: 1 }}>= {tr('Expected in drawer')}</Text>
            <Text style={{ color: c.primary, fontWeight: '900', fontSize: 22 }} numberOfLines={1} adjustsFontSizeToFit>{money(expected)}</Text>
          </View>
        </Card>

        {/* Info: not cash */}
        <SectionLabel style={{ marginTop: 6 }}>{tr('Not cash (for your records)')}</SectionLabel>
        <View style={s.infoGrid}>
          <Info icon="qrcode-scan" label={tr('UPI received')} value={money(t.received?.upi)} color={c.upi} bg={c.surface} />
          <Info icon="credit-card-outline" label={tr('Card received')} value={money(t.received?.card)} color={c.info} bg={c.surface} />
          <Info icon="wallet-outline" label={tr('Wallet used on bills')} value={money(t.wallet_spent)} color={c.accent} bg={c.surface} />
          {Number(t.advance_adjusted) > 0 && <Info icon="calendar-check" label={tr('Advances adjusted')} value={money(t.advance_adjusted)} color={c.warning} bg={c.surface} />}
        </View>

        {/* Advances on cancelled / no-show bookings still held */}
        {refunds.length > 0 && (
          <>
            <SectionLabel style={{ marginTop: 10 }}>{tr('Advances to give back')}</SectionLabel>
            <Card padded={false}>
              {refunds.map((r) => (
                <View key={r.id} style={[s.refundRow, { borderBottomColor: c.divider }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.text, fontWeight: '800' }} numberOfLines={1}>{r.client_name || tr('Walk-in')} · {money(r.amount)}</Text>
                    <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                      {[prettyDate(r.date), String(r.start_time || '').slice(0, 5), r.status === 'cancelled' ? tr('Cancelled') : tr('No-show'), r.advance_method ? String(r.advance_method).toUpperCase() : ''].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  {canClose ? (
                    <TouchableOpacity onPress={() => markRefunded(r)} style={[s.refundBtn, { backgroundColor: c.primaryLight }]}>
                      <Text style={{ color: c.primary, fontSize: 12, fontWeight: '800' }}>{tr('Mark refunded')}</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ))}
            </Card>
          </>
        )}

        {/* Count */}
        <SectionLabel style={{ marginTop: 10 }}>{tr('Counted cash')}</SectionLabel>
        <Card>
          {!counter ? (
            <TextInput
              value={counted}
              onChangeText={v => setCounted(cleanAmountInput(v))}
              editable={canClose}
              placeholder={tr('Cash in drawer now')}
              placeholderTextColor={c.textMuted}
              keyboardType="decimal-pad"
              style={[s.bigInput, { color: c.text, backgroundColor: c.surface, borderColor: hasCount ? (toPaise(diff) < 0 ? c.danger : c.success) : c.border }]}
            />
          ) : (
            <View>
              {NOTES_OF().map(n => {
                const q = Math.floor(Number(denoms[n] || 0) || 0);
                return (
                  <View key={n} style={[s.denomRow, { borderBottomColor: c.divider }]}>
                    <Text style={{ color: c.text, fontWeight: '800', fontSize: 15, width: 52 }}>{sym}{n}</Text>
                    <Text style={{ color: c.textMuted }}>×</Text>
                    <TouchableOpacity onPress={() => bump(n, -1)} disabled={!q} style={[s.step, { backgroundColor: c.surface, opacity: q ? 1 : 0.4 }]} accessibilityLabel={tr('Less')}>
                      <MaterialCommunityIcons name="minus" size={18} color={c.text} />
                    </TouchableOpacity>
                    <TextInput value={denoms[n] || ''} onChangeText={v => setDenom(n, v)} keyboardType="number-pad" placeholder="0" placeholderTextColor={c.textLight}
                      style={[s.denomInput, { color: c.text, backgroundColor: c.surface }]} />
                    <TouchableOpacity onPress={() => bump(n, 1)} style={[s.step, { backgroundColor: c.primaryLight }]} accessibilityLabel={tr('More')}>
                      <MaterialCommunityIcons name="plus" size={18} color={c.primary} />
                    </TouchableOpacity>
                    <Text style={{ color: c.textSecondary, fontWeight: '700', flex: 1, textAlign: 'right' }} numberOfLines={1} adjustsFontSizeToFit>{money(q * n)}</Text>
                  </View>
                );
              })}
              <View style={[s.denomRow, { borderBottomWidth: 0 }]}>
                <Text style={{ color: c.text, fontWeight: '800', fontSize: 15, width: 52 }}>{tr('Coins')}</Text>
                <TextInput value={coins} onChangeText={v => setCoins(cleanAmountInput(v))} keyboardType="decimal-pad" placeholder={`${sym}0`} placeholderTextColor={c.textLight}
                  style={[s.denomInput, { color: c.text, backgroundColor: c.surface, flex: 1 }]} />
              </View>
              <View style={[s.totalRow, { backgroundColor: c.surface, borderRadius: Radius.md, marginTop: 6 }]}>
                <Text style={{ color: c.text, fontWeight: '800', flex: 1 }}>{tr('Total counted')}</Text>
                <Text style={{ color: c.text, fontWeight: '900', fontSize: 20 }}>{money(denomTotal)}</Text>
              </View>
            </View>
          )}

          {canClose && (
            <TouchableOpacity onPress={() => {
              if (counter && denomTotal > 0) setCounted(String(denomTotal));
              setCounter(v => !v);
            }} style={s.counterToggle} accessibilityRole="button">
              <MaterialCommunityIcons name={counter ? 'keyboard-outline' : 'cash-multiple'} size={18} color={c.primary} />
              <Text style={{ color: c.primary, fontWeight: '800', fontSize: 13.5 }}>{counter ? tr('Type the total instead') : `${tr('Count notes')} (${cashNotes().slice(0, 3).map(n => fmtMoney(n, { whole: true })).join(', ')}…)`}</Text>
            </TouchableOpacity>
          )}

          {hasCount && (
            <View style={[s.diff, { backgroundColor: toPaise(diff) < 0 ? c.dangerLight : c.successLight }]}>
              <MaterialCommunityIcons name={toPaise(diff) === 0 ? 'check-circle' : toPaise(diff) < 0 ? 'arrow-down-circle' : 'arrow-up-circle'} size={24} color={toPaise(diff) < 0 ? c.danger : c.success} />
              <Text style={{ color: toPaise(diff) < 0 ? c.danger : c.success, fontWeight: '900', fontSize: 18, flex: 1 }}>{diffLabel(diff)}</Text>
            </View>
          )}
        </Card>

        {canClose ? (
          <>
            <Input label={tr('Note (optional)')} value={note} onChangeText={setNote} placeholder={`e.g. ${fmtMoney(localPrice(200), { whole: true })} ${tr('given to staff for tea')}`} maxLength={500} multiline />
            <Button label={closed ? tr('Update day close') : tr('Close the day')} icon="lock-check-outline" loading={saving} disabled={!hasCount} onPress={save} />
          </>
        ) : (
          <Text style={{ color: c.textMuted, fontSize: 12.5, textAlign: 'center', marginTop: 4 }}>{tr('Only the owner or manager can close the day.')}</Text>
        )}

        {/* History */}
        <SectionLabel style={{ marginTop: 24 }}>{tr('Previous closes')}</SectionLabel>
        {history.length === 0 ? (
          <Text style={{ color: c.textMuted, fontSize: 13 }}>{tr('No day closed yet. Close today to start the record.')}</Text>
        ) : (
          <Card padded={false}>
            {history.map((h, i) => {
              const d = Number(h.difference) || 0;
              const tone = toPaise(d) < 0 ? c.danger : c.success;
              return (
                <TouchableOpacity key={h.date} onPress={() => changeDate(h.date)} activeOpacity={0.7}
                  style={[s.histRow, { borderBottomColor: c.divider, borderBottomWidth: i === history.length - 1 ? 0 : StyleSheet.hairlineWidth, backgroundColor: h.date === date ? c.primaryLight : 'transparent' }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.text, fontWeight: '800' }}>{prettyDate(h.date, true)}</Text>
                    <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                      {tr('Expected')} {money(h.expected_cash)} · {tr('Counted')} {money(h.counted_cash)}{h.closed_by ? ` · ${h.closed_by}` : ''}
                    </Text>
                  </View>
                  <Text style={{ color: tone, fontWeight: '900', fontSize: 13 }}>{toPaise(d) === 0 ? '✓' : diffLabel(d)}</Text>
                </TouchableOpacity>
              );
            })}
          </Card>
        )}
      </ScrollView>
    </SafeScreen>
  );
}

function Row({ label, value, hint, sign, tone }: { label: string; value: string; hint?: string; sign?: '+' | '−'; tone?: 'success' | 'danger' }) {
  const { colors: c } = useTheme();
  const col = tone === 'success' ? c.success : tone === 'danger' ? c.danger : c.text;
  return (
    <View style={[s.row, { borderBottomColor: c.divider }]}>
      <Text style={{ color: col, width: 16, fontWeight: '900', fontSize: 15 }}>{sign || ''}</Text>
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.text, fontSize: 14, fontWeight: '700' }}>{label}</Text>
        {hint ? <Text style={{ color: c.textMuted, fontSize: 11.5, marginTop: 1 }}>{hint}</Text> : null}
      </View>
      <Text style={{ color: col, fontSize: 15, fontWeight: '800' }} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function Info({ icon, label, value, color, bg }: { icon: string; label: string; value: string; color: string; bg: string }) {
  const { colors: c } = useTheme();
  return (
    <View style={[s.info, { backgroundColor: bg, borderColor: c.borderLight }]}>
      <MaterialCommunityIcons name={icon as any} size={18} color={color} />
      <Text style={{ color: c.text, fontWeight: '900', fontSize: 16, marginTop: 6 }} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={{ color: c.textMuted, fontSize: 11.5, fontWeight: '700', marginTop: 2 }} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  refundRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, gap: 8 },
  refundBtn: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999 },
  banner: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', borderRadius: Radius.lg, padding: 14, marginBottom: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  totalRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 14, paddingHorizontal: 14 },
  infoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  info: { width: '48.5%', flexGrow: 1, borderRadius: Radius.md, padding: 12, borderWidth: StyleSheet.hairlineWidth },
  bigInput: { fontSize: 28, fontWeight: '900', borderRadius: Radius.md, borderWidth: 1.5, paddingHorizontal: 16, paddingVertical: 12 },
  counterToggle: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, minHeight: 44 },
  diff: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: Radius.md, padding: 14 },
  denomRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  step: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  denomInput: { width: 52, textAlign: 'center', fontSize: 16, fontWeight: '800', borderRadius: 10, paddingVertical: 8 },
  histRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, minHeight: 58 },
});
