import React, { useEffect, useState } from 'react';
import { View, Alert, Linking } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Text } from '../theme/Text';
import { Card, Button, Input } from './UI';
import { useTheme } from '../context/ThemeContext';
import { ReviewService, extractUrl } from '../services/ReviewService';
import { DBX } from '../database/Database';

/** Paste-once Google review link, used on bills, booking page and campaigns. */
export function ReviewLinkCard({ compact = false, onSaved }: { compact?: boolean; onSaved?: (u: string) => void }) {
  const { colors: c } = useTheme();
  const [url, setUrl] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(false);

  useEffect(() => { ReviewService.get().then(u => { setUrl(u); setSaved(u); }).catch(() => {}); }, []);

  async function save(v = url) {
    setBusy(true);
    try {
      const u = await ReviewService.set(v);
      setUrl(u); setSaved(u); onSaved?.(u);
      Alert.alert(u ? 'Saved ✅' : 'Removed', u ? 'Your Google review link now appears on WhatsApp bills, printed bills (QR) and your booking page.' : 'Review link removed.');
    } catch (e: any) { Alert.alert('Check the link', e?.message || 'Try again.'); }
    finally { setBusy(false); }
  }

  async function paste() {
    const t = await Clipboard.getStringAsync().catch(() => '');
    const u = extractUrl(t || '');
    if (!u) { Alert.alert('Nothing to paste', 'Copy your Google review link first (see "How to get my link").'); return; }
    setUrl(u);
    save(u);
  }

  return (
    <Card>
      <Text style={{ color: c.text, fontWeight: '900', fontSize: 15 }}>⭐ Google review link</Text>
      {!compact && <Text style={{ color: c.textMuted, fontSize: 12.5, marginTop: 4, lineHeight: 18 }}>
        More 5-star reviews = more customers from Google Maps. Paste your link once — every bill and booking then asks happy customers to review you.
      </Text>}
      <View style={{ height: 10 }} />
      <Input label="" icon="star-outline" value={url} onChangeText={setUrl} placeholder="https://g.page/r/…/review" autoCapitalize="none" autoCorrect={false} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button label="Paste" icon="content-paste" size="sm" variant="subtle" style={{ flex: 1 }} onPress={paste} />
        <Button label={saved && saved === url ? 'Saved' : 'Save'} icon="check" size="sm" style={{ flex: 1 }} loading={busy} disabled={saved === url} onPress={() => save()} />
        {saved ? <Button label="Test" icon="open-in-new" size="sm" variant="ghost" style={{ flex: 1 }} onPress={() => Linking.openURL(saved).catch(() => {})} /> : null}
      </View>
      <Button label={help ? 'Hide steps' : 'How to get my link (1 minute)'} size="sm" variant="ghost" onPress={() => setHelp(h => !h)} />
      {help && (
        <View style={{ backgroundColor: c.surface, borderRadius: 12, padding: 12 }}>
          {[
            'Open Google Maps (or search your salon name on Google) while signed in to the Google account that owns your Business Profile.',
            'Tap your business → "Ask for reviews" (or "Get more reviews" / "Share review form").',
            'Tap "Copy link". It looks like https://g.page/r/…/review',
            'Come back here and tap Paste.',
          ].map((t, i) => <Text key={i} style={{ color: c.textSecondary, fontSize: 12.5, marginBottom: 6, lineHeight: 18 }}>{i + 1}. {t}</Text>)}
          <Text style={{ color: c.textMuted, fontSize: 11.5, lineHeight: 16 }}>No Business Profile yet? Create one free at business.google.com — it is the #1 way new customers find salons.</Text>
          <Button label="Find my business on Google" icon="google" size="sm" variant="subtle" style={{ marginTop: 8 }}
            onPress={async () => { try { const p: any = await DBX.getSalonProfile().catch(() => ({})); await Promise.resolve(ReviewService.findMyLink(p?.name || '', p?.city || '')); } catch { /* browser did not open */ } }} />
        </View>
      )}
    </Card>
  );
}
