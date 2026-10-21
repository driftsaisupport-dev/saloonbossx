import React, { useCallback, useState } from 'react';
import { View, ScrollView, TouchableOpacity, Alert, Switch, Share, Linking, RefreshControl, ActivityIndicator } from 'react-native';
import { Text, TextInput } from '../theme/Text';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeScreen } from '../components/SafeScreen';
import { Card, Button, SectionLabel, Pill, SegmentedTabs, Chip } from '../components/UI';
import { useTheme } from '../context/ThemeContext';
import { DBX } from '../database/Database';
import { BookingService, BookingConfig, DEFAULT_BOOKING } from '../services/BookingService';
import { BranchSyncService } from '../services/BranchSyncService';
import { BRANCH_SYNC_SCRIPT } from '../services/sync/scriptSource';
import { WhatsAppService } from '../services/WhatsAppService';
import { FeatureGate } from '../utils/featureGate';
import { contactSupport, BOOKING_SITE } from '../config/sales';
import * as WebBrowser from 'expo-web-browser';
import { ReviewLinkCard } from '../components/ReviewLinkCard';
import { slugify } from '../services/BookingService';
import { showError } from '../components/formUtils';
import { useTr } from '../i18n/tr';
import { appLocale, curSym, fmtMoney } from '../config/regions';

const upgrade = () => contactSupport('Hi! I want to upgrade to Salon Pro for online booking.').then(ok => { if (!ok) Alert.alert('Upgrade', 'Settings → Licence shows the plans and how to pay.'); });

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const validHM = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

export default function OnlineBookingScreen() {
  const { colors: c } = useTheme();
  const tr = useTr();
  const nav = useNavigation<any>();
  const [tab, setTab] = useState<'requests' | 'setup'>('requests');
  const [cfg, setCfg] = useState<BookingConfig>(DEFAULT_BOOKING);
  // Unsaved edits to hours / rules: a refresh (pull, accept, decline…) must
  // not overwrite them with the stored config.
  const [dirty, setDirty] = useState(false);
  const dirtyRef = React.useRef(false);
  const editCfg = (next: BookingConfig) => { dirtyRef.current = true; setDirty(true); setCfg(next); };
  const [connected, setConnected] = useState<boolean | null>(null);
  const [scriptOld, setScriptOld] = useState(false);
  const [link, setLink] = useState('');
  const [waLink, setWaLink] = useState('');
  const [services, setServices] = useState<any[]>([]);
  const [reqs, setReqs] = useState<any[]>([]);
  const [busy, setBusy] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [allowed, setAllowed] = useState(true);
  const [hosted, setHosted] = useState(false);
  const [slugEdit, setSlugEdit] = useState<string | null>(null);
  const [test, setTest] = useState<{ ok: boolean; message: string; level?: string } | null>(null);
  const autoTested = React.useRef(false);
  const oneTap = BranchSyncService.hostedAvailable();

  const load = useCallback(async () => {
    let bc: any, sc: any, l: any, wa: any, rq: any, cat: any;
    try {
      [bc, sc, l, wa, rq, cat] = await Promise.all([
        BookingService.getConfig(), BranchSyncService.getConfig(), BookingService.bookingLink().catch(() => ''), BookingService.whatsappLink().catch(() => ''),
        DBX.getBookingRequests(), DBX.getCatalogForSync().catch(() => []),
      ]);
    } catch (e) { showError(e, 'Could not load online booking'); return; }
    if (!dirtyRef.current) setCfg(bc);
    setConnected(!!sc); setHosted(!!sc?.hosted); setLink(l); setWaLink(wa); setReqs(rq || []); setServices((cat || []).filter((s: any) => s.is_active));
    FeatureGate.canAccess('hasOnlineBooking').then(setAllowed).catch(() => {});
    if (sc && !sc.hosted) BranchSyncService.scriptVersion().then(v => setScriptOld(v < 2)).catch(() => {});
  }, []);

  /**
   * In-app browser: its own cookie jar, so the owner sees exactly what a
   * customer sees (Safari/Chrome signed in to several Google accounts is the
   * usual cause of "unable to open the file" on script.google.com links).
   */
  async function openPage(l: string) {
    try { await WebBrowser.openBrowserAsync(l); } catch { Linking.openURL(l).catch(() => {}); }
  }

  async function runTest() {
    setBusy('test');
    try { setTest(await BookingService.testLink()); }
    catch (e) { showError(e, 'Test failed', 'Could not test the link. Check the internet and try again.'); }
    finally { setBusy(''); }
  }

  async function saveSlug() {
    const v = slugify(slugEdit || '');
    if (v.length < 3) { Alert.alert('Too short', 'Use at least 3 letters, e.g. glow-salon-vashi'); return; }
    setBusy('slug');
    const before = await DBX.getSetting('booking_slug').catch(() => '');
    try {
      await DBX.setSetting('booking_slug_wanted', v);
      await DBX.setSetting('booking_last_check', '0');
      await BranchSyncService.syncBookings();
      const got = await DBX.getSetting('booking_slug');
      setSlugEdit(null);
      if (!got || got === before) Alert.alert('Link not changed', 'That name could not be used (a link can be renamed up to 5 times, and names that look like codes are not allowed). Your current link still works.');
      else Alert.alert('Link updated', got !== v ? `"${v}" was taken, so your link is …/${got}. The old link keeps working too.` : 'Your new link is ready. The old link keeps working too.');
    } catch (e: any) { Alert.alert('Saved on this phone', `${e?.message || 'No internet.'}\nIt will update on the next sync.`); }
    finally { setBusy(''); load(); }
  }

  /** The whole setup in one tap: cloud (if needed) → defaults → publish → share. */
  async function startOneTap() {
    if (!allowed) { upgrade(); return; }
    setBusy('start');
    try {
      const l = await BookingService.quickStart();
      await load();
      Alert.alert('Online booking is live ✅', 'Customers can now book 24×7. Share the link on WhatsApp, Instagram and Google Maps.\n\nNew requests appear here with a notification — accept in one tap.', [
        { text: 'Later', style: 'cancel' },
        { text: 'See my page', onPress: () => openPage(l) },
        { text: 'Share link', onPress: () => Share.share({ message: `Book your appointment online 💇‍♀️\n${l}` }).catch(() => {}) },
      ]);
    } catch (e: any) {
      if (e?.message === 'NEEDS_OWN_CLOUD') {
        Alert.alert('Connect Google Drive first', 'Your booking page lives in Google Drive. Open Branches & Cloud to connect (one time).', [
          { text: 'Cancel', style: 'cancel' }, { text: 'Open', onPress: () => nav.navigate('BranchHub') },
        ]);
      } else {
        Alert.alert('Not started yet', `${e?.message || 'Could not reach the internet.'}\n\nCheck the internet and tap again. Nothing is lost.`);
      }
    } finally { setBusy(''); }
  }

  useFocusEffect(useCallback(() => { load(); }, [load]));
  // Check the link once per visit, so a link that would fail in browsers is visible right away.
  React.useEffect(() => {
    if (link && cfg.enabled && !autoTested.current) { autoTested.current = true; BookingService.testLink().then(setTest).catch(() => {}); }
  }, [link, cfg.enabled]);

  async function pull() {
    setRefreshing(true);
    try {
      await DBX.setSetting('booking_last_check', '0');
      const n = await BranchSyncService.syncBookings();
      if (n) Alert.alert('New bookings', `${n} new request${n > 1 ? 's' : ''}.`);
    } catch (e: any) { Alert.alert('Could not check', e?.message || 'Try again when online.'); }
    finally { setRefreshing(false); load(); }
  }

  async function save(next: BookingConfig) {
    if (!validHM(next.open) || !validHM(next.close) || next.open >= next.close) { Alert.alert('Check hours', 'Use 24-hour time like 10:00 and 21:00, and closing must be after opening.'); return; }
    setBusy('save');
    try {
      await BookingService.saveConfig(next);
      dirtyRef.current = false; setDirty(false);
      setCfg(next);
      if (connected) {
        await DBX.setSetting('booking_last_check', '0');
        await BranchSyncService.syncBookings();
      }
      Alert.alert(next.enabled ? 'Online booking is live ✅' : 'Saved', next.enabled ? 'Share your booking link on WhatsApp, Instagram and Google Maps.' : 'Settings saved.');
    } catch (e: any) { Alert.alert('Saved on this phone', `${e?.message || 'Could not reach the cloud.'}\nIt will publish on the next sync.`); }
    finally { setBusy(''); load(); }
  }

  async function act(label: string, fn: () => Promise<any>) {
    setBusy(label);
    if (busy) return;
    try { await fn(); } catch (e) { showError(e, 'Could not complete'); }
    finally { setBusy(''); load(); }
  }

  const StartCard = () => (
    <Card style={{ backgroundColor: c.brandInk }}>
      <MaterialCommunityIcons name="calendar-star" size={34} color={c.brandGold} />
      <Text style={{ color: '#fff', fontWeight: '900', fontSize: 18, marginTop: 6 }}>Let customers book themselves, 24×7</Text>
      <Text style={{ color: '#ffffffcc', fontSize: 13, marginTop: 6, lineHeight: 19 }}>
        You get a booking page + QR poster. Customers pick a service and a free time from WhatsApp, Instagram or Google Maps — you confirm here in one tap. Free, no monthly fee.
      </Text>
      {!allowed ? (
        <Button label="Available in Salon Pro — upgrade" icon="crown" color={c.brandGold} style={{ marginTop: 14 }} onPress={() => upgrade()} />
      ) : (
        <Button label={busy === 'start' ? 'Starting… (10–20 sec)' : 'Start online booking — 1 tap'} icon="rocket-launch" color={c.brandGold}
          loading={busy === 'start'} style={{ marginTop: 14 }} onPress={startOneTap} />
      )}
      <Text style={{ color: '#ffffff99', fontSize: 11.5, marginTop: 8 }}>Hours {cfg.open}–{cfg.close} · change anything later in "Setup & link".</Text>
    </Card>
  );

  const newOnes = reqs.filter(r => r.status === 'new');
  const done = reqs.filter(r => r.status !== 'new').slice(0, 30);
  const statusTone: Record<string, any> = { accepted: 'success', declined: 'danger', suggested: 'warning' };

  return (
    <SafeScreen keyboard>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={pull} tintColor={c.primary} />}>
        <SegmentedTabs value={tab} onChange={k => setTab(k as any)} style={{ marginBottom: 14 }}
          tabs={[{ key: 'requests', label: `Requests${newOnes.length ? ` (${newOnes.length})` : ''}` }, { key: 'setup', label: 'Setup & link' }]} />

        {scriptOld && (
          <Card style={{ backgroundColor: c.warningLight }}>
            <Text style={{ color: c.warning, fontWeight: '900' }}>Update your Cloud Bridge script (1 minute)</Text>
            <Text style={{ color: c.textSecondary, fontSize: 12.5, marginTop: 4, lineHeight: 18 }}>
              Online booking needs the new version. Send the script to yourself, open script.google.com → your project → paste it over the old code → Save → Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy. The link stays the same.
            </Text>
            <Button label="Send the new script to myself" icon="send" size="sm" style={{ marginTop: 10 }} onPress={() => Share.share({ message: BRANCH_SYNC_SCRIPT })} />
          </Card>
        )}

        {tab === 'requests' ? (
          <>
            {!cfg.enabled && <StartCard />}
            {cfg.enabled && <Text style={{ color: c.textMuted, fontSize: 12, marginBottom: 10 }}>Pull down to check for new requests. They also arrive automatically whenever the app is opened.</Text>}

            {newOnes.length === 0 && cfg.enabled && (
              <View style={{ alignItems: 'center', paddingVertical: 30 }}>
                <MaterialCommunityIcons name="calendar-check-outline" size={44} color={c.textLight} />
                <Text style={{ color: c.textMuted, marginTop: 8 }}>No new requests right now.</Text>
              </View>
            )}

            {newOnes.map(r => (
              <Card key={r.id} style={{ borderLeftWidth: 4, borderLeftColor: c.primary }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ color: c.text, fontWeight: '900', fontSize: 16, flex: 1 }}>{r.name}</Text>
                  <Pill label="NEW" tone="primary" solid />
                </View>
                <Text style={{ color: c.text, fontWeight: '700', marginTop: 6 }}>
                  📅 {new Date(`${r.date}T00:00:00`).toLocaleDateString(appLocale(), { weekday: 'short', day: 'numeric', month: 'short' })} · {r.time} · {r.duration} min
                </Text>
                <Text style={{ color: c.textSecondary, marginTop: 3 }}>💇 {(r.services || []).map((s: any) => s.name).join(', ')} · {curSym()}{(r.services || []).reduce((a: number, s: any) => a + (Number(s.price) || 0), 0)}</Text>
                <Text style={{ color: c.textMuted, fontSize: 12.5, marginTop: 3 }}>📞 {r.phone}{r.staff_id ? ` · asked for a stylist` : ''}</Text>
                {r.note ? <Text style={{ color: c.textMuted, fontSize: 12.5, marginTop: 3 }}>📝 {r.note}</Text> : null}
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                  <Button label="Accept" icon="check" size="sm" color={c.success} style={{ flex: 1.3 }} loading={busy === `a${r.id}`}
                    onPress={() => act(`a${r.id}`, async () => { const res = await BookingService.accept(r); if (!res.ok) Alert.alert('Not added', res.message); })} />
                  <Button label="Other time" icon="clock-edit-outline" size="sm" variant="subtle" style={{ flex: 1 }} onPress={() => act(`s${r.id}`, () => BookingService.suggest(r))} />
                </View>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  <Button label="Call" icon="phone" size="sm" variant="ghost" style={{ flex: 1 }} onPress={() => WhatsAppService.call(r.phone)} />
                  <Button label="Decline" icon="close" size="sm" variant="ghost" color={c.danger} style={{ flex: 1 }}
                    onPress={() => Alert.alert('Decline this booking?', 'A polite WhatsApp message with your booking link opens.', [
                      { text: 'Cancel', style: 'cancel' }, { text: 'Fully booked', onPress: () => act(`d${r.id}`, () => BookingService.decline(r, 'full')) },
                      { text: 'Closed that day', onPress: () => act(`d${r.id}`, () => BookingService.decline(r, 'closed')) },
                    ])} />
                </View>
              </Card>
            ))}

            {done.length > 0 && <SectionLabel style={{ marginTop: 8 }}>Earlier</SectionLabel>}
            {done.map(r => (
              <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: c.divider, gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.text, fontWeight: '700' }}>{r.name}</Text>
                  <Text style={{ color: c.textMuted, fontSize: 12 }}>{r.date} {r.time} · {(r.services || []).map((s: any) => s.name).join(', ')}</Text>
                </View>
                <Pill label={r.status} tone={statusTone[r.status] || 'neutral'} />
              </View>
            ))}
          </>
        ) : (
          <>
            {!allowed && (
              <Card style={{ backgroundColor: c.warningLight }}>
                <Text style={{ color: c.warning, fontWeight: '800' }}>Online booking page is part of Salon Pro</Text>
                <Text style={{ color: c.textSecondary, fontSize: 12.5, marginTop: 4 }}>Your Solo plan includes the WhatsApp booking link and QR poster below. Upgrade to let customers pick a time themselves.</Text>
              </Card>
            )}
            {!cfg.enabled && (connected || oneTap) && allowed && <StartCard />}
            {connected === false && !oneTap && allowed && (
              <Card style={{ borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.primary }}>
                <Text style={{ color: c.text, fontWeight: '800' }}>Step 1: connect Google Drive (free, one time)</Text>
                <Text style={{ color: c.textMuted, fontSize: 12.5, marginTop: 4 }}>The booking page lives in your own Google account — no monthly fee, no server. It is the same setup as the daily backup.</Text>
                <Button label="Open Branches & Cloud" icon="google-drive" size="sm" style={{ marginTop: 10 }} onPress={() => nav.navigate('BranchHub')} />
              </Card>
            )}

            {link && cfg.enabled ? (
              <Card style={{ backgroundColor: c.brandInk }}>
                <Text style={{ color: c.brandGold, fontWeight: '900', fontSize: 12, letterSpacing: 1 }}>YOUR BOOKING LINK</Text>
                <Text selectable style={{ color: '#fff', fontSize: link.length > 60 ? 12.5 : 16, fontWeight: '800', marginTop: 6 }} numberOfLines={2}>{link.replace(/^https:\/\//, '')}</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                  <Button label="Share" icon="share-variant" size="sm" color={c.brandGold} style={{ flex: 1 }}
                    onPress={() => DBX.getSalonProfile().then((p: any) => Share.share({ message: `💇‍♀️ Book your appointment at ${p?.name || 'our salon'} — pick a service and a free time:\n${link}` })).catch(() => {})} />
                  <Button label="Open" icon="open-in-new" size="sm" variant="outline" color={c.brandGold} style={{ flex: 1 }} onPress={() => openPage(link)} />
                  <Button label="Test" icon="stethoscope" size="sm" variant="outline" color={c.brandGold} style={{ flex: 1 }} loading={busy === 'test'} onPress={runTest} />
                </View>
                {test && (
                  <View style={{ marginTop: 10, backgroundColor: '#ffffff12', borderRadius: 10, padding: 10, flexDirection: 'row', gap: 8 }}>
                    <MaterialCommunityIcons name={test.level === 'ok' ? 'check-circle' : test.level === 'warn' ? 'alert' : 'close-circle'} size={18} color={test.level === 'ok' ? '#7BD88F' : test.level === 'warn' ? '#FFD27A' : '#FFB4A9'} />
                    <Text style={{ color: '#fff', fontSize: 12.5, lineHeight: 18, flex: 1 }}>{test.message}</Text>
                  </View>
                )}
                <Button label="QR poster for the counter (PDF)" icon="qrcode" size="sm" variant="ghost" color="#fff" style={{ marginTop: 6 }}
                  onPress={() => act('poster', () => BookingService.sharePoster())} />
                {BOOKING_SITE ? (
                  slugEdit === null ? (
                    <Button label="Change link name" icon="pencil-outline" size="sm" variant="ghost" color="#ffffffaa"
                      onPress={() => DBX.getSetting('booking_slug').then(v => setSlugEdit(v || '')).catch(() => setSlugEdit(''))} />
                  ) : (
                    <View style={{ marginTop: 8 }}>
                      <Text style={{ color: '#ffffffaa', fontSize: 12, marginBottom: 6 }}>{BOOKING_SITE.replace(/^https:\/\//, '')}/<Text style={{ color: c.brandGold, fontWeight: '800' }}>{slugify(slugEdit) || '…'}</Text></Text>
                      <TextInput value={slugEdit} onChangeText={setSlugEdit} autoCapitalize="none" autoCorrect={false} placeholder="glow-salon-vashi" placeholderTextColor="#ffffff66"
                        style={{ backgroundColor: '#ffffff14', color: '#fff', borderRadius: 12, padding: 12, fontSize: 15, fontWeight: '700' }} />
                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                        <Button label="Cancel" size="sm" variant="ghost" color="#fff" style={{ flex: 1 }} onPress={() => setSlugEdit(null)} />
                        <Button label="Save link" size="sm" color={c.brandGold} style={{ flex: 1 }} loading={busy === 'slug'} onPress={saveSlug} />
                      </View>
                    </View>
                  )
                ) : null}
              </Card>
            ) : null}

            {cfg.enabled ? <ReviewLinkCard compact /> : null}

            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.text, fontWeight: '800', fontSize: 15 }}>Accept online bookings</Text>
                  <Text style={{ color: c.textMuted, fontSize: 12 }}>{connected || oneTap ? 'Customers request, you confirm' : 'Connect Google Drive first'}</Text>
                </View>
                <Switch value={cfg.enabled} disabled={(!connected && !oneTap) || !allowed || busy === 'start'}
                  onValueChange={v => (v && !cfg.enabled && (!connected || !link) ? startOneTap() : editCfg({ ...cfg, enabled: v }))} trackColor={{ true: c.primary + '70' }} thumbColor={cfg.enabled ? c.primary : c.textLight} />
              </View>
            </Card>

            <SectionLabel>Opening hours</SectionLabel>
            <Card>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {(['open', 'close'] as const).map(k => (
                  <View key={k} style={{ flex: 1 }}>
                    <Text style={{ color: c.textMuted, fontSize: 12, fontWeight: '700', marginBottom: 5 }}>{k === 'open' ? 'Opens' : 'Closes'} (24 h)</Text>
                    <TextInput value={cfg[k]} onChangeText={v => editCfg({ ...cfg, [k]: v.replace(/[^0-9:]/g, '').slice(0, 5) })} keyboardType="numbers-and-punctuation"
                      style={{ backgroundColor: c.surface, color: c.text, borderRadius: 12, padding: 12, fontSize: 16, fontWeight: '800' }} />
                  </View>
                ))}
              </View>
              <Text style={{ color: c.textMuted, fontSize: 12, fontWeight: '700', marginTop: 12, marginBottom: 6 }}>Weekly off</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {DAYS.map((d, i) => {
                  const on = cfg.closedDays.includes(i);
                  return <Chip key={d} label={d} active={on} onPress={() => editCfg({ ...cfg, closedDays: on ? cfg.closedDays.filter(x => x !== i) : [...cfg.closedDays, i] })} />;
                })}
              </View>
            </Card>

            <SectionLabel>Booking rules</SectionLabel>
            <Card>
              {[
                { k: 'slot', l: 'Start times every', opts: [15, 30, 60], fmt: (v: number) => `${v} min` },
                { k: 'leadMin', l: 'Earliest booking from now', opts: [0, 30, 60, 120, 240], fmt: (v: number) => (v ? `${v >= 60 ? v / 60 + ' h' : v + ' min'}` : 'Any') },
                { k: 'maxDays', l: 'Book up to', opts: [7, 14, 30], fmt: (v: number) => `${v} days` },
              ].map(row => (
                <View key={row.k} style={{ marginBottom: 12 }}>
                  <Text style={{ color: c.textMuted, fontSize: 12, fontWeight: '700', marginBottom: 6 }}>{row.l}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                    {row.opts.map(o => <Chip key={o} label={row.fmt(o)} active={(cfg as any)[row.k] === o} onPress={() => editCfg({ ...cfg, [row.k]: o })} />)}
                  </View>
                </View>
              ))}
              <Text style={{ color: c.textMuted, fontSize: 12, fontWeight: '700', marginBottom: 6 }}>Message on the booking page (optional)</Text>
              <TextInput value={cfg.note} onChangeText={v => editCfg({ ...cfg, note: v.slice(0, 160) })} placeholder="e.g. Bridal bookings: please call us"
                placeholderTextColor={c.textMuted} style={{ backgroundColor: c.surface, color: c.text, borderRadius: 12, padding: 12 }} />
            </Card>

            <SectionLabel>Services customers can book ({cfg.serviceKeys.length ? cfg.serviceKeys.length : 'all'})</SectionLabel>
            <Card padded={false}>
              {services.map((s, i) => {
                const on = !cfg.serviceKeys.length || cfg.serviceKeys.includes(s.sync_key);
                return (
                  <TouchableOpacity key={s.sync_key} onPress={() => {
                    const all = services.map(x => x.sync_key);
                    const cur = cfg.serviceKeys.length ? cfg.serviceKeys : all;
                    const next = on ? cur.filter(k => k !== s.sync_key) : [...cur, s.sync_key];
                    editCfg({ ...cfg, serviceKeys: next.length === all.length ? [] : next });
                  }} style={{ flexDirection: 'row', alignItems: 'center', padding: 12, borderTopWidth: i ? 0.5 : 0, borderTopColor: c.divider }}>
                    <MaterialCommunityIcons name={on ? 'checkbox-marked' : 'checkbox-blank-outline'} size={22} color={on ? c.primary : c.textLight} />
                    <Text style={{ color: c.text, flex: 1, marginLeft: 10 }}>{s.name}</Text>
                    <Text style={{ color: c.textMuted }}>{fmtMoney(s.price)} · {s.duration}m</Text>
                  </TouchableOpacity>
                );
              })}
            </Card>

            {allowed && dirty && <Text style={{ color: c.warning, fontSize: 12.5, fontWeight: '700', marginTop: 4, marginBottom: 6 }}>{tr('You have unsaved changes')}</Text>}
            {allowed && <Button label="Save & publish" icon="cloud-upload-outline" loading={busy === 'save'} style={{ marginTop: 6 }} onPress={() => save(cfg)} />}

            <SectionLabel style={{ marginTop: 18 }}>Where to put your link</SectionLabel>
            <Card>
              {[
                ['google-maps', 'Google Maps', 'Google Business Profile → Edit profile → Bookings / Appointment link → paste. Customers see a "Book" button.'],
                ['instagram', 'Instagram', 'Edit profile → Links → add link. Also add a "Book now" story highlight.'],
                ['whatsapp', 'WhatsApp Business', 'Settings → Business tools → Profile → Website. Also put it in your greeting and away messages.'],
                ['qrcode', 'Counter & mirror', 'Print the QR poster — walk-ins book their next visit before they leave.'],
              ].map(([icon, t, d]) => (
                <View key={t} style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
                  <MaterialCommunityIcons name={icon as any} size={22} color={c.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.text, fontWeight: '800' }}>{t}</Text>
                    <Text style={{ color: c.textMuted, fontSize: 12.5, lineHeight: 18 }}>{d}</Text>
                  </View>
                </View>
              ))}
            </Card>

            <SectionLabel>No internet setup? WhatsApp booking link</SectionLabel>
            <Card>
              <Text style={{ color: c.textMuted, fontSize: 12.5 }}>Works without Google Drive: opens WhatsApp to your number with a booking message ready.</Text>
              {waLink ? (
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                  <Button label="Share link" icon="whatsapp" size="sm" color={c.whatsapp} style={{ flex: 1 }} onPress={() => Share.share({ message: `Book on WhatsApp: ${waLink}` })} />
                  {!link && <Button label="QR poster" icon="qrcode" size="sm" variant="subtle" style={{ flex: 1 }} onPress={() => act('poster', () => BookingService.sharePoster())} />}
                </View>
              ) : <Text style={{ color: c.warning, fontSize: 12.5, marginTop: 8 }}>Add your salon phone in Settings → Salon Profile.</Text>}
            </Card>
            {busy === 'poster' && <ActivityIndicator color={c.primary} />}
          </>
        )}
      </ScrollView>
    </SafeScreen>
  );
}
