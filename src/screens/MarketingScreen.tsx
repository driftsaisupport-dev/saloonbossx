import React, { useState, useRef, useCallback, useEffect } from 'react';
import { View, ScrollView, TouchableOpacity, Alert, Image, ActivityIndicator, Keyboard, StyleSheet } from 'react-native';
import { Text, TextInput } from '../theme/Text';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Circle } from 'react-native-svg';
import { SafeScreen } from '../components/SafeScreen';
import { SectionLabel, Card, SegmentedTabs } from '../components/UI';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { DatabaseService } from '../database/Database';
import { MARKETING_TEMPLATES, ACCENT_CHOICES, TemplateKey, MarketingPrefill } from '../services/MarketingTemplates';
import { formatCurrency, parseDbDate } from '../utils/helpers';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import * as ImagePicker from 'expo-image-picker';
import { appLocale, curSym } from '../config/regions';

type Format = 'post' | 'story';

export default function MarketingScreen() {
  const { colors: c } = useTheme();
  const { user } = useAuth();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const [profile, setProfile] = useState<any>({});
  const [history, setHistory] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [birthdayClients, setBirthdayClients] = useState<any[]>([]);
  const [selectedKey, setSelectedKey] = useState<TemplateKey>('offer');
  const template = MARKETING_TEMPLATES.find(t => t.key === selectedKey)!;
  const [headline, setHeadline] = useState(template.headlineDefault);
  const [subtext, setSubtext] = useState(template.subtextDefault);
  const [detail, setDetail] = useState('');
  const [accent, setAccent] = useState(template.accent);
  const [format, setFormat] = useState<Format>('post');
  const [beforeUri, setBeforeUri] = useState('');
  const [afterUri, setAfterUri] = useState('');
  const [photoUri, setPhotoUri] = useState('');
  const [sharing, setSharing] = useState(false);
  const viewRef = useRef<View>(null);

  const load = useCallback(() => {
    DatabaseService.getSalonProfile().then(setProfile).catch(() => {});
    (DatabaseService as any).getMarketingHistory(8).then(setHistory).catch(() => {});
    DatabaseService.getServices().then(setServices).catch(() => {});
    DatabaseService.getUpcomingBirthdays(30).then(setBirthdayClients).catch(() => {});
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  function selectTemplate(key: TemplateKey) {
    const t = MARKETING_TEMPLATES.find(x => x.key === key)!;
    setSelectedKey(key);
    setHeadline(t.headlineDefault);
    setSubtext(t.subtextDefault);
    setDetail('');
    setAccent(t.accent);
    setBeforeUri('');
    setAfterUri('');
    setPhotoUri('');
  }

  // A Business Insights card ("Create a post ›") can hand this screen a
  // ready-made suggestion — e.g. the slow-day offer or the service that's
  // gone quiet — so the owner doesn't start from a blank template.
  useEffect(() => {
    const prefill: MarketingPrefill | undefined = route.params?.prefill;
    if (!prefill) return;
    selectTemplate(prefill.template);
    if (prefill.headline !== undefined) setHeadline(prefill.headline);
    if (prefill.subtext !== undefined) setSubtext(prefill.subtext);
    if (prefill.detail !== undefined) setDetail(prefill.detail);
    navigation.setParams({ prefill: undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.prefill]);

  async function pickPhoto(which: 'before' | 'after' | 'banner') {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') return Alert.alert('Permission needed', 'Allow photo library access to add a picture.');
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], quality: 0.85,
      aspect: which === 'banner' ? (format === 'story' ? [9, 16] : [1, 1]) : [1, 1],
      allowsEditing: true,
    });
    if (res.canceled || !res.assets?.[0]) return;
    if (which === 'before') setBeforeUri(res.assets[0].uri);
    else if (which === 'after') setAfterUri(res.assets[0].uri);
    else setPhotoUri(res.assets[0].uri);
  }

  function pickService(svc: any) {
    setHeadline(svc.name);
    setDetail(svc.price > 0 ? `Starting ${formatCurrency(svc.price, profile.currency_symbol || curSym())}` : '');
  }

  const displayHeadline = (template.posterHeadline ? template.posterHeadline(headline) : (headline || template.headlineDefault)) || template.label;
  const displaySubtext = subtext || template.subtextDefault;
  const showBannerPhoto = !!photoUri && template.photos !== 'beforeAfter';

  async function share() {
    Keyboard.dismiss();
    if (template.photos === 'beforeAfter' && !beforeUri && !afterUri) {
      Alert.alert('Add a photo', 'Add at least one before or after photo for this post.');
      return;
    }
    if (selectedKey === 'service' && !headline.trim()) {
      Alert.alert('Add a service name', 'Enter the service you want to feature.');
      return;
    }
    setSharing(true);
    try {
      const uri = await captureRef(viewRef, { format: 'png', quality: 1, result: 'tmpfile' });
      const caption = template.caption({ headline, subtext: displaySubtext, detail }, { name: profile.name, phone: profile.phone, city: profile.city });
      await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Share to Instagram, Facebook, WhatsApp…' });
      await (DatabaseService as any).logMarketingPost({ template: template.label, title: displayHeadline, message: caption });
      await (DatabaseService as any).logAudit({ id: user?.id, username: user?.username }, 'marketing_post_shared', 'marketing', 0, template.label);
      load();
    } catch (e: any) {
      Alert.alert('Could not share', e?.message || 'Something went wrong building the image.');
    } finally { setSharing(false); }
  }

  const field = (props: any) => (
    <TextInput {...props} placeholderTextColor={c.textMuted}
      style={{ backgroundColor: c.surface, color: c.text, borderRadius: 10, padding: 12, fontSize: 14, borderWidth: 1.5, borderColor: c.border, ...(props.multiline ? { minHeight: 72, textAlignVertical: 'top' } : {}) }} />
  );

  const posterMaxWidth = format === 'story' ? 250 : 340;
  const photoBoxHeight = format === 'story' ? '38%' : '52%';

  return (
    <SafeScreen>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: c.textMuted, fontSize: 13, lineHeight: 19, marginBottom: 14 }}>
          Design a branded post and share it straight to Instagram, Facebook or WhatsApp — everything is created on your phone, no internet needed.
        </Text>

        <SectionLabel>Choose a post type</SectionLabel>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {MARKETING_TEMPLATES.map(t => (
              <TouchableOpacity key={t.key} onPress={() => selectTemplate(t.key)}
                style={{ alignItems: 'center', width: 78, paddingVertical: 12, borderRadius: 16, borderWidth: 1.5, borderColor: selectedKey === t.key ? c.primary : c.border, backgroundColor: selectedKey === t.key ? c.primaryLight : c.card }}>
                <MaterialCommunityIcons name={t.icon as any} size={22} color={selectedKey === t.key ? c.primary : c.textMuted} />
                <Text style={{ marginTop: 6, fontSize: 10.5, fontWeight: '700', textAlign: 'center', color: selectedKey === t.key ? c.primary : c.textSecondary }} numberOfLines={2}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

        {selectedKey === 'service' && services.length > 0 && (
          <>
            <SectionLabel>Pick a service to feature</SectionLabel>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {services.map((svc: any) => (
                  <TouchableOpacity key={svc.id} onPress={() => pickService(svc)}
                    style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: headline === svc.name ? c.primary : c.surface, borderWidth: 1, borderColor: headline === svc.name ? c.primary : c.border }}>
                    <Text style={{ color: headline === svc.name ? '#fff' : c.textSecondary, fontSize: 12.5, fontWeight: '700' }}>{svc.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </>
        )}

        {selectedKey === 'birthday' && birthdayClients.length > 0 && (
          <>
            <SectionLabel>Upcoming birthdays</SectionLabel>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {birthdayClients.map((cl: any) => (
                  <TouchableOpacity key={cl.id} onPress={() => setHeadline(cl.name)}
                    style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: headline === cl.name ? c.primary : c.surface, borderWidth: 1, borderColor: headline === cl.name ? c.primary : c.border }}>
                    <Text style={{ color: headline === cl.name ? '#fff' : c.textSecondary, fontSize: 12.5, fontWeight: '700' }}>{cl.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </>
        )}

        {template.photos !== 'beforeAfter' && (
          <>
            <SectionLabel>Banner photo (optional)</SectionLabel>
            <TouchableOpacity onPress={() => pickPhoto('banner')} activeOpacity={0.85}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16, backgroundColor: c.card, borderRadius: 16, padding: 12, borderWidth: 1, borderColor: c.borderLight }}>
              <View style={{ width: 54, height: 54, borderRadius: 12, overflow: 'hidden', backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }}>
                {photoUri ? <Image source={{ uri: photoUri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : <MaterialCommunityIcons name="image-plus" size={22} color={c.textMuted} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.text, fontSize: 13.5, fontWeight: '700' }}>{photoUri ? 'Change photo' : 'Upload a photo for the banner'}</Text>
                <Text style={{ color: c.textMuted, fontSize: 11.5, marginTop: 2 }}>Use a real photo of your salon or work instead of the plain colour</Text>
              </View>
              {photoUri ? (
                <TouchableOpacity onPress={() => setPhotoUri('')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <MaterialCommunityIcons name="close-circle" size={22} color={c.textMuted} />
                </TouchableOpacity>
              ) : null}
            </TouchableOpacity>
          </>
        )}

        {/* Live preview */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <SectionLabel style={{ marginBottom: 0 }}>Preview</SectionLabel>
          <SegmentedTabs
            style={{ width: 190 }}
            tabs={[{ key: 'post', label: 'Post' }, { key: 'story', label: 'Story' }]}
            value={format}
            onChange={(k) => setFormat(k as Format)}
          />
        </View>
        <View style={{ alignItems: 'center', marginBottom: 16 }}>
          <View ref={viewRef} collapsable={false}
            style={{ width: '100%', maxWidth: posterMaxWidth, aspectRatio: format === 'story' ? 9 / 16 : 1, borderRadius: 22, overflow: 'hidden', backgroundColor: accent }}>

            {showBannerPhoto ? (
              <>
                {/* Photo banner mode: the uploaded photo fills the whole card, with a
                    dark scrim behind the header and the text block so both stay
                    readable over any photo. */}
                <Image source={{ uri: photoUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 16, paddingBottom: 10, backgroundColor: 'rgba(0,0,0,0.32)' }}>
                  {profile.profile_image ? (
                    <Image source={{ uri: profile.profile_image }} style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: '#fff' }} />
                  ) : (
                    <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' }}>
                      <MaterialCommunityIcons name="content-cut" size={16} color="#fff" />
                    </View>
                  )}
                  <Text style={{ color: '#fff', fontWeight: '900', fontSize: 13, flex: 1 }} numberOfLines={1}>{profile.name || 'My Salon'}</Text>
                </View>

                <View style={{ flex: 1 }} />

                <View style={{ backgroundColor: 'rgba(0,0,0,0.58)', padding: 16, paddingTop: 20 }}>
                  <Text style={{ fontSize: 19, fontWeight: '900', textAlign: 'center', color: '#fff' }} numberOfLines={3}>{displayHeadline}</Text>
                  {!!displaySubtext && <Text style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.85)', textAlign: 'center', marginTop: 6 }} numberOfLines={4}>{displaySubtext}</Text>}
                  {!!detail && (
                    <View style={{ alignSelf: 'center', marginTop: 10, backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 }}>
                      <Text style={{ color: accent, fontWeight: '800', fontSize: 11.5 }}>{detail}</Text>
                    </View>
                  )}
                  <Text style={{ color: 'rgba(255,255,255,0.75)', fontWeight: '700', fontSize: 10.5, textAlign: 'center', marginTop: 12 }} numberOfLines={1}>
                    {[profile.phone && `📞 ${profile.phone}`, profile.city].filter(Boolean).join('   •   ')}
                  </Text>
                </View>
              </>
            ) : (
              <>
                <Svg style={StyleSheet.absoluteFill} viewBox="0 0 300 300" preserveAspectRatio="xMidYMid slice">
                  <Circle cx="255" cy="25" r="95" fill="rgba(255,255,255,0.10)" />
                  <Circle cx="15" cy="300" r="85" fill="rgba(255,255,255,0.08)" />
                </Svg>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 16, paddingBottom: 10 }}>
                  {profile.profile_image ? (
                    <Image source={{ uri: profile.profile_image }} style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: '#fff' }} />
                  ) : (
                    <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' }}>
                      <MaterialCommunityIcons name="content-cut" size={16} color="#fff" />
                    </View>
                  )}
                  <Text style={{ color: '#fff', fontWeight: '900', fontSize: 13, flex: 1 }} numberOfLines={1}>{profile.name || 'My Salon'}</Text>
                </View>

                <View style={{ flex: 1, backgroundColor: '#fff', marginHorizontal: 12, borderRadius: 16, padding: 16, justifyContent: 'center', alignItems: 'center' }}>
                  {template.photos === 'beforeAfter' ? (
                    <View style={{ flexDirection: 'row', gap: 6, width: '100%', height: photoBoxHeight, marginBottom: 10 }}>
                      <TouchableOpacity onPress={() => pickPhoto('before')} style={{ flex: 1, borderRadius: 10, overflow: 'hidden', backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }}>
                        {beforeUri ? <Image source={{ uri: beforeUri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : <Text style={{ color: c.textMuted, fontSize: 11, fontWeight: '700' }}>+ Before</Text>}
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => pickPhoto('after')} style={{ flex: 1, borderRadius: 10, overflow: 'hidden', backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }}>
                        {afterUri ? <Image source={{ uri: afterUri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : <Text style={{ color: c.textMuted, fontSize: 11, fontWeight: '700' }}>+ After</Text>}
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <Text style={{ fontSize: 46, marginBottom: 8 }}>{template.emoji}</Text>
                  )}
                  <Text style={{ fontSize: 19, fontWeight: '900', textAlign: 'center', color: '#17151F' }} numberOfLines={3}>{displayHeadline}</Text>
                  {!!displaySubtext && <Text style={{ fontSize: 12.5, color: '#565163', textAlign: 'center', marginTop: 6 }} numberOfLines={4}>{displaySubtext}</Text>}
                  {!!detail && (
                    <View style={{ marginTop: 10, backgroundColor: accent + '22', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 }}>
                      <Text style={{ color: accent, fontWeight: '800', fontSize: 11.5 }}>{detail}</Text>
                    </View>
                  )}
                </View>

                <View style={{ padding: 12, alignItems: 'center' }}>
                  <Text style={{ color: 'rgba(255,255,255,0.9)', fontWeight: '700', fontSize: 10.5 }} numberOfLines={1}>
                    {[profile.phone && `📞 ${profile.phone}`, profile.city].filter(Boolean).join('   •   ')}
                  </Text>
                </View>
              </>
            )}
          </View>
        </View>

        <SectionLabel>Accent colour</SectionLabel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
          {ACCENT_CHOICES.map(a => (
            <TouchableOpacity key={a} onPress={() => setAccent(a)}
              style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: a, borderWidth: 3, borderColor: accent === a ? c.text : 'transparent' }} />
          ))}
        </View>

        <SectionLabel>Wording</SectionLabel>
        <Card>
          <Text style={{ color: c.textSecondary, fontSize: 12, fontWeight: '700', marginBottom: 6 }}>{template.headlineLabel}</Text>
          {field({ value: headline, onChangeText: setHeadline, placeholder: template.headlinePlaceholder })}
          <View style={{ height: 12 }} />
          <Text style={{ color: c.textSecondary, fontSize: 12, fontWeight: '700', marginBottom: 6 }}>{template.subtextLabel}</Text>
          {field({ value: subtext, onChangeText: setSubtext, placeholder: template.subtextPlaceholder, multiline: true })}
          {template.detailLabel && (
            <>
              <View style={{ height: 12 }} />
              <Text style={{ color: c.textSecondary, fontSize: 12, fontWeight: '700', marginBottom: 6 }}>{template.detailLabel}</Text>
              {field({ value: detail, onChangeText: setDetail, placeholder: template.detailPlaceholder })}
            </>
          )}
        </Card>

        <TouchableOpacity onPress={share} disabled={sharing}
          style={{ marginTop: 6, backgroundColor: sharing ? c.textMuted : c.primary, borderRadius: 14, paddingVertical: 16, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
          {sharing ? <ActivityIndicator color={c.onPrimary} /> : <MaterialCommunityIcons name="share-variant" size={18} color={c.onPrimary} />}
          <Text style={{ color: c.onPrimary, fontWeight: '900', fontSize: 15 }}>{sharing ? 'Preparing…' : 'Share this post'}</Text>
        </TouchableOpacity>

        {history.length > 0 && (
          <View style={{ marginTop: 24 }}>
            <SectionLabel>Recent posts</SectionLabel>
            <Card padded={false}>
              {history.map((h: any, i: number) => (
                <View key={h.id} style={{ flexDirection: 'row', alignItems: 'center', padding: 14, gap: 10, borderBottomWidth: i === history.length - 1 ? 0 : 0.5, borderBottomColor: c.divider }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.text, fontSize: 13.5, fontWeight: '700' }} numberOfLines={1}>{h.name}</Text>
                    <Text style={{ color: c.textMuted, fontSize: 11.5, marginTop: 2 }} numberOfLines={1}>{h.type} · {parseDbDate(h.created_at).toLocaleDateString(appLocale())}</Text>
                  </View>
                </View>
              ))}
            </Card>
          </View>
        )}
      </ScrollView>
    </SafeScreen>
  );
}
