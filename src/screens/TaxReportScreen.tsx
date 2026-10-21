import React, { useState, useCallback, useContext } from 'react';
import { View, ScrollView, TouchableOpacity, Alert, ActivityIndicator, StyleSheet } from 'react-native';
import { Text } from '../theme/Text';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeScreen } from '../components/SafeScreen';
import { ScreenHeader } from '../components/UI';
import { csvCell, escapeHtml } from '../utils/sanitize';
import { useTr } from '../i18n/tr';
import { showError, indianFY } from '../components/formUtils';
import { useTheme } from '../context/ThemeContext';
import { AppContext } from '../context/AppContext';
import { DatabaseService } from '../database/Database';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import { appLocale, splitsTax, taxName, taxIdLabel } from '../config/regions';

const FS_DOC_DIR = (FileSystem as any).documentDirectory ?? (FileSystem as any).cacheDirectory ?? '';
const FS_UTF8 = (FileSystem as any).EncodingType?.UTF8 ?? 'utf8';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

/** CSV number cell: plain digits, 2 decimals, no ₹ or thousands separators. */
const num = (n: any) => (Number(n) || 0).toFixed(2);
/** One CSV line: strings are quoted/escaped, numbers written plain. */
const line = (cells: (string | number | null | undefined)[]) =>
  cells.map(v => (typeof v === 'number' ? num(v) : csvCell(v ?? ''))).join(',');

export default function TaxReportScreen({ navigation }: any) {
  const { colors: c } = useTheme();
  const tr = useTr();
  const { currencySymbol } = useContext(AppContext);

  const now = new Date();
  // Indian financial year (April → March) for the Yearly tab.
  const [fyStart, setFyStart] = useState(indianFY(now).startYear);
  const [year,  setYear]  = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [gstOn, setGstOn] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [tab, setTab] = useState<'gstr1'|'gstr3b'|'yearly'>('gstr1');
  const [yearlySummary, setYearlySummary] = useState<any[]>([]);

  const fmt  = (n: number) => `${currencySymbol}${(n || 0).toLocaleString(appLocale(), { maximumFractionDigits: 2 })}`;
  const fmtN = (n: number) => `${(n || 0).toLocaleString(appLocale(), { maximumFractionDigits: 2 })}`;

  useFocusEffect(useCallback(() => { load(); }, [year, month]));

  async function load() {
    DatabaseService.getSetting('gst_enabled').then(v => setGstOn(v === 'true')).catch(() => {});
    setLoading(true);
    try {
      const r = await (DatabaseService as any).getGSTReport(year, month);
      setReport(r);
    } catch (e) { showError(e, 'Could not load GST report'); }
    finally { setLoading(false); }
  }

  /** April of `startYear` → March of the next year; future months skipped. */
  async function loadFY(startYear: number) {
    setLoading(true);
    try {
      const months: [number, number][] = [];
      for (let i = 0; i < 12; i++) {
        const m = ((3 + i) % 12) + 1;           // 4..12, 1..3
        const y = m >= 4 ? startYear : startYear + 1;
        const t = new Date();
        if (y > t.getFullYear() || (y === t.getFullYear() && m > t.getMonth() + 1)) break;
        months.push([y, m]);
      }
      const reports = await Promise.all(months.map(([y, m]) => (DatabaseService as any).getGSTReport(y, m).catch(() => null)));
      setYearlySummary(reports.filter(Boolean).map((r: any) => ({ month: r.period?.label || '', ...r.summary })));
    } catch (e) { showError(e, 'Could not load yearly GST'); }
    finally { setLoading(false); }
  }
  const fyLabel = `FY ${fyStart}-${String((fyStart + 1) % 100).padStart(2, '0')}`;

  async function exportGSTR1() {
    if (!report) return;
    setExporting(true);
    try {
      const { summary, bills, salon, period, taxRate } = report;
      const rows: string[] = [
        line([`GSTR-1 Summary — ${period.label}`]),
        line(['Salon', salon?.name || '']),
        line([taxIdLabel(), salon?.gst_number || 'Not registered']),
        line(['Period', `${period.start} to ${period.end}`]),
        '',
        line(['SUMMARY']),
        line(['Total Bills', String(summary.totalBills ?? 0)]),
        line(['Total Revenue', Number(summary.totalRevenue || 0)]),
        line(['Taxable Value', Number(summary.totalTaxableValue || 0)]),
        ...(splitsTax() ? [line(['CGST Collected', Number(summary.totalCGST || 0)]), line(['SGST Collected', Number(summary.totalSGST || 0)])] : []),
        line([`Total ${taxName()}`, Number(summary.totalTaxCollected || 0)]),
        '',
        line(['BILL-WISE DETAILS']),
        line(['Bill No', 'Date', 'Client', 'Taxable Value', ...(splitsTax() ? [`CGST @${taxRate / 2}%`, `SGST @${taxRate / 2}%`] : []), `Total ${taxName()} @${taxRate}%`, 'Grand Total', 'Payment']),
        ...bills.map((b: any) => line([
          String(b.bill_number ?? ''), String(b.date ?? ''), String(b.client ?? ''),
          Number(b.taxable_value || 0), ...(splitsTax() ? [Number(b.cgst || 0), Number(b.sgst || 0)] : []), Number(b.total_tax || 0), Number(b.total || 0),
          String(b.payment ?? ''),
        ])),
      ];
      // BOM so Excel opens Hindi / Marathi names correctly.
      const csv = '\uFEFF' + rows.join('\r\n');

      const fileName = `${splitsTax() ? 'GSTR1' : 'TaxReport'}_${period.label.replace(/\s/g,'_')}_${year}.csv`;
      const path = FS_DOC_DIR + fileName;
      await FileSystem.writeAsStringAsync(path, csv, { encoding: FS_UTF8 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, { mimeType: 'text/csv', dialogTitle: `GSTR-1 Export — ${period.label}` });
      }
    } catch (e) { showError(e, 'Export failed'); }
    finally { setExporting(false); }
  }

  async function exportGSTR1PDF() {
    if (!report) return;
    setExporting(true);
    try {
      const html = buildGSTR1HTML(report, currencySymbol);
      const { uri } = await Print.printToFileAsync({ html });
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `GSTR-1 Report — ${report.period.label}` });
    } catch (e) { showError(e, 'Export failed'); }
    finally { setExporting(false); }
  }

  function buildGSTR1HTML(report: any, sym: string) {
    const { summary, bills, salon, period, taxRate } = report;
    const rows = bills.map((b: any) => `
      <tr>
        <td>${escapeHtml(b.bill_number)}</td>
        <td>${escapeHtml(b.date)}</td>
        <td>${escapeHtml(b.client)}</td>
        <td style="text-align:right">${sym}${b.taxable_value?.toFixed(2)}</td>
        <td style="text-align:right">${sym}${b.cgst?.toFixed(2)}</td>
        <td style="text-align:right">${sym}${b.sgst?.toFixed(2)}</td>
        <td style="text-align:right"><strong>${sym}${b.total?.toFixed(2)}</strong></td>
        <td>${escapeHtml(b.payment)}</td>
      </tr>
    `).join('');

    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
      body{font-family:Arial,sans-serif;font-size:12px;color:#333;padding:20px}
      h1{color:#1a1a2e;font-size:20px;margin-bottom:4px}
      .subtitle{color:#888;font-size:13px;margin-bottom:20px}
      .info-row{display:flex;gap:40px;margin-bottom:20px;background:#f9f9f9;padding:12px;border-radius:8px}
      .info-item{flex:1}
      .info-label{color:#888;font-size:11px;text-transform:uppercase;letter-spacing:0.5px}
      .info-value{font-weight:bold;font-size:14px;margin-top:2px}
      .summary-grid{display:flex;gap:12px;margin-bottom:24px;flex-wrap:wrap}
      .summary-card{flex:1;min-width:140px;background:#fdf3ea;border-radius:8px;padding:12px;border-left:3px solid #A84F18}
      .summary-amount{font-size:18px;font-weight:900;color:#1a1a2e}
      .summary-label{font-size:11px;color:#888;margin-top:2px}
      table{width:100%;border-collapse:collapse;margin-top:16px}
      th{background:#1a1a2e;color:white;padding:8px;text-align:left;font-size:11px}
      td{padding:8px;border-bottom:1px solid #eee;font-size:12px}
      tr:hover{background:#f9f9f9}
      .footer{margin-top:24px;text-align:center;color:#aaa;font-size:11px;border-top:1px solid #eee;padding-top:12px}
      .total-row td{font-weight:bold;background:#fdf3ea}
    </style></head><body>
    <h1>GSTR-1 — ${escapeHtml(salon?.name || 'Salon')}</h1>
    <div class="subtitle">Outward Supplies Detail — ${period.label}</div>

    <div class="info-row">
      <div class="info-item">
        <div class="info-label">GSTIN</div>
        <div class="info-value">${escapeHtml(salon?.gst_number || 'Not Registered')}</div>
      </div>
      <div class="info-item">
        <div class="info-label">Period</div>
        <div class="info-value">${period.start} to ${period.end}</div>
      </div>
      <div class="info-item">
        <div class="info-label">${taxName()} Rate</div>
        <div class="info-value">${splitsTax() ? `${taxRate}% (CGST ${taxRate/2}% + SGST ${taxRate/2}%)` : `${taxRate}%`}</div>
      </div>
    </div>

    <div class="summary-grid">
      <div class="summary-card">
        <div class="summary-amount">${sym}${summary.totalTaxableValue?.toFixed(2)}</div>
        <div class="summary-label">Taxable Value</div>
      </div>
      <div class="summary-card" style="border-left-color:#10B981">
        <div class="summary-amount" style="color:#10B981">${sym}${summary.totalCGST?.toFixed(2)}</div>
        <div class="summary-label">${splitsTax() ? 'CGST Collected' : `${taxName()} (½)`}</div>
      </div>
      <div class="summary-card" style="border-left-color:#F59E0B">
        <div class="summary-amount" style="color:#F59E0B">${sym}${summary.totalSGST?.toFixed(2)}</div>
        <div class="summary-label">${splitsTax() ? 'SGST Collected' : `${taxName()} (½)`}</div>
      </div>
      <div class="summary-card" style="border-left-color:#EF4444">
        <div class="summary-amount" style="color:#EF4444">${sym}${summary.totalTaxCollected?.toFixed(2)}</div>
        <div class="summary-label">Total Tax to File</div>
      </div>
    </div>

    <table>
      <thead><tr>
        <th>Bill No</th><th>Date</th><th>Customer</th>
        <th>Taxable</th><th>${splitsTax() ? 'CGST' : `${taxName()} ½`}</th><th>${splitsTax() ? 'SGST' : `${taxName()} ½`}</th><th>Total</th><th>Payment</th>
      </tr></thead>
      <tbody>${rows}
      <tr class="total-row">
        <td colspan="3"><strong>TOTALS</strong></td>
        <td style="text-align:right"><strong>${sym}${summary.totalTaxableValue?.toFixed(2)}</strong></td>
        <td style="text-align:right"><strong>${sym}${summary.totalCGST?.toFixed(2)}</strong></td>
        <td style="text-align:right"><strong>${sym}${summary.totalSGST?.toFixed(2)}</strong></td>
        <td style="text-align:right"><strong>${sym}${summary.totalRevenue?.toFixed(2)}</strong></td>
        <td></td>
      </tr>
      </tbody>
    </table>

    <div class="footer">
      Generated by SaloonBossX • For reference only. Verify with a qualified CA before filing.
    </div>
    </body></html>`;
  }

  return (
    <SafeScreen>
      <ScreenHeader title={tr('GST Tax Reports')} onBack={() => navigation.goBack()}
        right={exporting
          ? <ActivityIndicator color={c.primary} />
          : tab === 'yearly' ? undefined : (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity style={{ backgroundColor: c.successLight, borderRadius: 10, padding: 8 }} onPress={exportGSTR1} accessibilityLabel={tr('Export CSV')}>
                <MaterialCommunityIcons name="microsoft-excel" size={20} color={c.success} />
              </TouchableOpacity>
              <TouchableOpacity style={{ backgroundColor: c.dangerLight, borderRadius: 10, padding: 8 }} onPress={exportGSTR1PDF} accessibilityLabel={tr('Export PDF')}>
                <MaterialCommunityIcons name="file-pdf-box" size={20} color={c.danger} />
              </TouchableOpacity>
            </View>
          )
        } />

      {/* Month/Year picker (FY picker on the Yearly tab) */}
      {tab === 'yearly' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 10 }}>
          <TouchableOpacity onPress={() => { const y = fyStart - 1; setFyStart(y); loadFY(y); }} style={{ padding: 8 }} accessibilityLabel={tr('Previous year')}>
            <MaterialCommunityIcons name="chevron-left" size={24} color={c.text} />
          </TouchableOpacity>
          <View style={{ alignItems: 'center', minWidth: 170 }}>
            <Text style={{ color: c.text, fontWeight: '800', fontSize: 15 }}>{fyLabel}</Text>
            <Text style={{ color: c.textMuted, fontSize: 11.5 }}>{tr('April {a} – March {b}', { a: fyStart, b: fyStart + 1 })}</Text>
          </View>
          <TouchableOpacity disabled={fyStart >= indianFY().startYear} onPress={() => { const y = fyStart + 1; setFyStart(y); loadFY(y); }} style={{ padding: 8, opacity: fyStart >= indianFY().startYear ? 0.3 : 1 }} accessibilityLabel={tr('Next year')}>
            <MaterialCommunityIcons name="chevron-right" size={24} color={c.text} />
          </TouchableOpacity>
        </View>
      ) : (
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 10 }}>
        <TouchableOpacity onPress={() => setYear(y => y - 1)} style={{ padding: 8 }}>
          <MaterialCommunityIcons name="chevron-left" size={24} color={c.text} />
        </TouchableOpacity>
        <Text style={{ color: c.text, fontWeight: '800', fontSize: 15, minWidth: 40, textAlign: 'center' }}>{year}</Text>
        <TouchableOpacity onPress={() => { const currentYear = new Date().getFullYear(); setYear(y => Math.min(y + 1, currentYear)); }} style={{ padding: 8 }}>
          <MaterialCommunityIcons name="chevron-right" size={24} color={c.text} />
        </TouchableOpacity>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
          {MONTHS.map((m, i) => {
              const now = new Date();
              const isFuture = year > now.getFullYear() || (year === now.getFullYear() && i + 1 > now.getMonth() + 1);
              return (
                <TouchableOpacity key={m}
                  style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, marginRight: 6, backgroundColor: month === i+1 ? c.primary : c.surface, borderWidth: 1, borderColor: month === i+1 ? c.primary : c.border, opacity: isFuture ? 0.3 : 1 }}
                  onPress={() => { if (!isFuture) setMonth(i+1); }}
                  disabled={isFuture}>
                  <Text style={{ color: month === i+1 ? c.onPrimary : c.textMuted, fontWeight: '700', fontSize: 12 }}>{tr(m.slice(0,3))}</Text>
                </TouchableOpacity>
              );
            })}
        </ScrollView>
      </View>
      )}

      {/* Tab bar */}
      <View style={{ flexDirection: 'row', marginHorizontal: 16, marginBottom: 12, backgroundColor: c.surface, borderRadius: 12, padding: 4 }}>
        {((splitsTax() ? [['gstr1','📋 GSTR-1'],['gstr3b','📊 GSTR-3B'],['yearly','📅 FY']] : [['gstr1',`📋 ${tr('Monthly')}`],['yearly',`📅 ${tr('Yearly')}`]]) as ReadonlyArray<readonly ['gstr1'|'gstr3b'|'yearly', string]>).map(([k,l]) => (
          <TouchableOpacity key={k} style={{ flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center', backgroundColor: tab===k ? c.card : 'transparent' }}
            onPress={() => { setTab(k); if (k === 'yearly') loadFY(fyStart); }}>
            <Text style={{ color: tab===k ? c.primary : c.textMuted, fontWeight: '700', fontSize: 12 }}>{l}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? <ActivityIndicator color={c.primary} style={{ marginTop: 40 }} /> : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>

          {/* GSTR-1 */}
          {tab === 'gstr1' && report && (
            <>
              {!gstOn && (
                <View style={{ backgroundColor: c.infoLight, borderRadius: 12, padding: 12, marginBottom: 12 }}>
                  <Text style={{ color: c.info, fontSize: 13, fontWeight: '600' }}>{tr('GST is turned off for this salon. New bills carry no GST; this report only shows older GST bills, if any.')}</Text>
                </View>
              )}
              {/* Salon info */}
              <View style={{ backgroundColor: c.card, borderRadius: 14, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: c.border }}>
                <Text style={{ color: c.text, fontWeight: '800', fontSize: 16 }}>{report.salon?.name || 'Salon'}</Text>
                <Text style={{ color: report.salon?.gst_number ? c.primary : (gstOn ? c.danger : c.textMuted), fontSize: 13, marginTop: 4, fontWeight: '600' }}>
                  {taxIdLabel()}: {report.salon?.gst_number || (gstOn ? `⚠️ ${tr('Not registered — add GSTIN in Settings')}` : tr('Not registered'))}
                </Text>
                <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 2 }}>{splitsTax() ? `GST Rate: ${report.taxRate}% (CGST ${report.taxRate/2}% + SGST ${report.taxRate/2}%)` : `${taxName()} rate: ${report.taxRate}%`}</Text>
              </View>

              {/* Summary cards */}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
                {[
                  { label: 'Total Bills', val: report.summary.totalBills, color: c.primary, icon: 'receipt' },
                  { label: 'Taxable Value', val: fmt(report.summary.totalTaxableValue), color: c.text, icon: 'cash' },
                  ...(splitsTax() ? [{ label: 'CGST', val: fmt(report.summary.totalCGST), color: c.success, icon: 'percent' },
                  { label: 'SGST', val: fmt(report.summary.totalSGST), color: c.warning, icon: 'percent' }] : []),
                  { label: `Total ${taxName()}`, val: fmt(report.summary.totalTaxCollected), color: c.danger, icon: 'cash-check' },
                  { label: 'Total Revenue', val: fmt(report.summary.totalRevenue), color: c.primary, icon: 'trending-up' },
                ].map(({ label, val, color, icon }) => (
                  <View key={label} style={{ flex: 1, minWidth: '44%', backgroundColor: c.card, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: c.border }}>
                    <MaterialCommunityIcons name={icon as any} size={18} color={color} />
                    <Text style={{ color, fontWeight: '900', fontSize: 16, marginTop: 4 }}>{String(val)}</Text>
                    <Text style={{ color: c.textMuted, fontSize: 11, marginTop: 2 }}>{label}</Text>
                  </View>
                ))}
              </View>

              {/* Bill list */}
              <Text style={{ color: c.textMuted, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 }}>
                {tr('Bill-wise detail')} ({report.bills.length})
              </Text>
              {report.bills.map((bill: any) => (
                <View key={bill.bill_number} style={{ backgroundColor: c.card, borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: c.border }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: c.text, fontWeight: '700', fontSize: 14 }}>#{bill.bill_number}</Text>
                    <Text style={{ color: c.primary, fontWeight: '800', fontSize: 14 }}>{fmt(bill.total)}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                    <Text style={{ color: c.textMuted, fontSize: 12 }}>{bill.date} • {bill.client}</Text>
                    <Text style={{ color: c.textMuted, fontSize: 12, textTransform: 'capitalize' }}>{bill.payment}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 12, marginTop: 6 }}>
                    <Text style={{ color: c.textMuted, fontSize: 11 }}>Taxable: {fmt(bill.taxable_value)}</Text>
                    {splitsTax() ? <>
                    <Text style={{ color: c.success, fontSize: 11 }}>CGST: {fmt(bill.cgst)}</Text>
                    <Text style={{ color: c.warning, fontSize: 11 }}>SGST: {fmt(bill.sgst)}</Text></>
                    : <Text style={{ color: c.success, fontSize: 11 }}>{taxName()}: {fmt((Number(bill.cgst) || 0) + (Number(bill.sgst) || 0))}</Text>}
                  </View>
                </View>
              ))}
              {report.bills.length === 0 && (
                <View style={{ alignItems: 'center', padding: 40 }}>
                  <MaterialCommunityIcons name="receipt-text-outline" size={48} color={c.border} />
                  <Text style={{ color: c.textMuted, fontSize: 15, marginTop: 12 }}>{tr('No bills for {m} {y}', { m: tr(MONTHS[month-1]), y: year })}</Text>
                </View>
              )}
            </>
          )}

          {/* GSTR-3B summary */}
          {tab === 'gstr3b' && splitsTax() && report && (
            <>
              <View style={{ backgroundColor: c.primaryLight, borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: c.primary + '40' }}>
                <Text style={{ color: c.primary, fontWeight: '800', fontSize: 15 }}>GSTR-3B Summary</Text>
                <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 2 }}>{report.period.label} — For reference only</Text>
              </View>

              {/* Table 3.1 - Outward Supplies */}
              <View style={{ backgroundColor: c.card, borderRadius: 14, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: c.border }}>
                <Text style={{ color: c.text, fontWeight: '800', fontSize: 14, marginBottom: 12 }}>3.1 Outward Taxable Supplies</Text>
                {[
                  ['B2C (Consumer/Walk-in)', report.summary.b2cTotal, report.summary.totalCGST, report.summary.totalSGST],
                  ['B2B (Business clients)', report.summary.b2bTotal, 0, 0],
                ].map(([label, taxable, cgst, sgst]) => (
                  <View key={label as string} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.divider }}>
                    <Text style={{ color: c.textSecondary, fontSize: 13, flex: 2 }}>{label as string}</Text>
                    <Text style={{ color: c.text, fontSize: 13, fontWeight: '600', flex: 1, textAlign: 'right' }}>{fmt(taxable as number)}</Text>
                    <Text style={{ color: c.success, fontSize: 13, fontWeight: '600', flex: 1, textAlign: 'right' }}>{fmt(cgst as number)}</Text>
                    <Text style={{ color: c.warning, fontSize: 13, fontWeight: '600', flex: 1, textAlign: 'right' }}>{fmt(sgst as number)}</Text>
                  </View>
                ))}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 10 }}>
                  <Text style={{ color: c.text, fontWeight: '800', flex: 2 }}>Total</Text>
                  <Text style={{ color: c.primary, fontWeight: '900', flex: 1, textAlign: 'right' }}>{fmt(report.summary.totalTaxableValue)}</Text>
                  <Text style={{ color: c.success, fontWeight: '900', flex: 1, textAlign: 'right' }}>{fmt(report.summary.totalCGST)}</Text>
                  <Text style={{ color: c.warning, fontWeight: '900', flex: 1, textAlign: 'right' }}>{fmt(report.summary.totalSGST)}</Text>
                </View>
              </View>

              {/* Tax payable */}
              <View style={{ backgroundColor: c.dangerLight, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: c.danger + '40' }}>
                <Text style={{ color: c.danger, fontWeight: '800', fontSize: 14, marginBottom: 8 }}>Tax Payable (Section 6)</Text>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                  <Text style={{ color: c.textSecondary, fontSize: 14 }}>CGST Payable</Text>
                  <Text style={{ color: c.danger, fontWeight: '800', fontSize: 16 }}>{fmt(report.summary.totalCGST)}</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
                  <Text style={{ color: c.textSecondary, fontSize: 14 }}>SGST Payable</Text>
                  <Text style={{ color: c.danger, fontWeight: '800', fontSize: 16 }}>{fmt(report.summary.totalSGST)}</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 10, borderTopWidth: 1, borderTopColor: c.danger + '40' }}>
                  <Text style={{ color: c.danger, fontWeight: '900', fontSize: 16 }}>Total Tax Due</Text>
                  <Text style={{ color: c.danger, fontWeight: '900', fontSize: 22 }}>{fmt(report.summary.totalTaxCollected)}</Text>
                </View>
              </View>

              <View style={{ marginTop: 16, backgroundColor: c.warningLight, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: c.warning + '40' }}>
                <Text style={{ color: c.warning, fontSize: 12, fontWeight: '600' }}>
                  ⚠️ {tr('Important: This is a simplified summary for reference. Please consult a qualified CA/tax professional and use the government GST portal (gst.gov.in) for actual filing.')}
                </Text>
              </View>
            </>
          )}

          {/* YEARLY */}
          {tab === 'yearly' && (
            <>
              <Text style={{ color: c.textMuted, fontSize: 13, marginBottom: 16 }}>{tr('GST summary for {fy} (April – March)', { fy: fyLabel })}</Text>
              {yearlySummary.length === 0 && <Text style={{ color: c.textMuted, textAlign: 'center', marginTop: 30 }}>{tr('No bills in this financial year yet.')}</Text>}
              {yearlySummary.map((ms: any) => (
                <View key={ms.month} style={{ backgroundColor: c.card, borderRadius: 12, padding: 14, marginBottom: 8, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: c.border }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.text, fontWeight: '700', fontSize: 14 }}>{ms.month}</Text>
                    <Text style={{ color: c.textMuted, fontSize: 12 }}>{tr('{n} bills', { n: ms.totalBills || 0 })} • {tr('Taxable')}: {fmt(ms.totalTaxableValue)}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ color: c.danger, fontWeight: '900', fontSize: 15 }}>{fmt(ms.totalTaxCollected)}</Text>
                    <Text style={{ color: c.textMuted, fontSize: 11 }}>{tr('Tax')}</Text>
                  </View>
                </View>
              ))}
              {yearlySummary.length > 0 && (
                <View style={{ backgroundColor: c.primaryLight, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: c.primary + '40', marginTop: 8 }}>
                  <Text style={{ color: c.primary, fontWeight: '800', fontSize: 15 }}>{tr('{fy} total GST', { fy: fyLabel })}</Text>
                  <Text style={{ color: c.primary, fontWeight: '900', fontSize: 26, marginTop: 4 }}>
                    {fmt(yearlySummary.reduce((s: number, m: any) => s + (m.totalTaxCollected || 0), 0))}
                  </Text>
                  <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 4 }}>
                    {tr('Revenue')}: {fmt(yearlySummary.reduce((s: number, m: any) => s + (m.totalRevenue || 0), 0))}
                  </Text>
                </View>
              )}
            </>
          )}
        </ScrollView>
      )}
    </SafeScreen>
  );
}

