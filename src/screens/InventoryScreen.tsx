import React, { useState, useEffect, useContext, useCallback } from 'react';
import { View, FlatList, TouchableOpacity, StyleSheet, Alert, ScrollView, ActivityIndicator } from 'react-native';
import { Text } from '../theme/Text';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { Radius } from '../theme/colors';
import { AppContext } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { DatabaseService } from '../database/Database';
import { SafeScreen } from '../components/SafeScreen';
import { ScreenHeader, Card, BottomSheet, Input, Button, Chip, EmptyState } from '../components/UI';
import { useTr } from '../i18n/tr';
import { parseAmount, cleanAmountInput, showError, confirmAsync } from '../components/formUtils';
import { appEvents } from '../components/appEvents';

const emptyForm = () => ({ name: '', brand: '', category: 'General', quantity: '0', unit: 'pcs', min_stock: '5', cost_price: '0', sell_price: '0', supplier: '' });

const InventoryScreen = ({ navigation }: any) => {
  const { colors: c } = useTheme();
  const tr = useTr();
  const { can } = useAuth();
  const canEdit = can('inventory.edit');
  const { currencySymbol } = useContext(AppContext);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'low' | 'out'>('all');
  const [showForm, setShowForm] = useState(false);
  const [showRestock, setShowRestock] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [restockItem, setRestockItem] = useState<any>(null);
  const [restockQty, setRestockQty] = useState('');
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { setItems((await DatabaseService.getInventory()) as any[]); }
    catch (e) { showError(e, 'Could not load inventory'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => appEvents.on('bill:created', () => { load(); }), [load]);

  const resetForm = () => { setForm(emptyForm()); setEditing(null); };
  const openNew = () => { if (!canEdit) return; resetForm(); setShowForm(true); };
  const openEdit = (item: any) => {
    if (!canEdit) return;
    setEditing(item);
    setForm({ name: item.name, brand: item.brand || '', category: item.category || 'General', quantity: String(item.quantity), unit: item.unit || 'pcs', min_stock: String(item.min_stock), cost_price: String(item.cost_price ?? 0), sell_price: String(item.sell_price ?? 0), supplier: item.supplier || '' });
    setShowForm(true);
  };

  const save = async () => {
    if (saving || !canEdit) return;
    if (!form.name.trim()) { Alert.alert(tr('Name needed'), tr('Enter the product name.')); return; }
    const nums = {
      quantity: parseAmount(form.quantity || '0'),
      min_stock: parseAmount(form.min_stock || '0'),
      cost_price: parseAmount(form.cost_price || '0'),
      sell_price: parseAmount(form.sell_price || '0'),
    };
    const bad = Object.entries(nums).find(([, v]) => isNaN(v));
    if (bad) {
      const label: Record<string, string> = { quantity: 'Current stock', min_stock: 'Alert when stock below', cost_price: 'Cost price', sell_price: 'Sell price' };
      Alert.alert(tr('Check the numbers'), tr('{field} must be a number that is 0 or more.', { field: tr(label[bad[0]]) }));
      return;
    }
    setSaving(true);
    try {
      const data = { name: form.name.trim(), brand: form.brand.trim(), category: form.category, ...nums, unit: form.unit.trim() || 'pcs', supplier: form.supplier.trim() };
      if (editing) await DatabaseService.updateInventoryItem(editing.id, data);
      else await DatabaseService.addInventoryItem(data);
      appEvents.emit('inventory:changed');
      setShowForm(false); resetForm(); load();
    } catch (e) { showError(e, 'Product not saved'); }
    finally { setSaving(false); }
  };

  const restock = async () => {
    if (saving || !restockItem || !canEdit) return;
    const qty = parseAmount(restockQty);
    if (isNaN(qty) || qty <= 0) { Alert.alert(tr('Check the quantity'), tr('Enter how many to add (more than 0).')); return; }
    setSaving(true);
    try {
      await DatabaseService.restockInventory(restockItem.id, qty);
      appEvents.emit('inventory:changed');
      setShowRestock(false); setRestockQty(''); load();
    } catch (e) { showError(e, 'Stock not added'); }
    finally { setSaving(false); }
  };

  const del = async (item: any) => {
    if (!canEdit) return;
    const ok = await confirmAsync('Remove product?', tr('Remove "{name}" from inventory? Old bills are not changed.', { name: item.name }), 'Remove', true);
    if (!ok) return;
    try { await DatabaseService.updateInventoryItem(item.id, { is_active: 0 }); appEvents.emit('inventory:changed'); load(); }
    catch (e) { showError(e, 'Could not remove product'); }
  };

  const filtered = items.filter(item => {
    if (filter === 'low') return item.quantity > 0 && item.quantity <= item.min_stock;
    if (filter === 'out') return item.quantity <= 0;
    return true;
  });

  const lowCount = items.filter(i => i.quantity > 0 && i.quantity <= i.min_stock).length;
  const outCount = items.filter(i => i.quantity <= 0).length;

  const getStockColor = (item: any) => item.quantity <= 0 ? c.danger : item.quantity <= item.min_stock ? c.warning : c.success;
  const getStockBg = (item: any) => item.quantity <= 0 ? c.dangerLight : item.quantity <= item.min_stock ? c.warningLight : c.successLight;
  const getStockLabel = (item: any) => item.quantity <= 0 ? tr('Out of stock') : item.quantity <= item.min_stock ? tr('Low stock') : tr('In stock');

  return (
    <SafeScreen>
      <ScreenHeader title={tr('Inventory')} onBack={() => navigation.goBack()}
        right={canEdit ? <TouchableOpacity style={[st.addBtn, { backgroundColor: c.primary }]} onPress={openNew} accessibilityLabel={tr('Add product')}>
          <MaterialCommunityIcons name="plus" size={20} color={c.onPrimary} />
        </TouchableOpacity> : undefined} />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 52, marginVertical: 8 }} contentContainerStyle={{ paddingHorizontal: 16 }}>
        <Chip label={`${tr('All')} (${items.length})`} active={filter === 'all'} onPress={() => setFilter('all')} />
        <Chip label={`${tr('Low')} (${lowCount})`} active={filter === 'low'} onPress={() => setFilter('low')} icon="alert-circle-outline" />
        <Chip label={`${tr('Out')} (${outCount})`} active={filter === 'out'} onPress={() => setFilter('out')} icon="close-circle-outline" />
      </ScrollView>

      {loading ? <ActivityIndicator color={c.primary} style={{ marginTop: 40 }} /> : (
      <FlatList data={filtered} keyExtractor={i => String(i.id)} contentContainerStyle={{ padding: 16, paddingBottom: 20 }}
        ListEmptyComponent={
          filter === 'all'
            ? <EmptyState icon="package-variant" title={tr('No products')} subtitle={tr('Track salon products and get low stock alerts')} actionLabel={canEdit ? tr('Add product') : undefined} onAction={canEdit ? openNew : undefined} />
            : <View style={st.emptyFilter}><MaterialCommunityIcons name="check-circle" size={40} color={c.success} /><Text style={{ color: c.textMuted, marginTop: 8, fontSize: 15 }}>{filter === 'low' ? tr('No low stock items!') : tr('Nothing out of stock!')}</Text></View>
        }
        renderItem={({ item }) => (
          <Card>
            <TouchableOpacity onPress={() => openEdit(item)} disabled={!canEdit} activeOpacity={0.7}>
              <View style={st.itemRow}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: c.text }}>{item.name}</Text>
                  <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 3 }}>{item.brand ? `${item.brand} · ` : ''}{item.category}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <View style={[st.stockBadge, { backgroundColor: getStockBg(item) }]}>
                    <Text style={{ fontSize: 14, fontWeight: '800', color: getStockColor(item) }}>{item.quantity} {item.unit}</Text>
                  </View>
                  <Text style={{ fontSize: 11, color: getStockColor(item), fontWeight: '700', marginTop: 3 }}>{getStockLabel(item)}</Text>
                </View>
              </View>

              <View style={[st.stockBarBg, { backgroundColor: c.surface }]}>
                <View style={[st.stockBarFill, { width: `${Math.max(0, Math.min(100, (item.quantity / Math.max(item.min_stock * 2, 1)) * 100))}%`, backgroundColor: getStockColor(item) }]} />
              </View>
              <Text style={{ fontSize: 11.5, color: c.textMuted, marginTop: 4 }}>
                {tr('Min')}: {item.min_stock} {item.unit} · {tr('Cost')}: {currencySymbol}{Number(item.cost_price || 0).toFixed(0)} · {tr('Sell')}: {currencySymbol}{Number(item.sell_price || 0).toFixed(0)}
              </Text>
            </TouchableOpacity>
            {canEdit && (
              <View style={st.actionRow}>
                <TouchableOpacity style={[st.restockBtn, { backgroundColor: c.primaryLight }]}
                  onPress={() => { setRestockItem(item); setRestockQty(''); setShowRestock(true); }}>
                  <MaterialCommunityIcons name="plus-circle" size={16} color={c.primary} />
                  <Text style={{ color: c.primary, fontSize: 13, fontWeight: '700' }}>{tr('Restock')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[st.editBtn, { backgroundColor: c.surface }]} onPress={() => openEdit(item)}>
                  <MaterialCommunityIcons name="pencil" size={16} color={c.textSecondary} />
                  <Text style={{ color: c.textSecondary, fontSize: 13, fontWeight: '600' }}>{tr('Edit')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[st.editBtn, { backgroundColor: c.dangerLight, marginLeft: 'auto' }]} onPress={() => del(item)} accessibilityLabel={tr('Remove product')}>
                  <MaterialCommunityIcons name="delete-outline" size={16} color={c.danger} />
                </TouchableOpacity>
              </View>
            )}
          </Card>
        )} />
      )}

      <BottomSheet visible={showForm} onClose={() => { setShowForm(false); resetForm(); }} title={editing ? tr('Edit product') : tr('Add product')}
        footer={<Button label={editing ? tr('Update product') : tr('Add product')} icon="check" onPress={save} loading={saving} disabled={saving} />}>
        <Input label={`${tr('Product name')} *`} placeholder={tr("e.g. L'Oreal Shampoo")} value={form.name} onChangeText={(v: string) => setForm({ ...form, name: v })} />
        <Input label={tr('Brand')} placeholder={tr('Brand name')} value={form.brand} onChangeText={(v: string) => setForm({ ...form, brand: v })} />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}><Input label={tr('Current stock')} placeholder="0" value={form.quantity} onChangeText={(v: string) => setForm({ ...form, quantity: cleanAmountInput(v) })} keyboardType="decimal-pad" /></View>
          <View style={{ flex: 1 }}><Input label={tr('Unit')} placeholder="pcs, ml, g" value={form.unit} onChangeText={(v: string) => setForm({ ...form, unit: v })} /></View>
        </View>
        <Input label={tr('Alert when stock below')} placeholder="5" value={form.min_stock} onChangeText={(v: string) => setForm({ ...form, min_stock: cleanAmountInput(v) })} keyboardType="decimal-pad" />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}><Input label={tr('Cost price')} placeholder="0" value={form.cost_price} onChangeText={(v: string) => setForm({ ...form, cost_price: cleanAmountInput(v) })} keyboardType="decimal-pad" /></View>
          <View style={{ flex: 1 }}><Input label={tr('Sell price')} placeholder="0" value={form.sell_price} onChangeText={(v: string) => setForm({ ...form, sell_price: cleanAmountInput(v) })} keyboardType="decimal-pad" hint={tr('0 = not sold to clients')} /></View>
        </View>
        <Input label={tr('Supplier')} placeholder={tr('Supplier name')} value={form.supplier} onChangeText={(v: string) => setForm({ ...form, supplier: v })} />
        {editing && <View style={{ marginTop: 4 }}><Button label={tr('Remove product')} icon="delete" onPress={() => { const it = editing; setShowForm(false); setTimeout(() => del(it), 250); }} color={c.danger} variant="outline" /></View>}
      </BottomSheet>

      <BottomSheet visible={showRestock} onClose={() => setShowRestock(false)} title={`${tr('Restock')}: ${restockItem?.name || ''}`}
        footer={<Button label={tr('Add stock')} icon="plus" onPress={restock} loading={saving} disabled={saving} />}>
        <Text style={{ color: c.textMuted, marginBottom: 12 }}>{tr('Current')}: {restockItem?.quantity} {restockItem?.unit} ({tr('min')}: {restockItem?.min_stock})</Text>
        <Input label={tr('Add quantity')} placeholder={tr('How many to add?')} value={restockQty} onChangeText={(v: string) => setRestockQty(cleanAmountInput(v))} keyboardType="decimal-pad" autoFocus />
      </BottomSheet>
    </SafeScreen>
  );
};

const st = StyleSheet.create({
  addBtn: { width: 40, height: 40, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  emptyFilter: { alignItems: 'center', paddingTop: 60 },
  itemRow: { flexDirection: 'row', alignItems: 'center' },
  stockBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.md },
  stockBarBg: { height: 6, borderRadius: 3, marginTop: 10, overflow: 'hidden' },
  stockBarFill: { height: '100%', borderRadius: 3 },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  restockBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: Radius.md },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: Radius.md },
});

export default InventoryScreen;
