import React, { useCallback, useContext, useState } from 'react';
import { View, ScrollView, Switch, Alert, Image } from 'react-native';
import { Text, TextInput } from '../theme/Text';
import { useFocusEffect } from '@react-navigation/native';
import { SafeScreen } from '../components/SafeScreen';
import { Card, Button, Chip, SectionLabel } from '../components/UI';
import { useTheme } from '../context/ThemeContext';
import { AppContext } from '../context/AppContext';
import { DBX } from '../database/Database';
import { shareInvoicePDF, printBill, ReceiptWidth } from '../utils/invoice';
import { ReviewLinkCard } from '../components/ReviewLinkCard';

/** Bill design: logo, footer message, printer — with a live sample. */
export default function BillDesignScreen({ navigation }: any) {
  const { colors: c } = useTheme();
  const { currencySymbol } = useContext(AppContext);
  const [profile, setProfile] = useState<any>({});
  const [footer, setFooter] = useState('');
  const [logo, setLogo] = useState(true);
  const [width, setWidth] = useState<ReceiptWidth>('a4');
  const [prefix, setPrefix] = useState('SOS');

  useFocusEffect(useCallback(() => {
    (async () => {
      const [p, f, l, w, px] = await Promise.all([DBX.getSalonProfile(), DBX.getSetting('invoice_footer'), DBX.getSetting('invoice_logo'), DBX.getSetting('receipt_width'), DBX.getSetting('bill_prefix')]);
      setProfile(p || {}); setFooter(f || ''); setLogo(l !== 'false');
      if (w === '58' || w === '80' || w === 'a4') setWidth(w);
      setPrefix(px || 'SOS');
    })();
  }, []));

  const [saving, setSaving] = useState(false);
  async function save(quiet = false) {
    const px = prefix.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'INV';
    await Promise.all([
      DBX.setSetting('invoice_footer', footer.trim()),
      DBX.setSetting('invoice_logo', logo ? 'true' : 'false'),
      DBX.setSetting('receipt_width', width),
      DBX.setSetting('bill_prefix', px),
    ]);
    setPrefix(px);
    if (!quiet) Alert.alert('Saved', 'New bills will use this design.');
  }
  async function onSave() {
    if (saving) return;
    setSaving(true);
    try { await save(); } catch { Alert.alert('Not saved', 'Could not save the bill design. Please try again.'); }
    finally { setSaving(false); }
  }

  const sample = {
    bill_number: `${prefix || 'INV'}/26-27/00042`, created_at: (() => { const d = new Date(); const p2 = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`; })(), // local time (toISOString is UTC — 5.5 h off in IST)
    client_name: 'Priya Sharma', client_phone: '98200 00000', staff_name: 'Sana',
    items: [{ type: 'service', name: 'Hair Spa', price: 800, qty: 1 }, { type: 'service', name: 'Eyebrow Threading', price: 40, qty: 1 }],
    subtotal: 840, discount_amount: 40, tax_amount: 0, loyalty_discount: 0, total: 800, payment_method: 'upi', payment_status: 'paid', amount_due: 0,
  };

  return (
    <SafeScreen keyboard>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <ReviewLinkCard />
        <SectionLabel>Logo</SectionLabel>
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            {profile.profile_image ? <Image source={{ uri: profile.profile_image }} style={{ width: 52, height: 52, borderRadius: 12 }} /> : null}
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.text, fontWeight: '700' }}>Show salon logo on bills</Text>
              <Text style={{ color: c.textMuted, fontSize: 12 }}>{profile.profile_image ? 'Uses your salon profile photo' : 'Add a photo in Settings → Salon Profile'}</Text>
            </View>
            <Switch value={logo} onValueChange={setLogo} trackColor={{ true: c.primary + '70' }} thumbColor={logo ? c.primary : '#ccc'} />
          </View>
        </Card>

        <SectionLabel>Bill number prefix</SectionLabel>
        <Card>
          <TextInput value={prefix} onChangeText={setPrefix} autoCapitalize="characters" maxLength={6}
            style={{ backgroundColor: c.surface, color: c.text, borderRadius: 12, padding: 12, fontSize: 16, fontWeight: '800' }} />
          <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 6 }}>Example: {prefix || 'INV'}/26-27/00042. Numbering restarts every 1 April (GST rule).</Text>
        </Card>

        <SectionLabel>Message at the bottom of every bill</SectionLabel>
        <Card>
          <TextInput value={footer} onChangeText={setFooter} multiline maxLength={300} placeholder={'e.g. Thank you! Follow us on Instagram @glowsalon\nNo refunds on services.'}
            placeholderTextColor={c.textMuted} style={{ backgroundColor: c.surface, color: c.text, borderRadius: 12, padding: 12, minHeight: 80, textAlignVertical: 'top' }} />
        </Card>

        <SectionLabel>Printer</SectionLabel>
        <Card>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            <Chip label="A4 / PDF" active={width === 'a4'} onPress={() => setWidth('a4')} />
            <Chip label="80 mm thermal" active={width === '80'} onPress={() => setWidth('80')} />
            <Chip label="58 mm thermal" active={width === '58'} onPress={() => setWidth('58')} />
          </View>
          <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 8, lineHeight: 17 }}>
            Thermal printers print through Android’s print service. For most Bluetooth printers install the free “RawBT” app once, pair the printer, then use Test print.
          </Text>
        </Card>

        <Button label="Save" icon="content-save-outline" onPress={onSave} loading={saving} disabled={saving} style={{ marginTop: 4 }} />
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          <Button label="Sample PDF" icon="file-pdf-box" size="sm" variant="subtle" style={{ flex: 1 }}
            onPress={async () => { try { await save(true); } catch { /* sample still works with unsaved values */ } shareInvoicePDF(sample, profile, currencySymbol).catch(() => Alert.alert('PDF error', 'Could not create the sample.')); }} />
          <Button label="Test print" icon="printer" size="sm" variant="subtle" style={{ flex: 1 }}
            onPress={async () => { try { await save(true); } catch { /* ignore */ } printBill(sample, profile, currencySymbol, width).catch(() => Alert.alert('No printer', 'No printer responded. Check the printer’s Android print service (e.g. RawBT).')); }} />
        </View>
      </ScrollView>
    </SafeScreen>
  );
}
