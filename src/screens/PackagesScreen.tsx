import { fmtMoney, localPrice } from '../config/regions';
import React, { useState, useEffect, useCallback, useContext } from 'react';
import { View, FlatList, TouchableOpacity, StyleSheet, Alert, ScrollView } from 'react-native';
import { Text } from '../theme/Text';
import { useTheme } from '../context/ThemeContext';
import { Radius } from '../theme/colors';
import { AppContext } from '../context/AppContext';
import { DatabaseService } from '../database/Database';
import { formatCurrencyFull } from '../utils/helpers';
import { EmptyState } from '../components/EmptyState';
import { SafeScreen } from '../components/SafeScreen';
import { ScreenHeader, BottomSheet, Input, Button } from '../components/UI';
import { IconTile, Glyph } from '../components/IconTile';
import { useScale } from '../utils/responsive';
import { parseAmount, parseCount, showError } from '../components/formUtils';
import { useAuth } from '../context/AuthContext';

/**
 * Prepaid packages.
 *
 * The memberships and client_memberships tables, and the helpers that read
 * them, already existed — but nothing in the app ever opened them, so the
 * feature was dead code. Prepaid packages are how Indian salons take cash up
 * front and lock in repeat visits, and it is the first thing an owner asks
 * about in a demo.
 */

type Tab = 'templates' | 'sold' | 'expiring';

const PackagesScreen = ({ navigation }: any) => {
  const { colors: c } = useTheme();
  const { currencySymbol } = useContext(AppContext);
  const { s, f } = useScale();
  const canEdit = useAuth().can('services.edit');

  const [tab, setTab] = useState<Tab>('templates');
  const [templates, setTemplates] = useState<any[]>([]);
  const [expiring, setExpiring] = useState<any[]>([]);
  const [liability, setLiability] = useState({ count: 0, amount: 0 });
  const [showForm, setShowForm] = useState(false);

  const [form, setForm] = useState({
    name: '',
    price: '',
    value: '',
    sessions: '',
    validity: '365',
    discount: '',
  });

  const load = useCallback(async () => {
    const [t, e, l] = await Promise.all([
      DatabaseService.getMemberships(),
      DatabaseService.getExpiringPackages(30),
      DatabaseService.getPackageLiability(),
    ]);
    setTemplates(t as any[]);
    setExpiring(e as any[]);
    setLiability(l);
  }, []);

  useEffect(() => {
    const unsub = navigation.addListener('focus', load);
    load();
    return unsub;
  }, [navigation, load]);

  const reset = () =>
    setForm({ name: '', price: '', value: '', sessions: '', validity: '365', discount: '' });

  const [saving, setSaving] = React.useState(false);
  const save = async () => {
    if (saving) return;
    const price = parseAmount(form.price);
    if (!form.name.trim()) return Alert.alert('Name needed', 'Give the package a name your clients will recognise.');
    if (isNaN(price) || price <= 0) return Alert.alert('Price needed', 'Enter what the client pays for this package (e.g. 5,000).');

    const sessions = form.sessions.trim() ? parseCount(form.sessions) : 0;
    const value = form.value.trim() ? parseAmount(form.value) : 0;
    const discount = form.discount.trim() ? parseAmount(form.discount) : 0;
    const validity = form.validity.trim() ? parseCount(form.validity) : 365;
    if (isNaN(sessions) || isNaN(value) || isNaN(discount) || isNaN(validity)) {
      return Alert.alert('Check the numbers', 'Sessions, value, validity and discount must be numbers that are 0 or more.');
    }
    if (discount > 100) return Alert.alert('Check the discount', 'Discount must be between 0 and 100%.');
    if (!sessions && !value) {
      return Alert.alert(
        'What do they get?',
        'Set either a number of sessions or a rupee value the client can spend.'
      );
    }

    setSaving(true);
    try {
      await DatabaseService.addMembership({
        name: form.name.trim(),
        price,
        duration_days: validity || 365,
        max_sessions: sessions,
        discount_percent: discount,
      });
      setShowForm(false);
      reset();
      load();
    } catch (e) {
      showError(e, 'Could not save', 'Something went wrong saving the package.');
    } finally { setSaving(false); }
  };

  const retire = (p: any) =>
    Alert.alert(
      'Stop selling this?',
      `"${p.name}" will no longer appear when you sell a package. Clients who already bought it keep what they paid for.`,
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Stop selling',
          style: 'destructive',
          onPress: async () => {
            try { await DatabaseService.deactivatePackageTemplate(p.id); load(); }
            catch (e) { showError(e, 'Could not stop selling'); }
          },
        },
      ]
    );

  const renderTemplate = ({ item }: any) => {
    const worth = item.max_sessions
      ? `${item.max_sessions} sessions`
      : `${currencySymbol}${item.price} of services`;
    return (
      <View style={[st.card, { backgroundColor: c.card, borderColor: c.border }]}>
        <IconTile name="card-account-details-outline" tone="violet" size={s(42)} />
        <View style={{ flex: 1, marginLeft: s(12) }}>
          <Text style={{ color: c.text, fontSize: f(16), fontWeight: '600' }}>{item.name}</Text>
          <Text style={{ color: c.textSecondary, fontSize: f(13), marginTop: 2 }}>
            {worth} · valid {item.duration_days} days
          </Text>
          {item.discount_percent > 0 ? (
            <Text style={{ color: c.primary, fontSize: f(12), marginTop: 4 }}>
              {item.discount_percent}% off every visit
            </Text>
          ) : null}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ color: c.text, fontSize: f(17), fontWeight: '700' }}>
            {formatCurrencyFull(item.price, currencySymbol)}
          </Text>
          {canEdit && <TouchableOpacity onPress={() => retire(item)} hitSlop={10} style={{ marginTop: 6 }} accessibilityLabel="Stop selling">
            <Glyph name="dots-horizontal" size={20} color={c.textMuted} />
          </TouchableOpacity>}
        </View>
      </View>
    );
  };

  const renderExpiring = ({ item }: any) => {
    const days = Math.ceil(
      (new Date(item.end_date).getTime() - Date.now()) / 86400000
    );
    return (
      <View style={[st.card, { backgroundColor: c.card, borderColor: c.border }]}>
        <IconTile name="clock-alert-outline" tone={days <= 7 ? 'rose' : 'amber'} size={s(42)} />
        <View style={{ flex: 1, marginLeft: s(12) }}>
          <Text style={{ color: c.text, fontSize: f(15), fontWeight: '600' }}>
            {item.client_name}
          </Text>
          <Text style={{ color: c.textSecondary, fontSize: f(13), marginTop: 2 }}>
            {item.name} · {days <= 0 ? 'expired' : `${days} days left`}
          </Text>
        </View>
        <Button
          label="Remind"
          variant="outline"
          full={false}
          size="sm"
          onPress={() => navigation.navigate('ClientDetail', { clientId: item.client_id })}
        />
      </View>
    );
  };

  return (
    <SafeScreen>
      <ScreenHeader
        title="Packages"
        onBack={() => navigation.goBack()}
        right={canEdit ? (
          <TouchableOpacity onPress={() => { reset(); setShowForm(true); }} hitSlop={10} accessibilityLabel="Create a package">
            <Glyph name="plus" size={26} color={c.primary} />
          </TouchableOpacity>
        ) : undefined}
      />

      <View style={[st.liability, { backgroundColor: c.card, borderColor: c.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.textSecondary, fontSize: f(13) }}>
            Unused package value
          </Text>
          <Text style={{ color: c.text, fontSize: f(26), fontWeight: '700', marginTop: 2 }}>
            {formatCurrencyFull(liability.amount, currencySymbol)}
          </Text>
          <Text style={{ color: c.textMuted, fontSize: f(12), marginTop: 4 }}>
            Across {liability.count} active package{liability.count === 1 ? '' : 's'}. You have
            been paid for this but not yet done the work.
          </Text>
        </View>
      </View>

      <View style={st.tabs}>
        {([
          ['templates', 'Your packages'],
          ['expiring', `Expiring (${expiring.length})`],
        ] as [Tab, string][]).map(([id, label]) => (
          <TouchableOpacity
            key={id}
            onPress={() => setTab(id)}
            style={[
              st.tab,
              { borderColor: tab === id ? c.primary : 'transparent' },
            ]}
          >
            <Text
              style={{
                color: tab === id ? c.primary : c.textSecondary,
                fontSize: f(14),
                fontWeight: tab === id ? '600' : '400',
              }}
            >
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'templates' ? (
        <FlatList
          data={templates}
          keyExtractor={(i) => String(i.id)}
          renderItem={renderTemplate}
          contentContainerStyle={{ padding: s(16), paddingBottom: s(90) }}
          ListEmptyComponent={
            <EmptyState
              icon="card-account-details-outline"
              title="Sell your first package"
              subtitle={`A package is money up front: the client pays ${fmtMoney(localPrice(10000), { whole: true })} today and gets ${fmtMoney(localPrice(12000), { whole: true })} of services over the year. Set one up and offer it at the counter.`}
              actionLabel={canEdit ? 'Create a package' : undefined}
              onAction={canEdit ? () => { reset(); setShowForm(true); } : undefined}
            />
          }
        />
      ) : (
        <FlatList
          data={expiring}
          keyExtractor={(i) => String(i.id)}
          renderItem={renderExpiring}
          contentContainerStyle={{ padding: s(16), paddingBottom: s(90) }}
          ListEmptyComponent={
            <EmptyState
              icon="check-circle-outline"
              title="Nothing expiring"
              subtitle="No client packages run out in the next 30 days."
            />
          }
        />
      )}

      <BottomSheet visible={showForm} onClose={() => setShowForm(false)} title="New package">
        <ScrollView keyboardShouldPersistTaps="handled">
          <Input
            label="Package name"
            value={form.name}
            onChangeText={(v: string) => setForm({ ...form, name: v })}
            placeholder="Gold Hair Care"
          />
          <Input
            label="Price the client pays"
            value={form.price}
            onChangeText={(v: string) => setForm({ ...form, price: v })}
            keyboardType="numeric"
            placeholder="10000"
          />

          <Text style={{ color: c.textSecondary, fontSize: f(13), marginTop: s(8), marginBottom: s(6) }}>
            Then give them either a number of sessions or a rupee value to spend.
          </Text>

          <Input
            label="Number of sessions"
            value={form.sessions}
            onChangeText={(v: string) => setForm({ ...form, sessions: v })}
            keyboardType="numeric"
            placeholder="12"
          />
          <Input
            label="Or service value they can spend"
            value={form.value}
            onChangeText={(v: string) => setForm({ ...form, value: v })}
            keyboardType="numeric"
            placeholder="12000"
          />
          <Input
            label="Valid for (days)"
            value={form.validity}
            onChangeText={(v: string) => setForm({ ...form, validity: v })}
            keyboardType="numeric"
          />
          <Input
            label="Extra discount on each visit (%)"
            value={form.discount}
            onChangeText={(v: string) => setForm({ ...form, discount: v })}
            keyboardType="numeric"
            placeholder="0"
          />

          <Button label={saving ? "Saving…" : "Save package"} onPress={save} loading={saving} disabled={saving} style={{ marginTop: s(16) }} />
        </ScrollView>
      </BottomSheet>
    </SafeScreen>
  );
};

const st = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: 14,
    marginBottom: 10,
  },
  liability: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: 16,
    marginHorizontal: 16,
    marginTop: 8,
  },
  tabs: { flexDirection: 'row', paddingHorizontal: 16, marginTop: 16 },
  tab: { paddingVertical: 10, paddingHorizontal: 14, borderBottomWidth: 2 },
});

export default PackagesScreen;
