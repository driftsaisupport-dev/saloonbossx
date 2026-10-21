/**
 * ClientAlertBadge — red allergy banner for a client, plus an optional
 * no-show pill. Use it wherever a client is shown before a service starts
 * (client profile, billing, booking form).
 *
 *   <ClientAlertBadge clientId={client.id} fallbackText={client.allergies} noShowCount={client.no_show_count} />
 *
 * Loads the client's allergy notes (DBX.listClientNotes(id, 'allergy')) and
 * refreshes on 'client:changed'. `fallbackText` (the legacy clients.allergies
 * field) is shown when there are no allergy notes. Renders nothing when there
 * is nothing to warn about. `compact` = single line, for tight rows.
 */
import React from 'react';
import { View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from '../theme/Text';
import { useTheme } from '../context/ThemeContext';
import { DBX } from '../database/Database';
import { useTr } from '../i18n/tr';
import { appEvents } from './appEvents';

export function ClientAlertBadge({ clientId, fallbackText, noShowCount, compact, style }: {
  clientId?: number | null;
  fallbackText?: string | null;
  noShowCount?: number | null;
  compact?: boolean;
  style?: any;
}) {
  const { colors: c } = useTheme();
  const tr = useTr();
  const [notes, setNotes] = React.useState<string[]>([]);

  React.useEffect(() => {
    let alive = true;
    const id = Number(clientId) || 0;
    setNotes([]);
    if (!id) return;
    const load = () => {
      DBX.listClientNotes(id, 'allergy')
        .then(rows => { if (alive) setNotes((rows || []).map((r: any) => String(r.text || '').trim()).filter(Boolean)); })
        .catch(() => { /* the banner is advisory; the fallback text still shows */ });
    };
    load();
    const off = appEvents.on('client:changed', (p?: any) => { if (!p?.id || Number(p.id) === id) load(); });
    return () => { alive = false; off(); };
  }, [clientId]);

  const fallback = String(fallbackText || '').trim();
  const lines = notes.length ? notes : fallback ? [fallback] : [];
  const noShows = Math.max(0, Number(noShowCount) || 0);
  if (!lines.length && !noShows) return null;

  return (
    <View style={[{ gap: 6 }, style]}>
      {lines.length > 0 && (
        <View accessibilityRole="alert" style={{ flexDirection: 'row', alignItems: compact ? 'center' : 'flex-start', gap: 8, backgroundColor: c.dangerLight,
          borderRadius: 12, paddingHorizontal: 12, paddingVertical: compact ? 8 : 11, borderWidth: 1, borderColor: c.danger + '55' }}>
          <MaterialCommunityIcons name="alert-octagon" size={compact ? 16 : 19} color={c.danger} style={{ marginTop: compact ? 0 : 1 }} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.danger, fontWeight: '900', fontSize: compact ? 12 : 13 }} numberOfLines={compact ? 2 : undefined}>
              {tr('Allergy')}{compact ? `: ${lines.join(' · ')}` : ''}
            </Text>
            {!compact && lines.map((l, i) => (
              <Text key={i} style={{ color: c.danger, fontSize: 13, fontWeight: '600', marginTop: 2 }}>• {l}</Text>
            ))}
          </View>
        </View>
      )}
      {noShows > 0 && <NoShowBadge count={noShows} />}
    </View>
  );
}

/** "2 no-shows" pill. Renders nothing for 0. */
export function NoShowBadge({ count, style }: { count?: number | null; style?: any }) {
  const { colors: c } = useTheme();
  const tr = useTr();
  const n = Math.max(0, Number(count) || 0);
  if (!n) return null;
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', backgroundColor: c.warningLight,
      borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3.5 }, style]}>
      <MaterialCommunityIcons name="calendar-remove-outline" size={13} color={c.warning} />
      <Text style={{ color: c.warning, fontWeight: '800', fontSize: 11.5 }}>{n === 1 ? tr('1 no-show') : tr('{n} no-shows', { n })}</Text>
    </View>
  );
}
