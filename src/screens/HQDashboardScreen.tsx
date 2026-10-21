import React, { useCallback, useContext, useMemo, useState } from 'react';
import { View, ScrollView, TouchableOpacity, RefreshControl, Alert } from 'react-native';
import { Text } from '../theme/Text';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeScreen } from '../components/SafeScreen';
import { Card, SectionLabel, Pill, SegmentedTabs, BottomSheet, Button, EmptyState } from '../components/UI';
import { useTheme } from '../context/ThemeContext';
import { AppContext } from '../context/AppContext';
import { BranchSyncService, BranchRecord } from '../services/BranchSyncService';
import { inr } from '../services/ai/BossAI';

type Range = 'today' | 'month';

function Bars({ data, color, height = 34 }: { data: number[]; color: string; height?: number }) {
  const max = Math.max(1, ...data);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2, height }}>
      {data.map((v, i) => (
        <View key={i} style={{ flex: 1, height: Math.max(2, (v / max) * height), borderRadius: 2, backgroundColor: i === data.length - 1 ? color : color + '66' }} />
      ))}
    </View>
  );
}

export default function HQDashboardScreen() {
  const { colors: c } = useTheme();
  const nav = useNavigation<any>();
  const { currencySymbol } = useContext(AppContext);
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [range, setRange] = useState<Range>('today');
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<BranchRecord | null>(null);
  const fmt = (n: number) => inr(n || 0, currencySymbol);

  const pull = useCallback(async () => {
    setRefreshing(true); setError('');
    try { setBranches(await BranchSyncService.pullBranches()); }
    catch (e: any) { setError(e?.message || 'Could not reach the cloud.'); setBranches(await BranchSyncService.getCachedBranches()); }
    finally { setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => {
    BranchSyncService.getCachedBranches().then(setBranches).catch(() => {});
    pull();
  }, [pull]));

  const pick = (b: BranchRecord) => (range === 'today' ? b.summary?.today : b.summary?.month) || {};
  const totals = useMemo(() => {
    const t = { revenue: 0, bills: 0, expenses: 0, profit: 0, lastMonth: 0, dues: 0, lowStock: 0, alerts: 0, present: 0, staff: 0 };
    for (const b of branches) {
      const s = b.summary || {};
      const x = pick(b);
      t.revenue += x.revenue || 0; t.bills += x.bills || 0; t.expenses += x.expenses || 0;
      t.profit += range === 'month' ? (s.month?.profit || 0) : (x.revenue || 0) - (x.expenses || 0);
      t.lastMonth += s.lastMonth?.revenue || 0;
      t.dues += s.dues?.amount || 0; t.lowStock += (s.lowStock || []).length; t.alerts += (s.alerts || []).length;
      t.present += s.attendanceToday?.present || 0; t.staff += s.attendanceToday?.total || 0;
    }
    return t;
  }, [branches, range]);

  const chainStaff = useMemo(() => branches.flatMap(b => (b.summary?.staff || []).map((s: any) => ({ ...s, branch: b.branchName })))
    .sort((a, b) => b.revenue - a.revenue).slice(0, 8), [branches]);
  const chainServices = useMemo(() => {
    const m = new Map<string, { name: string; count: number; revenue: number }>();
    for (const b of branches) for (const s of b.summary?.topServices || []) {
      const k = String(s.name).toLowerCase();
      const x = m.get(k) || { name: s.name, count: 0, revenue: 0 };
      x.count += s.count || 0; x.revenue += s.revenue || 0; m.set(k, x);
    }
    return [...m.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 6);
  }, [branches]);
  const ranked = useMemo(() => [...branches].sort((a, b) => (pick(b).revenue || 0) - (pick(a).revenue || 0)), [branches, range]);
  const best = ranked[0];

  return (
    <SafeScreen>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={pull} tintColor={c.primary} />}>

        <SegmentedTabs value={range} onChange={k => setRange(k as Range)} style={{ marginBottom: 14 }}
          tabs={[{ key: 'today', label: 'Today' }, { key: 'month', label: 'This month' }]} />

        {error ? (
          <Card style={{ backgroundColor: c.warningLight }}>
            <Text style={{ color: c.warning, fontWeight: '800' }}>Showing last saved figures</Text>
            <Text style={{ color: c.textSecondary, fontSize: 12.5, marginTop: 3 }}>{error}</Text>
          </Card>
        ) : null}

        {/* Chain totals */}
        <View style={{ backgroundColor: c.brandInk, borderRadius: 22, padding: 18, marginBottom: 14 }}>
          <Text style={{ color: '#B9AE96', fontSize: 12, fontWeight: '800', letterSpacing: 1 }}>ALL {branches.length} BRANCHES · {range === 'today' ? 'TODAY' : 'THIS MONTH'}</Text>
          <Text style={{ color: '#fff', fontSize: 32, fontWeight: '900', marginTop: 4 }}>{fmt(totals.revenue)}</Text>
          <Text style={{ color: '#CFC8B8', fontSize: 12.5 }}>
            {totals.bills} bills · avg {fmt(totals.bills ? totals.revenue / totals.bills : 0)}
            {range === 'month' && totals.lastMonth ? ` · last month ${fmt(totals.lastMonth)}` : ''}
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
            {[
              { l: range === 'month' ? 'Profit' : 'After expenses', v: fmt(totals.profit) },
              { l: 'Pending dues', v: fmt(totals.dues) },
              { l: 'Staff present', v: `${totals.present}/${totals.staff}` },
            ].map(x => (
              <View key={x.l} style={{ flex: 1, backgroundColor: '#ffffff12', borderRadius: 12, padding: 10 }}>
                <Text style={{ color: c.brandGold, fontWeight: '900', fontSize: 14 }} numberOfLines={1}>{x.v}</Text>
                <Text style={{ color: '#B9AE96', fontSize: 10.5, marginTop: 2 }}>{x.l}</Text>
              </View>
            ))}
          </View>
        </View>

        {branches.length === 0 && !refreshing ? (
          <EmptyState icon="store-outline" title="No branch has synced yet"
            subtitle="Share the join code with each branch phone (Branches & Cloud → Share join code). Their figures appear here after the first sync." />
        ) : null}

        {(totals.alerts > 0 || totals.lowStock > 0) && (
          <Card style={{ borderLeftWidth: 4, borderLeftColor: totals.alerts ? c.danger : c.warning }}>
            <Text style={{ color: c.text, fontWeight: '800' }}>Needs attention</Text>
            {branches.flatMap(b => (b.summary?.alerts || []).map((a: any, i: number) => (
              <Text key={b.branchId + 'a' + i} style={{ color: c.textSecondary, fontSize: 12.5, marginTop: 4 }}>🔴 {b.branchName}: {a.title}</Text>
            )))}
            {branches.filter(b => (b.summary?.lowStock || []).length).map(b => (
              <Text key={b.branchId + 's'} style={{ color: c.textSecondary, fontSize: 12.5, marginTop: 4 }}>📦 {b.branchName}: {(b.summary.lowStock || []).length} items low ({(b.summary.lowStock || []).slice(0, 2).map((x: any) => x.name).join(', ')})</Text>
            ))}
            {branches.filter(b => b.stale).map(b => (
              <Text key={b.branchId + 'z'} style={{ color: c.textSecondary, fontSize: 12.5, marginTop: 4 }}>📵 {b.branchName}: not synced for {Math.round((b.ageMin || 0) / 60)} h</Text>
            ))}
          </Card>
        )}

        <SectionLabel style={{ marginTop: 6 }}>Branches</SectionLabel>
        {ranked.map((b, idx) => {
          const x = pick(b);
          const s = b.summary || {};
          const lm = s.lastMonth?.revenue || 0;
          const growth = range === 'month' && lm > 0 ? Math.round(((x.revenue || 0) - lm) / lm * 100) : null;
          const share = totals.revenue ? Math.round(((x.revenue || 0) / totals.revenue) * 100) : 0;
          return (
            <Card key={b.branchId} onPress={() => setOpen(b)}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: idx === 0 ? c.brandGold : c.surface, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: idx === 0 ? '#000' : c.textSecondary, fontWeight: '900' }}>{idx + 1}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.text, fontWeight: '800', fontSize: 15 }} numberOfLines={1}>{b.branchName}</Text>
                  <Text style={{ color: b.stale ? c.warning : c.textMuted, fontSize: 11.5 }}>
                    {b.stale ? '⚠ ' : ''}synced {b.ageMin! < 60 ? `${b.ageMin} min` : `${Math.round((b.ageMin || 0) / 60)} h`} ago{s.city ? ` · ${s.city}` : ''}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ color: c.text, fontWeight: '900', fontSize: 17 }}>{fmt(x.revenue)}</Text>
                  <Text style={{ color: c.textMuted, fontSize: 11 }}>{x.bills || 0} bills · {share}%</Text>
                </View>
              </View>
              <View style={{ marginTop: 12 }}>
                <Bars data={(s.daily || []).slice(-14).map((d: any) => d.revenue || 0)} color={c.primary} />
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                {growth !== null && <Pill label={`${growth >= 0 ? '▲' : '▼'} ${Math.abs(growth)}% vs last month`} tone={growth >= 0 ? 'success' : 'danger'} />}
                {s.dues?.amount > 0 && <Pill label={`Dues ${fmt(s.dues.amount)}`} tone="warning" />}
                {(s.lowStock || []).length > 0 && <Pill label={`${s.lowStock.length} low stock`} tone="warning" />}
                {(s.alerts || []).length > 0 && <Pill label={`${s.alerts.length} alert${s.alerts.length > 1 ? 's' : ''}`} tone="danger" />}
                {s.attendanceToday && <Pill label={`Staff ${s.attendanceToday.present}/${s.attendanceToday.total}`} tone="info" />}
              </View>
            </Card>
          );
        })}

        {chainStaff.length > 0 && (
          <>
            <SectionLabel style={{ marginTop: 6 }}>Top staff across the chain (month)</SectionLabel>
            <Card padded={false}>
              {chainStaff.map((s, i) => (
                <View key={s.branch + s.name} style={{ flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: i < chainStaff.length - 1 ? 0.5 : 0, borderBottomColor: c.divider }}>
                  <Text style={{ width: 24, color: c.textMuted, fontWeight: '800' }}>{i + 1}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.text, fontWeight: '700' }}>{s.name}</Text>
                    <Text style={{ color: c.textMuted, fontSize: 11.5 }}>{s.branch} · {s.bills} bills</Text>
                  </View>
                  <Text style={{ color: c.text, fontWeight: '800' }}>{fmt(s.revenue)}</Text>
                </View>
              ))}
            </Card>
          </>
        )}

        {chainServices.length > 0 && (
          <>
            <SectionLabel style={{ marginTop: 6 }}>Best-selling services (month)</SectionLabel>
            <Card>
              {chainServices.map(s => (
                <View key={s.name} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 }}>
                  <Text style={{ color: c.text, flex: 1 }} numberOfLines={1}>{s.name}</Text>
                  <Text style={{ color: c.textMuted, marginRight: 12 }}>{s.count}×</Text>
                  <Text style={{ color: c.text, fontWeight: '800' }}>{fmt(s.revenue)}</Text>
                </View>
              ))}
            </Card>
          </>
        )}

        {best && branches.length > 1 && (
          <Card style={{ backgroundColor: c.primaryLight }}>
            <Text style={{ color: c.primary, fontWeight: '800' }}>💡 Boss AI</Text>
            <Text style={{ color: c.textSecondary, fontSize: 13, marginTop: 4, lineHeight: 19 }}>
              {best.branchName} is leading {range === 'today' ? 'today' : 'this month'}.
              {(() => {
                const low = ranked[ranked.length - 1];
                const lx = pick(low), bx = pick(best);
                if (!low || low === best || !bx.bills || !lx.bills) return '';
                const ab = (bx.revenue || 0) / bx.bills, al = (lx.revenue || 0) / lx.bills;
                return al < ab * 0.8
                  ? ` ${low.branchName}'s average bill is ${fmt(al)} vs ${fmt(ab)} — train staff there to suggest add-ons (the billing screen now prompts them).`
                  : ` ${low.branchName} has fewer bills — try a weekday offer there and send win-back messages from Boss AI.`;
              })()}
            </Text>
          </Card>
        )}
        <Button label="Branches & Cloud settings" icon="cog-outline" variant="ghost" onPress={() => nav.navigate('BranchHub')} />
      </ScrollView>

      <BottomSheet visible={!!open} onClose={() => setOpen(null)} title={open?.branchName || ''}>
        {open && (() => {
          const s = open.summary || {};
          const rows: [string, string][] = [
            ['Today', `${fmt(s.today?.revenue)} · ${s.today?.bills || 0} bills`],
            ['Today by mode', `Cash ${fmt(s.today?.cash)} · UPI ${fmt(s.today?.upi)} · Card ${fmt(s.today?.card)}`],
            ['Yesterday', fmt(s.yesterday?.revenue)],
            ['This month', `${fmt(s.month?.revenue)} · ${s.month?.bills || 0} bills`],
            ['Month expenses', fmt(s.month?.expenses)],
            ['Month profit', fmt(s.month?.profit)],
            ['Discounts given', fmt(s.month?.discount)],
            ['Forecast (month end)', s.forecast?.projected ? fmt(s.forecast.projected) : '—'],
            ['Last month', fmt(s.lastMonth?.revenue)],
            ['Clients on file', String(s.clients?.total ?? '—')],
            ['App version', s.appVersion || '—'],
          ];
          return (
            <View>
              {rows.map(([l, v]) => (
                <View key={l} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: c.divider }}>
                  <Text style={{ color: c.textMuted }}>{l}</Text>
                  <Text style={{ color: c.text, fontWeight: '700', flexShrink: 1, textAlign: 'right' }}>{v}</Text>
                </View>
              ))}
              {(s.staff || []).length > 0 && <SectionLabel style={{ marginTop: 14 }}>Staff this month</SectionLabel>}
              {(s.staff || []).map((x: any) => (
                <Text key={x.name} style={{ color: c.textSecondary, paddingVertical: 3 }}>{x.name} — {fmt(x.revenue)} · {x.bills} bills · comm. {fmt(x.commission)}</Text>
              ))}
              {(s.lowStock || []).length > 0 && <SectionLabel style={{ marginTop: 14 }}>Low stock</SectionLabel>}
              {(s.lowStock || []).map((x: any) => (
                <Text key={x.name} style={{ color: c.textSecondary, paddingVertical: 3 }}>{x.name}: {x.qty} {x.unit || ''} (min {x.min})</Text>
              ))}
              <Button label="Remove this branch from HQ" icon="delete-outline" size="sm" variant="ghost" color={c.danger} style={{ marginTop: 16 }}
                onPress={() => Alert.alert('Remove branch?', 'It disappears from this dashboard until it syncs again. Its backups stay in Drive.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Remove', style: 'destructive', onPress: async () => { await BranchSyncService.removeBranch(open.branchId).catch(() => {}); setOpen(null); setBranches(await BranchSyncService.getCachedBranches()); } },
                ])} />
            </View>
          );
        })()}
      </BottomSheet>
    </SafeScreen>
  );
}
