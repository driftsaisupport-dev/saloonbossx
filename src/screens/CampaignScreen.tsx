import React, { useEffect, useMemo, useState } from 'react';
import { View, FlatList, TouchableOpacity, Alert } from 'react-native';
import { Text, TextInput } from '../theme/Text';
import { useNavigation, useRoute } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeScreen } from '../components/SafeScreen';
import { Button, SegmentedTabs } from '../components/UI';
import { useTheme } from '../context/ThemeContext';
import { DBX } from '../database/Database';
import { WhatsAppService } from '../services/WhatsAppService';
import { CampaignIdea, CampaignClient, messageFor, markReviewAsked } from '../services/ai/campaigns';
import { Lang } from '../services/ai/analytics';

/**
 * Send a campaign one personal WhatsApp at a time. Progress is saved, so the
 * owner can send 10 now and the rest after lunch.
 */
export default function CampaignScreen() {
  const { colors: c } = useTheme();
  const nav = useNavigation<any>();
  const idea: CampaignIdea = useRoute<any>().params?.idea;
  const [lang, setLang] = useState<Lang>('en');
  const [offer, setOffer] = useState(idea?.offer || '');
  const [salon, setSalon] = useState<{ name?: string; phone?: string }>({});
  const [review, setReview] = useState('');
  const [sent, setSent] = useState<Record<string, number>>({});
  const [skip, setSkip] = useState<Record<string, boolean>>({});
  const [custom, setCustom] = useState<string | null>(null);
  // Remembered for 14 days, so nobody gets the same campaign twice.
  const storeKey = `camp_${idea?.id}`;

  useEffect(() => {
    nav.setOptions?.({ title: idea?.title?.slice(0, 32) || 'Campaign' });
    DBX.getSalonProfile().then((p: any) => setSalon({ name: p?.name, phone: p?.phone })).catch(() => {});
    DBX.getSetting('google_review_url').then(v => setReview(v || '')).catch(() => {});
    DBX.getSetting(storeKey).then(v => {
      const all: Record<string, number> = v ? JSON.parse(v) : {};
      const fresh: Record<string, number> = {};
      for (const k of Object.keys(all)) if (all[k] > Date.now() - 14 * 86400000) fresh[k] = all[k];
      setSent(fresh);
    }).catch(() => {});
  }, []);

  const queue = useMemo(() => (idea?.clients || []).filter(cl => !skip[cl.id]), [idea, skip]);
  const left = queue.filter(cl => !sent[cl.id]);
  const next = left[0];

  if (!idea) return <SafeScreen><Text style={{ padding: 20, color: c.text }}>Campaign not found.</Text></SafeScreen>;
  const needsReview = idea.kind === 'review' && !review;

  const textFor = (cl: CampaignClient) => {
    if (custom !== null) return custom.replace(/\{name\}/g, String(cl.name || '').split(' ')[0]);
    let m = messageFor({ ...idea, offer }, cl, salon, lang, { link: review });
    if (idea.kind !== 'review') m += lang === 'en' ? '\n\n(Reply STOP to not get offers.)' : '\n\n(Offers nahi chahiye toh STOP likhein.)';
    return m;
  };

  async function sendTo(cl: CampaignClient) {
    if (needsReview) { Alert.alert('Add your review link first', 'Settings → Google reviews → paste your link.', [{ text: 'Open', onPress: () => nav.navigate('BillDesign') }, { text: 'Cancel' }]); return; }
    const opened = await WhatsAppService.sendMessage(cl.phone, textFor(cl));
    if (!opened) { setSkip(s => ({ ...s, [cl.id]: true })); return; }
    const nextSent = { ...sent, [cl.id]: Date.now() };
    setSent(nextSent);
    DBX.setSetting(storeKey, JSON.stringify(nextSent)).catch(() => {});
    if (idea.kind === 'review') markReviewAsked([cl.id]);
    if (Object.keys(nextSent).length === 1) {
      (DBX as any).logMarketingPost({ template: `Campaign · ${idea.id}`, title: idea.title, message: textFor(cl) }).catch(() => {});
    }
  }

  const done = queue.length - left.length;
  const pct = queue.length ? Math.round((done / queue.length) * 100) : 0;

  return (
    <SafeScreen keyboard>
      <FlatList
        data={idea.clients}
        keyExtractor={cl => String(cl.id)}
        contentContainerStyle={{ padding: 16, paddingBottom: 140 }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View>
            <Text style={{ color: c.text, fontWeight: '900', fontSize: 17 }}>{idea.title}</Text>
            <Text style={{ color: c.textMuted, fontSize: 12.5, marginTop: 4, lineHeight: 18 }}>{idea.why}</Text>
            {needsReview && (
              <TouchableOpacity onPress={() => nav.navigate('BillDesign')} style={{ backgroundColor: c.warningLight, borderRadius: 12, padding: 12, marginTop: 10 }}>
                <Text style={{ color: c.warning, fontWeight: '800' }}>Add your Google review link first ›</Text>
              </TouchableOpacity>
            )}
            {idea.offer !== '' && idea.kind !== 'review' && idea.kind !== 'due_visit' && (
              <>
                <Text style={{ color: c.textMuted, fontSize: 12, fontWeight: '700', marginTop: 14, marginBottom: 5 }}>Offer</Text>
                <TextInput value={offer} onChangeText={setOffer} style={{ backgroundColor: c.surface, color: c.text, borderRadius: 12, padding: 12, fontWeight: '700' }} />
              </>
            )}
            <SegmentedTabs value={lang} onChange={k => { setLang(k as Lang); setCustom(null); }} style={{ marginTop: 14 }}
              tabs={[{ key: 'en', label: 'English' }, { key: 'hinglish', label: 'Hinglish' }]} />
            <Text style={{ color: c.textMuted, fontSize: 12, fontWeight: '700', marginTop: 12, marginBottom: 5 }}>Message (tap to edit · {'{name}'} = first name)</Text>
            <TextInput multiline value={custom ?? textFor({ id: 0, name: '{name}', phone: '' })} onChangeText={setCustom}
              style={{ backgroundColor: c.surface, color: c.text, borderRadius: 12, padding: 12, minHeight: 110, textAlignVertical: 'top', lineHeight: 20 }} />
            {idea.poster && (
              <Button label="Also make a poster for this" icon="image-plus" size="sm" variant="ghost" onPress={() => nav.navigate('Marketing', { prefill: idea.poster })} />
            )}
            <View style={{ height: 8, backgroundColor: c.surface, borderRadius: 4, marginTop: 12, overflow: 'hidden' }}>
              <View style={{ width: `${pct}%` as any, height: 8, backgroundColor: c.success }} />
            </View>
            <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 6, marginBottom: 8 }}>
              {done} of {queue.length} sent · Tip: send up to ~50 a day from your own WhatsApp so it stays personal.
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const isSent = !!sent[item.id], skipped = !!skip[item.id];
          return (
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: c.divider, gap: 10, opacity: skipped ? 0.4 : 1 }}>
              <MaterialCommunityIcons name={isSent ? 'check-circle' : 'account-circle-outline'} size={24} color={isSent ? c.success : c.textMuted} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.text, fontWeight: '700' }}>{item.name}</Text>
                <Text style={{ color: c.textMuted, fontSize: 12 }}>{item.sub || item.phone}</Text>
              </View>
              {!isSent && (
                <TouchableOpacity onPress={() => setSkip(s => ({ ...s, [item.id]: !s[item.id] }))} style={{ padding: 6 }}>
                  <Text style={{ color: c.textMuted, fontSize: 12 }}>{skipped ? 'Undo' : 'Skip'}</Text>
                </TouchableOpacity>
              )}
              {!skipped && (
                <TouchableOpacity onPress={() => sendTo(item)} style={{ padding: 6 }}>
                  <MaterialCommunityIcons name="whatsapp" size={24} color={isSent ? c.textLight : c.whatsapp} />
                </TouchableOpacity>
              )}
            </View>
          );
        }}
      />
      <View style={{ position: 'absolute', left: 16, right: 16, bottom: 24 }}>
        {next ? (
          <Button label={`Send to ${String(next.name).split(' ')[0]} (${done + 1}/${queue.length})`} icon="whatsapp" color={c.whatsapp} onPress={() => sendTo(next)} />
        ) : (
          <Button label="All sent 🎉 — back to campaigns" icon="check-all" color={c.success} onPress={() => nav.goBack()} />
        )}
      </View>
    </SafeScreen>
  );
}
