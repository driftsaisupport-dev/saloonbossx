import React from 'react';
import { View, ScrollView, TouchableOpacity } from 'react-native';
import { Text } from '../theme/Text';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeScreen } from '../components/SafeScreen';
import { useTheme } from '../context/ThemeContext';
import { appLocale } from '../config/regions';

const SECTIONS = [
  {
    icon: 'database-lock',
    title: 'Your Data Stays on Your Device',
    body: `SaloonBossX stores all your business data — client profiles, bills, staff records, appointments, inventory, and expenses — exclusively on your mobile device using an encrypted local SQLite database. We do not upload your business data to any cloud server. Your customers' personal information never leaves your phone unless you explicitly share it via WhatsApp, PDF, or the backup file you create yourself.`,
  },
  {
    icon: 'key-variant',
    title: 'License Verification',
    body: `To verify your license, the app sends only two pieces of information to our server: your anonymous device identifier (a random ID assigned by your phone manufacturer) and your license key. No personal details, business names, or client data are sent during license verification. This communication is encrypted using HTTPS.`,
  },
  {
    icon: 'account-group-outline',
    title: 'Client Data',
    body: `Client names, phone numbers, email addresses, date of birth, anniversary dates, and medical notes (allergies) are stored only on your device. This data is used to provide appointment reminders, birthday/anniversary wishes, and loyalty tracking within the app. You are the data controller responsible for this information and must comply with applicable privacy laws in your jurisdiction.`,
  },
  {
    icon: 'whatsapp',
    title: 'WhatsApp & Communication',
    body: `When you send a WhatsApp message from the app, the app opens WhatsApp's own app on your device with the pre-filled message. SaloonBossX does not access your WhatsApp account, conversations, or contacts. Message content is visible only within WhatsApp and is subject to WhatsApp's own privacy policy.`,
  },
  {
    icon: 'backup-restore',
    title: 'Backups',
    body: `The backup file you create contains all your business data in JSON format. You choose where to store this file — your device, Google Drive, WhatsApp, email, etc. Keep your backup files secure, as they contain sensitive business and client information. Anyone with access to the backup file can restore your data.`,
  },
  {
    icon: 'cloud-lock-outline',
    title: 'Free cloud (optional)',
    body: `If you turn on the free cloud, a daily backup and your branch figures are encrypted ON YOUR PHONE (AES-256) with a key that only your phones and your recovery key hold, and are then stored in a Google Drive used by SaloonBossX. Neither SaloonBossX nor Google can read them. Your online booking page (salon name, services, prices, opening hours and busy times) is public by design. A customer's booking request (name, phone, chosen time) stays in the cloud only until your phone collects it; after that only the time slot is kept, for at most 30 days. Turn it off any time with Disconnect.`,
  },
  {
    icon: 'shield-check-outline',
    title: 'Security',
    body: `Your database is stored in the app's private storage sandbox, inaccessible to other apps. We use SQLite WAL mode for data integrity. We recommend creating regular backups using the built-in backup feature in case of device loss or failure. Enable your device's screen lock to prevent unauthorized physical access.`,
  },
  {
    icon: 'update',
    title: 'Changes to This Policy',
    body: `We may update this Privacy Policy if the app's functionality changes significantly. We will notify you through the app when material changes occur. Continued use of the app after notification constitutes acceptance of the updated policy.`,
  },
  {
    icon: 'baby-face-outline',
    title: "Children's Privacy",
    body: `SaloonBossX is designed for use by salon business owners and staff. It is not directed at children under 13. Client records for minors may be stored only with appropriate parental consent per applicable local laws.`,
  },
];

export default function PrivacyScreen({ navigation }: any) {
  const { colors: c } = useTheme();
  const today = new Date().toLocaleDateString(appLocale(), { day: 'numeric', month: 'long', year: 'numeric' });
  return (
    <SafeScreen>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        <View style={{ backgroundColor: c.successLight, borderRadius: 14, padding: 14, marginBottom: 20 }}>
          <Text style={{ color: c.success, fontWeight: '800', fontSize: 14 }}>🔒 Your data stays on your device</Text>
          <Text style={{ color: c.success, fontSize: 12, marginTop: 4 }}>SaloonBossX does not upload your business or client data to any server.</Text>
        </View>

        <Text style={{ color: c.textMuted, fontSize: 12, marginBottom: 20 }}>Last updated: {today}</Text>

        {SECTIONS.map((sec, i) => (
          <View key={i} style={{ marginBottom: 22 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.primaryLight, alignItems: 'center', justifyContent: 'center' }}>
                <MaterialCommunityIcons name={sec.icon as any} size={18} color={c.primary} />
              </View>
              <Text style={{ color: c.text, fontSize: 15, fontWeight: '800', flex: 1 }}>{sec.title}</Text>
            </View>
            <Text style={{ color: c.textSecondary, fontSize: 14, lineHeight: 22, paddingLeft: 46 }}>{sec.body}</Text>
          </View>
        ))}

        <View style={{ backgroundColor: c.card, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: c.border }}>
          <Text style={{ color: c.text, fontSize: 14, fontWeight: '700', marginBottom: 8 }}>Privacy Questions?</Text>
          <Text style={{ color: c.textMuted, fontSize: 13, lineHeight: 20 }}>
            If you have questions about how your data is handled, or wish to request data deletion, use the Feedback screen in Settings. We aim to respond within 48 hours.
          </Text>
        </View>
      </ScrollView>
    </SafeScreen>
  );
}
