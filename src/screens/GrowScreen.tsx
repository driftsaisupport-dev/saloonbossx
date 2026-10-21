import React, { useCallback, useState } from 'react';
import { View, ScrollView, TouchableOpacity, Alert, Share, ActivityIndicator, RefreshControl } from 'react-native';
import { Text, TextInput } from '../theme/Text';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import { SafeScreen } from '../components/SafeScreen';
import { Card, Button, SectionLabel, SegmentedTabs, Chip } from '../components/UI';
import { useTheme } from '../context/ThemeContext';
import { DBX } from '../database/Database';
import { campaignIdeas, CampaignIdea, writeCaptions, CaptionKind } from '../services/ai/campaigns';
import { BookingService } from '../services/BookingService';

/**
 * Marketing hub: Boss AI campaign ideas from the salon's own data, the poster
 * studio, and photo/video posts with ready captions. All offline; sending goes
 * through the owner's own WhatsApp / Instagram.
 */
export default function GrowScreen() {
  const { colors: c } = useTheme();
  const nav = useNavigation<any>();
  const [tab, setTab] = useState<'ideas' | 'media'>('ideas');
  const [ideas, setIdeas] = useState<CampaignIdea[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [profile, setProfile] = useState<any>({});
  const [link, setLink] = useState('');
  // media
  const [media, setMedia] = useState<{ uri: string; type: 'image' | 'video'; duration?: number } | null>(null);
  const [capKind, setCapKind] = useState<CaptionKind>('work');
  const [service, setService] = useState('');
  const [offer, setOffer] = useState('');
  const [capIdx, setCapIdx] = useState(0);

  const load = useCallback(async () => {
    try {
      const [list, p, l] = await Promise.all([campaignIdeas(), DBX.getSalonProfile().catch(() => ({})), BookingService.bookingLink().catch(() => '')]);
      setIdeas(list); setProfile(p || {}); setLink(l);
    } catch (e: any) {
      setIdeas([]);
      Alert.alert('Could not build ideas', e?.message || 'Try again.');
    }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function pick(kind: 'image' | 'video', camera: boolean) {
    try {
      const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== 'granted') { Alert.alert('Permission needed', camera ? 'Allow the camera to record.' : 'Allow photo access to pick from your gallery.'); return; }
      const opts: ImagePicker.ImagePickerOptions = { mediaTypes: [kind === 'video' ? 'videos' : 'images'], quality: 0.9, videoMaxDuration: 60, allowsEditing: kind === 'image' };
      const res = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      setMedia({ uri: a.uri, type: a.type === 'video' ? 'video' : 'image', duration: a.duration ? Math.round(a.duration / 1000) : undefined });
    } catch (e: any) { Alert.alert('Could not open', e?.message || 'Try again.'); }
  }

  const captions = writeCaptions({ kind: capKind, salon: profile?.name || 'our salon', city: profile?.city, service, offer, phone: profile?.phone, bookingLink: link });
  const caption = captions[capIdx % captions.length];

  async function shareMedia() {
    if (!media) return;
    try {
      // Instagram / WhatsApp ignore text passed with a file, so the caption goes to the clipboard.
      await Clipboard.setStringAsync(caption);
      Alert.alert('Caption copied ✅', 'Pick Instagram, WhatsApp Status or Facebook, then long-press → Paste to add the caption.', [
        { text: 'Continue', onPress: async () => {
          try {
            if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this phone.');
            await Sharing.shareAsync(media.uri, { mimeType: media.type === 'video' ? 'video/mp4' : 'image/jpeg', dialogTitle: 'Post to…' });
            await (DBX as any).logMarketingPost({ template: media.type === 'video' ? 'Video post' : 'Photo post', title: caption.split('\n')[0], message: caption }).catch(() => {});
          } catch (e: any) { Alert.alert('Could not share', e?.message || 'Try again.'); }
        } },
      ]);
    } catch (e: any) { Alert.alert('Could not share', e?.message || 'Try again.'); }
  }

  const tones: Record<string, string> = { primary: c.primary, success: c.success, warning: c.warning, danger: c.danger, info: c.info };

  return (
    <SafeScreen keyboard>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled"
        refreshControl={tab === 'ideas' ? <RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={c.primary} /> : undefined}>
        <SegmentedTabs value={tab} onChange={k => setTab(k as any)} style={{ marginBottom: 14 }}
          tabs={[{ key: 'ideas', label: '✨ Campaigns' }, { key: 'media', label: '🎬 Photo & video' }]} />

        {tab === 'ideas' ? (
          <>
            <Card style={{ backgroundColor: c.brandInk }}>
              <Text style={{ color: c.brandGold, fontWeight: '900', fontSize: 12, letterSpacing: 1 }}>BOSS AI · FROM YOUR OWN DATA</Text>
              <Text style={{ color: '#fff', fontSize: 13, marginTop: 6, lineHeight: 19 }}>
                Who to message today, why, and what to say. Each message is personal and goes from your WhatsApp, one tap per customer — free, and it feels like you, not spam.
              </Text>
            </Card>

            {ideas === null ? <ActivityIndicator color={c.primary} style={{ marginTop: 30 }} /> : ideas.length === 0 ? (
              <Card>
                <Text style={{ color: c.text, fontWeight: '800' }}>No campaigns yet</Text>
                <Text style={{ color: c.textMuted, marginTop: 4, lineHeight: 19 }}>Ideas appear once you have customers with phone numbers and a few bills. Import your customers to start today.</Text>
                <Button label="Import customers" icon="account-multiple-plus" size="sm" style={{ marginTop: 10 }} onPress={() => nav.navigate('ImportClients')} />
              </Card>
            ) : ideas.map(idea => (
              <Card key={idea.id} onPress={() => nav.navigate('Campaign', { idea })}>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: (tones[idea.tone] || c.primary) + '22', alignItems: 'center', justifyContent: 'center' }}>
                    <MaterialCommunityIcons name={idea.icon as any} size={22} color={tones[idea.tone] || c.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.text, fontWeight: '900', fontSize: 15 }}>{idea.title}</Text>
                    <Text style={{ color: c.textMuted, fontSize: 12.5, marginTop: 3, lineHeight: 18 }}>{idea.why}</Text>
                    <Text style={{ color: c.primary, fontWeight: '800', marginTop: 8 }}>Start · {idea.clients.length} people ›</Text>
                  </View>
                </View>
              </Card>
            ))}

            <SectionLabel style={{ marginTop: 8 }}>Design</SectionLabel>
            <Card onPress={() => nav.navigate('Marketing')}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <MaterialCommunityIcons name="image-multiple-outline" size={26} color={c.accent} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.text, fontWeight: '800' }}>Poster studio</Text>
                  <Text style={{ color: c.textMuted, fontSize: 12.5 }}>Offers, festivals, before/after — with your photo and logo</Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={22} color={c.textMuted} />
              </View>
            </Card>
            <Card onPress={() => BookingService.sharePoster().catch((e: any) => Alert.alert('Poster', e?.message || 'Could not create.'))}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <MaterialCommunityIcons name="qrcode" size={26} color={c.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.text, fontWeight: '800' }}>“Scan to book” counter poster</Text>
                  <Text style={{ color: c.textMuted, fontSize: 12.5 }}>Walk-ins book their next visit before leaving</Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={22} color={c.textMuted} />
              </View>
            </Card>
          </>
        ) : (
          <>
            <Text style={{ color: c.textMuted, fontSize: 13, lineHeight: 19, marginBottom: 12 }}>
              Post your real work — it sells better than any ad. Pick or shoot a photo or a short video (up to 60 sec), and Boss AI writes the caption with hashtags and your booking link.
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button label="Photo" icon="image" size="sm" variant="subtle" style={{ flex: 1 }} onPress={() => pick('image', false)} />
              <Button label="Video" icon="video" size="sm" variant="subtle" style={{ flex: 1 }} onPress={() => pick('video', false)} />
              <Button label="Record" icon="camera" size="sm" variant="subtle" style={{ flex: 1 }} onPress={() => pick('video', true)} />
            </View>
            {media && (
              <Card style={{ marginTop: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <MaterialCommunityIcons name={media.type === 'video' ? 'movie-open-check' : 'image-check'} size={28} color={c.success} />
                  <Text style={{ color: c.text, fontWeight: '800', flex: 1 }}>{media.type === 'video' ? `Video ready${media.duration ? ` · ${media.duration}s` : ''}` : 'Photo ready'}</Text>
                  <TouchableOpacity onPress={() => setMedia(null)}><MaterialCommunityIcons name="close-circle" size={22} color={c.textMuted} /></TouchableOpacity>
                </View>
              </Card>
            )}

            <SectionLabel style={{ marginTop: 14 }}>What is it?</SectionLabel>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {([['work', 'Our work'], ['transformation', 'Before/after'], ['offer', 'Offer'], ['festival', 'Festival'], ['team', 'Our team']] as [CaptionKind, string][]).map(([k, l]) => (
                <Chip key={k} label={l} active={capKind === k} onPress={() => { setCapKind(k); setCapIdx(0); }} />
              ))}
            </View>
            <TextInput value={service} onChangeText={setService} placeholder="Service (e.g. Balayage, Bridal makeup)" placeholderTextColor={c.textMuted}
              style={{ backgroundColor: c.surface, color: c.text, borderRadius: 12, padding: 12, marginTop: 8 }} />
            <TextInput value={offer} onChangeText={setOffer} placeholder="Offer (optional, e.g. 20% off this week)" placeholderTextColor={c.textMuted}
              style={{ backgroundColor: c.surface, color: c.text, borderRadius: 12, padding: 12, marginTop: 8 }} />

            <SectionLabel style={{ marginTop: 14 }}>Caption by Boss AI</SectionLabel>
            <Card>
              <Text selectable style={{ color: c.text, lineHeight: 20 }}>{caption}</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                <Button label="Another" icon="refresh" size="sm" variant="subtle" style={{ flex: 1 }} onPress={() => setCapIdx(i => i + 1)} />
                <Button label="Copy" icon="content-copy" size="sm" variant="subtle" style={{ flex: 1 }} onPress={() => Clipboard.setStringAsync(caption).then(() => Alert.alert('Copied', 'Paste it in Instagram, WhatsApp or Facebook.'))} />
              </View>
            </Card>
            <Button label={media ? `Post ${media.type === 'video' ? 'video' : 'photo'} with caption` : 'Pick a photo or video first'} icon="send" disabled={!media} onPress={shareMedia} />
            <Button label="Just share the text on WhatsApp" icon="whatsapp" variant="ghost" onPress={() => Share.share({ message: caption }).catch(() => {})} />
          </>
        )}
      </ScrollView>
    </SafeScreen>
  );
}
