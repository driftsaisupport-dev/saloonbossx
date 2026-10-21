import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, ScrollView, TouchableOpacity, StyleSheet, Alert, Keyboard, ActivityIndicator } from 'react-native';
import { Text, TextInput } from '../theme/Text';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeScreen } from '../components/SafeScreen';
import { PinPad, PinDots } from '../components/PinPad';
import { useTheme } from '../context/ThemeContext';
import { DatabaseService, DBX } from '../database/Database';
import { useAuth } from '../context/AuthContext';
import { ROLE_LABELS } from '../auth/permissions';
import { useTr } from '../i18n/tr';
import { showError } from '../components/formUtils';

const LAST_USER_KEY = 'last_username';

type LockInfo = { locked: boolean; until: number; attemptsLeft: number | null };

/** `until` may arrive as ms, seconds, an ISO string or a SQLite timestamp. */
function toMs(v: any): number {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  const s = String(v);
  if (/^\d+$/.test(s)) return toMs(Number(s));
  const t = Date.parse(s.includes('T') || s.endsWith('Z') ? s : s.replace(' ', 'T'));
  return isNaN(t) ? 0 : t;
}

/** Ask the data layer for the lockout state, when it supports it. */
async function fetchLock(userId: number | null | undefined): Promise<LockInfo | null> {
  const DB: any = DatabaseService;
  if (!userId || typeof DB.authLockStatus !== 'function') return null;
  try {
    const r = await DB.authLockStatus(userId);
    if (!r) return null;
    const until = toMs(r.until);
    const locked = !!r.locked && (until === 0 || until > Date.now());
    const left = r.attemptsLeft == null || isNaN(Number(r.attemptsLeft)) ? null : Number(r.attemptsLeft);
    return { locked, until, attemptsLeft: left };
  } catch { return null; }
}

function fmtWait(ms: number, tr: (s: string, v?: any) => string): string {
  const sec = Math.max(1, Math.ceil(ms / 1000));
  if (sec < 60) return tr('{n} sec', { n: sec });
  const m = Math.floor(sec / 60), r = sec % 60;
  return r ? tr('{m} min {s} sec', { m, s: r }) : tr('{m} min', { m });
}

export default function LoginScreen() {
  const { colors: c } = useTheme();
  const tr = useTr();
  const { user, locked, login, unlock, logout } = useAuth();

  const hasSession = locked && !!user; // locked over a live session

  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [showAccounts, setShowAccounts] = useState(false);
  const [accounts, setAccounts] = useState<any[]>([]);

  // recovery
  const [recovering, setRecovering] = useState(false);
  const [recQ, setRecQ] = useState('');
  const [recAnswer, setRecAnswer] = useState('');
  const [newPin, setNewPin] = useState('');
  const [recUserId, setRecUserId] = useState<number | null>(null);
  const [recBusy, setRecBusy] = useState(false);

  // lockout (brute-force protection) — UI half; the data layer enforces it.
  const [lockInfo, setLockInfo] = useState<LockInfo | null>(null);
  const [now, setNow] = useState(Date.now());
  const lockedOut = !!lockInfo?.locked && (lockInfo.until === 0 || lockInfo.until > now);
  const inFlight = useRef(false);

  const userIdFor = useCallback(async (uname: string): Promise<number | null> => {
    if (!uname) return null;
    if (user && user.username === uname) return user.id;
    try { const u = await (DatabaseService as any).authGetUserByUsername(uname); return u?.id ?? null; } catch { return null; }
  }, [user]);

  const refreshLock = useCallback(async (uname: string) => {
    const info = await fetchLock(await userIdFor(uname));
    setLockInfo(info);
    return info;
  }, [userIdFor]);

  // Re-check lock state whenever the username settles.
  useEffect(() => {
    const uname = username.trim().toLowerCase();
    const t = setTimeout(() => { refreshLock(uname); }, 300);
    return () => clearTimeout(t);
  }, [username, refreshLock]);

  // Tick the countdown while locked; re-check when it runs out.
  useEffect(() => {
    if (!lockInfo?.locked) return;
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (lockInfo.until && lockInfo.until <= n) { clearInterval(t); refreshLock(username.trim().toLowerCase()); }
    }, 1000);
    return () => clearInterval(t);
  }, [lockInfo, username, refreshLock]);

  const loadAccounts = useCallback(async () => {
    try { setAccounts(await (DatabaseService as any).authListUsers(false)); } catch { /* list is a convenience only */ }
  }, []);

  useEffect(() => {
    loadAccounts();
    if (hasSession && user) {
      setUsername(user.username);
    } else {
      DatabaseService.getSetting(LAST_USER_KEY).then(v => { if (v) setUsername(v); }).catch(() => {});
    }
  }, [hasSession, user, loadAccounts]);

  async function submit() {
    const uname = username.trim().toLowerCase();
    if (!uname) return Alert.alert(tr('Enter your username'), tr('Type the username the owner gave you.'));
    if (pin.length < 4 || inFlight.current) return;
    if (lockedOut) return;
    Keyboard.dismiss();
    inFlight.current = true;
    setBusy(true);
    try {
      const sameUser = hasSession && user && uname === user.username;
      const res = sameUser ? await unlock(pin) : await login(uname, pin);
      if (!res.ok) {
        setPin('');
        const info = await refreshLock(uname);
        if (info?.locked) {
          Alert.alert(tr('Too many wrong PINs'), info.until
            ? tr('For safety, sign-in is paused. Try again in {t}.', { t: fmtWait(info.until - Date.now(), tr) })
            : tr('For safety, sign-in is paused. Ask the owner for help.'));
        } else if (info && info.attemptsLeft != null) {
          Alert.alert(tr('Wrong PIN'), info.attemptsLeft === 1
            ? tr('1 attempt left before sign-in is paused.')
            : tr('{n} attempts left before sign-in is paused.', { n: info.attemptsLeft }));
        } else {
          Alert.alert(tr('Sign in failed'), tr(res.message || 'Check your username and PIN.'));
        }
      } else {
        setLockInfo(null);
        DatabaseService.setSetting(LAST_USER_KEY, uname).catch(() => {});
      }
    } catch (e) {
      setPin('');
      showError(e, 'Sign in failed');
    } finally { inFlight.current = false; setBusy(false); }
  }

  async function startRecovery() {
    const uname = username.trim().toLowerCase();
    if (!uname) return Alert.alert(tr('Enter your username first'), tr('We need to know which account to reset.'));
    try {
      const u = await (DatabaseService as any).authGetUserByUsername(uname);
      if (!u) return Alert.alert(tr('Not found'), tr('No account with that username.'));
      if (!u.recovery_hash) {
        return Alert.alert(tr('PIN reset'),
          u.is_owner
            ? tr('No recovery answer was set for the owner account. If you are locked out, reinstalling lets you create a new owner — your salon data survives only if you have a backup.')
            : tr('Ask the salon owner to reset your PIN from Settings → Users & Access.'));
      }
      setRecUserId(u.id);
      setRecQ(u.recovery_question || tr('Answer your recovery question'));
      setRecAnswer(''); setNewPin('');
      setRecovering(true);
    } catch (e) { showError(e, 'Could not start PIN reset'); }
  }

  async function confirmRecovery() {
    if (recUserId == null || recBusy) return;
    if (!recAnswer.trim()) return Alert.alert(tr('Answer needed'), tr('Type the answer to your recovery question.'));
    if (!/^\d{4,6}$/.test(newPin)) return Alert.alert(tr('Invalid PIN'), tr('Choose a new 4–6 digit PIN.'));
    setRecBusy(true);
    try {
      // One step: checks the answer (counts toward the lockout), sets the new
      // PIN and clears the lockout. Its message says why it failed, incl. tries left.
      const r = await DBX.authRecoverPin(recUserId, recAnswer, newPin);
      if (!r?.ok) {
        setRecAnswer('');
        return Alert.alert(tr('PIN not reset'), tr(r?.message || 'That answer does not match.'));
      }
      await (DatabaseService as any).logAudit({ id: recUserId }, 'pin_recovered', 'app_users', recUserId, '').catch(() => {});
      Alert.alert(tr('Done'), tr('PIN reset. Sign in with your new PIN.'));
      setRecovering(false); setPin('');
    } catch (e) { showError(e, 'Could not reset PIN'); }
    finally { setRecBusy(false); }
  }

  // ── recovery view ─────────────────────────────────────────────────────────
  if (recovering) {
    return (
      <SafeScreen>
        <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 40 }} keyboardShouldPersistTaps="handled">
          <TouchableOpacity onPress={() => setRecovering(false)} style={{ marginBottom: 16 }} accessibilityLabel={tr('Back')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <MaterialCommunityIcons name="arrow-left" size={24} color={c.text} />
          </TouchableOpacity>
          <Text style={{ color: c.text, fontSize: 22, fontWeight: '900' }}>{tr('Reset your PIN')}</Text>
          <Text style={{ color: c.textSecondary, fontSize: 14, marginTop: 14, lineHeight: 20 }}>{recQ}</Text>
          <Text style={[l.label, { color: c.textSecondary }]}>{tr('Your answer')}</Text>
          <TextInput style={[l.input, { backgroundColor: c.card, color: c.text, borderColor: c.border }]}
            value={recAnswer} onChangeText={setRecAnswer} placeholder={tr('Answer')} placeholderTextColor={c.textMuted} autoCapitalize="none" />
          <Text style={[l.label, { color: c.textSecondary }]}>{tr('New PIN (4–6 digits)')}</Text>
          <TextInput style={[l.input, { backgroundColor: c.card, color: c.text, borderColor: c.border }]}
            value={newPin} onChangeText={t => setNewPin(t.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad" secureTextEntry placeholder="••••" placeholderTextColor={c.textMuted} />
          <TouchableOpacity style={[l.btn, { backgroundColor: c.primary, opacity: recBusy ? 0.6 : 1 }]} onPress={confirmRecovery} disabled={recBusy} accessibilityRole="button">
            {recBusy ? <ActivityIndicator color={c.onPrimary} /> : <Text style={[l.btnText, { color: c.onPrimary }]}>{tr('Reset PIN')}</Text>}
          </TouchableOpacity>
        </ScrollView>
      </SafeScreen>
    );
  }

  // ── sign-in view ──────────────────────────────────────────────────────────
  return (
    <SafeScreen>
      <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 36, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <View style={[l.badge, { backgroundColor: c.primaryLight }]}>
          <MaterialCommunityIcons name={hasSession ? 'lock-outline' : 'account-circle-outline'} size={28} color={c.primary} />
        </View>
        <Text style={{ color: c.text, fontSize: 25, fontWeight: '900', letterSpacing: -0.6 }}>
          {hasSession ? tr('App locked') : tr('Sign in')}
        </Text>
        <Text style={{ color: c.textMuted, fontSize: 13.5, marginTop: 6, lineHeight: 19 }}>
          {hasSession
            ? tr('Enter a username and PIN to continue. {name} is currently signed in.', { name: user?.displayName || '' })
            : tr('Enter the username and PIN the owner gave you.')}
        </Text>

        {hasSession && (
          <TouchableOpacity onPress={() => Alert.alert(tr('Sign out?'), tr('Sign {name} out completely? The next person must sign in with their own account.', { name: user?.displayName || '' }), [
            { text: tr('Cancel'), style: 'cancel' },
            { text: tr('Sign out'), style: 'destructive', onPress: () => { logout().catch(e => showError(e, 'Could not sign out')); } },
          ])}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', marginTop: 14, backgroundColor: c.surface, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 }}>
            <MaterialCommunityIcons name="logout" size={15} color={c.danger} />
            <Text style={{ color: c.danger, fontWeight: '800', fontSize: 12.5 }}>{tr('Sign out')} {user?.displayName}</Text>
          </TouchableOpacity>
        )}

        <Text style={[l.label, { color: c.textSecondary, marginTop: 22 }]}>{tr('Username')}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: c.card, borderRadius: 14, borderWidth: 1.5, borderColor: c.border, paddingHorizontal: 14 }}>
          <MaterialCommunityIcons name="account-outline" size={18} color={c.textMuted} />
          <TextInput
            style={{ flex: 1, color: c.text, fontSize: 16, paddingVertical: 13, marginLeft: 8 }}
            value={username}
            onChangeText={t => setUsername(t.toLowerCase().replace(/[^a-z0-9._-]/g, ''))}
            autoCapitalize="none" autoCorrect={false} spellCheck={false}
            placeholder="username" placeholderTextColor={c.textMuted}
            returnKeyType="next"
          />
          {username.length > 0 && (
            <TouchableOpacity onPress={() => setUsername('')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <MaterialCommunityIcons name="close-circle" size={17} color={c.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        {accounts.length > 0 && (
          <TouchableOpacity onPress={() => setShowAccounts(s => !s)} style={{ marginTop: 10, alignSelf: 'flex-start' }}>
            <Text style={{ color: c.primary, fontWeight: '700', fontSize: 12.5 }}>
              {showAccounts ? tr('Hide accounts') : tr('Accounts on this device')}
            </Text>
          </TouchableOpacity>
        )}
        {showAccounts && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            {accounts.map(a => (
              <TouchableOpacity key={a.id} onPress={() => { setUsername(a.username); setPin(''); }}
                style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, backgroundColor: username === a.username ? c.primary : c.surface, borderColor: username === a.username ? c.primary : c.border }}>
                <Text style={{ color: username === a.username ? c.onPrimary : c.textSecondary, fontWeight: '700', fontSize: 12 }}>
                  {a.display_name || a.username}
                  <Text style={{ fontSize: 10, opacity: 0.7 }}>  ·  {a.is_owner ? tr('Owner') : tr(ROLE_LABELS[a.role as keyof typeof ROLE_LABELS] || a.role)}</Text>
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <Text style={[l.label, { color: c.textSecondary, marginTop: 24 }]}>PIN</Text>
        <PinDots length={6} filled={pin.length} />
        {lockedOut ? (
          <View style={[l.lockBox, { backgroundColor: c.dangerLight, borderColor: c.danger }]}>
            <MaterialCommunityIcons name="timer-sand" size={20} color={c.danger} />
            <Text style={{ flex: 1, color: c.danger, fontWeight: '700', fontSize: 13, lineHeight: 18 }}>
              {lockInfo?.until
                ? tr('Too many wrong PINs. Try again in {t}.', { t: fmtWait(lockInfo.until - now, tr) })
                : tr('Too many wrong PINs. Sign-in is paused for this account.')}
            </Text>
          </View>
        ) : lockInfo?.attemptsLeft != null && lockInfo.attemptsLeft <= 3 ? (
          <Text style={{ color: c.warning, textAlign: 'center', fontWeight: '700', fontSize: 12.5, marginBottom: 10 }}>
            {lockInfo.attemptsLeft === 1 ? tr('1 attempt left before sign-in is paused.') : tr('{n} attempts left before sign-in is paused.', { n: lockInfo.attemptsLeft })}
          </Text>
        ) : null}
        <PinPad value={pin} onChange={setPin} onSubmit={submit} disabled={busy || lockedOut} />

        <View style={{ alignItems: 'center', marginTop: 22, gap: 14 }}>
          {busy && <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><ActivityIndicator size="small" color={c.primary} /><Text style={{ color: c.textMuted }}>{tr('Checking…')}</Text></View>}
          <TouchableOpacity onPress={startRecovery} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={{ color: c.primary, fontWeight: '700', fontSize: 13 }}>{tr('Forgot PIN?')}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeScreen>
  );
}

const l = StyleSheet.create({
  badge: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  label: { fontSize: 12.5, fontWeight: '700', marginBottom: 8 },
  input: { borderRadius: 14, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, borderWidth: 1.5, marginBottom: 4 },
  btn: { marginTop: 24, paddingVertical: 16, borderRadius: 14, alignItems: 'center' },
  btnText: { fontWeight: '800', fontSize: 16 },
  lockBox: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 14 },
});
