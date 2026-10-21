import React, { useEffect, useRef, useState } from 'react';
import { View, ActivityIndicator, StyleSheet, Image, AppState as RNAppState, TouchableOpacity, Alert } from 'react-native';
import { Text } from './src/theme/Text';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DatabaseService, isDatabaseOpenError } from './src/database/Database';
import { ThemeProvider } from './src/context/ThemeContext';
import { AppProvider } from './src/context/AppContext';
import { AuthProvider } from './src/context/AuthContext';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import AuthGate from './src/navigation/AuthGate';
import { BackupService } from './src/services/BackupService';
import { AppointmentReminderService } from './src/services/AppointmentReminderService';
import { BranchSyncService } from './src/services/BranchSyncService';
import { DeepLinkService } from './src/services/DeepLinkService';
import * as Notifications from 'expo-notifications';
import OnboardingScreen from './src/screens/OnboardingScreen';
import ActivationScreen from './src/screens/ActivationScreen';
import { LicenseService } from './src/services/LicenseService';
import { useFonts } from 'expo-font';
import { APP_FONTS } from './src/theme/fonts';
import i18n, { I18nProvider, changeLanguage } from './src/i18n';
import { AppShellContext } from './src/context/AppShellContext';
import { CrashLog } from './src/utils/crashLog';
import { contactSupport } from './src/config/sales';

CrashLog.install();

type AppState = 'loading' | 'error' | 'recovery' | 'onboarding' | 'activation' | 'main';

export default function App() {
  const [state, setState] = useState<AppState>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  // Background jobs (auto backup, cloud sync) only run once the database is
  // open and healthy — never against a half-open or freshly emptied one.
  const dbOk = useRef(false);
  const [localBackup, setLocalBackup] = useState<{ found: boolean; date?: string }>({ found: false });
  const [restoring, setRestoring] = useState(false);
  const [fontsOk, fontError] = useFonts(APP_FONTS);
  // A font that fails to load must never keep the owner on the splash screen.
  const fontsLoaded = fontsOk || !!fontError;

  useEffect(() => {
    boot();

    // Run the daily backup when the app goes to the background. That is the
    // moment the data is settled and the user is not waiting on anything.
    const appSub = RNAppState.addEventListener('change', (next) => {
      if (!dbOk.current) return;
      if (next === 'background' || next === 'inactive') {
        BackupService.runAuto().catch(() => {});
        // Push today's figures / daily encrypted backup to the owner's Drive.
        // Throttled inside the service; silently waits for internet.
        BranchSyncService.autoSync().catch(() => {});
      }
      if (next === 'active') {
        AppointmentReminderService.syncUpcoming().catch(() => {});
        BranchSyncService.autoSync().catch(() => {});
      }
    });

    // A tapped reminder should land on the backup section, not just open the app.
    const notifSub = Notifications.addNotificationResponseReceivedListener((response) => {
      if (AppointmentReminderService.handleResponse(response)) return;
      if (dbOk.current) BackupService.runAuto(true).catch(() => {});
    });

    return () => {
      appSub.remove();
      notifSub.remove();
    };
  }, []);

  async function boot() {
    try {
      dbOk.current = false;
      await DatabaseService.initialize();
      dbOk.current = true;
      // Apply the saved UI language before the first screen renders.
      try {
        const lang = await DatabaseService.getSetting('language');
        if (lang && lang !== i18n.language) await changeLanguage(lang);
      } catch {}
      await advance();

      // Catch up on a missed backup, then set the nudge based on how stale the
      // off-phone copy actually is.
      BackupService.runAuto().catch(() => {});
      BackupService.scheduleReminder().catch(() => {});
      setTimeout(() => { BranchSyncService.autoSync().catch(() => {}); }, 8000);
      // QR / WhatsApp setup links (saloonbossx://connect, saloonbossx://join).
      DeepLinkService.start();
      AppointmentReminderService.init()
        .then(() => { AppointmentReminderService.handleLaunchResponse(); return AppointmentReminderService.syncUpcoming(); })
        .catch(() => {});
    } catch (e: any) {
      console.error('Boot error:', e);
      CrashLog.record(e, 'boot').catch(() => {});
      setErrorMsg(e?.message || 'The app could not open its database.');
      if (isDatabaseOpenError(e)) {
        // The database exists but cannot be opened (keystore / key problem).
        // Nothing has been deleted — offer a calm retry or a restore.
        setLocalBackup(await BackupService.findRestorableBackup().catch(() => ({ found: false })));
        setState('recovery');
        return;
      }
      setState('error');
    }
  }

  function confirmRestore(kind: 'file' | 'latest') {
    Alert.alert(
      'Restore from backup?',
      'The app will start a fresh database from the backup. Your current data file is kept on the phone (set aside, not deleted) in case support can recover it later.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore', onPress: async () => {
            setRestoring(true);
            const r = kind === 'file' ? await BackupService.recoverFromFile() : await BackupService.recoverFromLatestLocal();
            setRestoring(false);
            if (!r.success) {
              if (r.message !== 'No file chosen.') Alert.alert('Restore did not finish', `${r.message}\n\nNothing else was changed. You can try again or choose another backup file.`);
              return;
            }
            Alert.alert('Restored', r.message);
            setState('loading');
            await boot();
          },
        },
      ]
    );
  }

  async function advance() {
    try {
      // Step 1: Must complete onboarding first
      const onboarded = await DatabaseService.getSetting('onboarding_complete');
      if (onboarded !== 'true') { setState('onboarding'); return; }

      // Step 2: a valid, unexpired licence OR an active free trial. getStatus()
      // re-verifies the signature and the expiry date every launch.
      let status = await LicenseService.getStatus();
      if (!status.activated && status.plan) {
        // A monthly / yearly plan ran out: maybe it was renewed in the licence
        // sheet already (UPI renewal) — check once before showing the renew screen.
        await LicenseService.revalidate(true).catch(() => {});
        status = await LicenseService.getStatus();
      }
      if (!status.activated) { setState('activation'); return; }

      // Step 3: server check for revocation (cached 24h, fails open offline).
      if (!status.trial) {
        const check = await LicenseService.revalidate();
        if (!check.ok) { setState('activation'); return; }
      }

      setState('main');
    } catch (e) {
      // Do NOT fail-open — send to activation so the device must have a valid key
      console.warn('advance() error:', e);
      setState('activation');
    }
  }

  if (state === 'loading' || !fontsLoaded) {
    return (
      <View style={s.splash}>
        <Image source={require('./assets/logo.png')} style={s.splashLogo} resizeMode="contain" />
        <Text style={s.splashTitle}>SALOONBOSS<Text style={{ color: '#D9A441' }}>X</Text></Text>
        <Text style={s.splashTag}>MANAGE · GROW · SHINE</Text>
        <ActivityIndicator color="#D9A441" size="small" style={{ marginTop: 28 }} />
      </View>
    );
  }

  if (state === 'recovery') {
    return (
      <View style={s.splash}>
        <Text style={{ fontSize: 44 }}>🔒</Text>
        <Text style={[s.splashTitle, { fontSize: 20, marginTop: 12, textAlign: 'center' }]}>Your data is safe</Text>
        <Text style={[s.splashSub, { color: '#F0E6D2', fontSize: 14.5, lineHeight: 21 }]}>
          SaloonBossX could not unlock its database just now. Nothing has been deleted.
        </Text>
        <Text style={[s.splashSub, { fontSize: 13.5, lineHeight: 20 }]}>
          Restart the phone and open the app again. If this keeps happening, restore from your latest backup.
        </Text>
        {restoring ? (
          <ActivityIndicator color="#D9A441" size="small" style={{ marginTop: 28 }} />
        ) : (
          <>
            <TouchableOpacity onPress={() => { setState('loading'); setTimeout(boot, 300); }}
              style={{ marginTop: 26, backgroundColor: '#D9A441', paddingHorizontal: 34, paddingVertical: 13, borderRadius: 14, minWidth: 240, alignItems: 'center' }}>
              <Text style={{ color: '#000', fontWeight: '800', fontSize: 15 }}>Retry</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => confirmRestore('file')}
              style={{ marginTop: 12, borderColor: '#D9A441', borderWidth: 1.5, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 14, minWidth: 240, alignItems: 'center' }}>
              <Text style={{ color: '#D9A441', fontWeight: '700', fontSize: 14.5 }}>Restore from backup file</Text>
            </TouchableOpacity>
            {localBackup.found && (
              <TouchableOpacity onPress={() => confirmRestore('latest')} style={{ marginTop: 12, padding: 8 }}>
                <Text style={{ color: '#B9AE96', textDecorationLine: 'underline', textAlign: 'center' }}>
                  Use this phone's automatic backup{localBackup.date ? ` (${new Date(localBackup.date).toLocaleString('en-IN')})` : ''}
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={async () => contactSupport(`Hi, SaloonBossX says it cannot unlock its database:\n${errorMsg}\n${await CrashLog.report()}`)} style={{ marginTop: 14, padding: 6 }}>
              <Text style={{ color: '#8B8698', textDecorationLine: 'underline' }}>Contact support</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    );
  }

  if (state === 'error') {
    return (
      <View style={s.splash}>
        <Text style={{ fontSize: 44 }}>⚠️</Text>
        <Text style={[s.splashTitle, { color: '#F2666B', fontSize: 20, marginTop: 12 }]}>Startup Error</Text>
        <Text style={s.splashSub}>{errorMsg}</Text>
        <Text style={[s.splashSub, { marginTop: 16, color: '#B9AE96', fontSize: 12.5 }]}>
          Please do NOT uninstall — your data is still on this phone. Restart the phone and open the app again. If it still fails, send us the report below.
        </Text>
        <TouchableOpacity onPress={() => { setState('loading'); setTimeout(boot, 300); }}
          style={{ marginTop: 22, backgroundColor: '#D9A441', paddingHorizontal: 34, paddingVertical: 13, borderRadius: 14 }}>
          <Text style={{ color: '#000', fontWeight: '800', fontSize: 15 }}>Try again</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={async () => contactSupport(`Hi, SaloonBossX does not open:\n${errorMsg}\n${await CrashLog.report()}`)} style={{ marginTop: 14, padding: 6 }}>
          <Text style={{ color: '#8B8698', textDecorationLine: 'underline' }}>Send report to support</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <I18nProvider>
          <ThemeProvider>
            <AppProvider>
              <AuthProvider>
                <AppShellContext.Provider value={{ resetToActivation: () => setState('activation'), restart: () => { setState('loading'); advance(); } }}>
                  {state === 'onboarding' && (
                    <OnboardingScreen onComplete={() => advance()} />
                  )}
                  {state === 'activation' && (
                    <ActivationScreen onActivation={() => setState('main')} />
                  )}
                  {state === 'main' && (
                    <AuthGate />
                  )}
                </AppShellContext.Provider>
              </AuthProvider>
            </AppProvider>
          </ThemeProvider>
          </I18nProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}

const s = StyleSheet.create({
  splash: {
    flex: 1, backgroundColor: '#000000',
    alignItems: 'center', justifyContent: 'center', padding: 40,
  },
  splashLogo: { width: 132, height: 132, marginBottom: 14 },
  splashTitle: { color: '#F0E6D2', fontSize: 24, fontWeight: '900', letterSpacing: 2 },
  splashTag: { color: '#9C8355', fontSize: 11, marginTop: 8, letterSpacing: 3, fontWeight: '700' },
  splashSub: { color: '#8B8698', fontSize: 13, marginTop: 12, textAlign: 'center' },
});
