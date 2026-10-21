import React, { useMemo, useState } from 'react';
import { View, FlatList, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { Text } from '../theme/Text';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Contacts from 'expo-contacts/legacy';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { SafeScreen } from '../components/SafeScreen';
import { Card, Button, SearchBar } from '../components/UI';
import { useTheme } from '../context/ThemeContext';
import { DBX } from '../database/Database';
import { BossAI } from '../services/ai/BossAI';
import { parseCsv } from '../utils/csvImport';

/**
 * Bring existing customers in on day one — from the phone's contacts (most
 * parlour owners already save clients there) or from an Excel/CSV export of
 * their old software. Nothing leaves the phone.
 */
type Row = { key: string; name: string; phone: string; dob?: string; exists: boolean };

const last10 = (p: string) => String(p || '').replace(/\D/g, '').slice(-10);
const isMobile = (p: string) => /^[6-9]\d{9}$/.test(last10(p));

export default function ImportClientsScreen({ navigation }: any) {
  const { colors: c } = useTheme();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState('');

  async function fromContacts() {
    setBusy('contacts');
    try {
      const perm = await Contacts.requestPermissionsAsync();
      if (perm.status !== 'granted') { Alert.alert('Permission needed', 'Allow Contacts to pick customers. You can also import from an Excel/CSV file.'); return; }
      const { data } = await Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Birthday] });
      const have = await DBX.clientPhoneSet();
      const seen = new Set<string>();
      const list: Row[] = [];
      for (const ct of data) {
        const name = (ct.name || [ct.firstName, ct.lastName].filter(Boolean).join(' ')).trim();
        const ph = (ct.phoneNumbers || []).map(p => p.number || '').find(isMobile);
        if (!name || !ph) continue;
        const k = last10(ph);
        if (seen.has(k)) continue;
        seen.add(k);
        const b: any = ct.birthday;
        const dob = b?.year && b?.month != null && b?.day ? `${b.year}-${String(b.month + 1).padStart(2, '0')}-${String(b.day).padStart(2, '0')}` : '';
        list.push({ key: k, name, phone: k, dob, exists: have.has(k) });
      }
      list.sort((a, b) => a.name.localeCompare(b.name));
      setRows(list);
      setSel(new Set());
    } catch (e: any) { Alert.alert('Could not read contacts', e?.message || 'Try again.'); }
    finally { setBusy(''); }
  }

  async function fromFile() {
    setBusy('file');
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ['text/csv', 'text/comma-separated-values', 'text/plain', 'application/vnd.ms-excel', '*/*'], copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]) return;
      const text = await FileSystem.readAsStringAsync(res.assets[0].uri, { encoding: 'utf8' });
      const parsed = parseCsv(text);
      if (!parsed.length) { Alert.alert('Nothing found', 'Save your Excel sheet as CSV with columns Name, Phone (and optional Birthday), then try again.'); return; }
      const have = await DBX.clientPhoneSet();
      const list: Row[] = parsed.map((r, i) => ({ key: `f${i}`, name: r.name, phone: last10(r.phone), dob: r.dob, exists: !!last10(r.phone) && have.has(last10(r.phone)) }));
      setRows(list);
      setSel(new Set(list.filter(r => !r.exists).map(r => r.key)));
    } catch (e: any) { Alert.alert('Could not read the file', e?.message || 'Use a .csv file.'); }
    finally { setBusy(''); }
  }

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (rows || []).filter(r => !s || r.name.toLowerCase().includes(s) || r.phone.includes(s));
  }, [rows, q]);

  async function doImport() {
    const list = (rows || []).filter(r => sel.has(r.key) && !r.exists);
    if (!list.length) return;
    setBusy('import');
    try {
      const r = await DBX.importClients(list.map(x => ({ name: x.name, phone: x.phone, date_of_birth: x.dob })));
      BossAI.invalidate();
      Alert.alert('Customers added ✅', `${r.added} added${r.skipped ? `, ${r.skipped} skipped (already saved)` : ''}.`, [{ text: 'OK', onPress: () => navigation.goBack() }]);
    } catch (e: any) { Alert.alert('Import failed', e?.message || 'Nothing was changed.'); }
    finally { setBusy(''); }
  }

  if (!rows) {
    return (
      <SafeScreen>
        <View style={{ padding: 16 }}>
          <Text style={{ color: c.textMuted, marginBottom: 14, lineHeight: 19 }}>
            Add your existing customers in one go — so birthday wishes, win-back reminders and Boss AI work from day one. Nothing is uploaded anywhere.
          </Text>
          <Card onPress={fromContacts}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <MaterialCommunityIcons name="contacts" size={30} color={c.primary} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.text, fontWeight: '800', fontSize: 15 }}>From phone contacts</Text>
                <Text style={{ color: c.textMuted, fontSize: 12.5 }}>Pick who is a customer — you choose, nothing is added automatically</Text>
              </View>
              {busy === 'contacts' ? <ActivityIndicator color={c.primary} /> : <MaterialCommunityIcons name="chevron-right" size={22} color={c.textMuted} />}
            </View>
          </Card>
          <Card onPress={fromFile}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <MaterialCommunityIcons name="file-excel-outline" size={30} color={c.success} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.text, fontWeight: '800', fontSize: 15 }}>From Excel / CSV</Text>
                <Text style={{ color: c.textMuted, fontSize: 12.5 }}>Columns: Name, Phone, Birthday (optional). From your old software or register.</Text>
              </View>
              {busy === 'file' ? <ActivityIndicator color={c.primary} /> : <MaterialCommunityIcons name="chevron-right" size={22} color={c.textMuted} />}
            </View>
          </Card>
        </View>
      </SafeScreen>
    );
  }

  const selectable = shown.filter(r => !r.exists);
  const allOn = selectable.length > 0 && selectable.every(r => sel.has(r.key));
  return (
    <SafeScreen>
      <View style={{ paddingHorizontal: 16, paddingTop: 8, gap: 10 }}>
        <SearchBar value={q} onChangeText={setQ} placeholder={`Search ${rows.length} contacts…`} />
        <TouchableOpacity onPress={() => setSel(p => { const n = new Set(p); selectable.forEach(r => (allOn ? n.delete(r.key) : n.add(r.key))); return n; })}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <MaterialCommunityIcons name={allOn ? 'checkbox-marked' : 'checkbox-blank-outline'} size={22} color={c.primary} />
          <Text style={{ color: c.primary, fontWeight: '800' }}>{allOn ? 'Unselect' : 'Select'} all shown ({selectable.length})</Text>
        </TouchableOpacity>
      </View>
      <FlatList data={shown} keyExtractor={r => r.key} contentContainerStyle={{ padding: 16, paddingBottom: 110 }} initialNumToRender={30}
        renderItem={({ item }) => (
          <TouchableOpacity disabled={item.exists} onPress={() => setSel(p => { const n = new Set(p); n.has(item.key) ? n.delete(item.key) : n.add(item.key); return n; })}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: c.divider, opacity: item.exists ? 0.45 : 1 }}>
            <MaterialCommunityIcons name={item.exists ? 'check-circle' : sel.has(item.key) ? 'checkbox-marked' : 'checkbox-blank-outline'} size={22} color={item.exists ? c.success : c.primary} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.text, fontWeight: '700' }}>{item.name}</Text>
              <Text style={{ color: c.textMuted, fontSize: 12 }}>{item.phone || 'no phone'}{item.exists ? ' · already a client' : ''}{item.dob ? ` · 🎂 ${item.dob.slice(5)}` : ''}</Text>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={{ color: c.textMuted, textAlign: 'center', marginTop: 30 }}>No contacts with a mobile number.</Text>} />
      <View style={{ position: 'absolute', left: 16, right: 16, bottom: 24 }}>
        <Button label={`Add ${[...sel].filter(k => rows.some(r => r.key === k && !r.exists)).length} customers`} icon="account-multiple-plus"
          disabled={sel.size === 0} loading={busy === 'import'} onPress={doImport} />
      </View>
    </SafeScreen>
  );
}
