import React, { useState, useCallback } from 'react';
import { View, ScrollView, TouchableOpacity, Alert, Switch, Image, StyleSheet } from 'react-native';
import { Text, TextInput } from '../theme/Text';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeScreen } from '../components/SafeScreen';
import { SectionLabel, Card } from '../components/UI';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { DatabaseService, DEFAULT_CERTIFICATE_TEMPLATE, CertificateTemplate } from '../database/Database';
import { renderCertificateHTML } from '../utils/certificate';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

const FS_DOC_DIR = (FileSystem as any).documentDirectory ?? (FileSystem as any).cacheDirectory ?? '';
const FS_BASE64 = (FileSystem as any).EncodingType?.Base64 ?? 'base64';

const LAYOUTS: { key: CertificateTemplate['layout']; label: string }[] = [
  { key: 'classic', label: 'Classic' },
  { key: 'modern', label: 'Modern' },
  { key: 'minimal', label: 'Minimal' },
];
const ACCENTS = ['#A84F18', '#0FA968', '#E0902F', '#E5484D', '#3E7BFA', '#111827', '#8B5CF6', '#C88A4B'];
const TOKENS = ['{{student}}', '{{course}}', '{{dates}}', '{{batch}}', '{{salon}}', '{{date}}'];

export default function CertificateTemplateScreen() {
  const { colors: c } = useTheme();
  const { user } = useAuth();
  const [t, setT] = useState<CertificateTemplate>({ ...DEFAULT_CERTIFICATE_TEMPLATE });
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  const load = useCallback(async () => {
    setT(await (DatabaseService as any).getCertificateTemplate());
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function saveImage(uri: string, name: string): Promise<string> {
    const dir = FS_DOC_DIR + 'certificate/';
    try {
      const info = await FileSystem.getInfoAsync(dir);
      if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      const dest = `${dir}${name}_${Date.now()}.png`;
      await FileSystem.copyAsync({ from: uri, to: dest });
      return dest;
    } catch { return uri; }
  }

  async function pickImage(field: 'signatory1_image' | 'signatory2_image' | 'seal_image', label: string) {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') return Alert.alert('Permission needed', 'Allow photo library access to add an image.');
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (res.canceled || !res.assets?.[0]) return;
    const saved = await saveImage(res.assets[0].uri, field);
    setT(x => ({ ...x, [field]: saved }));
  }

  async function toDataUri(uri?: string): Promise<string | undefined> {
    if (!uri) return undefined;
    try {
      const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FS_BASE64 });
      return `data:image/png;base64,${b64}`;
    } catch { return undefined; }
  }

  async function save() {
    setSaving(true);
    try {
      await (DatabaseService as any).setCertificateTemplate(t);
      await (DatabaseService as any).logAudit({ id: user?.id, username: user?.username }, 'certificate_template_updated', 'settings', 0, t.layout);
      Alert.alert('✅ Saved', 'Certificate design saved. It will be used for every certificate you issue.');
    } finally { setSaving(false); }
  }

  async function preview() {
    setPreviewing(true);
    try {
      const profile: any = await DatabaseService.getSalonProfile();
      const [sig1, sig2, seal] = await Promise.all([
        toDataUri(t.signatory1_image), toDataUri(t.signatory2_image), toDataUri(t.seal_image),
      ]);
      const html = renderCertificateHTML({
        student: { id: 1, name: 'Aisha Khan' },
        course: { name: 'Advanced Hair & Makeup' },
        batch: { batch_name: 'Batch A', start_date: '2026-01-10', end_date: '2026-04-10' },
        profile, template: t,
        sig1DataUri: sig1, sig2DataUri: sig2, sealDataUri: seal,
      });
      const { uri } = await Print.printToFileAsync({ html, width: 842, height: 595 });
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Certificate preview' });
    } catch (e: any) {
      Alert.alert('Preview failed', e?.message || 'Could not build the preview.');
    } finally { setPreviewing(false); }
  }

  const field = (props: any) => (
    <TextInput {...props} placeholderTextColor={c.textMuted}
      style={{ backgroundColor: c.surface, color: c.text, borderRadius: 10, padding: 12, fontSize: 14, borderWidth: 1.5, borderColor: c.border, ...(props.multiline ? { minHeight: 88, textAlignVertical: 'top' } : {}) }} />
  );

  const ImgRow = ({ label, uri, onPick, onClear }: any) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }}>
      <View style={{ width: 64, height: 44, borderRadius: 8, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 1, borderColor: c.border }}>
        {uri ? <Image source={{ uri }} style={{ width: 64, height: 44 }} resizeMode="contain" />
          : <MaterialCommunityIcons name="image-outline" size={20} color={c.textMuted} />}
      </View>
      <Text style={{ flex: 1, color: c.text, fontSize: 13.5, fontWeight: '600' }}>{label}</Text>
      {uri ? <TouchableOpacity onPress={onClear}><Text style={{ color: c.danger, fontWeight: '700', fontSize: 12 }}>Remove</Text></TouchableOpacity> : null}
      <TouchableOpacity onPress={onPick}><Text style={{ color: c.primary, fontWeight: '700', fontSize: 12 }}>{uri ? 'Change' : 'Upload'}</Text></TouchableOpacity>
    </View>
  );

  return (
    <SafeScreen>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: c.textMuted, fontSize: 13, lineHeight: 19, marginBottom: 14 }}>
          This design is applied automatically whenever you generate a student certificate from the Academy screen.
        </Text>

        <SectionLabel>Layout</SectionLabel>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
          {LAYOUTS.map(l => (
            <TouchableOpacity key={l.key} onPress={() => setT(x => ({ ...x, layout: l.key }))}
              style={{ flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', borderWidth: 1.5, borderColor: t.layout === l.key ? c.primary : c.border, backgroundColor: t.layout === l.key ? c.primaryLight : c.card }}>
              <Text style={{ color: t.layout === l.key ? c.primary : c.textSecondary, fontWeight: '800', fontSize: 13 }}>{l.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <SectionLabel>Accent colour</SectionLabel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
          {ACCENTS.map(a => (
            <TouchableOpacity key={a} onPress={() => setT(x => ({ ...x, accent: a }))}
              style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: a, borderWidth: 3, borderColor: t.accent === a ? c.text : 'transparent' }} />
          ))}
        </View>

        <SectionLabel>Wording</SectionLabel>
        <Card>
          <Text style={{ color: c.textSecondary, fontSize: 12, fontWeight: '700', marginBottom: 6 }}>Heading</Text>
          {field({ value: t.title, onChangeText: (v: string) => setT(x => ({ ...x, title: v })), placeholder: 'Certificate of Completion' })}
          <Text style={{ color: c.textSecondary, fontSize: 12, fontWeight: '700', marginBottom: 6, marginTop: 12 }}>Body text</Text>
          {field({ value: t.body, onChangeText: (v: string) => setT(x => ({ ...x, body: v })), multiline: true, placeholder: 'has successfully completed…' })}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {TOKENS.map(tok => (
              <TouchableOpacity key={tok} onPress={() => setT(x => ({ ...x, body: (x.body || '') + ' ' + tok }))}
                style={{ backgroundColor: c.primaryLight, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
                <Text style={{ color: c.primary, fontSize: 11, fontWeight: '700' }}>{tok}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={{ color: c.textMuted, fontSize: 11, marginTop: 8 }}>
            Tap a tag to insert it — it’s replaced with the student’s real details when the certificate is generated.
          </Text>
        </Card>

        <SectionLabel>Signatures &amp; seal</SectionLabel>
        <Card>
          <Text style={{ color: c.textSecondary, fontSize: 12, fontWeight: '700', marginBottom: 6 }}>Signatory 1 name</Text>
          {field({ value: t.signatory1_name, onChangeText: (v: string) => setT(x => ({ ...x, signatory1_name: v })), placeholder: 'Leave blank to use owner name' })}
          <View style={{ height: 8 }} />
          {field({ value: t.signatory1_title, onChangeText: (v: string) => setT(x => ({ ...x, signatory1_title: v })), placeholder: 'Title, e.g. Director' })}
          <ImgRow label="Signature 1 image (PNG)" uri={t.signatory1_image}
            onPick={() => pickImage('signatory1_image', 'Signature 1')}
            onClear={() => setT(x => ({ ...x, signatory1_image: '' }))} />
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.divider, marginVertical: 8 }} />
          <Text style={{ color: c.textSecondary, fontSize: 12, fontWeight: '700', marginBottom: 6 }}>Signatory 2 (optional)</Text>
          {field({ value: t.signatory2_name, onChangeText: (v: string) => setT(x => ({ ...x, signatory2_name: v })), placeholder: 'Name' })}
          <View style={{ height: 8 }} />
          {field({ value: t.signatory2_title, onChangeText: (v: string) => setT(x => ({ ...x, signatory2_title: v })), placeholder: 'Title' })}
          <ImgRow label="Signature 2 image (PNG)" uri={t.signatory2_image}
            onPick={() => pickImage('signatory2_image', 'Signature 2')}
            onClear={() => setT(x => ({ ...x, signatory2_image: '' }))} />
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.divider, marginVertical: 8 }} />
          <ImgRow label="Seal / stamp image" uri={t.seal_image}
            onPick={() => pickImage('seal_image', 'Seal')}
            onClear={() => setT(x => ({ ...x, seal_image: '' }))} />
        </Card>

        <Card>
          <Toggle c={c} label="Show student photo" value={t.show_photo} onValueChange={(v: boolean) => setT(x => ({ ...x, show_photo: v }))} />
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.divider }} />
          <Toggle c={c} label="Print a verification code" value={t.show_verify_code} onValueChange={(v: boolean) => setT(x => ({ ...x, show_verify_code: v }))} />
        </Card>

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
          <TouchableOpacity onPress={preview} disabled={previewing}
            style={{ flex: 1, backgroundColor: c.surface, borderRadius: 14, paddingVertical: 15, alignItems: 'center', borderWidth: 1, borderColor: c.border }}>
            <Text style={{ color: c.primary, fontWeight: '800' }}>{previewing ? 'Building…' : 'Preview'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={save} disabled={saving}
            style={{ flex: 1.4, backgroundColor: saving ? c.textMuted : c.primary, borderRadius: 14, paddingVertical: 15, alignItems: 'center' }}>
            <Text style={{ color: c.onPrimary, fontWeight: '900' }}>{saving ? 'Saving…' : 'Save design'}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeScreen>
  );
}

function Toggle({ c, label, value, onValueChange }: any) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 }}>
      <Text style={{ color: c.text, fontWeight: '600', fontSize: 14 }}>{label}</Text>
      <Switch value={value} onValueChange={onValueChange}
        trackColor={{ true: c.primary + '60', false: c.border }} thumbColor={value ? c.primary : '#f4f3f4'} />
    </View>
  );
}
