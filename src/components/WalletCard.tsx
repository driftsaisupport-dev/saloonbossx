/**
 * WalletCard — the client's prepaid wallet on the client profile.
 *
 *   <WalletCard clientId={id} clientName="Priya" currencySymbol="₹" onChanged={reload} />
 *
 * Big balance, "Add money" (billing.create), history (top-up, bonus, spend
 * with bill no., refund, adjust) and "Adjust balance" with a required reason
 * for owner / manager only (gated on billing.void — the money-reversal right
 * receptionists and stylists do not have).
 */
import React from 'react';
import { View, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text, TextInput } from '../theme/Text';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { DBX } from '../database/Database';
import { useTr } from '../i18n/tr';
import { formatDateTime } from '../utils/helpers';
import { BottomSheet, Button } from './UI';
import { parseAmount, round2, confirmAsync } from './formUtils';
import { useBusy } from './useBusy';
import { appEvents } from './appEvents';
import { WalletTopUpSheet } from './WalletTopUpSheet';
import { AmountField, CardLabel, money } from './WalletShared';
import { curSym } from '../config/regions';

const PAGE = 5;

export function WalletCard({ clientId, clientName, currencySymbol = curSym(), onChanged }: {
  clientId: number;
  clientName?: string;
  currencySymbol?: string;
  onChanged?: (balance: number) => void;
}) {
  const { colors: c } = useTheme();
  const tr = useTr();
  const { can } = useAuth();
  const canTopUp = can('billing.create');
  const canAdjust = can('billing.void');
  const [balance, setBalance] = React.useState<number | null>(null);
  const [txns, setTxns] = React.useState<any[]>([]);
  const [state, setState] = React.useState<'loading' | 'ready' | 'error'>('loading');
  const [showAll, setShowAll] = React.useState(false);
  const [topUpOpen, setTopUpOpen] = React.useState(false);
  const [adjustOpen, setAdjustOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!clientId) return;
    try {
      const [b, t] = await Promise.all([DBX.getWalletBalance(clientId), DBX.getWalletTxns(clientId, 100)]);
      setBalance(b); setTxns(t || []); setState('ready');
    } catch (e) {
      console.warn('[wallet] load', e);
      setState(s => (s === 'ready' ? s : 'error'));
    }
  }, [clientId]);

  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => appEvents.on('bill:created', () => { load(); }), [load]);
  React.useEffect(() => appEvents.on('bill:voided', () => { load(); }), [load]);

  const changed = (b: number) => { setBalance(b); load(); onChanged?.(b); };

  const kindMeta = (k: string): { icon: string; label: string; color: string } => {
    switch (k) {
      case 'topup': return { icon: 'wallet-plus-outline', label: tr('Money added'), color: c.success };
      case 'bonus': return { icon: 'gift-outline', label: tr('Bonus credit'), color: c.accent };
      case 'spend': return { icon: 'receipt-text-outline', label: tr('Used on bill'), color: c.primary };
      case 'refund': return { icon: 'cash-refund', label: tr('Refund to wallet'), color: c.info };
      case 'adjust': return { icon: 'scale-balance', label: tr('Adjustment'), color: c.warning };
      default: return { icon: 'swap-horizontal', label: tr('Wallet entry'), color: c.textSecondary };
    }
  };

  const shown = showAll ? txns : txns.slice(0, PAGE);

  return (
    <View>
      {/* Balance hero */}
      <View style={{ backgroundColor: c.primary, borderRadius: 20, padding: 18, marginBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <MaterialCommunityIcons name="wallet-outline" size={18} color={c.onPrimary} />
          <Text style={{ color: c.onPrimary, fontWeight: '700', fontSize: 13, opacity: 0.9, flex: 1 }}>{tr('Wallet balance')}</Text>
        </View>
        {state === 'loading' ? (
          <ActivityIndicator color={c.onPrimary} style={{ alignSelf: 'flex-start', marginVertical: 14 }} />
        ) : (
          <Text style={{ color: c.onPrimary, fontSize: 34, fontWeight: '900', letterSpacing: -1, marginTop: 6 }} numberOfLines={1} adjustsFontSizeToFit>
            {state === 'error' ? '—' : money(currencySymbol, balance || 0)}
          </Text>
        )}
        <Text style={{ color: c.onPrimary, fontSize: 12, opacity: 0.85, marginTop: 2 }}>
          {tr('Prepaid money the client can spend on any bill.')}
        </Text>
        {(canTopUp || canAdjust) && (
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
            {canTopUp && (
              <TouchableOpacity onPress={() => setTopUpOpen(true)} disabled={state !== 'ready'} accessibilityRole="button"
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: c.card, borderRadius: 12, paddingVertical: 11, opacity: state === 'ready' ? 1 : 0.6 }}>
                <MaterialCommunityIcons name="plus" size={18} color={c.primary} />
                <Text style={{ color: c.primary, fontWeight: '800', fontSize: 14 }}>{tr('Add money')}</Text>
              </TouchableOpacity>
            )}
            {canAdjust && (
              <TouchableOpacity onPress={() => setAdjustOpen(true)} disabled={state !== 'ready'} accessibilityRole="button"
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1.5, borderColor: c.onPrimary, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14, opacity: state === 'ready' ? 1 : 0.6 }}>
                <MaterialCommunityIcons name="scale-balance" size={16} color={c.onPrimary} />
                <Text style={{ color: c.onPrimary, fontWeight: '800', fontSize: 13 }}>{tr('Adjust')}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>

      {state === 'error' && (
        <TouchableOpacity onPress={() => { setState('loading'); load(); }} style={{ backgroundColor: c.dangerLight, borderRadius: 12, padding: 12, marginBottom: 12 }}>
          <Text style={{ color: c.danger, fontWeight: '700' }}>{tr('Could not load the wallet. Tap to try again.')}</Text>
        </TouchableOpacity>
      )}

      {/* History */}
      <View style={{ backgroundColor: c.card, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: c.border, marginBottom: 14 }}>
        <CardLabel text={tr('Wallet history')} />
        {state === 'ready' && txns.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 18 }}>
            <MaterialCommunityIcons name="wallet-outline" size={34} color={c.textLight} />
            <Text style={{ color: c.textMuted, marginTop: 8, textAlign: 'center' }}>{tr('No wallet activity yet.')}</Text>
            {canTopUp ? <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 4, textAlign: 'center' }}>{tr('Offer “Pay 5,000 get 5,500” to bring clients back.')}</Text> : null}
          </View>
        ) : null}
        {shown.map((t, i) => {
          const m = kindMeta(String(t.kind));
          const amt = Number(t.amount) || 0;
          const sub = [
            t.bill_number ? `#${t.bill_number}` : '',
            t.kind === 'topup' && t.method ? String(t.method).toUpperCase() : '',
            t.kind !== 'spend' && t.kind !== 'bonus' && t.note ? t.note : '',
            formatDateTime(t.created_at),
          ].filter(Boolean).join('  •  ');
          return (
            <View key={t.id ?? i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: i ? 0.5 : 0, borderTopColor: c.divider }}>
              <View style={{ width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: m.color + '1A' }}>
                <MaterialCommunityIcons name={m.icon as any} size={18} color={m.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.text, fontWeight: '700', fontSize: 13.5 }}>{m.label}</Text>
                <Text style={{ color: c.textMuted, fontSize: 11.5, marginTop: 1 }} numberOfLines={2}>{sub}</Text>
              </View>
              <Text style={{ color: amt < 0 ? c.danger : c.success, fontWeight: '900', fontSize: 14 }}>
                {amt < 0 ? '−' : '+'}{money(currencySymbol, Math.abs(amt))}
              </Text>
            </View>
          );
        })}
        {txns.length > PAGE && (
          <TouchableOpacity onPress={() => setShowAll(v => !v)} style={{ alignItems: 'center', paddingTop: 10 }}>
            <Text style={{ color: c.primary, fontWeight: '800', fontSize: 13 }}>{showAll ? tr('Show less') : tr('Show all ({n})', { n: txns.length })}</Text>
          </TouchableOpacity>
        )}
      </View>

      <WalletTopUpSheet visible={topUpOpen} onClose={() => setTopUpOpen(false)} clientId={clientId} clientName={clientName}
        currencySymbol={currencySymbol} onDone={changed} />
      {canAdjust && (
        <WalletAdjustSheet visible={adjustOpen} onClose={() => setAdjustOpen(false)} clientId={clientId}
          balance={balance || 0} currencySymbol={currencySymbol} onDone={changed} />
      )}
    </View>
  );
}

/** Owner / manager correction: add or remove credit, reason required. */
function WalletAdjustSheet({ visible, onClose, clientId, balance, currencySymbol, onDone }: {
  visible: boolean; onClose: () => void; clientId: number; balance: number; currencySymbol: string; onDone: (b: number) => void;
}) {
  const { colors: c } = useTheme();
  const tr = useTr();
  const { user } = useAuth();
  const [dir, setDir] = React.useState<'add' | 'remove'>('add');
  const [amount, setAmount] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [saving, run] = useBusy('Balance not changed');

  React.useEffect(() => { if (visible) { setDir('add'); setAmount(''); setReason(''); } }, [visible]);

  const amt = amount.trim() === '' ? NaN : parseAmount(amount);
  const tooMuch = dir === 'remove' && !isNaN(amt) && amt - balance > 0.009;
  const amtBad = amount.trim() !== '' && (isNaN(amt) || amt <= 0);
  const ready = !isNaN(amt) && amt > 0 && !tooMuch && reason.trim().length > 0;
  const after = !isNaN(amt) && amt > 0 ? round2(balance + (dir === 'add' ? amt : -amt)) : balance;

  function save() {
    if (!reason.trim()) { Alert.alert(tr('Reason needed'), tr('Write a short reason for the adjustment.')); return; }
    if (!ready) return;
    run(async () => {
      const ok = await confirmAsync('Adjust balance', tr('Change the wallet from {a} to {b}?', { a: money(currencySymbol, balance), b: money(currencySymbol, after) }), 'Adjust');
      if (!ok) return;
      const r = await DBX.walletAdjust(clientId, dir === 'add' ? amt : -amt, reason.trim(), user?.displayName || user?.username || '');
      appEvents.emit('client:changed', { id: clientId, wallet: r.balance });
      onClose();
      onDone(r.balance);
    });
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} title={tr('Adjust balance')}
      footer={<Button label={tr('Save adjustment')} icon="check" onPress={save} loading={saving} disabled={!ready || saving} />}>
      <Text style={{ color: c.textMuted, marginBottom: 12 }}>
        {tr('Current balance')}: <Text style={{ color: c.text, fontWeight: '800' }}>{money(currencySymbol, balance)}</Text>
      </Text>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
        {(['add', 'remove'] as const).map(k => {
          const on = dir === k;
          const col = k === 'add' ? c.success : c.danger;
          return (
            <TouchableOpacity key={k} onPress={() => setDir(k)} accessibilityRole="button"
              style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderRadius: 12, borderWidth: 1.5,
                borderColor: on ? col : c.border, backgroundColor: on ? col + '1A' : c.card }}>
              <MaterialCommunityIcons name={k === 'add' ? 'plus-circle-outline' : 'minus-circle-outline'} size={18} color={on ? col : c.textMuted} />
              <Text style={{ color: on ? col : c.textSecondary, fontWeight: '800' }}>{k === 'add' ? tr('Add credit') : tr('Remove credit')}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <AmountField label={tr('Amount')} value={amount} onChange={setAmount} currencySymbol={currencySymbol} placeholder="0"
        error={amtBad ? tr('Enter an amount greater than 0.') : tooMuch ? tr('The wallet has only {amt}.', { amt: money(currencySymbol, balance) }) : undefined}
        hint={!isNaN(amt) && amt > 0 && !tooMuch ? tr('New balance: {amt}', { amt: money(currencySymbol, after) }) : undefined} />
      <Text style={{ color: c.textSecondary, fontWeight: '700', fontSize: 12.5, marginBottom: 6 }}>{tr('Reason *')}</Text>
      <TextInput value={reason} onChangeText={setReason} maxLength={200} placeholder={tr('e.g. Wrong amount entered on 12 Oct')} placeholderTextColor={c.textMuted}
        style={{ backgroundColor: c.surface, color: c.text, borderRadius: 12, padding: 12, fontSize: 14, borderWidth: 1, borderColor: c.border }} />
      <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 8 }}>{tr('Adjustments are not counted as money received or spent.')}</Text>
    </BottomSheet>
  );
}
