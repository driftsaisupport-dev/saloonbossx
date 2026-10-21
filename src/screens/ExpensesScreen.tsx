import React, { useState, useCallback, useContext, useRef } from 'react';
import { View, ScrollView, TouchableOpacity, Alert, FlatList, ActivityIndicator } from 'react-native';
import { Text, TextInput } from '../theme/Text';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeScreen } from '../components/SafeScreen';
import { ScreenHeader, Chip, BottomSheet, Button, EmptyState } from '../components/UI';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { DatabaseService } from '../database/Database';
import { AppContext } from '../context/AppContext';
import { useTr } from '../i18n/tr';
import { localDateStr, parseAmount, cleanAmountInput, isValidDateStr, showError, confirmAsync, prettyDate } from '../components/formUtils';
import { DateField } from '../components/DateTimePicker';
import { appEvents } from '../components/appEvents';
import { appLocale, payLabel } from '../config/regions';

const CATS = ['Rent', 'Electricity', 'Water', 'Product Purchase', 'Staff Salary', 'Marketing', 'Equipment', 'Maintenance', 'Laundry', 'Transport', 'Miscellaneous'];
type Period = 'today' | 'month' | 'last_month' | 'year';

function getRange(p: Period) {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const today = localDateStr(now);
  if (p === 'today') return { start: today, end: today };
  if (p === 'month') return { start: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`, end: today };
  if (p === 'last_month') {
    const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const e = new Date(now.getFullYear(), now.getMonth(), 0);
    return { start: localDateStr(s), end: localDateStr(e) };
  }
  return { start: `${now.getFullYear()}-01-01`, end: today };
}

const emptyForm = () => ({ category: 'Rent', amount: '', description: '', date: localDateStr(), payment_method: 'cash', vendor: '' });

export default function ExpensesScreen() {
  const { colors: c } = useTheme();
  const tr = useTr();
  const navigation = useNavigation<any>();
  const { can } = useAuth();
  const canEdit = can('expenses.edit');
  const { currencySymbol } = useContext(AppContext);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [period, setPeriod] = useState<Period>('month');
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm());
  const periodRef = useRef<Period>('month');
  periodRef.current = period;

  const load = useCallback(async (p: Period) => {
    setLoading(true);
    try {
      const { start, end } = getRange(p);
      const data = (await DatabaseService.getExpenses(start, end)) as any[];
      if (periodRef.current !== p) return;
      setExpenses(data || []);
      setTotal((data || []).reduce((s: number, e: any) => s + (Number(e.amount) || 0), 0));
    } catch (e) { showError(e, 'Could not load expenses'); }
    finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(periodRef.current); }, [load]));
  const changePeriod = (p: Period) => { setPeriod(p); periodRef.current = p; load(p); };

  async function addExpense() {
    if (saving || !canEdit) return;
    const amt = parseAmount(form.amount);
    if (isNaN(amt) || amt <= 0) { Alert.alert(tr('Check the amount'), tr('Enter an amount greater than 0 (e.g. 1,500).')); return; }
    if (!isValidDateStr(form.date)) { Alert.alert(tr('Check the date'), tr('Pick the date from the calendar.')); return; }
    setSaving(true);
    try {
      await DatabaseService.addExpense({ ...form, amount: amt, vendor: form.vendor.trim(), description: form.description.trim() });
      appEvents.emit('expense:changed');
      setShowAdd(false);
      setForm(emptyForm());
      load(periodRef.current);
    } catch (e) { showError(e, 'Expense not saved'); }
    finally { setSaving(false); }
  }

  async function deleteExpense(item: any) {
    if (!canEdit || deleting) return;
    const ok = await confirmAsync('Delete expense', tr('Remove the {cat} expense of {amt}?', { cat: tr(item.category), amt: `${currencySymbol}${Number(item.amount || 0).toLocaleString(appLocale())}` }), 'Delete', true);
    if (!ok) return;
    setDeleting(item.id);
    try { await DatabaseService.deleteExpense(item.id); appEvents.emit('expense:changed'); load(periodRef.current); }
    catch (e) { showError(e, 'Could not delete expense'); }
    finally { setDeleting(null); }
  }

  const catTotals: Record<string, number> = {};
  expenses.forEach((e: any) => { catTotals[e.category] = (catTotals[e.category] || 0) + (Number(e.amount) || 0); });

  return (
    <SafeScreen>
      <ScreenHeader title={tr('Expenses')} onBack={() => navigation.goBack()}
        subtitle={`${tr('Total')} ${currencySymbol}${total.toLocaleString(appLocale(), { maximumFractionDigits: 0 })}`}
        right={canEdit ? (
          <TouchableOpacity style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }}
            onPress={() => { setForm(emptyForm()); setShowAdd(true); }} accessibilityLabel={tr('Add expense')}>
            <MaterialCommunityIcons name="plus" size={20} color={c.onPrimary} />
          </TouchableOpacity>
        ) : undefined}
      />

      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 10 }} contentContainerStyle={{ paddingHorizontal: 16, paddingRight: 8 }}>
          {([['today', 'Today'], ['month', 'This Month'], ['last_month', 'Last Month'], ['year', 'This Year']] as [Period, string][]).map(([k, l]) => (
            <Chip key={k} label={tr(l)} active={period === k} onPress={() => changePeriod(k)} />
          ))}
        </ScrollView>
      </View>

      {Object.keys(catTotals).length > 0 && (
        <View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }} contentContainerStyle={{ paddingHorizontal: 16 }}>
            {Object.entries(catTotals).sort(([, a], [, b]) => b - a).map(([cat, amt]) => (
              <View key={cat} style={{ backgroundColor: c.card, borderRadius: 12, padding: 12, marginRight: 10, minWidth: 110, borderWidth: 1, borderColor: c.border }}>
                <Text style={{ color: c.textMuted, fontSize: 11.5, marginBottom: 4 }}>{tr(cat)}</Text>
                <Text style={{ color: c.danger, fontSize: 14, fontWeight: '800' }}>{currencySymbol}{amt.toLocaleString(appLocale(), { maximumFractionDigits: 0 })}</Text>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {loading && expenses.length === 0
        ? <ActivityIndicator color={c.primary} style={{ marginTop: 40 }} />
        : (
          <FlatList data={expenses} keyExtractor={i => String(i.id)} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, flexGrow: 1 }}
            refreshing={loading} onRefresh={() => load(periodRef.current)}
            renderItem={({ item }) => (
              <View style={{ backgroundColor: c.card, borderRadius: 12, padding: 16, marginBottom: 10, flexDirection: 'row', alignItems: 'flex-start', borderWidth: 1, borderColor: c.border }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.text, fontSize: 15, fontWeight: '700' }}>{tr(item.category)}</Text>
                  {item.vendor ? <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 2 }}>{tr('Vendor')}: {item.vendor}</Text> : null}
                  {item.description ? <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 2 }}>{item.description}</Text> : null}
                  <Text style={{ color: c.textMuted, fontSize: 11.5, marginTop: 4 }}>{prettyDate(item.date, true)}  •  {String(item.payment_method || '').toUpperCase()}</Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 10 }}>
                  <Text style={{ color: c.danger, fontSize: 18, fontWeight: '900' }}>{currencySymbol}{Number(item.amount || 0).toLocaleString(appLocale())}</Text>
                  {canEdit && (
                    <TouchableOpacity onPress={() => deleteExpense(item)} disabled={deleting === item.id} accessibilityLabel={tr('Delete expense')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                      {deleting === item.id ? <ActivityIndicator size="small" color={c.danger} /> : <MaterialCommunityIcons name="delete-outline" size={20} color={c.danger} />}
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            )}
            ListEmptyComponent={
              <EmptyState icon="cash-remove" title={tr('No expenses for this period')}
                subtitle={canEdit ? tr('Record rent, products and bills to see your real profit.') : undefined}
                actionLabel={canEdit ? tr('Add expense') : undefined} onAction={canEdit ? () => { setForm(emptyForm()); setShowAdd(true); } : undefined} />
            }
          />
        )
      }

      <BottomSheet visible={showAdd} onClose={() => setShowAdd(false)} title={tr('Add expense')}
        footer={<Button label={saving ? tr('Saving…') : tr('Save expense')} icon="check" onPress={addExpense} loading={saving} disabled={saving} />}>
        <Label c={c} text={tr('Category')} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10 }}>
          {CATS.map(cat => {
            const on = form.category === cat;
            return (
              <TouchableOpacity key={cat} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, marginRight: 8, marginBottom: 8, backgroundColor: on ? c.primary : c.surface, borderWidth: 1, borderColor: on ? c.primary : c.border }}
                onPress={() => setForm(f => ({ ...f, category: cat }))}>
                <Text style={{ color: on ? c.onPrimary : c.textSecondary, fontSize: 12.5, fontWeight: '600' }}>{tr(cat)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Label c={c} text={`${tr('Amount')} *`} />
        <TextInput style={[fi, { backgroundColor: c.surface, color: c.text, borderColor: c.border, fontSize: 17 }]} value={form.amount} onChangeText={v => setForm(f => ({ ...f, amount: cleanAmountInput(v) }))} placeholder="0" placeholderTextColor={c.textMuted} keyboardType="decimal-pad" />
        <DateField label={tr('Date')} value={form.date} onChange={v => setForm(f => ({ ...f, date: v }))} maxDate={localDateStr()} />
        <Label c={c} text={tr('Paid by')} />
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
          {['cash', 'upi', 'card'].map(m => {
            const on = form.payment_method === m;
            return (
              <TouchableOpacity key={m} style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: on ? c.primary : c.surface, borderWidth: 1, borderColor: on ? c.primary : c.border }}
                onPress={() => setForm(f => ({ ...f, payment_method: m }))}>
                <Text style={{ color: on ? c.onPrimary : c.textSecondary, fontWeight: '700', fontSize: 13 }}>{m === 'cash' ? tr('Cash') : m === 'card' ? tr('Card') : payLabel()}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Label c={c} text={tr('Vendor / supplier')} />
        <TextInput style={[fi, { backgroundColor: c.surface, color: c.text, borderColor: c.border }]} value={form.vendor} onChangeText={v => setForm(f => ({ ...f, vendor: v }))} placeholder={tr("e.g. L'Oreal distributor")} placeholderTextColor={c.textMuted} />
        <Label c={c} text={tr('Description')} />
        <TextInput style={[fi, { backgroundColor: c.surface, color: c.text, borderColor: c.border }]} value={form.description} onChangeText={v => setForm(f => ({ ...f, description: v }))} placeholder={tr('Details…')} placeholderTextColor={c.textMuted} />
      </BottomSheet>
    </SafeScreen>
  );
}
function Label({ c, text }: any) {
  return <Text style={{ color: c.textSecondary, fontSize: 12, fontWeight: '700', marginBottom: 8 }}>{text}</Text>;
}
const fi = { borderRadius: 10, padding: 13, fontSize: 14, borderWidth: 1, marginBottom: 16 } as const;
