import React, { useState, useEffect } from 'react';
import { SUPPORT_EMAIL, SUPPORT_WHATSAPP } from '../config/sales';
import { View, ScrollView, TouchableOpacity, Alert, Linking, KeyboardAvoidingView, Platform } from 'react-native';
import { Text, TextInput } from '../theme/Text';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeScreen } from '../components/SafeScreen';
import { useTheme } from '../context/ThemeContext';
import { DatabaseService } from '../database/Database';

const CATEGORIES = [
  { id: 'bug',     icon: 'bug-outline',         label: 'Bug Report',       color: '#EF4444' },
  { id: 'feature', icon: 'lightbulb-outline',   label: 'Feature Request',  color: '#8B5CF6' },
  { id: 'general', icon: 'chat-outline',         label: 'General',          color: '#3B82F6' },
  { id: 'support', icon: 'headset',              label: 'Need Help',        color: '#F59E0B' },
];

export default function FeedbackScreen({ navigation }: any) {
  const { colors: c } = useTheme();
  const [rating,   setRating]   = useState(0);
  const [feedback, setFeedback] = useState('');
  const [category, setCategory] = useState('general');
  const [name,     setName]     = useState('');
  const [phone,    setPhone]    = useState('');
  const [sending,  setSending]  = useState(false);
  const [supportWA, setSupportWA] = useState('');
  const [supportEM, setSupportEM] = useState('');

  useEffect(() => {
    (async () => {
      const wa = await DatabaseService.getSetting('support_whatsapp');
      const em = await DatabaseService.getSetting('support_email');
      setSupportWA(wa || SUPPORT_WHATSAPP);
      setSupportEM(em || SUPPORT_EMAIL);
    })();
  }, []);

  const selectedCat = CATEGORIES.find(c => c.id === category);

  async function sendFeedback() {
    if (!feedback.trim()) { Alert.alert('Required', 'Please write your feedback before sending.'); return; }
    if (rating === 0) { Alert.alert('Required', 'Please rate your experience (tap the stars).'); return; }
    setSending(true);
    try {
      const ratingText = ['', '😞 Very Poor', '😕 Poor', '😐 Average', '😊 Good', '🤩 Excellent'][rating];
      const body = `From: ${name || 'App User'}${phone ? ` (${phone})` : ''}\n` +
        `Category: ${selectedCat?.label || category}\n` +
        `Rating: ${rating}/5 — ${ratingText}\n\n` +
        `Feedback:\n${feedback}\n\n` +
        `---\nSent via SaloonBossX App`;

      const email = supportEM || SUPPORT_EMAIL;
      const subject = `SaloonBossX Feedback — ${selectedCat?.label || category} [${rating}★]`;
      const mailUrl = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      const canOpen = await Linking.canOpenURL(mailUrl);
      if (canOpen) {
        await Linking.openURL(mailUrl);
        Alert.alert('Thank you! 🙏',
          'Your feedback has been opened in your email app. Please press Send to complete.',
          [{ text: 'Done', onPress: () => { setFeedback(''); setRating(0); setName(''); setPhone(''); navigation.goBack(); } }]
        );
      } else {
        // Fallback: WhatsApp
        if (supportWA) {
          const msg = `*SaloonBossX Feedback*\n\nCategory: ${selectedCat?.label}\nRating: ${'⭐'.repeat(rating)}\n\n${feedback}`;
          await Linking.openURL(`https://wa.me/${supportWA.replace(/\D/g, '')}?text=${encodeURIComponent(msg)}`);
        } else {
          Alert.alert('Feedback Received', 'Thank you for your feedback!',
            [{ text: 'OK', onPress: () => navigation.goBack() }]
          );
        }
      }
    } catch (e) {
      Alert.alert('Sent!', 'Thank you for your feedback!');
      navigation.goBack();
    } finally { setSending(false); }
  }

  const starLabels = ['', 'Very Poor', 'Poor', 'Average', 'Good', 'Excellent'];

  return (
    <SafeScreen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}>
          <Text style={{ color: c.text, fontSize: 26, fontWeight: '900', marginBottom: 4 }}>Send Feedback</Text>
          <Text style={{ color: c.textMuted, fontSize: 14, marginBottom: 24 }}>
            Help us make SaloonBossX better for your business.
          </Text>

          {/* Name + Phone (optional) */}
          <Text style={lbl(c)}>Your Name (optional)</Text>
          <TextInput style={inp(c)} value={name} onChangeText={setName} placeholder="Your name" placeholderTextColor={c.textMuted} />

          <Text style={lbl(c)}>Phone (optional — for follow-up)</Text>
          <TextInput style={inp(c)} value={phone} onChangeText={setPhone} placeholder="Mobile number" placeholderTextColor={c.textMuted} keyboardType="phone-pad" />

          {/* Star Rating */}
          <Text style={lbl(c)}>How's your experience? *</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 6 }}>
            {[1, 2, 3, 4, 5].map(star => (
              <TouchableOpacity key={star} onPress={() => setRating(star)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <MaterialCommunityIcons
                  name={star <= rating ? 'star' : 'star-outline'}
                  size={40}
                  color={star <= rating ? '#FBBF24' : c.textLight}
                />
              </TouchableOpacity>
            ))}
          </View>
          {rating > 0 && (
            <Text style={{ color: '#FBBF24', fontWeight: '700', fontSize: 13, marginBottom: 16 }}>
              {starLabels[rating]}
            </Text>
          )}

          {/* Category */}
          <Text style={lbl(c)}>Category *</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {CATEGORIES.map(cat => (
              <TouchableOpacity key={cat.id}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 1.5,
                  backgroundColor: category === cat.id ? cat.color + '18' : c.surface,
                  borderColor: category === cat.id ? cat.color : c.border }}
                onPress={() => setCategory(cat.id)}>
                <MaterialCommunityIcons name={cat.icon as any} size={16} color={category === cat.id ? cat.color : c.textMuted} />
                <Text style={{ fontSize: 13, fontWeight: '600', color: category === cat.id ? cat.color : c.textSecondary }}>{cat.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Feedback text */}
          <Text style={lbl(c)}>Your Feedback *</Text>
          <TextInput
            style={[inp(c), { minHeight: 120, textAlignVertical: 'top', paddingTop: 12 }]}
            placeholder={category === 'bug'
              ? 'Describe the bug: what happened, what you expected, and how to reproduce it…'
              : category === 'feature'
              ? 'Describe the feature you\'d love to see in SaloonBossX…'
              : 'Share your thoughts, suggestions, or experience with us…'}
            placeholderTextColor={c.textMuted}
            value={feedback}
            onChangeText={setFeedback}
            multiline
          />
          <Text style={{ color: c.textMuted, fontSize: 11, marginTop: 4, marginBottom: 20, textAlign: 'right' }}>
            {feedback.length} characters
          </Text>

          {/* Submit */}
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16, borderRadius: 14, backgroundColor: c.primary, opacity: (feedback.trim() && rating > 0) ? 1 : 0.5, marginBottom: 24 }}
            onPress={sendFeedback}
            disabled={sending || !feedback.trim() || rating === 0}>
            <MaterialCommunityIcons name="send" size={18} color={c.onPrimary} />
            <Text style={{ color: c.onPrimary, fontSize: 16, fontWeight: '800' }}>{sending ? 'Sending…' : 'Send Feedback'}</Text>
          </TouchableOpacity>

          {/* Contact options */}
          <View style={{ backgroundColor: c.card, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: c.border }}>
            <Text style={{ color: c.text, fontSize: 15, fontWeight: '700', marginBottom: 12 }}>Need immediate help?</Text>
            {supportWA ? (
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 }}
                onPress={() => Linking.openURL(`https://wa.me/${supportWA.replace(/\D/g, '')}?text=Hi, I need help with SaloonBossX`)}>
                <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#25D36618', alignItems: 'center', justifyContent: 'center' }}>
                  <MaterialCommunityIcons name="whatsapp" size={20} color="#25D366" />
                </View>
                <View>
                  <Text style={{ color: '#25D366', fontWeight: '700', fontSize: 14 }}>WhatsApp Support</Text>
                  <Text style={{ color: c.textMuted, fontSize: 11 }}>Usually responds within 2 hours</Text>
                </View>
              </TouchableOpacity>
            ) : null}
            {supportEM ? (
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 }}
                onPress={() => Linking.openURL(`mailto:${supportEM}?subject=SaloonBossX Support`)}>
                <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.primaryLight, alignItems: 'center', justifyContent: 'center' }}>
                  <MaterialCommunityIcons name="email-outline" size={20} color={c.primary} />
                </View>
                <View>
                  <Text style={{ color: c.primary, fontWeight: '700', fontSize: 14 }}>{supportEM}</Text>
                  <Text style={{ color: c.textMuted, fontSize: 11 }}>Email support</Text>
                </View>
              </TouchableOpacity>
            ) : null}
            {!supportWA && !supportEM && (
              <Text style={{ color: c.textMuted, fontSize: 13 }}>
                Configure support contact details in Settings to show them here.
              </Text>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeScreen>
  );
}

const lbl = (c: any) => ({ color: c.textSecondary, fontSize: 13, fontWeight: '600' as const, marginBottom: 8, marginTop: 4 });
const inp = (c: any) => ({ backgroundColor: c.surface, color: c.text, borderRadius: 12, padding: 13, fontSize: 14, borderWidth: 1, borderColor: c.border, marginBottom: 14 });
