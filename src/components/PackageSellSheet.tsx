/**
 * PackageSellSheet — sell a package template to a client.
 *
 *   <PackageSellSheet visible={open} onClose={() => setOpen(false)} clientId={id}
 *     clientName="Priya" walletBalance={500} currencySymbol="₹" onSold={r => ...} onManage={() => nav('Packages')} />
 *
 * Lists active templates (DBX.getMemberships) with price and what they give,
 * paid amount (defaults to the full price), method (Cash / UPI / Card, or
 * Wallet when the balance covers it). DBX.assignMembership creates the sale
 * bill; its number is shown on success.
 */
import React from 'react';
import { View, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from '../theme/Text';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { DatabaseService, DBX } from '../database/Database';
import { useTr } from '../i18n/tr';
import { BottomSheet, Button } from './UI';
import { parseAmount, confirmAsync } from './formUtils';
import { useBusy } from './useBusy';
import { appEvents } from './appEvents';
import { AmountField, PayMethodPicker, PayMethodKey, money } from './WalletShared';
import { curSym } from '../config/regions';

export interface PackageSaleResult { clientMembershipId?: number; billId?: number; billNumber?: string }

/** One line saying what a template gives. Exported for reuse. */
export function describeTemplate(m: any, sym: string, serviceName: string, tr: (s: string, v?: any) => string): string {
  const days = Number(m.duration_days) || 365;
  const validity = tr('valid {n} days', { n: days });
  if (Number(m.max_sessions) > 0) {
    return [tr('{n} sessions', { n: m.max_sessions }), serviceName ? tr('of {s}', { s: serviceName }) : tr('any service'), validity].join(' · ');
  }
  const value = Number(m.value_amount) > 0 ? Number(m.value_amount) : !(Number(m.discount_percent) > 0) ? Number(m.price) || 0 : 0;
  if (value > 0) return [tr('{amt} of services', { amt: money(sym, value) }), serviceName ? tr('on {s}', { s: serviceName }) : '', validity].filter(Boolean).join(' · ');
  return [tr('{p}% off every bill', { p: m.discount_percent }), validity].join(' · ');
}

export function PackageSellSheet({ visible, onClose, clientId, clientName, walletBalance = 0, currencySymbol = curSym(), onSold, onManage }: {
  visible: boolean;
  onClose: () => void;
  clientId: number;
  clientName?: string;
  walletBalance?: number;
  currencySymbol?: string;
  onSold?: (r: PackageSaleResult) => void;
  onManage?: () => void;
}) {
  const { colors: c } = useTheme();
  const tr = useTr();
  const { user } = useAuth();
  const [templates, setTemplates] = React.useState<any[]>([]);
  const [svcNames, setSvcNames] = React.useState<Record<number, string>>({});
  const [state, setState] = React.useState<'loading' | 'ready' | 'error'>('loading');
  const [pickedId, setPickedId] = React.useState<number | null>(null);
  const [paid, setPaid] = React.useState('');
  const [method, setMethod] = React.useState<PayMethodKey>('cash');
  const [saving, run] = useBusy('Package not sold');

  const load = React.useCallback(async () => {
    setState('loading');
    try {
      const [t, s] = await Promise.all([DatabaseService.getMemberships(), DatabaseService.getServices().catch(() => [])]);
      const map: Record<number, string> = {};
      for (const x of (s as any[]) || []) map[x.id] = x.name;
      setTemplates((t as any[]) || []); setSvcNames(map); setState('ready');
    } catch (e) { console.warn('[packages] templates', e); setState('error'); }
  }, []);

  React.useEffect(() => {
    if (!visible) return;
    setPickedId(null); setPaid(''); setMethod('cash');
    load();
  }, [visible, load]);

  const picked = templates.find(t => t.id === pickedId) || null;
  const price = Number(picked?.price) || 0;
  const amt = paid.trim() === '' ? price : parseAmount(paid);
  const amtBad = isNaN(amt) || amt < 0 || amt - price > 0.009;
  const walletShort = method === 'wallet' && !isNaN(amt) && amt - walletBalance > 0.009;
  const ready = !!picked && !amtBad && !walletShort;

  function sell() {
    if (!picked || !ready) return;
    run(async () => {
      if (amt === 0) {
        const ok = await confirmAsync('No payment', tr('Give {name} free of charge? No bill will be made.', { name: picked.name }), 'Give free');
        if (!ok) return;
      }
      const r = await DBX.assignMembership(clientId, picked.id, {
        paidAmount: amt, method: amt > 0 ? method : undefined, soldBy: user?.displayName || user?.username || '',
      });
      if (!r?.ok) { Alert.alert(tr('Package not sold'), tr(r?.message || 'Please try again.')); return; }
      if (r.billId) appEvents.emit('bill:created', { billId: r.billId, packageSale: true });
      appEvents.emit('client:changed', { id: clientId });
      onClose();
      onSold?.(r);
      Alert.alert(tr('Package sold'), r.billNumber
        ? tr('{pkg} sold to {name}. Bill #{bill} for {amt}.', { pkg: picked.name, name: clientName || tr('the client'), bill: r.billNumber, amt: money(currencySymbol, amt) })
        : tr('{pkg} given to {name}.', { pkg: picked.name, name: clientName || tr('the client') }));
    });
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} title={tr('Sell package')}
      footer={state === 'ready' && templates.length > 0
        ? <Button label={picked ? (amt > 0 && !isNaN(amt) ? tr('Sell for {amt}', { amt: money(currencySymbol, amt) }) : tr('Give package')) : tr('Pick a package')}
            icon="package-variant-closed" onPress={sell} loading={saving} disabled={!ready || saving} />
        : undefined}>
      {clientName ? <Text style={{ color: c.textMuted, marginBottom: 12 }}>{clientName}</Text> : null}

      {state === 'loading' && <ActivityIndicator color={c.primary} style={{ marginVertical: 24 }} />}
      {state === 'error' && (
        <View style={{ alignItems: 'center', paddingVertical: 16, gap: 10 }}>
          <Text style={{ color: c.danger, textAlign: 'center' }}>{tr('Could not load packages.')}</Text>
          <Button label={tr('Try again')} variant="subtle" full={false} onPress={load} />
        </View>
      )}
      {state === 'ready' && templates.length === 0 && (
        <View style={{ alignItems: 'center', paddingVertical: 16, gap: 8 }}>
          <MaterialCommunityIcons name="package-variant" size={40} color={c.textLight} />
          <Text style={{ color: c.text, fontWeight: '800' }}>{tr('No packages yet')}</Text>
          <Text style={{ color: c.textMuted, textAlign: 'center' }}>{tr('Create packages like “6 hair spas for ₹4,999” first.')}</Text>
          {onManage ? <Button label={tr('Create packages')} variant="subtle" full={false} onPress={() => { onClose(); onManage(); }} /> : null}
        </View>
      )}

      {state === 'ready' && templates.map(t => {
        const on = t.id === pickedId;
        return (
          <TouchableOpacity key={t.id} onPress={() => { setPickedId(t.id); setPaid(''); }} accessibilityRole="radio" accessibilityState={{ selected: on }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, borderWidth: 1.5, marginBottom: 8,
              borderColor: on ? c.primary : c.border, backgroundColor: on ? c.primaryLight : c.card }}>
            <MaterialCommunityIcons name={on ? 'radiobox-marked' : 'radiobox-blank'} size={20} color={on ? c.primary : c.textMuted} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.text, fontWeight: '800', fontSize: 14.5 }}>{t.name}</Text>
              <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 2 }}>{describeTemplate(t, currencySymbol, svcNames[t.service_id] || '', tr)}</Text>
            </View>
            <Text style={{ color: c.primary, fontWeight: '900', fontSize: 15 }}>{money(currencySymbol, t.price)}</Text>
          </TouchableOpacity>
        );
      })}

      {picked && (
        <View style={{ marginTop: 8 }}>
          <AmountField label={tr('Amount paid now')} value={paid} onChange={setPaid} currencySymbol={currencySymbol}
            placeholder={`${money(currencySymbol, price).replace(currencySymbol, '')} (${tr('full price')})`}
            error={amtBad ? tr('Enter an amount between 0 and {amt}.', { amt: money(currencySymbol, price) }) : undefined} />
          {amt > 0 && !amtBad && (<>
            <Text style={{ color: c.textSecondary, fontWeight: '700', fontSize: 12.5, marginBottom: 8 }}>{tr('Paid by')}</Text>
            <PayMethodPicker value={method} onChange={setMethod}
              methods={walletBalance > 0 ? ['cash', 'upi', 'card', 'wallet'] : ['cash', 'upi', 'card']}
              disabled={{ wallet: amt - walletBalance > 0.009 }} />
            {walletBalance > 0 ? (
              <Text style={{ color: walletShort ? c.danger : c.textMuted, fontSize: 12, marginTop: 6 }}>
                {tr('Wallet balance: {amt}', { amt: money(currencySymbol, walletBalance) })}
              </Text>
            ) : null}
          </>)}
        </View>
      )}
    </BottomSheet>
  );
}
