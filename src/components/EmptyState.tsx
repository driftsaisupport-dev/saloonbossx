import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Text } from '../theme/Text';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { Radius, Shadow } from '../theme/colors';

export const EmptyState = ({ icon, title, subtitle, actionLabel, onAction }: {
  icon: string; title: string; subtitle?: string; actionLabel?: string; onAction?: () => void;
}) => {
  const { colors: c } = useTheme();
  return (
    <View style={s.w}>
      <View style={[s.ic, { backgroundColor: c.primaryLight }]}>
        <MaterialCommunityIcons name={icon as any} size={34} color={c.primary} />
      </View>
      <Text style={[s.t, { color: c.text }]}>{title}</Text>
      {subtitle ? <Text style={[s.st, { color: c.textMuted }]}>{subtitle}</Text> : null}
      {actionLabel && onAction ? (
        <TouchableOpacity style={[s.b, { backgroundColor: c.primary }, Shadow.glow(c.primary)]} onPress={onAction} activeOpacity={0.85}>
          <MaterialCommunityIcons name="plus" size={17} color={c.onPrimary} />
          <Text style={[s.bt, { color: c.onPrimary }]}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
};

const s = StyleSheet.create({
  w: { alignItems: 'center', paddingVertical: 56, paddingHorizontal: 32 },
  ic: { width: 78, height: 78, borderRadius: 24, justifyContent: 'center', alignItems: 'center', marginBottom: 18 },
  t: { fontSize: 17.5, fontWeight: '800', marginBottom: 6, textAlign: 'center', letterSpacing: -0.3 },
  st: { fontSize: 13.5, textAlign: 'center', lineHeight: 20, marginBottom: 22 },
  b: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 22, paddingVertical: 13, borderRadius: Radius.md },
  bt: { fontSize: 14.5, fontWeight: '800' },
});
