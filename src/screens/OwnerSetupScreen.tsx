import React, { useState, useEffect } from 'react';
import { View, ScrollView, TouchableOpacity, StyleSheet, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { Text, TextInput } from '../theme/Text';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeScreen } from '../components/SafeScreen';
import { useTheme } from '../context/ThemeContext';
import { Radius } from '../theme/colors';
import { DatabaseService } from '../database/Database';
import { useAuth } from '../context/AuthContext';

const RECOVERY_QUESTIONS = [
  'What city was your salon first opened in?',
  'What is your mother’s maiden name?',
  'What was the name of your first pet?',
  'What is your favourite teacher’s name?',
];

export default function OwnerSetupScreen() {
  const { colors: c } = useTheme();
  const { completeOwnerSetup } = useAuth();

  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('owner');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [question, setQuestion] = useState(RECOVERY_QUESTIONS[0]);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    DatabaseService.getSalonProfile().then((p: any) => {
      if (p?.owner_name) setDisplayName(p.owner_name);
    }).catch(() => {});
  }, []);

  async function submit() {
    if (!displayName.trim()) return Alert.alert('Required', 'Enter your name.');
    if (!/^[a-z0-9._-]{3,20}$/.test(username.trim().toLowerCase()))
      return Alert.alert('Invalid username', '3–20 characters: letters, numbers, . _ -');
    if (!/^\d{4,6}$/.test(pin)) return Alert.alert('Invalid PIN', 'Choose a 4–6 digit PIN.');
    if (pin !== pin2) return Alert.alert('PIN mismatch', 'The two PINs do not match.');
    if (!answer.trim()) return Alert.alert('Required', 'Answer the recovery question so you can reset your PIN later.');

    setBusy(true);
    try {
      const res = await (DatabaseService as any).authCreateUser({
        username: username.trim().toLowerCase(),
        display_name: displayName.trim(),
        pin,
        role: 'owner',
        is_owner: true,
        recovery_question: question,
        recovery_answer: answer,
      });
      if (!res.ok) { Alert.alert('Could not create account', res.message || 'Try again.'); setBusy(false); return; }
      await (DatabaseService as any).logAudit({ username: username.trim().toLowerCase() }, 'owner_account_created', 'app_users', res.id, '');
      await completeOwnerSetup();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Setup failed.');
      setBusy(false);
    }
  }

  const input = [s.input, { backgroundColor: c.card, color: c.text, borderColor: c.border }];

  return (
    <SafeScreen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
          <View style={[s.badge, { backgroundColor: c.primaryLight }]}>
            <MaterialCommunityIcons name="shield-crown-outline" size={30} color={c.primary} />
          </View>
          <Text style={[s.title, { color: c.text }]}>Create the owner account</Text>
          <Text style={[s.sub, { color: c.textSecondary }]}>
            The owner has full access and controls what every other login can see. You’ll sign in with a username and PIN — keep them private.
          </Text>

          <Text style={[s.label, { color: c.textSecondary }]}>Your name</Text>
          <TextInput style={input} value={displayName} onChangeText={setDisplayName} placeholder="e.g. Priya Sharma" placeholderTextColor={c.textMuted} />

          <Text style={[s.label, { color: c.textSecondary }]}>Login username</Text>
          <TextInput style={input} value={username} onChangeText={t => setUsername(t.toLowerCase().replace(/[^a-z0-9._-]/g, ''))}
            autoCapitalize="none" autoCorrect={false} placeholder="owner" placeholderTextColor={c.textMuted} />

          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={[s.label, { color: c.textSecondary }]}>PIN (4–6 digits)</Text>
              <TextInput style={input} value={pin} onChangeText={t => setPin(t.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad" secureTextEntry placeholder="••••" placeholderTextColor={c.textMuted} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.label, { color: c.textSecondary }]}>Confirm PIN</Text>
              <TextInput style={input} value={pin2} onChangeText={t => setPin2(t.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad" secureTextEntry placeholder="••••" placeholderTextColor={c.textMuted} />
            </View>
          </View>

          <Text style={[s.label, { color: c.textSecondary, marginTop: 6 }]}>Recovery question</Text>
          <View style={{ gap: 8 }}>
            {RECOVERY_QUESTIONS.map(q => (
              <TouchableOpacity key={q} onPress={() => setQuestion(q)}
                style={[s.qRow, { borderColor: question === q ? c.primary : c.border, backgroundColor: question === q ? c.primaryLight : c.card }]}>
                <MaterialCommunityIcons name={question === q ? 'radiobox-marked' : 'radiobox-blank'} size={18} color={question === q ? c.primary : c.textMuted} />
                <Text style={{ color: c.text, fontSize: 13, flex: 1 }}>{q}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={[s.label, { color: c.textSecondary }]}>Your answer</Text>
          <TextInput style={input} value={answer} onChangeText={setAnswer} placeholder="Remember this exactly" placeholderTextColor={c.textMuted} />

          <TouchableOpacity style={[s.btn, { backgroundColor: busy ? c.textMuted : c.primary }]} onPress={submit} disabled={busy}>
            <Text style={[s.btnText, { color: c.onPrimary }]}>{busy ? 'Creating…' : 'Create owner account'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeScreen>
  );
}

const s = StyleSheet.create({
  badge: { width: 60, height: 60, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  title: { fontSize: 24, fontWeight: '900', letterSpacing: -0.5 },
  sub: { fontSize: 13.5, lineHeight: 20, marginTop: 8, marginBottom: 18 },
  label: { fontSize: 12.5, fontWeight: '700', marginBottom: 6, marginTop: 12 },
  input: { borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, borderWidth: 1.5 },
  qRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1.5, borderRadius: Radius.md, padding: 12 },
  btn: { marginTop: 24, paddingVertical: 16, borderRadius: Radius.md, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
});
