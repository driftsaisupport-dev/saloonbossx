import React, { useState, useEffect, useContext, useCallback } from 'react';
import { View, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { Text } from '../theme/Text';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { AppContext } from '../context/AppContext';
import { DatabaseService, DBX } from '../database/Database';
import { useAuth } from '../context/AuthContext';
import { BossAI } from '../services/ai/BossAI';
import { getInitials, formatDate } from '../utils/helpers';
import { WhatsAppService } from '../services/WhatsAppService';
import { SafeScreen } from '../components/SafeScreen';
import { ScreenHeader, StatCard, Avatar, Pill, Button, EmptyState, SegmentedTabs } from '../components/UI';
import { useTr } from '../i18n/tr';
import { showError, confirmAsync } from '../components/formUtils';
import { ClientFormSheet } from '../components/ClientFormSheet';
import { CollectDueSheet } from '../components/CollectDueSheet';
import { appEvents } from '../components/appEvents';
import { WalletCard } from '../components/WalletCard';
import { PackageSection } from '../components/PackageSection';
import { NotesSection } from '../components/NotesSection';
import { ClientAlertBadge, NoShowBadge } from '../components/ClientAlertBadge';
import { money } from '../components/WalletShared';
import { useKeyboardInset } from '../components/useKeyboardInset';
import { appLocale } from '../config/regions';

type DetailTab = 'overview' | 'wallet' | 'packages' | 'notes';

export default function ClientDetailScreen({ route, navigation }: any) {
  const { colors: c } = useTheme();
  const tr = useTr();
  const { currencySymbol } = useContext(AppContext);
  const clientId: number = Number(route?.params?.clientId) || 0;
  const [client, setClient] = useState<any>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [bills,  setBills]  = useState<any[]>([]);
  const [showEdit, setShowEdit] = useState(false);
  const [dues, setDues] = useState<any[]>([]);
  const [collectOpen, setCollectOpen] = useState<any[] | null>(null);
  const [aiLine, setAiLine] = useState('');
  const [removing, setRemoving] = useState(false);
  const [tab, setTab] = useState<DetailTab>('overview');
  const { can } = useAuth();
  const canBook = can('calendar.view') && can('calendar.edit');
  // Notes tab has a text box: keep room to scroll it above the keyboard
  // (0 when the window already resized for the keyboard).
  const kb = useKeyboardInset();

  const fmt = (n: number) => `${currencySymbol}${(n || 0).toLocaleString(appLocale(), { maximumFractionDigits: 0 })}`;
  const goBack = () => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Main'));

  const load = useCallback(async () => {
    if (!clientId) { setStatus('missing'); return; }
    try {
      const cl: any = await DatabaseService.getClient(clientId);
      if (!cl) { setClient(null); setStatus('missing'); return; }
      setClient(cl);
      setStatus('ready');
      const [b, d] = await Promise.allSettled([
        DatabaseService.getBills(undefined, undefined, clientId),
        DBX.getDueBills(clientId),
      ]);
      if (b.status === 'fulfilled') setBills(((b.value as any[]) || []).slice(0, 30));
      if (d.status === 'fulfilled') setDues((d.value as any[]) || []);
      BossAI.clientSnapshot(clientId).then(r => setAiLine(r ? r.line + (r.segment ? ` · ${r.segment}` : '') + (r.overdue && r.overdue > 0 ? ` · ${r.overdue} days later than usual` : '') : '')).catch(() => {});
    } catch (e) {
      console.warn('ClientDetail load:', e);
      setStatus(s => (s === 'ready' ? s : 'error'));
    }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => appEvents.on('bill:created', () => { load(); }), [load]);
  // Wallet top-ups, allergy notes and package sales change the client row.
  useEffect(() => appEvents.on('client:changed', (p?: any) => { if (!p?.id || Number(p.id) === clientId) load(); }), [load, clientId]);

  async function deleteClient() {
    if (removing || !can('clients.delete')) return;
    const ok = await confirmAsync('Remove client', tr('Deactivate {name}? Their bill history will be preserved.', { name: client?.name || '' }), 'Remove', true);
    if (!ok) return;
    setRemoving(true);
    try {
      await DatabaseService.updateClient(clientId, { is_active: 0 });
      appEvents.emit('client:changed', { id: clientId });
      goBack();
    } catch (e) { showError(e, 'Could not remove client'); }
    finally { setRemoving(false); }
  }

  async function remindDue() {
    try {
      const total = dues.reduce((s2, b) => s2 + (b.amount_due || 0), 0);
      const p: any = await DatabaseService.getSalonProfile();
      await Promise.resolve(WhatsAppService.sendMessage(client.phone, `Hi ${client.name}, a gentle reminder from ${p?.name || 'our salon'}: ${fmt(total)} is pending.${p?.upi_id ? ` You can pay by UPI to ${p.upi_id}.` : ''} Thank you! 🙏`));
    } catch (e) { showError(e, 'WhatsApp did not open'); }
  }

  // Quick rebook: book same services as the last real (not cancelled) bill.
  // The card preview and the action use the same bill.
  const lastBill = bills.find(b => b.payment_status !== 'cancelled' && b.payment_status !== 'credit_note') || bills[0];
  const rebookItems: any[] = ((lastBill?.items || []) as any[]).filter((i: any) => i.type === 'service');
  function quickRebook() {
    if (!canBook) return;
    if (!bills.length) { Alert.alert(tr('No history'), tr('No previous bills found to rebook.')); return; }
    const items = rebookItems;
    if (!items.length) { Alert.alert(tr('No services'), tr('Last bill had no services to rebook.')); return; }
    navigation.navigate('Main', {
      screen: 'Calendar',
      params: { quickRebook: { client, items } },
    });
  }

  if (status !== 'ready' || !client) return (
    <SafeScreen>
      <ScreenHeader title={tr('Client Profile')} onBack={goBack} />
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
        {status === 'loading' ? (
          <>
            <ActivityIndicator color={c.primary} />
            <Text style={{ color: c.textMuted, marginTop: 10 }}>{tr('Loading…')}</Text>
          </>
        ) : (
          <EmptyState
            icon={status === 'missing' ? 'account-question-outline' : 'alert-circle-outline'}
            title={status === 'missing' ? tr('Client not found') : tr('Could not load this client')}
            subtitle={status === 'missing' ? tr('This client may have been removed.') : tr('Please go back and try again.')}
          />
        )}
        {status !== 'loading' && (
          <View style={{ flexDirection: 'row', gap: 10, alignSelf: 'stretch' }}>
            <Button label={tr('Go back')} variant="subtle" onPress={goBack} style={{ flex: 1 }} />
            {status === 'error' && <Button label={tr('Try again')} onPress={() => { setStatus('loading'); load(); }} style={{ flex: 1 }} />}
          </View>
        )}
      </View>
    </SafeScreen>
  );

  const TIER_COLORS: Record<string, string> = { Bronze: c.tierBronze, Silver: c.tierSilver, Gold: c.tierGold, Platinum: c.tierPlatinum };
  const tierColor = TIER_COLORS[client.loyalty_tier] || c.primary;

  return (
    <SafeScreen>
      <ScreenHeader title={client.name} onBack={goBack}
        right={can('clients.edit') ? (
          <TouchableOpacity onPress={() => setShowEdit(true)} accessibilityLabel={tr('Edit client')} style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: c.primaryLight, alignItems: 'center', justifyContent: 'center' }}>
            <MaterialCommunityIcons name="pencil" size={18} color={c.primary} />
          </TouchableOpacity>
        ) : undefined} />

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 + kb }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Allergy alert — first thing every stylist sees */}
        <ClientAlertBadge clientId={clientId} fallbackText={client.allergies} style={{ marginBottom: 12 }} />

        {/* Profile card */}
        <View style={{ backgroundColor: c.card, borderRadius: 20, padding: 20, borderWidth: 0.5, borderColor: c.borderLight, alignItems: 'center', marginBottom: 14 }}>
          <Avatar name={client.name} color={tierColor} size={72} />
          <Text style={{ color: c.text, fontSize: 20, fontWeight: '900', marginTop: 10 }}>{client.name}</Text>
          {client.is_vip ? <Text style={{ color: c.warning, fontSize: 12, fontWeight: '700', marginTop: 2 }}>⭐ {tr('VIP client')}</Text> : null}
          <NoShowBadge count={client.no_show_count} style={{ alignSelf: 'center', marginTop: 6 }} />
          <Text style={{ color: c.textMuted, fontSize: 13, marginTop: 4, textAlign: 'center' }}>
            {client.phone || tr('No phone')}  •  {tr('Member since')} {formatDate(client.created_at)}
          </Text>
          {client.loyalty_tier ? (
            <View style={{ paddingHorizontal: 16, paddingVertical: 4, borderRadius: 20, marginTop: 8, backgroundColor: tierColor + '22' }}>
              <Text style={{ color: c.text, fontWeight: '700', fontSize: 13 }}>🏆 {tr('{tier} tier', { tier: tr(client.loyalty_tier) })}</Text>
            </View>
          ) : null}
          {Number(client.wallet_balance) > 0 ? (
            <TouchableOpacity onPress={() => setTab('wallet')} accessibilityRole="button"
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, backgroundColor: c.primaryLight, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 }}>
              <MaterialCommunityIcons name="wallet-outline" size={14} color={c.primary} />
              <Text style={{ color: c.primary, fontWeight: '800', fontSize: 12.5 }}>{tr('Wallet {amt}', { amt: money(currencySymbol, client.wallet_balance) })}</Text>
            </TouchableOpacity>
          ) : null}
          {client.phone ? (
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, backgroundColor: c.successLight, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10, borderWidth: 1, borderColor: c.success + '40' }}
              onPress={() => { Promise.resolve(WhatsAppService.sendMessage(client.phone, `Hi ${client.name}!`)).catch(e => showError(e, 'WhatsApp did not open')); }}>
              <MaterialCommunityIcons name="whatsapp" size={18} color={c.success} />
              <Text style={{ color: c.success, fontWeight: '700', fontSize: 14 }}>{tr('Message on WhatsApp')}</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {!!aiLine && (
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: c.primaryLight, borderRadius: 12, padding: 12, marginBottom: 14 }}>
            <MaterialCommunityIcons name="robot-happy-outline" size={18} color={c.primary} />
            <Text style={{ color: c.primary, fontSize: 12.5, fontWeight: '600', flex: 1 }}>{aiLine}</Text>
          </View>
        )}

        {can('billing.create') && (
          <TouchableOpacity onPress={() => navigation.navigate('Billing', { client, reset: true })}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.primary, borderRadius: 14, padding: 14, marginBottom: 14 }}>
            <MaterialCommunityIcons name="receipt-text-plus-outline" size={20} color={c.onPrimary} />
            <Text style={{ color: c.onPrimary, fontWeight: '800', fontSize: 15 }}>{tr('New bill for {name}', { name: String(client.name || '').split(' ')[0] })}</Text>
          </TouchableOpacity>
        )}

        {dues.length > 0 && (
          <View style={{ backgroundColor: c.warningLight, borderRadius: 14, padding: 14, marginBottom: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 8, flexWrap: 'wrap' }}>
              <Text style={{ color: c.warning, fontWeight: '900', flex: 1 }}>{tr('Pending dues')} {fmt(dues.reduce((s2, b) => s2 + (b.amount_due || 0), 0))}</Text>
              {client.phone ? <TouchableOpacity onPress={remindDue}><Text style={{ color: c.warning, fontWeight: '800' }}>{tr('Remind on WhatsApp')}</Text></TouchableOpacity> : null}
            </View>
            {dues.map(b => (
              <View key={b.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}>
                <Text style={{ color: c.text, flex: 1, fontSize: 13 }}>#{b.bill_number} · {formatDate(b.created_at)}</Text>
                <Text style={{ color: c.text, fontWeight: '800', marginRight: 10 }}>{fmt(b.amount_due)}</Text>
                {can('billing.dues') && (
                  <TouchableOpacity onPress={() => setCollectOpen([b])} style={{ backgroundColor: c.warning, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
                    <Text style={{ color: c.onPrimary, fontWeight: '800', fontSize: 12 }}>{tr('Collect')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>
        )}

        {/* Stats row */}
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
          <StatCard label={tr('Total spent')} value={fmt(client.total_spent)} tone="primary" style={{ minWidth: 0 }} />
          <StatCard label={tr('Visits')} value={String(client.total_visits || 0)} tone="info" style={{ minWidth: 0 }} />
          <StatCard label={tr('Loyalty pts')} value={String(client.loyalty_points || 0)} tone="accent" style={{ minWidth: 0 }} />
        </View>

        <SegmentedTabs
          value={tab}
          onChange={k => setTab(k as DetailTab)}
          style={{ marginBottom: 14 }}
          tabs={[
            { key: 'overview', label: tr('Overview') },
            { key: 'wallet', label: tr('Wallet') },
            { key: 'packages', label: tr('Packages') },
            { key: 'notes', label: tr('Notes') },
          ]}
        />

        {tab === 'wallet' && (
          <WalletCard clientId={clientId} clientName={client.name} currencySymbol={currencySymbol}
            onChanged={b => setClient((cl: any) => (cl ? { ...cl, wallet_balance: b } : cl))} />
        )}
        {tab === 'packages' && (
          <PackageSection clientId={clientId} clientName={client.name} currencySymbol={currencySymbol}
            walletBalance={Number(client.wallet_balance) || 0} onChanged={load}
            onManage={can('services.view') ? () => navigation.navigate('Packages') : undefined} />
        )}
        {tab === 'notes' && <NotesSection clientId={clientId} clientName={client.name} />}

        {tab === 'overview' && (<>
        {/* Details */}
        <View style={{ backgroundColor: c.card, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: c.border, marginBottom: 14 }}>
          <Text style={{ color: c.textMuted, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 }}>{tr('Client details')}</Text>
          {[
            { label: tr('Phone'), val: client.phone },
            { label: tr('Email'), val: client.email },
            { label: tr('Gender'), val: client.gender ? tr(client.gender) : '' },
            { label: tr('Birthday'), val: client.date_of_birth ? formatDate(client.date_of_birth) : '' },
            { label: tr('Anniversary'), val: client.anniversary ? formatDate(client.anniversary) : '' },
            { label: tr('Address'), val: client.address },
            { label: tr('Notes'), val: client.notes },
            { label: tr('Referred via'), val: client.referral_source ? tr(client.referral_source) : '' },
            { label: tr('Last visit'), val: client.last_visit ? formatDate(client.last_visit) : tr('Never') },
          ].filter(d => d.val).map(({ label, val }) => (
            <View key={label} style={{ flexDirection: 'row', paddingVertical: 8, borderBottomWidth: .5, borderBottomColor: c.divider }}>
              <Text style={{ color: c.textMuted, fontSize: 13, width: 100 }}>{label}</Text>
              <Text style={{ color: c.text, fontSize: 13, flex: 1 }}>{val}</Text>
            </View>
          ))}
        </View>

        {/* Quick rebook — only for users who can open and edit the calendar */}
        {rebookItems.length > 0 && canBook && (
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.primaryLight, borderRadius: 12, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: c.primary + '40' }}
            onPress={quickRebook}>
            <MaterialCommunityIcons name="calendar-sync" size={22} color={c.primary} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.primary, fontWeight: '700', fontSize: 14 }}>{tr('Quick rebook')}</Text>
              <Text style={{ color: c.textSecondary, fontSize: 12, marginTop: 2 }} numberOfLines={2}>
                {tr('Book same as last visit')}: {rebookItems.map((i: any) => i.name).slice(0, 2).join(', ')}
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={20} color={c.primary} />
          </TouchableOpacity>
        )}

        {/* Bill history */}
        <Text style={{ color: c.textMuted, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 }}>{tr('Visit history')} ({bills.length})</Text>
        {bills.length > 0 ? bills.map((b, i) => (
          <View key={b.id ?? i} style={{ flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 13, borderBottomWidth: .5, borderBottomColor: c.divider }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.text, fontSize: 13, fontWeight: '700' }}>
                {formatDate(b.created_at)}  •  #{b.bill_number}
              </Text>
              <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 2 }} numberOfLines={2}>
                {(b.items || []).map((x: any) => x.name).join(', ') || tr('Services')}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ color: b.payment_status === 'cancelled' || b.payment_status === 'credit_note' ? c.textMuted : c.primary, fontSize: 15, fontWeight: '800', textDecorationLine: b.payment_status === 'cancelled' ? 'line-through' : 'none' }}>{fmt(b.total)}</Text>
              {b.payment_status === 'cancelled' ? <Pill label={tr('Cancelled')} tone="danger" /> : b.payment_status === 'credit_note' ? <Pill label={tr('Credit note')} tone="danger" /> : b.payment_status === 'due' && b.amount_due > 0 ? <Pill label={tr('Due')} tone="warning" /> : null}
            </View>
          </View>
        )) : <Text style={{ color: c.textMuted, textAlign: 'center', padding: 20 }}>{tr('No visits yet')}</Text>}
        </>)}

        <View style={{ height: 16 }} />
        {can('clients.delete') && (
          <Button label={tr('Remove client')} icon="account-remove-outline" variant="outline" color={c.danger} onPress={deleteClient} loading={removing} disabled={removing} />
        )}
        <View style={{ height: 20 }} />
      </ScrollView>

      <ClientFormSheet
        visible={showEdit}
        client={client}
        onClose={() => setShowEdit(false)}
        onSaved={() => load()}
        onOpenExisting={ex => navigation.push ? navigation.push('ClientDetail', { clientId: ex.id }) : navigation.navigate('ClientDetail', { clientId: ex.id })}
      />
      <CollectDueSheet visible={!!collectOpen} bills={collectOpen || []} onClose={() => setCollectOpen(null)}
        currencySymbol={currencySymbol} onCollected={() => load()} />
    </SafeScreen>
  );
}
