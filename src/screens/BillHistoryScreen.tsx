import React, { useState, useCallback, useContext, useMemo, useEffect, useRef } from 'react';
import { View, FlatList, TouchableOpacity, Alert, ActivityIndicator, ScrollView } from 'react-native';
import { Text } from '../theme/Text';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeScreen } from '../components/SafeScreen';
import { SearchBar, Pill, Chip, BottomSheet, Button } from '../components/UI';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { DatabaseService, DBX } from '../database/Database';
import { AppContext } from '../context/AppContext';
import { WhatsAppService } from '../services/WhatsAppService';
import { parseDbDate, formatDateTime } from '../utils/helpers';
import { shareInvoicePDF, printBill, ReceiptWidth } from '../utils/invoice';
import { useTr } from '../i18n/tr';
import { localDateStr, showError } from '../components/formUtils';
import { CollectDueSheet } from '../components/CollectDueSheet';
import { useChoiceSheet } from '../components/ChoiceSheet';
import { appEvents } from '../components/appEvents';
import { appLocale, curSym } from '../config/regions';

type Filter = 'all' | 'today' | 'due' | 'cancelled';
type Range = '7' | '30' | '90' | 'all';
const PAGE = 50;

export default function BillHistoryScreen() {
  const { colors: c } = useTheme();
  const tr = useTr();
  const { can, user } = useAuth();
  const { currencySymbol, refresh } = useContext(AppContext);
  const [bills,   setBills]   = useState<any[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [dues,    setDues]    = useState<any[]>([]);
  const [search,  setSearch]  = useState('');
  const [query,   setQuery]   = useState('');      // debounced search sent to the database
  const [filter,  setFilter]  = useState<Filter>('all');
  const [range,   setRange]   = useState<Range>('30');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [profile, setProfile] = useState<any>({});
  const [receiptWidth, setReceiptWidth] = useState<ReceiptWidth>('a4');
  const [selected, setSelected] = useState<any>(null);
  const [collecting, setCollecting] = useState<any>(null);
  const [busy, setBusy] = useState<'' | 'void' | 'pdf' | 'print'>('');
  const choice = useChoiceSheet();
  const stale = useRef(true);
  const loadedKey = useRef('');
  const reqId = useRef(0);

  const today = localDateStr();

  // One page at a time from the database (no items JSON) — fast even with
  // years of bills. Filters and search run in SQL; "Dues" uses the dues list.
  const pageArgs = useCallback((f: Filter, r: Range, q: string) => {
    const from = f === 'today' ? today : r === 'all' ? undefined : localDateStr(new Date(Date.now() - (Number(r) - 1) * 86400000));
    return { from, to: f === 'today' ? today : undefined, status: f === 'cancelled' ? 'void' : undefined, search: q || undefined };
  }, [today]);

  const load = useCallback(async (f: Filter, r: Range, q: string) => {
    const id = ++reqId.current;
    setLoading(true);
    try {
      const [pg, p, w, d] = await Promise.all([
        f === 'due' ? Promise.resolve({ rows: [], hasMore: false }) : DBX.getBillsPage({ ...pageArgs(f, r, q), limit: PAGE, offset: 0 }),
        DatabaseService.getSalonProfile(),
        DatabaseService.getSetting('receipt_width'),
        (DBX as any).getDueBills ? DBX.getDueBills() : Promise.resolve([]),
      ]);
      if (id !== reqId.current) return; // a newer filter / search already started
      setBills(pg.rows || []);
      setHasMore(!!pg.hasMore);
      setDues((d as any[]) || []);
      setProfile(p || {});
      if (w === '58' || w === '80' || w === 'a4') setReceiptWidth(w);
      stale.current = false;
      loadedKey.current = `${f}|${r}|${q}`;
    } catch (e) { if (id === reqId.current) showError(e, 'Could not load bills'); }
    finally { if (id === reqId.current) setLoading(false); }
  }, [pageArgs]);

  async function loadMore() {
    if (loadingMore || !hasMore || filter === 'due') return;
    const id = reqId.current;
    setLoadingMore(true);
    try {
      const pg = await DBX.getBillsPage({ ...pageArgs(filter, range, query), limit: PAGE, offset: bills.length });
      if (id !== reqId.current) return;
      setBills(prev => {
        const seen = new Set(prev.map(x => x.id));
        return [...prev, ...(pg.rows || []).filter(x => !seen.has(x.id))];
      });
      setHasMore(!!pg.hasMore);
    } catch (e) { showError(e, 'Could not load bills'); }
    finally { setLoadingMore(false); }
  }

  useEffect(() => { const t = setTimeout(() => setQuery(search.trim()), 300); return () => clearTimeout(t); }, [search]);
  useEffect(() => appEvents.on('bill:created', () => { stale.current = true; }), []);
  useEffect(() => appEvents.on('bill:voided', () => { stale.current = true; }), []);
  useFocusEffect(useCallback(() => {
    if (stale.current || loadedKey.current !== `${filter}|${range}|${query}`) load(filter, range, query);
  }, [load, filter, range, query]));

  const sym = currencySymbol || curSym();
  const money = (n: number) => `${sym}${Number(n || 0).toLocaleString(appLocale(), { maximumFractionDigits: 2 })}`;

  const filtered = useMemo(() => {
    if (filter !== 'due') return bills;
    const q = query.toLowerCase();
    return dues.filter(b => !q ||
      String(b.bill_number || '').toLowerCase().includes(q) ||
      String(b.client_name || '').toLowerCase().includes(q) ||
      String(b.client_phone || '').includes(q));
  }, [bills, dues, query, filter]);

  const dueTotal = useMemo(() => dues.reduce((s, b) => s + (Number(b.amount_due) || 0), 0), [dues]);
  const page = filtered;
  const reload = () => load(filter, range, query);

  async function openBill(item: any) {
    if (item.items) { setSelected(item); return; }
    try {
      const full = await DatabaseService.getBill(item.id);
      setSelected(full || item);
    } catch (e) { showError(e, 'Could not open bill'); }
  }

  async function doShare(bill: any) {
    if (busy) return;
    setBusy('pdf');
    try { await shareInvoicePDF(bill, profile, sym); }
    catch (e) { showError(e, 'PDF not created', 'Could not create the PDF. Check that the phone has free storage.'); }
    finally { setBusy(''); }
  }
  async function doPrint(bill: any) {
    if (busy) return;
    setBusy('print');
    try { await printBill(bill, profile, sym, receiptWidth); }
    catch { Alert.alert(tr('Printer not found'), tr('No printer responded. For a thermal printer install its Android print service (for example RawBT) and try again.')); }
    finally { setBusy(''); }
  }
  function doWhatsApp(bill: any) {
    if (!bill.client_phone) return;
    try {
      const dueLine = bill.amount_due > 0 ? `\nBalance due: ${sym}${bill.amount_due}${profile.upi_id ? `\nPay by UPI: ${profile.upi_id}` : ''}` : '';
      const msg = `Hi ${bill.client_name || 'there'}! 😊\n\nThank you for visiting ${profile.name || 'our salon'}!\n\nBill #${bill.bill_number}\nDate: ${parseDbDate(bill.created_at).toLocaleDateString(appLocale())}\nTotal: ${sym}${bill.total}${dueLine}\n\nSee you again soon! ✂️`;
      Promise.resolve(WhatsAppService.sendMessage(bill.client_phone, msg)).catch(e => showError(e, 'WhatsApp did not open'));
    } catch (e) { showError(e, 'WhatsApp did not open'); }
  }

  function askVoid(bill: any) {
    setSelected(null);
    choice.open({
      title: tr('Cancel this bill?'),
      message: tr('Bill #{n} ({amt}) will be marked cancelled and a credit note issued. GST rules do not allow deleting an invoice. Products go back into stock.', { n: bill.bill_number, amt: money(bill.total) }),
      options: [
        { label: tr('Wrong entry'), icon: 'pencil-off-outline', tone: 'warning', onPress: () => doVoid(bill, 'Wrong entry') },
        { label: tr('Customer returned / refund'), icon: 'cash-refund', tone: 'danger', onPress: () => doVoid(bill, 'Refund / return') },
      ],
    });
  }
  async function doVoid(bill: any, reason: string) {
    if (busy) return;
    setBusy('void');
    try {
      const r = await DatabaseService.voidBill(bill.id, reason, user?.id);
      appEvents.emit('bill:voided', { billId: bill.id });
      await reload();
      try { refresh(); } catch { /* best effort */ }
      Alert.alert(tr('Bill cancelled'), tr('Credit note {n} issued.', { n: (r as any)?.creditNoteNumber || '' }));
    } catch (e) {
      showError(e, 'Could not cancel');
    } finally { setBusy(''); }
  }

  function statusPill(b: any) {
    if (b.payment_status === 'cancelled') return <Pill label={tr('Cancelled')} tone="danger" />;
    if (b.payment_status === 'credit_note') return <Pill label={tr('Credit note')} tone="danger" />;
    if ((b.payment_status === 'due' || filter === 'due') && b.amount_due > 0) return <Pill label={`${tr('Due')} ${money(b.amount_due)}`} tone="warning" />;
    return null;
  }

  const rangeLabel: Record<Range, string> = { '7': tr('7 days'), '30': tr('30 days'), '90': tr('90 days'), all: tr('All time') };

  return (
    <SafeScreen>
      <View style={{ paddingHorizontal: 16, paddingTop: 6, marginBottom: 10, gap: 10 }}>
        <SearchBar value={search} onChangeText={setSearch} placeholder={tr('Search bill #, client or phone…')} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <Chip label={filter === 'all' ? `${tr('All')} (${bills.length}${hasMore ? '+' : ''})` : tr('All')} active={filter === 'all'} onPress={() => setFilter('all')} />
          <Chip label={tr('Today')} icon="calendar-today" active={filter === 'today'} onPress={() => setFilter('today')} />
          <Chip label={dueTotal > 0 ? `${tr('Dues')} ${money(dueTotal)}` : tr('Dues')} icon="clock-alert-outline" active={filter === 'due'} onPress={() => setFilter('due')} />
          <Chip label={tr('Cancelled')} icon="cancel" active={filter === 'cancelled'} onPress={() => setFilter('cancelled')} />
        </ScrollView>
        {filter !== 'due' && filter !== 'today' && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {(['7', '30', '90', 'all'] as Range[]).map(r => (
              <TouchableOpacity key={r} onPress={() => setRange(r)}
                style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, marginRight: 6, backgroundColor: range === r ? c.primaryLight : 'transparent', borderWidth: 1, borderColor: range === r ? c.primary : c.border }}>
                <Text style={{ color: range === r ? c.primary : c.textMuted, fontWeight: '700', fontSize: 12 }}>{rangeLabel[r]}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </View>
      {loading && bills.length === 0
        ? <ActivityIndicator color={c.primary} style={{ marginTop: 40 }} />
        : (
          <FlatList data={page} keyExtractor={i => String(i.id)} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
            initialNumToRender={15} windowSize={7} keyboardShouldPersistTaps="handled"
            refreshing={loading} onRefresh={reload}
            onEndReached={loadMore} onEndReachedThreshold={0.4}
            renderItem={({ item }) => {
              const dead = item.payment_status === 'cancelled' || item.payment_status === 'credit_note';
              return (
                <TouchableOpacity activeOpacity={0.8} style={{ backgroundColor: c.card, borderRadius: 16, padding: 15, marginBottom: 10, flexDirection: 'row', alignItems: 'flex-start', borderWidth: 1, borderColor: c.borderLight, opacity: dead ? 0.7 : 1 }}
                  onPress={() => openBill(item)}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                      <Text style={{ color: c.primary, fontSize: 12, fontWeight: '700' }}>#{item.bill_number}</Text>
                      {statusPill(item)}
                    </View>
                    <Text style={{ color: c.text, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>{item.client_name || tr('Walk-in')}</Text>
                    <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 3 }}>{formatDateTime(item.created_at)}</Text>
                    {item.payment_method ? <Text style={{ color: c.textMuted, fontSize: 11.5, marginTop: 2 }}>{item.staff_name || '—'}  •  {String(item.payment_method || '').toUpperCase()}</Text> : null}
                  </View>
                  <Text style={{ color: dead ? c.textMuted : c.success, fontSize: 18, fontWeight: '900', textDecorationLine: item.payment_status === 'cancelled' ? 'line-through' : 'none' }}>{money(item.total)}</Text>
                </TouchableOpacity>
              );
            }}
            ListFooterComponent={filter !== 'due' && hasMore ? (
              <Button label={tr('Load more')} variant="subtle" size="sm" loading={loadingMore} onPress={loadMore} />
            ) : filtered.length > 0 && range !== 'all' && filter === 'all' ? (
              <TouchableOpacity onPress={() => setRange(range === '7' ? '30' : range === '30' ? '90' : 'all')} style={{ alignItems: 'center', padding: 14 }}>
                <Text style={{ color: c.primary, fontWeight: '700', fontSize: 13 }}>{tr('Show older bills')}</Text>
              </TouchableOpacity>
            ) : null}
            ListEmptyComponent={
              <View style={{ alignItems: 'center', marginTop: 60, gap: 12, paddingHorizontal: 24 }}>
                <MaterialCommunityIcons name="receipt" size={56} color={c.textLight} />
                <Text style={{ color: c.textMuted, fontSize: 14, textAlign: 'center' }}>
                  {search || filter !== 'all' ? tr('No bills match') : range !== 'all' ? tr('No bills in the last {n} days', { n: range }) : tr('No bills generated yet')}
                </Text>
                {!search && filter === 'all' && range !== 'all' ? (
                  <TouchableOpacity onPress={() => setRange('all')}><Text style={{ color: c.primary, fontWeight: '800' }}>{tr('Show all time')}</Text></TouchableOpacity>
                ) : null}
              </View>
            }
          />
        )
      }

      <BottomSheet visible={!!selected} onClose={() => setSelected(null)} title={selected ? `${tr('Bill')} #${selected.bill_number}` : ''}>
        {selected && (
          <View style={{ gap: 10 }}>
            <Text style={{ color: c.textSecondary }}>{selected.client_name || tr('Walk-in')} · {money(selected.total)} · {formatDateTime(selected.created_at)}</Text>
            {(selected.items || []).map((i: any, idx: number) => (
              <View key={`${i.type}-${i.id}-${idx}`} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
                <Text style={{ color: c.text, flex: 1 }} numberOfLines={1}>{i.name} × {i.qty || 1}</Text>
                <Text style={{ color: c.text, fontWeight: '700' }}>{money(i.price * (i.qty || 1))}</Text>
              </View>
            ))}

            {selected.payment_status === 'due' && selected.amount_due > 0 && can('billing.dues') && (
              <View style={{ backgroundColor: c.warningLight, borderRadius: 14, padding: 14, gap: 10, marginTop: 6 }}>
                <Text style={{ color: c.warning, fontWeight: '800' }}>{tr('Balance due')} {money(selected.amount_due)}</Text>
                <Button label={tr('Collect due')} icon="cash-plus" size="sm" color={c.warning} onPress={() => { const b = selected; setSelected(null); setTimeout(() => setCollecting(b), 250); }} />
              </View>
            )}

            <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
              <Button label="PDF" icon="file-pdf-box" size="sm" style={{ flex: 1 }} loading={busy === 'pdf'} disabled={!!busy} onPress={() => doShare(selected)} />
              <Button label={receiptWidth === 'a4' ? tr('Print') : tr('Print {w} mm', { w: receiptWidth })} icon="printer" size="sm" variant="subtle" style={{ flex: 1 }} loading={busy === 'print'} disabled={!!busy} onPress={() => doPrint(selected)} />
            </View>
            {selected.client_phone ? (
              <Button label={tr('Send on WhatsApp')} icon="whatsapp" size="sm" color={c.whatsapp} onPress={() => doWhatsApp(selected)} />
            ) : null}
            {can('billing.void') && selected.payment_status !== 'cancelled' && selected.payment_status !== 'credit_note' && (
              <Button label={tr('Cancel bill (credit note)')} icon="cancel" size="sm" variant="outline" color={c.danger} loading={busy === 'void'} disabled={!!busy} onPress={() => askVoid(selected)} />
            )}
          </View>
        )}
      </BottomSheet>

      <CollectDueSheet visible={!!collecting} bill={collecting} onClose={() => setCollecting(null)} currencySymbol={sym}
        onCollected={() => { reload(); try { refresh(); } catch { /* best effort */ } }} />
      {choice.element}
    </SafeScreen>
  );
}
