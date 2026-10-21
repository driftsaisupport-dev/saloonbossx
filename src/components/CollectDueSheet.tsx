/**
 * CollectDueSheet — record money received against a pay-later ("udhaar") bill.
 * Amount (defaults to the full due, partial allowed) + Cash / UPI / Card.
 *
 *   <CollectDueSheet visible={!!due} bill={due} onClose={() => setDue(null)} onCollected={reload} />
 *
 * `bill` needs { id, amount_due } and optionally { bill_number, client_name }.
 * When `bills` (several dues of one client) is given instead, the sheet lets
 * the user pick which bill first.
 */
import React from 'react';
import { View, TouchableOpacity, Alert } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text, TextInput } from '../theme/Text';
import { useTheme } from '../context/ThemeContext';
import { BottomSheet, Button } from './UI';
import { DBX } from '../database/Database';
import { useTr } from '../i18n/tr';
import { parseAmount, cleanAmountInput, showError } from './formUtils';
import { formatDateTime } from '../utils/helpers';
import { appEvents } from './appEvents';
import { appLocale, curSym, payLabel } from '../config/regions';

type Method = 'cash' | 'upi' | 'card';

export function CollectDueSheet({ visible, onClose, bill, bills, onCollected, currencySymbol = curSym() }: {
  visible: boolean;
  onClose: () => void;
  bill?: any | null;
  bills?: any[];
  onCollected?: (remaining: number) => void;
  currencySymbol?: string;
}) {
  const { colors: c } = useTheme();
  const tr = useTr();
  const list = bills && bills.length ? bills : bill ? [bill] : [];
  const [pickedId, setPickedId] = React.useState<number | null>(null);
  const [amount, setAmount] = React.useState('');
  const [method, setMethod] = React.useState<Method>('cash');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (visible) {
      setPickedId(list.length === 1 ? list[0].id : (list[0]?.id ?? null));
      setAmount(''); setMethod('cash');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const target = list.find(b => b.id === pickedId) || null;
  const due = Number(target?.amount_due || 0);
  const amt = amount.trim() === '' ? due : parseAmount(amount);
  const invalid = isNaN(amt) || amt <= 0 || amt - due > 0.009;
  const money = (n: number) => `${currencySymbol}${Number(n || 0).toLocaleString(appLocale(), { maximumFractionDigits: 2 })}`;

  async function save() {
    if (!target || busy) return;
    if (isNaN(amt) || amt <= 0) return Alert.alert(tr('Check the amount'), tr('Enter an amount greater than 0.'));
    if (amt - due > 0.009) return Alert.alert(tr('Too much'), tr('Only {amt} is due on this bill.', { amt: money(due) }));
    setBusy(true);
    try {
      const r = await DBX.collectDue(target.id, amt, method);
      if (!r?.ok) { Alert.alert(tr('Not recorded'), tr(r?.message || 'Please try again.')); return; }
      appEvents.emit('bill:created', { dueCollected: target.id });
      onClose();
      onCollected?.(r.remaining ?? 0);
      Alert.alert(tr('Payment recorded'), r.remaining > 0
        ? tr('{amt} received. {left} still due.', { amt: money(amt), left: money(r.remaining) })
        : tr('{amt} received. Bill fully paid.', { amt: money(amt) }));
    } catch (e) { showError(e, 'Not recorded'); }
    finally { setBusy(false); }
  }

  const methods: { k: Method; label: string; icon: string }[] = [
    { k: 'cash', label: tr('Cash'), icon: 'cash' },
    { k: 'upi', label: payLabel(), icon: 'qrcode' },
    { k: 'card', label: tr('Card'), icon: 'credit-card-outline' },
  ];

  return (
    <BottomSheet visible={visible} onClose={onClose} title={tr('Collect due')}
      footer={<Button label={target ? tr('Record {amt}', { amt: money(isNaN(amt) ? 0 : amt) }) : tr('Record payment')} icon="check" onPress={save} loading={busy} disabled={!target || invalid || busy} />}>
      {list.length > 1 && (
        <View style={{ marginBottom: 12, gap: 8 }}>
          <Text style={{ color: c.textSecondary, fontWeight: '700', fontSize: 12.5 }}>{tr('Which bill?')}</Text>
          {list.map(b => {
            const on = b.id === pickedId;
            return (
              <TouchableOpacity key={b.id} onPress={() => { setPickedId(b.id); setAmount(''); }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, borderWidth: 1.5, borderColor: on ? c.primary : c.border, backgroundColor: on ? c.primaryLight : c.card }}>
                <MaterialCommunityIcons name={on ? 'radiobox-marked' : 'radiobox-blank'} size={18} color={on ? c.primary : c.textMuted} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.text, fontWeight: '700' }}>#{b.bill_number || b.id}</Text>
                  {b.created_at ? <Text style={{ color: c.textMuted, fontSize: 12 }}>{formatDateTime(b.created_at)}</Text> : null}
                </View>
                <Text style={{ color: c.warning, fontWeight: '800' }}>{money(b.amount_due)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
      {target ? (
        <>
          <Text style={{ color: c.textMuted, marginBottom: 12 }}>
            {[target.client_name, target.bill_number ? `#${target.bill_number}` : ''].filter(Boolean).join(' · ')}
            {target.client_name || target.bill_number ? ' · ' : ''}{tr('Due')} <Text style={{ color: c.warning, fontWeight: '800' }}>{money(due)}</Text>
          </Text>
          <Text style={{ color: c.textSecondary, fontWeight: '700', fontSize: 12.5, marginBottom: 6 }}>{tr('Amount received')}</Text>
          <TextInput value={amount} onChangeText={v => setAmount(cleanAmountInput(v))} keyboardType="decimal-pad"
            placeholder={`${money(due)} (${tr('full due')})`} placeholderTextColor={c.textMuted}
            style={{ backgroundColor: c.surface, color: c.text, borderRadius: 12, padding: 13, fontSize: 17, borderWidth: 1.5, borderColor: amount && invalid ? c.danger : c.border }} />
          {amount && invalid ? <Text style={{ color: c.danger, fontSize: 12, marginTop: 4 }}>{tr('Enter an amount between 1 and {amt}.', { amt: money(due) })}</Text> : null}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            {[0.5, 1].map(f => (
              <TouchableOpacity key={f} onPress={() => setAmount(String(Math.round(due * f * 100) / 100))}
                style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }}>
                <Text style={{ color: c.textSecondary, fontWeight: '700', fontSize: 12.5 }}>{f === 1 ? tr('Full') : tr('Half')}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={{ color: c.textSecondary, fontWeight: '700', fontSize: 12.5, marginTop: 16, marginBottom: 8 }}>{tr('Paid by')}</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {methods.map(m => {
              const on = method === m.k;
              return (
                <TouchableOpacity key={m.k} onPress={() => setMethod(m.k)} accessibilityRole="button"
                  style={{ flex: 1, alignItems: 'center', gap: 4, paddingVertical: 12, borderRadius: 12, borderWidth: 1.5, borderColor: on ? c.primary : c.border, backgroundColor: on ? c.primaryLight : c.card }}>
                  <MaterialCommunityIcons name={m.icon as any} size={20} color={on ? c.primary : c.textMuted} />
                  <Text style={{ color: on ? c.primary : c.textSecondary, fontWeight: '800', fontSize: 13 }}>{m.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      ) : (
        <Text style={{ color: c.textMuted }}>{tr('Nothing is due.')}</Text>
      )}
    </BottomSheet>
  );
}
