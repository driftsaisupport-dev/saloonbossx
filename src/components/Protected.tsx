import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from '../theme/Text';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { SafeScreen } from './SafeScreen';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { PermKey } from '../auth/permissions';

/**
 * Wrap a stack screen's element so it only renders for users who hold `perm`.
 * Defence in depth — menus already hide the entry, this stops deep-linking or a
 * stale navigation state from exposing a restricted screen.
 */
export function Protected({ perm, anyOf, children }: {
  perm?: PermKey; anyOf?: PermKey[]; children: React.ReactNode;
}) {
  const { can, canAny } = useAuth();
  const { colors: c } = useTheme();
  const navigation = useNavigation<any>();

  const allowed = anyOf ? canAny(...anyOf) : perm ? can(perm) : true;
  if (allowed) return <>{children}</>;

  return (
    <SafeScreen>
      <View style={s.wrap}>
        <MaterialCommunityIcons name="lock-outline" size={54} color={c.textLight} />
        <Text style={{ color: c.text, fontSize: 17, fontWeight: '800', marginTop: 16 }}>No access</Text>
        <Text style={{ color: c.textMuted, fontSize: 13.5, marginTop: 6, textAlign: 'center', lineHeight: 19 }}>
          Your account doesn’t have permission to open this. Ask the owner if you need it.
        </Text>
        <Text onPress={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Main'))}
          style={{ color: c.primary, fontWeight: '800', fontSize: 14, marginTop: 22 }}>
          Go back
        </Text>
      </View>
    </SafeScreen>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
});
