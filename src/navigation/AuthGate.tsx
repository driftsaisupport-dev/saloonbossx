import React from 'react';
import { View, ActivityIndicator, StyleSheet, Modal, Keyboard } from 'react-native';
import { Text } from '../theme/Text';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import AppNavigator from './AppNavigator';
import OwnerSetupScreen from '../screens/OwnerSetupScreen';
import LoginScreen from '../screens/LoginScreen';
import ChangePinScreen from '../screens/ChangePinScreen';
import { tr } from '../i18n/tr';

export default function AuthGate() {
  const { ready, needsOwnerSetup, user, locked, pokeActivity } = useAuth();
  const { colors: c } = useTheme();

  // Dismiss the keyboard the moment we lock so nothing typed lands under the lock.
  React.useEffect(() => { if (locked) Keyboard.dismiss(); }, [locked]);

  if (!ready) {
    return (
      <View style={[s.center, { backgroundColor: c.bg }]}>
        <ActivityIndicator color={c.primary} />
        <Text style={{ color: c.textMuted, marginTop: 12, fontSize: 12 }}>{tr('Loading accounts…')}</Text>
      </View>
    );
  }

  if (needsOwnerSetup) return <OwnerSetupScreen />;

  // No session at all → full-screen sign in.
  if (!user) return <LoginScreen />;

  if (user.mustChangePin) return <ChangePinScreen />;

  // Session exists. Keep the app mounted underneath so no unsaved work is lost,
  // and drop the sign-in screen over the top when locked.
  //
  // The lock is itself a <Modal>: a plain absolute overlay sits *below* any
  // native Modal a screen has open (bill sheet, edit sheet…), which left
  // "Cancel bill" tappable on a locked phone. A Modal shown later is stacked
  // above earlier ones, so this covers everything. Back button does nothing.
  return (
    <View
      style={{ flex: 1 }}
      onStartShouldSetResponderCapture={() => { pokeActivity(); return false; }}
      onMoveShouldSetResponderCapture={() => { pokeActivity(); return false; }}>
      <AppNavigator key={user.id} />
      {locked && <View style={[StyleSheet.absoluteFill, { backgroundColor: c.bg }]} />}
      <Modal visible={locked} animationType="fade" transparent={false} statusBarTranslucent
        onRequestClose={() => { /* stay locked */ }}>
        <View style={{ flex: 1, backgroundColor: c.bg }}>
          {locked ? <LoginScreen /> : null}
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
