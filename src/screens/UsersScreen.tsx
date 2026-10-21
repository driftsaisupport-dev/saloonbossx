import React, { useState, useCallback } from 'react';
import { View, ScrollView, TouchableOpacity, Alert, Switch, StyleSheet, Platform } from 'react-native';
import { Text, TextInput } from '../theme/Text';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeScreen } from '../components/SafeScreen';
import { BottomModal } from '../components/BottomModal';
import { Avatar, SectionLabel, Card } from '../components/UI';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { DatabaseService } from '../database/Database';
import {
  PERMISSIONS, PERM_GROUPS, ROLE_LABELS, ROLE_DESCRIPTIONS, RoleId,
  presetFor, overridesFromSet, resolvePermissions, PermKey,
} from '../auth/permissions';
import { showError, confirmAsync } from '../components/formUtils';
import { useTr } from '../i18n/tr';

const ASSIGNABLE_ROLES: RoleId[] = ['manager', 'receptionist', 'stylist', 'trainer', 'custom'];

export default function UsersScreen() {
  const { colors: c } = useTheme();
  const tr = useTr();
  const { user: me, refreshSession } = useAuth();
  // Only the owner may touch an owner account's PIN — otherwise anyone holding
  // `settings.users` could reset the owner's PIN and take the salon over.
  const canResetPinOf = (u: any) => !u?.is_owner || !!me?.isOwner;
  const [loading, setLoading] = useState(true);
  const [resetBusy, setResetBusy] = useState(false);

  const [users, setUsers] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [showEdit, setShowEdit] = useState(false);
  const [editing, setEditing] = useState<any>(null); // null → new
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState<any>(emptyForm());
  const [permSet, setPermSet] = useState<Set<string>>(new Set());
  const [showPerms, setShowPerms] = useState(false);

  function emptyForm() {
    return { username: '', display_name: '', pin: '', role: 'stylist' as RoleId, staff_id: 0, is_active: 1 };
  }

  const load = useCallback(async () => {
    try {
      const [u, s] = await Promise.all([
        (DatabaseService as any).authListUsers(true),
        DatabaseService.getStaff(),
      ]);
      setUsers(u || []); setStaff((s as any[]) || []);
    } catch (e) { showError(e, 'Could not load logins'); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  function openNew() {
    setEditing(null);
    setForm(emptyForm());
    setPermSet(new Set(presetFor('stylist')));
    setShowEdit(true);
  }
  function openEdit(u: any) {
    if (u.is_owner) {
      if (!canResetPinOf(u)) {
        Alert.alert(tr('Owner account'), tr('The owner has full access and cannot be changed by other users. Only the owner can reset the owner PIN.'));
        return;
      }
      Alert.alert(tr('Owner account'), tr('The owner has full access and cannot be restricted. You can reset the owner PIN here.'), [
        { text: tr('Cancel'), style: 'cancel' },
        { text: tr('Reset PIN'), onPress: () => resetPin(u) },
      ]);
      return;
    }
    setEditing(u);
    let overrides: Record<string, boolean> | null = null;
    try { overrides = u.permissions ? JSON.parse(u.permissions) : null; } catch {}
    setForm({
      username: u.username, display_name: u.display_name || '', pin: '',
      role: (u.role || 'stylist') as RoleId, staff_id: u.staff_id || 0, is_active: u.is_active,
    });
    setPermSet(resolvePermissions({ role: (u.role || 'stylist') as RoleId, overrides }));
    setShowEdit(true);
  }

  function pickRole(r: RoleId) {
    setForm((f: any) => ({ ...f, role: r }));
    setPermSet(new Set(presetFor(r)));
  }
  function togglePerm(k: PermKey) {
    setPermSet(prev => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });
  }

  async function save() {
    const username = form.username.trim().toLowerCase();
    if (!editing) {
      if (!/^[a-z0-9._-]{3,20}$/.test(username)) return Alert.alert(tr('Invalid username'), tr('3–20 characters: letters, numbers, . _ -'));
      if (!/^\d{4,6}$/.test(form.pin)) return Alert.alert(tr('Invalid PIN'), tr('Set a temporary 4–6 digit PIN. The staff member changes it on first login.'));
    }
    if (!form.display_name.trim()) return Alert.alert(tr('Name needed'), tr('Enter a name.'));
    if (busy) return;
    setBusy(true);
    try {
      const overrides = overridesFromSet(form.role, permSet);
      const permJson = Object.keys(overrides).length ? JSON.stringify(overrides) : '';
      if (editing) {
        const r = await (DatabaseService as any).authUpdateUser(editing.id, {
          display_name: form.display_name.trim(),
          role: form.role,
          permissions: permJson,
          staff_id: form.staff_id || 0,
          is_active: form.is_active ? 1 : 0,
        });
        if (!r?.ok) { Alert.alert(tr('Could not save'), tr(r?.message || 'Please try again.')); return; }
        await (DatabaseService as any).logAudit({ id: me?.id, username: me?.username }, 'user_updated', 'app_users', editing.id, `${username} → ${form.role}`);
        if (me && editing.id === me.id) await refreshSession();
      } else {
        const r = await (DatabaseService as any).authCreateUser({
          username, display_name: form.display_name.trim(), pin: form.pin,
          role: form.role, permissions: permJson, staff_id: form.staff_id || 0,
          must_change_pin: true,
        });
        if (!r?.ok) { Alert.alert(tr('Could not create'), tr(r?.message || 'Please try again.')); return; }
        await (DatabaseService as any).logAudit({ id: me?.id, username: me?.username }, 'user_created', 'app_users', r.id, `${username} (${form.role})`);
      }
      setShowEdit(false);
      load();
    } catch (e) {
      showError(e, 'Could not save');
    } finally { setBusy(false); }
  }

  const [resetTarget, setResetTarget] = useState<any>(null);
  const [resetPinVal, setResetPinVal] = useState('');
  function resetPin(u: any) {
    if (!canResetPinOf(u)) {
      Alert.alert(tr('Not allowed'), tr('Only the owner can reset the owner PIN.'));
      return;
    }
    setResetTarget(u); setResetPinVal('');
  }
  async function doResetPin() {
    if (!resetTarget || resetBusy) return;
    if (!canResetPinOf(resetTarget)) { setResetTarget(null); return; }
    if (!/^\d{4,6}$/.test(resetPinVal)) return Alert.alert(tr('Invalid PIN'), tr('PIN must be 4–6 digits.'));
    setResetBusy(true);
    try {
      const r = await (DatabaseService as any).authSetPin(resetTarget.id, resetPinVal, !resetTarget.is_owner, me?.id);
      if (!r?.ok) return Alert.alert(tr('Could not reset PIN'), tr(r?.message || 'Please try again.'));
      await (DatabaseService as any).logAudit({ id: me?.id, username: me?.username }, 'pin_reset', 'app_users', resetTarget.id, resetTarget.username).catch(() => {});
      const wasOwner = !!resetTarget.is_owner;
      setResetTarget(null); setResetPinVal('');
      Alert.alert(tr('Done'), wasOwner ? tr('Owner PIN changed. Use the new PIN next time.') : tr('PIN reset. They will set their own on next login.'));
    } catch (e) { showError(e, 'Could not reset PIN'); }
    finally { setResetBusy(false); }
  }

  async function confirmDelete(u: any) {
    const ok = await confirmAsync('Remove login', tr('Delete the login for {name}? Their staff record and history are kept.', { name: u.display_name || u.username }), 'Delete', true);
    if (!ok) return;
    try {
      const r = await (DatabaseService as any).authDeleteUser(u.id);
      if (!r?.ok) return Alert.alert(tr('Cannot delete'), tr(r?.message || 'Please try again.'));
      await (DatabaseService as any).logAudit({ id: me?.id, username: me?.username }, 'user_deleted', 'app_users', u.id, u.username).catch(() => {});
      load();
    } catch (e) { showError(e, 'Could not delete'); }
  }

  const linkedStaffIds = new Set(users.map(u => u.staff_id).filter(Boolean));

  return (
    <SafeScreen>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
        <Text style={{ color: c.textMuted, fontSize: 13, lineHeight: 19, marginBottom: 16 }}>
          {tr('Create a login for each person. Pick a role for sensible defaults, then fine-tune exactly which menus and features they can use.')}
        </Text>

        <TouchableOpacity onPress={openNew}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.primary, borderRadius: 14, paddingVertical: 14, marginBottom: 18 }}>
          <MaterialCommunityIcons name="account-plus" size={19} color={c.onPrimary} />
          <Text style={{ color: c.onPrimary, fontWeight: '800', fontSize: 14 }}>{tr('Add a login')}</Text>
        </TouchableOpacity>

        {loading && users.length === 0 ? <Text style={{ color: c.textMuted, textAlign: 'center', marginTop: 20 }}>{tr('Loading…')}</Text> : null}
        {users.map(u => (
          <TouchableOpacity key={u.id} onPress={() => openEdit(u)} activeOpacity={0.8}
            style={{ backgroundColor: c.card, borderRadius: 16, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: c.borderLight, opacity: u.is_active ? 1 : 0.55 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Avatar name={u.display_name || u.username} size={44} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.text, fontWeight: '800', fontSize: 15 }}>
                  {u.display_name || u.username} {u.is_owner ? `· ${tr('Owner')}` : ''}
                </Text>
                <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 1 }}>
                  @{u.username} · {u.is_owner ? tr('Full access') : tr(ROLE_LABELS[u.role as RoleId] || u.role)}
                  {u.staff_name ? ` · ${u.staff_name}` : ''}
                </Text>
                {!u.is_active && <Text style={{ color: c.danger, fontSize: 11, marginTop: 2, fontWeight: '700' }}>{tr('DISABLED')}</Text>}
                {!!u.must_change_pin && u.is_active && <Text style={{ color: c.warning, fontSize: 11, marginTop: 2, fontWeight: '700' }}>{tr('Temp PIN — not changed yet')}</Text>}
              </View>
              <MaterialCommunityIcons name="chevron-right" size={20} color={c.textLight} />
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              {canResetPinOf(u) && <MiniBtn c={c} icon="lock-reset" label={tr('Reset PIN')} onPress={() => resetPin(u)} />}
              {!u.is_owner && <MiniBtn c={c} icon="pencil-outline" label={tr('Edit')} onPress={() => openEdit(u)} />}
              {!u.is_owner && <MiniBtn c={c} icon="trash-can-outline" label={tr('Delete')} tone={c.danger} onPress={() => confirmDelete(u)} />}
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Add / edit modal */}
      <BottomModal visible={showEdit} onClose={() => setShowEdit(false)} height="92%">
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <Text style={{ color: c.text, fontSize: 19, fontWeight: '900', marginBottom: 16 }}>
            {editing ? `${tr('Edit')} ${editing.display_name || editing.username}` : tr('New login')}
          </Text>

          <Label c={c}>{tr('Name')}</Label>
          <Field c={c} value={form.display_name} onChangeText={(v: string) => setForm((f: any) => ({ ...f, display_name: v }))} placeholder={tr('Full name')} />

          {!editing && (<>
            <Label c={c}>{tr('Username')}</Label>
            <Field c={c} value={form.username} autoCapitalize="none"
              onChangeText={(v: string) => setForm((f: any) => ({ ...f, username: v.toLowerCase().replace(/[^a-z0-9._-]/g, '') }))}
              placeholder="e.g. rekha" />
            <Label c={c}>{tr('Temporary PIN (4–6 digits)')}</Label>
            <Field c={c} value={form.pin} keyboardType="number-pad" secureTextEntry
              onChangeText={(v: string) => setForm((f: any) => ({ ...f, pin: v.replace(/\D/g, '').slice(0, 6) }))}
              placeholder={tr('They change it on first login')} />
          </>)}

          <Label c={c}>{tr('Linked staff member (for calendar & pay slip)')}</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
            <RoleChip c={c} label={tr('None')} active={!form.staff_id} onPress={() => setForm((f: any) => ({ ...f, staff_id: 0 }))} />
            {staff.map(s => (
              <RoleChip key={s.id} c={c} label={s.name}
                active={form.staff_id === s.id}
                dim={linkedStaffIds.has(s.id) && form.staff_id !== s.id}
                onPress={() => setForm((f: any) => ({ ...f, staff_id: s.id }))} />
            ))}
          </View>

          <Label c={c}>{tr('Role')}</Label>
          <View style={{ gap: 8, marginBottom: 14 }}>
            {ASSIGNABLE_ROLES.map(r => (
              <TouchableOpacity key={r} onPress={() => pickRole(r)}
                style={{ borderWidth: 1.5, borderRadius: 14, padding: 12, borderColor: form.role === r ? c.primary : c.border, backgroundColor: form.role === r ? c.primaryLight : c.card }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <MaterialCommunityIcons name={form.role === r ? 'radiobox-marked' : 'radiobox-blank'} size={18} color={form.role === r ? c.primary : c.textMuted} />
                  <Text style={{ color: c.text, fontWeight: '800', fontSize: 14 }}>{tr(ROLE_LABELS[r])}</Text>
                </View>
                <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 4, marginLeft: 26 }}>{tr(ROLE_DESCRIPTIONS[r])}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity onPress={() => setShowPerms(s => !s)}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: c.surface, borderRadius: 12, padding: 14, marginBottom: 12 }}>
            <Text style={{ color: c.text, fontWeight: '800', fontSize: 13.5 }}>
              {tr('Fine-tune permissions ({n} enabled)', { n: permSet.size })}
            </Text>
            <MaterialCommunityIcons name={showPerms ? 'chevron-up' : 'chevron-down'} size={20} color={c.textMuted} />
          </TouchableOpacity>

          {showPerms && PERM_GROUPS.map(group => (
            <View key={group} style={{ marginBottom: 8 }}>
              <SectionLabel>{group}</SectionLabel>
              {PERMISSIONS.filter(p => p.group === group).map(p => (
                <View key={p.key} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.text, fontSize: 13.5, fontWeight: '600' }}>{tr(p.label)}</Text>
                    <Text style={{ color: c.textMuted, fontSize: 11.5, marginTop: 1 }}>{tr(p.hint)}</Text>
                  </View>
                  <Switch value={permSet.has(p.key)} onValueChange={() => togglePerm(p.key)}
                    trackColor={{ true: c.primary + '60', false: c.border }} thumbColor={permSet.has(p.key) ? c.primary : '#f4f3f4'} />
                </View>
              ))}
            </View>
          ))}

          {editing && (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, marginBottom: 10 }}>
              <Text style={{ color: c.text, fontWeight: '700' }}>{tr('Account active')}</Text>
              <Switch value={!!form.is_active} onValueChange={v => setForm((f: any) => ({ ...f, is_active: v ? 1 : 0 }))}
                trackColor={{ true: c.primary + '60', false: c.border }} thumbColor={form.is_active ? c.primary : '#f4f3f4'} />
            </View>
          )}

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
            <TouchableOpacity style={{ flex: 1, backgroundColor: c.surface, borderRadius: 12, padding: 14, alignItems: 'center' }} onPress={() => setShowEdit(false)}>
              <Text style={{ color: c.textSecondary, fontWeight: '800' }}>{tr('Cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ flex: 1.4, backgroundColor: busy ? c.textMuted : c.primary, borderRadius: 12, padding: 14, alignItems: 'center' }} onPress={save} disabled={busy}>
              <Text style={{ color: c.onPrimary, fontWeight: '900' }}>{busy ? tr('Saving…') : editing ? tr('Save changes') : tr('Create login')}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </BottomModal>

      {/* Android PIN reset modal */}
      <BottomModal visible={!!resetTarget} onClose={() => setResetTarget(null)}>
        <View style={{ padding: 20 }}>
          <Text style={{ color: c.text, fontSize: 18, fontWeight: '900', marginBottom: 8 }}>{tr('Reset PIN')}</Text>
          <Text style={{ color: c.textMuted, fontSize: 13, marginBottom: 14 }}>
            {resetTarget?.is_owner ? tr('New PIN for the owner account.') : tr('New temporary PIN for {name}.', { name: resetTarget?.display_name || resetTarget?.username || '' })}
          </Text>
          <Field c={c} value={resetPinVal} keyboardType="number-pad" secureTextEntry
            onChangeText={(v: string) => setResetPinVal(v.replace(/\D/g, '').slice(0, 6))} placeholder={tr('4–6 digits')} />
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
            <TouchableOpacity style={{ flex: 1, backgroundColor: c.surface, borderRadius: 12, padding: 14, alignItems: 'center' }} onPress={() => setResetTarget(null)}>
              <Text style={{ color: c.textSecondary, fontWeight: '800' }}>{tr('Cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ flex: 1, backgroundColor: c.primary, borderRadius: 12, padding: 14, alignItems: 'center', opacity: resetBusy ? 0.6 : 1 }} onPress={doResetPin} disabled={resetBusy}>
              <Text style={{ color: c.onPrimary, fontWeight: '900' }}>{resetBusy ? tr('Saving…') : tr('Reset')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </BottomModal>
    </SafeScreen>
  );
}

function Label({ c, children }: any) {
  return <Text style={{ color: c.textSecondary, fontSize: 12.5, fontWeight: '700', marginBottom: 6, marginTop: 6 }}>{children}</Text>;
}
function Field({ c, ...props }: any) {
  return <TextInput {...props} placeholderTextColor={c.textMuted}
    style={{ backgroundColor: c.surface, color: c.text, borderRadius: 12, padding: 12, fontSize: 14.5, borderWidth: 1.5, borderColor: c.border, marginBottom: 8 }} />;
}
function RoleChip({ c, label, active, dim, onPress }: any) {
  return (
    <TouchableOpacity onPress={onPress}
      style={{ paddingHorizontal: 13, paddingVertical: 8, borderRadius: 999, borderWidth: 1, opacity: dim ? 0.4 : 1,
        backgroundColor: active ? c.primary : c.surface, borderColor: active ? c.primary : c.border }}>
      <Text style={{ color: active ? c.onPrimary : c.textSecondary, fontWeight: '700', fontSize: 12.5 }}>{label}</Text>
    </TouchableOpacity>
  );
}
function MiniBtn({ c, icon, label, tone, onPress }: any) {
  const fg = tone || c.primary;
  return (
    <TouchableOpacity onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: fg + '18', paddingHorizontal: 11, paddingVertical: 7, borderRadius: 10 }}>
      <MaterialCommunityIcons name={icon} size={14} color={fg} />
      <Text style={{ color: fg, fontWeight: '800', fontSize: 12 }}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({});
