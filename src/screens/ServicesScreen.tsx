import React, { useState, useEffect, useCallback, useContext } from 'react';
import { View, FlatList, TouchableOpacity, StyleSheet, Alert, ScrollView, ActivityIndicator } from 'react-native';
import { Text } from '../theme/Text';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { Radius, Shadow } from '../theme/colors';
import { AppContext } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { DatabaseService, DBX } from '../database/Database';
import { SERVICE_CATEGORIES } from '../utils/helpers';
import { EmptyState } from '../components/EmptyState';
import { SafeScreen } from '../components/SafeScreen';
import { ScreenHeader, BottomSheet, Input, Button, Chip } from '../components/UI';
import { useTr } from '../i18n/tr';
import { parseAmount, parseCount, cleanAmountInput, showError, confirmAsync } from '../components/formUtils';
import { useChoiceSheet } from '../components/ChoiceSheet';
import { appLocale, fmtMoney, priceRoundStep } from '../config/regions';

const emptyForm = () => ({ name: '', category: 'Hair', price: '', duration: '30', description: '' });

const ServicesScreen = ({ navigation }: any) => {
  const { colors: c } = useTheme();
  const tr = useTr();
  const { can } = useAuth();
  const canEdit = can('services.edit');
  const { currencySymbol } = useContext(AppContext);
  const [services, setServices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const choice = useChoiceSheet();

  const load = useCallback(async () => {
    try { setServices((await DatabaseService.getServices(false)) as any[]); }
    catch (e) { showError(e, 'Could not load services'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const resetForm = () => { setForm(emptyForm()); setEditing(null); };
  const openNew = () => { if (!canEdit) return; resetForm(); setShowForm(true); };
  const openEdit = (sv: any) => {
    if (!canEdit) return;
    setEditing(sv);
    setForm({ name: sv.name, category: sv.category, price: String(sv.price), duration: String(sv.duration), description: sv.description || '' });
    setShowForm(true);
  };

  const save = async () => {
    if (saving || !canEdit) return;
    const price = parseAmount(form.price);
    const dur = form.duration.trim() === '' ? 30 : parseCount(form.duration);
    if (!form.name.trim()) { Alert.alert(tr('Name needed'), tr('Enter the service name.')); return; }
    if (isNaN(price) || price <= 0) { Alert.alert(tr('Check the price'), tr('Enter a price greater than 0 (numbers only, e.g. 1,500).')); return; }
    if (isNaN(dur) || dur < 5 || dur > 720) { Alert.alert(tr('Check the duration'), tr('Duration must be between 5 and 720 minutes.')); return; }
    setSaving(true);
    try {
      const data = { name: form.name.trim(), category: form.category, price, duration: dur, description: form.description.trim() };
      if (editing) await DatabaseService.updateService(editing.id, data);
      else await DatabaseService.addService(data);
      setShowForm(false); resetForm(); load();
    } catch (e) { showError(e, 'Service not saved'); }
    finally { setSaving(false); }
  };

  const del = async (sv: any) => {
    if (!canEdit) return;
    const ok = await confirmAsync('Remove service?', tr('Remove "{name}" from the menu? Old bills are not changed.', { name: sv.name }), 'Remove', true);
    if (!ok) return;
    try { await DatabaseService.deleteService(sv.id); load(); }
    catch (e) { showError(e, 'Could not remove service'); }
  };

  const activeServices = services.filter((sv: any) => sv.is_active);
  const known = new Set(SERVICE_CATEGORIES);
  const grouped = [
    ...SERVICE_CATEGORIES.map(cat => ({ category: cat, items: activeServices.filter((sv: any) => sv.category === cat) })),
    // services in a custom / imported category used to vanish from this list
    { category: 'Other ', items: activeServices.filter((sv: any) => !known.has(sv.category)) },
  ].filter(g => g.items.length > 0);

  // Annual price revision in one tap instead of editing 30 services.
  async function applyBulk(pct: number) {
    const ok = await confirmAsync(
      pct > 0 ? tr('Increase all prices by {p}%?', { p: Math.abs(pct) }) : tr('Reduce all prices by {p}%?', { p: Math.abs(pct) }),
      `New prices are rounded to the nearest ${fmtMoney(priceRoundStep())}. Old bills are not changed.`, 'Apply');
    if (!ok) return;
    setBulkBusy(true);
    try {
      const n = await DBX.bulkUpdatePrices(pct, priceRoundStep());
      await load();
      Alert.alert(tr('Prices updated'), tr('{n} services updated.', { n }));
    } catch (e) { showError(e, 'Prices not changed'); }
    finally { setBulkBusy(false); }
  }
  function bulkPrice() {
    choice.open({
      title: tr('Change all prices'),
      message: tr('Pick a change for every active service:'),
      options: [5, 10, 15, -10].map(p => ({
        label: `${p > 0 ? '+' : '−'}${Math.abs(p)}%`, icon: p > 0 ? 'trending-up' : 'trending-down', tone: p > 0 ? 'primary' as const : 'warning' as const,
        onPress: () => applyBulk(p),
      })),
    });
  }
  function openMenu(sv: any) {
    choice.open({
      title: sv.name,
      options: [
        { label: tr('Edit service'), icon: 'pencil-outline', onPress: () => openEdit(sv) },
        { label: tr('Remove service'), icon: 'delete-outline', tone: 'danger', onPress: () => del(sv) },
      ],
    });
  }

  return (
    <SafeScreen>
      <ScreenHeader title={tr('Services')} onBack={() => navigation.goBack()}
        right={canEdit ? <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity style={[st.addBtn, { backgroundColor: c.primaryLight }]} onPress={bulkPrice} disabled={bulkBusy} accessibilityLabel={tr('Change all prices')}>
            {bulkBusy ? <ActivityIndicator size="small" color={c.primary} /> : <MaterialCommunityIcons name="percent-outline" size={20} color={c.primary} />}
          </TouchableOpacity>
          <TouchableOpacity style={[st.addBtn, { backgroundColor: c.primary }]} onPress={openNew} accessibilityLabel={tr('Add service')}>
            <MaterialCommunityIcons name="plus" size={20} color={c.onPrimary} />
          </TouchableOpacity>
        </View> : undefined} />

      {loading ? <ActivityIndicator color={c.primary} style={{ marginTop: 40 }} /> : activeServices.length === 0 ? (
        <EmptyState icon="content-cut" title={tr('No services')} subtitle={canEdit ? tr('Add services to start billing') : tr('Ask the owner to add services.')}
          actionLabel={canEdit ? tr('Add service') : undefined} onAction={canEdit ? openNew : undefined} />
      ) : (
        <FlatList data={grouped} keyExtractor={item => item.category}
          contentContainerStyle={{ padding: 16, paddingBottom: 20 }}
          renderItem={({ item: group }) => (
            <View style={{ marginBottom: 20 }}>
              <Text style={[st.catTitle, { color: c.textMuted }]}>{tr(group.category.trim())} ({group.items.length})</Text>
              {group.items.map((sv: any) => (
                <TouchableOpacity key={sv.id} style={[st.svcCard, { backgroundColor: c.card }]}
                  disabled={!canEdit}
                  onPress={() => openEdit(sv)}
                  onLongPress={() => openMenu(sv)} activeOpacity={0.7}>
                  <View style={{ flex: 1 }}>
                    <Text style={[st.svcName, { color: c.text }]}>{sv.name}</Text>
                    <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }} numberOfLines={2}>{sv.duration} {tr('min')}{sv.description ? ` · ${sv.description}` : ''}</Text>
                  </View>
                  <Text style={[st.svcPrice, { color: c.primary }]}>{currencySymbol}{(sv.price || 0).toLocaleString(appLocale(), { maximumFractionDigits: 0 })}</Text>
                  {canEdit && (
                    <TouchableOpacity onPress={() => openMenu(sv)} style={{ paddingLeft: 10, paddingVertical: 6 }} accessibilityLabel={tr('More options')} hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}>
                      <MaterialCommunityIcons name="dots-vertical" size={20} color={c.textMuted} />
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          )} />
      )}

      <BottomSheet visible={showForm} onClose={() => { setShowForm(false); resetForm(); }} title={editing ? tr('Edit service') : tr('Add service')}
        footer={<Button label={editing ? tr('Update service') : tr('Add service')} icon="check" onPress={save} loading={saving} disabled={saving} />}>
        <Input label={`${tr('Service name')} *`} placeholder={tr('e.g. Haircut (Women)')} value={form.name} onChangeText={(v: string) => setForm({ ...form, name: v })} />

        <Text style={[st.fieldLabel, { color: c.textSecondary }]}>{tr('Category')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }} keyboardShouldPersistTaps="handled">
          {SERVICE_CATEGORIES.map(cat => (
            <Chip key={cat} label={tr(cat)} active={form.category === cat} onPress={() => setForm({ ...form, category: cat })} />
          ))}
        </ScrollView>

        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Input label={`${tr('Price')} (${currencySymbol}) *`} placeholder="500" value={form.price} onChangeText={(v: string) => setForm({ ...form, price: cleanAmountInput(v) })} keyboardType="decimal-pad" />
          </View>
          <View style={{ flex: 1 }}>
            <Input label={tr('Duration (min)')} placeholder="30" value={form.duration} onChangeText={(v: string) => setForm({ ...form, duration: v.replace(/\D/g, '') })} keyboardType="number-pad" />
          </View>
        </View>

        <Input label={tr('Description (optional)')} placeholder={tr('Short note')} value={form.description} onChangeText={(v: string) => setForm({ ...form, description: v })} />
        {editing && <View style={{ marginTop: 4 }}><Button label={tr('Remove service')} icon="delete" onPress={() => { const sv = editing; setShowForm(false); setTimeout(() => del(sv), 250); }} color={c.danger} variant="outline" /></View>}
      </BottomSheet>
      {choice.element}
    </SafeScreen>
  );
};

const st = StyleSheet.create({
  addBtn: { width: 40, height: 40, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  catTitle: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  svcCard: { flexDirection: 'row', alignItems: 'center', borderRadius: Radius.lg, padding: 16, paddingRight: 8, marginBottom: 8, ...Shadow.sm },
  svcName: { fontSize: 15, fontWeight: '600' },
  svcPrice: { fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
  fieldLabel: { fontSize: 13, fontWeight: '600', marginBottom: 6 },
});

export default ServicesScreen;
