import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Text } from '../theme/Text';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';

interface Props {
  value: string;
  onChange: (v: string) => void;
  maxLength?: number;
  onSubmit?: () => void;
  /** Greys out and blocks every key (e.g. while locked out or checking). */
  disabled?: boolean;
}

export function PinDots({ length, filled }: { length: number; filled: number }) {
  const { colors: c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 14, justifyContent: 'center', marginVertical: 22 }}>
      {Array.from({ length }).map((_, i) => (
        <View key={i} style={{
          width: 14, height: 14, borderRadius: 7,
          backgroundColor: i < filled ? c.primary : 'transparent',
          borderWidth: 1.5, borderColor: i < filled ? c.primary : c.border,
        }} />
      ))}
    </View>
  );
}

export function PinPad({ value, onChange, maxLength = 6, onSubmit, disabled }: Props) {
  const { colors: c } = useTheme();
  const press = (d: string) => {
    if (disabled || value.length >= maxLength) return;
    onChange(value + d);
  };
  const del = () => { if (!disabled) onChange(value.slice(0, -1)); };

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'submit', '0', 'del'];
  return (
    <View style={[s.grid, disabled && { opacity: 0.35 }]} pointerEvents={disabled ? 'none' : 'auto'}>
      {keys.map(k => {
        if (k === 'submit') {
          return (
            <TouchableOpacity key={k} style={[s.key, { backgroundColor: 'transparent' }]}
              onPress={onSubmit} disabled={disabled || !onSubmit || value.length < 4} accessibilityLabel="Submit PIN">
              <MaterialCommunityIcons name="check-circle" size={30}
                color={onSubmit && value.length >= 4 ? c.success : c.border} />
            </TouchableOpacity>
          );
        }
        if (k === 'del') {
          return (
            <TouchableOpacity key={k} style={[s.key, { backgroundColor: 'transparent' }]} onPress={del} accessibilityLabel="Delete digit">
              <MaterialCommunityIcons name="backspace-outline" size={26} color={c.textSecondary} />
            </TouchableOpacity>
          );
        }
        return (
          <TouchableOpacity key={k} style={[s.key, { backgroundColor: c.surface }]} onPress={() => press(k)} activeOpacity={0.6}>
            <Text style={[s.keyText, { color: c.text }]}>{k}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 16, maxWidth: 300, alignSelf: 'center' },
  key: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  keyText: { fontSize: 26, fontWeight: '700' },
});
