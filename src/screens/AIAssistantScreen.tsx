import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, ScrollView, TouchableOpacity, KeyboardAvoidingView, Platform, ActivityIndicator, Share } from 'react-native';
import { Text, TextInput } from '../theme/Text';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeScreen } from '../components/SafeScreen';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { BossAI, AIAnswer, Briefing } from '../services/ai/BossAI';
import { WhatsAppService } from '../services/WhatsAppService';
import { FeatureGate } from '../utils/featureGate';
import { getLanguage } from '../i18n';

type Msg = { id: number; from: 'me' | 'ai'; text?: string; answer?: AIAnswer; briefing?: Briefing };

export default function AIAssistantScreen() {
  const { colors: c } = useTheme();
  const nav = useNavigation<any>();
  const { can } = useAuth();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [multi, setMulti] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const idRef = useRef(1);
  const lang: 'en' | 'hinglish' = getLanguage() === 'en' ? 'en' : 'hinglish';
  const money = can('dashboard.revenue');

  useEffect(() => {
    FeatureGate.canAccess('hasMultiLocation').then(setMulti).catch(() => {});
    BossAI.briefing({ money }).then(b => setMsgs([{ id: idRef.current++, from: 'ai', briefing: b }]))
      .catch(() => setMsgs([{ id: idRef.current++, from: 'ai', text: 'Namaste! Ask me anything about your salon.' }]));
  }, []);

  const ask = useCallback(async (q: string) => {
    const text = q.trim();
    if (!text || thinking) return;
    setInput('');
    setMsgs(m => [...m, { id: idRef.current++, from: 'me', text }]);
    setThinking(true);
    try {
      const a = await BossAI.ask(text, { money, branches: multi && can('branches.view') });
      setMsgs(m => [...m, { id: idRef.current++, from: 'ai', answer: a }]);
    } finally {
      setThinking(false);
      setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 80);
    }
  }, [thinking, money, multi]);

  const toneColor = (t?: string) => t === 'success' ? c.success : t === 'warning' ? c.warning : t === 'danger' ? c.danger : t === 'primary' ? c.primary : c.info;

  function AnswerView({ a }: { a: AIAnswer }) {
    return (
      <View>
        <Text style={{ color: c.text, fontSize: 15, fontWeight: '700', lineHeight: 21 }}>{a.text}</Text>
        {a.stats?.length ? (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            {a.stats.map(s => (
              <View key={s.label} style={{ flex: 1, backgroundColor: c.surface, borderRadius: 12, padding: 10 }}>
                <Text style={{ color: c.text, fontWeight: '900', fontSize: 14 }} numberOfLines={1}>{s.value}</Text>
                <Text style={{ color: c.textMuted, fontSize: 11 }}>{s.label}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {a.bullets?.map((b, i) => (
          <TouchableOpacity key={i} disabled={!(a.tone === 'info' && /\?$/.test(b))} onPress={() => ask(b)}>
            <Text style={{ color: c.textSecondary, fontSize: 13.5, marginTop: 6, lineHeight: 19 }}>{/^[0-9🔴🟠🔵⚠⏳💡📅]/u.test(b) ? b : `• ${b}`}</Text>
          </TouchableOpacity>
        ))}
        {a.clients?.length ? (
          <View style={{ marginTop: 10, borderRadius: 12, overflow: 'hidden', borderWidth: 0.5, borderColor: c.border }}>
            {a.clients.slice(0, 12).map((cl, i) => (
              <View key={cl.id + '-' + i} style={{ flexDirection: 'row', alignItems: 'center', padding: 10, gap: 8, backgroundColor: c.card, borderTopWidth: i ? 0.5 : 0, borderTopColor: c.divider }}>
                <TouchableOpacity style={{ flex: 1 }} onPress={() => nav.navigate('ClientDetail', { clientId: cl.id })}>
                  <Text style={{ color: c.text, fontWeight: '700' }} numberOfLines={1}>{cl.name}</Text>
                  <Text style={{ color: c.textMuted, fontSize: 11.5 }} numberOfLines={1}>{cl.sub}</Text>
                </TouchableOpacity>
                {cl.phone && cl.message ? (
                  <TouchableOpacity onPress={() => WhatsAppService.sendMessage(cl.phone!, cl.message!)}
                    style={{ backgroundColor: c.whatsapp, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, flexDirection: 'row', gap: 4, alignItems: 'center' }}>
                    <MaterialCommunityIcons name="whatsapp" size={14} color={c.onPrimary} />
                    <Text style={{ color: c.onPrimary, fontWeight: '800', fontSize: 12 }}>Send</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ))}
            {a.clients.length > 12 && <Text style={{ color: c.textMuted, fontSize: 12, padding: 10 }}>+{a.clients.length - 12} more</Text>}
          </View>
        ) : null}
        {a.copyText ? (
          <View style={{ marginTop: 10, backgroundColor: c.surface, borderRadius: 12, padding: 12 }}>
            <Text style={{ color: c.textSecondary, fontSize: 13, lineHeight: 19 }}>{a.copyText}</Text>
            <TouchableOpacity onPress={() => Share.share({ message: a.copyText! })} style={{ marginTop: 8, alignSelf: 'flex-start', flexDirection: 'row', gap: 6, alignItems: 'center' }}>
              <MaterialCommunityIcons name="share-variant" size={16} color={c.primary} />
              <Text style={{ color: c.primary, fontWeight: '800' }}>Share / WhatsApp status</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        {a.actions?.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            {a.actions.map(x => (
              <TouchableOpacity key={x.label} onPress={() => { try { nav.navigate(x.route, x.params); } catch {} }}
                style={{ backgroundColor: c.primaryLight, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 }}>
                <Text style={{ color: c.primary, fontWeight: '800', fontSize: 12.5 }}>{x.label} ›</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <SafeScreen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        <ScrollView ref={scroll} contentContainerStyle={{ padding: 14, paddingBottom: 20 }} keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12, alignSelf: 'center', backgroundColor: c.successLight, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 }}>
            <MaterialCommunityIcons name="shield-lock-outline" size={14} color={c.success} />
            <Text style={{ color: c.success, fontSize: 11.5, fontWeight: '800' }}>Runs on this phone · works offline · free</Text>
          </View>

          {msgs.map(m => m.from === 'me' ? (
            <View key={m.id} style={{ alignSelf: 'flex-end', maxWidth: '85%', backgroundColor: c.primary, borderRadius: 18, borderBottomRightRadius: 4, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 10 }}>
              <Text style={{ color: c.onPrimary, fontSize: 15 }}>{m.text}</Text>
            </View>
          ) : (
            <View key={m.id} style={{ alignSelf: 'flex-start', width: '94%', backgroundColor: c.card, borderRadius: 18, borderBottomLeftRadius: 4, padding: 14, marginBottom: 10, borderWidth: 0.5, borderColor: c.borderLight }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <MaterialCommunityIcons name="robot-happy-outline" size={16} color={c.brandGold} />
                <Text style={{ color: c.brandGold, fontWeight: '900', fontSize: 12 }}>BOSS AI</Text>
              </View>
              {m.briefing ? (
                <View>
                  <Text style={{ color: c.text, fontSize: 17, fontWeight: '900', marginBottom: 6 }}>{m.briefing.headline}</Text>
                  {m.briefing.lines.map((l, i) => (
                    <TouchableOpacity key={i} disabled={!l.route || l.route === 'AIAssistant'} onPress={() => l.route && nav.navigate(l.route)}
                      style={{ flexDirection: 'row', gap: 10, paddingVertical: 6, alignItems: 'flex-start' }}>
                      <MaterialCommunityIcons name={l.icon as any} size={18} color={toneColor(l.tone)} style={{ marginTop: 1 }} />
                      <Text style={{ color: c.textSecondary, fontSize: 13.5, flex: 1, lineHeight: 19 }}>{l.text}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : m.answer ? <AnswerView a={m.answer} /> : <Text style={{ color: c.text }}>{m.text}</Text>}
            </View>
          ))}
          {thinking && <ActivityIndicator color={c.primary} style={{ alignSelf: 'flex-start', marginLeft: 16 }} />}
        </ScrollView>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 12, gap: 8, paddingBottom: 8 }}>
          {BossAI.suggestions(lang).map(s => (
            <TouchableOpacity key={s} onPress={() => ask(s)} style={{ backgroundColor: c.surface, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 8, borderWidth: 1, borderColor: c.border }}>
              <Text style={{ color: c.textSecondary, fontSize: 12.5, fontWeight: '700' }}>{s}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 0.5, borderTopColor: c.divider, backgroundColor: c.bg }}>
          <TextInput value={input} onChangeText={setInput} onSubmitEditing={() => ask(input)} returnKeyType="send"
            placeholder={lang === 'en' ? 'Ask: profit this month? who is due back?' : 'Poochiye: aaj kitna hua? kaun nahi aaya?'}
            placeholderTextColor={c.textMuted}
            style={{ flex: 1, backgroundColor: c.surface, color: c.text, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 11, fontSize: 15 }} />
          <TouchableOpacity onPress={() => ask(input)} disabled={!input.trim() || thinking}
            style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: input.trim() ? c.primary : c.surface, alignItems: 'center', justifyContent: 'center' }}>
            <MaterialCommunityIcons name="send" size={20} color={input.trim() ? c.onPrimary : c.textMuted} />
          </TouchableOpacity>
        </View>
        <Text style={{ color: c.textMuted, fontSize: 10.5, textAlign: 'center', paddingBottom: 4 }}>Tip: tap the 🎤 on your keyboard to speak in Hindi or English</Text>
      </KeyboardAvoidingView>
    </SafeScreen>
  );
}
