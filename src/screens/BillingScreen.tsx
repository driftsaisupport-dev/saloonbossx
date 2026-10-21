import { phoneHint, payLabel } from '../config/regions';
import React, { useState, useEffect, useContext, useRef, useMemo } from 'react';
import { View, ScrollView, TouchableOpacity, Alert, FlatList, Switch, ActivityIndicator, StyleSheet } from 'react-native';
import { Text, TextInput } from '../theme/Text';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeScreen } from '../components/SafeScreen';
import { BottomModal } from '../components/BottomModal';
import { BottomSheet, Button } from '../components/UI';
import { useTheme } from '../context/ThemeContext';
import { DatabaseService, DBX } from '../database/Database';
import { useAuth } from '../context/AuthContext';
import { BossAI } from '../services/ai/BossAI';
import { shareInvoicePDF, printBill, upiQrSvg, upiString, ReceiptWidth } from '../utils/invoice';
import { SvgXml } from 'react-native-svg';
import { toLocalDateStr } from '../utils/helpers';
import { AppContext } from '../context/AppContext';
import { ReviewService } from '../services/ReviewService';
import { WhatsAppService } from '../services/WhatsAppService';
import { useTr } from '../i18n/tr';
import {
  parseAmount, cleanAmountInput, round2, normaliseIndianPhone, showError, confirmAsync, phoneKey,
} from '../components/formUtils';
import { computeBillTotals, planBillPayment } from '../utils/money';
import { appEvents } from '../components/appEvents';
import { ClientAlertBadge } from '../components/ClientAlertBadge';

function fmt(n: number): string {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, '');
}

type PayMethod = 'cash' | 'upi' | 'card' | 'split' | 'due';

/** Back to a normal priced line (drops the package cover). */
function unPackage(it: any) {
  if (!it?.package_cm_id) return it;
  const { package_cm_id, package_name, list_price, ...rest } = it;
  return { ...rest, price: Number(list_price) || 0 };
}

/**
 * Bill maths lives in utils/money (computeBillTotals / planBillPayment) so the
 * figures shown here are exactly the ones createBill validates — and tested.
 *  • discount and loyalty both come off BEFORE tax (taxable = gross − discount − loyalty)
 *  • when prices include GST, tax is carved out of the net: taxable = net/(1+r)
 */
function computeTotals(p: {
  items: any[]; discountType: 'flat' | 'percent'; discountValue: string; applyGST: boolean;
  ratePct: number; inclusive: boolean; clientPoints: number; redeem: boolean; pointsToRedeem: string;
}) {
  const dv = parseAmount(p.discountValue);
  return computeBillTotals({
    ...p,
    discountValue: isNaN(dv) ? 0 : dv,
    pointsToRedeem: parseInt(String(p.pointsToRedeem).replace(/\D/g, ''), 10) || 0,
  });
}

// Success state after bill is generated (the stack header already shows the title).
function BillSuccessView({ billNumber, total, pointsEarned, currencySymbol, c, tr, onSharePDF, onWhatsApp, onNewBill, onHistory, onPrint, printLabel, qrSvg, due, busy, payNow, walletUsed, walletBalance, advanceUsed, advanceToWallet, packageLines, lowStock }: any) {
  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
      <View style={{ width: 90, height: 90, borderRadius: 45, backgroundColor: c.successLight, alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
        <MaterialCommunityIcons name="check-circle" size={52} color={c.success} />
      </View>
      <Text style={{ color: c.text, fontSize: 26, fontWeight: '900', marginBottom: 6, textAlign: 'center' }}>{tr('Bill Generated!')}</Text>
      <Text style={{ color: c.textMuted, fontSize: 15, marginBottom: 4 }}>{tr('Bill')} #{billNumber}</Text>
      <Text style={{ color: c.primary, fontSize: 28, fontWeight: '900', marginBottom: 8 }}>{currencySymbol}{total}</Text>
      {pointsEarned > 0 && (
        <View style={{ backgroundColor: c.successLight, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8, marginBottom: 16 }}>
          <Text style={{ color: c.success, fontWeight: '700', fontSize: 13 }}>🎉 {tr('+{n} loyalty points earned', { n: pointsEarned })}</Text>
        </View>
      )}
      {(advanceUsed > 0 || walletUsed > 0 || packageLines > 0 || advanceToWallet > 0) && (
        <View style={{ alignSelf: 'stretch', backgroundColor: c.surface, borderRadius: 12, padding: 12, marginBottom: 12, gap: 4 }}>
          {advanceUsed > 0 && <Text style={{ color: c.textSecondary, fontSize: 13 }}>✓ {tr('Advance adjusted: {amt}', { amt: `${currencySymbol}${fmt(advanceUsed)}` })}</Text>}
          {walletUsed > 0 && <Text style={{ color: c.textSecondary, fontSize: 13 }}>✓ {tr('Paid from wallet: {amt}', { amt: `${currencySymbol}${fmt(walletUsed)}` })}</Text>}
          {advanceToWallet > 0 && <Text style={{ color: c.textSecondary, fontSize: 13 }}>✓ {tr('Unused advance added to wallet: {amt}', { amt: `${currencySymbol}${fmt(advanceToWallet)}` })}</Text>}
          {walletBalance != null && <Text style={{ color: c.primary, fontSize: 13, fontWeight: '800' }}>💳 {tr('Wallet balance left: {amt}', { amt: `${currencySymbol}${fmt(walletBalance)}` })}</Text>}
          {packageLines > 0 && <Text style={{ color: c.textSecondary, fontSize: 13 }}>✓ {tr('{n} line(s) covered by package', { n: packageLines })}</Text>}
        </View>
      )}
      {Array.isArray(lowStock) && lowStock.length > 0 && (
        <View style={{ alignSelf: 'stretch', backgroundColor: c.warningLight, borderRadius: 12, padding: 12, marginBottom: 12 }}>
          <Text style={{ color: c.warning, fontWeight: '900', fontSize: 13, marginBottom: 4 }}>⚠️ {tr('Low stock — please restock soon')}</Text>
          {lowStock.map((l: string, i: number) => <Text key={i} style={{ color: c.warning, fontSize: 12.5 }}>• {l}</Text>)}
        </View>
      )}
      {due > 0 && (
        <View style={{ backgroundColor: c.warningLight, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8, marginBottom: 12 }}>
          <Text style={{ color: c.warning, fontWeight: '800', fontSize: 13 }}>⏳ {tr('{amt} to be collected later', { amt: `${currencySymbol}${due}` })}</Text>
        </View>
      )}
      {qrSvg ? (
        // QR stays black-on-white in both themes so every UPI app can scan it.
        <View style={{ alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 16, padding: 12, marginBottom: 12 }}>
          <SvgXml xml={qrSvg} width={170} height={170} />
          <Text style={{ color: '#1C1612', fontSize: 12, fontWeight: '700', marginTop: 4 }}>{tr('Customer scans to pay {amt}', { amt: `${currencySymbol}${fmt(payNow ?? (due > 0 ? due : total))}` })}</Text>
        </View>
      ) : null}
      <View style={{ width: '100%', gap: 10, marginTop: 8 }}>
        <Button label={tr('Share PDF Invoice')} icon="file-pdf-box" onPress={onSharePDF} loading={busy === 'pdf'} disabled={!!busy} />
        {onPrint && <Button label={printLabel} icon="printer-outline" variant="outline" color={c.text} onPress={onPrint} loading={busy === 'print'} disabled={!!busy} />}
        {onWhatsApp && <Button label={tr('Send via WhatsApp')} icon="whatsapp" color={c.whatsapp} onPress={onWhatsApp} loading={busy === 'wa'} disabled={!!busy} />}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TouchableOpacity style={{ flex: 1, backgroundColor: c.surface, borderRadius: 14, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: c.border }}
            onPress={onHistory} accessibilityRole="button">
            <Text style={{ color: c.textSecondary, fontWeight: '700', fontSize: 14 }}>📋 {tr('Bill History')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={{ flex: 1, backgroundColor: c.primaryLight, borderRadius: 14, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: c.primary + '40' }}
            onPress={onNewBill} accessibilityRole="button">
            <Text style={{ color: c.primary, fontWeight: '800', fontSize: 14 }}>+ {tr('New Bill')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
}

export default function BillingScreen({ route, navigation }: any) {
  const { colors: c } = useTheme();
  const tr = useTr();
  const { currencySymbol, refresh } = useContext(AppContext);
  const { can, user } = useAuth();

  const [clients,  setClients]  = useState<any[]>([]);
  const [staff,    setStaff]    = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [profile,  setProfile]  = useState<any>({});
  const [loyaltyPtsPer100, setLoyaltyPtsPer100] = useState(10);
  const [applyGST, setApplyGST] = useState(false);
  // Salon-level switch from Settings → GST. When off, GST can't be applied at all.
  const [gstAllowed, setGstAllowed] = useState(false);
  const [pricesIncludeGST, setPricesIncludeGST] = useState(false);
  const [loadingMaster, setLoadingMaster] = useState(true);

  const [items,           setItems]           = useState<any[]>([]);
  const [selectedClient,  setSelectedClient]  = useState<any>(null);
  const [selectedStaff,   setSelectedStaff]   = useState<any>(null);
  const [isWalkin,        setIsWalkin]        = useState(false);
  const [discountType,    setDiscountType]    = useState<'flat'|'percent'>('flat');
  const [discountValue,   setDiscountValue]   = useState('');
  const [loyaltyRedeem,   setLoyaltyRedeem]   = useState(false);
  const [pointsToRedeem,  setPointsToRedeem]  = useState('');
  const [paymentMethod,   setPaymentMethod]   = useState<PayMethod>('cash');
  const [splitCash,  setSplitCash]  = useState('');
  const [splitUPI,   setSplitUPI]   = useState('');
  const [splitCard,  setSplitCard]  = useState('');
  const [notes,      setNotes]      = useState('');
  const [appointmentId, setAppointmentId] = useState(0);
  const [generating, setGenerating] = useState(false);
  const generatingRef = useRef(false);
  const [advance, setAdvance] = useState('');
  const [queueId, setQueueId] = useState(0); // walk-in token being billed (billed once only)
  const [receiptWidth, setReceiptWidth] = useState<ReceiptWidth>('a4');
  const [popular, setPopular] = useState<any[]>([]);
  const [upsell, setUpsell] = useState<{ name: string; reason: string }[]>([]);
  const [clientNote, setClientNote] = useState<string>('');
  const [lastBillItems, setLastBillItems] = useState<any[]>([]);
  const [newClientName, setNewClientName] = useState('');
  const [newClientPhone, setNewClientPhone] = useState('');
  const [addingClient, setAddingClient] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [actionBusy, setActionBusy] = useState<'' | 'pdf' | 'print' | 'wa'>('');
  // v5.6: prepaid wallet, client packages, appointment advance
  const [walletBal, setWalletBal] = useState(0);
  const [useWallet, setUseWallet] = useState(false);
  const [walletInput, setWalletInput] = useState('');
  const [pkgs, setPkgs] = useState<any[]>([]);
  const [aptAdvance, setAptAdvance] = useState(0);

  // line price override (billing.edit_price)
  const [priceEdit, setPriceEdit] = useState<{ idx: number; value: string } | null>(null);

  const [successState, setSuccessState] = useState<{
    billId: number; billNumber: string; total: number; pointsEarned: number; clientPhone?: string; due?: number; method?: string;
    payNow?: number; walletUsed?: number; walletBalance?: number; advanceUsed?: number; advanceToWallet?: number; packageLines?: number; lowStock?: string[];
  } | null>(null);

  const [showClientModal,  setShowClientModal]  = useState(false);
  const [showServiceModal, setShowServiceModal] = useState(false);
  const [showProductModal, setShowProductModal] = useState(false);
  const [clientSearch,  setClientSearch]  = useState('');
  const [serviceSearch, setServiceSearch] = useState('');

  useEffect(() => { loadMasterData(); }, []);

  // Title follows the state — no second header drawn inside the screen.
  useEffect(() => {
    navigation.setOptions({ title: successState ? tr('Bill Confirmed') : tr('New Bill') });
  }, [successState, navigation, tr]);

  async function loadProducts() {
    try { setProducts((await DatabaseService.getRetailProducts()) as any[]); } catch { /* keep the old list */ }
  }

  async function loadMasterData() {
    try {
      const results = await Promise.allSettled([
        DatabaseService.getClients(),
        DatabaseService.getStaff(),
        DatabaseService.getServices(),
        DatabaseService.getRetailProducts(),
        DatabaseService.getSalonProfile(),
        DatabaseService.getSetting('loyalty_points_per_100'),
        DatabaseService.getSetting('gst_enabled'),
        DatabaseService.getSetting('receipt_width'),
        DatabaseService.getTopServices(toLocalDateStr(new Date(Date.now() - 60 * 86400000)), '9999-12-31', 8),
        DatabaseService.getSetting('prices_include_gst'),
      ]);
      const v = (i: number, fb: any) => (results[i].status === 'fulfilled' ? (results[i] as PromiseFulfilledResult<any>).value : fb);
      const cl = v(0, []), st = v(1, []), sv = v(2, []), pr = v(3, []), prof = v(4, {}), ptsStr = v(5, ''), gstSetting = v(6, ''), rw = v(7, ''), top = v(8, []), incl = v(9, '');
      if (results.slice(0, 3).some(r => r.status === 'rejected')) {
        Alert.alert(tr('Some data did not load'), tr('Clients, staff or services could not be loaded. Go back and open billing again.'));
      }
      if (rw === '58' || rw === '80' || rw === 'a4') setReceiptWidth(rw);
      const stList = (st || []) as any[];
      // One stylist (a solo parlour) or a stylist signed in on their own
      // login: pick them automatically — one tap less on every bill.
      if (stList.length === 1) setSelectedStaff((cur: any) => cur || stList[0]);
      else if (user?.staffId) { const mine = stList.find(x => x.id === user.staffId); if (mine) setSelectedStaff((cur: any) => cur || mine); }
      const svList = (sv || []) as any[];
      const topNames = ((top || []) as any[]).map(t => String(t.name).toLowerCase());
      const pop = topNames.map(n => svList.find(x => String(x.name).toLowerCase() === n)).filter(Boolean);
      setPopular((pop.length >= 4 ? pop : [...pop, ...svList.filter(x => !pop.includes(x))]).slice(0, 8));
      setClients((cl || []) as any[]);
      setStaff(stList);
      setServices(svList);
      setProducts((pr || []) as any[]);
      setProfile(prof || {});
      setLoyaltyPtsPer100(parseInt(ptsStr || '10') || 10);
      setGstAllowed(gstSetting === 'true');
      setApplyGST(gstSetting === 'true');
      setPricesIncludeGST(incl === 'true' || incl === '1');
    } catch (e) { showError(e, 'Could not load billing'); }
    finally { setLoadingMaster(false); }
  }

  // Apply incoming params ONCE, then clear them. (Re-applying them on every
  // focus re-filled a finished appointment and billed it a second time.)
  useEffect(() => {
    const p = route?.params || {};
    const keys = ['items', 'appointment_id', 'client', 'client_id', 'staff_id', 'reset', 'advance_left', 'queue_id'];
    if (!keys.some(k => p[k] !== undefined)) return;
    // A fresh start (e.g. from the walk-in queue): drop the previous cart, client, discounts, appointment and token.
    if (p.reset) { setSuccessState(null); resetForm(); }
    if (p.items) setItems(p.items);
    setQueueId(Number(p.queue_id) || 0);
    if (p.appointment_id) {
      setAppointmentId(p.appointment_id);
      // Advance taken at booking that is still unused — paid already, so it reduces what is collected now.
      const adv0 = round2(Number(p.advance_left) || 0);
      setAptAdvance(adv0 > 0 ? adv0 : 0);
      // Always confirm against the appointment itself (used / refunded parts
      // are tracked there; createBill refuses more than what is left).
      (DatabaseService as any).getAppointment?.(p.appointment_id)
        .then((a: any) => {
          if (!a) return;
          const adv = round2((Number(a.advance_amount) || 0) - (Number(a.advance_used) || 0) - (Number(a.advance_refunded) || 0));
          setAptAdvance(adv > 0 ? adv : 0);
        })
        .catch(() => {});
    }
    if (p.client) { setSelectedClient(p.client); setIsWalkin(false); }
    else if (p.client_id) {
      DatabaseService.getClient(p.client_id)
        .then(cl => { if (cl) { setSelectedClient(cl); setIsWalkin(false); } })
        .catch(() => {});
    }
    if (p.staff_id) {
      DatabaseService.getStaff().then(list => {
        const found = (list as any[]).find((s: any) => s.id === p.staff_id);
        if (found) setSelectedStaff(found);
      }).catch(() => {});
    }
    navigation.setParams({ items: undefined, appointment_id: undefined, client: undefined, client_id: undefined, staff_id: undefined, reset: undefined, advance_left: undefined, queue_id: undefined });
  }, [route?.params, navigation]);

  // Boss AI: "clients who take X also take Y" — learnt from this salon's own bills.
  useEffect(() => {
    let alive = true;
    const names = items.filter(i => i.type === 'service').map(i => i.name);
    if (!names.length) { setUpsell([]); return; }
    BossAI.upsell(names, services.map(s2 => s2.name), 3).then(r => { if (alive) setUpsell(r); }).catch(() => {});
    return () => { alive = false; };
  }, [items, services]);

  useEffect(() => {
    let alive = true;
    setClientNote(''); setLastBillItems([]);
    if (!selectedClient?.id) return;
    BossAI.clientSnapshot(selectedClient.id).then(r => { if (alive && r) setClientNote(r.line + (r.segment ? ` · ${r.segment}` : '')); }).catch(() => {});
    DatabaseService.getBills(undefined, undefined, selectedClient.id).then((b: any[]) => {
      const last = b.find(x => x.payment_status !== 'cancelled' && x.payment_status !== 'credit_note');
      if (alive && last) setLastBillItems((last.items || []).filter((i: any) => i.type === 'service' && services.some(s2 => s2.id === i.id)));
    }).catch(() => {});
    return () => { alive = false; };
  }, [selectedClient?.id, services]);

  // Wallet balance + usable packages for the picked client. Lines covered by
  // the previous client's package go back to their normal price.
  useEffect(() => {
    let alive = true;
    setUseWallet(false); setWalletInput(''); setWalletBal(0); setPkgs([]);
    setItems(p => (p.some(i => i.package_cm_id) ? p.map(unPackage) : p));
    const id = !isWalkin ? Number(selectedClient?.id) || 0 : 0;
    if (!id) return;
    DatabaseService.getClient(id).then((cl: any) => {
      if (!alive || !cl) return;
      setWalletBal(round2(Number(cl.wallet_balance) || 0));
      // Fill in fields a caller may not have passed (loyalty points, allergies, no-shows).
      setSelectedClient((cur: any) => (cur && cur.id === cl.id ? { ...cur, ...cl } : cur));
    }).catch(() => {});
    DBX.getClientActivePackages(id).then(list => { if (alive) setPkgs((list || []).filter(x => x.kind !== 'discount')); }).catch(() => {});
    return () => { alive = false; };
  }, [selectedClient?.id, isWalkin]);

  async function quickAddClient() {
    if (addingClient) return;
    const name = newClientName.trim();
    const raw = newClientPhone.trim();
    if (!name) { Alert.alert(tr('Name needed'), tr('Type the client name.')); return; }
    const phone = raw ? normaliseIndianPhone(raw) : '';
    if (raw && !phone) { Alert.alert(tr('Check the number'), `${phoneHint()} ${tr('Or leave it empty.')}`); return; }
    setAddingClient(true);
    try {
      if (phone) {
        const dup = clients.find(cl => phoneKey(cl.phone) === phone)
          || await (DatabaseService as any).findClientByPhone?.(phone).catch(() => null);
        if (dup) {
          setSelectedClient(dup); setIsWalkin(false); setShowClientModal(false); setNewClientName(''); setNewClientPhone('');
          Alert.alert(tr('Client already saved'), tr('{name} already has this number — selected them for this bill.', { name: dup.name }));
          return;
        }
      }
      const id = await DatabaseService.addClient({ name, phone });
      const cl = await DatabaseService.getClient(Number(id));
      if (cl) setClients(p => [cl, ...p]);
      setSelectedClient(cl); setIsWalkin(false);
      setShowClientModal(false); setNewClientName(''); setNewClientPhone(''); setClientSearch('');
      appEvents.emit('client:changed');
    } catch (e) { showError(e, 'Could not add client'); }
    finally { setAddingClient(false); }
  }

  function addByName(name: string) {
    const svc = services.find(s2 => s2.name === name);
    if (svc) setItems(p => [...p, { type: 'service', id: svc.id, name: svc.name, price: svc.price, qty: 1 }]);
  }

  // ── Calculations ───────────────────────────────────────────────
  const ratePct = (() => { const r = parseFloat(String(profile?.tax_rate ?? 18)); return isNaN(r) || r < 0 ? 18 : r; })();
  const t = useMemo(() => computeTotals({
    items, discountType, discountValue, applyGST, ratePct, inclusive: pricesIncludeGST,
    clientPoints: (!isWalkin && selectedClient) ? Number(selectedClient.loyalty_points || 0) : 0,
    redeem: loyaltyRedeem, pointsToRedeem,
  }), [items, discountType, discountValue, applyGST, ratePct, pricesIncludeGST, isWalkin, selectedClient, loyaltyRedeem, pointsToRedeem]);
  const { gross: subtotal, discAmt, maxRedeem, loyaltyAmt, taxable, taxAmt, total } = t;
  const pointsEarned = (!isWalkin && selectedClient) ? Math.floor(total / 100) * loyaltyPtsPer100 : 0;

  const splitNums = [splitCash, splitUPI, splitCard].map(v => (v.trim() === '' ? 0 : parseAmount(v)));
  const splitInvalid = splitNums.some(n => isNaN(n));
  const splitTotal = round2(splitNums.reduce((a, b) => a + (isNaN(b) ? 0 : b), 0));
  const advNum = advance.trim() === '' ? 0 : parseAmount(advance);

  // Wallet / advance are payments, not discounts: they reduce what is collected now.
  const plan = planBillPayment({
    total, appointmentId, aptAdvance, walletBal, useWallet,
    walletRequested: walletInput.trim() === '' ? null : parseAmount(walletInput),
    method: paymentMethod, split: splitNums.map(n => (isNaN(n) ? 0 : n)), dueCashNow: isNaN(advNum) ? 0 : advNum,
  });
  const { advanceUsed, walletMax, walletInvalid, walletUsed, toCollect, coveredFully } = plan;
  const packageLines = items.filter(i => i.package_cm_id).length;

  /** What each package already covers on this bill (sessions / rupees). */
  function packageUse(cmId: number, skipIdx = -1) {
    let sessions = 0, value = 0;
    items.forEach((it, i) => {
      if (i === skipIdx || Number(it.package_cm_id) !== cmId) return;
      sessions += Math.ceil(Number(it.qty) || 1);
      value += (Number(it.list_price) || 0) * (Number(it.qty) || 1);
    });
    return { sessions, value: round2(value) };
  }
  /** Does package `p` still have room for this line at `qty`? */
  function packageFits(p: any, it: any, qty: number, skipIdx: number) {
    if (p.service_id && Number(p.service_id) !== Number(it.id)) return false;
    const used = packageUse(p.id, skipIdx);
    if (p.kind === 'sessions') return p.remaining_sessions - used.sessions >= Math.ceil(qty);
    if (p.kind === 'value') {
      const need = round2((Number(it.package_cm_id ? it.list_price : it.price) || 0) * qty);
      return need > 0 && p.remaining_value - used.value + 0.009 >= need;
    }
    return false;
  }
  /** Best package to offer for a service line (service-specific first). */
  function packageOffer(it: any, idx: number): any | null {
    if (isWalkin || !selectedClient || it.type !== 'service' || it.package_cm_id || !(Number(it.id) > 0)) return null;
    const ordered = [...pkgs].sort((a, b) => (b.service_id ? 1 : 0) - (a.service_id ? 1 : 0));
    return ordered.find(p => packageFits(p, it, Number(it.qty) || 1, idx)) || null;
  }
  function packageLeftLabel(p: any, idx: number) {
    const used = packageUse(p.id, idx);
    return p.kind === 'sessions'
      ? tr('{n} left', { n: p.remaining_sessions - used.sessions })
      : tr('{amt} left', { amt: `${currencySymbol}${fmt(round2(p.remaining_value - used.value))}` });
  }
  function applyPackage(idx: number, p: any) {
    setItems(list => list.map((x, i) => i === idx
      ? { ...x, list_price: Number(x.price) || 0, price: 0, package_cm_id: p.id, package_name: p.name }
      : x));
  }
  function removePackage(idx: number) { setItems(list => list.map((x, i) => (i === idx ? unPackage(x) : x))); }

  function addService(svc: any) {
    setItems(p => [...p, { type: 'service', id: svc.id, name: svc.name, price: svc.price, qty: 1 }]);
    setShowServiceModal(false);
    setServiceSearch('');
  }

  function addProduct(prod: any) {
    if (prod.quantity <= 0) { Alert.alert(tr('Out of stock'), tr('{name} is currently out of stock.', { name: prod.name })); return; }
    const existing = items.find(i => i.type === 'product' && i.id === prod.id);
    if (existing) {
      if (existing.qty >= prod.quantity) { Alert.alert(tr('Stock limit'), tr('Only {n} {unit} available.', { n: prod.quantity, unit: prod.unit || '' })); return; }
      setItems(p => p.map(i => i.type === 'product' && i.id === prod.id ? { ...i, qty: i.qty + 1 } : i));
    } else {
      setItems(p => [...p, { type: 'product', id: prod.id, name: prod.name, price: prod.sell_price, qty: 1, maxStock: prod.quantity }]);
    }
    setShowProductModal(false);
  }

  function removeItem(idx: number) { setItems(p => p.filter((_, i) => i !== idx)); }

  function updateQty(idx: number, qty: number) {
    if (qty < 1) { removeItem(idx); return; }
    const it = items[idx];
    if (it.type === 'product' && qty > (it.maxStock ?? 9999)) {
      Alert.alert(tr('Stock limit'), tr('Only {n} {unit} available.', { n: it.maxStock, unit: '' })); return;
    }
    if (it.package_cm_id && qty > it.qty) {
      const p = pkgs.find(x => x.id === Number(it.package_cm_id));
      if (!p || !packageFits(p, it, qty, idx)) {
        Alert.alert(tr('Package limit'), tr('{name} does not have enough left for {n}.', { name: it.package_name || tr('This package'), n: qty }));
        return;
      }
    }
    setItems(p => p.map((x, i) => i === idx ? { ...x, qty } : x));
  }

  function savePriceEdit() {
    if (!priceEdit) return;
    const n = parseAmount(priceEdit.value);
    if (isNaN(n)) { Alert.alert(tr('Check the price'), tr('Enter a valid price (numbers only).')); return; }
    setItems(p => p.map((x, i) => i === priceEdit.idx ? { ...x, price: n, price_overridden: 1, original_price: x.original_price ?? x.price } : x));
    setPriceEdit(null);
  }

  async function generateBill() {
    if (generatingRef.current) return;
    if (items.length === 0) { Alert.alert(tr('Empty bill'), tr('Add at least one service or product.')); return; }
    if (!isWalkin && !selectedClient) { Alert.alert(tr('Select client'), tr('Please select a client or turn on Walk-in.')); return; }
    if (!selectedStaff && staff.length > 0) { Alert.alert(tr('Select stylist'), tr('Please assign a stylist.')); return; }
    if (discountValue.trim() && isNaN(parseAmount(discountValue))) { Alert.alert(tr('Check discount'), tr('Discount must be a number that is 0 or more.')); return; }
    if (walletInvalid) { Alert.alert(tr('Check wallet amount'), tr('Wallet amount must be a number that is 0 or more.')); return; }
    if (walletUsed - walletBal > 0.009) { Alert.alert(tr('Not enough in wallet'), tr('The wallet has only {amt}.', { amt: `${currencySymbol}${fmt(walletBal)}` })); return; }
    if (!coveredFully && paymentMethod === 'due') {
      if (!selectedClient) { Alert.alert(tr('Client needed'), tr('Pay-later bills need a client so the due can be collected. Pick or add the client first.')); return; }
      if (isNaN(advNum)) { Alert.alert(tr('Check advance'), tr('Advance must be a number that is 0 or more.')); return; }
      if (advNum > toCollect + 0.01) { Alert.alert(tr('Check advance'), tr('Advance paid cannot be more than the amount to collect.')); return; }
    }
    if (!coveredFully && paymentMethod === 'split') {
      if (splitInvalid) { Alert.alert(tr('Check split amounts'), tr('Each amount must be a number that is 0 or more.')); return; }
      if (Math.abs(splitTotal - toCollect) > 0.01) {
        Alert.alert(tr('Split does not match'), tr('Cash + UPI + Card ({a}) must equal the bill total ({b}).', { a: `${currencySymbol}${fmt(splitTotal)}`, b: `${currencySymbol}${fmt(toCollect)}` }));
        return;
      }
    }

    generatingRef.current = true;
    setGenerating(true);
    try {
      if (total <= 0 && packageLines === 0) {
        const ok = await confirmAsync('Zero bill', tr('This bill total is {amt}. Create it anyway?', { amt: `${currencySymbol}0` }), 'Create bill');
        if (!ok) return;
      }
      if (selectedClient?.allergies) {
        const ok = await confirmAsync('⚠️ Allergy alert',
          tr('Client: {name}\nAllergies: {a}\n\nConfirm the services are safe?', { name: selectedClient.name, a: selectedClient.allergies }), 'Proceed');
        if (!ok) return;
      }
      if (selectedClient?.is_blacklisted) {
        const ok = await confirmAsync('🚫 Blacklisted client', tr('{name} is flagged. Do you still want to proceed?', { name: selectedClient.name }), 'Proceed anyway', true);
        if (!ok) return;
      }

      // Wallet + advance cover everything → 'wallet'; otherwise the rest goes through the chosen method.
      const { usedMethod, splitData, dueAmount } = plan;
      const billItems = items.map(({ maxStock, package_name, ...rest }) => rest);

      const res: any = await DatabaseService.createBill({
        client_id: selectedClient?.id || 0,
        staff_id:  selectedStaff?.id  || 0,
        appointment_id: appointmentId,
        queue_id: queueId,
        items: billItems,
        subtotal, tax_amount: taxAmt,
        taxable_value: taxable,
        tax_rate: applyGST ? ratePct : 0,
        prices_include_gst: applyGST && pricesIncludeGST ? 1 : 0,
        discount_amount: discAmt, discount_type: discountType,
        loyalty_discount: loyaltyAmt,
        total,
        payment_method: usedMethod,
        payment_split:  splitData,
        wallet_used: walletUsed,
        advance_adjusted: advanceUsed,
        created_by: user?.displayName || user?.username || '',
        notes,
        loyalty_points_earned: pointsEarned,
        loyalty_points_used:   loyaltyAmt,
        is_walkin: isWalkin ? 1 : 0,
      });
      const { billNumber, billId } = res || {};

      // Stock: the new data layer deducts inside createBill and says so. Only
      // fall back to deducting here for the old data layer.
      const lowStockWarnings: string[] = [];
      if (Array.isArray(res?.lowStock)) {
        for (const l of res.lowStock) {
          lowStockWarnings.push(Number(l.quantity) <= 0 ? `${l.name}: ${tr('OUT OF STOCK')}` : `${l.name}: ${tr('only {n} left', { n: `${l.quantity} ${l.unit || ''}`.trim() })}`);
        }
      } else {
        for (const item of items) {
          if (item.type !== 'product') continue;
          try {
            if (!res?.stockHandled) await DatabaseService.deductStock(item.id, item.qty);
            const updatedProd: any = await (DatabaseService as any).getInventoryItem?.(item.id);
            if (updatedProd && updatedProd.quantity <= 0) lowStockWarnings.push(`${item.name}: ${tr('OUT OF STOCK')}`);
            else if (updatedProd && updatedProd.quantity <= updatedProd.min_stock) lowStockWarnings.push(`${item.name}: ${tr('only {n} left', { n: `${updatedProd.quantity} ${updatedProd.unit || ''}` })}`);
          } catch (e) { console.warn('Stock deduct failed:', e); }
        }
      }

      try { refresh(); } catch { /* context refresh is best effort */ }
      BossAI.invalidate();
      appEvents.emit('bill:created', { billId });
      loadProducts();
      const capturedPhone = selectedClient?.phone;

      const due = typeof res?.amountDue === 'number' ? res.amountDue : dueAmount;
      const capturedWalletUsed = walletUsed, capturedAdvance = advanceUsed, capturedPkgLines = packageLines;
      const capturedPayNow = round2(Math.max(0, toCollect - due));
      if (walletUsed > 0 && selectedClient?.id) appEvents.emit('client:changed', { id: selectedClient.id, wallet: res?.walletBalance });

      resetForm();
      setSuccessState({
        // Points are earned on money received now (a pay-later bill earns the rest when collected).
        billId, billNumber, total, pointsEarned: typeof res?.pointsEarned === 'number' ? res.pointsEarned : pointsEarned, clientPhone: capturedPhone, due, method: usedMethod,
        payNow: capturedPayNow, walletUsed: capturedWalletUsed, advanceUsed: capturedAdvance, packageLines: capturedPkgLines,
        walletBalance: typeof res?.walletBalance === 'number' ? res.walletBalance : undefined,
        advanceToWallet: Number(res?.advanceToWallet) || 0,
        lowStock: lowStockWarnings,
      });
    } catch (e) {
      showError(e, 'Bill not created', 'Could not create the bill. Nothing was saved — please try again.');
    } finally {
      generatingRef.current = false;
      setGenerating(false);
    }
  }

  function resetForm() {
    setItems([]); setSelectedClient(null);
    setSelectedStaff(staff.length === 1 ? staff[0] : (user?.staffId ? staff.find(x => x.id === user.staffId) || null : null));
    setIsWalkin(false); setDiscountValue(''); setDiscountType('flat'); setLoyaltyRedeem(false);
    setPointsToRedeem(''); setPaymentMethod('cash');
    setSplitCash(''); setSplitUPI(''); setSplitCard('');
    setNotes(''); setAppointmentId(0); setAdvance(''); setQueueId(0);
    setUseWallet(false); setWalletInput(''); setAptAdvance(0);
    DatabaseService.getSetting('gst_enabled').then(v => { setGstAllowed(v === 'true'); setApplyGST(v === 'true'); }).catch(() => {});
  }

  async function sharePDF(billId: number) {
    if (actionBusy) return;
    setActionBusy('pdf');
    try {
      const bill = await DatabaseService.getBill(billId);
      if (!bill) { Alert.alert(tr('Bill not found'), tr('Open it from Bill History and try again.')); return; }
      await shareInvoicePDF(bill, profile, currencySymbol);
    } catch (e) {
      showError(e, 'PDF not created', 'Could not create the PDF. Check that the phone has free storage and try again.');
    } finally { setActionBusy(''); }
  }

  async function sendWhatsApp(billNumber: string, billTotal: number, phone: string, due = 0) {
    if (actionBusy) return;
    setActionBusy('wa');
    try {
      let msg = WhatsAppService.buildBillReceipt(billNumber, profile?.name || 'our salon', billTotal, currencySymbol);
      if (due > 0) msg += `\n\nBalance due: ${currencySymbol}${fmt(due)}${profile?.upi_id ? `\nPay by UPI: ${profile.upi_id}` : ''}`;
      // Happy customer, phone in hand, right now: the best moment to ask for a Google review.
      else msg += await ReviewService.line().catch(() => '');
      await Promise.resolve(WhatsAppService.sendMessage(phone, msg));
    } catch (e) {
      showError(e, 'WhatsApp did not open', 'Could not open WhatsApp. Check that it is installed.');
    } finally { setActionBusy(''); }
  }

  async function printReceipt(billId: number) {
    if (actionBusy) return;
    setActionBusy('print');
    try {
      const bill = await DatabaseService.getBill(billId);
      if (bill) await printBill(bill, profile, currencySymbol, receiptWidth);
    } catch {
      Alert.alert(tr('Printer not found'), tr('No printer responded. For a Bluetooth thermal printer, install its Android print service (for example RawBT), pair the printer, then try again.'));
    } finally { setActionBusy(''); }
  }

  const cq = clientSearch.trim().toLowerCase();
  const filteredClients = useMemo(() => (cq
    ? clients.filter(cl => String(cl.name || '').toLowerCase().includes(cq) || String(cl.phone || '').includes(cq))
    : clients), [clients, cq]);
  const sq = serviceSearch.trim().toLowerCase();
  const filteredServices = useMemo(() => (sq
    ? services.filter(s => String(s.name || '').toLowerCase().includes(sq) || String(s.category || '').toLowerCase().includes(sq))
    : services), [services, sq]);

  const methodLabel = (m: PayMethod) => m === 'cash' ? `💵 ${tr('Cash')}` : m === 'upi' ? `📱 ${payLabel()}` : m === 'card' ? `💳 ${tr('Card')}` : m === 'split' ? `⚡ ${tr('Split')}` : `⏳ ${tr('Pay later')}`;
  const canEditPrice = can('billing.edit_price');

  if (successState) {
    return (
      <SafeScreen>
        <BillSuccessView
          billNumber={successState.billNumber}
          total={fmt(successState.total)}
          pointsEarned={successState.pointsEarned}
          currencySymbol={currencySymbol}
          c={c}
          tr={tr}
          busy={actionBusy}
          onSharePDF={() => sharePDF(successState.billId)}
          onWhatsApp={successState.clientPhone ? () => sendWhatsApp(successState.billNumber, successState.total, successState.clientPhone!, successState.due || 0) : null}
          onPrint={() => printReceipt(successState.billId)}
          printLabel={receiptWidth === 'a4' ? tr('Print bill') : tr('Print {w} mm receipt', { w: receiptWidth })}
          due={successState.due || 0}
          payNow={successState.payNow}
          walletUsed={successState.walletUsed || 0}
          walletBalance={successState.walletBalance}
          advanceUsed={successState.advanceUsed || 0}
          advanceToWallet={successState.advanceToWallet || 0}
          packageLines={successState.packageLines || 0}
          lowStock={successState.lowStock || []}
          qrSvg={profile?.upi_id && (successState.method === 'upi' || (successState.due || 0) > 0)
            ? upiQrSvg(upiString({ vpa: profile.upi_id, name: profile.name, amount: (successState.due || 0) > 0 ? successState.due! : (successState.payNow ?? successState.total), note: `Bill ${successState.billNumber}` }), 4)
            : ''}
          onNewBill={() => setSuccessState(null)}
          onHistory={() => { setSuccessState(null); if (can('billing.history')) navigation.navigate('BillHistory'); else navigation.goBack(); }}
        />
      </SafeScreen>
    );
  }

  return (
    <SafeScreen keyboard>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 80 }}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        showsVerticalScrollIndicator={false}>

          {loadingMaster && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <ActivityIndicator size="small" color={c.primary} />
              <Text style={{ color: c.textMuted, fontSize: 12.5 }}>{tr('Loading clients and services…')}</Text>
            </View>
          )}

          {/* CLIENT */}
          <SectionCard title={tr('Client')}>
            <Row>
              <Text style={[lbl, { color: c.text, flex: 1 }]}>{tr('Walk-in (no client record)')}</Text>
              <Switch value={isWalkin} onValueChange={v => { setIsWalkin(v); if (v) { setSelectedClient(null); setLoyaltyRedeem(false); if (paymentMethod === 'due') setPaymentMethod('cash'); } }} trackColor={{ true: c.primary + '60', false: c.border }} thumbColor={isWalkin ? c.primary : c.textMuted} />
            </Row>
            {!isWalkin && (
              <TouchableOpacity style={[pick, { borderColor: c.border, backgroundColor: c.surface, flexDirection: 'row', alignItems: 'center', gap: 8 }]} onPress={() => setShowClientModal(true)} accessibilityRole="button">
                <MaterialCommunityIcons name="account-search-outline" size={18} color={c.textMuted} />
                <Text style={{ color: selectedClient ? c.text : c.textMuted, fontSize: 14, flex: 1 }} numberOfLines={1}>
                  {selectedClient ? `${selectedClient.name}${selectedClient.phone ? `  •  ${selectedClient.phone}` : ''}` : tr('Tap to select client')}
                </Text>
                <MaterialCommunityIcons name="chevron-right" size={18} color={c.textMuted} />
              </TouchableOpacity>
            )}
            {!!clientNote && (
              <View style={[tag, { backgroundColor: c.primaryLight, flexDirection: 'row', gap: 6, alignItems: 'center' }]}>
                <MaterialCommunityIcons name="robot-happy-outline" size={14} color={c.primary} />
                <Text style={{ color: c.primary, fontSize: 12, flex: 1 }}>{clientNote}</Text>
              </View>
            )}
            {lastBillItems.length > 0 && items.length === 0 && (
              <TouchableOpacity onPress={() => setItems(lastBillItems.map(i => ({ ...i, qty: 1, price: services.find(s2 => s2.id === i.id)?.price ?? i.price })))}
                style={[tag, { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, flexDirection: 'row', gap: 6, alignItems: 'center' }]}>
                <MaterialCommunityIcons name="repeat" size={14} color={c.textSecondary} />
                <Text style={{ color: c.textSecondary, fontSize: 12, flex: 1 }} numberOfLines={1}>{tr('Repeat last visit')}: {lastBillItems.map(i => i.name).join(' + ')}</Text>
              </TouchableOpacity>
            )}
            {!isWalkin && selectedClient?.id ? (
              <ClientAlertBadge clientId={selectedClient.id} fallbackText={selectedClient.allergies} noShowCount={selectedClient.no_show_count} compact style={{ marginTop: 8 }} />
            ) : null}
            {!isWalkin && selectedClient?.id && (walletBal > 0 || pkgs.length > 0 || aptAdvance > 0) ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {walletBal > 0 && (
                  <View style={[miniChip, { backgroundColor: c.primaryLight }]}>
                    <MaterialCommunityIcons name="wallet-outline" size={13} color={c.primary} />
                    <Text style={{ color: c.primary, fontSize: 12, fontWeight: '800' }}>{tr('Wallet {amt}', { amt: `${currencySymbol}${fmt(walletBal)}` })}</Text>
                  </View>
                )}
                {pkgs.length > 0 && (
                  <View style={[miniChip, { backgroundColor: c.accentLight }]}>
                    <MaterialCommunityIcons name="package-variant-closed" size={13} color={c.accent} />
                    <Text style={{ color: c.accent, fontSize: 12, fontWeight: '800' }}>{pkgs.length === 1 ? tr('1 package') : tr('{n} packages', { n: pkgs.length })}</Text>
                  </View>
                )}
              </View>
            ) : null}
            {selectedClient?.is_blacklisted ? (
              <View style={[tag, { backgroundColor: c.dangerLight }]}>
                <Text style={{ color: c.danger, fontSize: 12 }}>🚫  {tr('Blacklisted client')}</Text>
              </View>
            ) : null}
          </SectionCard>

          {/* STYLIST */}
          <SectionCard title={staff.length ? `${tr('Stylist')} *` : tr('Stylist')}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {staff.map(st => {
                const on = selectedStaff?.id === st.id;
                return (
                  <TouchableOpacity key={st.id} style={[chip, { backgroundColor: on ? c.primary : c.surface, borderColor: on ? c.primary : c.border }]} onPress={() => setSelectedStaff(st)}>
                    <Text style={{ color: on ? c.onPrimary : c.textSecondary, fontSize: 13, fontWeight: '600' }}>{st.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            {staff.length === 0 && <Text style={{ color: c.textMuted, fontSize: 13 }}>{tr('No staff added — the bill will be saved without a stylist. Add staff in Settings → Staff.')}</Text>}
          </SectionCard>

          {/* ITEMS */}
          <SectionCard title={`${tr('Services & Products')}  (${items.length})`}>
            {items.length === 0 && (
              <Text style={{ color: c.textMuted, fontSize: 13, marginBottom: 4 }}>{tr('No items yet. Add a service or product below.')}</Text>
            )}
            {items.map((item, idx) => {
              const offer = packageOffer(item, idx);
              return (
              <View key={`${item.type}-${item.id}-${idx}`} style={[itemRow, { borderBottomColor: c.divider }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.text, fontSize: 14, fontWeight: '600' }} numberOfLines={2}>{item.name}</Text>
                  {item.package_cm_id ? (
                    <TouchableOpacity onPress={() => removePackage(idx)} accessibilityRole="button" accessibilityLabel={tr('Stop using package')}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3, alignSelf: 'flex-start', backgroundColor: c.accentLight, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
                      <MaterialCommunityIcons name="package-variant-closed" size={12} color={c.accent} />
                      <Text style={{ color: c.accent, fontSize: 11.5, fontWeight: '800' }} numberOfLines={1}>
                        {tr('Package')}{item.package_name ? `: ${item.package_name}` : ''}  ·  {tr('was {amt}', { amt: `${currencySymbol}${fmt(item.list_price)}` })}
                      </Text>
                      <MaterialCommunityIcons name="close" size={12} color={c.accent} />
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity disabled={!canEditPrice} onPress={() => setPriceEdit({ idx, value: String(item.price) })}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }} accessibilityLabel={canEditPrice ? tr('Change price') : undefined}>
                      <Text style={{ color: c.textMuted, fontSize: 12 }}>{item.type === 'service' ? tr('Service') : tr('Product')}  •  {currencySymbol}{fmt(item.price)}</Text>
                      {canEditPrice && <MaterialCommunityIcons name="pencil-outline" size={13} color={c.primary} />}
                      {item.price_overridden ? <Text style={{ color: c.warning, fontSize: 11, fontWeight: '700' }}>{tr('edited')}</Text> : null}
                    </TouchableOpacity>
                  )}
                  {offer ? (
                    <TouchableOpacity onPress={() => applyPackage(idx, offer)} accessibilityRole="button"
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 5, alignSelf: 'flex-start', borderWidth: 1, borderColor: c.accent, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 }}>
                      <MaterialCommunityIcons name="package-variant-closed" size={13} color={c.accent} />
                      <Text style={{ color: c.accent, fontSize: 12, fontWeight: '800' }}>{tr('Use package ({left})', { left: packageLeftLabel(offer, idx) })}</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <TouchableOpacity style={[qBtn, { backgroundColor: c.surface }]} onPress={() => updateQty(idx, item.qty - 1)} accessibilityLabel={tr('Less')}><Text style={{ color: c.text, fontSize: 16 }}>−</Text></TouchableOpacity>
                  <Text style={{ color: c.text, fontSize: 14, minWidth: 22, textAlign: 'center' }}>{item.qty}</Text>
                  <TouchableOpacity style={[qBtn, { backgroundColor: c.surface }]} onPress={() => updateQty(idx, item.qty + 1)} accessibilityLabel={tr('More')}><Text style={{ color: c.text, fontSize: 16 }}>+</Text></TouchableOpacity>
                </View>
                <Text style={{ color: c.primary, fontWeight: '800', fontSize: 14, marginLeft: 8, minWidth: 56, textAlign: 'right' }} numberOfLines={1} adjustsFontSizeToFit>{currencySymbol}{fmt(item.price * item.qty)}</Text>
                <TouchableOpacity onPress={() => removeItem(idx)} style={{ marginLeft: 6, padding: 4 }} accessibilityLabel={tr('Remove')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <MaterialCommunityIcons name="close" size={18} color={c.textMuted} />
                </TouchableOpacity>
              </View>
              );
            })}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <TouchableOpacity style={[addBtn, { backgroundColor: c.primaryLight, flex: 1 }]} onPress={() => setShowServiceModal(true)}>
                <Text style={{ color: c.primary, fontWeight: '700', fontSize: 13 }}>+ {tr('Service')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[addBtn, { backgroundColor: c.successLight, flex: 1 }]} onPress={() => setShowProductModal(true)}>
                <Text style={{ color: c.success, fontWeight: '700', fontSize: 13 }}>+ {tr('Product')}</Text>
              </TouchableOpacity>
            </View>
            {upsell.length > 0 && (
              <View style={{ marginTop: 12, backgroundColor: c.primaryLight, borderRadius: 12, padding: 10 }}>
                <Text style={{ color: c.primary, fontSize: 11, fontWeight: '900', letterSpacing: 0.6, marginBottom: 6 }}>🤖 {tr('BOSS AI SUGGESTS')}</Text>
                {upsell.map(u => (
                  <TouchableOpacity key={u.name} onPress={() => addByName(u.name)} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 5, gap: 8 }}>
                    <MaterialCommunityIcons name="plus-circle" size={18} color={c.primary} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: c.text, fontWeight: '700', fontSize: 13 }}>{u.name}{(() => { const s2 = services.find(x => x.name === u.name); return s2 ? `  ·  ${currencySymbol}${fmt(s2.price)}` : ''; })()}</Text>
                      <Text style={{ color: c.textMuted, fontSize: 11 }}>{u.reason}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            {items.length === 0 && popular.length > 0 && (
              <View style={{ marginTop: 12 }}>
                <Text style={{ color: c.textMuted, fontSize: 11, fontWeight: '800', letterSpacing: 0.6, marginBottom: 6 }}>{tr('QUICK ADD')}</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {popular.map(p2 => (
                    <TouchableOpacity key={p2.id} onPress={() => addService(p2)} style={{ backgroundColor: c.surface, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 7, borderWidth: 1, borderColor: c.border }}>
                      <Text style={{ color: c.textSecondary, fontSize: 12, fontWeight: '700' }}>{p2.name} · {currencySymbol}{fmt(p2.price)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
          </SectionCard>

          {/* DISCOUNT — only for users allowed to give discounts */}
          {can('billing.discount') && <SectionCard title={tr('Discount')}>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
              {(['flat', 'percent'] as const).map(dt => {
                const on = discountType === dt;
                return (
                  <TouchableOpacity key={dt} style={[chip, { flex: 1, marginRight: 0, alignItems: 'center', backgroundColor: on ? c.primary : c.surface, borderColor: on ? c.primary : c.border }]}
                    onPress={() => { if (dt !== discountType) { setDiscountType(dt); setDiscountValue(''); } }}>
                    <Text style={{ color: on ? c.onPrimary : c.textSecondary, fontWeight: '700', fontSize: 13 }}>{dt === 'flat' ? `${tr('Flat')} (${currencySymbol})` : `${tr('Percent')} (%)`}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TextInput style={[inp, { backgroundColor: c.surface, color: c.text, borderColor: c.border }]}
              placeholder={discountType === 'flat' ? tr('Enter amount') : tr('Enter % (max 100)')}
              placeholderTextColor={c.textMuted} keyboardType="decimal-pad" value={discountValue}
              onChangeText={v => {
                const clean = cleanAmountInput(v);
                const n = parseAmount(clean);
                if (discountType === 'percent' && !isNaN(n) && n > 100) { setDiscountValue('100'); return; }
                if (discountType === 'flat' && !isNaN(n) && n > subtotal && subtotal > 0) { setDiscountValue(String(subtotal)); return; }
                setDiscountValue(clean);
              }} />
            {discAmt > 0 && (
              <Text style={{ color: c.warning, fontSize: 12, marginTop: 4 }}>{tr('Discount applied')}: {currencySymbol}{fmt(discAmt)}</Text>
            )}
          </SectionCard>}

          {/* GST TOGGLE — only for salons that turned GST on in Settings */}
          {gstAllowed && <SectionCard title={profile.gst_number ? `GST  •  GSTIN: ${profile.gst_number}` : tr('GST / Tax')}>
            <Row>
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.text, fontSize: 14, fontWeight: '600' }}>
                  {applyGST ? tr('Apply GST @ {r}%', { r: fmt(ratePct) }) : tr('GST not applied')}
                </Text>
                <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 2 }}>
                  {applyGST
                    ? (pricesIncludeGST ? tr('Prices include GST · tax inside: {amt}', { amt: `${currencySymbol}${fmt(taxAmt)}` }) : tr('Tax amount: {amt}', { amt: `${currencySymbol}${fmt(taxAmt)}` }))
                    : tr('This bill will have no tax')}
                </Text>
              </View>
              <Switch value={applyGST} onValueChange={setApplyGST}
                trackColor={{ true: c.primary + '60', false: c.border }}
                thumbColor={applyGST ? c.primary : c.textLight} />
            </Row>
          </SectionCard>}

          {/* LOYALTY */}
          {!isWalkin && selectedClient && (selectedClient.loyalty_points ?? 0) > 0 && (
            <SectionCard title={`${tr('Loyalty points')}  (${selectedClient.loyalty_points} ${tr('pts')} = ${currencySymbol}${selectedClient.loyalty_points})`}>
              <Row>
                <Text style={{ color: c.text, fontSize: 14, flex: 1 }}>{tr('Redeem points for discount')}</Text>
                <Switch value={loyaltyRedeem} onValueChange={v => { setLoyaltyRedeem(v); if (!v) setPointsToRedeem(''); }} trackColor={{ true: c.primary + '60', false: c.border }} thumbColor={loyaltyRedeem ? c.primary : c.textMuted} />
              </Row>
              {loyaltyRedeem && (
                <TextInput style={[inp, { backgroundColor: c.surface, color: c.text, borderColor: c.border, marginTop: 10 }]}
                  placeholder={tr('Points to use (max {n})', { n: maxRedeem })} placeholderTextColor={c.textMuted}
                  keyboardType="number-pad" value={pointsToRedeem}
                  onChangeText={v => { const d = v.replace(/\D/g, ''); setPointsToRedeem(d && parseInt(d, 10) > maxRedeem ? String(maxRedeem) : d); }} />
              )}
            </SectionCard>
          )}

          {/* PAYMENT */}
          <SectionCard title={tr('Payment')}>
            {advanceUsed > 0 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.successLight, borderRadius: 12, padding: 11, marginBottom: 10 }}>
                <MaterialCommunityIcons name="cash-check" size={18} color={c.success} />
                <Text style={{ color: c.success, fontWeight: '800', fontSize: 13, flex: 1 }}>
                  {tr('Advance paid {amt}', { amt: `${currencySymbol}${fmt(aptAdvance)}` })}
                  {aptAdvance - advanceUsed > 0.009 ? `  ·  ${tr('{amt} used on this bill', { amt: `${currencySymbol}${fmt(advanceUsed)}` })}` : ''}
                </Text>
              </View>
            )}
            {!isWalkin && selectedClient && walletBal > 0 && (
              <View style={{ backgroundColor: c.surface, borderRadius: 12, padding: 11, marginBottom: 10 }}>
                <Row>
                  <MaterialCommunityIcons name="wallet-outline" size={18} color={c.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.text, fontSize: 14, fontWeight: '700' }}>{tr('Pay from wallet')}</Text>
                    <Text style={{ color: c.textMuted, fontSize: 12 }}>{tr('Balance {amt}', { amt: `${currencySymbol}${fmt(walletBal)}` })}</Text>
                  </View>
                  <Switch value={useWallet} disabled={walletMax <= 0} onValueChange={v => { setUseWallet(v); setWalletInput(''); }}
                    trackColor={{ true: c.primary + '60', false: c.border }} thumbColor={useWallet ? c.primary : c.textMuted} />
                </Row>
                {useWallet && (
                  <View style={{ marginTop: 10 }}>
                    <TextInput style={[inp, { backgroundColor: c.card, color: c.text, borderColor: walletInvalid ? c.danger : c.border, marginBottom: 6 }]}
                      placeholder={tr('Amount from wallet (max {amt})', { amt: `${currencySymbol}${fmt(walletMax)}` })} placeholderTextColor={c.textMuted}
                      keyboardType="decimal-pad" value={walletInput}
                      onChangeText={v => {
                        const clean = cleanAmountInput(v);
                        const n = parseAmount(clean);
                        setWalletInput(!isNaN(n) && n > walletMax ? String(walletMax) : clean);
                      }} />
                    <Text style={{ color: c.primary, fontSize: 12, fontWeight: '700' }}>
                      {tr('Using {amt} from wallet', { amt: `${currencySymbol}${fmt(walletUsed)}` })}  ·  {tr('{amt} left in wallet', { amt: `${currencySymbol}${fmt(round2(walletBal - walletUsed))}` })}
                    </Text>
                  </View>
                )}
              </View>
            )}
            {coveredFully ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.successLight, borderRadius: 12, padding: 12 }}>
                <MaterialCommunityIcons name="check-decagram" size={18} color={c.success} />
                <Text style={{ color: c.success, fontWeight: '800', flex: 1 }}>
                  {walletUsed > 0 ? tr('Fully paid from wallet — nothing to collect') : tr('Fully paid by the advance — nothing to collect')}
                </Text>
              </View>
            ) : (<>
            {(walletUsed > 0 || advanceUsed > 0) && (
              <Text style={{ color: c.textSecondary, fontSize: 12.5, fontWeight: '700', marginBottom: 8 }}>{tr('Collect the rest {amt} by', { amt: `${currencySymbol}${fmt(toCollect)}` })}</Text>
            )}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {(['cash', 'upi', 'card', 'split', ...(can('billing.dues') && !isWalkin ? ['due'] : [])] as PayMethod[]).map(m => {
                const on = paymentMethod === m;
                return (
                  <TouchableOpacity key={m} style={[chip, { marginRight: 0, backgroundColor: on ? c.primary : c.surface, borderColor: on ? c.primary : c.border }]} onPress={() => setPaymentMethod(m)}>
                    <Text style={{ color: on ? c.onPrimary : c.textSecondary, fontWeight: '700', fontSize: 13 }}>{methodLabel(m)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {paymentMethod === 'upi' && profile?.upi_id ? (
              <TouchableOpacity onPress={() => setShowQR(true)} style={{ marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.surface, borderRadius: 12, padding: 11 }}>
                <MaterialCommunityIcons name="qrcode" size={20} color={c.upi} />
                <Text style={{ color: c.text, fontWeight: '700', flex: 1 }}>{tr('Show UPI QR for {amt}', { amt: `${currencySymbol}${fmt(toCollect)}` })}</Text>
                <MaterialCommunityIcons name="chevron-right" size={18} color={c.textMuted} />
              </TouchableOpacity>
            ) : null}
            {paymentMethod === 'due' && (
              <View style={{ marginTop: 10 }}>
                <Text style={{ color: c.textMuted, fontSize: 12, marginBottom: 6 }}>{tr('Udhaar — the balance stays on {name}’s account until collected (Bill History → Dues).', { name: selectedClient ? selectedClient.name : tr('the client') })}</Text>
                <TextInput style={[inp, { backgroundColor: c.surface, color: c.text, borderColor: isNaN(advNum) || advNum > toCollect + 0.01 ? c.danger : c.border }]}
                  placeholder={tr('Advance paid now in cash (optional)')} placeholderTextColor={c.textMuted} keyboardType="decimal-pad" value={advance} onChangeText={v => setAdvance(cleanAmountInput(v))} />
                <Text style={{ color: c.warning, fontSize: 12, fontWeight: '700' }}>{tr('Due later')}: {currencySymbol}{fmt(Math.max(0, round2(toCollect - (isNaN(advNum) ? 0 : advNum))))}</Text>
              </View>
            )}
            {paymentMethod === 'split' && (
              <View style={{ marginTop: 10, gap: 8 }}>
                {([[tr('Cash'), splitCash, setSplitCash], [payLabel(), splitUPI, setSplitUPI], [tr('Card'), splitCard, setSplitCard]] as [string, string, (v: string) => void][]).map(([label, val, setter], i) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ color: c.textSecondary, width: 56, fontSize: 13 }} numberOfLines={1}>{label}</Text>
                    <TextInput style={[inp, { flex: 1, backgroundColor: c.surface, color: c.text, borderColor: isNaN(splitNums[i]) ? c.danger : c.border, marginBottom: 0 }]}
                      placeholder="0" placeholderTextColor={c.textMuted} keyboardType="decimal-pad" value={val} onChangeText={v => setter(cleanAmountInput(v))} />
                  </View>
                ))}
                {(() => {
                  const diff = round2(toCollect - splitTotal);
                  const ok = Math.abs(diff) <= 0.01 && !splitInvalid;
                  return (
                    <Text style={{ color: ok ? c.success : c.warning, fontSize: 12, fontWeight: '700' }}>
                      {ok ? `✓ ${tr('Split matches the total')}`
                        : diff > 0 ? `${tr('Remaining')}: ${currencySymbol}${fmt(diff)}`
                        : `${tr('Too much by')} ${currencySymbol}${fmt(-diff)}`}
                    </Text>
                  );
                })()}
              </View>
            )}
            </>)}
          </SectionCard>

          {/* NOTES */}
          <TextInput style={[inp, { backgroundColor: c.card, color: c.text, borderColor: c.border, margin: 0, marginBottom: 16, minHeight: 56 }]}
            placeholder={tr('Notes (optional)')} placeholderTextColor={c.textMuted} value={notes} onChangeText={setNotes} multiline />

          {/* TOTALS */}
          <View style={[totBox, { backgroundColor: c.card, borderColor: c.border }]}>
            <TotalRow label={tr('Subtotal')} value={`${currencySymbol}${fmt(subtotal)}`} c={c} />
            {discAmt > 0 && <TotalRow label={tr('Discount')} value={`-${currencySymbol}${fmt(discAmt)}`} c={c} highlight={c.warning} />}
            {loyaltyAmt > 0 && <TotalRow label={tr('Loyalty discount')} value={`-${currencySymbol}${fmt(loyaltyAmt)}`} c={c} highlight={c.accent} />}
            {applyGST && taxAmt > 0 && pricesIncludeGST && <TotalRow label={tr('Taxable value')} value={`${currencySymbol}${fmt(taxable)}`} c={c} />}
            {applyGST && taxAmt > 0 && (
              <TotalRow label={pricesIncludeGST ? tr('Incl. GST @ {r}%', { r: fmt(ratePct) }) : `GST @ ${fmt(ratePct)}%`} value={`${currencySymbol}${fmt(taxAmt)}`} c={c} />
            )}
            <View style={[totFinal, { borderTopColor: c.divider }]}>
              <Text style={{ color: c.primary, fontSize: 20, fontWeight: '900' }}>{tr('TOTAL')}</Text>
              <Text style={{ color: c.primary, fontSize: 26, fontWeight: '900', flexShrink: 1, marginLeft: 10 }} numberOfLines={1} adjustsFontSizeToFit>{currencySymbol}{fmt(total)}</Text>
            </View>
            {applyGST && pricesIncludeGST && taxAmt > 0 && <Text style={{ color: c.textMuted, fontSize: 11.5, textAlign: 'right', marginTop: 2 }}>{tr('Incl. GST')}</Text>}
            {(advanceUsed > 0 || walletUsed > 0) && (
              <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: c.divider }}>
                {advanceUsed > 0 && <TotalRow label={tr('Advance paid')} value={`-${currencySymbol}${fmt(advanceUsed)}`} c={c} highlight={c.success} />}
                {walletUsed > 0 && <TotalRow label={tr('From wallet')} value={`-${currencySymbol}${fmt(walletUsed)}`} c={c} highlight={c.primary} />}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: c.text, fontSize: 15, fontWeight: '900' }}>{tr('To collect now')}</Text>
                  <Text style={{ color: c.text, fontSize: 19, fontWeight: '900' }}>{currencySymbol}{fmt(toCollect)}</Text>
                </View>
              </View>
            )}
            {pointsEarned > 0 && <Text style={{ color: c.success, fontSize: 12, textAlign: 'center', marginTop: 8 }}>🎉 {tr('Client earns +{n} loyalty points', { n: pointsEarned })}</Text>}
          </View>

          <TouchableOpacity style={[genBtn, { backgroundColor: generating ? c.textMuted : c.primary }]} onPress={generateBill} disabled={generating} accessibilityRole="button">
            {generating
              ? <ActivityIndicator color={c.onPrimary} />
              : <Text style={{ color: c.onPrimary, fontSize: 17, fontWeight: '900' }} numberOfLines={1} adjustsFontSizeToFit>
                  {tr('Generate Bill')}  •  {advanceUsed > 0 || walletUsed > 0 ? tr('Collect {amt}', { amt: `${currencySymbol}${fmt(toCollect)}` }) : `${currencySymbol}${fmt(total)}`}
                </Text>}
          </TouchableOpacity>
      </ScrollView>

      {/* CLIENT PICKER MODAL */}
      <BottomModal visible={showClientModal} onClose={() => { setShowClientModal(false); setClientSearch(''); }}>
        <View style={[modalBox, { backgroundColor: c.bg }]}>
          <Text style={[modalTitle, { color: c.text }]}>{tr('Select client')}</Text>
          {can('clients.edit') && (
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
              <TextInput style={[modalSearch, { flex: 1.2, marginBottom: 0, backgroundColor: c.surface, color: c.text, borderColor: c.primary + '55' }]}
                placeholder={tr('New: name')} placeholderTextColor={c.textMuted} value={newClientName} onChangeText={setNewClientName} />
              <TextInput style={[modalSearch, { flex: 1, marginBottom: 0, backgroundColor: c.surface, color: c.text, borderColor: c.primary + '55' }]}
                placeholder={tr('Mobile')} placeholderTextColor={c.textMuted} keyboardType="phone-pad" value={newClientPhone} onChangeText={setNewClientPhone} maxLength={16} />
              <TouchableOpacity onPress={quickAddClient} disabled={addingClient} accessibilityLabel={tr('Add client')}
                style={{ backgroundColor: c.primary, borderRadius: 10, paddingHorizontal: 14, justifyContent: 'center', opacity: addingClient ? 0.6 : 1 }}>
                {addingClient ? <ActivityIndicator size="small" color={c.onPrimary} /> : <MaterialCommunityIcons name="account-plus" size={20} color={c.onPrimary} />}
              </TouchableOpacity>
            </View>
          )}
          <TextInput style={[modalSearch, { backgroundColor: c.surface, color: c.text, borderColor: c.border }]}
            placeholder={tr('Search name or phone…')} placeholderTextColor={c.textMuted} value={clientSearch} onChangeText={setClientSearch} returnKeyType="search" />
          <FlatList style={listStyle} data={filteredClients} keyExtractor={i => String(i.id)} keyboardShouldPersistTaps="handled"
            initialNumToRender={20} windowSize={7}
            renderItem={({ item }) => (
              <TouchableOpacity style={[mItem, { borderBottomColor: c.divider }]} onPress={() => { setSelectedClient(item); setIsWalkin(false); setShowClientModal(false); setClientSearch(''); }}>
                <Text style={{ color: c.text, fontSize: 15, fontWeight: '600' }}>{item.name}</Text>
                <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 2 }}>{[item.phone, item.loyalty_tier, `${item.loyalty_points || 0} ${tr('pts')}`].filter(Boolean).join('  •  ')}</Text>
              </TouchableOpacity>
            )}
            ListEmptyComponent={<Text style={{ color: c.textMuted, padding: 20, textAlign: 'center' }}>{loadingMaster ? tr('Loading…') : tr('No clients found')}</Text>}
          />
          <TouchableOpacity style={[mClose, { backgroundColor: c.surface }]} onPress={() => { setShowClientModal(false); setClientSearch(''); }}>
            <Text style={{ color: c.textSecondary, fontWeight: '600' }}>{tr('Cancel')}</Text>
          </TouchableOpacity>
        </View>
      </BottomModal>

      {/* SERVICE PICKER MODAL */}
      <BottomModal visible={showServiceModal} onClose={() => { setShowServiceModal(false); setServiceSearch(''); }}>
        <View style={[modalBox, { backgroundColor: c.bg }]}>
          <Text style={[modalTitle, { color: c.text }]}>{tr('Add service')}</Text>
          <TextInput style={[modalSearch, { backgroundColor: c.surface, color: c.text, borderColor: c.border }]}
            placeholder={tr('Search services…')} placeholderTextColor={c.textMuted} value={serviceSearch} onChangeText={setServiceSearch} />
          <FlatList style={listStyle} data={filteredServices} keyExtractor={i => String(i.id)} keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <TouchableOpacity style={[mItem, { borderBottomColor: c.divider }]} onPress={() => addService(item)}>
                <Text style={{ color: c.text, fontSize: 15, fontWeight: '600' }}>{item.name}</Text>
                <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 2 }}>{item.category}  •  {currencySymbol}{fmt(item.price)}  •  {item.duration} {tr('min')}</Text>
              </TouchableOpacity>
            )}
            ListEmptyComponent={<Text style={{ color: c.textMuted, padding: 20, textAlign: 'center' }}>{tr('No services found')}</Text>}
          />
          <TouchableOpacity style={[mClose, { backgroundColor: c.surface }]} onPress={() => { setShowServiceModal(false); setServiceSearch(''); }}>
            <Text style={{ color: c.textSecondary, fontWeight: '600' }}>{tr('Cancel')}</Text>
          </TouchableOpacity>
        </View>
      </BottomModal>

      {/* PRODUCT PICKER MODAL */}
      <BottomModal visible={showProductModal} onClose={() => setShowProductModal(false)}>
        <View style={[modalBox, { backgroundColor: c.bg }]}>
          <Text style={[modalTitle, { color: c.text }]}>{tr('Add product / used item')}</Text>
          <Text style={{ color: c.textMuted, fontSize: 12, marginBottom: 8 }}>💡 {tr('Adding a product here deducts it from inventory and warns you when stock runs low.')}</Text>
          <FlatList style={listStyle} data={products} keyExtractor={i => String(i.id)} keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <TouchableOpacity style={[mItem, { borderBottomColor: c.divider, opacity: item.quantity <= 0 ? 0.4 : 1 }]} onPress={() => addProduct(item)}>
                <Text style={{ color: c.text, fontSize: 15, fontWeight: '600' }}>{item.name}{item.brand ? `  •  ${item.brand}` : ''}</Text>
                <Text style={{ color: item.quantity <= 0 ? c.danger : item.quantity <= item.min_stock ? c.warning : c.textMuted, fontSize: 12, marginTop: 2 }}>
                  {currencySymbol}{fmt(item.sell_price)}  •  {tr('Stock')}: {item.quantity} {item.unit}
                  {item.quantity <= 0 ? `  ❌ ${tr('Out of stock')}` : item.quantity <= item.min_stock ? `  ⚠️ ${tr('Low stock')}` : ''}
                </Text>
              </TouchableOpacity>
            )}
            ListEmptyComponent={<Text style={{ color: c.textMuted, padding: 20, textAlign: 'center' }}>{tr('No retail products. Add products with a sell price in Inventory.')}</Text>}
          />
          <TouchableOpacity style={[mClose, { backgroundColor: c.surface }]} onPress={() => setShowProductModal(false)}>
            <Text style={{ color: c.textSecondary, fontWeight: '600' }}>{tr('Cancel')}</Text>
          </TouchableOpacity>
        </View>
      </BottomModal>

      <BottomModal visible={showQR} onClose={() => setShowQR(false)}>
        <View style={[modalBox, { backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }]}>
          <Text style={[modalTitle, { color: c.text }]}>{tr('Scan to pay {amt}', { amt: `${currencySymbol}${fmt(toCollect)}` })}</Text>
          <View style={{ backgroundColor: '#FFFFFF', padding: 16, borderRadius: 20 }}>
            {profile?.upi_id ? <SvgXml xml={upiQrSvg(upiString({ vpa: profile.upi_id, name: profile.name, amount: toCollect, note: 'Salon bill' }), 6)} width={240} height={240} /> : null}
          </View>
          <Text style={{ color: c.textMuted, marginTop: 10 }}>{profile?.upi_id} · {tr('any UPI app')}</Text>
          <TouchableOpacity style={[mClose, { backgroundColor: c.surface, alignSelf: 'stretch' }]} onPress={() => setShowQR(false)}>
            <Text style={{ color: c.textSecondary, fontWeight: '600' }}>{tr('Done')}</Text>
          </TouchableOpacity>
        </View>
      </BottomModal>

      {/* LINE PRICE OVERRIDE (billing.edit_price) */}
      <BottomSheet visible={!!priceEdit} onClose={() => setPriceEdit(null)} title={tr('Change price')}
        footer={<Button label={tr('Update price')} icon="check" onPress={savePriceEdit} />}>
        {priceEdit && items[priceEdit.idx] ? (
          <>
            <Text style={{ color: c.textMuted, fontSize: 13, marginBottom: 10 }}>
              {items[priceEdit.idx].name}{items[priceEdit.idx].original_price != null ? `  ·  ${tr('List price')} ${currencySymbol}${fmt(items[priceEdit.idx].original_price)}` : ''}
            </Text>
            <TextInput style={[inp, { backgroundColor: c.surface, color: c.text, borderColor: c.border, fontSize: 18 }]}
              value={priceEdit.value} keyboardType="decimal-pad" autoFocus selectTextOnFocus
              onChangeText={v => setPriceEdit(p => (p ? { ...p, value: cleanAmountInput(v) } : p))}
              onSubmitEditing={savePriceEdit} placeholder={tr('Price per unit')} placeholderTextColor={c.textMuted} />
          </>
        ) : null}
      </BottomSheet>
    </SafeScreen>
  );
}

function SectionCard({ title, children }: any) {
  const { colors: c } = useTheme();
  return (
    <View style={[secCard, { backgroundColor: c.card, borderColor: c.borderLight }]}>
      <Text style={{ color: c.textMuted, fontSize: 11, fontWeight: '800', letterSpacing: 0.9, textTransform: 'uppercase', marginBottom: 12 }}>{title}</Text>
      {children}
    </View>
  );
}
function Row({ children }: any) { return <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>{children}</View>; }
function TotalRow({ label, value, c, highlight }: any) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8, gap: 10 }}>
      <Text style={{ color: c.textSecondary, fontSize: 14, flexShrink: 1 }}>{label}</Text>
      <Text style={{ color: highlight || c.text, fontSize: 14, fontWeight: '600' }}>{value}</Text>
    </View>
  );
}

const secCard  = { borderRadius: 18, padding: 16, marginBottom: 12, borderWidth: 0.5 } as const;
const pick     = { borderWidth: 1.5, borderRadius: 12, padding: 13, marginTop: 10 } as const;
const tag      = { borderRadius: 10, padding: 9, marginTop: 8 } as const;
const miniChip = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 };
const chip     = { paddingHorizontal: 15, paddingVertical: 9, borderRadius: 999, borderWidth: 1, marginRight: 8 } as const;
const itemRow  = { flexDirection: 'row' as const, alignItems: 'center' as const, paddingVertical: 12, borderBottomWidth: 1 };
const qBtn     = { width: 32, height: 32, borderRadius: 16, alignItems: 'center' as const, justifyContent: 'center' as const };
const addBtn   = { padding: 12, borderRadius: 10, alignItems: 'center' as const };
const inp      = { borderRadius: 10, padding: 12, fontSize: 14, borderWidth: 1, marginBottom: 10 } as const;
const lbl      = { fontSize: 14, fontWeight: '500' as const };
const totBox   = { borderRadius: 20, padding: 18, marginBottom: 16, borderWidth: 0.5 } as const;
const totFinal = { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, paddingTop: 14, borderTopWidth: 1, marginTop: 8 };
const genBtn   = { borderRadius: 18, paddingVertical: 17, paddingHorizontal: 16, alignItems: 'center' as const, marginBottom: 20 } as const;
// NOTE: flex:1 (not maxHeight) is required here — the FlatList below has its own
// flex:1 and only expands into a *definite* parent height. A maxHeight-only
// parent has an auto main-size, so the list's flex-basis resolves to 0 and it
// renders zero rows (the "select client" list appearing empty bug).
const modalBox  = { flex: 1, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 };
const modalTitle = { fontSize: 20, fontWeight: '800' as const, marginBottom: 14 };
const modalSearch = { borderRadius: 10, padding: 12, fontSize: 14, borderWidth: 1, marginBottom: 10 } as const;
const listStyle = { flex: 1, minHeight: 0 } as const;
const mItem  = { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth } as const;
const mClose = { marginTop: 12, padding: 14, borderRadius: 12, alignItems: 'center' as const } as const;
