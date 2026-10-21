/**
 * PackageSection — a client's active packages on the client profile.
 *
 *   <PackageSection clientId={id} clientName="Priya" currencySymbol="₹" walletBalance={500}
 *     onManage={() => navigation.navigate('Packages')} />
 *
 * Remaining sessions / value with a progress bar, expiry (warns under 7 days),
 * and "Sell package" for users with billing.create.
 */
import React from 'react';
import { View, ActivityIndicator, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from '../theme/Text';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { DBX } from '../database/Database';
import { useTr } from '../i18n/tr';
import { prettyDate } from './formUtils';
import { Button, Pill } from './UI';
import { appEvents } from './appEvents';
import { PackageSellSheet } from './PackageSellSheet';
import { CardLabel, money } from './WalletShared';
import { curSym } from '../config/regions';

export function PackageSection({ clientId, clientName, currencySymbol = curSym(), walletBalance = 0, onManage, onChanged }: {
  clientId: number;
  clientName?: string;
  currencySymbol?: string;
  walletBalance?: number;
  onManage?: () => void;
  onChanged?: () => void;
}) {
  const { colors: c } = useTheme();
  const tr = useTr();
  const { can } = useAuth();
  const canSell = can('billing.create');
  const [list, setList] = React.useState<any[]>([]);
  const [state, setState] = React.useState<'loading' | 'ready' | 'error'>('loading');
  const [sellOpen, setSellOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!clientId) return;
    try { setList(await DBX.getClientActivePackages(clientId)); setState('ready'); }
    catch (e) { console.warn('[packages] load', e); setState(s => (s === 'ready' ? s : 'error')); }
  }, [clientId]);

  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => appEvents.on('bill:created', () => { load(); }), [load]);
  React.useEffect(() => appEvents.on('bill:voided', () => { load(); }), [load]);

  return (
    <View style={{ backgroundColor: c.card, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: c.border, marginBottom: 14 }}>
      <CardLabel text={tr('Active packages')} />

      {state === 'loading' && <ActivityIndicator color={c.primary} style={{ marginVertical: 16 }} />}
      {state === 'error' && (
        <TouchableOpacity onPress={() => { setState('loading'); load(); }} style={{ paddingVertical: 12 }}>
          <Text style={{ color: c.danger, fontWeight: '700' }}>{tr('Could not load packages. Tap to try again.')}</Text>
        </TouchableOpacity>
      )}
      {state === 'ready' && list.length === 0 && (
        <View style={{ alignItems: 'center', paddingVertical: 14 }}>
          <MaterialCommunityIcons name="package-variant" size={34} color={c.textLight} />
          <Text style={{ color: c.textMuted, marginTop: 8 }}>{tr('No active packages')}</Text>
        </View>
      )}

      {state === 'ready' && list.map((p, i) => {
        const soon = p.days_left < 7;
        const ratio = p.kind === 'sessions' ? (p.sessions_total ? p.remaining_sessions / p.sessions_total : 0)
          : p.kind === 'value' ? (p.value_total ? p.remaining_value / p.value_total : 0) : 1;
        const left = p.kind === 'sessions'
          ? tr('{n} of {t} sessions left', { n: p.remaining_sessions, t: p.sessions_total })
          : p.kind === 'value'
            ? tr('{a} of {t} left', { a: money(currencySymbol, p.remaining_value), t: money(currencySymbol, p.value_total) })
            : tr('{p}% off every bill', { p: p.discount_percent });
        return (
          <View key={p.id} style={{ paddingVertical: 12, borderTopWidth: i ? 0.5 : 0, borderTopColor: c.divider }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.text, fontWeight: '800', fontSize: 14.5 }}>{p.name}</Text>
                {p.service_name ? <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 1 }}>{tr('For {s}', { s: p.service_name })}</Text> : null}
              </View>
              {soon
                ? <Pill tone="warning" label={p.days_left === 0 ? tr('Expires today') : tr('Expires in {n} days', { n: p.days_left })} />
                : <Pill tone="success" label={tr('Active')} />}
            </View>
            <Text style={{ color: c.primary, fontWeight: '800', fontSize: 13.5, marginTop: 8 }}>{left}</Text>
            {p.kind !== 'discount' && (
              <View style={{ height: 6, borderRadius: 3, backgroundColor: c.surface, marginTop: 6, overflow: 'hidden' }}>
                <View style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%`, height: 6, borderRadius: 3, backgroundColor: soon ? c.warning : c.primary }} />
              </View>
            )}
            <Text style={{ color: soon ? c.warning : c.textMuted, fontSize: 12, marginTop: 6, fontWeight: soon ? '700' : '400' }}>
              {tr('Valid till {d}', { d: prettyDate(p.end_date, true) })}
            </Text>
          </View>
        );
      })}

      {canSell && (
        <Button label={tr('Sell package')} icon="package-variant-closed" variant="subtle" onPress={() => setSellOpen(true)} style={{ marginTop: 10 }} />
      )}
      {canSell && (
        <PackageSellSheet visible={sellOpen} onClose={() => setSellOpen(false)} clientId={clientId} clientName={clientName}
          walletBalance={walletBalance} currencySymbol={currencySymbol} onManage={onManage}
          onSold={() => { load(); onChanged?.(); }} />
      )}
    </View>
  );
}
