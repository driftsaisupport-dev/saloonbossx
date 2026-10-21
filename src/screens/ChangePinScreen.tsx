import React, { useState } from 'react';
import { View, StyleSheet, Alert, ScrollView } from 'react-native';
import { Text, TextInput } from '../theme/Text';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeScreen } from '../components/SafeScreen';
import { useTheme } from '../context/ThemeContext';
import { DatabaseService } from '../database/Database';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/UI';
import { useTr } from '../i18n/tr';
import { showError } from '../components/formUtils';

export default function ChangePinScreen() {
  const { colors: c } = useTheme();
  const tr = useTr();
  const { user, refreshSession, logout } = useAuth();
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy) return;
    if (!/^\d{4,6}$/.test(pin)) return Alert.alert(tr('Invalid PIN'), tr('Choose a 4–6 digit PIN.'));
    if (pin !== pin2) return Alert.alert(tr('PINs do not match'), tr('The two PINs do not match.'));
    if (/^(\d)\1+$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) {
      return Alert.alert(tr('PIN too easy'), tr('Avoid 1111 or 1234 — pick a PIN others cannot guess.'));
    }
    if (!user) return;
    setBusy(true);
    try {
      const r = await (DatabaseService as any).authSetPin(user.id, pin, false, user.id);
      if (!r?.ok) { Alert.alert(tr('Could not save PIN'), tr(r?.message || 'Could not set PIN.')); return; }
      await (DatabaseService as any).logAudit({ id: user.id, username: user.username }, 'pin_changed', 'app_users', user.id, 'first login').catch(() => {});
      await refreshSession();
    } catch (e) {
      showError(e, 'Could not save PIN');
    } finally { setBusy(false); }
  }

  const input = [s.input, { backgroundColor: c.card, color: c.text, borderColor: c.border }];
  return (
    <SafeScreen>
      <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 60 }} keyboardShouldPersistTaps="handled">
        <View style={[s.badge, { backgroundColor: c.warningLight }]}>
          <MaterialCommunityIcons name="lock-reset" size={28} color={c.warning} />
        </View>
        <Text style={{ color: c.text, fontSize: 22, fontWeight: '900' }}>{tr('Set your own PIN')}</Text>
        <Text style={{ color: c.textSecondary, fontSize: 14, marginTop: 8, lineHeight: 20, marginBottom: 20 }}>
          {tr('The owner created your account with a temporary PIN. Choose a private PIN only you know.')}
        </Text>
        <Text style={[s.label, { color: c.textSecondary }]}>{tr('New PIN')}</Text>
        <TextInput style={input} value={pin} onChangeText={t => setPin(t.replace(/\D/g, '').slice(0, 6))}
          keyboardType="number-pad" secureTextEntry placeholder="••••" placeholderTextColor={c.textMuted} />
        <Text style={[s.label, { color: c.textSecondary }]}>{tr('Confirm PIN')}</Text>
        <TextInput style={input} value={pin2} onChangeText={t => setPin2(t.replace(/\D/g, '').slice(0, 6))}
          keyboardType="number-pad" secureTextEntry placeholder="••••" placeholderTextColor={c.textMuted}
          returnKeyType="done" onSubmitEditing={save} />
        <View style={{ height: 24 }} />
        <Button label={busy ? tr('Saving…') : tr('Save PIN')} icon="check" onPress={save} loading={busy} disabled={busy} />
        <Text onPress={() => { if (!busy) logout().catch(e => showError(e, 'Could not sign out')); }} accessibilityRole="button"
          style={{ color: c.textMuted, fontWeight: '700', fontSize: 13, textAlign: 'center', marginTop: 18, paddingVertical: 8 }}>
          {tr('Cancel and sign out')}
        </Text>
      </ScrollView>
    </SafeScreen>
  );
}

const s = StyleSheet.create({
  badge: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  label: { fontSize: 12.5, fontWeight: '700', marginBottom: 6, marginTop: 14 },
  input: { borderRadius: 14, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, borderWidth: 1.5 },
});
