import React, { useState, useCallback, useContext } from 'react';
import { View, ScrollView, TouchableOpacity, Alert, RefreshControl } from 'react-native';
import { Text } from '../theme/Text';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeScreen } from '../components/SafeScreen';
import { Card, SectionLabel, Pill } from '../components/UI';
import { useTheme } from '../context/ThemeContext';
import { AppContext } from '../context/AppContext';
import { DatabaseService } from '../database/Database';
import { WhatsAppService } from '../services/WhatsAppService';
import { buildInsights, Insight } from '../services/InsightsEngine';
import { BossAI, AIClientRow } from '../services/ai/BossAI';
import type { Forecast, Alert as AIAlert } from '../services/ai/analytics';
import { toLocalDateStr, todayLocal, parseDbDate } from '../utils/helpers';
import { appLocale } from '../config/regions';

export default function InsightsScreen() {
  const { colors: c } = useTheme();
  const navigation = useNavigation<any>();
  const { currencySymbol } = useContext(AppContext);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [profile, setProfile] = useState<any>({});
  const [fc, setFc] = useState<Forecast | null>(null);
  const [due, setDue] = useState<AIClientRow[]>([]);
  const [segs, setSegs] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<AIAlert[]>([]);
  const [showAllDue, setShowAllDue] = useState(false);

  const load = useCallback(async () => {
    try {
      const today = todayLocal();
      const start30 = toLocalDateStr(new Date(Date.now() - 30 * 86400000));
      const start60 = toLocalDateStr(new Date(Date.now() - 60 * 86400000));
      const [prof, reengageDaysStr, dailyRevenue60, topServicesCurrent, topServicesPrev, staffPerf] = await Promise.all([
        DatabaseService.getSalonProfile(),
        DatabaseService.getSetting('reengage_days'),
        DatabaseService.getRevenueByDateRange(start60, today),
        DatabaseService.getTopServices(start30, today, 8),
        DatabaseService.getTopServices(start60, start30, 8),
        DatabaseService.getStaffPerformance(start30, today),
      ]);
      const reengageDays = parseInt(reengageDaysStr || '30', 10) || 30;
      const [atRiskClients, restockItems] = await Promise.all([
        (DatabaseService as any).getTopAtRiskClients(reengageDays, 5),
        (DatabaseService as any).getRestockCandidates(),
      ]);
      setProfile(prof || {});
      setInsights(buildInsights({
        currencySymbol,
        dailyRevenue60: dailyRevenue60 as any[],
        start30,
        topServicesCurrent: topServicesCurrent as any[],
        topServicesPrev: topServicesPrev as any[],
        staffPerf: staffPerf as any[],
        atRiskClients: atRiskClients as any[],
        restockItems: restockItems as any[],
      }));
      BossAI.invalidate();
      const [f, d, sg, al] = await Promise.all([BossAI.forecast(), BossAI.dueBack(7), BossAI.segments(), BossAI.alerts()]);
      setFc(f); setDue(d); setSegs(sg); setAlerts(al);
    } catch (e) { console.error('Insights load:', e); }
    finally { setLoading(false); }
  }, [currencySymbol]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function pullRefresh() { setRefreshing(true); await load(); setRefreshing(false); }

  function winBack(client: any) {
    if (!client.phone) { Alert.alert('No phone', 'This client has no phone number saved.'); return; }
    DatabaseService.getSetting('reengage_message').then(msg => {
      const template = msg || WhatsAppService.DEFAULT_REENGAGE_MESSAGE;
      const text = WhatsAppService.fillTemplate(template, {
        name: client.name || 'there',
        salon: profile.name || 'our salon',
        phone: profile.phone || '',
        days: Math.max(1, Math.round((Date.now() - parseDbDate(client.last_visit || Date.now()).getTime()) / 86400000)),
        last_visit: client.last_visit ? parseDbDate(client.last_visit).toLocaleDateString(appLocale()) : 'a while ago',
      });
      Alert.alert('Send win-back message', `Send a WhatsApp message to ${client.name}?`,
        [{ text: 'Cancel', style: 'cancel' }, { text: 'Send', onPress: () => WhatsAppService.sendMessage(client.phone, text) }]);
    });
  }

  const fmt = (n: number) => `${currencySymbol}${(n || 0).toLocaleString(appLocale(), { maximumFractionDigits: 0 })}`;

  return (
    <SafeScreen>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={pullRefresh} tintColor={c.primary} />}>

        <Text style={{ color: c.textMuted, fontSize: 13, lineHeight: 19, marginBottom: 16 }}>
          Patterns spotted in your own billing, client and stock data — computed on your phone, updated every time you open this screen.
        </Text>

        {!loading && fc && fc.historyDays >= 7 && (
          <Card style={{ backgroundColor: c.brandInk }}>
            <Text style={{ color: c.brandGold, fontSize: 11.5, fontWeight: '900', letterSpacing: 1 }}>MONTH-END FORECAST · {fc.confidence.toUpperCase()} CONFIDENCE</Text>
            <Text style={{ color: '#fff', fontSize: 28, fontWeight: '900', marginTop: 4 }}>{fmt(fc.projected)}</Text>
            <Text style={{ color: '#CFC8B8', fontSize: 12.5 }}>Likely {fmt(fc.low)} – {fmt(fc.high)} · {fmt(fc.mtd)} so far · {fc.daysLeft} days left</Text>
            {fc.target ? (
              <Text style={{ color: fc.onTrack ? '#34D399' : '#F5B454', fontWeight: '800', marginTop: 8 }}>
                {fc.onTrack ? `On track for your ${fmt(fc.target)} target 🎯` : `Need about ${fmt(fc.neededPerDay || 0)} per open day to reach ${fmt(fc.target)}`}
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginTop: 14, height: 46 }}>
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => {
                const max = Math.max(1, ...fc.weekdayAvg);
                const closed = fc.closedWeekdays.includes(i);
                return (
                  <View key={i} style={{ flex: 1, alignItems: 'center' }}>
                    <View style={{ width: '100%', height: Math.max(3, (fc.weekdayAvg[i] / max) * 34), borderRadius: 3, backgroundColor: closed ? '#ffffff22' : c.brandGold }} />
                    <Text style={{ color: '#8A826F', fontSize: 10, marginTop: 3 }}>{d}</Text>
                  </View>
                );
              })}
            </View>
            <Text style={{ color: '#8A826F', fontSize: 10.5, marginTop: 6 }}>Average takings by weekday (last 8 weeks)</Text>
          </Card>
        )}

        {!loading && alerts.length > 0 && (
          <Card style={{ borderLeftWidth: 4, borderLeftColor: alerts.some(a => a.severity === 'high') ? c.danger : c.warning }}>
            <Text style={{ color: c.text, fontWeight: '800', marginBottom: 6 }}>🛡️ Leakage guard</Text>
            {alerts.map(a => (
              <View key={a.id} style={{ marginTop: 6 }}>
                <Text style={{ color: a.severity === 'high' ? c.danger : a.severity === 'medium' ? c.warning : c.info, fontWeight: '800', fontSize: 13 }}>{a.title}</Text>
                <Text style={{ color: c.textMuted, fontSize: 12, lineHeight: 17 }}>{a.detail}</Text>
              </View>
            ))}
          </Card>
        )}

        {!loading && due.length > 0 && (
          <Card>
            <Text style={{ color: c.text, fontWeight: '800' }}>📅 Due back this week ({due.length})</Text>
            <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 2, marginBottom: 6 }}>Based on how often each client usually comes. One message now fills next week’s slots.</Text>
            {(showAllDue ? due : due.slice(0, 6)).map(d => (
              <View key={d.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6, gap: 8 }}>
                <TouchableOpacity style={{ flex: 1 }} onPress={() => navigation.navigate('ClientDetail', { clientId: d.id })}>
                  <Text style={{ color: c.text, fontWeight: '700', fontSize: 13 }} numberOfLines={1}>{d.name}</Text>
                  <Text style={{ color: c.textMuted, fontSize: 11.5 }} numberOfLines={1}>{d.sub}</Text>
                </TouchableOpacity>
                {d.phone && d.message ? (
                  <TouchableOpacity onPress={() => WhatsAppService.sendMessage(d.phone!, d.message!)} style={{ backgroundColor: c.successLight, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 }}>
                    <Text style={{ color: c.success, fontSize: 11.5, fontWeight: '800' }}>Remind</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ))}
            {due.length > 6 && <TouchableOpacity onPress={() => setShowAllDue(v => !v)}><Text style={{ color: c.primary, fontWeight: '800', marginTop: 6 }}>{showAllDue ? 'Show less' : `Show all ${due.length}`}</Text></TouchableOpacity>}
          </Card>
        )}

        {!loading && segs.some(sg => sg.count > 0) && (
          <Card>
            <Text style={{ color: c.text, fontWeight: '800', marginBottom: 10 }}>👥 Your clients, by behaviour</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {segs.filter(sg => sg.count > 0).map(sg => {
                const tone = sg.seg === 'champion' ? c.success : sg.seg === 'loyal' ? c.primary : sg.seg === 'new' ? c.info : sg.seg === 'at_risk' ? c.warning : sg.seg === 'lost' ? c.danger : c.textSecondary;
                return (
                  <View key={sg.seg} style={{ width: '48%', backgroundColor: c.surface, borderRadius: 14, padding: 12 }}>
                    <Text style={{ color: tone, fontWeight: '900', fontSize: 20 }}>{sg.count}</Text>
                    <Text style={{ color: c.text, fontWeight: '800', fontSize: 13 }}>{sg.label}</Text>
                    <Text style={{ color: c.textMuted, fontSize: 11, marginTop: 2 }}>{sg.action}</Text>
                  </View>
                );
              })}
            </View>
            <TouchableOpacity onPress={() => navigation.navigate('AIAssistant')} style={{ marginTop: 10 }}>
              <Text style={{ color: c.primary, fontWeight: '800' }}>Ask Boss AI for a list ›</Text>
            </TouchableOpacity>
          </Card>
        )}

        {loading ? (
          <Text style={{ color: c.textMuted, textAlign: 'center', marginTop: 40 }}>Crunching the numbers…</Text>
        ) : insights.length === 0 ? (
          <View style={{ alignItems: 'center', marginTop: 40, gap: 8 }}>
            <MaterialCommunityIcons name="chart-line" size={36} color={c.textMuted} />
            <Text style={{ color: c.textMuted, fontSize: 13, textAlign: 'center' }}>Nothing to flag right now — check back after a few more days of business.</Text>
          </View>
        ) : (
          insights.map(insight => (
            <View key={insight.id} style={{ marginBottom: 14 }}>
              <Card>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <View style={{ width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: (c as any)[`${insight.tone}Light`] }}>
                    <MaterialCommunityIcons name={insight.icon as any} size={20} color={(c as any)[insight.tone]} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.text, fontSize: 14.5, fontWeight: '800' }}>{insight.title}</Text>
                    <Text style={{ color: c.textMuted, fontSize: 12.5, marginTop: 4, lineHeight: 18 }}>{insight.detail}</Text>
                  </View>
                </View>

                {insight.clients && insight.clients.length > 0 && (
                  <View style={{ marginTop: 12, borderTopWidth: 0.5, borderTopColor: c.divider, paddingTop: 10 }}>
                    {insight.clients.map(cl => (
                      <View key={cl.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6, gap: 8 }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: c.text, fontSize: 13, fontWeight: '700' }} numberOfLines={1}>{cl.name}</Text>
                          <Text style={{ color: c.textMuted, fontSize: 11.5 }}>{fmt(cl.total_spent)} spent · last visit {cl.last_visit ? parseDbDate(cl.last_visit).toLocaleDateString(appLocale()) : 'never'}</Text>
                        </View>
                        <TouchableOpacity onPress={() => winBack(cl)} style={{ backgroundColor: c.successLight, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 }}>
                          <Text style={{ color: c.success, fontSize: 11.5, fontWeight: '800' }}>Message</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}

                {insight.items && insight.items.length > 0 && (
                  <View style={{ marginTop: 12, borderTopWidth: 0.5, borderTopColor: c.divider, paddingTop: 10 }}>
                    {insight.items.slice(0, 5).map(it => (
                      <View key={it.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 5 }}>
                        <Text style={{ color: c.text, fontSize: 12.5, flex: 1 }} numberOfLines={1}>{it.name}</Text>
                        <Pill label={`${it.quantity} ${it.unit}`} tone={it.quantity <= it.min_stock ? 'danger' : 'warning'} />
                      </View>
                    ))}
                  </View>
                )}

                {insight.navigateTo && (
                  <TouchableOpacity
                    onPress={() => navigation.navigate(insight.navigateTo, insight.marketingPrefill ? { prefill: insight.marketingPrefill } : undefined)}
                    style={{ marginTop: 12, alignSelf: 'flex-start' }}>
                    <Text style={{ color: c.primary, fontSize: 12.5, fontWeight: '800' }}>
                      {insight.navigateTo === 'Marketing' ? 'Create a post ›' : 'View ›'}
                    </Text>
                  </TouchableOpacity>
                )}
              </Card>
            </View>
          ))
        )}
      </ScrollView>
    </SafeScreen>
  );
}
