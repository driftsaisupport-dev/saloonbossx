/**
 * WalletTopUpSheet — "Add money" to a client's prepaid wallet.
 *
 *   <WalletTopUpSheet visible={open} onClose={() => setOpen(false)}
 *     clientId={id} clientName="Priya" currencySymbol="₹" onDone={balance => ...} />
 *
 * Amount received + optional bonus ("Pay 5,000 get 5,500") + Cash / UPI / Card
 * + note. Calls DBX.walletTopUp; the bonus is recorded as its own entry.
 */
import React from 'react';
import { View, TouchableOpacity, Alert } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text, TextInput } from '../theme/Text';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { DBX } from '../database/Database';
import { useTr } from '../i18n/tr';
import { BottomSheet, Button } from './UI';
import { parseAmount, parseOptionalAmount, round2 } from './formUtils';
import { useBusy } from './useBusy';
import { appEvents } from './appEvents';
import { AmountField, PayMethodPicker, PayMethodKey, money } from './WalletShared';
import { curSym } from '../config/regions';

/** Common Indian salon offers: pay X, get X + bonus. */
const OFFERS: { pay: number; bonus: number }[] = [
  { pay: 2000, bonus: 200 },
  { pay: 5000, bonus: 500 },
  { pay: 10000, bonus: 1500 },
];

export function WalletTopUpSheet({ visible, onClose, clientId, clientName, currencySymbol = curSym(), onDone }: {
  visible: boolean;
  onClose: () => void;
  clientId: number;
  clientName?: string;
  currencySymbol?: string;
  onDone?: (balance: number) => void;
}) {
  const { colors: c } = useTheme();
  const tr = useTr();
  const { user } = useAuth();
  const [amount, setAmount] = React.useState('');
  const [bonus, setBonus] = React.useState('');
  const [method, setMethod] = React.useState<PayMethodKey>('cash');
  const [note, setNote] = React.useState('');
  const [saving, run] = useBusy('Money not added');

  React.useEffect(() => {
    if (visible) { setAmount(''); setBonus(''); setMethod('cash'); setNote(''); }
  }, [visible]);

  const amt = amount.trim() === '' ? NaN : parseAmount(amount);
  const bon = parseOptionalAmount(bonus);
  const amtBad = amount.trim() !== '' && (isNaN(amt) || amt <= 0);
  const bonBad = isNaN(bon) || bon < 0;
  const credit = !isNaN(amt) && amt > 0 && !bonBad ? round2(amt + bon) : 0;
  const ready = !isNaN(amt) && amt > 0 && !bonBad;

  function save() {
    if (!ready) {
      Alert.alert(tr('Check the amount'), tr('Enter the money received (more than 0).'));
      return;
    }
    run(async () => {
      const r = await DBX.walletTopUp(clientId, amt, method, bon, note.trim(), user?.displayName || user?.username || '');
      appEvents.emit('client:changed', { id: clientId, wallet: r.balance });
      onClose();
      onDone?.(r.balance);
      Alert.alert(tr('Money added'), tr('{amt} added to {name}’s wallet. New balance: {bal}.', {
        amt: money(currencySymbol, credit), name: clientName || tr('the client'), bal: money(currencySymbol, r.balance),
      }));
    });
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} title={tr('Add money to wallet')}
      footer={<Button label={credit > 0 ? tr('Add {amt}', { amt: money(currencySymbol, credit) }) : tr('Add money')} icon="wallet-plus-outline"
        onPress={save} loading={saving} disabled={!ready || saving} />}>
      {clientName ? <Text style={{ color: c.textMuted, marginBottom: 12 }}>{clientName}</Text> : null}

      <Text style={{ color: c.textSecondary, fontWeight: '700', fontSize: 12.5, marginBottom: 8 }}>{tr('Quick offers')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        {OFFERS.map(o => {
          const on = amt === o.pay && bon === o.bonus;
          return (
            <TouchableOpacity key={o.pay} onPress={() => { setAmount(String(o.pay)); setBonus(String(o.bonus)); }} accessibilityRole="button"
              style={{ paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, borderWidth: 1.5,
                borderColor: on ? c.primary : c.border, backgroundColor: on ? c.primaryLight : c.card }}>
              <Text style={{ color: on ? c.primary : c.text, fontWeight: '800', fontSize: 13 }}>
                {tr('Pay {a} get {b}', { a: money(currencySymbol, o.pay), b: money(currencySymbol, o.pay + o.bonus) })}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <AmountField label={tr('Money received')} value={amount} onChange={setAmount} currencySymbol={currencySymbol}
        placeholder="5,000" error={amtBad ? tr('Enter an amount greater than 0.') : undefined} />
      <AmountField label={tr('Bonus credit (free, optional)')} value={bonus} onChange={setBonus} currencySymbol={currencySymbol}
        placeholder="0" error={bonBad ? tr('Bonus must be a number that is 0 or more.') : undefined}
        hint={tr('Bonus is extra credit for the client — it is not money received.')} />

      {credit > 0 ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.successLight, borderRadius: 12, padding: 12, marginBottom: 14 }}>
          <MaterialCommunityIcons name="wallet-plus" size={18} color={c.success} />
          <Text style={{ color: c.success, fontWeight: '800', flex: 1 }}>
            {tr('Wallet gets {amt}', { amt: money(currencySymbol, credit) })}
          </Text>
        </View>
      ) : null}

      <Text style={{ color: c.textSecondary, fontWeight: '700', fontSize: 12.5, marginBottom: 8 }}>{tr('Paid by')}</Text>
      <PayMethodPicker value={method} onChange={setMethod} />

      <Text style={{ color: c.textSecondary, fontWeight: '700', fontSize: 12.5, marginTop: 14, marginBottom: 6 }}>{tr('Note (optional)')}</Text>
      <TextInput value={note} onChangeText={setNote} maxLength={200} placeholder={tr('e.g. Diwali offer')} placeholderTextColor={c.textMuted}
        style={{ backgroundColor: c.surface, color: c.text, borderRadius: 12, padding: 12, fontSize: 14, borderWidth: 1, borderColor: c.border }} />
    </BottomSheet>
  );
}
