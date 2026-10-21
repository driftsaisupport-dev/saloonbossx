import React, { useState } from 'react';
import { View, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { Text } from '../theme/Text';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeScreen } from '../components/SafeScreen';
import { useTheme } from '../context/ThemeContext';
import { Radius, Shadow } from '../theme/colors';

const tips = [
  { icon: 'receipt', title: 'Create a bill', steps: ['Tap "New Bill" on the Home tab', 'Select a client or turn on Walk-in', 'Tap + Service / + Product to add items', 'Choose payment method (Cash/UPI/Card/Split)', 'Tap Generate Bill — done!', 'Share the receipt as a PDF or on WhatsApp'] },
  { icon: 'calendar-plus', title: 'Book an appointment', steps: ['Open the Calendar tab', 'Tap "Book Appointment"', 'Select stylist and services', 'Pick a client or turn on Walk-in', 'Choose a start time and confirm'] },
  { icon: 'account-plus', title: 'Add a new client', steps: ['Open the Clients tab', 'Tap "+ New"', 'Enter name (required) and phone', 'Add birthday, notes or allergies if needed', 'Tap Save — they appear in your list'] },
  { icon: 'content-cut', title: 'Manage services', steps: ['Settings → Services', 'Tap + to add a new service', 'Set name, category, price, duration', 'Tap any service to edit it', 'Long-press to delete a service'] },
  { icon: 'account-group', title: 'Staff & attendance', steps: ['Settings → Staff & Attendance', 'Add staff with name and commission %', 'Use the Attendance tab to Check In / Out', 'Full day / half day is calculated automatically', 'Generate monthly pay slips from the same screen'] },
  { icon: 'package-variant', title: 'Track inventory', steps: ['Settings → Inventory', 'Add products with cost and sell price', 'Set a minimum stock level for alerts', 'Tap Restock to add quantity', 'Low-stock alerts appear on the Home tab'] },
  { icon: 'cloud-upload', title: 'Backup your data', steps: ['Settings → Save Backup to Drive', 'Your data exports as a JSON file', 'Share it to Google Drive, WhatsApp or email', 'Turn on Auto-Backup for a daily reminder', 'Restore anytime from Settings → Restore Backup'] },
  { icon: 'weather-night', title: 'Dark mode', steps: ['Dark mode follows your phone theme by default', 'Open Settings → Salon Profile to adjust the app', 'The whole app switches instantly', 'All colours are tuned for both themes'] },
];

const TipsScreen = ({ navigation }: any) => {
  const { colors: c } = useTheme();
  const [expanded, setExpanded] = useState<number | null>(0);

  return (
    <SafeScreen>
    <ScrollView style={[s.container, { backgroundColor: c.bg }]} contentContainerStyle={{ paddingTop: 16 }} showsVerticalScrollIndicator={false}>
      <View style={[s.heroBanner, { backgroundColor: c.primary }]}>
        <MaterialCommunityIcons name="lightbulb-on-outline" size={28} color={c.onPrimary} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={[s.heroTitle, { color: c.onPrimary }]}>Quick tips to get started</Text>
          <Text style={[s.heroSub, { color: c.onPrimary, opacity: 0.8 }]}>Tap any topic below to see step-by-step instructions</Text>
        </View>
      </View>

      {tips.map((tip, i) => (
        <TouchableOpacity key={i} style={[s.tipCard, { backgroundColor: c.card, borderColor: expanded === i ? c.primary : c.border }]}
          onPress={() => setExpanded(expanded === i ? null : i)} activeOpacity={0.7}>
          <View style={s.tipHeader}>
            <View style={[s.tipIcon, { backgroundColor: expanded === i ? c.primaryLight : c.surface }]}>
              <MaterialCommunityIcons name={tip.icon as any} size={22} color={expanded === i ? c.primary : c.textMuted} />
            </View>
            <Text style={[s.tipTitle, { color: c.text }]}>{tip.title}</Text>
            <MaterialCommunityIcons name={expanded === i ? 'chevron-up' : 'chevron-down'} size={22} color={c.textMuted} />
          </View>
          {expanded === i && (
            <View style={s.stepsContainer}>
              {tip.steps.map((step, j) => (
                <View key={j} style={s.stepRow}>
                  <View style={[s.stepNum, { backgroundColor: c.primaryLight }]}>
                    <Text style={[s.stepNumText, { color: c.primary }]}>{j + 1}</Text>
                  </View>
                  <Text style={[s.stepText, { color: c.textSecondary }]}>{step}</Text>
                </View>
              ))}
            </View>
          )}
        </TouchableOpacity>
      ))}
      <View style={{ height: 30 }} />
    </ScrollView>
    </SafeScreen>
  );
};

const s = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  title: { fontSize: 20, fontWeight: '700', letterSpacing: -0.3 },
  heroBanner: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 16, padding: 16, borderRadius: Radius.lg },
  heroTitle: { fontSize: 15, fontWeight: '700', color: '#FFF' },
  heroSub: { fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 2 },
  tipCard: { marginHorizontal: 16, marginBottom: 8, borderRadius: Radius.lg, borderWidth: 1, overflow: 'hidden', ...Shadow.sm },
  tipHeader: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  tipIcon: { width: 40, height: 40, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  tipTitle: { flex: 1, fontSize: 15, fontWeight: '600' },
  stepsContainer: { paddingHorizontal: 14, paddingBottom: 14, gap: 8 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepNum: { width: 24, height: 24, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  stepNumText: { fontSize: 12, fontWeight: '700' },
  stepText: { flex: 1, fontSize: 13, lineHeight: 18 },
});

export default TipsScreen;
