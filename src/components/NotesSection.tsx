/**
 * NotesSection — consultation card for a client: notes, hair formulas,
 * allergies, patch tests and before / after photos.
 *
 *   <NotesSection clientId={id} clientName="Priya" />
 *
 * Adding / deleting needs clients.edit; everyone who can open the profile
 * can read. Allergy notes also feed ClientAlertBadge (via 'client:changed').
 * Photos are copied into app storage by ClientPhotoService.savePhoto();
 * deleting a photo note removes the file too (DBX.deleteClientNote).
 */
import React from 'react';
import {
  View, TouchableOpacity, ActivityIndicator, Alert, Image, Modal, FlatList, Linking, useWindowDimensions, StatusBar,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, TextInput } from '../theme/Text';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { DatabaseService, DBX } from '../database/Database';
import { ClientPhotoService } from '../services/ClientPhotoService';
import { useTr } from '../i18n/tr';
import { formatDateTime } from '../utils/helpers';
import { Button } from './UI';
import { confirmAsync } from './formUtils';
import { useBusy } from './useBusy';
import { appEvents } from './appEvents';
import { CardLabel } from './WalletShared';

type Kind = 'note' | 'formula' | 'allergy' | 'patch_test';
type Filter = 'all' | Kind;
type Tag = 'before' | 'after' | '';

const HINT_KEY = 'client_photo_backup_hint_seen';
// The photo viewer always sits on the dark brand-ink backdrop, in light and in
// dark mode, so its text / icons are always light (c.onPrimary is near-black
// in dark mode and disappeared there).
const ON_INK = '#FFFFFF';

/**
 * Stored URIs are absolute. On iOS the app's documents folder moves on every
 * update/reinstall, so rebuild the path from the current folder + file name.
 * (On Android this returns the same path.)
 */
function photoSrc(uri: string): string {
  const u = String(uri || '');
  const i = u.indexOf('/client-photos/');
  return i >= 0 ? ClientPhotoService.folder() + u.slice(i + '/client-photos/'.length) : u;
}

export function NotesSection({ clientId, clientName }: { clientId: number; clientName?: string }) {
  const { colors: c } = useTheme();
  const tr = useTr();
  const { can, user } = useAuth();
  const canEdit = can('clients.edit');
  const by = user?.displayName || user?.username || '';

  const [rows, setRows] = React.useState<any[]>([]);
  const [state, setState] = React.useState<'loading' | 'ready' | 'error'>('loading');
  const [filter, setFilter] = React.useState<Filter>('all');
  const [text, setText] = React.useState('');
  const [tag, setTag] = React.useState<Tag>('before');
  const [broken, setBroken] = React.useState<Record<number, boolean>>({});
  const [viewer, setViewer] = React.useState<number | null>(null);
  const [showHint, setShowHint] = React.useState(false);
  const [saving, runSave] = useBusy('Note not saved');
  const [adding, runAdd] = useBusy('Photo not added');
  const [deleting, runDelete] = useBusy('Could not delete');

  const KINDS: { k: Kind; label: string; icon: string; color: string; ph: string }[] = [
    { k: 'note', label: tr('Note'), icon: 'note-text-outline', color: c.info, ph: tr('e.g. Prefers low-heat blow dry') },
    { k: 'formula', label: tr('Hair formula'), icon: 'flask-outline', color: c.accent, ph: tr('e.g. 6.0 + 20 vol, 35 min, roots only') },
    { k: 'allergy', label: tr('Allergy'), icon: 'alert-octagon-outline', color: c.danger, ph: tr('e.g. PPD hair dye, nickel') },
    { k: 'patch_test', label: tr('Patch test'), icon: 'test-tube', color: c.warning, ph: tr('e.g. 13 Oct – no reaction to shade 5') },
  ];
  const meta = (k: string) => KINDS.find(x => x.k === k) || KINDS[0];
  const composeKind: Kind = filter === 'all' ? 'note' : filter;

  const load = React.useCallback(async () => {
    if (!clientId) return;
    try { setRows(await DBX.listClientNotes(clientId)); setState('ready'); }
    catch (e) { console.warn('[notes] load', e); setState(s => (s === 'ready' ? s : 'error')); }
  }, [clientId]);

  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => {
    DatabaseService.getSetting(HINT_KEY).then(v => setShowHint(v !== '1')).catch(() => {});
  }, []);

  const photos = rows.filter(r => r.kind === 'photo' && r.photo_uri);
  const notes = rows.filter(r => r.kind !== 'photo' && (filter === 'all' || r.kind === filter));

  function changed(kind: string) {
    load();
    if (kind === 'allergy') appEvents.emit('client:changed', { id: clientId, allergy: true });
  }

  function saveNote() {
    const t = text.trim();
    if (!t) { Alert.alert(tr('Nothing to save'), tr('Write the note first.')); return; }
    runSave(async () => {
      await DBX.addClientNote({ client_id: clientId, kind: composeKind, text: t, created_by: by });
      setText('');
      changed(composeKind);
    });
  }

  function deleteNote(n: any) {
    runDelete(async () => {
      const ok = await confirmAsync(n.kind === 'photo' ? 'Delete photo' : 'Delete note',
        n.kind === 'photo' ? 'This photo will be removed from the phone. This cannot be undone.' : 'Delete this note? This cannot be undone.', 'Delete', true);
      if (!ok) return;
      await DBX.deleteClientNote(n.id); // also removes the photo file via ClientPhotoService
      if (n.kind === 'photo') setViewer(null);
      changed(n.kind);
    });
  }

  async function ensurePermission(camera: boolean): Promise<boolean> {
    const res = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (res.status === 'granted') return true;
    Alert.alert(tr('Permission needed'),
      camera ? tr('Allow camera access to take client photos.') : tr('Allow photo access to add client photos.'),
      [
        { text: tr('Cancel'), style: 'cancel' },
        ...(res.canAskAgain === false ? [{ text: tr('Open Settings'), onPress: () => { Linking.openSettings().catch(() => {}); } }] : []),
      ]);
    return false;
  }

  function addPhoto(camera: boolean) {
    runAdd(async () => {
      if (!(await ensurePermission(camera))) return;
      const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6, allowsEditing: false, exif: false };
      const result = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
      if (result.canceled || !result.assets?.length) return;
      const uri = await ClientPhotoService.savePhoto(result.assets[0].uri);
      try {
        await DBX.addClientNote({ client_id: clientId, kind: 'photo', photo_uri: uri, tag, created_by: by });
      } catch (e) {
        ClientPhotoService.deletePhoto(uri).catch(() => {});
        throw e;
      }
      load();
    }, camera ? 'Camera did not open' : 'Photo not added');
  }

  function dismissHint() {
    setShowHint(false);
    DatabaseService.setSetting(HINT_KEY, '1').catch(() => {});
  }

  const tagLabel = (t: string) => (t === 'before' ? tr('Before') : t === 'after' ? tr('After') : '');

  if (state === 'loading') return <ActivityIndicator color={c.primary} style={{ marginVertical: 24 }} />;
  if (state === 'error') return (
    <TouchableOpacity onPress={() => { setState('loading'); load(); }} style={{ backgroundColor: c.dangerLight, borderRadius: 12, padding: 14, marginBottom: 14 }}>
      <Text style={{ color: c.danger, fontWeight: '700' }}>{tr('Could not load notes. Tap to try again.')}</Text>
    </TouchableOpacity>
  );

  return (
    <View>
      {/* ── Notes ── */}
      <View style={{ backgroundColor: c.card, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: c.border, marginBottom: 14 }}>
        <CardLabel text={tr('Consultation notes')} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {([{ k: 'all', label: tr('All'), icon: 'view-list-outline', color: c.primary } as any, ...KINDS]).map((k: any) => {
            const on = filter === k.k;
            const n = k.k === 'all' ? rows.filter(r => r.kind !== 'photo').length : rows.filter(r => r.kind === k.k).length;
            return (
              <TouchableOpacity key={k.k} onPress={() => setFilter(k.k)} accessibilityRole="button" accessibilityState={{ selected: on }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 999, borderWidth: 1,
                  borderColor: on ? k.color : c.border, backgroundColor: on ? k.color + '1A' : c.surface }}>
                <MaterialCommunityIcons name={k.icon} size={14} color={on ? k.color : c.textMuted} />
                <Text style={{ color: on ? k.color : c.textSecondary, fontWeight: '700', fontSize: 12 }}>{k.label}{n ? ` ${n}` : ''}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {canEdit && (
          <View style={{ marginBottom: 6 }}>
            <TextInput value={text} onChangeText={setText} multiline maxLength={4000}
              placeholder={meta(composeKind).ph} placeholderTextColor={c.textMuted}
              style={{ backgroundColor: c.surface, color: c.text, borderRadius: 12, padding: 12, fontSize: 14, minHeight: 64, textAlignVertical: 'top',
                borderWidth: 1.5, borderColor: composeKind === 'allergy' ? c.danger + '66' : c.border }} />
            <Button label={tr('Save {kind}', { kind: meta(composeKind).label })} icon={meta(composeKind).icon} size="sm"
              color={composeKind === 'allergy' ? c.danger : undefined}
              onPress={saveNote} loading={saving} disabled={saving || !text.trim()} style={{ marginTop: 8 }} />
          </View>
        )}

        {notes.length === 0 ? (
          <Text style={{ color: c.textMuted, textAlign: 'center', paddingVertical: 14 }}>
            {filter === 'all' ? tr('No notes yet. Save hair formulas and allergies here so every stylist sees them.') : tr('Nothing saved here yet.')}
          </Text>
        ) : notes.map((n, i) => {
          const m = meta(n.kind);
          return (
            <View key={n.id} style={{ flexDirection: 'row', gap: 10, paddingVertical: 11, borderTopWidth: i || canEdit ? 0.5 : 0, borderTopColor: c.divider }}>
              <View style={{ width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: m.color + '1A' }}>
                <MaterialCommunityIcons name={m.icon as any} size={16} color={m.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: m.color, fontWeight: '800', fontSize: 11.5 }}>{m.label}</Text>
                <Text style={{ color: c.text, fontSize: 14, marginTop: 2, lineHeight: 20 }} selectable>{n.text}</Text>
                <Text style={{ color: c.textMuted, fontSize: 11, marginTop: 3 }}>{[formatDateTime(n.created_at), n.created_by].filter(Boolean).join('  •  ')}</Text>
              </View>
              {canEdit && (
                <TouchableOpacity onPress={() => deleteNote(n)} disabled={deleting} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel={tr('Delete note')}>
                  <MaterialCommunityIcons name="trash-can-outline" size={19} color={c.textMuted} />
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </View>

      {/* ── Photos ── */}
      <View style={{ backgroundColor: c.card, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: c.border, marginBottom: 14 }}>
        <CardLabel text={`${tr('Photos')}${photos.length ? ` (${photos.length})` : ''}`} />
        {canEdit && (
          <>
            <View style={{ flexDirection: 'row', gap: 6, marginBottom: 10 }}>
              {(['before', 'after', ''] as Tag[]).map(t => {
                const on = tag === t;
                return (
                  <TouchableOpacity key={t || 'none'} onPress={() => setTag(t)} accessibilityRole="button" accessibilityState={{ selected: on }}
                    style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 999, borderWidth: 1,
                      borderColor: on ? c.primary : c.border, backgroundColor: on ? c.primary : c.surface }}>
                    <Text style={{ color: on ? c.onPrimary : c.textSecondary, fontWeight: '800', fontSize: 12.5 }}>{t ? tagLabel(t) : tr('Other')}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
              <Button label={tr('Camera')} icon="camera-outline" size="sm" variant="subtle" onPress={() => addPhoto(true)} disabled={adding} loading={adding} style={{ flex: 1 }} />
              <Button label={tr('Gallery')} icon="image-outline" size="sm" variant="subtle" onPress={() => addPhoto(false)} disabled={adding} style={{ flex: 1 }} />
            </View>
          </>
        )}

        {photos.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 12 }}>
            <MaterialCommunityIcons name="image-multiple-outline" size={34} color={c.textLight} />
            <Text style={{ color: c.textMuted, marginTop: 6, textAlign: 'center' }}>{tr('No photos yet. Take a before photo, then an after photo.')}</Text>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {photos.map((p, idx) => (
              <TouchableOpacity key={p.id} onPress={() => setViewer(idx)} onLongPress={canEdit ? () => deleteNote(p) : undefined} activeOpacity={0.85} accessibilityLabel={tagLabel(p.tag) || tr('Photo')}
                style={{ width: '32%', aspectRatio: 1, borderRadius: 12, overflow: 'hidden', backgroundColor: c.surface }}>
                {broken[p.id] ? (
                  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 4 }}>
                    <MaterialCommunityIcons name="image-broken-variant" size={24} color={c.textLight} />
                    <Text style={{ color: c.textMuted, fontSize: 10, textAlign: 'center', marginTop: 2 }}>{tr('File missing')}</Text>
                  </View>
                ) : (
                  <Image source={{ uri: photoSrc(p.photo_uri) }} style={{ width: '100%', height: '100%' }} resizeMode="cover"
                    onError={() => setBroken(b => ({ ...b, [p.id]: true }))} />
                )}
                {p.tag ? (
                  <View style={{ position: 'absolute', left: 6, bottom: 6, backgroundColor: p.tag === 'after' ? c.success : c.primary, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 }}>
                    <Text style={{ color: c.onPrimary, fontSize: 10, fontWeight: '800' }}>{tagLabel(p.tag)}</Text>
                  </View>
                ) : null}
              </TouchableOpacity>
            ))}
          </View>
        )}

        {showHint && (photos.length > 0 || canEdit) && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, backgroundColor: c.surface, borderRadius: 10, padding: 10 }}>
            <MaterialCommunityIcons name="information-outline" size={16} color={c.textMuted} />
            <Text style={{ color: c.textMuted, fontSize: 11.5, flex: 1 }}>{tr('Photos stay on this phone and are not inside backups.')}</Text>
            <TouchableOpacity onPress={dismissHint} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={{ color: c.primary, fontWeight: '800', fontSize: 12 }}>{tr('Got it')}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <NotesPhotoViewer photos={photos} index={viewer} onClose={() => setViewer(null)} title={clientName}
        canDelete={canEdit} deleting={deleting} onDelete={deleteNote} tagLabel={tagLabel}
        broken={broken} onBroken={id => setBroken(b => ({ ...b, [id]: true }))} />
    </View>
  );
}

/** Full-screen, swipeable photo viewer. */
function NotesPhotoViewer({ photos, index, onClose, title, canDelete, deleting, onDelete, tagLabel, broken, onBroken }: {
  photos: any[]; index: number | null; onClose: () => void; title?: string;
  canDelete: boolean; deleting: boolean; onDelete: (p: any) => void; tagLabel: (t: string) => string;
  broken: Record<number, boolean>; onBroken: (id: number) => void;
}) {
  const { colors: c } = useTheme();
  const tr = useTr();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [cur, setCur] = React.useState(0);
  const visible = index !== null && photos.length > 0;

  React.useEffect(() => { if (index !== null) setCur(Math.min(index, Math.max(0, photos.length - 1))); }, [index, photos.length]);

  const p = photos[cur];
  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <StatusBar barStyle="light-content" />
      <View style={{ flex: 1, backgroundColor: c.brandInk }}>
        {visible && (
          <FlatList
            data={photos}
            keyExtractor={x => String(x.id)}
            horizontal pagingEnabled showsHorizontalScrollIndicator={false}
            initialScrollIndex={Math.min(index ?? 0, photos.length - 1)}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            onMomentumScrollEnd={e => setCur(Math.max(0, Math.min(photos.length - 1, Math.round(e.nativeEvent.contentOffset.x / width))))}
            renderItem={({ item }) => (
              <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
                {broken[item.id] ? (
                  <View style={{ alignItems: 'center', gap: 8 }}>
                    <MaterialCommunityIcons name="image-broken-variant" size={48} color={ON_INK} style={{ opacity: 0.6 }} />
                    <Text style={{ color: ON_INK, opacity: 0.75, textAlign: 'center' }}>{tr('File missing')}</Text>
                  </View>
                ) : (
                  <Image source={{ uri: photoSrc(item.photo_uri) }} style={{ width, height: height * 0.8 }} resizeMode="contain"
                    onError={() => onBroken(item.id)} />
                )}
              </View>
            )}
          />
        )}
        <View style={{ position: 'absolute', top: insets.top + 8, left: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <TouchableOpacity onPress={onClose} accessibilityLabel={tr('Close')} style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: c.overlay }}>
            <MaterialCommunityIcons name="close" size={22} color={ON_INK} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={{ color: ON_INK, fontWeight: '800' }} numberOfLines={1}>{[title, p ? tagLabel(p.tag) : ''].filter(Boolean).join(' · ')}</Text>
            {p ? <Text style={{ color: ON_INK, opacity: 0.75, fontSize: 12 }}>{formatDateTime(p.created_at)}  •  {cur + 1}/{photos.length}</Text> : null}
          </View>
          {canDelete && p ? (
            <TouchableOpacity onPress={() => onDelete(p)} disabled={deleting} accessibilityLabel={tr('Delete photo')}
              style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: c.overlay }}>
              {deleting ? <ActivityIndicator color={ON_INK} size="small" /> : <MaterialCommunityIcons name="trash-can-outline" size={20} color={ON_INK} />}
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

