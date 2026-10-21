import React, { useCallback, useEffect, useState } from 'react';
import { View, ScrollView, TouchableOpacity, Alert, Share, Switch, Linking, ActivityIndicator } from 'react-native';
import { Text } from '../theme/Text';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeScreen } from '../components/SafeScreen';
import { Card, Button, Input, SectionLabel, Pill, ListRow, BottomSheet, SegmentedTabs } from '../components/UI';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { DBX } from '../database/Database';
import { BranchSyncService, SyncConfig, SyncLogEntry } from '../services/BranchSyncService';
import { BRANCH_SYNC_SCRIPT } from '../services/sync/scriptSource';
import { FeatureGate } from '../utils/featureGate';
import * as Clipboard from 'expo-clipboard';
import { DeepLinkService } from '../services/DeepLinkService';
import { CLOUD_TEMPLATE_URL } from '../config/sales';
import { appLocale } from '../config/regions';

const ago = (ms: number) => {
  if (!ms) return 'never';
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
};

export default function BranchHubScreen() {
  const { colors: c } = useTheme();
  const nav = useNavigation<any>();
  const { can } = useAuth();
  const [st, setSt] = useState<{ cfg: SyncConfig | null; lastPush: number; lastBackup: number; lastPull: number; log: SyncLogEntry[] } | null>(null);
  const [multi, setMulti] = useState(false);
  const [busy, setBusy] = useState<string>('');
  const [mode, setMode] = useState<'hq' | 'join'>('hq');
  const [url, setUrl] = useState('');
  const [chainName, setChainName] = useState('');
  const [branchName, setBranchName] = useState('');
  const [code, setCode] = useState('');
  const [pushSelf, setPushSelf] = useState(true);
  const [showGuide, setShowGuide] = useState(false);
  const [backups, setBackups] = useState<any[] | null>(null);
  const [found, setFound] = useState(false);   // arrived from the QR / WhatsApp link
  const [advanced, setAdvanced] = useState(false);
  const oneTap = BranchSyncService.hostedAvailable();
  const [ownGoogle, setOwnGoogle] = useState(false);   // advanced: owner's own Apps Script
  const [asOwner, setAsOwner] = useState(false);       // joining: this is the owner's (new) phone
  const [ownerRestore, setOwnerRestore] = useState(false); // restore list opened from the new-phone flow

  const load = useCallback(async () => {
    const s = await BranchSyncService.status();
    setSt(s);
    if (!s.cfg) {
      const p: any = await DBX.getSalonProfile().catch(() => ({}));
      setChainName(v => v || p?.name || '');
      setBranchName(v => v || (p?.city ? `${p.city} branch` : 'Main branch'));
      const pend = await DeepLinkService.pending();
      if (pend.connectUrl) { setUrl(pend.connectUrl); setMode('hq'); setFound(true); }
      else if (pend.joinCode) { setCode(pend.joinCode); setMode('join'); setFound(true); }
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { FeatureGate.canAccess('hasMultiLocation').then(setMulti).catch(() => {}); }, []);
  useEffect(() => DeepLinkService.onLink(() => { load(); }), [load]);

  async function pasteInto(kind: 'url' | 'code') {
    const t = String(await Clipboard.getStringAsync().catch(() => '') || '').trim();
    const urlMatch = t.match(/https:\/\/script\.google(?:usercontent)?\.com\/[^\s?#]+/);
    const codeMatch = t.replace(/\s+/g, '').match(/SBXJOIN1\.[A-Za-z0-9_-]+/);
    if (kind === 'url' && urlMatch) { setUrl(urlMatch[0]); setFound(true); return; }
    if (kind === 'code' && codeMatch) { setCode(codeMatch[0]); setFound(true); return; }
    Alert.alert('Nothing to paste', kind === 'url' ? 'Copy the link that ends with /exec first.' : 'Copy the join code or join link from WhatsApp first.');
  }

  async function run(label: string, fn: () => Promise<any>) {
    setBusy(label);
    try { await fn(); } catch (e: any) { Alert.alert('Could not complete', e?.message || String(e)); }
    finally { setBusy(''); load(); }
  }

  const cfg = st?.cfg;

  async function shareScript() {
    await Share.share({ title: 'SaloonBossX Cloud Bridge script', message: BRANCH_SYNC_SCRIPT });
  }
  /** The join code doubles as the recovery key for a new / lost phone. */
  async function shareRecovery() {
    const jc = await BranchSyncService.joinCode();
    await Share.share({
      message: `🔐 SaloonBossX recovery key — ${cfg?.chainName || 'my salon'}\n\nKeep this message. If this phone is lost or changed: install SaloonBossX → Settings → Branches & Cloud → "Join / new phone" → paste this key → Restore from cloud.\n\n${jc}\n\n⚠️ Do not share with anyone else.`,
    });
    await DBX.setSetting('cloud_recovery_saved', String(Date.now())).catch(() => {});
  }

  async function turnOnCloud() {
    await run('onetap', async () => {
      await BranchSyncService.enableCloud({ chainName, branchName });
      await DeepLinkService.clear();
      Alert.alert('Cloud is ON ✅', 'Your data now backs up every day, encrypted — only your phones can read it.\n\nLast step (10 sec): save your recovery key on WhatsApp, so a lost phone never means lost data.', [
        { text: 'Later', style: 'cancel' },
        { text: 'Save recovery key', onPress: () => shareRecovery().catch(() => {}) },
      ]);
    });
  }

  async function shareJoin() {
    const jc = await BranchSyncService.joinCode();
    // The code sits after "#", so it never reaches any server; the page reads it in the browser.
    const link = cfg ? `${cfg.url}?join=1#${jc}` : '';
    await Share.share({
      message: `SaloonBossX — join ${cfg?.chainName || 'our salons'} 💇\n\n1️⃣ Install & activate SaloonBossX on the branch phone\n2️⃣ Tap this link on that phone → "Open in SaloonBossX":\n${link}\n\nOr paste this code in Settings → Branches & Cloud → Join as a branch:\n${jc}\n\n⚠️ Keep this private — anyone with it can read the chain's data.`,
    });
  }

  if (!st) return <SafeScreen><ActivityIndicator color={c.primary} style={{ marginTop: 60 }} /></SafeScreen>;

  return (
    <SafeScreen keyboard>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        {/* Hero */}
        <View style={{ backgroundColor: c.brandInk, borderRadius: 22, padding: 18, marginBottom: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <MaterialCommunityIcons name="google-drive" size={26} color={c.brandGold} />
            <Text style={{ color: '#fff', fontSize: 18, fontWeight: '900' }}>Branches & Cloud</Text>
          </View>
          <Text style={{ color: '#CFC8B8', fontSize: 13, lineHeight: 19 }}>
            Every salon works offline. When internet is available, it syncs <Text style={{ color: c.brandGold, fontWeight: '800' }}>encrypted</Text> to the free cloud — so you can watch all salons from one phone, take online bookings, and never lose data if a phone is lost.
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
            {['Free — no monthly fee', 'Encrypted backups', 'Only you can read it', 'Works on 2G/3G'].map(x => (
              <View key={x} style={{ backgroundColor: '#ffffff14', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
                <Text style={{ color: '#F0E6D2', fontSize: 11, fontWeight: '700' }}>✓ {x}</Text>
              </View>
            ))}
          </View>
        </View>

        {!cfg ? (
          <>
            <SegmentedTabs value={mode} onChange={k => setMode(k as any)} style={{ marginBottom: 14 }}
              tabs={[{ key: 'hq', label: 'Owner / Head office' }, { key: 'join', label: 'Join / new phone' }]} />

            {mode === 'hq' && oneTap && !ownGoogle && !(found && url) ? (
              <>
                <Card style={{ borderWidth: 1.5, borderColor: c.success }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <MaterialCommunityIcons name="cloud-check" size={24} color={c.success} />
                    <Text style={{ color: c.text, fontWeight: '900', fontSize: 17 }}>Turn on free cloud — 1 tap</Text>
                  </View>
                  <Text style={{ color: c.textMuted, fontSize: 12.5, marginBottom: 14, lineHeight: 18 }}>
                    Daily encrypted backup, online booking{multi ? ', and all your branches on one screen' : ''}. No Google login, no setup, no monthly fee.
                  </Text>
                  <Input label="Salon / brand name" icon="store-outline" value={chainName} onChangeText={setChainName} placeholder="e.g. Glow Salon" />
                  <Input label="This salon's area / branch" icon="map-marker-outline" value={branchName} onChangeText={setBranchName} placeholder="e.g. Vashi" />
                  <Button label={busy === 'onetap' ? 'Turning on… (10–20 sec)' : 'Turn on cloud'} icon="cloud-upload" color={c.success} size="lg"
                    loading={busy === 'onetap'} onPress={turnOnCloud} />
                </Card>
                <Text style={{ color: c.textMuted, fontSize: 11.5, textAlign: 'center', lineHeight: 17 }}>
                  🔒 Encrypted on this phone before upload — nobody else, not even us, can read your bills or customers.
                </Text>
                <TouchableOpacity onPress={() => setOwnGoogle(true)} style={{ paddingVertical: 12 }}>
                  <Text style={{ color: c.primary, fontWeight: '700', textAlign: 'center' }}>Advanced: use my own Google account instead</Text>
                </TouchableOpacity>
              </>
            ) : mode === 'hq' ? (
              found && url ? (
                <Card style={{ borderWidth: 1.5, borderColor: c.success }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <MaterialCommunityIcons name="check-decagram" size={22} color={c.success} />
                    <Text style={{ color: c.text, fontWeight: '900', fontSize: 16 }}>Your cloud is ready</Text>
                  </View>
                  <Text style={{ color: c.textMuted, fontSize: 12.5, marginBottom: 14 }}>Just confirm the names and tap Connect.</Text>
                  <Input label="Business / chain name" icon="store-outline" value={chainName} onChangeText={setChainName} placeholder="e.g. Glow Salons" />
                  <Input label="Name of THIS salon" icon="map-marker-outline" value={branchName} onChangeText={setBranchName} placeholder="e.g. Vashi" />
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: c.text, fontWeight: '700' }}>Bills are also made on this phone</Text>
                      <Text style={{ color: c.textMuted, fontSize: 12 }}>Turn off if this phone only watches branches</Text>
                    </View>
                    <Switch value={pushSelf} onValueChange={setPushSelf} trackColor={{ true: c.primary + '70' }} thumbColor={pushSelf ? c.primary : '#ccc'} />
                  </View>
                  <Button label="Connect" icon="cloud-check-outline" color={c.success} loading={busy === 'setup'}
                    onPress={() => run('setup', async () => {
                      await BranchSyncService.setupHQ({ url, chainName, branchName, pushSelf });
                      await DeepLinkService.clear();
                      Alert.alert('Connected ✅', multi
                        ? 'Backup is on. Next: tap "Share join link" and send it to each branch phone on WhatsApp.'
                        : 'Your data is now backed up to your Google Drive every day, encrypted. You can also turn on Online Booking.');
                    })} />
                  <Button label="Use a different link" size="sm" variant="ghost" onPress={() => { setFound(false); setUrl(''); DeepLinkService.clear(); }} />
                </Card>
              ) : (
                <>
                  <Text style={{ color: c.textMuted, fontSize: 12.5, marginBottom: 10 }}>
                    Free, one time, about 3 minutes — easiest on a laptop, works on a phone too.{multi ? '' : ' Your plan includes encrypted Drive backup and online booking; seeing several branches needs the Chain plan.'}
                  </Text>
                  {[
                    {
                      n: 1, t: 'Create your free cloud',
                      d: CLOUD_TEMPLATE_URL ? 'Opens Google → tap "Make a copy". It goes into YOUR Google Drive.' : 'Open script.google.com in your Google account and paste the script (tap "Step-by-step" for help).',
                      btn: CLOUD_TEMPLATE_URL ? { label: 'Create my free cloud', icon: 'google-drive', on: () => Linking.openURL(CLOUD_TEMPLATE_URL) } : { label: 'Step-by-step', icon: 'help-circle-outline', on: () => setShowGuide(true) },
                    },
                    {
                      n: 2, t: CLOUD_TEMPLATE_URL ? 'In the copy: ☁️ SaloonBossX → Set up' : 'Deploy it as a Web app',
                      d: CLOUD_TEMPLATE_URL ? 'A panel opens on the right. Allow access, then follow its 2 short steps (one Deploy click).' : 'Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone → Deploy.',
                    },
                    {
                      n: 3, t: 'Scan the QR with this phone’s camera',
                      d: 'Tap "Open in SaloonBossX" — this screen fills itself in. On a phone? Copy the link ending in /exec and tap Paste.',
                      btn: { label: 'Paste link', icon: 'content-paste', on: () => pasteInto('url') },
                    },
                  ].map(step => (
                    <Card key={step.n}>
                      <View style={{ flexDirection: 'row', gap: 12 }}>
                        <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ color: c.onPrimary, fontWeight: '900' }}>{step.n}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: c.text, fontWeight: '800', fontSize: 15 }}>{step.t}</Text>
                          <Text style={{ color: c.textMuted, fontSize: 12.5, marginTop: 3, lineHeight: 18 }}>{step.d}</Text>
                          {step.btn && <Button label={step.btn.label} icon={step.btn.icon} size="sm" full={false} style={{ marginTop: 10 }} onPress={step.btn.on} />}
                        </View>
                      </View>
                    </Card>
                  ))}
                  <TouchableOpacity onPress={() => setAdvanced(a => !a)} style={{ paddingVertical: 10 }}>
                    <Text style={{ color: c.primary, fontWeight: '700', textAlign: 'center' }}>{advanced ? 'Hide' : 'Type the link instead'}</Text>
                  </TouchableOpacity>
                  {advanced && (
                    <Card>
                      <Input label="Google Apps Script link" icon="link-variant" value={url} onChangeText={setUrl} placeholder="https://script.google.com/macros/s/…/exec" autoCapitalize="none" autoCorrect={false} />
                      <Button label="Continue" icon="arrow-right" disabled={!/^https:\/\/script\.google/.test(url.trim())} onPress={() => setFound(true)} />
                      <Button label="Send the script to myself" icon="send" size="sm" variant="ghost" onPress={shareScript} />
                    </Card>
                  )}
                </>
              )
            ) : (
              <Card>
                <Text style={{ color: c.text, fontWeight: '800', fontSize: 15, marginBottom: 4 }}>Join your head office</Text>
                <Text style={{ color: c.textMuted, fontSize: 12.5, marginBottom: 14, lineHeight: 18 }}>
                  {found ? 'Join code received ✅ — name this branch and tap Join.' : 'Ask the owner to tap "Share join link" and send it on WhatsApp. Tap that link on THIS phone — or copy it and tap Paste.'}
                </Text>
                {!found && <Button label="Paste join link / code" icon="content-paste" variant="subtle" style={{ marginBottom: 12 }} onPress={() => pasteInto('code')} />}
                {found ? null : <Input label="Join code" icon="key-variant" value={code} onChangeText={setCode} placeholder="SBXJOIN1.…" autoCapitalize="none" autoCorrect={false} multiline style={{ minHeight: 60 }} />}
                <Input label={asOwner ? 'Name of this salon' : 'Name of this branch'} icon="map-marker-outline" value={branchName} onChangeText={setBranchName} placeholder="e.g. Kharghar" />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.text, fontWeight: '700' }}>This is the owner’s new phone</Text>
                    <Text style={{ color: c.textMuted, fontSize: 12 }}>Phone changed or lost? Turn on, join, then restore your data</Text>
                  </View>
                  <Switch value={asOwner} onValueChange={setAsOwner} trackColor={{ true: c.primary + '70' }} thumbColor={asOwner ? c.primary : '#ccc'} />
                </View>
                <Button label={asOwner ? 'Connect & find my backups' : 'Join chain'} icon="link" loading={busy === 'join'} disabled={!code.trim()}
                  onPress={() => run('join', async () => {
                    await BranchSyncService.joinWithCode(code, branchName, { asOwner });
                    await DeepLinkService.clear();
                    if (asOwner) {
                      const list = await BranchSyncService.listCloudBackups(true).catch(() => []);
                      setOwnerRestore(true);
                      setBackups(list);
                      if (!list.length) Alert.alert('Connected ✅', 'No cloud backups found yet for this key.');
                    } else {
                      Alert.alert('Joined ✅', 'This branch now sends its figures and an encrypted daily backup to head office whenever internet is available.');
                    }
                  })} />
              </Card>
            )}
          </>
        ) : (
          <>
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ width: 46, height: 46, borderRadius: 15, backgroundColor: c.successLight, alignItems: 'center', justifyContent: 'center' }}>
                  <MaterialCommunityIcons name={cfg.isHQ ? 'office-building-marker' : 'storefront-outline'} size={24} color={c.success} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.text, fontWeight: '900', fontSize: 16 }}>{cfg.branchName}</Text>
                  <Text style={{ color: c.textMuted, fontSize: 12.5 }}>{cfg.chainName} · {cfg.isHQ ? 'Head office' : 'Branch'}</Text>
                </View>
                <Pill label="Connected" tone="success" />
              </View>
              <View style={{ flexDirection: 'row', marginTop: 14, gap: 8 }}>
                {[
                  { l: 'Figures sent', v: ago(st.lastPush) },
                  { l: 'Cloud backup', v: ago(st.lastBackup) },
                  ...(cfg.isHQ ? [{ l: 'Branches pulled', v: ago(st.lastPull) }] : []),
                ].map(x => (
                  <View key={x.l} style={{ flex: 1, backgroundColor: c.surface, borderRadius: 12, padding: 10 }}>
                    <Text style={{ color: c.text, fontWeight: '800', fontSize: 13 }}>{x.v}</Text>
                    <Text style={{ color: c.textMuted, fontSize: 11 }}>{x.l}</Text>
                  </View>
                ))}
              </View>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
                <Button label="Sync now" icon="sync" size="sm" style={{ flex: 1 }} loading={busy === 'sync'}
                  onPress={() => run('sync', async () => { const r = await BranchSyncService.syncNow({ force: true }); Alert.alert(r.ok ? 'Synced' : 'Not synced', r.message); })} />
                <Button label="Backup now" icon="cloud-upload-outline" size="sm" variant="subtle" style={{ flex: 1 }} loading={busy === 'backup'}
                  onPress={() => run('backup', async () => { const r = await BranchSyncService.backupNow(); Alert.alert('Done', r.message); })} />
              </View>
            </Card>

            {cfg.isHQ && (
              <>
                <SectionLabel style={{ marginTop: 8 }}>Head office</SectionLabel>
                <Card padded={false}>
                  {multi && can('branches.view') && <ListRow icon="view-dashboard-outline" title="HQ Dashboard" subtitle="All branches: today, month, staff, stock, alerts" onPress={() => nav.navigate('HQDashboard')} />}
                  <ListRow icon="shield-key-outline" iconTone="danger" title="Save recovery key" subtitle="On WhatsApp to yourself — needed if this phone is lost" onPress={() => run('rk', shareRecovery)} />
                  {multi && <ListRow icon="share-variant" iconTone="success" title="Add a branch phone" subtitle="Send the join link on WhatsApp — the branch taps it" onPress={() => run('share', shareJoin)} />}
                  {multi && <ListRow icon="tag-multiple-outline" iconTone="warning" title="Publish price list to all branches" subtitle="Branches get your services & prices on their next sync"
                    onPress={() => Alert.alert('Publish price list?', 'Every branch will update its services and prices to match this phone on its next sync.', [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Publish', onPress: () => run('catalog', async () => { const r = await BranchSyncService.publishCatalog(); Alert.alert('Published', `${r.count} services sent to all branches.`); }) },
                    ])} />}
                  {cfg.sheetUrl ? <ListRow icon="google-spreadsheet" iconTone="accent" title="Open Google Sheet dashboard" subtitle="Watch all branches on a laptop too" onPress={() => Linking.openURL(cfg.sheetUrl!)} /> : null}
                  {cfg.folderUrl ? <ListRow icon="folder-google-drive" iconTone="info" title="Open Drive folder" subtitle="Backups & branch files" onPress={() => Linking.openURL(cfg.folderUrl!)} last /> : null}
                </Card>
                {!multi && (
                  <Card style={{ backgroundColor: c.warningLight }}>
                    <Text style={{ color: c.warning, fontWeight: '800' }}>Have 2 or more salons?</Text>
                    <Text style={{ color: c.textSecondary, fontSize: 12.5, marginTop: 4 }}>Upgrade to the Chain plan to see every branch on one screen, compare staff and push one price list.</Text>
                  </Card>
                )}
              </>
            )}

            <SectionLabel style={{ marginTop: 8 }}>Settings</SectionLabel>
            <Card>
              {[
                { k: 'autoSync', l: 'Sync automatically', h: 'When the app is opened or closed, every 15 min at most' },
                { k: 'cloudBackup', l: 'Daily encrypted backup to Drive', h: `Last ${cfg.hosted ? 7 : 14} days kept. Only your phones can decrypt.` },
                ...(!cfg.isHQ ? [{ k: 'acceptCatalog', l: 'Accept price list from head office', h: 'Services & prices follow HQ' }] : []),
                ...(cfg.isHQ ? [{ k: 'pushSelf', l: 'This phone also makes bills', h: 'Send this phone’s own figures as a branch' }] : []),
              ].map((o, i, arr) => (
                <View key={o.k} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: i < arr.length - 1 ? 0.5 : 0, borderBottomColor: c.divider }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.text, fontWeight: '700' }}>{o.l}</Text>
                    <Text style={{ color: c.textMuted, fontSize: 12 }}>{o.h}</Text>
                  </View>
                  <Switch value={!!(cfg as any)[o.k]} onValueChange={async v => { await BranchSyncService.saveConfig({ ...cfg, [o.k]: v } as SyncConfig); load(); }}
                    trackColor={{ true: c.primary + '70' }} thumbColor={(cfg as any)[o.k] ? c.primary : '#ccc'} />
                </View>
              ))}
            </Card>

            <SectionLabel style={{ marginTop: 8 }}>Restore</SectionLabel>
            <Card padded={false}>
              <ListRow icon="cloud-download-outline" iconTone="info" title="Restore from cloud" subtitle="New phone or lost data? Pick a cloud backup"
                onPress={() => run('list', async () => { setOwnerRestore(false); setBackups(await BranchSyncService.listCloudBackups(true)); })} />
              <ListRow icon="lan-connect" title="Test connection" subtitle={cfg.hosted ? 'SaloonBossX free cloud' : cfg.url.replace(/^https:\/\//, '').slice(0, 48) + '…'}
                onPress={() => run('test', async () => Alert.alert('Cloud', await BranchSyncService.testConnection()))} last />
            </Card>

            <SectionLabel style={{ marginTop: 8 }}>Activity</SectionLabel>
            <Card padded={false}>
              {st.log.length === 0 ? <Text style={{ color: c.textMuted, padding: 16 }}>Nothing yet.</Text> :
                st.log.slice(0, 12).map((l, i) => (
                  <View key={i} style={{ flexDirection: 'row', gap: 10, padding: 12, borderBottomWidth: 0.5, borderBottomColor: c.divider }}>
                    <MaterialCommunityIcons name={l.ok ? 'check-circle' : 'alert-circle'} size={18} color={l.ok ? c.success : c.warning} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: c.text, fontSize: 12.5 }}>{l.msg || l.what}</Text>
                      <Text style={{ color: c.textMuted, fontSize: 11 }}>{ago(l.at)}</Text>
                    </View>
                  </View>
                ))}
            </Card>

            <Button label="Disconnect this phone" icon="link-off" variant="outline" color={c.danger} style={{ marginTop: 16 }}
              onPress={() => Alert.alert('Disconnect?', 'This phone will stop syncing. Data on the phone and in Drive is not deleted.', [
                { text: 'Cancel', style: 'cancel' }, { text: 'Disconnect', style: 'destructive', onPress: () => run('dc', () => BranchSyncService.disconnect()) },
              ])} />
          </>
        )}
      </ScrollView>

      <BottomSheet visible={showGuide} onClose={() => setShowGuide(false)} title="Get your Drive link (one time)">
        {[
          ['Open script.google.com', 'On a laptop or phone browser, signed in to the OWNER’s Google account (the Drive where data should live).'],
          ['New project → paste the script', 'Tap the button below to send the script to yourself, copy all of it, and paste it in place of the sample code. Save.'],
          ['Deploy → New deployment → Web app', 'Execute as: Me. Who has access: Anyone. Tap Deploy and allow access (Advanced → Go to project → Allow).'],
          ['Copy the Web app URL', 'It ends with /exec. Paste it into “Google Apps Script link” here.'],
        ].map(([t, d], i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 12, marginBottom: 14 }}>
            <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: c.onPrimary, fontWeight: '900' }}>{i + 1}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.text, fontWeight: '800' }}>{t}</Text>
              <Text style={{ color: c.textMuted, fontSize: 12.5, marginTop: 2, lineHeight: 18 }}>{d}</Text>
            </View>
          </View>
        ))}
        <Button label="Send the script to myself" icon="send" onPress={shareScript} />
        <Text style={{ color: c.textMuted, fontSize: 11.5, marginTop: 12, lineHeight: 17 }}>
          Why a script? It lets the app write to your Drive without anyone else’s server in between, and without paid APIs. You can delete it any time from script.google.com.
        </Text>
      </BottomSheet>

      <BottomSheet visible={backups !== null} onClose={() => setBackups(null)} title={ownerRestore ? 'Pick your latest backup' : 'Cloud backups'}>
        {(backups || []).length === 0 ? <Text style={{ color: c.textMuted }}>No backups in Drive yet. Tap “Backup now” first.</Text> :
          (backups || []).map(b => (
            <TouchableOpacity key={b.id} style={{ paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: c.divider }}
              onPress={() => Alert.alert('Restore this backup?', `${b.name.replace(/\.sbx$/, '')}${cfg && b.branchId !== cfg.branchId && !ownerRestore ? '\n\n⚠️ This backup is from ANOTHER branch.' : ''}\n\nALL data on this phone will be replaced. This cannot be undone.`, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Restore', style: 'destructive', onPress: () => run('restore', async () => {
                  // Only a replacement phone takes over the backup's branch identity.
                  const r = await BranchSyncService.restoreCloudBackup(b.id, ownerRestore ? b.branchId : undefined);
                  setBackups(null);
                  Alert.alert(r.success ? 'Restored ✅' : 'Restore failed', r.success ? `${r.message}\n\nClose and reopen the app to refresh every screen.` : r.message);
                }) },
              ])}>
              <Text style={{ color: c.text, fontWeight: '700' }}>{b.name.replace(/\.sbx$/, '').replace(/_/g, ' · ')}{cfg && b.branchId === cfg.branchId ? '  (this phone)' : ''}</Text>
              <Text style={{ color: c.textMuted, fontSize: 12 }}>{new Date(b.updated).toLocaleString(appLocale())} · {Math.round(b.size / 1024)} KB</Text>
            </TouchableOpacity>
          ))}
        {busy === 'restore' && <ActivityIndicator color={c.primary} style={{ marginTop: 12 }} />}
      </BottomSheet>
    </SafeScreen>
  );
}
