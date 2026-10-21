/**
 * GstFields — the one place a salon owner sets up GST.
 *
 * GST is OFF unless the owner turns it on: many salons and home beauticians
 * are below the registration limit and must NOT charge GST. When it is on, the
 * owner enters their GSTIN, picks the rate (5% / 18% / other) and says whether
 * their menu prices already include GST.
 *
 * Pure UI: the parent owns the values and decides when to save (Settings saves
 * on "Save GST settings", onboarding saves at the end of setup).
 */
import React from 'react';
import { View, Switch, TextInput, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from '../theme/Text';
import { useTheme } from '../context/ThemeContext';
import { useTr } from '../i18n/tr';
import { getRegion, validTaxId } from '../config/regions';

export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
/** Quick-pick rates for the salon's country (5/18 in India, 20 in the UK…). */
export const GST_RATE_PRESETS = [5, 18];
const presets = () => getRegion().tax.presets;
export const MAX_GST_RATE = 40;

export interface GstValues {
  enabled: boolean;
  gstin: string;
  rate: string;      // kept as text while typing
  inclusive: boolean;
}

/** Returns an error message, or '' when the values can be saved. */
export function validateGst(v: GstValues): string {
  if (!v.enabled) return '';
  const g = v.gstin.trim().toUpperCase();
  if (g && !validTaxId(g)) return getRegion().code === 'IN'
    ? 'GSTIN must be 15 characters, e.g. 27ABCDE1234F1Z5. Leave it blank only if you are still registering.'
    : `Check your ${getRegion().tax.idLabel}. Leave it blank if you do not have one yet.`;
  const r = Number(String(v.rate).replace(',', '.'));
  if (!Number.isFinite(r) || r <= 0 || r > MAX_GST_RATE) return `${getRegion().tax.name} rate must be more than 0 and at most ${MAX_GST_RATE}%.`;
  return '';
}

export function GstFields({ value, onChange, compact }: { value: GstValues; onChange: (v: GstValues) => void; compact?: boolean }) {
  const { colors: c } = useTheme();
  const tr = useTr();
  const set = (patch: Partial<GstValues>) => onChange({ ...value, ...patch });
  const rateNum = Number(String(value.rate).replace(',', '.'));
  const isPreset = presets().includes(rateNum);
  const [custom, setCustom] = React.useState(!isPreset && !!value.rate);
  const rg = getRegion();
  const gstinBad = !!value.gstin.trim() && !validTaxId(value.gstin.trim().toUpperCase());

  const chip = (label: string, active: boolean, onPress: () => void) => (
    <TouchableOpacity key={label} onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }}
      style={{ paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999, borderWidth: 1.5,
        borderColor: active ? c.primary : c.border, backgroundColor: active ? c.primary : 'transparent' }}>
      <Text style={{ color: active ? c.onPrimary : c.text, fontWeight: '700', fontSize: 14 }}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.text, fontSize: 15, fontWeight: '700' }}>{tr('I am GST registered')}</Text>
          <Text style={{ color: c.textMuted, fontSize: 12.5, marginTop: 2 }}>
            {value.enabled
              ? tr('GST will be shown on bills')
              : tr('Off — bills are plain receipts with no GST. Turn on only if you have a GSTIN.')}
          </Text>
        </View>
        <Switch value={value.enabled} onValueChange={v => set({ enabled: v, rate: v && !value.rate ? String(presets()[0] ?? 5) : value.rate })}
          trackColor={{ true: c.primary + '70', false: c.border }} thumbColor={value.enabled ? c.primary : c.textLight}
          accessibilityLabel={tr('I am GST registered')} />
      </View>

      {value.enabled && (
        <View style={{ marginTop: 14, gap: compact ? 12 : 16 }}>
          <View>
            <Text style={{ color: c.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>{tr('GSTIN')}</Text>
            <TextInput
              value={value.gstin}
              onChangeText={t => set({ gstin: rg.code === 'IN' ? t.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 15) : t.toUpperCase().replace(/[^0-9A-Z .\-/]/g, '').slice(0, 30) })}
              placeholder={rg.tax.idExample || rg.tax.idLabel}
              placeholderTextColor={c.textMuted}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={rg.code === 'IN' ? 15 : 30}
              style={{ backgroundColor: c.surface, color: c.text, borderRadius: 12, padding: 12, fontSize: 15, letterSpacing: 1,
                borderWidth: 1, borderColor: gstinBad ? c.danger : c.border }}
            />
            {gstinBad
              ? <Text style={{ color: c.danger, fontSize: 12, marginTop: 4 }}>{rg.code === 'IN' ? tr('GSTIN should be 15 letters and numbers, like 27ABCDE1234F1Z5.') : `${rg.tax.idLabel}: ${tr('Check the number')}`}</Text>
              : !value.gstin.trim()
                ? <Text style={{ color: c.warning, fontSize: 12, marginTop: 4 }}>{tr('Only GST-registered businesses may charge GST. Without a GSTIN, bills will not say "Tax Invoice".')}</Text>
                : null}
          </View>

          <View>
            <Text style={{ color: c.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 8 }}>{tr('GST rate')}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {presets().map(r => chip(`${r}%`, !custom && rateNum === r, () => { setCustom(false); set({ rate: String(r) }); }))}
              {chip(tr('Other'), custom, () => setCustom(true))}
            </View>
            {custom && (
              <TextInput
                value={value.rate}
                onChangeText={t => set({ rate: t.replace(/[^0-9.,]/g, '').slice(0, 5) })}
                placeholder="e.g. 12"
                placeholderTextColor={c.textMuted}
                keyboardType="decimal-pad"
                style={{ marginTop: 10, backgroundColor: c.surface, color: c.text, borderRadius: 12, padding: 12, fontSize: 15, borderWidth: 1, borderColor: c.border, width: 120 }}
              />
            )}
            <View style={{ flexDirection: 'row', gap: 6, marginTop: 8, alignItems: 'flex-start' }}>
              <MaterialCommunityIcons name="information-outline" size={14} color={c.textMuted} style={{ marginTop: 2 }} />
              <Text style={{ color: c.textMuted, fontSize: 12, flex: 1 }}>
                {rg.code === 'IN' ? tr('Salon and spa services are usually 5% (since 22 Sep 2025). Confirm your rate with your CA.') : rg.tax.note}
              </Text>
            </View>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.text, fontSize: 14, fontWeight: '600' }}>{tr('Prices include GST')}</Text>
              <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 2 }}>
                {value.inclusive
                  ? tr('Menu price stays the same; GST is shown inside it')
                  : tr('GST is added on top of the menu price')}
              </Text>
            </View>
            <Switch value={value.inclusive} onValueChange={v => set({ inclusive: v })}
              trackColor={{ true: c.primary + '70', false: c.border }} thumbColor={value.inclusive ? c.primary : c.textLight}
              accessibilityLabel={tr('Prices include GST')} />
          </View>
        </View>
      )}
    </View>
  );
}

/** Persist GST values: settings flags + profile GSTIN/rate. Throws on invalid input. */
export async function saveGstValues(db: { setSetting: (k: string, v: string) => Promise<any>; updateSalonProfile: (d: any) => Promise<any> }, v: GstValues) {
  const err = validateGst(v);
  if (err) throw new Error(err);
  await db.setSetting('gst_enabled', v.enabled ? 'true' : 'false');
  if (v.enabled) {
    const rate = Math.round(Number(String(v.rate).replace(',', '.')) * 100) / 100;
    await db.updateSalonProfile({ gst_number: v.gstin.trim().toUpperCase(), tax_rate: rate });
    await db.setSetting('prices_include_gst', v.inclusive ? 'true' : 'false');
  } else {
    await db.setSetting('prices_include_gst', 'false');
  }
}
