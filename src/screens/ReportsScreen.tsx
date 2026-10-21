import React, { useState, useCallback, useContext } from 'react';
import { View, ScrollView, TouchableOpacity, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { Text } from '../theme/Text';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { TabScreen as SafeScreen } from '../components/SafeScreen';
import { useAuth } from '../context/AuthContext';
import { useTr } from '../i18n/tr';
import { showError } from '../components/formUtils';
import { AppBar, SegmentedTabs, Chip } from '../components/UI';
import { useTheme } from '../context/ThemeContext';
import { AppContext } from '../context/AppContext';
import { DatabaseService } from '../database/Database';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { appLocale } from '../config/regions';

const FS_DOC_DIR = (FileSystem as any).documentDirectory ?? (FileSystem as any).cacheDirectory ?? '';
const FS_UTF8 = (FileSystem as any).EncodingType?.UTF8 ?? 'utf8';

type Period = 'today'|'week'|'month'|'last_month'|'year';
type Tab    = 'overview'|'staff'|'services'|'eod'|'pl';

export default function ReportsScreen() {
  const { colors: c } = useTheme();
  const tr = useTr();
  const { can } = useAuth();
  const canPayroll = can('staff.payroll');
  const canFinancial = can('reports.financial');
  const { currencySymbol } = useContext(AppContext);
  const navigation = useNavigation<any>();
  const [period,  setPeriod]  = useState<Period>('month');
  const [tab,     setTab]     = useState<Tab>('overview');
  const [detailedPL, setDetailedPL] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [pl,   setPL]      = useState({ revenue: 0, expenses: 0, profit: 0 });
  const [staff,setStaff]   = useState<any[]>([]);
  const [svcs, setSvcs]    = useState<any[]>([]);
  const [pay,  setPay]     = useState<any[]>([]);
  const [revByDay, setRevByDay] = useState<any[]>([]);
  const [eod,  setEod]     = useState<any>(null);

  useFocusEffect(useCallback(() => { load(); }, [period]));

  function getRange(p: Period): { start: string; end: string; label: string } {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2,'0');
    const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    const today = fmt(now);
    if (p === 'today') return { start: today, end: today, label: 'Today' };
    if (p === 'week')  { const s = new Date(now); s.setDate(s.getDate()-6); return { start: fmt(s), end: today, label: 'Last 7 Days' }; }
    if (p === 'month') return { start: `${now.getFullYear()}-${pad(now.getMonth()+1)}-01`, end: today, label: 'This Month' };
    if (p === 'last_month') {
      const s = new Date(now.getFullYear(), now.getMonth()-1, 1);
      const e = new Date(now.getFullYear(), now.getMonth(), 0);
      return { start: fmt(s), end: fmt(e), label: 'Last Month' };
    }
    return { start: `${now.getFullYear()}-01-01`, end: today, label: 'This Year' };
  }

  async function load() {
    setLoading(true);
    try {
      const { start, end } = getRange(period);
      // Each section loads on its own — one failing query no longer blanks the report.
      const r = await Promise.allSettled([
        DatabaseService.getPLSummary(start, end),
        DatabaseService.getStaffPerformance(start, end),
        DatabaseService.getTopServices(start, end),
        DatabaseService.getPaymentBreakdown(start, end),
        DatabaseService.getRevenueByDateRange(start, end),
      ]);
      const ok = (i: number) => r[i].status === 'fulfilled' ? (r[i] as PromiseFulfilledResult<any>).value : null;
      if (ok(0)) setPL(ok(0));
      setStaff(ok(1) || []);
      setSvcs(ok(2) || []);
      setPay(ok(3) || []);
      setRevByDay(ok(4) || []);
      if (r.some(x => x.status === 'rejected')) console.warn('Reports: some sections failed', r.filter(x => x.status === 'rejected'));
      // Detailed P&L is available for every period (the P&L tab needs it).
      const detailed = await (DatabaseService as any).getDetailedPLReport(start, end).catch(() => null);
      setDetailedPL(detailed);
      // End-of-day cash report only makes sense for a single day.
      setEod(period === 'today' ? await DatabaseService.getEndOfDayReport(start).catch(() => null) : null);
    } catch (e) { showError(e, 'Could not load report data'); }
    finally { setLoading(false); }
  }

  // NEW: Export full report as CSV (Excel-compatible)
  async function exportToExcel() {
    setExporting(true);
    try {
      const { start, end, label } = getRange(period);
      const csv = await DatabaseService.exportFullReportCSV(start, end, currencySymbol);
      const safePeriod = label.replace(/\s+/g, '_');
      const fileName = `SaloonBossX_Report_${safePeriod}_${start}_${end}.csv`;
      const filePath = FS_DOC_DIR + fileName;
      await FileSystem.writeAsStringAsync(filePath, csv, { encoding: FS_UTF8 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(filePath, {
          mimeType: 'text/csv',
          dialogTitle: `Export Report — ${label}`,
          UTI: 'public.comma-separated-values-text',
        });
      } else {
        Alert.alert(tr('Saved'), tr('Report saved to: {f}', { f: fileName }));
      }
    } catch (e) {
      showError(e, 'Export failed', 'Could not create the report. Please try again.');
    } finally { setExporting(false); }
  }

  const maxRev   = revByDay.reduce((m, d) => Math.max(m, d.revenue || 0), 1);
  const totalPay = pay.reduce((s, p) => s + (p.total || 0), 0) || 1;
  const fmt = (n: number) => `${currencySymbol}${(n || 0).toLocaleString(appLocale(), { maximumFractionDigits: 0 })}`;

  return (
    <SafeScreen>
      <AppBar
        title={tr('Reports')}
        right={
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 13, paddingVertical: 9, borderRadius: 12, backgroundColor: c.success, opacity: exporting ? 0.6 : 1 }}
            onPress={exportToExcel} disabled={exporting}>
            {exporting ? <ActivityIndicator size="small" color={c.onPrimary} /> : <MaterialCommunityIcons name="microsoft-excel" size={16} color={c.onPrimary} />}
            <Text style={{ color: c.onPrimary, fontWeight: '800', fontSize: 12 }}>{tr('Export')}</Text>
          </TouchableOpacity>
        }
      />

      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 12 }}>
        {can('billing.history') && <TouchableOpacity style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 12, backgroundColor: c.surface }}
          onPress={() => navigation.navigate('BillHistory')}>
          <MaterialCommunityIcons name="history" size={15} color={c.primary} />
          <Text style={{ color: c.primary, fontWeight: '800', fontSize: 12.5 }}>{tr('Bill History')}</Text>
        </TouchableOpacity>}
        {can('reports.gst') && <TouchableOpacity style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 12, backgroundColor: c.dangerLight }}
          onPress={() => navigation.navigate('TaxReport')}>
          <MaterialCommunityIcons name="file-certificate-outline" size={15} color={c.danger} />
          <Text style={{ color: c.danger, fontWeight: '800', fontSize: 12.5 }}>{tr('GST Reports')}</Text>
        </TouchableOpacity>}
      </View>

      {/* Period selector */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ paddingHorizontal: 16, marginBottom: 12 }} contentContainerStyle={{ paddingRight: 8 }}>
        {([['today','Today'],['week','7 Days'],['month','This Month'],['last_month','Last Month'],['year','This Year']] as [Period,string][]).map(([k,l]) => (
          <Chip key={k} label={tr(l)} active={period === k} onPress={() => setPeriod(k)} />
        ))}
      </ScrollView>

      {/* Tab selector */}
      <View style={{ paddingHorizontal: 16, marginBottom: 12 }}>
        <SegmentedTabs
          value={tab}
          onChange={(k) => setTab(k as Tab)}
          tabs={[
            { key: 'overview', label: tr('Overview') },
            { key: 'staff', label: tr('Staff') },
            { key: 'services', label: tr('Services') },
            { key: 'eod', label: tr('Day End') },
            ...(canFinancial ? [{ key: 'pl', label: tr('P&L') }] : []),
          ]}
        />
      </View>

      {loading
        ? <ActivityIndicator color={c.primary} style={{ marginTop: 40 }} />
        : (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>

            {/* OVERVIEW */}
            {tab === 'overview' && (<>
              {/* P&L Cards */}
              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
                {[
                  { label: 'Revenue',  val: pl.revenue,  color: c.success },
                  { label: 'Expenses', val: pl.expenses, color: c.danger },
                  { label: 'Profit',   val: pl.profit,   color: pl.profit >= 0 ? c.primary : c.danger },
                ].map(({ label, val, color }) => (
                  <View key={label} style={{ flex: 1, backgroundColor: c.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: c.border, alignItems: 'center' }}>
                    <Text style={{ color: c.textMuted, fontSize: 10.5, fontWeight: '700', textTransform: 'uppercase' }} numberOfLines={1}>{tr(label)}</Text>
                    <Text style={{ color, fontSize: 15, fontWeight: '900', marginTop: 6 }} numberOfLines={1} adjustsFontSizeToFit>
                      {pl.profit < 0 && label === 'Profit' ? '-' : ''}{fmt(Math.abs(val))}
                    </Text>
                  </View>
                ))}
              </View>

              {/* Revenue trend bar chart */}
              {revByDay.length > 0 && (
                <View style={[card, { backgroundColor: c.card, borderColor: c.border }]}>
                  <Text style={[cardTitle, { color: c.textSecondary }]}>{tr('Revenue Trend')}</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 110, paddingTop: 10, gap: 6 }}>
                      {revByDay.map((d: any, i: number) => (
                        <View key={i} style={{ alignItems: 'center', width: 38 }}>
                          <Text style={{ color: c.textMuted, fontSize: 8, marginBottom: 3 }}>
                            {currencySymbol}{Math.round((d.revenue||0)/1000)}k
                          </Text>
                          <View style={{ width: 28, height: Math.max(4, ((d.revenue||0)/maxRev)*82), backgroundColor: c.primary, borderRadius: 6, opacity: 0.88 }} />
                          <Text style={{ color: c.textMuted, fontSize: 9, marginTop: 4 }}>{String(d.date||'').slice(5)}</Text>
                        </View>
                      ))}
                    </View>
                  </ScrollView>
                </View>
              )}

              {/* Payment breakdown */}
              <View style={[card, { backgroundColor: c.card, borderColor: c.border }]}>
                <Text style={[cardTitle, { color: c.textSecondary }]}>{tr('Payment Methods')}</Text>
                {pay.length === 0 && <Text style={{ color: c.textMuted, textAlign: 'center', padding: 12 }}>{tr('No bills in this period')}</Text>}
                {pay.map((p: any, i: number) => (
                  <View key={i} style={{ marginBottom: 12 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                      <Text style={{ color: c.text, fontSize: 13 }}>{p.payment_method?.toUpperCase()} ({tr('{n} bills', { n: p.count })})</Text>
                      <Text style={{ color: c.primary, fontWeight: '700' }}>{fmt(p.total||0)}</Text>
                    </View>
                    <View style={{ height: 6, backgroundColor: c.surface, borderRadius: 3 }}>
                      <View style={{ height: 6, backgroundColor: c.primary, borderRadius: 3, width: `${Math.min(100, ((p.total||0)/totalPay)*100)}%` as any }} />
                    </View>
                  </View>
                ))}
              </View>

              {/* Export hint */}
              <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, backgroundColor: c.successLight, borderRadius: 12, borderWidth: 1, borderColor: c.success + '40' }}
                onPress={exportToExcel} disabled={exporting}>
                <MaterialCommunityIcons name="microsoft-excel" size={22} color={c.success} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.success, fontWeight: '700', fontSize: 14 }}>{tr('Export to Excel / CSV')}</Text>
                  <Text style={{ color: c.textSecondary, fontSize: 12, marginTop: 2 }}>{tr('Full report: revenue, staff, services, expenses')}</Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={20} color={c.success} />
              </TouchableOpacity>
            </>)}

            {/* STAFF */}
            {tab === 'staff' && (
              <View style={[card, { backgroundColor: c.card, borderColor: c.border }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <Text style={[cardTitle, { color: c.textSecondary, marginBottom: 0 }]}>{tr('Staff Performance')}</Text>
                  <TouchableOpacity
                    style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: c.successLight, borderWidth: 1, borderColor: c.success + '40' }}
                    onPress={exportToExcel} disabled={exporting}>
                    <Text style={{ color: c.success, fontSize: 11, fontWeight: '700' }}>{tr('📊 Export')}</Text>
                  </TouchableOpacity>
                </View>
                {staff.length === 0 && <Text style={{ color: c.textMuted, textAlign: 'center', padding: 20 }}>{tr('No staff data for this period')}</Text>}
                {staff.map((st: any, i: number) => (
                  <View key={st.id} style={{ paddingVertical: 14, borderBottomWidth: i < staff.length-1 ? 0.5 : 0, borderBottomColor: c.divider }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: c.primaryLight, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                        <Text style={{ color: c.primary, fontSize: 13, fontWeight: '800' }}>{i+1}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: c.text, fontSize: 14, fontWeight: '700' }}>{st.name}</Text>
                        <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 2 }}>{tr('{n} bills', { n: st.total_bills })}  •  {tr(st.role || '')}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ color: c.success, fontSize: 15, fontWeight: '900' }}>{fmt(st.total_revenue||0)}</Text>
                        {canPayroll && <Text style={{ color: c.primary, fontSize: 11.5, marginTop: 2 }}>{tr('Commission')}: {fmt(st.commission_earned||0)}</Text>}
                      </View>
                    </View>
                    {/* Progress bar showing share */}
                    {staff.length > 0 && staff[0].total_revenue > 0 && (
                      <View style={{ marginTop: 8, height: 4, backgroundColor: c.surface, borderRadius: 2 }}>
                        <View style={{ height: 4, backgroundColor: c.primary, borderRadius: 2, opacity: 0.6, width: `${((st.total_revenue||0)/staff[0].total_revenue)*100}%` as any }} />
                      </View>
                    )}
                  </View>
                ))}
              </View>
            )}

            {/* SERVICES */}
            {tab === 'services' && (
              <View style={[card, { backgroundColor: c.card, borderColor: c.border }]}>
                <Text style={[cardTitle, { color: c.textSecondary }]}>{tr('Top Services by Revenue')}</Text>
                {svcs.length === 0 && <Text style={{ color: c.textMuted, textAlign: 'center', padding: 20 }}>{tr('No service data for this period')}</Text>}
                {svcs.map((sv: any, i: number) => {
                  const maxS = svcs[0]?.revenue || 1;
                  return (
                    <View key={i} style={{ marginBottom: 14 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                        <Text style={{ color: c.text, fontSize: 13, flex: 1, marginRight: 8 }} numberOfLines={1}>
                          {i+1}. {sv.name}
                        </Text>
                        <Text style={{ color: c.primary, fontWeight: '700' }}>{fmt(sv.revenue||0)}</Text>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <View style={{ flex: 1, height: 6, backgroundColor: c.surface, borderRadius: 3 }}>
                          <View style={{ height: 6, backgroundColor: c.primary, borderRadius: 3, width: `${((sv.revenue||0)/maxS)*100}%` as any }} />
                        </View>
                        <Text style={{ color: c.textMuted, fontSize: 11, minWidth: 34, textAlign: 'right' }}>{sv.count}x</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}

            {/* END OF DAY */}
            {tab === 'eod' && period !== 'today' && (
              <View style={{ alignItems: 'center', padding: 40, gap: 14 }}>
                <MaterialCommunityIcons name="calendar-today" size={64} color={c.border} />
                <Text style={{ color: c.textMuted, fontSize: 15, textAlign: 'center' }}>
                  {tr('Select "Today" to view the End-of-Day cash report.')}
                </Text>
                <TouchableOpacity style={{ paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, backgroundColor: c.primaryLight }}
                  onPress={() => setPeriod('today')}>
                  <Text style={{ color: c.primary, fontWeight: '700' }}>{tr('Switch to Today')}</Text>
                </TouchableOpacity>
              </View>
            )}
            {tab === 'eod' && period === 'today' && eod && (<>
              <View style={[card, { backgroundColor: c.card, borderColor: c.border }]}>
                <Text style={[cardTitle, { color: c.textSecondary }]}>{tr('End of Day Summary')} — {eod.date}</Text>
                {[
                  { label: 'Total Revenue',    val: fmt(eod.revenue),   color: c.success },
                  { label: 'Total Bills',       val: String(eod.billCount) },
                  { label: 'Walk-ins',          val: String(eod.walkInCount) },
                  { label: 'Appointments',      val: `${eod.completedAppointments}/${eod.appointmentCount} done` },
                  { label: 'Total Expenses',    val: fmt(eod.expenseTotal), color: c.danger },
                  // Revenue includes UPI, card and dues — so this is not "cash".
                  { label: 'Net (all payment modes)', val: fmt(eod.netCash), color: eod.netCash >= 0 ? c.primary : c.danger },
                  ...(() => {
                    const cash = (eod.paymentBreakdown || []).find((p: any) => String(p.payment_method).toLowerCase() === 'cash');
                    const cashIn = eod.cashCollected ?? cash?.total;
                    return cashIn != null ? [{ label: 'Cash collected', val: fmt(cashIn), color: c.success }] : [];
                  })(),
                ].map(({ label, val, color }: any) => (
                  <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.divider }}>
                    <Text style={{ color: c.textSecondary, fontSize: 13, flex: 1 }}>{tr(label)}</Text>
                    <Text style={{ color: color || c.text, fontSize: 13, fontWeight: '700' }}>{val}</Text>
                  </View>
                ))}
              </View>
              {eod.paymentBreakdown?.length > 0 && (
                <View style={[card, { backgroundColor: c.card, borderColor: c.border }]}>
                  <Text style={[cardTitle, { color: c.textSecondary }]}>{tr('Payment Collection Breakdown')}</Text>
                  {eod.paymentBreakdown.map((p: any, i: number) => (
                    <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.divider }}>
                      <Text style={{ color: c.textSecondary, fontSize: 13 }}>{p.payment_method?.toUpperCase()}</Text>
                      <Text style={{ color: c.text, fontSize: 13, fontWeight: '700' }}>{fmt(p.total||0)} ({tr('{n} bills', { n: p.count })})</Text>
                    </View>
                  ))}
                </View>
              )}
              <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, backgroundColor: c.successLight, borderRadius: 12, borderWidth: 1, borderColor: c.success + '40' }}
                onPress={exportToExcel} disabled={exporting}>
                <MaterialCommunityIcons name="microsoft-excel" size={20} color={c.success} />
                <Text style={{ color: c.success, fontWeight: '700', fontSize: 14 }}>{tr('Export Day Report to Excel')}</Text>
              </TouchableOpacity>
            </>)}

            {/* FIX 9: Detailed P&L Tab */}
            {tab === 'pl' && canFinancial && (<>
              {!detailedPL ? (
                <View style={{ alignItems: 'center', padding: 40 }}>
                  <MaterialCommunityIcons name="chart-line" size={48} color={c.border} />
                  <Text style={{ color: c.textMuted, marginTop: 12 }}>{tr('No data for this period.')}</Text>
                </View>
              ) : (<>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                  {[
                    { label: 'Revenue',      val: detailedPL.revenue,       color: c.success,  isAmt: true },
                    { label: 'Expenses',     val: detailedPL.expenses,      color: c.danger,   isAmt: true },
                    { label: 'Net Profit',   val: detailedPL.grossProfit,   color: detailedPL.grossProfit >= 0 ? c.primary : c.danger, isAmt: true },
                    { label: 'Margin',       val: detailedPL.profitMargin,  color: c.primary,  isAmt: false, suffix: '%' },
                  ].map(({ label, val, color, isAmt, suffix }) => (
                    <View key={label} style={{ flex: 1, minWidth: '44%', backgroundColor: c.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: c.border }}>
                      <Text style={{ color: c.textMuted, fontSize: 10.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 }}>{tr(label)}</Text>
                      <Text style={{ color, fontSize: 16, fontWeight: '900', marginTop: 6 }} numberOfLines={1}>
                        {(val || 0) < 0 && isAmt ? '-' : ''}{isAmt ? fmt(Math.abs(val || 0)) : `${(val || 0).toFixed(1)}${suffix || ''}`}
                      </Text>
                    </View>
                  ))}
                </View>

                <View style={[card, { backgroundColor: c.card, borderColor: c.border }]}>
                  <Text style={[cardTitle, { color: c.textSecondary }]}>{tr('Revenue Breakdown')}</Text>
                  {[
                    { label: 'Services Revenue',   val: detailedPL.serviceRevenue,  color: c.primary },
                    { label: 'Retail Products',     val: detailedPL.productRevenue,  color: c.success },
                    { label: 'Discounts Given',     val: -detailedPL.totalDiscount,  color: c.danger  },
                    { label: 'GST Collected',       val: detailedPL.totalTax,        color: c.warning },
                  ].map(({ label, val, color }) => (
                    <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.divider }}>
                      <Text style={{ color: c.textSecondary, fontSize: 13 }}>{tr(label)}</Text>
                      <Text style={{ color, fontWeight: '700', fontSize: 13 }}>{(val||0) < 0 ? '-' : ''}{fmt(Math.abs(val||0))}</Text>
                    </View>
                  ))}
                </View>

                {(detailedPL.expensesByCategory || []).length > 0 && (
                  <View style={[card, { backgroundColor: c.card, borderColor: c.border }]}>
                    <Text style={[cardTitle, { color: c.textSecondary }]}>{tr('Expenses by Category')}</Text>
                    {detailedPL.expensesByCategory.map((e: any) => (
                      <View key={e.category} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.divider }}>
                        <Text style={{ color: c.textSecondary, fontSize: 13 }}>{e.category} <Text style={{ color: c.textMuted, fontSize: 11 }}>({e.count}x)</Text></Text>
                        <Text style={{ color: c.danger, fontWeight: '700', fontSize: 13 }}>{fmt(e.total||0)}</Text>
                      </View>
                    ))}
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 10 }}>
                      <Text style={{ color: c.text, fontWeight: '800', fontSize: 14 }}>{tr('Total Expenses')}</Text>
                      <Text style={{ color: c.danger, fontWeight: '900', fontSize: 14 }}>{fmt(detailedPL.expenses||0)}</Text>
                    </View>
                  </View>
                )}

                {(detailedPL.revenueByPayment || []).length > 0 && (
                  <View style={[card, { backgroundColor: c.card, borderColor: c.border }]}>
                    <Text style={[cardTitle, { color: c.textSecondary }]}>{tr('Revenue by Payment Method')}</Text>
                    {detailedPL.revenueByPayment.map((p: any) => (
                      <View key={p.payment_method} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.divider }}>
                        <Text style={{ color: c.textSecondary, fontSize: 13 }}>{(p.payment_method||'').toUpperCase()} <Text style={{ color: c.textMuted, fontSize: 11 }}>({p.bills} bills)</Text></Text>
                        <Text style={{ color: c.primary, fontWeight: '700', fontSize: 13 }}>{fmt(p.total||0)}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </>)}
            </>)}
          </ScrollView>
        )
      }
    </SafeScreen>
  );
}

const card      = { borderRadius: 14, padding: 16, marginBottom: 14, borderWidth: 1 } as const;
const cardTitle = { fontSize: 11, fontWeight: '800' as const, textTransform: 'uppercase' as const, letterSpacing: 0.8, marginBottom: 14 };
