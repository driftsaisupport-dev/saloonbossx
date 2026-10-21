import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Text } from '../theme/Text';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { TabScreen as SafeScreen } from '../components/SafeScreen';
import { AppBar, SearchBar, Avatar, Pill, EmptyState } from '../components/UI';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { DatabaseService } from '../database/Database';
import { useTr } from '../i18n/tr';
import { showError, confirmAsync } from '../components/formUtils';
import { ClientFormSheet } from '../components/ClientFormSheet';
import { useChoiceSheet } from '../components/ChoiceSheet';
import { appEvents } from '../components/appEvents';
import { appLocale } from '../config/regions';

const TIER_TONE: Record<string, 'primary' | 'neutral' | 'warning' | 'accent'> = {
  Bronze: 'warning', Silver: 'neutral', Gold: 'warning', Platinum: 'primary',
};

export default function ClientsScreen() {
  const { colors: c } = useTheme();
  const tr = useTr();
  const navigation = useNavigation<any>();
  const { can } = useAuth();
  const canEdit = can('clients.edit');
  const canDelete = can('clients.delete');
  const [clients, setClients] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [firstLoad, setFirstLoad] = useState(true);
  const choice = useChoiceSheet();

  // Latest search in a ref: the focus effect below used to capture the
  // initial '' and reload the full list on focus while a query was typed.
  const searchRef = useRef('');
  searchRef.current = search;
  const reqId = useRef(0);
  const stale = useRef(true);
  const lastLoad = useRef(0);

  const load = useCallback(async (q: string) => {
    const id = ++reqId.current;
    setLoading(true);
    try {
      const rows = (await DatabaseService.getClients(q)) as any[];
      if (id === reqId.current) { setClients(rows || []); lastLoad.current = Date.now(); } // ignore out-of-order replies
    } catch (e) {
      if (id === reqId.current) showError(e, 'Could not load clients');
    } finally {
      if (id === reqId.current) { setLoading(false); setFirstLoad(false); }
    }
  }, []);

  useEffect(() => appEvents.on('client:changed', () => { stale.current = true; }), []);
  useEffect(() => appEvents.on('bill:created', () => { stale.current = true; }), []);
  useFocusEffect(useCallback(() => {
    // Reload when something changed, or the list is older than 30 s (e.g. after an import).
    if (stale.current || Date.now() - lastLoad.current > 30_000) { stale.current = false; load(searchRef.current); }
  }, [load]));

  // Debounced search; the current list stays visible while typing (no spinner swap).
  useEffect(() => {
    if (firstLoad) return;
    const t = setTimeout(() => load(search.trim()), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function openAdd() { if (!canEdit) return; setEditing(null); setShowForm(true); }
  function openEdit(cl: any) { if (!canEdit) return; setEditing(cl); setShowForm(true); }

  async function deleteClient(cl: any) {
    if (!canDelete) return;
    const ok = await confirmAsync('Remove client', tr('Deactivate {name}? Their visit and bill history are kept.', { name: cl.name }), 'Remove', true);
    if (!ok) return;
    try {
      await DatabaseService.updateClient(cl.id, { is_active: 0 });
      appEvents.emit('client:changed');
      load(searchRef.current);
    } catch (e) { showError(e, 'Could not remove client'); }
  }

  function openMenu(cl: any) {
    const options = [
      { label: tr('Open profile'), icon: 'account-details-outline', onPress: () => navigation.navigate('ClientDetail', { clientId: cl.id }) },
      ...(canEdit ? [{ label: tr('Edit details'), icon: 'pencil-outline', onPress: () => openEdit(cl) }] : []),
      ...(canDelete ? [{ label: tr('Remove client'), icon: 'account-remove-outline', tone: 'danger' as const, onPress: () => deleteClient(cl) }] : []),
    ];
    choice.open({ title: cl.name, message: cl.phone || undefined, options });
  }

  const tierColors: Record<string, string> = { Bronze: c.tierBronze, Silver: c.tierSilver, Gold: c.tierGold, Platinum: c.tierPlatinum };
  const n = clients.length;

  return (
    <SafeScreen>
      <AppBar
        title={tr('Clients')}
        right={
          canEdit ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity style={{ width: 42, alignItems: 'center', justifyContent: 'center', backgroundColor: c.primaryLight, borderRadius: 14 }}
                onPress={() => navigation.navigate('ImportClients')} activeOpacity={0.85} accessibilityLabel={tr('Import customers')}>
                <MaterialCommunityIcons name="account-arrow-down-outline" size={20} color={c.primary} />
              </TouchableOpacity>
              <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: c.primary, borderRadius: 14, paddingHorizontal: 15, paddingVertical: 10 }}
                onPress={openAdd} activeOpacity={0.85} accessibilityRole="button">
                <MaterialCommunityIcons name="plus" size={16} color={c.onPrimary} />
                <Text style={{ color: c.onPrimary, fontWeight: '800', fontSize: 13 }}>{tr('New')}</Text>
              </TouchableOpacity>
            </View>
          ) : undefined
        }
      />

      <View style={{ paddingHorizontal: 16, marginBottom: 10 }}>
        <SearchBar value={search} onChangeText={setSearch} placeholder={tr('Search name or phone…')} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 18, marginBottom: 6, gap: 8 }}>
        <Text style={{ color: c.textMuted, fontSize: 12, fontWeight: '600' }}>
          {search ? tr('{n} found', { n }) : n === 1 ? tr('1 client') : tr('{n} clients', { n })}
        </Text>
        {loading && !firstLoad ? <ActivityIndicator size="small" color={c.primary} /> : null}
      </View>

      {firstLoad ? <ActivityIndicator color={c.primary} style={{ marginTop: 40 }} /> : (
        <FlatList
          data={clients}
          keyExtractor={i => String(i.id)}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={15}
          windowSize={9}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={{ backgroundColor: c.card, borderRadius: 18, padding: 14, paddingRight: 6, marginBottom: 10, flexDirection: 'row', alignItems: 'center', borderWidth: 0.5, borderColor: c.borderLight }}
              onPress={() => navigation.navigate('ClientDetail', { clientId: item.id })}
              onLongPress={() => openMenu(item)} activeOpacity={0.85}>
              <Avatar name={item.name} color={tierColors[item.loyalty_tier]} size={46} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <Text style={{ color: c.text, fontSize: 15, fontWeight: '800', flexShrink: 1 }} numberOfLines={1}>{item.name}</Text>
                  {item.is_vip ? <Pill label="VIP" tone="warning" /> : null}
                  {item.is_blacklisted ? <Pill label={tr('Blocked')} tone="danger" /> : null}
                  {item.allergies ? <Pill label={tr('Allergy')} tone="warning" /> : null}
                </View>
                <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 3 }}>{item.phone || tr('No phone')}</Text>
                <Text style={{ color: c.textMuted, fontSize: 11.5, marginTop: 2 }} numberOfLines={1}>
                  {item.total_visits === 1 ? tr('1 visit') : tr('{n} visits', { n: item.total_visits || 0 })} · {Number(item.total_spent || 0).toLocaleString(appLocale(), { maximumFractionDigits: 0 })} {tr('spent')}
                  {item.loyalty_tier ? ` · ${tr(item.loyalty_tier)}` : ''}
                </Text>
              </View>
              {item.loyalty_tier && item.loyalty_points > 0 ? (
                <View style={{ alignItems: 'flex-end', marginRight: 2 }}>
                  <Pill label={`${item.loyalty_points} ${tr('pts')}`} tone={TIER_TONE[item.loyalty_tier] || 'neutral'} />
                </View>
              ) : null}
              <TouchableOpacity onPress={() => openMenu(item)} style={{ padding: 10 }} accessibilityLabel={tr('More options')} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
                <MaterialCommunityIcons name="dots-vertical" size={20} color={c.textMuted} />
              </TouchableOpacity>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            search
              ? <EmptyState icon="account-search-outline" title={tr('No clients match your search')} subtitle={tr('Try part of the name or the last 4 digits of the phone.')} />
              : <EmptyState icon="account-group-outline" title={tr('No clients yet')} subtitle={tr('Add your first client, or import them from your phone contacts.')}
                  actionLabel={canEdit ? tr('Add client') : undefined} onAction={canEdit ? openAdd : undefined} />
          }
        />
      )}

      <ClientFormSheet
        visible={showForm}
        client={editing}
        onClose={() => setShowForm(false)}
        onSaved={() => load(searchRef.current)}
        onOpenExisting={ex => navigation.navigate('ClientDetail', { clientId: ex.id })}
      />
      {choice.element}
    </SafeScreen>
  );
}
