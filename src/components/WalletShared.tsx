/**
 * Small building blocks shared by the v5.6 wallet / package / appointment UI:
 * a money formatter, the Cash / UPI / Card picker and a big amount field.
 * Theme tokens only; every label goes through tr().
 */
import React from 'react';
import { View, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text, TextInput } from '../theme/Text';
import { useTheme } from '../context/ThemeContext';
import { useTr } from '../i18n/tr';
import { cleanAmountInput } from './formUtils';
import { appLocale, curSym, payLabel } from '../config/regions';

export type PayMethodKey = 'cash' | 'upi' | 'card' | 'wallet';

/** ₹1,500 / ₹1,500.5 — Indian grouping, at most 2 decimals. */
export function money(sym: string, n: number): string {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return `${sym}${v.toLocaleString(appLocale(), { maximumFractionDigits: 2 })}`;
}

const META: Record<PayMethodKey, { label: string; icon: string }> = {
  cash: { label: 'Cash', icon: 'cash' },
  get upi() { return { label: payLabel(), icon: 'qrcode' }; },
  card: { label: 'Card', icon: 'credit-card-outline' },
  wallet: { label: 'Wallet', icon: 'wallet-outline' },
};

/** Big, thumb-friendly method tiles (one row). */
export function PayMethodPicker({ value, onChange, methods = ['cash', 'upi', 'card'], disabled }: {
  value: PayMethodKey;
  onChange: (m: PayMethodKey) => void;
  methods?: PayMethodKey[];
  disabled?: Partial<Record<PayMethodKey, boolean>>;
}) {
  const { colors: c } = useTheme();
  const tr = useTr();
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {methods.map(k => {
        const on = value === k;
        const off = !!disabled?.[k];
        return (
          <TouchableOpacity key={k} disabled={off} onPress={() => onChange(k)} accessibilityRole="button" accessibilityState={{ selected: on, disabled: off }}
            style={{ flex: 1, alignItems: 'center', gap: 4, paddingVertical: 11, borderRadius: 12, borderWidth: 1.5, opacity: off ? 0.4 : 1,
              borderColor: on ? c.primary : c.border, backgroundColor: on ? c.primaryLight : c.card }}>
            <MaterialCommunityIcons name={META[k].icon as any} size={20} color={on ? c.primary : c.textMuted} />
            <Text style={{ color: on ? c.primary : c.textSecondary, fontWeight: '800', fontSize: 12.5 }} numberOfLines={1}>{tr(META[k].label)}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/** Labelled money field with the currency symbol in front. */
export function AmountField({ label, value, onChange, placeholder, error, hint, currencySymbol = curSym(), autoFocus }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
  error?: string; hint?: string; currencySymbol?: string; autoFocus?: boolean;
}) {
  const { colors: c } = useTheme();
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={{ color: c.textSecondary, fontWeight: '700', fontSize: 12.5, marginBottom: 6 }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface, borderRadius: 12, borderWidth: 1.5, borderColor: error ? c.danger : c.border, paddingHorizontal: 13 }}>
        <Text style={{ color: c.textMuted, fontSize: 17, fontWeight: '800', marginRight: 6 }}>{currencySymbol}</Text>
        <TextInput value={value} onChangeText={v => onChange(cleanAmountInput(v))} keyboardType="decimal-pad" autoFocus={autoFocus}
          placeholder={placeholder} placeholderTextColor={c.textMuted}
          style={{ flex: 1, color: c.text, fontSize: 17, fontWeight: '700', paddingVertical: 12 }} />
      </View>
      {error ? <Text style={{ color: c.danger, fontSize: 12, marginTop: 4 }}>{error}</Text>
        : hint ? <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 4 }}>{hint}</Text> : null}
    </View>
  );
}

/** Small uppercase section label used inside cards. */
export function CardLabel({ text, right }: { text: string; right?: React.ReactNode }) {
  const { colors: c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10, minHeight: 20 }}>
      <Text style={{ color: c.textMuted, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8, flex: 1 }}>{text}</Text>
      {right}
    </View>
  );
}
