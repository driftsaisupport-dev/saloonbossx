import { phoneHint } from '../config/regions';
/**
 * Walk-in queue — a token board for barbershops and budget salons.
 *
 * Add a walk-in (name, optional phone, service note, preferred barber) → a big
 * token number. Call next → the oldest waiting token is served by the chosen
 * barber. Done / Left close a token (with undo). "Bill" opens Billing with the
 * customer and barber filled in. Display mode turns the phone / tablet into a
 * customer-facing "Now serving" board.
 *
 * Tokens restart at 1 every day (data layer: walkin_queue is keyed by date).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, ScrollView, TouchableOpacity, StyleSheet, Modal, RefreshControl, ActivityIndicator, StatusBar as RNStatusBar, Alert } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from '../theme/Text';
import { SafeScreen } from '../components/SafeScreen';
import { ScreenHeader, BottomSheet, Button, Input, Card, Chip, IconButton, EmptyState, SectionLabel } from '../components/UI';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { DatabaseService, DBX } from '../database/Database';
import { useTr } from '../i18n/tr';
import { useBusy } from '../components/useBusy';
import { normaliseIndianPhone, localDateStr, showError } from '../components/formUtils';
import { useChoiceSheet } from '../components/ChoiceSheet';
import { useUndoSnackbar } from '../components/UndoSnackbar';
import { WhatsAppService } from '../services/WhatsAppService';
import { parseDbDate } from '../utils/helpers';
import { Radius } from '../theme/colors';

type QStatus = 'waiting' | 'serving' | 'done' | 'left';
interface QRow {
  id: number; token_no: number; date: string; client_id: number; client_name: string; phone: string;
  service_note: string; staff_id: number; staff_name?: string | null; status: QStatus;
  created_at: string; called_at?: string; done_at?: string;
  /** The bill made for this token (0 = not billed yet). A token is billed once only. */
  bill_id?: number;
}
interface QStats { waiting: number; serving: number; done: number; left: number; avgWaitMin: number }
const EMPTY_STATS: QStats = { waiting: 0, serving: 0, done: 0, left: 0, avgWaitMin: 0 };

/** Whole minutes between a stored local stamp and `now` (never negative; 0 when unknown). */
function minutesSince(stamp: string | undefined, now: number): number {
  const t = parseDbDate(stamp || '').getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((now - t) / 60000));
}

export default function QueueScreen() {
  const { colors: c } = useTheme();
  const tr = useTr();
  const navigation = useNavigation<any>();
  const { can } = useAuth();
  const canBill = can('billing.create');
  const choice = useChoiceSheet();
  const undo = useUndoSnackbar({ bottomOffset: 92 });

  const [rows, setRows] = useState<QRow[]>([]);
  const [stats, setStats] = useState<QStats>(EMPTY_STATS);
  const [staff, setStaff] = useState<any[]>([]);
  const [services, setServices] = useState<string[]>([]);
  const [salonName, setSalonName] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [showDone, setShowDone] = useState(false);
  const [display, setDisplay] = useState(false);

  // Add-walk-in sheet
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [prefStaff, setPrefStaff] = useState(0);
  const [errors, setErrors] = useState<{ name?: string; phone?: string }>({});
  const [issued, setIssued] = useState<{ token: number; name: string; phone: string } | null>(null);

  const [saving, runSave] = useBusy('Walk-in not added');
  const [acting, runAct] = useBusy('Could not update the queue');
  const day = useRef(localDateStr());

  const load = useCallback(async () => {
    try {
      day.current = localDateStr();
      const [list, st] = await Promise.all([DBX.queueList(day.current), DBX.queueStats(day.current)]);
      setRows((list || []) as QRow[]);
      setStats(st || EMPTY_STATS);
      setLoadError(false);
    } catch (e) {
      console.warn('[queue] load', e);
      setLoadError(true);
    } finally { setLoading(false); }
  }, []);

  // Staff, services and the salon name change rarely — once per visit is enough.
  useEffect(() => {
    Promise.allSettled([DatabaseService.getStaff(), DatabaseService.getServices(), DatabaseService.getSalonProfile()]).then(([s, sv, p]) => {
      if (s.status === 'fulfilled') setStaff((s.value as any[]) || []);
      if (sv.status === 'fulfilled') setServices(((sv.value as any[]) || []).map(x => String(x.name || '')).filter(Boolean).slice(0, 8));
      if (p.status === 'fulfilled') setSalonName(String((p.value as any)?.name || ''));
    });
  }, []);

  useFocusEffect(useCallback(() => {
    load();
    // Live wait times; also picks up a new day if the screen is left open past midnight.
    const t = setInterval(() => {
      setNow(Date.now());
      if (localDateStr() !== day.current) load();
    }, 30_000);
    return () => clearInterval(t);
  }, [load]));

  async function pullRefresh() { setRefreshing(true); await load(); setNow(Date.now()); setRefreshing(false); }

  const serving = useMemo(() => rows.filter(r => r.status === 'serving'), [rows]);
  const waiting = useMemo(() => rows.filter(r => r.status === 'waiting').sort((a, b) => a.token_no - b.token_no), [rows]);
  const finished = useMemo(() => rows.filter(r => r.status === 'done' || r.status === 'left').sort((a, b) => b.token_no - a.token_no), [rows]);
  const staffName = (id: number) => staff.find(s => s.id === id)?.name || '';

  // ── Add walk-in ───────────────────────────────────────────────────────────
  function openAdd() {
    setName(''); setPhone(''); setNote(''); setPrefStaff(0); setErrors({});
    setAdding(true);
  }

  function saveWalkin() {
    runSave(async () => {
      const nm = name.trim();
      const rawPhone = phone.trim();
      const ph = rawPhone ? normaliseIndianPhone(rawPhone) : '';
      const errs: typeof errors = {};
      if (rawPhone && !ph) errs.phone = `${phoneHint()} ${tr('Or leave it empty.')}`;
      // A known customer can be added by phone alone.
      const known = ph ? await DBX.findClientByPhone(ph).catch(() => null) : null;
      if (!nm && !known) errs.name = tr('Type the customer name.');
      setErrors(errs);
      if (errs.name || errs.phone) return;
      const r = await DBX.queueAdd({
        client_name: nm || known?.name || '',
        phone: ph,
        client_id: known?.id || undefined,
        service_note: note.trim(),
        staff_id: prefStaff || undefined,
      });
      setAdding(false);
      await load();
      setTimeout(() => setIssued({ token: r.token_no, name: nm || known?.name || '', phone: ph }), 250);
    });
  }

  function sendTokenOnWhatsApp() {
    if (!issued?.phone) return;
    const ahead = Math.max(0, waiting.filter(w => w.token_no < issued.token).length);
    const msg = `${tr('Hi {name}!', { name: issued.name || '' })} 👋\n\n${tr('Your token at {salon} is {token}.', { salon: salonName || tr('our salon'), token: issued.token })}\n${ahead > 0 ? tr('{n} ahead of you.', { n: ahead }) : tr('You are next!')}\n\n${tr('We will call you soon.')} ✂️`;
    Promise.resolve(WhatsAppService.sendMessage(issued.phone, msg)).catch(e => showError(e, 'WhatsApp did not open'));
  }

  // ── Calling / serving ─────────────────────────────────────────────────────
  /** Ask which barber (preferred one first). Resolves 0 for "any / skip", null when cancelled. */
  function pickBarber(row: QRow): Promise<number | null> {
    const active = staff;
    if (active.length === 0) return Promise.resolve(0);
    if (active.length === 1) return Promise.resolve(active[0].id);
    return new Promise(resolve => {
      const busyIds = new Set(serving.map(s => s.staff_id).filter(Boolean));
      const sorted = [...active].sort((a, b) => (a.id === row.staff_id ? -1 : b.id === row.staff_id ? 1 : 0));
      choice.open({
        title: tr('Token {n} · who will serve?', { n: row.token_no }),
        message: row.client_name ? `${row.client_name}${row.service_note ? ` · ${row.service_note}` : ''}` : undefined,
        options: sorted.map(s => ({
          label: s.name,
          hint: s.id === row.staff_id ? tr('Asked for') : busyIds.has(s.id) ? tr('Busy with another token') : tr('Free'),
          icon: 'account-tie',
          tone: s.id === row.staff_id ? 'success' : busyIds.has(s.id) ? 'neutral' : 'primary',
          selected: s.id === row.staff_id,
          onPress: () => resolve(s.id),
        })),
        onCancel: () => resolve(null),
      });
    });
  }

  function serve(row: QRow) {
    if (acting) return;
    // Pick the barber first (no spinner while the owner is choosing), then write.
    pickBarber(row).then(staffId => {
      if (staffId === null) return;
      runAct(async () => {
        await DBX.queueSetStatus(row.id, 'serving', staffId || undefined);
        await load();
      });
    }).catch(e => showError(e, 'Could not update the queue'));
  }

  function callNext() {
    const next = waiting[0];
    if (!next) return;
    serve(next);
  }

  function close(row: QRow, status: 'done' | 'left') {
    runAct(async () => {
      const prev = row.status;
      await DBX.queueSetStatus(row.id, status);
      await load();
      undo.show(
        status === 'done' ? tr('Token {n} done', { n: row.token_no }) : tr('Token {n} left', { n: row.token_no }),
        async () => { await DBX.queueSetStatus(row.id, prev); await load(); },
      );
    });
  }

  function rowMenu(row: QRow) {
    const opts: any[] = [];
    if (row.status === 'waiting') {
      opts.push({ label: tr('Serve now'), icon: 'account-arrow-right', tone: 'primary', onPress: () => serve(row) });
      opts.push({ label: tr('Left without service'), icon: 'exit-run', tone: 'danger', onPress: () => close(row, 'left') });
    } else if (row.status === 'serving') {
      opts.push({ label: tr('Mark done'), icon: 'check-circle', tone: 'success', onPress: () => close(row, 'done') });
      if (canBill && !Number(row.bill_id)) opts.push({ label: tr('Bill this customer'), icon: 'receipt-text-outline', tone: 'primary', onPress: () => bill(row) });
      opts.push({ label: tr('Change barber'), icon: 'account-switch', tone: 'info', onPress: () => serve(row) });
      opts.push({ label: tr('Back to waiting'), icon: 'undo', tone: 'neutral', onPress: () => runAct(async () => { await DBX.queueSetStatus(row.id, 'waiting'); await load(); }) });
      opts.push({ label: tr('Left without service'), icon: 'exit-run', tone: 'danger', onPress: () => close(row, 'left') });
    } else {
      if (canBill && row.status === 'done' && !Number(row.bill_id)) opts.push({ label: tr('Bill this customer'), icon: 'receipt-text-outline', tone: 'primary', onPress: () => bill(row) });
      opts.push({ label: tr('Back to waiting'), icon: 'undo', tone: 'neutral', onPress: () => runAct(async () => { await DBX.queueSetStatus(row.id, 'waiting'); await load(); }) });
    }
    if (row.phone) opts.push({ label: tr('Call {phone}', { phone: row.phone }), icon: 'phone', tone: 'neutral', onPress: () => WhatsAppService.call(row.phone) });
    choice.open({ title: tr('Token {n}', { n: row.token_no }), message: [row.client_name, row.service_note].filter(Boolean).join(' · ') || undefined, options: opts });
  }

  /**
   * Open Billing with the customer and barber filled in (BillingScreen params:
   * client / client_id / staff_id / reset). A walk-in with a phone becomes a
   * saved client so dues, loyalty and reminders work; without a phone the bill
   * stays a walk-in bill.
   */
  function bill(row: QRow) {
    if (!canBill) return;
    if (Number(row.bill_id) > 0) { Alert.alert(tr('Already billed'), tr('Token {n} already has a bill. Open it from Bill History.', { n: row.token_no })); return; }
    runAct(async () => {
      let client: any = null;
      if (row.client_id) client = await DatabaseService.getClient(row.client_id).catch(() => null);
      if (!client && row.phone) {
        client = await DBX.findClientByPhone(row.phone).catch(() => null);
        if (!client && can('clients.edit') && row.client_name) {
          const id = Number(await DatabaseService.addClient({ name: row.client_name, phone: row.phone, referral_source: 'Walk-in' }));
          client = id ? await DatabaseService.getClient(id).catch(() => null) : null;
        }
      }
      if (row.status === 'serving') await DBX.queueSetStatus(row.id, 'done');
      navigation.navigate('Billing', {
        reset: true,
        queue_id: row.id,
        ...(client ? { client } : {}),
        ...(row.staff_id ? { staff_id: row.staff_id } : {}),
      });
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const header = (
    <ScreenHeader
      title={tr('Walk-in queue')}
      subtitle={tr('Tokens restart every morning')}
      onBack={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Main'))}
      right={<IconButton icon="television-play" tone="primary" onPress={() => setDisplay(true)} />}
    />
  );

  if (loading) {
    return (
      <SafeScreen>
        {header}
        <ActivityIndicator color={c.primary} style={{ marginTop: 60 }} />
      </SafeScreen>
    );
  }

  return (
    <SafeScreen>
      {header}
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={pullRefresh} tintColor={c.primary} />}>

        {loadError && (
          <Card style={{ backgroundColor: c.dangerLight, borderColor: c.danger + '40' }}>
            <Text style={{ color: c.danger, fontWeight: '800' }}>{tr('Queue did not load')}</Text>
            <Text style={{ color: c.textSecondary, fontSize: 12.5, marginTop: 4 }}>{tr('Pull down to try again.')}</Text>
          </Card>
        )}

        {/* Stats */}
        <View style={st.statsRow}>
          <Stat label={tr('Waiting')} value={String(stats.waiting)} color={c.warning} bg={c.warningLight} />
          <Stat label={tr('Serving')} value={String(stats.serving)} color={c.primary} bg={c.primaryLight} />
          <Stat label={tr('Avg wait')} value={stats.avgWaitMin ? tr('{n} min', { n: stats.avgWaitMin }) : '—'} color={c.info} bg={c.infoLight} />
          <Stat label={tr('Done')} value={String(stats.done)} color={c.success} bg={c.successLight} />
        </View>

        {/* Call next */}
        <TouchableOpacity
          disabled={!waiting.length || acting}
          onPress={callNext}
          activeOpacity={0.85}
          accessibilityRole="button"
          style={[st.callNext, { backgroundColor: waiting.length ? c.primary : c.surface, opacity: acting ? 0.7 : 1 }]}>
          {acting ? <ActivityIndicator color={c.onPrimary} /> : (
            <>
              <MaterialCommunityIcons name="bullhorn-outline" size={26} color={waiting.length ? c.onPrimary : c.textMuted} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: waiting.length ? c.onPrimary : c.textMuted, fontSize: 18, fontWeight: '900' }}>
                  {waiting.length ? tr('Call next · Token {n}', { n: waiting[0].token_no }) : tr('No one waiting')}
                </Text>
                {waiting.length ? (
                  <Text style={{ color: c.onPrimary, opacity: 0.85, fontSize: 12.5, marginTop: 2 }} numberOfLines={1}>
                    {[waiting[0].client_name, waiting[0].service_note, waiting[0].staff_id ? tr('asked for {name}', { name: staffName(waiting[0].staff_id) || waiting[0].staff_name || '' }) : ''].filter(Boolean).join(' · ')}
                  </Text>
                ) : null}
              </View>
              {waiting.length ? <MaterialCommunityIcons name="chevron-right" size={24} color={c.onPrimary} /> : null}
            </>
          )}
        </TouchableOpacity>

        {/* Serving */}
        {serving.length > 0 && (
          <>
            <SectionLabel style={{ marginTop: 18 }}>{tr('Serving now')}</SectionLabel>
            {serving.map(r => (
              <Card key={r.id} padded={false} style={{ borderColor: c.primary + '55', borderWidth: 1 }}>
                <TouchableOpacity activeOpacity={0.8} onPress={() => rowMenu(r)} style={st.servingRow}>
                  <View style={[st.tokenBig, { backgroundColor: c.primary }]}>
                    <Text style={{ color: c.onPrimary, fontSize: 26, fontWeight: '900' }} numberOfLines={1} adjustsFontSizeToFit>{r.token_no}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.text, fontSize: 15.5, fontWeight: '800' }} numberOfLines={1}>{r.client_name || tr('Walk-in')}</Text>
                    <Text style={{ color: c.textMuted, fontSize: 12.5, marginTop: 2 }} numberOfLines={1}>
                      {[r.staff_name || staffName(r.staff_id), r.service_note, tr('{n} min in chair', { n: minutesSince(r.called_at, now) })].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <MaterialCommunityIcons name="dots-vertical" size={20} color={c.textMuted} />
                </TouchableOpacity>
                <View style={[st.actions, { borderTopColor: c.divider }]}>
                  <ActionBtn icon="check-circle-outline" label={tr('Done')} color={c.success} onPress={() => close(r, 'done')} disabled={acting} />
                  {canBill && !Number(r.bill_id) && <ActionBtn icon="receipt-text-outline" label={tr('Bill')} color={c.primary} onPress={() => bill(r)} disabled={acting} />}
                  <ActionBtn icon="exit-run" label={tr('Left')} color={c.danger} onPress={() => close(r, 'left')} disabled={acting} />
                </View>
              </Card>
            ))}
          </>
        )}

        {/* Waiting */}
        <SectionLabel style={{ marginTop: 18 }}>{tr('Waiting ({n})', { n: waiting.length })}</SectionLabel>
        {waiting.length === 0 ? (
          rows.length === 0 ? (
            <EmptyState icon="ticket-outline" title={tr('No walk-ins yet today')} subtitle={tr('Add a walk-in to give them a token. Tokens start from 1 every morning.')} actionLabel={tr('Add walk-in')} onAction={openAdd} />
          ) : (
            <Text style={{ color: c.textMuted, fontSize: 13, marginBottom: 8 }}>{tr('Everyone has been called.')}</Text>
          )
        ) : (
          <Card padded={false}>
            {waiting.map((r, i) => {
              const mins = minutesSince(r.created_at, now);
              const long = mins >= 30;
              return (
                <TouchableOpacity key={r.id} activeOpacity={0.7} onPress={() => rowMenu(r)}
                  style={[st.waitRow, { borderBottomColor: c.divider, borderBottomWidth: i === waiting.length - 1 ? 0 : StyleSheet.hairlineWidth }]}>
                  <View style={[st.tokenSm, { backgroundColor: i === 0 ? c.primaryLight : c.surface }]}>
                    <Text style={{ color: i === 0 ? c.primary : c.text, fontSize: 18, fontWeight: '900' }} numberOfLines={1} adjustsFontSizeToFit>{r.token_no}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.text, fontSize: 14.5, fontWeight: '700' }} numberOfLines={1}>{r.client_name || tr('Walk-in')}</Text>
                    <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                      {[r.service_note, r.staff_id ? tr('asked for {name}', { name: r.staff_name || staffName(r.staff_id) }) : ''].filter(Boolean).join(' · ') || tr('Any barber')}
                    </Text>
                  </View>
                  <View style={[st.waitPill, { backgroundColor: long ? c.dangerLight : c.surface }]}>
                    <MaterialCommunityIcons name="timer-sand" size={12} color={long ? c.danger : c.textMuted} />
                    <Text style={{ color: long ? c.danger : c.textSecondary, fontSize: 12, fontWeight: '800' }}>{tr('{n} min', { n: mins })}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </Card>
        )}

        {/* Done / left today */}
        {finished.length > 0 && (
          <>
            <TouchableOpacity onPress={() => setShowDone(v => !v)} style={st.doneToggle} accessibilityRole="button">
              <SectionLabel style={{ marginBottom: 0, flex: 1 }}>{tr('Done today ({n})', { n: finished.length })}</SectionLabel>
              <MaterialCommunityIcons name={showDone ? 'chevron-up' : 'chevron-down'} size={20} color={c.textMuted} />
            </TouchableOpacity>
            {showDone && (
              <Card padded={false}>
                {finished.map((r, i) => (
                  <TouchableOpacity key={r.id} activeOpacity={0.7} onPress={() => rowMenu(r)}
                    style={[st.waitRow, { borderBottomColor: c.divider, borderBottomWidth: i === finished.length - 1 ? 0 : StyleSheet.hairlineWidth }]}>
                    <View style={[st.tokenSm, { backgroundColor: c.surface }]}>
                      <Text style={{ color: c.textMuted, fontSize: 16, fontWeight: '900' }}>{r.token_no}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: c.text, fontSize: 14, fontWeight: '700' }} numberOfLines={1}>{r.client_name || tr('Walk-in')}</Text>
                      <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                        {[r.staff_name || staffName(r.staff_id), r.service_note].filter(Boolean).join(' · ') || '—'}
                      </Text>
                    </View>
                    <Text style={{ color: r.status === 'done' ? c.success : c.danger, fontSize: 12, fontWeight: '800' }}>
                      {r.status === 'done' ? tr('Done') : tr('Left')}
                    </Text>
                    {Number(r.bill_id) > 0 ? (
                      <Text style={{ color: c.textMuted, fontSize: 12, fontWeight: '800', marginLeft: 6 }}>{tr('Billed')}</Text>
                    ) : canBill && r.status === 'done' ? (
                      <TouchableOpacity onPress={() => bill(r)} disabled={acting} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        style={[st.billChip, { backgroundColor: c.primaryLight }]}>
                        <Text style={{ color: c.primary, fontSize: 12, fontWeight: '800' }}>{tr('Bill')}</Text>
                      </TouchableOpacity>
                    ) : null}
                  </TouchableOpacity>
                ))}
              </Card>
            )}
          </>
        )}
      </ScrollView>

      {/* Add walk-in button */}
      <TouchableOpacity onPress={openAdd} activeOpacity={0.9} accessibilityRole="button"
        style={[st.fab, { backgroundColor: c.primary }]}>
        <MaterialCommunityIcons name="ticket-confirmation-outline" size={22} color={c.onPrimary} />
        <Text style={{ color: c.onPrimary, fontWeight: '900', fontSize: 15 }}>{tr('Add walk-in')}</Text>
      </TouchableOpacity>

      {/* Add sheet */}
      <BottomSheet visible={adding} onClose={() => !saving && setAdding(false)} title={tr('Add walk-in')}
        footer={<Button label={tr('Give token')} icon="ticket-confirmation-outline" loading={saving} onPress={saveWalkin} />}>
        <Input label={tr('Customer name')} icon="account-outline" value={name} onChangeText={(v: string) => { setName(v); if (errors.name) setErrors(e => ({ ...e, name: undefined })); }}
          placeholder={tr('e.g. Ramesh')} autoCapitalize="words" maxLength={60} error={errors.name} returnKeyType="next" />
        <Input label={tr('Mobile (optional)')} icon="phone-outline" value={phone} onChangeText={(v: string) => { setPhone(v); if (errors.phone) setErrors(e => ({ ...e, phone: undefined })); }}
          placeholder="98765 43210" keyboardType="phone-pad" maxLength={16} error={errors.phone}
          hint={tr('To send the token on WhatsApp and save them as a client')} />
        <Input label={tr('Service (optional)')} icon="content-cut" value={note} onChangeText={setNote} placeholder={tr('e.g. Haircut + beard')} maxLength={200} />
        {services.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ marginTop: -6, marginBottom: 14 }}>
            {services.map(sv => (
              <Chip key={sv} label={sv} active={note === sv} onPress={() => setNote(note === sv ? '' : sv)} />
            ))}
          </ScrollView>
        )}
        {staff.length > 1 && (
          <>
            <Text style={{ color: c.textSecondary, fontSize: 12.5, fontWeight: '700', marginBottom: 7 }}>{tr('Preferred barber')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Chip label={tr('Anyone')} active={!prefStaff} onPress={() => setPrefStaff(0)} />
              {staff.map(s => <Chip key={s.id} label={s.name} active={prefStaff === s.id} onPress={() => setPrefStaff(s.id)} />)}
            </ScrollView>
          </>
        )}
      </BottomSheet>

      {/* Token issued */}
      <BottomSheet visible={!!issued} onClose={() => setIssued(null)} title={tr('Token given')}>
        {issued && (
          <View style={{ alignItems: 'center', paddingBottom: 6 }}>
            <Text style={{ color: c.textMuted, fontSize: 13, fontWeight: '800', letterSpacing: 1 }}>{tr('TOKEN')}</Text>
            <Text style={{ color: c.primary, fontSize: 96, fontWeight: '900', lineHeight: 110 }} numberOfLines={1} adjustsFontSizeToFit>{issued.token}</Text>
            {issued.name ? <Text style={{ color: c.text, fontSize: 17, fontWeight: '800' }}>{issued.name}</Text> : null}
            <Text style={{ color: c.textMuted, fontSize: 13, marginTop: 4, marginBottom: 18 }}>
              {(() => { const ahead = waiting.filter(w => w.token_no < issued.token).length + serving.length; return ahead ? tr('{n} ahead in the queue', { n: ahead }) : tr('Next in line'); })()}
            </Text>
            <View style={{ alignSelf: 'stretch', gap: 10 }}>
              {issued.phone ? <Button label={tr('Send token on WhatsApp')} icon="whatsapp" color={c.whatsapp} onPress={sendTokenOnWhatsApp} /> : null}
              <Button label={tr('Done')} variant="subtle" onPress={() => setIssued(null)} />
            </View>
          </View>
        )}
      </BottomSheet>

      <DisplayBoard visible={display} onClose={() => setDisplay(false)} onRefresh={load}
        serving={serving} waiting={waiting} salonName={salonName} staffName={staffName} />

      {choice.element}
      {undo.element}
    </SafeScreen>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────
function Stat({ label, value, color, bg }: { label: string; value: string; color: string; bg: string }) {
  return (
    <View style={[st.stat, { backgroundColor: bg }]}>
      <Text style={{ color, fontSize: 20, fontWeight: '900' }} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={{ color, fontSize: 11, fontWeight: '800', marginTop: 2, opacity: 0.9 }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{label}</Text>
    </View>
  );
}

function ActionBtn({ icon, label, color, onPress, disabled }: { icon: string; label: string; color: string; onPress: () => void; disabled?: boolean }) {
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled} activeOpacity={0.7} style={[st.actionBtn, { opacity: disabled ? 0.5 : 1 }]} accessibilityRole="button">
      <MaterialCommunityIcons name={icon as any} size={19} color={color} />
      <Text style={{ color, fontWeight: '800', fontSize: 13.5 }}>{label}</Text>
    </TouchableOpacity>
  );
}

/**
 * Customer-facing board for a TV / tablet: "Now serving 23 · Next 24, 25".
 * Refreshes every 10 s. (Screen stays awake only if the phone's own display
 * timeout allows — expo-keep-awake is not bundled in this build.)
 */
function DisplayBoard({ visible, onClose, onRefresh, serving, waiting, salonName, staffName }: {
  visible: boolean; onClose: () => void; onRefresh: () => Promise<void> | void;
  serving: QRow[]; waiting: QRow[]; salonName: string; staffName: (id: number) => string;
}) {
  const { colors: c } = useTheme();
  const tr = useTr();
  useEffect(() => {
    if (!visible) return;
    const t = setInterval(() => { Promise.resolve(onRefresh()).catch(() => {}); }, 10_000);
    return () => clearInterval(t);
  }, [visible, onRefresh]);
  const next = waiting.slice(0, 4);
  const nowServing = [...serving].sort((a, b) => b.token_no - a.token_no);
  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose} statusBarTranslucent supportedOrientations={['portrait', 'landscape']}>
      <RNStatusBar hidden />
      <View style={[st.board, { backgroundColor: c.brandInk }]}>
        <View style={st.boardTop}>
          <Text style={{ color: c.brandGoldLight, fontSize: 16, fontWeight: '800', flex: 1 }} numberOfLines={1}>{salonName || tr('Walk-in queue')}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }} accessibilityLabel={tr('Close')}
            style={[st.boardClose, { backgroundColor: 'transparent', borderColor: c.brandGoldLight + '55' }]}>
            <MaterialCommunityIcons name="close" size={22} color={c.brandGoldLight} />
          </TouchableOpacity>
        </View>

        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ color: c.brandGoldLight, fontSize: 20, fontWeight: '800', letterSpacing: 3 }}>{tr('NOW SERVING')}</Text>
          {nowServing.length === 0 ? (
            <Text style={{ color: c.brandGold, fontSize: 64, fontWeight: '900', marginTop: 8 }}>—</Text>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 28, marginTop: 6 }}>
              {nowServing.slice(0, 3).map(r => (
                <View key={r.id} style={{ alignItems: 'center' }}>
                  <Text style={{ color: c.brandGold, fontSize: nowServing.length > 1 ? 96 : 150, fontWeight: '900', lineHeight: nowServing.length > 1 ? 110 : 168 }} numberOfLines={1}>{r.token_no}</Text>
                  {(r.staff_name || staffName(r.staff_id)) ? (
                    <Text style={{ color: c.brandGoldLight, fontSize: 18, fontWeight: '700' }} numberOfLines={1}>{r.staff_name || staffName(r.staff_id)}</Text>
                  ) : null}
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={[st.boardNext, { borderTopColor: c.brandGoldLight + '33' }]}>
          <Text style={{ color: c.brandGoldLight, fontSize: 16, fontWeight: '800', letterSpacing: 2 }}>{tr('NEXT')}</Text>
          {next.length === 0 ? (
            <Text style={{ color: c.brandGoldLight, fontSize: 22, fontWeight: '700', opacity: 0.7 }}>{tr('No one waiting')}</Text>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
              {next.map(r => (
                <View key={r.id} style={[st.boardChip, { borderColor: c.brandGoldLight + '66' }]}>
                  <Text style={{ color: c.brandGoldLight, fontSize: 34, fontWeight: '900' }}>{r.token_no}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  stat: { flex: 1, borderRadius: Radius.md, paddingVertical: 10, paddingHorizontal: 6, alignItems: 'center' },
  callNext: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: Radius.lg, padding: 16, minHeight: 72 },
  servingRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  tokenBig: { width: 60, height: 60, borderRadius: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  tokenSm: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  actions: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, minHeight: 46 },
  waitRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, minHeight: 64 },
  waitPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999 },
  billChip: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, marginLeft: 6 },
  doneToggle: { flexDirection: 'row', alignItems: 'center', marginTop: 18, marginBottom: 10, minHeight: 32 },
  fab: { position: 'absolute', right: 16, left: 16, bottom: 24, height: 56, borderRadius: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, elevation: 6 },
  board: { flex: 1, padding: 28 },
  boardTop: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 8 },
  boardClose: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  boardNext: { borderTopWidth: 1, paddingTop: 18, paddingBottom: 12, gap: 10, alignItems: 'center' },
  boardChip: { borderWidth: 1.5, borderRadius: 18, paddingHorizontal: 22, paddingVertical: 6, minWidth: 84, alignItems: 'center' },
});
