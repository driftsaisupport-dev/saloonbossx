import React, { useState, useEffect, useContext, useCallback } from 'react';
import { View, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { Text } from '../theme/Text';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeScreen } from '../components/SafeScreen';
import { ScreenHeader, Button, EmptyState } from '../components/UI';
import { useAuth } from '../context/AuthContext';
import { useTr } from '../i18n/tr';
import { showError } from '../components/formUtils';
import { escapeHtml } from '../utils/sanitize';
import { useTheme } from '../context/ThemeContext';
import { AppContext } from '../context/AppContext';
import { DatabaseService } from '../database/Database';
import { WhatsAppService } from '../services/WhatsAppService';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { appLocale } from '../config/regions';

/**
 * The salary rows that make up TOTAL — shared by the screen and the PDF so
 * the two always agree and always add up (was: base salary + full commission
 * shown on screen while the total was prorated).
 */
function payRows(slip: any, t: (s: string, v?: any) => string = (x, v) => (v ? x.replace(/\{(\w+)\}/g, (_, k) => String(v[k])) : x)): { label: string; amount: number }[] {
  const type = slip.salaryType || 'commission';
  const total = Math.round(Number(slip.totalPay ?? slip.calculatedSalary ?? 0));
  const commission = Math.round(Number(slip.performance?.commission || 0));
  const eff = Number(slip.attendance?.effectiveDays ?? slip.attendance?.present ?? 0).toFixed(1);
  const wd = slip.attendance?.workingDaysInMonth || '--';
  const rate = slip.staff?.commission_rate ?? 0;
  const prorLabel = t('Salary for {e} / {w} days', { e: eff, w: wd });
  const commLabel = t('Commission ({r}%)', { r: rate });
  if (type === 'fixed') return [{ label: prorLabel, amount: total }];
  if (type === 'commission') return [{ label: commLabel, amount: total }];
  return [
    { label: prorLabel, amount: total - commission },
    { label: commLabel, amount: commission },
  ];
}

export default function StaffPaySlipScreen({ navigation, route }: any) {
  const { colors: c } = useTheme();
  const tr = useTr();
  const { currencySymbol } = useContext(AppContext);
  const { user, can } = useAuth();
  // Managers who hold payroll access may see everyone's slip; anyone else
  // (e.g. a stylist checking their own pay) is locked to their linked staffId.
  const isManager = !!user?.isOwner || (can('staff.manage') && can('staff.payroll'));
  const ownStaffId = user?.staffId || 0;
  const [staff, setStaff] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [slip, setSlip] = useState<any>(null);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(false);
  const [listLoaded, setListLoaded] = useState(false);
  const [busy, setBusy] = useState<'' | 'pdf' | 'wa'>('');

  const fmt = (n: number) => `${currencySymbol}${(n || 0).toLocaleString(appLocale(), { maximumFractionDigits: 0 })}`;

  useEffect(() => {
    DatabaseService.getStaff().then(s => {
      const all = (s as any[]) || [];
      const list = isManager ? all : all.filter(x => x.id === ownStaffId);
      setStaff(list);
      const want = Number(route?.params?.staffId) || 0;
      const pre = list.find(x => x.id === want) || list[0] || null;
      setSelected(pre);
    }).catch(e => showError(e, 'Could not load staff'))
      .finally(() => setListLoaded(true));
  }, [isManager, ownStaffId, route?.params?.staffId]);

  const loadSlip = useCallback(async () => {
    if (!selected) return;
    if (!isManager && selected.id !== ownStaffId) return;
    setLoading(true);
    try {
      const data = await (DatabaseService as any).getStaffPaySlipV3(selected.id, year, month);
      setSlip(data);
    } catch (e) { setSlip(null); showError(e, 'Could not load pay slip'); }
    finally { setLoading(false); }
  }, [selected, year, month, isManager, ownStaffId]);

  useEffect(() => { loadSlip(); }, [loadSlip]);

  async function sharePDF() {
    if (!slip || busy) return;
    setBusy('pdf');
    try {
      const salonProfile: any = await DatabaseService.getSalonProfile();
      const html = buildPaySlipHTML(slip, salonProfile, currencySymbol);
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `Pay Slip — ${slip.staff?.name}` });
    } catch (e) { showError(e, 'PDF not created', 'Could not create the PDF. Check that the phone has free storage.'); }
    finally { setBusy(''); }
  }

  async function sendViaWhatsApp() {
    if (!slip || busy) return;
    if (!slip.staff?.phone) { Alert.alert(tr('No phone'), tr('No phone number for this staff member.')); return; }
    setBusy('wa');
    try {
      const salaryTypeLabels: Record<string, string> = { fixed: 'Fixed', commission: 'Commission', hybrid: 'Fixed + Commission' };
      const salaryTypeLabel = salaryTypeLabels[slip.salaryType || 'commission'] || 'Commission';
      const rows = payRows(slip).map(r => `${r.label}: ${fmt(r.amount)}`).join('\n');
      const msg = `*Pay Slip — ${slip.period.label}*\n\n` +
        `Name: ${slip.staff.name}\nRole: ${slip.staff.role}\nSalary Type: ${salaryTypeLabel}\n\n` +
        `*Performance*\nBills: ${slip.performance.bills}\nRevenue Generated: ${fmt(slip.performance.revenue)}\n\n` +
        `*Attendance*\nPresent: ${slip.attendance.present} days\nHalf Day: ${slip.attendance.half_day || 0} days\nAbsent: ${slip.attendance.absent || 0} days\nEffective Days: ${slip.attendance.effectiveDays || slip.attendance.present} of ${slip.attendance.workingDaysInMonth || '—'} working days\n\n` +
        `*Salary*\n${rows}\n*Total Payable: ${fmt(slip.totalPay)}*\n\n` +
        `_Generated by SaloonBossX_`;
      await Promise.resolve(WhatsAppService.sendMessage(slip.staff.phone, msg));
    } catch (e) { showError(e, 'WhatsApp did not open'); }
    finally { setBusy(''); }
  }

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const now = new Date();
  const atCurrentMonth = year > now.getFullYear() || (year === now.getFullYear() && month >= now.getMonth() + 1);

  return (
    <SafeScreen>
      <ScreenHeader title={tr('Pay slip')} onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
        {listLoaded && staff.length === 0 ? (
          <EmptyState icon="account-cash-outline" title={isManager ? tr('No staff added yet') : tr('Your login is not linked to a staff profile')}
            subtitle={isManager ? tr('Add staff first, then their pay slips appear here.') : tr('Ask the owner to link your login to your staff profile in Users & Access.')} />
        ) : null}

        {isManager && staff.length > 0 && (<>
          <Text style={{ color: c.textMuted, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>{tr('Select staff')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
            {staff.map(s => {
              const on = selected?.id === s.id;
              return (
                <TouchableOpacity key={s.id}
                  style={{ paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, marginRight: 8, borderWidth: 1.5, backgroundColor: on ? c.primary : c.surface, borderColor: on ? c.primary : c.border }}
                  onPress={() => setSelected(s)}>
                  <Text style={{ color: on ? c.onPrimary : c.textSecondary, fontWeight: '700', fontSize: 13 }}>{s.name}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </>)}

        {staff.length > 0 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <TouchableOpacity style={{ padding: 10, borderRadius: 10, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }} accessibilityLabel={tr('Previous month')}
              onPress={() => { let m = month - 1; let y = year; if (m < 1) { m = 12; y--; } setMonth(m); setYear(y); }}>
              <MaterialCommunityIcons name="chevron-left" size={20} color={c.primary} />
            </TouchableOpacity>
            <View style={{ flex: 1, backgroundColor: c.card, borderRadius: 12, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: c.border }}>
              <Text style={{ color: c.text, fontSize: 15, fontWeight: '800' }}>{tr(monthNames[month - 1])} {year}</Text>
            </View>
            <TouchableOpacity style={{ padding: 10, borderRadius: 10, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, opacity: atCurrentMonth ? 0.4 : 1 }} disabled={atCurrentMonth} accessibilityLabel={tr('Next month')}
              onPress={() => { let m = month + 1; let y = year; if (m > 12) { m = 1; y++; } setMonth(m); setYear(y); }}>
              <MaterialCommunityIcons name="chevron-right" size={20} color={c.primary} />
            </TouchableOpacity>
          </View>
        )}

        {slip && !loading && (<>
          <View style={{ backgroundColor: c.card, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: c.border, marginBottom: 14 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, paddingBottom: 16, borderBottomWidth: .5, borderBottomColor: c.divider, gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.text, fontSize: 18, fontWeight: '900' }}>{slip.staff?.name}</Text>
                <Text style={{ color: c.textMuted, fontSize: 13, marginTop: 2 }}>{tr(slip.staff?.role || '')}  •  {slip.period?.label}</Text>
              </View>
              <View style={{ backgroundColor: c.primaryLight, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 }}>
                <Text style={{ color: c.primary, fontWeight: '800', fontSize: 13 }}>{tr('PAY SLIP')}</Text>
              </View>
            </View>

            <Text style={{ color: c.textMuted, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 }}>{tr('Performance')}</Text>
            {[
              { label: tr('Bills processed'), val: String(slip.performance.bills) },
              { label: tr('Revenue generated'), val: fmt(slip.performance.revenue) },
              { label: `${tr('Commission earned')} (${slip.staff?.commission_rate ?? 0}%)`, val: fmt(slip.performance.commission) },
            ].map(({ label, val }) => (
              <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: .5, borderBottomColor: c.divider }}>
                <Text style={{ color: c.textSecondary, fontSize: 13, flex: 1 }}>{label}</Text>
                <Text style={{ color: c.text, fontSize: 13, fontWeight: '700' }}>{val}</Text>
              </View>
            ))}

            <Text style={{ color: c.textMuted, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 16, marginBottom: 10 }}>{tr('Attendance')}</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 6 }}>
              {[
                { label: tr('Present'), val: slip.attendance.present, color: c.success },
                { label: tr('Half day'), val: slip.attendance.half_day || 0, color: c.warning },
                { label: tr('Absent'), val: slip.attendance.absent || 0, color: c.danger },
                { label: tr('Leave'), val: slip.attendance.leave || 0, color: c.info },
              ].map(({ label, val, color }) => (
                <View key={label} style={{ flex: 1, alignItems: 'center', backgroundColor: c.surface, borderRadius: 10, padding: 10 }}>
                  <Text style={{ color, fontSize: 18, fontWeight: '900' }}>{val}</Text>
                  <Text style={{ color: c.textMuted, fontSize: 11, marginTop: 2 }} numberOfLines={1} adjustsFontSizeToFit>{label}</Text>
                </View>
              ))}
            </View>
            <Text style={{ color: c.textMuted, fontSize: 11.5, marginBottom: 16 }}>
              {tr('{e} effective of {w} working days', { e: Number(slip.attendance.effectiveDays ?? slip.attendance.present ?? 0).toFixed(1), w: slip.attendance.workingDaysInMonth || '--' })}
            </Text>

            <Text style={{ color: c.textMuted, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>{tr('Salary breakdown')}</Text>
            {slip.salaryType !== 'commission' && (
              <Text style={{ color: c.textMuted, fontSize: 12, marginBottom: 6 }}>{tr('Monthly base salary')}: {fmt(slip.salary)}</Text>
            )}
            {payRows(slip, tr).map(({ label, amount }) => (
              <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: .5, borderBottomColor: c.divider }}>
                <Text style={{ color: c.textSecondary, fontSize: 13, flex: 1 }}>{label}</Text>
                <Text style={{ color: c.text, fontSize: 13, fontWeight: '600' }}>{fmt(amount)}</Text>
              </View>
            ))}

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTopWidth: 1.5, borderTopColor: c.primary + '40' }}>
              <Text style={{ color: c.primary, fontSize: 16, fontWeight: '900' }}>{tr('TOTAL PAY')}</Text>
              <Text style={{ color: c.primary, fontSize: 20, fontWeight: '900' }}>{fmt(slip.totalPay)}</Text>
            </View>
          </View>

          <View style={{ gap: 10 }}>
            <Button label={tr('Share as PDF')} icon="file-pdf-box" onPress={sharePDF} loading={busy === 'pdf'} disabled={!!busy} />
            <Button label={tr('Send via WhatsApp')} icon="whatsapp" color={c.whatsapp} variant="outline" onPress={sendViaWhatsApp} loading={busy === 'wa'} disabled={!!busy} />
          </View>
        </>)}

        {loading && (
          <View style={{ alignItems: 'center', padding: 40 }}>
            <ActivityIndicator color={c.primary} />
            <Text style={{ color: c.textMuted, marginTop: 8 }}>{tr('Loading pay slip…')}</Text>
          </View>
        )}
      </ScrollView>
    </SafeScreen>
  );
}

function buildPaySlipHTML(slip: any, salonProfile: any, sym: string) {
  const fmt = (n: number) => `${sym}${(n || 0).toLocaleString(appLocale(), { maximumFractionDigits: 0 })}`;
  const salaryLabels: Record<string, string> = { fixed: 'Fixed', commission: 'Commission', hybrid: 'Fixed + Commission' };
  const salaryTypeLabel = salaryLabels[slip.salaryType || 'commission'] || 'Commission';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    body{font-family:Arial,sans-serif;color:#111;margin:0;padding:24px;font-size:13px}
    .header{display:flex;justify-content:space-between;border-bottom:2px solid #A84F18;padding-bottom:12px;margin-bottom:20px}
    .salon-name{font-size:20px;font-weight:900;color:#A84F18}
    h3{color:#555;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin:16px 0 8px}
    table{width:100%;border-collapse:collapse}
    td{padding:8px 4px;border-bottom:1px solid #eee;font-size:13px}
    .val{text-align:right;font-weight:600}
    .total-row td{font-size:16px;font-weight:900;color:#A84F18;border-top:2px solid #A84F18;border-bottom:none;padding-top:12px}
    .grid{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin:10px 0}
    .att-box{background:#f5f5f5;border-radius:8px;padding:10px;text-align:center}
    .att-num{font-size:20px;font-weight:900}
  </style></head><body>
  <div class="header">
    <div><div class="salon-name">${escapeHtml(salonProfile?.name || 'Salon')}</div><div style="font-size:11px;color:#777;margin-top:4px">${escapeHtml([salonProfile?.address, salonProfile?.city].filter(Boolean).join(', '))}</div></div>
    <div style="text-align:right"><div style="font-size:11px;color:#777;text-transform:uppercase;letter-spacing:1px">Employee Pay Slip</div><div style="font-size:16px;font-weight:900;margin-top:4px">${slip.period.label}</div></div>
  </div>
  <div>
    <strong style="font-size:16px">${escapeHtml(slip.staff?.name)}</strong> &nbsp;|&nbsp; ${escapeHtml(slip.staff?.role)}
    &nbsp;|&nbsp; Salary Type: ${salaryTypeLabel}
  </div>
  <h3>Attendance</h3>
  <div class="grid">
    <div class="att-box"><div class="att-num" style="color:#10B981">${slip.attendance.present}</div><div>Present</div></div>
    <div class="att-box"><div class="att-num" style="color:#F59E0B">${slip.attendance.half_day || 0}</div><div>Half Day</div></div>
    <div class="att-box"><div class="att-num" style="color:#EF4444">${slip.attendance.absent || 0}</div><div>Absent</div></div>
    <div class="att-box"><div class="att-num" style="color:#8B5CF6">${Number(slip.attendance.effectiveDays || slip.attendance.present || 0).toFixed(1)}</div><div>Effective Days</div></div>
  </div>
  <p style="font-size:11px;color:#888;margin:4px 0 12px">
    Required ${slip.requiredHours || 8} hrs/day &nbsp;•&nbsp;
    ${slip.attendance.workingDaysInMonth || '--'} working days this month
  </p>
  <h3>Performance</h3>
  <table><tr><td>Bills Processed</td><td class="val">${slip.performance.bills}</td></tr>
  <tr><td>Revenue Generated</td><td class="val">${fmt(slip.performance.revenue)}</td></tr>
  <tr><td>Commission Earned (${slip.staff?.commission_rate}%)</td><td class="val">${fmt(slip.performance.commission)}</td></tr></table>
  <h3>Salary Breakdown</h3>
  ${slip.salaryType !== 'commission' ? `<p style="font-size:11px;color:#777;margin:0 0 6px">Monthly base salary: ${fmt(slip.salary)}</p>` : ''}
  <table>
  ${payRows(slip).map(r => `<tr><td>${escapeHtml(r.label)}</td><td class="val">${fmt(r.amount)}</td></tr>`).join('')}
  <tr class="total-row"><td>Total Payable</td><td class="val">${fmt(slip.totalPay)}</td></tr></table>
  <p style="text-align:center;color:#aaa;font-size:11px;margin-top:30px">Generated by SaloonBossX • ${new Date().toLocaleDateString(appLocale())}</p>
  </body></html>`;
}
