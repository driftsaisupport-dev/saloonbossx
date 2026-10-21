import React from 'react';
import { View, ScrollView, TouchableOpacity } from 'react-native';
import { Text } from '../theme/Text';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeScreen } from '../components/SafeScreen';
import { useTheme } from '../context/ThemeContext';
import { appLocale } from '../config/regions';

const SECTIONS = [
  {
    title: '1. Acceptance of Terms',
    body: `By downloading, installing, or using SaloonBossX ("the App"), you agree to be bound by these Terms of Service. If you do not agree, please do not use the App.`,
  },
  {
    title: '2. License & Usage',
    body: `SaloonBossX grants you a limited, non-exclusive, non-transferable license to use the App for your personal or business salon operations. You may not copy, modify, reverse-engineer, or redistribute the App or its components. Each license key is valid for one salon business and may not be shared across multiple unrelated businesses.`,
  },
  {
    title: '3. Data & Privacy',
    body: `All client data, billing records, staff information, and business data entered into SaloonBossX are stored exclusively on your device. The App does not transmit your business data to any external servers except for license verification (which uses only a device identifier and your license key). You are solely responsible for backing up your data using the built-in backup feature.`,
  },
  {
    title: '4. Billing & Payments',
    body: `SaloonBossX is sold as a monthly plan (paid every month, stop any time) or a one-time licence (paid once, no recurring charges). If the app does not work as described, contact us within 7 days of purchase for a full refund. License keys are non-transferable and tied to the device on which the App is activated.`,
  },
  {
    title: '5. Limitation of Liability',
    body: `SaloonBossX is provided "as is" without warranty of any kind. We are not liable for any data loss, business interruption, or financial loss resulting from use of the App. We strongly recommend using the backup feature regularly. You use the App at your own risk. Our liability is limited to the original purchase price of your license.`,
  },
  {
    title: '6. Acceptable Use',
    body: `You agree to use SaloonBossX only for lawful salon and beauty parlour business operations. You must not use the App to process fraudulent transactions, store illegal content, or violate applicable laws. You are responsible for ensuring that your use of the App complies with applicable tax and business regulations in your jurisdiction.`,
  },
  {
    title: '7. Updates & Support',
    body: `We may provide App updates from time to time. Updates may modify or remove features. Support is provided via the Feedback screen or through the contact details provided with your license. We do not guarantee a specific response time but aim to respond within 48 hours on business days.`,
  },
  {
    title: '8. Intellectual Property',
    body: `All content, design, code, and features of SaloonBossX are the intellectual property of the App developer. You may not use the App's design, branding, or code as a basis for competing products. The name "SaloonBossX" and associated branding are protected.`,
  },
  {
    title: '9. Changes to Terms',
    body: `These Terms may be updated at any time. Continued use of the App after changes constitutes acceptance of the new Terms. We will attempt to notify users of material changes through the App.`,
  },
  {
    title: '10. Governing Law',
    body: `These Terms are governed by the laws of India. Any disputes shall be resolved under the jurisdiction of courts in India. For international customers, disputes shall first be attempted to be resolved through good-faith negotiation.`,
  },
];

export default function TermsScreen({ navigation }: any) {
  const { colors: c } = useTheme();
  const today = new Date().toLocaleDateString(appLocale(), { day: 'numeric', month: 'long', year: 'numeric' });
  return (
    <SafeScreen>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        <View style={{ backgroundColor: c.primaryLight, borderRadius: 14, padding: 14, marginBottom: 20 }}>
          <Text style={{ color: c.primary, fontWeight: '700', fontSize: 13 }}>Last updated: {today}</Text>
          <Text style={{ color: c.primary, fontSize: 12, marginTop: 4 }}>Please read these terms carefully before using SaloonBossX.</Text>
        </View>

        {SECTIONS.map((sec, i) => (
          <View key={i} style={{ marginBottom: 20 }}>
            <Text style={{ color: c.text, fontSize: 15, fontWeight: '800', marginBottom: 8 }}>{sec.title}</Text>
            <Text style={{ color: c.textSecondary, fontSize: 14, lineHeight: 22 }}>{sec.body}</Text>
          </View>
        ))}

        <View style={{ backgroundColor: c.card, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: c.border, marginTop: 8 }}>
          <Text style={{ color: c.text, fontSize: 14, fontWeight: '700', marginBottom: 8 }}>Questions about these terms?</Text>
          <Text style={{ color: c.textMuted, fontSize: 13, lineHeight: 20 }}>
            Contact us via the Feedback screen in the app's Settings menu. We're happy to clarify any aspect of these terms.
          </Text>
        </View>
      </ScrollView>
    </SafeScreen>
  );
}
