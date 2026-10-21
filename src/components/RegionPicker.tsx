/**
 * RegionPicker — choose the salon's country.
 *
 * The country sets currency, tax name and rates, phone format, the QR wallet
 * (UPI, PIX, PayNow, M-Pesa…) and the subscription price list. Used by
 * onboarding and Settings → Country & currency.
 */
import React, { useMemo, useState } from 'react';
import { View, TouchableOpacity, TextInput, FlatList } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from '../theme/Text';
import { useTheme } from '../context/ThemeContext';
import { BottomModal } from './BottomModal';
import { useTr } from '../i18n/tr';
import { REGIONS, type Region } from '../config/regions';

export function RegionRow({ r, selected, onPress }: { r: Region; selected?: boolean; onPress: () => void }) {
  const { colors: c } = useTheme();
  return (
    <TouchableOpacity onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: c.divider }}>
      <Text style={{ fontSize: 22 }}>{r.flag}</Text>
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.text, fontSize: 14.5, fontWeight: '700' }}>{r.name}</Text>
        <Text style={{ color: c.textMuted, fontSize: 12 }}>
          {r.currency} {r.symbol.trim()} · {r.tax.name}{r.dial ? ` · +${r.dial}` : ''} · {r.pay.label}
        </Text>
      </View>
      <MaterialCommunityIcons name={selected ? 'radiobox-marked' : 'radiobox-blank'} size={20} color={selected ? c.primary : c.textMuted} />
    </TouchableOpacity>
  );
}

export function RegionPickerSheet({ visible, current, onClose, onPick }: {
  visible: boolean; current: string; onClose: () => void; onPick: (code: string) => void | Promise<void>;
}) {
  const { colors: c } = useTheme();
  const tr = useTr();
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return REGIONS;
    return REGIONS.filter(r => r.name.toLowerCase().includes(s) || r.currency.toLowerCase().includes(s) || r.code.toLowerCase() === s);
  }, [q]);

  return (
    <BottomModal visible={visible} onClose={onClose} height="85%">
      <View style={{ padding: 20, flex: 1 }}>
        <Text style={{ color: c.text, fontSize: 18, fontWeight: '800' }}>{tr('Where is your salon?')}</Text>
        <Text style={{ color: c.textMuted, fontSize: 13, marginTop: 2, marginBottom: 12 }}>{tr('Sets currency, tax, phone format and prices')}</Text>
        <TextInput value={q} onChangeText={setQ} placeholder={tr('Search country…')} placeholderTextColor={c.textMuted}
          style={{ backgroundColor: c.surface, color: c.text, borderRadius: 12, padding: 12, fontSize: 15, borderWidth: 1, borderColor: c.border, marginBottom: 6 }} />
        <FlatList data={list} keyExtractor={r => r.code} keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => <RegionRow r={item} selected={item.code === current} onPress={async () => { await onPick(item.code); setQ(''); onClose(); }} />} />
      </View>
    </BottomModal>
  );
}
