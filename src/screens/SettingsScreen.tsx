import React, { useState, useEffect, useContext, useCallback } from 'react';
import { View, ScrollView, TouchableOpacity, Modal, Alert, Switch, Image, ActivityIndicator, Platform } from 'react-native';
import { Text, TextInput } from '../theme/Text';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { TabScreen as SafeScreen } from '../components/SafeScreen';
import { BottomModal } from '../components/BottomModal';
import { AppBar, Card, ListRow, SectionLabel, SegmentedTabs } from '../components/UI';
import { useTheme } from '../context/ThemeContext';
import { AppContext } from '../context/AppContext';
import { RegionPickerSheet } from '../components/RegionPicker';
import { useAuth } from '../context/AuthContext';
import { ROLE_LABELS, RoleId } from '../auth/permissions';
import { DatabaseService } from '../database/Database';
import { BackupService } from '../services/BackupService';
import { LicenseService } from '../services/LicenseService';
import { AppShellContext } from '../context/AppShellContext';
import { UpdateService, UpdateInfo, CURRENT_VERSION } from '../services/UpdateService';
import { WhatsAppService } from '../services/WhatsAppService';
import { DemoDataService } from '../services/DemoDataService';
import { BranchSyncService } from '../services/BranchSyncService';
import { BUSINESS_TYPES, BusinessType, businessTypeTitle } from '../config/businessTypes';
import { BusinessTypeService } from '../services/BusinessTypeService';
import { getLanguage } from '../i18n';
import { LANGUAGES, changeLanguage } from '../i18n';
import { tr, useTr } from '../i18n/tr';
import * as Linking from 'expo-linking';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import * as Updates from 'expo-updates';
import { DBX } from '../database/Database';
import { BottomSheet, Button } from '../components/UI';
import { useChoiceSheet } from '../components/ChoiceSheet';
import { showError, confirmAsync } from '../components/formUtils';
import { appEvents } from '../components/appEvents';
import { GstFields, GstValues, saveGstValues, validateGst } from '../components/GstFields';
import { appLocale, getRegion } from '../config/regions';

const FS_DOC_DIR = (FileSystem as any).documentDirectory ?? (FileSystem as any).cacheDirectory ?? '';

export default function SettingsScreen() {
  const { colors: c, mode, setTheme } = useTheme();
  useTr();
  const navigation = useNavigation<any>();
  const { refresh, setCurrencySymbol, region, changeRegion } = useContext(AppContext);
  const [showRegion, setShowRegion] = useState(false);
  const { resetToActivation, restart } = useContext(AppShellContext);
  const [receiptWidth, setReceiptWidth] = useState('a4');
  const [cloudLabel, setCloudLabel] = useState('');
  const [isDemo, setIsDemo] = useState(false);
  const [demoBusy, setDemoBusy] = useState('');
  const choice = useChoiceSheet();
  const [backupBusy, setBackupBusy] = useState<'' | 'backup' | 'share' | 'folder' | 'auto' | 'restore'>('');
  const [pricesInclGST, setPricesInclGST] = useState(false);
  // Owner PIN check before a restore replaces this phone's logins.
  const [pinGate, setPinGate] = useState<{ resolve: (ok: boolean) => void } | null>(null);
  const [gatePin, setGatePin] = useState('');
  const [gateBusy, setGateBusy] = useState(false);
  const [bizType, setBizType] = useState<BusinessType | null>(null);
  const [bizBusy, setBizBusy] = useState(false);
  useFocusEffect(useCallback(() => {
    BusinessTypeService.getStored().then(setBizType).catch(() => {});
    DatabaseService.getSetting('receipt_width').then(v => setReceiptWidth(v || 'a4')).catch(() => {});
    DemoDataService.isDemo().then(setIsDemo).catch(() => {});
    BranchSyncService.status().then(st => setCloudLabel(st.cfg
      ? `${st.cfg.isHQ ? 'Head office' : 'Branch'} · ${st.cfg.branchName} · backup ${st.lastBackup ? new Date(st.lastBackup).toLocaleDateString(appLocale()) : 'pending'}`
      : '')).catch(() => {});
  }, []));

  function chooseReceipt() {
    const set = (v: string) => { setReceiptWidth(v); DatabaseService.setSetting('receipt_width', v).catch(e => showError(e, 'Not saved')); };
    choice.open({
      title: tr('Bill printer'),
      message: tr('A4 uses the normal print dialog. For a Bluetooth / USB thermal printer pick its paper width and install the printer’s Android print service (for example RawBT).'),
      options: [
        { label: 'A4 / PDF', icon: 'file-pdf-box', selected: receiptWidth === 'a4', onPress: () => set('a4') },
        { label: tr('80 mm thermal'), icon: 'printer-pos', selected: receiptWidth === '80', onPress: () => set('80') },
        { label: tr('58 mm thermal'), icon: 'printer-pos', selected: receiptWidth === '58', onPress: () => set('58') },
      ],
    });
  }

  async function demoMenu() {
    if (demoBusy) return;
    if (isDemo) {
      const ok = await confirmAsync('Demo salon is loaded', 'Clear all demo data and set up your real salon? Logins and licence stay.', 'Clear & start fresh', true);
      if (!ok) return;
      setDemoBusy(tr('Clearing…'));
      try { await DemoDataService.clearAll(); await DatabaseService.setSetting('setup_hidden', ''); restart(); }
      catch (e) { showError(e, 'Could not clear demo data'); }
      finally { setDemoBusy(''); }
      return;
    }
    choice.open({
      title: tr('Load demo salon?'),
      message: tr('Adds ~75 days of sample bills, clients, staff and stock so you can show every screen. Best on a phone with no real data. You can clear it later.'),
      options: BUSINESS_TYPES.slice(0, 3).map(b => ({ label: tr(b.title), icon: 'store-outline', onPress: () => loadDemo(b.id) })),
    });
  }
  function pickBusinessType() {
    if (bizBusy) return;
    choice.open({
      title: tr('Business type'),
      message: tr('Changes the starter service menu and the order of quick actions on Home. Your data is not changed.'),
      options: BUSINESS_TYPES.map(b => ({
        label: businessTypeTitle(b.id, getLanguage()), hint: tr(b.blurb), icon: b.icon, selected: bizType === b.id,
        onPress: () => applyBusinessType(b.id),
      })),
    });
  }
  async function applyBusinessType(t: BusinessType) {
    if (bizBusy) return;
    setBizBusy(true);
    try {
      await BusinessTypeService.set(t);
      setBizType(t);
      if (!can('services.edit')) return;
      const plan = await BusinessTypeService.starterPlan(t);
      if (!plan.toAdd.length) return;
      const title = businessTypeTitle(t, getLanguage());
      const ok = plan.menuEmpty
        ? await confirmAsync('Add a starter menu?', tr('Add {n} common {type} services with typical prices? You can edit or remove any of them later.', { n: plan.toAdd.length, type: title }), 'Add services')
        : await confirmAsync('Add missing services?', tr('Your menu already has services. Add {n} more common {type} services that are not on it yet? Nothing you have is changed.', { n: plan.toAdd.length, type: title }), 'Add services');
      if (!ok) return;
      const n = await BusinessTypeService.addServices(plan.toAdd);
      Alert.alert(tr('Done'), tr('{n} services added', { n }));
    } catch (e) { showError(e, 'Not saved'); }
    finally { setBizBusy(false); }
  }

  async function loadDemo(t: BusinessType) {
    setDemoBusy(tr('Starting…'));
    try { await DemoDataService.load(t, p => setDemoBusy(`${p.step} ${p.pct}%`)); setIsDemo(true); refresh(); Alert.alert(tr('Demo ready'), tr('Open Home, Reports and Boss AI to see it in action.')); }
    catch (e) { showError(e, 'Demo failed'); }
    finally { setDemoBusy(''); }
  }
  const { user, can, lock, logout, autoLockMinutes, setAutoLockMinutes } = useAuth();
  const isOwner = !!user?.isOwner;
  const [showAutoLock, setShowAutoLock] = useState(false);
  const [showLanguage, setShowLanguage] = useState(false);
  const [currentLang, setCurrentLang] = useState('en');
  useEffect(() => {
    DatabaseService.getSetting('language').then(l => { if (l) setCurrentLang(l); }).catch(() => {});
  }, []);
  const currentLangName = LANGUAGES.find(l => l.code === currentLang)?.nativeName || 'English';
  const AUTO_LOCK_OPTIONS = [
    { m: 1, label: '1 minute' },
    { m: 3, label: '3 minutes' },
    { m: 5, label: '5 minutes' },
    { m: 15, label: '15 minutes' },
    { m: 0, label: 'Only when closed / backgrounded' },
  ];
  const autoLockLabel = AUTO_LOCK_OPTIONS.find(o => o.m === autoLockMinutes)?.label || `${autoLockMinutes} min`;
  const [removingLicense, setRemovingLicense] = useState(false);
  const [hasAcademy, setHasAcademy] = useState(false);
  const [hasStaff, setHasStaff] = useState(true);
  const [hasGST, setHasGST] = useState(true);
  const [hasMarketing, setHasMarketing] = useState(true);
  const [hasInsights, setHasInsights] = useState(true);

  useEffect(() => {
    // Only ever *hide* a feature when we positively know the plan — a transient
    // license-read failure must not strip menu items from a paying user.
    LicenseService.getStatus().then(({ activated, plan }) => {
      if (!activated || !plan) return; // unknown → keep everything visible
      setHasAcademy(plan === 'academy');
      setHasStaff(plan !== 'solo');
      setHasGST(plan !== 'solo');
      setHasMarketing(plan !== 'solo');
      setHasInsights(plan !== 'solo');
    }).catch(() => {});
  }, []);

  const [profile,      setProfile]      = useState<any>({});
  const [form,         setForm]         = useState<any>({});
  const [showProfile,  setShowProfile]  = useState(false);
  const [showLicense,  setShowLicense]  = useState(false);
  const [licenseInfo,  setLicenseInfo]  = useState<any>(null);
  const [lastBackup,   setLastBackup]   = useState('Never');
  const [saving,       setSaving]       = useState(false);
  const [uploadingImg, setUploadingImg] = useState(false);
  // GST settings
  const [gstEnabled, setGstEnabled]    = useState(false);
  const [gstForm, setGstForm] = useState<GstValues>({ enabled: false, gstin: '', rate: '5', inclusive: false });
  const [gstDirty, setGstDirty] = useState(false);
  const [gstSaving, setGstSaving] = useState(false);
  const [supportPhone, setSupportPhone] = useState('');
  const [supportEmail, setSupportEmail] = useState('');
  const [backupCount,  setBackupCount]  = useState(0);
  const [autoBackup,   setAutoBackup]   = useState(false);
  const [autoHour,     setAutoHour]     = useState(1);
  const [showAutoBackup, setShowAutoBackup] = useState(false);
  const [backupFolder, setBackupFolder] = useState('');
  const [backupEmail,  setBackupEmail]  = useState('');
  const [backupHealth, setBackupHealth] = useState<{ daysSinceOffDevice: number; level: string } | null>(null);
  const [updateInfo,   setUpdateInfo]   = useState<UpdateInfo | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  // WhatsApp "re-engage lapsed clients" reminder — configurable days-since-last-visit + message template.
  const [showReengage,     setShowReengage]     = useState(false);
  const [reengageEnabled,  setReengageEnabled]  = useState(true);
  const [reengageDaysStr,  setReengageDaysStr]  = useState('30');
  const [reengageMessage,  setReengageMessage]  = useState(WhatsAppService.DEFAULT_REENGAGE_MESSAGE);
  const [savingReengage,   setSavingReengage]   = useState(false);

  useFocusEffect(useCallback(() => { load(); }, []));

  async function load() {
    try {
      await DatabaseService.ensureReady();

      // Backup state is read separately so a failure here never blocks the
      // rest of the settings screen from rendering.
      BackupService.getFolder().then(setBackupFolder).catch(() => {});
      BackupService.getBackupEmail().then(setBackupEmail).catch(() => {});
      BackupService.health().then(setBackupHealth).catch(() => {});
      DatabaseService.getSetting('auto_backup_enabled')
        .then(v => setAutoBackup(v !== 'false'))
        .catch(() => {});

      const [p, prefix, licKey, licPlan, licExpiry, bkDate, gstVal, supPhone, supEmail, reEnabled, reDays, reMsg] = await Promise.all([
        DatabaseService.getSalonProfile(),
        DatabaseService.getSetting('bill_prefix'),
        DatabaseService.getSetting('license_key'),
        DatabaseService.getSetting('license_plan'),
        DatabaseService.getSetting('license_expiry'),
        DatabaseService.getSetting('last_backup'),
        DatabaseService.getSetting('gst_enabled'),
        DatabaseService.getSetting('support_whatsapp'),
        DatabaseService.getSetting('support_email'),
        DatabaseService.getSetting('reengage_enabled'),
        DatabaseService.getSetting('reengage_days'),
        DatabaseService.getSetting('reengage_message'),
      ]);
      const prof = { ...(p as any), bill_prefix: prefix || 'SOS' };
      setProfile(prof);
      setForm(prof);
      const gstOn = gstVal === 'true';
      setGstEnabled(gstOn);
      const inclVal = await DatabaseService.getSetting('prices_include_gst').catch(() => 'false');
      setPricesInclGST(inclVal === 'true');
      setGstForm({ enabled: gstOn, gstin: String((p as any)?.gst_number || ''), rate: String((p as any)?.tax_rate ?? 5), inclusive: inclVal === 'true' });
      setGstDirty(false);
      setSupportPhone(supPhone || '');
      setSupportEmail(supEmail || '');
      setReengageEnabled(reEnabled !== 'false');
      setReengageDaysStr(reDays || '30');
      setReengageMessage(reMsg || WhatsAppService.DEFAULT_REENGAGE_MESSAGE);
      setLastBackup(bkDate ? new Date(bkDate).toLocaleDateString(appLocale()) : 'Never');
      // Plan and expiry come from the verified key in SecureStore, not the
      // settings table (which no longer holds them and always showed "Standard").
      LicenseService.getLicenseInfo().then(info => {
        if (!info.activated) { setLicenseInfo(null); return; }
        setLicenseInfo({
          key: info.key || licKey,
          plan: info.trial ? 'Free Trial' : (info.planDetails?.name || 'Standard'),
          expiry: info.trial ? `${info.daysLeft} day${info.daysLeft === 1 ? '' : 's'} left` : (info.expiry === 'LIFETIME' ? 'Lifetime' : info.expiry),
          trial: info.trial,
          billing: info.billing,
          daysLeft: info.daysLeft,
          grace: info.grace,
        });
      }).catch(() => {});

      // Check for app updates in the background (cached — won't slow down load)
      UpdateService.checkForUpdate().then(info => setUpdateInfo(info)).catch(() => {});

      const [bc, abs] = await Promise.all([
        BackupService.getBackupCount(),
        BackupService.getAutoBackupSettings(),
      ]);
      setBackupCount(bc);
      setAutoBackup(abs.enabled);
      setAutoHour(abs.hour);
    } catch (e) { console.warn('Settings load:', e); }
  }

  // Save image URI to permanent storage
  async function saveImageToDisk(uri: string): Promise<string> {
    const profileDir = FS_DOC_DIR + 'profile_images/';
    const info = await FileSystem.getInfoAsync(profileDir);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(profileDir, { intermediates: true });
    }
    const ext = uri.split('.').pop()?.split('?')[0] || 'jpg';
    const fileName = `salon_${Date.now()}.${ext}`;
    const dest = profileDir + fileName;
    // Try move first (faster, avoids permission issues on some Android versions)
    try {
      await FileSystem.moveAsync({ from: uri, to: dest });
    } catch {
      // Fallback to copy
      await FileSystem.copyAsync({ from: uri, to: dest });
    }
    // Clean up old photo if different
    if (form.profile_image && form.profile_image !== dest) {
      try { await FileSystem.deleteAsync(form.profile_image, { idempotent: true }); } catch {}
    }
    return dest;
  }

  async function pickProfileImage() {
    setUploadingImg(true);
    try {
      // Request permission
      const permResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permResult.status === 'denied') {
        Alert.alert(
          'Permission Required',
          'Photo library access was denied. Please enable it in your phone Settings > Apps > SaloonBossX > Permissions.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ]
        );
        return;
      }
      if (permResult.status !== 'granted') {
        Alert.alert('Permission Required', 'Please allow access to your photo library.');
        return;
      }

      // Use the current media type API.
      let result: ImagePicker.ImagePickerResult;
      try {
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.75,
        });
      } catch {
        // Fallback for newer API versions
        result = await (ImagePicker as any).launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.75,
        });
      }

      if (!result.canceled && result.assets?.length > 0) {
        const savedPath = await saveImageToDisk(result.assets[0].uri);
        setForm((f: any) => ({ ...f, profile_image: savedPath }));
      }
    } catch (e: any) {
      console.error('pickProfileImage error:', e);
      Alert.alert('Could Not Open Gallery', 'Please try again or use the camera option instead.');
    } finally {
      setUploadingImg(false);
    }
  }

  async function takeProfilePhoto() {
    setUploadingImg(true);
    try {
      const permResult = await ImagePicker.requestCameraPermissionsAsync();
      if (permResult.status === 'denied') {
        Alert.alert(
          'Permission Required',
          'Camera access was denied. Please enable it in Settings > Apps > SaloonBossX > Permissions.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ]
        );
        return;
      }
      if (permResult.status !== 'granted') {
        Alert.alert('Permission Required', 'Please allow camera access.');
        return;
      }

      let result: ImagePicker.ImagePickerResult;
      try {
        result = await ImagePicker.launchCameraAsync({
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.75,
        });
      } catch (e) {
        Alert.alert('Camera Error', 'Could not open camera. Please use the gallery option instead.');
        return;
      }

      if (!result.canceled && result.assets?.length > 0) {
        const savedPath = await saveImageToDisk(result.assets[0].uri);
        setForm((f: any) => ({ ...f, profile_image: savedPath }));
      }
    } catch (e: any) {
      console.error('takeProfilePhoto error:', e);
      Alert.alert('Camera Error', 'Could not take photo. Please try again.');
    } finally {
      setUploadingImg(false);
    }
  }

  // Was a 4-button Alert — Android only shows 3, so "Camera" disappeared.
  function showImageOptions() {
    choice.open({
      title: tr('Salon photo / logo'),
      options: [
        { label: tr('Take photo'), icon: 'camera-outline', onPress: takeProfilePhoto },
        { label: tr('Choose from gallery'), icon: 'image-outline', onPress: pickProfileImage },
        ...(form.profile_image ? [{ label: tr('Remove photo'), icon: 'delete-outline', tone: 'danger' as const, onPress: () => setForm((f: any) => ({ ...f, profile_image: '' })) }] : []),
      ],
    });
  }

  async function saveProfile() {
    if (!form.name?.trim()) { Alert.alert('Required', 'Salon name cannot be empty.'); return; }
    setSaving(true);
    try {
      // GSTIN and tax rate are owned by the GST section — never overwrite them from this form.
      const { bill_prefix, gst_number: _g, tax_rate: _t, ...rest } = form;
      await Promise.all([
        DatabaseService.updateSalonProfile(rest),
        bill_prefix ? DatabaseService.setSetting('bill_prefix', bill_prefix.trim().toUpperCase() || 'SOS') : Promise.resolve(),
      ]);
      setShowProfile(false);
      load();
      refresh();
      if (form.currency_symbol) setCurrencySymbol(form.currency_symbol);
      Alert.alert('✅ Saved', 'Salon profile updated successfully.');
    } catch (e) { Alert.alert('Error', 'Could not save profile. Please try again.'); }
    finally { setSaving(false); }
  }

  async function saveGst() {
    const err = validateGst(gstForm);
    if (err) { Alert.alert(tr('Check GST details'), tr(err)); return; }
    if (gstForm.enabled && !gstForm.gstin.trim()) {
      const ok = await confirmAsync(tr('No GSTIN'), tr('Only GST-registered businesses may charge GST. Turn GST on without a GSTIN?'), tr('Turn on'), false);
      if (!ok) return;
    }
    setGstSaving(true);
    try {
      await saveGstValues(DatabaseService as any, gstForm);
      setGstEnabled(gstForm.enabled);
      setPricesInclGST(gstForm.enabled && gstForm.inclusive);
      setGstDirty(false);
      Alert.alert(tr('Saved'), gstForm.enabled
        ? tr('GST @ {rate}% will be shown on new bills.', { rate: String(gstForm.rate).replace(',', '.') })
        : tr('GST is off. New bills will not include GST.'));
      load();
    } catch (e) { showError(e, tr('Not saved')); }
    finally { setGstSaving(false); }
  }

  async function saveSupportInfo() {
    try {
      await Promise.all([
        DatabaseService.setSetting('support_whatsapp', supportPhone),
        DatabaseService.setSetting('support_email', supportEmail),
      ]);
      Alert.alert(`✅ ${tr('Saved')}`, tr('Support contact info updated.'));
    } catch (e) { showError(e, 'Not saved'); }
  }

  /** Things a backup file does NOT hold (e.g. client photos), as bullet lines. '' when none. */
  async function backupWarningLines(extra: string[] = []): Promise<string> {
    let w: string[] = [];
    try { w = await DBX.getBackupWarnings(); } catch { /* warnings are advisory */ }
    const all = [...extra, ...w].filter((x, i, a) => !!x && a.indexOf(x) === i);
    return all.length ? `\n\n⚠️ ${all.map(x => tr(x)).join('\n⚠️ ')}` : '';
  }

  async function doBackup() {
    if (backupBusy) return;
    setBackupBusy('backup');
    try {
      const r = await BackupService.createLocal('manual');
      load();
      if (!r.success) return Alert.alert(tr('Backup failed'), tr(r.message || 'Please try again.'));
      const warn = await backupWarningLines();
      Alert.alert(
        tr('Backup saved'),
        tr('A copy is stored on this phone. Send it somewhere off the phone so a lost or broken device does not take your data with it.') + warn,
        [
          { text: tr('Later'), style: 'cancel' },
          { text: tr('Email it'), onPress: () => { if (r.uri) BackupService.emailBackup(r.uri).catch(e => showError(e, 'Could not email')); } },
          { text: tr('Share'), onPress: () => { if (r.uri) BackupService.shareBackup(r.uri).catch(e => showError(e, 'Could not share')); } },
        ]
      );
    } catch (e) { showError(e, 'Backup failed'); }
    finally { setBackupBusy(''); }
  }

  async function doShareBackup() {
    if (backupBusy) return;
    setBackupBusy('share');
    try {
      const r = await BackupService.createLocal('manual');
      load();
      if (!r.success || !r.uri) return Alert.alert(tr('Backup failed'), tr(r.message || 'Please try again.'));
      const shared = await BackupService.shareBackup(r.uri);
      if (!shared.success) Alert.alert(tr('Could not share'), tr(shared.message || 'Please try again.'));
      else {
        const warn = await backupWarningLines();
        if (warn) Alert.alert(tr('Good to know'), tr('The backup file was shared.') + warn);
      }
    } catch (e) { showError(e, 'Could not share'); }
    finally { setBackupBusy(''); }
  }

  async function chooseBackupFolder() {
    if (backupBusy) return;
    setBackupBusy('folder');
    try {
      const r = await BackupService.chooseFolder();
      setBackupFolder(await BackupService.getFolder());
      Alert.alert(r.success ? tr('Folder set') : tr('Not set'), tr(r.message || ''));
      if (r.success) BackupService.runAuto(true).catch(() => {});
    } catch (e) { showError(e, 'Folder not set'); }
    finally { setBackupBusy(''); }
  }

  async function saveBackupEmail(email: string) {
    setBackupEmail(email);
    try { await BackupService.setBackupEmail(email); } catch { /* retried on next keystroke */ }
  }

  async function toggleAutoBackup(val: boolean) {
    if (backupBusy) return;
    const prev = autoBackup;
    setAutoBackup(val);
    setBackupBusy('auto');
    try {
      await DatabaseService.setSetting('auto_backup_enabled', val ? 'true' : 'false');
      if (val) {
        await BackupService.runAuto(true);
        await BackupService.scheduleReminder(autoHour);
        load();
      } else {
        await BackupService.cancelReminder();
      }
    } catch (e) { setAutoBackup(prev); showError(e, 'Auto backup not changed'); }
    finally { setBackupBusy(''); }
  }

  async function saveReengageSettings() {
    const days = Math.max(1, parseInt(reengageDaysStr, 10) || 30);
    const message = reengageMessage.trim() || WhatsAppService.DEFAULT_REENGAGE_MESSAGE;
    setSavingReengage(true);
    try {
      await Promise.all([
        DatabaseService.setSetting('reengage_enabled', reengageEnabled ? 'true' : 'false'),
        DatabaseService.setSetting('reengage_days', String(days)),
        DatabaseService.setSetting('reengage_message', message),
      ]);
      setReengageDaysStr(String(days));
      setReengageMessage(message);
      setShowReengage(false);
    } catch {
      Alert.alert('Error', 'Could not save reminder settings.');
    } finally {
      setSavingReengage(false);
    }
  }

  function confirmRemoveLicense() {
    Alert.alert(
      'Remove License from this Device?',
      'This unlinks your license key from this device. The app will return to the activation screen and your salon data stays untouched.\n\n' +
      'Do this while connected to the internet so the key is freed for your new phone. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove License',
          style: 'destructive',
          onPress: async () => {
            setRemovingLicense(true);
            try {
              await LicenseService.releaseDevice();
              setShowLicense(false);
              setLicenseInfo(null);
              resetToActivation();
            } catch (e) {
              showError(e, 'Could not remove the licence', 'Could not remove the licence. Check the internet and try again.');
            } finally {
              setRemovingLicense(false);
            }
          },
        },
      ]
    );
  }

  async function checkForUpdates() {
    setCheckingUpdate(true);
    try {
      const info = await UpdateService.forceCheck();
      setUpdateInfo(info);
      if (!info.available) {
        Alert.alert('✅ Up to Date', `SaloonBossX v${CURRENT_VERSION} is the latest version.`);
      }
    } catch { Alert.alert('Error', 'Could not check for updates. Please try again.'); }
    finally { setCheckingUpdate(false); }
  }

  async function openUpdateDownload() {
    if (!updateInfo?.downloadUrl) return;
    try {
      const canOpen = await Linking.canOpenURL(updateInfo.downloadUrl);
      if (canOpen) {
        await Linking.openURL(updateInfo.downloadUrl);
      } else {
        await Linking.openURL(updateInfo.releasePageUrl);
      }
    } catch { Alert.alert('Error', 'Could not open download link.'); }
  }

  /** Ask the owner to type their PIN again. Resolves true only on a correct PIN. */
  function askOwnerPin(): Promise<boolean> {
    return new Promise(resolve => { setGatePin(''); setPinGate({ resolve }); });
  }
  async function submitGatePin() {
    if (!pinGate || gateBusy || !user) return;
    if (!/^\d{4,6}$/.test(gatePin)) { Alert.alert(tr('Enter your PIN'), tr('Type your 4–6 digit owner PIN.')); return; }
    setGateBusy(true);
    try {
      const DB: any = DBX;
      const lockInfo = typeof DB.authLockStatus === 'function' ? await DB.authLockStatus(user.id).catch(() => null) : null;
      if (lockInfo?.locked) { Alert.alert(tr('Too many wrong PINs'), tr('PIN entry is paused for now. Try again later.')); return; }
      const ok = await DB.authVerifyPin(user.id, gatePin);
      if (!ok) { setGatePin(''); Alert.alert(tr('Wrong PIN'), tr('That PIN is not correct.')); return; }
      const g = pinGate; setPinGate(null); g.resolve(true);
    } catch (e) { showError(e, 'Could not check PIN'); }
    finally { setGateBusy(false); }
  }
  function cancelGate() { const g = pinGate; setPinGate(null); g?.resolve(false); }

  /** Reload the whole app so no screen keeps showing pre-restore data. */
  async function reloadApp() {
    appEvents.emit('data:restored');
    try {
      if (!__DEV__ && typeof (Updates as any).reloadAsync === 'function') { await Updates.reloadAsync(); return; }
    } catch { /* fall back to the in-app restart below */ }
    restart();
  }

  async function doRestore() {
    if (backupBusy) return;
    const sure = await confirmAsync('Restore backup',
      'This will REPLACE ALL current data with the backup file. A safety backup of the current data is taken first.\n\nContinue?', 'Choose file', true);
    if (!sure) return;
    setBackupBusy('restore');
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain', '*/*'], copyToCacheDirectory: true });
      if (picked.canceled || !picked.assets?.[0]) return;
      const json = await FileSystem.readAsStringAsync(picked.assets[0].uri, { encoding: 'utf8' as any });

      // Logins: keep this phone's (default) or take the backup's — the second
      // replaces every login, so only the owner, after re-entering the PIN.
      let keepLocalUsers = true;
      if (isOwner) {
        const pickUsers = await new Promise<'keep' | 'backup' | 'cancel'>(resolve => {
          choice.open({
            title: tr('Logins after restore'),
            message: tr('Which usernames and PINs should this phone use?'),
            options: [
              { label: tr('Keep the logins on this phone'), hint: tr('Recommended'), icon: 'account-lock-outline', tone: 'success', onPress: () => resolve('keep') },
              { label: tr('Use the logins from the backup'), hint: tr('Needs your owner PIN'), icon: 'account-switch-outline', tone: 'warning', onPress: () => resolve('backup') },
            ],
            onCancel: () => resolve('cancel'),
          });
        });
        if (pickUsers === 'cancel') return;
        if (pickUsers === 'backup') {
          const ok = await askOwnerPin();
          if (!ok) return;
          keepLocalUsers = false;
        }
      }

      // Safety snapshot first — restore is destructive.
      const snap = await BackupService.createLocal('pre-restore').catch(() => ({ success: false } as any));
      if (!snap?.success) {
        const go = await confirmAsync('Safety backup failed', 'Could not save a copy of the current data first. Restore anyway?', 'Restore anyway', true);
        if (!go) return;
      }
      const result: any = await (DBX as any).importData(json, { keepLocalUsers });
      if (!result?.success) { Alert.alert(tr('Restore failed'), tr(result?.message || 'That file is not a valid backup.')); return; }
      const warn = await backupWarningLines(Array.isArray(result?.warnings) ? result.warnings : []);
      Alert.alert(`✅ ${tr('Restored')}`, tr('Your data was restored. The app will now reload.') + warn, [
        { text: tr('OK'), onPress: () => { if (!keepLocalUsers) logout().catch(() => {}).finally(reloadApp); else reloadApp(); } },
      ], { cancelable: false });
    } catch (e) {
      showError(e, 'Restore failed', 'Could not restore that file. Your current data was not changed.');
    } finally { setBackupBusy(''); }
  }

  const salonItems = [
    ...(can('settings.business') ? [{ icon: 'cog-outline', label: tr('Salon Profile'), sub: profile.name || tr('Tap to set up'), onPress: () => { setForm({...profile}); setShowProfile(true); } }] : []),
    ...(can('settings.business') ? [{ icon: 'store-cog-outline', label: tr('Business type'), sub: bizBusy ? tr('Saving…') : bizType ? businessTypeTitle(bizType, getLanguage()) : tr('Not set — tap to choose'), onPress: pickBusinessType }] : []),
    ...(can('services.view') ? [{ icon: 'scissors-cutting', label: tr('Services'), sub: tr('Manage service menu'), onPress: () => navigation.navigate('Services') }] : []),
    ...(can('clients.edit') ? [{ icon: 'account-arrow-down-outline', label: tr('Import customers'), sub: tr('From phone contacts or Excel / CSV'), onPress: () => navigation.navigate('ImportClients') }] : []),
    ...(can('inventory.view') ? [{ icon: 'package-variant', label: tr('Inventory'), sub: tr('Stock & retail products'), onPress: () => navigation.navigate('Inventory') }] : []),
    ...(can('services.view') ? [{ icon: 'card-account-details-outline', label: tr('Packages'), sub: tr('Prepaid packages & memberships'), onPress: () => navigation.navigate('Packages') }] : []),
  ];
  const marketingItems = [
    ...(hasMarketing && can('marketing.view') ? [{ icon: 'image-multiple-outline', label: tr('Marketing & Growth'), sub: tr('Boss AI campaigns, Google reviews, posters, photo & video posts'), onPress: () => navigation.navigate('Grow') }] : []),
    { icon: 'whatsapp', label: tr('WhatsApp Reminders'), sub: reengageEnabled ? tr('Nudge clients after {n} days away', { n: reengageDaysStr || '30' }) : tr('Off — tap to turn on'), onPress: () => setShowReengage(true) },
    ...(hasInsights && can('insights.view') ? [{ icon: 'lightbulb-on-outline', label: tr('Business Insights'), sub: tr('Trends, forecasts & win-back suggestions'), onPress: () => navigation.navigate('Insights') }] : []),
    ...(can('calendar.edit') ? [{ icon: 'web-clock', label: tr('Online Booking'), sub: tr('Customers book 24×7 from WhatsApp, Instagram & Google Maps'), onPress: () => navigation.navigate('OnlineBooking') }] : []),
    ...(can('ai.view') ? [{ icon: 'robot-happy-outline', label: tr('Boss AI'), sub: tr('Ask in Hindi or English · works offline'), onPress: () => navigation.navigate('AIAssistant') }] : []),
  ];
  const peopleItems = [
    ...(hasStaff && can('staff.view') ? [{ icon: 'account-group-outline', label: tr('Staff & Attendance'), sub: tr('Staff, roles, attendance'), onPress: () => navigation.navigate('Staff') }] : []),
    ...(isOwner || can('settings.users') ? [{ icon: 'shield-account-outline', label: tr('Users & Access'), sub: tr('Logins, roles & permissions'), onPress: () => navigation.navigate('Users') }] : []),
    ...(can('settings.attendance_rules') ? [{ icon: 'clock-check-outline', label: tr('Attendance Rules'), sub: tr('Full-day / half-day / absent policy'), onPress: () => navigation.navigate('AttendanceRules') }] : []),
    ...(hasAcademy && can('academy.certificate') ? [{ icon: 'certificate-outline', label: tr('Certificate Design'), sub: tr('Layout, signature & wording'), onPress: () => navigation.navigate('CertificateTemplate') }] : []),
  ];
  const financeItems = [
    ...(can('reports.view') ? [{ icon: 'chart-bar', label: tr('Reports & Analytics'), sub: tr('Revenue, P&L, commissions'), onPress: () => navigation.navigate('Reports') }] : []),
    ...(can('expenses.view') ? [{ icon: 'cash-minus', label: tr('Expenses'), sub: tr('Track costs & spending'), onPress: () => navigation.navigate('Expenses') }] : []),
    ...(can('billing.history') ? [{ icon: 'history', label: tr('Bill History'), sub: tr('All past bills & receipts'), onPress: () => navigation.navigate('BillHistory') }] : []),
    ...(hasGST && can('reports.gst') ? [{ icon: 'file-certificate-outline', label: tr('GST Tax Reports'), sub: tr('GSTR-1, GSTR-3B & yearly summary'), onPress: () => navigation.navigate('TaxReport') }] : []),
    ...(hasAcademy && can('academy.view') ? [{ icon: 'school-outline', label: tr('Academy'), sub: tr('Students, courses & batches'), onPress: () => navigation.navigate('Academy') }] : []),
  ];
  const backupItems = can('settings.backup') || can('branches.manage') ? [
    { icon: 'google-drive', label: tr('Branches & Cloud'), sub: cloudLabel || tr('Cloud backup, online booking & branches'), onPress: () => navigation.navigate('BranchHub') },
  ] : [];
  if (can('settings.backup')) backupItems.push(...[
    { icon: 'cloud-upload-outline',   label: tr('Create Backup'),      sub: tr('Last: {last}  •  {n} saved locally', { last: lastBackup, n: backupCount }), onPress: doBackup },
    { icon: 'share-variant',           label: tr('Send a copy off this phone'), sub: tr('Email, Drive, Files or WhatsApp'), onPress: doShareBackup },
    { icon: 'bell-outline',           label: tr('Auto-Backup Schedule'), sub: autoBackup ? tr('Daily reminder at {hh}:00 ✅', { hh: String(autoHour).padStart(2,'0') }) : tr('Tap to set up daily reminder'), onPress: () => setShowAutoBackup(true) },
    { icon: 'cloud-download-outline', label: tr('Restore Backup'),     sub: tr('From a backup file'),             onPress: doRestore },
  ]);

  const groups = [
    ...(salonItems.length ? [{ title: tr('Salon Management'), items: salonItems }] : []),
    ...(can('clients.view') ? [{ title: tr('Marketing'), items: marketingItems }] : []),
    ...(peopleItems.length ? [{ title: tr('Team & Access'), items: peopleItems }] : []),
    ...(financeItems.length ? [{ title: tr('Reports & Finance'), items: financeItems }] : []),
    ...(backupItems.length ? [{ title: tr('Data & Backup'), items: backupItems }] : []),
    { title: tr('Account & App'), items: [
      { icon: 'account-circle-outline', label: tr('Lock app now'), sub: tr('Signed in as {name}', { name: user?.displayName || '' }), onPress: lock },
      { icon: 'timer-lock-outline',     label: tr('Auto-lock'),    sub: tr('Idle timeout: {label}', { label: autoLockLabel }), onPress: () => setShowAutoLock(true) },
      ...(isOwner ? [{ icon: 'earth', label: tr('Country & currency'), sub: `${region.flag} ${region.name} · ${region.currency} · ${region.tax.name}`, onPress: () => setShowRegion(true) }] : []),
      { icon: 'translate',              label: tr('Language'),     sub: currentLangName, onPress: () => setShowLanguage(true) },
      ...(can('settings.business') ? [{ icon: 'star-circle-outline', label: tr('Google reviews'), sub: tr('Ask every happy customer for 5 stars'), onPress: () => navigation.navigate('BillDesign') }] : []),
      ...(can('settings.business') ? [{ icon: 'printer-pos', label: tr('Bill design & printer'), sub: `${tr('Logo, footer message, bill number')} · ${receiptWidth === 'a4' ? 'A4 / PDF' : `${receiptWidth} mm`}`, onPress: () => navigation.navigate('BillDesign') }] : []),
      ...(isOwner ? [{ icon: 'flask-outline', label: isDemo ? tr('Clear demo data') : tr('Demo salon'), sub: demoBusy || (isDemo ? tr('Remove sample data and start fresh') : tr('Fill the app with sample data to show a client')), onPress: demoMenu }] : []),
      { icon: 'help-circle-outline', label: tr('Help & FAQ'), sub: tr('Answers to common questions'), onPress: () => navigation.navigate('Help') },
      { icon: 'star-circle-outline', label: tr('Why SaloonBossX'), sub: tr('Savings calculator & comparison'), onPress: () => navigation.navigate('WhyUs') },
      { icon: 'logout',                 label: tr('Sign out'),     sub: tr('The next person signs in with their own account'), onPress: () => Alert.alert(tr('Sign out?'), tr('You will need to enter your username and PIN again.'), [{ text: tr('Cancel'), style: 'cancel' }, { text: tr('Sign out'), style: 'destructive', onPress: () => { logout().catch(e => showError(e, 'Could not sign out')); } }]) },
      ...(isOwner ? [{ icon: 'key-outline', label: tr('License & Plan'), sub: licenseInfo?.trial ? tr('Free trial — {expiry}', { expiry: licenseInfo.expiry }) : licenseInfo ? tr('{plan} Plan — Active ✅', { plan: licenseInfo.plan }) : tr('No active license'), onPress: () => setShowLicense(true) }] : []),
      {
        icon: checkingUpdate ? 'loading' : (updateInfo?.available ? 'download-circle' : 'update'),
        label: updateInfo?.available ? tr('Update Available — v{v}', { v: updateInfo.latestVersion }) : tr('Check for Updates'),
        sub: updateInfo?.available
          ? `Tap to download • Released ${UpdateService.formatPublishedDate(updateInfo.publishedAt)}`
          : checkingUpdate ? tr('Checking...') : tr('Current version: v{v}', { v: CURRENT_VERSION }),
        onPress: updateInfo?.available ? openUpdateDownload : checkForUpdates,
        highlight: updateInfo?.available,
      },
      { icon: 'shield-outline',       label: tr('Privacy Policy'),       sub: tr('How we protect your data'),        onPress: () => navigation.navigate('Privacy') },
      { icon: 'file-document-outline', label: tr('Terms of Service'),    sub: tr('Your usage agreement'),            onPress: () => navigation.navigate('Terms') },
      { icon: 'message-text-outline', label: tr('Send Feedback'),        sub: tr('Report bugs, request features'),   onPress: () => navigation.navigate('Feedback') },
      { icon: 'lightbulb-on-outline', label: tr('Tips & Tricks'),        sub: tr('Get the most from SaloonBossX'),   onPress: () => navigation.navigate('Tips') },
    ]},
  ];

  const profileImage = form.profile_image || profile.profile_image;

  return (
    <SafeScreen>
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        <AppBar title={tr("Settings")} />

        {/* ── Update Available Banner ── */}
        {updateInfo?.available && (
          <TouchableOpacity
            onPress={openUpdateDownload} activeOpacity={0.85}
            style={{ marginHorizontal: 16, marginBottom: 16, backgroundColor: c.successLight, borderRadius: 16, padding: 16, borderWidth: 1.5, borderColor: c.success, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <MaterialCommunityIcons name="download-circle" size={32} color={c.success} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.success, fontSize: 15, fontWeight: '800' }}>Update Available — v{updateInfo.latestVersion}</Text>
              <Text style={{ color: c.success, fontSize: 12, marginTop: 2, opacity: 0.85 }}>
                You have v{CURRENT_VERSION}  •  Released {UpdateService.formatPublishedDate(updateInfo.publishedAt)}
              </Text>
            </View>
            <View style={{ backgroundColor: c.success, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 }}>
              <Text style={{ color: c.onPrimary, fontSize: 12, fontWeight: '800' }}>{tr('Download')}</Text>
            </View>
          </TouchableOpacity>
        )}

        {/* Signed-in user card */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 16, backgroundColor: c.card, borderRadius: 18, padding: 16, borderWidth: 0.5, borderColor: c.borderLight, gap: 14 }}>
          <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: c.primaryLight, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: c.primary, fontSize: 18, fontWeight: '900' }}>{(user?.displayName || '?')[0].toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.text, fontSize: 15, fontWeight: '800' }}>{user?.displayName || 'Signed in'}</Text>
            <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 2 }}>
              {user?.isOwner ? tr('Owner · full access') : (ROLE_LABELS[user?.role as RoleId] || user?.role)} · @{user?.username}
            </Text>
          </View>
          <TouchableOpacity onPress={lock} style={{ backgroundColor: c.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 }}>
            <Text style={{ color: c.primary, fontWeight: '800', fontSize: 12 }}>{tr('Lock')}</Text>
          </TouchableOpacity>
        </View>

        {/* Profile card with photo */}
        {can('settings.business') && <TouchableOpacity
          style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 16, backgroundColor: c.card, borderRadius: 18, padding: 16, borderWidth: 0.5, borderColor: c.borderLight, gap: 14 }}
          onPress={() => { setForm({...profile}); setShowProfile(true); }}
          activeOpacity={0.85}>
          <View style={{ position: 'relative' }}>
            {profileImage ? (
              <Image source={{ uri: profileImage }} style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: c.surface }} />
            ) : (
              <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: c.primaryLight, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: c.primary, fontSize: 24, fontWeight: '900' }}>{profile.name?.[0]?.toUpperCase() || '✂'}</Text>
              </View>
            )}
            <View style={{ position: 'absolute', bottom: -2, right: -2, width: 20, height: 20, borderRadius: 10, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }}>
              <MaterialCommunityIcons name="pencil" size={11} color={c.onPrimary} />
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.text, fontSize: 16, fontWeight: '800' }}>{profile.name || tr('Tap to set up salon')}</Text>
            <Text style={{ color: c.textMuted, fontSize: 13, marginTop: 2 }}>
              {[profile.owner_name, profile.city].filter(Boolean).join('  •  ') || tr('Profile incomplete')}
            </Text>
            {profile.gst_number ? <Text style={{ color: c.textMuted, fontSize: 11, marginTop: 2 }}>GSTIN: {profile.gst_number}</Text> : null}
          </View>
          <MaterialCommunityIcons name="pencil-outline" size={20} color={c.primary} />
        </TouchableOpacity>}

        {/* Appearance */}
        <View style={{ marginHorizontal: 16, marginBottom: 16 }}>
          <SectionLabel style={{ marginLeft: 2 }}>{tr('Appearance')}</SectionLabel>
          <SegmentedTabs
            value={mode}
            onChange={(m: string) => setTheme(m as any)}
            tabs={[{ key: 'light', label: tr('Light') }, { key: 'dark', label: tr('Dark') }, { key: 'system', label: tr('System') }]}
          />
        </View>

        {/* GST — manual, opt-in (many salons are not GST registered) */}
        {can('settings.business') && <View style={{ marginHorizontal: 16, marginBottom: 16, backgroundColor: c.card, borderRadius: 16, padding: 16, borderWidth: 0.5, borderColor: c.borderLight }}>
          <Text style={{ color: c.textMuted, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 }}>{tr('GST / TAX SETTINGS')}</Text>
          <GstFields value={gstForm} onChange={v => { setGstForm(v); setGstDirty(true); }} />
          {gstDirty && (
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <View style={{ flex: 1 }}>
                <Button label={tr('Undo')} variant="outline" onPress={() => { setGstForm({ enabled: gstEnabled, gstin: String(profile.gst_number || ''), rate: String(profile.tax_rate ?? 5), inclusive: pricesInclGST }); setGstDirty(false); }} />
              </View>
              <View style={{ flex: 1.4 }}>
                <Button label={gstSaving ? tr('Saving…') : tr('Save GST settings')} onPress={saveGst} loading={gstSaving} disabled={gstSaving} />
              </View>
            </View>
          )}
        </View>}

        {/* Menu groups */}
        {groups.map((grp, gi) => (
          <View key={gi} style={{ marginBottom: 10, paddingHorizontal: 16 }}>
            <SectionLabel style={{ marginLeft: 2 }}>{grp.title}</SectionLabel>
            <Card padded={false}>
              {grp.items.map((item, ii) => {
                const highlighted = (item as any).highlight;
                return (
                  <ListRow
                    key={ii}
                    icon={item.icon === 'loading' ? 'timer-sand' : item.icon}
                    iconTone={highlighted ? 'success' : 'primary'}
                    title={item.label}
                    subtitle={(item as any).sub}
                    onPress={item.onPress}
                    last={ii === grp.items.length - 1}
                  />
                );
              })}
            </Card>
          </View>
        ))}

        <Text style={{ color: c.textLight, fontSize: 11, textAlign: 'center', marginTop: 20, marginBottom: 8, fontWeight: '600' }}>SaloonBossX v{CURRENT_VERSION}  ·  {tr('Built for salons worldwide')}</Text>
      </ScrollView>

      {/* === COUNTRY & CURRENCY === */}
      <RegionPickerSheet visible={showRegion} current={region.code} onClose={() => setShowRegion(false)}
        onPick={async (code) => {
          try { await changeRegion(code); await refresh(); await load(); }
          catch (e) { showError(e, 'Country not changed'); }
        }} />

      {/* === LANGUAGE MODAL === */}
      <BottomModal visible={showLanguage} onClose={() => setShowLanguage(false)}>
        <View style={{ padding: 24 }}>
          <Text style={{ color: c.text, fontSize: 18, fontWeight: '800', marginBottom: 4 }}>{tr('Language')}</Text>
          <Text style={{ color: c.textMuted, fontSize: 13, marginBottom: 16 }}>
            {tr("Choose the app's display language.")}
          </Text>
          {LANGUAGES.map(l => (
            <TouchableOpacity key={l.code} onPress={async () => {
              try {
                await changeLanguage(l.code);
                await DatabaseService.setSetting('language', l.code);
                setCurrentLang(l.code);
                setShowLanguage(false);
              } catch (e) { showError(e, 'Language not changed'); }
            }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 13, borderBottomWidth: 0.5, borderBottomColor: c.divider }}>
              <MaterialCommunityIcons name={currentLang === l.code ? 'radiobox-marked' : 'radiobox-blank'} size={20} color={currentLang === l.code ? c.primary : c.textMuted} />
              <Text style={{ color: c.text, fontSize: 14.5, fontWeight: '600' }}>{l.nativeName}</Text>
              {l.nativeName !== l.name && <Text style={{ color: c.textMuted, fontSize: 12.5 }}>({l.name})</Text>}
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={{ marginTop: 16, backgroundColor: c.surface, borderRadius: 12, padding: 14, alignItems: 'center' }} onPress={() => setShowLanguage(false)}>
            <Text style={{ color: c.textSecondary, fontWeight: '700' }}>{tr('Done')}</Text>
          </TouchableOpacity>
        </View>
      </BottomModal>

      {/* === AUTO-LOCK MODAL === */}
      <BottomModal visible={showAutoLock} onClose={() => setShowAutoLock(false)}>
        <View style={{ padding: 24 }}>
          <Text style={{ color: c.text, fontSize: 18, fontWeight: '800', marginBottom: 4 }}>Auto-lock</Text>
          <Text style={{ color: c.textMuted, fontSize: 13, marginBottom: 16 }}>
            The app always asks for a username and PIN after it’s closed or sent to the background for more than a few seconds. This also locks it while it’s open and left idle.
          </Text>
          {AUTO_LOCK_OPTIONS.map(o => (
            <TouchableOpacity key={o.m} onPress={async () => { try { await setAutoLockMinutes(o.m); setShowAutoLock(false); } catch (e) { showError(e, 'Not saved'); } }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 13, borderBottomWidth: 0.5, borderBottomColor: c.divider }}>
              <MaterialCommunityIcons name={autoLockMinutes === o.m ? 'radiobox-marked' : 'radiobox-blank'} size={20} color={autoLockMinutes === o.m ? c.primary : c.textMuted} />
              <Text style={{ color: c.text, fontSize: 14.5, fontWeight: '600' }}>{o.label}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={{ marginTop: 16, backgroundColor: c.surface, borderRadius: 12, padding: 14, alignItems: 'center' }} onPress={() => setShowAutoLock(false)}>
            <Text style={{ color: c.textSecondary, fontWeight: '700' }}>Done</Text>
          </TouchableOpacity>
        </View>
      </BottomModal>

      {/* === AUTO-BACKUP MODAL === */}
      <BottomModal visible={showAutoBackup} onClose={() => setShowAutoBackup(false)}>
          <View style={{ padding: 24 }}>
            <Text style={{ color: c.text, fontSize: 18, fontWeight: '800', marginBottom: 4 }}>Automatic backup</Text>
            <Text style={{ color: c.textMuted, fontSize: 13, marginBottom: 18, lineHeight: 19 }}>
              A copy of your data is saved on this phone every day. Pick a folder as well and it goes there too, with nothing to tap.
            </Text>

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <Text style={{ color: c.text, fontSize: 15, fontWeight: '600' }}>Back up every day</Text>
              <Switch value={autoBackup} onValueChange={toggleAutoBackup}
                trackColor={{ true: c.primary + '60', false: c.border }} thumbColor={autoBackup ? c.primary : '#f4f3f4'} />
            </View>

            {Platform.OS === 'android' ? (
              <TouchableOpacity
                onPress={chooseBackupFolder}
                style={{ backgroundColor: c.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: c.border, marginBottom: 12 }}>
                <Text style={{ color: c.text, fontSize: 14, fontWeight: '600' }}>
                  {backupFolder ? 'Change backup folder' : 'Choose a backup folder'}
                </Text>
                <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 3 }}>
                  {backupFolder
                    ? 'Backups are being written here every day.'
                    : 'Pick once. After that it saves there on its own.'}
                </Text>
              </TouchableOpacity>
            ) : null}

            <View style={{ marginBottom: 16 }}>
              <Text style={{ color: c.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 8 }}>Email a copy to</Text>
              <TextInput
                value={backupEmail}
                onChangeText={saveBackupEmail}
                placeholder="you@example.com"
                placeholderTextColor={c.textMuted}
                autoCapitalize="none"
                keyboardType="email-address"
                style={{ backgroundColor: c.surface, borderRadius: 12, padding: 13, color: c.text, borderWidth: 1, borderColor: c.border, fontSize: 15 }}
              />
              <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 6, lineHeight: 17 }}>
                Opens your mail app with the backup attached. One tap to send — no app can post mail on its own without a paid mail server behind it.
              </Text>
            </View>

            <Text style={{ color: c.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 10 }}>Remind me at</Text>
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
              {[1, 2, 21, 22].map(h => (
                <TouchableOpacity key={h}
                  style={{ flex: 1, padding: 12, borderRadius: 12, alignItems: 'center', backgroundColor: autoHour === h ? c.primary : c.surface, borderWidth: 1, borderColor: autoHour === h ? c.primary : c.border }}
                  onPress={() => { setAutoHour(h); if (autoBackup) BackupService.scheduleReminder(h); }}>
                  <Text style={{ color: autoHour === h ? c.onPrimary : c.text, fontWeight: '700', fontSize: 14 }}>{String(h).padStart(2,'0')}:00</Text>
                  <Text style={{ color: autoHour === h ? '#ffffff88' : c.textMuted, fontSize: 10, marginTop: 2 }}>{h < 6 ? 'Night' : h < 12 ? 'Morning' : 'Evening'}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={{ backgroundColor: c.primaryLight, borderRadius: 12, padding: 14, marginBottom: 16 }}>
              <Text style={{ color: c.primary, fontSize: 12, fontWeight: '600', lineHeight: 18 }}>
                You are only reminded when the off-phone copy is actually out of date. A notification that fires every night gets ignored on the night it matters.
              </Text>
            </View>

            <TouchableOpacity style={{ backgroundColor: c.surface, borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: c.border }} onPress={() => setShowAutoBackup(false)}>
              <Text style={{ color: c.textSecondary, fontWeight: '700' }}>Done</Text>
            </TouchableOpacity>
          </View>
      </BottomModal>

      {/* === WHATSAPP RE-ENGAGE REMINDER MODAL === */}
      <BottomModal visible={showReengage} onClose={() => setShowReengage(false)} height="90%">
        <ScrollView contentContainerStyle={{ padding: 24 }} keyboardShouldPersistTaps="handled">
          <Text style={{ color: c.text, fontSize: 18, fontWeight: '800', marginBottom: 4 }}>WhatsApp Reminders</Text>
          <Text style={{ color: c.textMuted, fontSize: 13, marginBottom: 18, lineHeight: 19 }}>
            Clients who haven't visited in a while show up on the dashboard under "Re-engage clients", with a ready-to-send WhatsApp message. Set how long to wait and write your own message.
          </Text>

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={{ color: c.text, fontSize: 15, fontWeight: '600' }}>Show re-engage reminders</Text>
              <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 2 }}>Turn off to hide this from the dashboard</Text>
            </View>
            <Switch value={reengageEnabled} onValueChange={setReengageEnabled}
              trackColor={{ true: c.primary + '60', false: c.border }} thumbColor={reengageEnabled ? c.primary : '#f4f3f4'} />
          </View>

          <Text style={{ color: c.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 8 }}>Remind after this many days away</Text>
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
            {['15', '30', '45', '60'].map(d => (
              <TouchableOpacity key={d}
                style={{ flex: 1, padding: 12, borderRadius: 12, alignItems: 'center', backgroundColor: reengageDaysStr === d ? c.primary : c.surface, borderWidth: 1, borderColor: reengageDaysStr === d ? c.primary : c.border }}
                onPress={() => setReengageDaysStr(d)}>
                <Text style={{ color: reengageDaysStr === d ? c.onPrimary : c.text, fontWeight: '700', fontSize: 14 }}>{d}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            value={reengageDaysStr}
            onChangeText={v => setReengageDaysStr(v.replace(/[^0-9]/g, ''))}
            placeholder="30"
            placeholderTextColor={c.textMuted}
            keyboardType="number-pad"
            style={{ backgroundColor: c.surface, borderRadius: 12, padding: 13, color: c.text, borderWidth: 1, borderColor: c.border, fontSize: 15, marginBottom: 20, width: 100 }}
          />

          <Text style={{ color: c.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 8 }}>Message</Text>
          <TextInput
            value={reengageMessage}
            onChangeText={setReengageMessage}
            multiline
            numberOfLines={6}
            textAlignVertical="top"
            placeholder={WhatsAppService.DEFAULT_REENGAGE_MESSAGE}
            placeholderTextColor={c.textMuted}
            style={{ backgroundColor: c.surface, borderRadius: 12, padding: 13, color: c.text, borderWidth: 1, borderColor: c.border, fontSize: 14, minHeight: 130, marginBottom: 10 }}
          />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
            {['{name}', '{salon}', '{phone}', '{days}', '{last_visit}'].map(tag => (
              <TouchableOpacity key={tag}
                onPress={() => setReengageMessage(m => m + (m && !m.endsWith(' ') && !m.endsWith('\n') ? ' ' : '') + tag)}
                style={{ backgroundColor: c.primaryLight, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}>
                <Text style={{ color: c.primary, fontSize: 11, fontWeight: '700' }}>{tag}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={{ color: c.textMuted, fontSize: 11, marginBottom: 18, lineHeight: 16 }}>
            Tap a tag to insert it. Filled in with the client's name, your salon name & phone, the days threshold, and their last visit date.
          </Text>

          <View style={{ backgroundColor: c.primaryLight, borderRadius: 12, padding: 14, marginBottom: 20 }}>
            <Text style={{ color: c.primary, fontSize: 11, fontWeight: '700', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Preview</Text>
            <Text style={{ color: c.text, fontSize: 13, lineHeight: 19 }}>
              {WhatsAppService.fillTemplate(reengageMessage || WhatsAppService.DEFAULT_REENGAGE_MESSAGE, {
                name: 'Priya', salon: profile.name || 'Your Salon', phone: profile.phone || '98765 43210',
                days: reengageDaysStr || '30', last_visit: '12 Jul 2026',
              })}
            </Text>
          </View>

          <TouchableOpacity onPress={() => setReengageMessage(WhatsAppService.DEFAULT_REENGAGE_MESSAGE)} style={{ marginBottom: 20, alignSelf: 'flex-start' }}>
            <Text style={{ color: c.primary, fontSize: 12.5, fontWeight: '700' }}>Reset to default message</Text>
          </TouchableOpacity>

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity style={{ flex: 1, backgroundColor: c.surface, borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: c.border }} onPress={() => setShowReengage(false)}>
              <Text style={{ color: c.textSecondary, fontWeight: '700' }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ flex: 1, backgroundColor: savingReengage ? c.textMuted : c.primary, borderRadius: 12, padding: 14, alignItems: 'center' }} onPress={saveReengageSettings} disabled={savingReengage}>
              <Text style={{ color: c.onPrimary, fontWeight: '800' }}>{savingReengage ? 'Saving…' : 'Save'}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </BottomModal>

      {/* === PROFILE EDIT MODAL === */}
      <BottomModal visible={showProfile} onClose={() => setShowProfile(false)} height="94%">
        <View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingBottom: 16 }}>
            <Text style={{ color: c.text, fontSize: 20, fontWeight: '800' }}>Edit Salon Profile</Text>
            <TouchableOpacity onPress={() => setShowProfile(false)}>
              <MaterialCommunityIcons name="close" size={24} color={c.textMuted} />
            </TouchableOpacity>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}>

            {/* Profile Picture */}
            <View style={{ alignItems: 'center', marginBottom: 20 }}>
              <TouchableOpacity onPress={showImageOptions} disabled={uploadingImg}>
                {uploadingImg
                  ? <View style={{ width: 90, height: 90, borderRadius: 45, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }}>
                      <ActivityIndicator color={c.primary} />
                    </View>
                  : form.profile_image
                    ? <Image source={{ uri: form.profile_image }} style={{ width: 90, height: 90, borderRadius: 45 }} />
                    : <View style={{ width: 90, height: 90, borderRadius: 45, backgroundColor: c.primaryLight, alignItems: 'center', justifyContent: 'center' }}>
                        <MaterialCommunityIcons name="camera-plus" size={32} color={c.primary} />
                      </View>
                }
              </TouchableOpacity>
              <TouchableOpacity onPress={showImageOptions} style={{ marginTop: 8 }}>
                <Text style={{ color: c.primary, fontWeight: '600', fontSize: 13 }}>
                  {form.profile_image ? 'Change Photo' : '+ Add Salon Photo'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Profile fields */}
            {[
              { key: 'name',            label: 'Salon Name *',          placeholder: 'e.g. Royal Cuts & Spa' },
              { key: 'owner_name',      label: 'Owner Name',            placeholder: 'Full name' },
              { key: 'phone',           label: 'Phone',                 placeholder: 'Mobile number', kb: 'phone-pad' },
              { key: 'email',           label: 'Email',                 placeholder: 'email@example.com', kb: 'email-address' },
              { key: 'address',         label: 'Address',               placeholder: 'Street address' },
              { key: 'city',            label: 'City',                  placeholder: 'City name' },
              { key: 'state',           label: 'State',                 placeholder: 'State / Province' },
              { key: 'upi_id',          label: getRegion().pay.fieldLabel, placeholder: getRegion().pay.placeholder },
              { key: 'currency_symbol', label: 'Currency Symbol',       placeholder: getRegion().symbol.trim() },
              { key: 'bill_prefix',     label: 'Bill Number Prefix',    placeholder: 'SOS' },
            ].map(({ key, label, placeholder, kb }) => (
              <View key={key} style={{ marginBottom: 14 }}>
                <Text style={{ color: c.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>{label}</Text>
                <TextInput
                  style={{ backgroundColor: c.surface, color: c.text, borderRadius: 10, padding: 12, fontSize: 14, borderWidth: 1, borderColor: c.border }}
                  value={form[key] || ''}
                  onChangeText={v => setForm((f: any) => ({ ...f, [key]: v }))}
                  placeholder={placeholder}
                  placeholderTextColor={c.textMuted}
                  keyboardType={(kb as any) || 'default'}
                  autoCapitalize={key === 'bill_prefix' ? 'characters' : 'words'}
                />
              </View>
            ))}

            <Text style={{ color: c.textMuted, fontSize: 12, marginBottom: 16 }}>
              {tr('GSTIN and GST rate are set in the GST section of Settings.')}
            </Text>

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity style={{ flex: 1, backgroundColor: c.surface, borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: c.border }}
                onPress={() => setShowProfile(false)}>
                <Text style={{ color: c.textSecondary, fontWeight: '700' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 1, backgroundColor: saving ? c.textMuted : c.primary, borderRadius: 12, padding: 14, alignItems: 'center' }}
                onPress={saveProfile} disabled={saving}>
                <Text style={{ color: c.onPrimary, fontWeight: '800' }}>{saving ? 'Saving…' : 'Save Profile'}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </BottomModal>

      {/* === LICENSE INFO MODAL === */}
      <BottomModal visible={showLicense} onClose={() => setShowLicense(false)}>
          <View style={{ padding: 24 }}>
            <Text style={{ color: c.text, fontSize: 20, fontWeight: '800', marginBottom: 16 }}>License & Plan</Text>
            {licenseInfo?.trial ? (<>
              <View style={{ backgroundColor: c.warning + '18', borderRadius: 12, padding: 16, marginBottom: 16 }}>
                <Text style={{ color: c.text, fontSize: 16, fontWeight: '900' }}>⏳ Free Trial — {licenseInfo.expiry}</Text>
                <Text style={{ color: c.textSecondary, fontSize: 12, marginTop: 4, lineHeight: 18 }}>Buy a licence any time. Your data stays exactly as it is.</Text>
              </View>
              <TouchableOpacity
                style={{ backgroundColor: c.primary, borderRadius: 12, padding: 14, alignItems: 'center' }}
                onPress={() => { setShowLicense(false); resetToActivation(); }}>
                <Text style={{ color: c.onPrimary, fontWeight: '800' }}>Buy or enter licence key</Text>
              </TouchableOpacity>
            </>) : licenseInfo ? (<>
              <View style={{ backgroundColor: c.successLight, borderRadius: 12, padding: 16, marginBottom: 16 }}>
                <Text style={{ color: c.success, fontSize: 16, fontWeight: '900' }}>✅ {licenseInfo.plan} · {licenseInfo.billing === 'monthly' ? 'Monthly' : licenseInfo.billing === 'yearly' ? 'Yearly' : 'One-time'}</Text>
                <Text style={{ color: licenseInfo.grace ? c.danger : c.success, fontSize: 12.5, marginTop: 4, fontWeight: '700' }}>
                  {licenseInfo.expiry === 'Lifetime' ? 'Lifetime licence — no renewals' : licenseInfo.grace ? `Plan ended ${licenseInfo.expiry} — renew now (grace period)` : `Valid until ${licenseInfo.expiry} · ${licenseInfo.daysLeft} days left`}
                </Text>
              </View>
              <TouchableOpacity style={{ backgroundColor: c.primary, borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 10 }}
                onPress={() => { setShowLicense(false); resetToActivation(); }}>
                <Text style={{ color: c.onPrimary, fontWeight: '800' }}>{licenseInfo.expiry === 'Lifetime' ? 'Upgrade plan' : 'Renew / extend · Upgrade'}</Text>
              </TouchableOpacity>
              {licenseInfo.billing === 'monthly' && (
                <Text style={{ color: c.textMuted, fontSize: 12, marginBottom: 10 }}>💡 One-time costs less than a year of monthly payments — and then it is free forever.</Text>
              )}
              <Text style={{ color: c.textMuted, fontSize: 12 }}>License Key: {licenseInfo.key?.slice(0, 12)}…</Text>

              <TouchableOpacity
                style={{ marginTop: 20, backgroundColor: c.dangerLight, borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: c.danger + '55' }}
                onPress={confirmRemoveLicense}
                disabled={removingLicense}>
                <Text style={{ color: c.danger, fontWeight: '800' }}>
                  {removingLicense ? 'Removing…' : '🔓 Remove License from this Device'}
                </Text>
              </TouchableOpacity>
              <Text style={{ color: c.textMuted, fontSize: 11, marginTop: 8, lineHeight: 16 }}>
                Use this before switching phones so you can re-activate the same key elsewhere. Your salon data is not deleted.
              </Text>
            </>) : (
              <Text style={{ color: c.danger, fontSize: 14 }}>No active license. Please activate the app.</Text>
            )}
            <TouchableOpacity style={{ marginTop: 20, backgroundColor: c.surface, borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: c.border }}
              onPress={() => setShowLicense(false)}>
              <Text style={{ color: c.textSecondary, fontWeight: '700' }}>Close</Text>
            </TouchableOpacity>
          </View>
      </BottomModal>
      {/* Owner PIN check (restore with the backup's logins) */}
      <BottomSheet visible={!!pinGate} onClose={cancelGate} title={tr('Confirm with owner PIN')}
        footer={<Button label={tr('Confirm')} icon="lock-check-outline" onPress={submitGatePin} loading={gateBusy} disabled={gateBusy} />}>
        <Text style={{ color: c.textMuted, fontSize: 13, marginBottom: 12, lineHeight: 19 }}>
          {tr('Restoring the backup’s logins replaces every username and PIN on this phone. Enter your owner PIN to continue.')}
        </Text>
        <TextInput value={gatePin} onChangeText={v => setGatePin(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" secureTextEntry autoFocus
          placeholder="••••" placeholderTextColor={c.textMuted} onSubmitEditing={submitGatePin}
          style={{ backgroundColor: c.surface, color: c.text, borderRadius: 12, padding: 14, fontSize: 20, letterSpacing: 6, textAlign: 'center', borderWidth: 1.5, borderColor: c.border }} />
      </BottomSheet>
      {choice.element}
    </SafeScreen>
  );
}
