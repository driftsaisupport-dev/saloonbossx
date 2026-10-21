import { ErrorBoundary } from '../components/ErrorBoundary';
import React from 'react';
import { TouchableOpacity, View, StyleSheet, Platform } from 'react-native';
import { Text } from '../theme/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { DeepLinkService } from '../services/DeepLinkService';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { Protected } from '../components/Protected';
import { tr, useTr } from '../i18n/tr';

// Screens
import DashboardScreen    from '../screens/DashboardScreen';
import MyWorkScreen        from '../screens/MyWorkScreen';
import CalendarScreen     from '../screens/CalendarScreen';
import ClientsScreen      from '../screens/ClientsScreen';
import ClientDetailScreen from '../screens/ClientDetailScreen';
import ReportsScreen      from '../screens/ReportsScreen';
import SettingsScreen     from '../screens/SettingsScreen';
import BillingScreen      from '../screens/BillingScreen';
import BillHistoryScreen  from '../screens/BillHistoryScreen';
import StaffScreen        from '../screens/StaffScreen';
import ServicesScreen     from '../screens/ServicesScreen';
import PackagesScreen     from '../screens/PackagesScreen';
import InventoryScreen    from '../screens/InventoryScreen';
import ExpensesScreen     from '../screens/ExpensesScreen';
import PrivacyScreen      from '../screens/PrivacyScreen';
import TermsScreen        from '../screens/TermsScreen';
import StaffPaySlipScreen from '../screens/StaffPaySlipScreen';
import FeedbackScreen     from '../screens/FeedbackScreen';
import TipsScreen         from '../screens/TipsScreen';
import AcademyScreen      from '../screens/AcademyScreen';
import TaxReportScreen    from '../screens/TaxReportScreen';
import UsersScreen        from '../screens/UsersScreen';
import AttendanceRulesScreen from '../screens/AttendanceRulesScreen';
import CertificateTemplateScreen from '../screens/CertificateTemplateScreen';
import MarketingScreen        from '../screens/MarketingScreen';
import GrowScreen             from '../screens/GrowScreen';
import CampaignScreen         from '../screens/CampaignScreen';
import InsightsScreen         from '../screens/InsightsScreen';
import AIAssistantScreen      from '../screens/AIAssistantScreen';
import BranchHubScreen        from '../screens/BranchHubScreen';
import HQDashboardScreen      from '../screens/HQDashboardScreen';
import WhyUsScreen            from '../screens/WhyUsScreen';
import OnlineBookingScreen    from '../screens/OnlineBookingScreen';
import HelpScreen             from '../screens/HelpScreen';
import ImportClientsScreen    from '../screens/ImportClientsScreen';
import BillDesignScreen       from '../screens/BillDesignScreen';
import QueueScreen            from '../screens/QueueScreen';
import DayCloseScreen         from '../screens/DayCloseScreen';

const Stack = createNativeStackNavigator();
const Tab   = createBottomTabNavigator();

const TAB_ICONS: Record<string, [string, string]> = {
  Home:     ['home-variant',   'home-variant-outline'],
  Calendar: ['calendar-month', 'calendar-month-outline'],
  Clients:  ['account-group',  'account-group-outline'],
  Reports:  ['chart-box',      'chart-box-outline'],
  Settings: ['cog',            'cog-outline'],
};

function TabBar({ state, navigation }: any) {
  const { colors: c } = useTheme();
  useTr();
  const insets = useSafeAreaInsets();
  const bottomInset = Platform.OS === 'android' ? Math.max(insets.bottom, 12) : insets.bottom;

  return (
    <View style={[tb.bar, {
      backgroundColor: c.tabBar,
      borderTopColor: c.tabBarBorder,
      paddingBottom: bottomInset,
    }]}>
      {state.routes.map((route: any, i: number) => {
        const focused = state.index === i;
        const [activeIcon, inactiveIcon] = TAB_ICONS[route.name] || ['circle', 'circle-outline'];
        return (
          <TouchableOpacity key={route.key} style={tb.tab} activeOpacity={0.7}
            onPress={() => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
            }}>
            <View style={[tb.pill, focused && { backgroundColor: c.primaryLight }]}>
              <MaterialCommunityIcons name={(focused ? activeIcon : inactiveIcon) as any} size={22} color={focused ? c.primary : c.textMuted} />
            </View>
            <Text style={[tb.label, { color: focused ? c.primary : c.textMuted }]}>{tr(route.name)}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const tb = StyleSheet.create({
  bar:   { flexDirection: 'row', paddingTop: 8, paddingHorizontal: 6, borderTopWidth: StyleSheet.hairlineWidth },
  tab:   { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, paddingVertical: 2 },
  pill:  { width: 52, height: 30, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.1 },
});

function MainTabs() {
  const { user, can } = useAuth();
  // Line staff (stylist / trainer) get the focused "My Work" home instead of
  // the owner dashboard.
  const staffHome = user?.role === 'stylist' || user?.role === 'trainer';

  return (
    <Tab.Navigator tabBar={props => <TabBar {...props} />} screenOptions={{ headerShown: false, freezeOnBlur: true, lazy: true }}>
      <Tab.Screen name="Home" component={staffHome ? MyWorkScreen : DashboardScreen} />
      {can('calendar.view') && <Tab.Screen name="Calendar" component={CalendarScreen} />}
      {can('clients.view')  && <Tab.Screen name="Clients"  component={ClientsScreen} />}
      {can('reports.view')  && <Tab.Screen name="Reports"  component={ReportsScreen} />}
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}

function stackOpts(title: string, c: any) {
  return {
    headerShown: true, title: tr(title),
    headerStyle:       { backgroundColor: c.bg },
    headerTintColor:   c.text,
    headerTitleAlign:  'center' as const,
    headerTitleStyle:  { fontFamily: 'Inter_800ExtraBold', fontSize: 17, color: c.text },
    headerShadowVisible: false,
    headerBackButtonDisplayMode: 'minimal' as const,
    contentStyle:      { backgroundColor: c.bg },
    animation:         'slide_from_right' as const,
  };
}

export const navRef = createNavigationContainerRef<any>();

export default function AppNavigator() {
  const { colors: c } = useTheme();
  const { can } = useAuth();
  useTr();
  // A setup link (QR scan / WhatsApp join link) opens Branches & Cloud prefilled.
  React.useEffect(() => {
    const go = () => { if (navRef.isReady() && (can('branches.manage') || can('settings.backup'))) navRef.navigate('BranchHub'); };
    DeepLinkService.pending().then(p => { if (p.connectUrl || p.joinCode) setTimeout(go, 600); }).catch(() => {});
    return DeepLinkService.onLink(go);
  }, []);
  return (
    <NavigationContainer ref={navRef}>
      <Stack.Navigator screenOptions={{ headerShown: false, freezeOnBlur: true }}
        screenLayout={({ children, navigation, route }) => (
          // A crash in one screen shows a recovery card for that screen only — the rest of the app keeps working.
          <ErrorBoundary where={route.name} onBack={() => { if (navigation.canGoBack()) navigation.goBack(); else navigation.navigate('Main'); }}>
            {children}
          </ErrorBoundary>
        )}>
        <Stack.Screen name="Main" component={MainTabs} />

        <Stack.Screen name="Billing"
          options={{ ...stackOpts('New Bill', c), presentation: 'card' }}>
          {(p: any) => <Protected perm="billing.create"><BillingScreen {...p} /></Protected>}
        </Stack.Screen>

        {/* ClientDetail draws its own header (with the edit button) — the stack
            header on top of it showed two title bars. */}
        <Stack.Screen name="ClientDetail" options={{ headerShown: false }}>
          {(p: any) => <Protected perm="clients.view"><ClientDetailScreen {...p} /></Protected>}
        </Stack.Screen>

        <Stack.Screen name="BillHistory"
          options={stackOpts('Bill History', c)}>
          {(p: any) => <Protected perm="billing.history"><BillHistoryScreen {...p} /></Protected>}
        </Stack.Screen>

        {/* Staff, Expenses and Pay slip draw their own ScreenHeader (with actions) — no stack header on top. */}
        <Stack.Screen name="Staff" options={{ headerShown: false }}>
          {(p: any) => <Protected anyOf={['staff.view', 'attendance.view', 'attendance.manage']}><StaffScreen {...p} /></Protected>}
        </Stack.Screen>

        <Stack.Screen name="Services" options={{ headerShown: false }}>
          {(p: any) => <Protected perm="services.view"><ServicesScreen {...p} /></Protected>}
        </Stack.Screen>

        <Stack.Screen name="Packages" options={{ headerShown: false }}>
          {(p: any) => <Protected perm="services.view"><PackagesScreen {...p} /></Protected>}
        </Stack.Screen>

        <Stack.Screen name="Inventory" options={{ headerShown: false }}>
          {(p: any) => <Protected perm="inventory.view"><InventoryScreen {...p} /></Protected>}
        </Stack.Screen>

        <Stack.Screen name="Expenses" options={{ headerShown: false }}>
          {(p: any) => <Protected perm="expenses.view"><ExpensesScreen {...p} /></Protected>}
        </Stack.Screen>

        <Stack.Screen name="Academy" options={{ headerShown: false }}>
          {(p: any) => <Protected perm="academy.view"><AcademyScreen {...p} /></Protected>}
        </Stack.Screen>

        <Stack.Screen name="TaxReport" options={{ headerShown: false }}>
          {(p: any) => <Protected perm="reports.gst"><TaxReportScreen {...p} /></Protected>}
        </Stack.Screen>

        <Stack.Screen name="StaffPaySlip" options={{ headerShown: false }}>
          {(p: any) => <Protected anyOf={['staff.payroll', 'attendance.self']}><StaffPaySlipScreen {...p} /></Protected>}
        </Stack.Screen>

        <Stack.Screen name="Users" options={stackOpts('Users & Access', c)}>
          {(p: any) => <Protected perm="settings.users"><UsersScreen {...p} /></Protected>}
        </Stack.Screen>

        <Stack.Screen name="AttendanceRules" options={stackOpts('Attendance Rules', c)}>
          {(p: any) => <Protected perm="settings.attendance_rules"><AttendanceRulesScreen {...p} /></Protected>}
        </Stack.Screen>

        <Stack.Screen name="CertificateTemplate" options={stackOpts('Certificate Design', c)}>
          {(p: any) => <Protected perm="academy.certificate"><CertificateTemplateScreen {...p} /></Protected>}
        </Stack.Screen>

        <Stack.Screen name="Grow" options={stackOpts('Marketing & Growth', c)}>
          {(p: any) => <Protected perm="marketing.view"><GrowScreen {...p} /></Protected>}
        </Stack.Screen>
        <Stack.Screen name="Campaign" options={stackOpts('Campaign', c)}>
          {(p: any) => <Protected perm="marketing.view"><CampaignScreen {...p} /></Protected>}
        </Stack.Screen>
        <Stack.Screen name="Marketing" options={stackOpts('Poster Studio', c)}>
          {(p: any) => <Protected perm="marketing.view"><MarketingScreen {...p} /></Protected>}
        </Stack.Screen>

        <Stack.Screen name="Insights" options={stackOpts('Business Insights', c)}>
          {(p: any) => <Protected perm="insights.view"><InsightsScreen {...p} /></Protected>}
        </Stack.Screen>

        <Stack.Screen name="AIAssistant" options={stackOpts('Boss AI', c)}>
          {(p: any) => <Protected perm="ai.view"><AIAssistantScreen {...p} /></Protected>}
        </Stack.Screen>

        <Stack.Screen name="BranchHub" options={stackOpts('Branches & Cloud', c)}>
          {(p: any) => <Protected anyOf={['branches.manage', 'settings.backup']}><BranchHubScreen {...p} /></Protected>}
        </Stack.Screen>

        <Stack.Screen name="HQDashboard" options={stackOpts('HQ Dashboard', c)}>
          {(p: any) => <Protected perm="branches.view"><HQDashboardScreen {...p} /></Protected>}
        </Stack.Screen>

        <Stack.Screen name="WhyUs" component={WhyUsScreen} options={stackOpts('Why SaloonBossX', c)} />

        <Stack.Screen name="OnlineBooking" options={stackOpts('Online Booking', c)}>
          {(p: any) => <Protected perm="calendar.edit"><OnlineBookingScreen {...p} /></Protected>}
        </Stack.Screen>

        <Stack.Screen name="Help" component={HelpScreen} options={stackOpts('Help & FAQ', c)} />

        <Stack.Screen name="ImportClients" options={stackOpts('Import Customers', c)}>
          {(p: any) => <Protected perm="clients.edit"><ImportClientsScreen {...p} /></Protected>}
        </Stack.Screen>

        <Stack.Screen name="BillDesign" options={stackOpts('Bill Design', c)}>
          {(p: any) => <Protected perm="settings.business"><BillDesignScreen {...p} /></Protected>}
        </Stack.Screen>

        {/* Walk-in queue and Day close draw their own ScreenHeader (with actions). */}
        <Stack.Screen name="Queue" options={{ headerShown: false }}>
          {(p: any) => <Protected perm="queue.manage"><QueueScreen {...p} /></Protected>}
        </Stack.Screen>

        <Stack.Screen name="DayClose" options={{ headerShown: false }}>
          {(p: any) => <Protected anyOf={['cash.close', 'dashboard.revenue']}><DayCloseScreen {...p} /></Protected>}
        </Stack.Screen>

        {/* Legal / misc — always available */}
        <Stack.Screen name="Privacy"  component={PrivacyScreen}  options={stackOpts('Privacy Policy', c)} />
        <Stack.Screen name="Terms"    component={TermsScreen}    options={stackOpts('Terms of Service', c)} />
        <Stack.Screen name="Feedback" component={FeedbackScreen} options={stackOpts('Feedback', c)} />
        <Stack.Screen name="Tips"     component={TipsScreen}     options={stackOpts('Tips & Tricks', c)} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
