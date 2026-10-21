/**
 * ClientFormSheet — add / edit a client, used by Clients and Client detail.
 *
 *  • Indian mobile validation (10 digits, +91 / 0 prefix allowed, saved as 10 digits)
 *  • duplicate-phone check with "Open existing client"
 *  • birthday / anniversary through the JS date picker (no free-text dates)
 *  • busy flag on Save, friendly errors
 *
 *   <ClientFormSheet visible={open} client={editing /* null = new *\/}
 *     onClose={...} onSaved={(id) => ...} onOpenExisting={(c) => navigate('ClientDetail', { clientId: c.id })} />
 */
import { phoneHint } from '../config/regions';
import React from 'react';
import { View, TouchableOpacity, Alert, Switch } from 'react-native';
import { Text, TextInput } from '../theme/Text';
import { useTheme } from '../context/ThemeContext';
import { DatabaseService, DBX } from '../database/Database';
import { BottomSheet, Button } from './UI';
import { DateField } from './DateTimePicker';
import { useTr } from '../i18n/tr';
import { normaliseIndianPhone, isValidDateStr, localDateStr, showError, phoneKey } from './formUtils';
import { appEvents } from './appEvents';

const GENDERS = ['Female', 'Male', 'Non-binary', 'Prefer not to say'];
const REFERRALS = ['Walk-in', 'Google', 'Instagram', 'Facebook', 'Friend Referral', 'JustDial', 'Existing Client', 'Other'];

const empty = () => ({ name: '', phone: '', email: '', gender: 'Female', date_of_birth: '', anniversary: '', address: '', notes: '', allergies: '', referral_source: 'Walk-in', is_vip: 0 });

/** Look up an active client by phone; works with old and new data layers. */
export async function findClientByPhone(phone10: string): Promise<any | null> {
  if (!phone10) return null;
  const DB: any = DBX;
  try {
    if (typeof DB.findClientByPhone === 'function') return (await DB.findClientByPhone(phone10)) || null;
    if (typeof DB.clientPhoneSet === 'function') {
      const set: Set<string> = await DB.clientPhoneSet();
      if (!set.has(phone10)) return null;
      const rows: any[] = (await DatabaseService.getClients(phone10)) as any[];
      return rows.find(r => phoneKey(r.phone) === phone10) || null;
    }
  } catch { /* fall through */ }
  return null;
}

export function ClientFormSheet({ visible, onClose, client, onSaved, onOpenExisting, footerExtra, showVip = true }: {
  visible: boolean;
  onClose: () => void;
  client?: any | null;
  onSaved?: (id: number) => void;
  onOpenExisting?: (existing: any) => void;
  /** e.g. a "Remove client" button for the edit case */
  footerExtra?: React.ReactNode;
  showVip?: boolean;
}) {
  const { colors: c } = useTheme();
  const tr = useTr();
  const [form, setForm] = React.useState<any>(empty());
  const [saving, setSaving] = React.useState(false);
  const [phoneErr, setPhoneErr] = React.useState('');

  React.useEffect(() => {
    if (!visible) return;
    setPhoneErr('');
    setForm(client ? {
      name: client.name || '', phone: client.phone || '', email: client.email || '', gender: client.gender || 'Female',
      date_of_birth: client.date_of_birth || '', anniversary: client.anniversary || '', address: client.address || '',
      notes: client.notes || '', allergies: client.allergies || '', referral_source: client.referral_source || 'Walk-in',
      is_vip: client.is_vip || 0,
    } : empty());
  }, [visible, client]);

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const today = localDateStr();

  async function save() {
    if (saving) return;
    const name = String(form.name || '').trim();
    if (!name) { Alert.alert(tr('Name needed'), tr('Client name is required.')); return; }
    const rawPhone = String(form.phone || '').trim();
    const phone = rawPhone ? normaliseIndianPhone(rawPhone) : '';
    if (rawPhone && !phone) {
      setPhoneErr(phoneHint());
      return;
    }
    if (form.date_of_birth && !isValidDateStr(form.date_of_birth)) { Alert.alert(tr('Check birthday'), tr('Pick the birthday from the calendar.')); return; }
    if (form.anniversary && !isValidDateStr(form.anniversary)) { Alert.alert(tr('Check anniversary'), tr('Pick the anniversary from the calendar.')); return; }
    if (form.email && !/^\S+@\S+\.\S+$/.test(String(form.email).trim())) { Alert.alert(tr('Check email'), tr('Enter a valid email or leave it empty.')); return; }

    setSaving(true);
    try {
      // Duplicate phone? Offer to open the existing record instead.
      const phoneChanged = !client || phoneKey(client.phone) !== phone;
      if (phone && phoneChanged) {
        const existing = await findClientByPhone(phone);
        if (existing && existing.id !== client?.id) {
          const choice = await new Promise<'open' | 'save' | 'cancel'>(resolve => {
            Alert.alert(
              tr('Number already saved'),
              tr('{name} already has the number {phone}.', { name: existing.name, phone }),
              [
                { text: tr('Cancel'), style: 'cancel', onPress: () => resolve('cancel') },
                { text: tr('Save anyway'), onPress: () => resolve('save') },
                ...(onOpenExisting ? [{ text: tr('Open existing client'), onPress: () => resolve('open') }] : []),
              ],
              { cancelable: true, onDismiss: () => resolve('cancel') },
            );
          });
          if (choice === 'cancel') return;
          if (choice === 'open') { onClose(); onOpenExisting?.(existing); return; }
        }
      }
      const payload = { ...form, name, phone, email: String(form.email || '').trim() };
      let id = client?.id;
      if (client) await DatabaseService.updateClient(client.id, payload);
      else id = Number(await DatabaseService.addClient(payload));
      appEvents.emit('client:changed', { id });
      onClose();
      onSaved?.(id);
    } catch (e) {
      showError(e, 'Client not saved', 'Could not save the client. Please try again.');
    } finally { setSaving(false); }
  }

  const input = { backgroundColor: c.surface, color: c.text, borderRadius: 12, padding: 13, fontSize: 14.5, borderWidth: 1.5, borderColor: c.border };
  const chip = (on: boolean) => ({ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, marginRight: 8, marginBottom: 8, backgroundColor: on ? c.primary : c.surface, borderWidth: 1, borderColor: on ? c.primary : c.border });

  return (
    <BottomSheet visible={visible} onClose={onClose} title={client ? tr('Edit client') : tr('Add new client')}
      footer={
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button label={tr('Cancel')} variant="subtle" color={c.textSecondary} onPress={onClose} style={{ flex: 1 }} />
          <Button label={saving ? tr('Saving…') : tr('Save client')} icon="check" onPress={save} loading={saving} disabled={saving} style={{ flex: 1.4 }} />
        </View>
      }>
      <Field label={`${tr('Full name')} *`} c={c}>
        <TextInput style={input} value={form.name} onChangeText={v => set('name', v)} placeholder={tr('Client full name')} placeholderTextColor={c.textMuted} autoCapitalize="words" />
      </Field>
      <Field label={tr('Mobile number')} c={c} error={phoneErr}>
        <TextInput style={[input, phoneErr ? { borderColor: c.danger } : null]} value={form.phone}
          onChangeText={v => { set('phone', v.replace(/[^0-9+\s-]/g, '')); setPhoneErr(''); }}
          onBlur={() => { const n = normaliseIndianPhone(form.phone); if (n) set('phone', n); }}
          placeholder={tr('Mobile number')} placeholderTextColor={c.textMuted} keyboardType="phone-pad" maxLength={16} />
      </Field>
      <Field label={tr('Email')} c={c}>
        <TextInput style={input} value={form.email} onChangeText={v => set('email', v)} placeholder="email@example.com" placeholderTextColor={c.textMuted} keyboardType="email-address" autoCapitalize="none" />
      </Field>
      <Field label={tr('Gender')} c={c}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {GENDERS.map(g => (
            <TouchableOpacity key={g} style={chip(form.gender === g)} onPress={() => set('gender', g)}>
              <Text style={{ color: form.gender === g ? c.onPrimary : c.textSecondary, fontSize: 13, fontWeight: '700' }}>{tr(g)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </Field>
      <DateField label={tr('Birthday')} value={form.date_of_birth} onChange={v => set('date_of_birth', v)} allowClear maxDate={today} placeholder="Select birthday" />
      <DateField label={tr('Anniversary')} value={form.anniversary} onChange={v => set('anniversary', v)} allowClear maxDate={today} placeholder="Select anniversary" />
      <Field label={tr('Address')} c={c}>
        <TextInput style={input} value={form.address} onChangeText={v => set('address', v)} placeholder={tr('Street, locality')} placeholderTextColor={c.textMuted} multiline />
      </Field>
      <Field label={tr('Allergies / sensitivities')} c={c}>
        <TextInput style={[input, { borderColor: form.allergies ? c.warning : c.border }]} value={form.allergies} onChangeText={v => set('allergies', v)} placeholder={tr('e.g. Ammonia, bleach, perm solution')} placeholderTextColor={c.textMuted} />
      </Field>
      <Field label={tr('How did they find you?')} c={c}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {REFERRALS.map(r => (
            <TouchableOpacity key={r} style={chip(form.referral_source === r)} onPress={() => set('referral_source', r)}>
              <Text style={{ color: form.referral_source === r ? c.onPrimary : c.textSecondary, fontSize: 13, fontWeight: '700' }}>{tr(r)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </Field>
      <Field label={tr('Notes')} c={c}>
        <TextInput style={[input, { minHeight: 64 }]} value={form.notes} onChangeText={v => set('notes', v)} placeholder={tr('Any preferences or special notes')} placeholderTextColor={c.textMuted} multiline />
      </Field>
      {showVip && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <Text style={{ color: c.text, fontSize: 14, fontWeight: '600' }}>{tr('Mark as VIP client')}</Text>
          <Switch value={!!form.is_vip} onValueChange={v => set('is_vip', v ? 1 : 0)}
            trackColor={{ true: c.warning + '70', false: c.border }} thumbColor={form.is_vip ? c.warning : c.textLight} />
        </View>
      )}
      {footerExtra}
    </BottomSheet>
  );
}

function Field({ label, c, children, error }: any) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ color: c.textSecondary, fontSize: 12.5, fontWeight: '700', marginBottom: 7 }}>{label}</Text>
      {children}
      {error ? <Text style={{ color: c.danger, fontSize: 12, marginTop: 4 }}>{error}</Text> : null}
    </View>
  );
}
