import React, { useState, useEffect, useCallback, useContext } from 'react';
import { View, ScrollView, TouchableOpacity, Modal, Alert, FlatList, ActivityIndicator, Platform, Switch, Dimensions, Linking } from 'react-native';
import { Text, TextInput } from '../theme/Text';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { TabScreen as SafeScreen } from '../components/SafeScreen';
import { BottomModal } from '../components/BottomModal';
import { useTheme } from '../context/ThemeContext';
import { AppContext } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { DatabaseService } from '../database/Database';
import { toLocalDateStr } from '../utils/helpers';
import { AppointmentReminderService, minutesUntil } from '../services/AppointmentReminderService';
import { tr, useTr, activeLocale } from '../i18n/tr';
import { isValidDateStr, isPast, timeToMin, minToTime, localTimeStr, showError, confirmAsync, prettyDate, parseOptionalAmount, cleanAmountInput, round2 } from '../components/formUtils';
import { DatePickerSheet } from '../components/DateTimePicker';
import { useUndoSnackbar } from '../components/UndoSnackbar';
import { appEvents } from '../components/appEvents';
import { ClientAlertBadge, NoShowBadge } from '../components/ClientAlertBadge';
import { PayMethodPicker, PayMethodKey, money } from '../components/WalletShared';

/** Open an address in Google Maps (app if installed, else browser). */
function openInMaps(address: string) {
  const url = `https://maps.google.com/?q=${encodeURIComponent(String(address || '').trim())}`;
  Linking.openURL(url).catch(e => showError(e, 'Maps did not open', 'Could not open Maps on this phone.'));
}

const { height: SCREEN_H } = Dimensions.get('window');

const TIME_SLOTS = Array.from({ length: 27 }, (_, i) => {
  const h = Math.floor(i / 2) + 8;
  const m = (i % 2) * 30;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
});

/** Status → theme colour + label (theme tokens, so dark mode stays readable). */
function statusMeta(c: any): Record<string, { color: string; label: string }> {
  return {
    confirmed: { color: c.primary, label: '● Confirmed' },
    completed: { color: c.success, label: '✓ Completed' },
    cancelled: { color: c.danger,  label: '✕ Cancelled' },
    no_show:   { color: c.warning, label: '! No-show' },
  };
}
// Bookings must finish by this time; later ends ask for confirmation.
const CLOSING_MIN = 22 * 60;

type BookView = 'form' | 'client' | 'service' | 'time';
const todayStr = () => toLocalDateStr();

// MODAL_H: fixed height so modal never collapses or grows unexpectedly
const MODAL_H = Math.round(SCREEN_H * 0.88);

export default function CalendarScreen({ route }: any) {
  const { colors: c } = useTheme();
  useTr();
  const navigation = useNavigation<any>();
  const { currencySymbol } = useContext(AppContext);
  const { user, can } = useAuth();
  // Staff who can't see everyone's calendar only see their own bookings.
  const ownStaffId = (!can('calendar.all_staff') && user?.staffId) ? user.staffId : undefined;
  const canBook = can('calendar.edit');
  const canBill = can('billing.create');
  const STATUS_META = statusMeta(c);
  const undo = useUndoSnackbar();
  const [statusBusy, setStatusBusy] = useState<number | null>(null);
  const [reschBusy, setReschBusy] = useState(false);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [reschDateOpen, setReschDateOpen] = useState(false);

  const [date, setDate]       = useState(todayStr());
  const [apts, setApts]       = useState<any[]>([]);
  const [staff, setStaff]     = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const [modalOpen, setModalOpen]   = useState(false);
  const [bookView, setBookView]     = useState<BookView>('form');

  // Reschedule state
  const [rescheduleApt, setRescheduleApt] = useState<any>(null);
  const [reschDate, setReschDate]   = useState(todayStr());
  const [reschStart, setReschStart] = useState('10:00');
  const [showResch, setShowResch]   = useState(false);

  // Booking form
  const [bClient, setBClient]       = useState<any>(null);
  const [bStaff, setBStaff]         = useState<any>(null);
  const [bServices, setBServices]   = useState<any[]>([]);
  const [bStart, setBStart]         = useState('10:00');
  const [bWalkin, setBWalkin]       = useState(false);
  const [bNotes, setBNotes]         = useState('');
  const [booking, setBooking]       = useState(false);
  // Advance / token (bridal, makeup) and home service
  const [bAdvance, setBAdvance]     = useState('');
  const [bAdvMethod, setBAdvMethod] = useState<PayMethodKey>('cash');
  const [bHome, setBHome]           = useState(false);
  const [bAddress, setBAddress]     = useState('');
  const [bTravel, setBTravel]       = useState('');
  const [clientSearch, setClientSearch]   = useState('');
  const [serviceSearch, setServiceSearch] = useState('');

  useFocusEffect(useCallback(() => { load(); }, [date]));
  useFocusEffect(useCallback(() => { loadMaster(); }, []));

  useEffect(() => {
    const quickRebook = route?.params?.quickRebook;
    if (!quickRebook) return;
    if (!canBook) { navigation.setParams({ quickRebook: undefined }); return; }
    if (date < todayStr()) setDate(todayStr());
    setBClient(quickRebook.client || null);
    setBServices(quickRebook.items || []);
    setBWalkin(false);
    setBookView('form');
    setModalOpen(true);
    navigation.setParams({ quickRebook: undefined });
  }, [route?.params?.quickRebook, navigation]);

  async function load() {
    setLoading(true);
    try { setApts(await DatabaseService.getAppointments(date, ownStaffId) as any[]); }
    catch (e) { showError(e, 'Could not load appointments'); }
    finally { setLoading(false); }
  }

  async function loadMaster() {
    try {
      const [st, cl, sv] = await Promise.all([DatabaseService.getStaff(), DatabaseService.getClients(), DatabaseService.getServices()]);
      setStaff(st as any[]);
      setClients(cl as any[]);
      setServices(sv as any[]);
      if ((st as any[]).length > 0) setBStaff((prev: any) => prev || (st as any[])[0]);
    } catch (e) { console.warn('Calendar loadMaster:', e); }
  }

  function changeDate(delta: number) {
    const d = new Date(date + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    setDate(toLocalDateStr(d));
  }

  function openBooking() {
    if (date < todayStr()) { Alert.alert(tr('Past date'), tr('You cannot book on a past date. Go back to today first.')); return; }
    loadMaster();
    // Today: start at the next free half-hour instead of a time that has already gone.
    if (date === todayStr()) {
      const next = TIME_SLOTS.find(t => !isPast(date, t));
      if (next && isPast(date, bStart)) setBStart(next);
    }
    setBookView('form'); setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setTimeout(() => {
      setBClient(null); setBServices([]); setBWalkin(false);
      setBNotes(''); setBStart('10:00'); setClientSearch(''); setServiceSearch('');
      setBAdvance(''); setBAdvMethod('cash'); setBHome(false); setBAddress(''); setBTravel('');
      if (staff.length) setBStaff(staff[0]);
      setBookView('form');
    }, 350);
  }

  const totalDur = bServices.reduce((s, sv) => s + (sv.duration || 30), 0);

  // Real end time (was clamped to hour 22 while keeping the minutes, so a
  // 21:30 + 90 min booking "ended" at 22:00 and could overlap the next one).
  const bEndMin = timeToMin(bStart) + Math.max(totalDur, 30);
  const bEnd = minToTime(bEndMin);
  const endsAfterMidnight = bEndMin > 24 * 60 - 1;

  const svcTotal = round2(bServices.reduce((s, sv) => s + (Number(sv.price) || 0), 0));
  const travelNum = bHome ? parseOptionalAmount(bTravel) : 0;
  const advanceNum = parseOptionalAmount(bAdvance);
  const expectedTotal = round2(svcTotal + (isNaN(travelNum) ? 0 : travelNum));
  const advanceBad = isNaN(advanceNum) || (advanceNum > 0 && expectedTotal > 0 && advanceNum - expectedTotal > 0.009);

  async function bookAppointment() {
    if (booking) return;
    if (!bStaff) { Alert.alert(tr('Required'), tr('Please select a stylist.')); return; }
    if (!bWalkin && !bClient) { Alert.alert(tr('Required'), tr('Please select a client or enable Walk-in.')); return; }
    if (bServices.length === 0) { Alert.alert(tr('Required'), tr('Please add at least one service.')); return; }
    if (isPast(date, bStart)) { Alert.alert(tr('Time has passed'), tr('Pick a start time later than now.')); return; }
    if (endsAfterMidnight) { Alert.alert(tr('Too late in the day'), tr('These services take {d} min and would end after midnight. Pick an earlier time.', { d: totalDur })); return; }
    if (isNaN(advanceNum)) { Alert.alert(tr('Check advance'), tr('Advance must be a number that is 0 or more.')); return; }
    if (advanceBad) { Alert.alert(tr('Check advance'), tr('The advance ({a}) is more than the expected amount ({b}).', { a: money(currencySymbol, advanceNum), b: money(currencySymbol, expectedTotal) })); return; }
    if (bHome && !bAddress.trim()) { Alert.alert(tr('Address needed'), tr('Enter the address for the home service.')); return; }
    if (bHome && isNaN(travelNum)) { Alert.alert(tr('Check travel charge'), tr('Travel charge must be a number that is 0 or more.')); return; }
    setBooking(true);
    try {
      if (bEndMin > CLOSING_MIN) {
        const ok = await confirmAsync('Ends after closing', tr('This booking ends at {t}. Book it anyway?', { t: bEnd }), 'Book anyway');
        if (!ok) return;
      }
      const aptId = await DatabaseService.addAppointment({
        client_id: bWalkin ? 0 : (bClient?.id || 0),
        staff_id: bStaff.id,
        service_ids: bServices.map(s => s.id),
        service_names: bServices.map(s => s.name).join(', '),
        date, start_time: bStart, end_time: bEnd,
        status: 'confirmed', notes: bNotes,
        total_amount: expectedTotal,
        is_walkin: bWalkin,
        advance_amount: advanceNum > 0 ? advanceNum : 0,
        advance_method: advanceNum > 0 ? bAdvMethod : '',
        address: bHome ? bAddress.trim() : '',
        travel_charge: bHome && travelNum > 0 ? travelNum : 0,
      });
      const booked = {
        id: Number(aptId), date, start_time: bStart, end_time: bEnd, status: 'confirmed',
        client_name: bWalkin ? '' : bClient?.name, client_phone: bWalkin ? '' : (bClient?.phone || ''),
        staff_name: bStaff.name, service_names: bServices.map(s => s.name).join(', '), is_walkin: bWalkin,
      };
      // Owner gets a notification 1 hour and 30 minutes before the appointment.
      AppointmentReminderService.scheduleForAppointment(booked).catch(() => {});
      closeModal();
      load();
      appEvents.emit('appointment:changed');
      const extra = [
        advanceNum > 0 ? `💰 ${tr('Advance {amt} received ({m})', { amt: money(currencySymbol, advanceNum), m: bAdvMethod.toUpperCase() })}` : '',
        bHome ? `🏠 ${bAddress.trim()}` : '',
      ].filter(Boolean).join('\n');
      const summary = `${bWalkin ? tr('Walk-in') : bClient?.name}\n${tr('Stylist: {name}', { name: bStaff.name })}\n⏰ ${bStart} – ${bEnd}\n✂️ ${booked.service_names}${extra ? `\n${extra}` : ''}\n\n${tr("You'll be reminded 1 hour and 30 minutes before.")}`;
      if (booked.client_phone) {
        Alert.alert(tr('✅ Booked!'), summary, [
          { text: tr('Done'), style: 'cancel' },
          { text: tr('Share on WhatsApp'), onPress: () => { Promise.resolve(AppointmentReminderService.sendConfirmation(booked)).catch(e => showError(e, 'WhatsApp did not open')); } },
        ]);
      } else {
        Alert.alert(tr('✅ Booked!'), summary);
      }
    } catch (e: any) {
      if (e?.message?.includes('CONFLICT')) {
        Alert.alert(tr('⚠️ Time conflict'), tr('{name} is already booked at {a}–{b}.\n\nChoose a different time or stylist.', { name: bStaff.name, a: bStart, b: bEnd }));
      } else {
        showError(e, 'Booking failed');
      }
    } finally { setBooking(false); }
  }

  const STATUS_DONE_MSG: Record<string, string> = {
    completed: 'Marked as done', no_show: 'Marked as no-show', cancelled: 'Appointment cancelled',
  };

  async function updateStatus(apt: any, status: string) {
    if (statusBusy) return;
    const prev = apt.status || 'confirmed';
    setStatusBusy(apt.id);
    try {
      await DatabaseService.updateAppointmentStatus(apt.id, status);
      if (status !== 'confirmed') AppointmentReminderService.cancelForAppointment(apt.id).catch(() => {});
      appEvents.emit('appointment:changed');
      load();
      // One tap is easy to get wrong on a busy counter — offer an Undo.
      undo.show(tr(STATUS_DONE_MSG[status] || 'Updated'), async () => {
        await DatabaseService.updateAppointmentStatus(apt.id, prev);
        if (prev === 'confirmed') AppointmentReminderService.scheduleForAppointment({ ...apt, status: 'confirmed' }).catch(() => {});
        appEvents.emit('appointment:changed');
        load();
      });
    }
    catch (e) { showError(e, 'Status not changed'); }
    finally { setStatusBusy(null); }
  }

  async function doReschedule() {
    if (!rescheduleApt || reschBusy) return;
    if (!isValidDateStr(reschDate)) { Alert.alert(tr('Check the date'), tr('Pick a real date from the calendar.')); return; }
    if (isPast(reschDate, reschStart)) { Alert.alert(tr('Time has passed'), tr('Pick a date and time later than now.')); return; }
    setReschBusy(true);
    try {
      // '' → the data layer keeps the booking's own duration and checks for overlaps.
      await (DatabaseService as any).rescheduleAppointment(rescheduleApt.id, reschDate, reschStart, '');
      setShowResch(false);
      AppointmentReminderService.scheduleForAppointment({ ...rescheduleApt, date: reschDate, start_time: reschStart, status: 'confirmed' }).catch(() => {});
      appEvents.emit('appointment:changed');
      load();
      Alert.alert(tr('✅ Rescheduled'), tr('Moved to {d} at {t}', { d: prettyDate(reschDate), t: reschStart }));
    } catch (e) { showError(e, 'Could not reschedule'); }
    finally { setReschBusy(false); }
  }

  function convertToBill(apt: any) {
    if (!canBill) return;
    const items: any[] = apt.service_names
      ? apt.service_names.split(', ').map((name: string) => {
          const svc = services.find(s => s.name === name);
          return { type: 'service', id: svc?.id || 0, name, price: svc?.price || 0, qty: 1 };
        })
      : [];
    if (Number(apt.travel_charge) > 0) items.push({ type: 'service', id: 0, name: tr('Home service travel'), price: Number(apt.travel_charge), qty: 1 });
    const advanceLeft = round2(Math.max(0, (Number(apt.advance_amount) || 0) - (Number(apt.advance_used) || 0) - (Number(apt.advance_refunded) || 0)));
    navigation.navigate('Billing', {
      client_id: apt.client_id || 0,
      client: apt.client_id ? { id: apt.client_id, name: apt.client_name, phone: apt.client_phone, allergies: apt.client_allergies, no_show_count: apt.client_no_shows } : null,
      staff_id: apt.staff_id, appointment_id: apt.id, items, advance_left: advanceLeft,
    });
  }

  const displayDate = new Date(date + 'T00:00:00').toLocaleDateString(activeLocale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const filteredClients  = clients.filter(cl => String(cl.name || '').toLowerCase().includes(clientSearch.toLowerCase()) || String(cl.phone || '').includes(clientSearch));
  const filteredServices = services.filter(sv => String(sv.name || '').toLowerCase().includes(serviceSearch.toLowerCase()) || String(sv.category || '').toLowerCase().includes(serviceSearch.toLowerCase()));

  // ── Modal content renderer ──────────────────────────────────────
  function renderModalContent() {

    if (bookView === 'client') return (
      <View style={{ flex: 1 }}>
        <View style={[rowB, { padding: 16, paddingBottom: 8, borderBottomWidth: .5, borderBottomColor: c.divider }]}>
          <TouchableOpacity onPress={() => setBookView('form')} hitSlop={hs}>
            <MaterialCommunityIcons name="arrow-left" size={24} color={c.text} />
          </TouchableOpacity>
          <Text style={{ color: c.text, fontSize: 17, fontWeight: '800' }}>{tr('Select Client')}</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={{ padding: 12 }}>
          <TextInput style={inp(c)} placeholder={tr("Search name or phone…")} placeholderTextColor={c.textMuted}
            value={clientSearch} onChangeText={setClientSearch} autoFocus returnKeyType="search" />
        </View>
        <FlatList data={filteredClients} keyExtractor={i => String(i.id)}
          keyboardShouldPersistTaps="always"
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
          renderItem={({ item }) => (
            <TouchableOpacity style={{ paddingVertical: 14, borderBottomWidth: .5, borderBottomColor: c.divider }}
              onPress={() => { setBClient(item); setClientSearch(''); setBookView('form'); }}>
              <Text style={{ color: c.text, fontSize: 15, fontWeight: '600' }}>{item.name}</Text>
              <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 2 }}>{item.phone || tr('No phone')}  •  {item.loyalty_tier}  •  {item.loyalty_points} pts</Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', padding: 40 }}>
              <MaterialCommunityIcons name="account-search-outline" size={48} color={c.border} />
              <Text style={{ color: c.textMuted, marginTop: 12 }}>{tr('No clients found')}</Text>
            </View>
          }
        />
      </View>
    );

    if (bookView === 'service') return (
      <View style={{ flex: 1 }}>
        <View style={[rowB, { padding: 16, paddingBottom: 8, borderBottomWidth: .5, borderBottomColor: c.divider }]}>
          <TouchableOpacity onPress={() => setBookView('form')} hitSlop={hs}>
            <MaterialCommunityIcons name="arrow-left" size={24} color={c.text} />
          </TouchableOpacity>
          <Text style={{ color: c.text, fontSize: 17, fontWeight: '800' }}>{tr('Add Service')}</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={{ padding: 12 }}>
          <TextInput style={inp(c)} placeholder={tr("Search services…")} placeholderTextColor={c.textMuted}
            value={serviceSearch} onChangeText={setServiceSearch} autoFocus returnKeyType="search" />
        </View>
        <FlatList data={filteredServices} keyExtractor={i => String(i.id)}
          keyboardShouldPersistTaps="always"
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
          renderItem={({ item }) => {
            const already = bServices.some(s => s.id === item.id);
            return (
              <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: .5, borderBottomColor: c.divider }}
                onPress={() => { if (!already) setBServices(p => [...p, item]); setServiceSearch(''); setBookView('form'); }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.text, fontSize: 15, fontWeight: '600' }}>{item.name}</Text>
                  <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 2 }}>{item.category}  •  {currencySymbol}{item.price}  •  {item.duration} min</Text>
                </View>
                {already && <MaterialCommunityIcons name="check-circle" size={20} color={c.success} />}
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', padding: 40 }}>
              <MaterialCommunityIcons name="scissors-cutting" size={48} color={c.border} />
              <Text style={{ color: c.textMuted, marginTop: 12 }}>{tr('No services found')}</Text>
              <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 6, textAlign: 'center' }}>{tr('Add services in Settings → Services first')}</Text>
            </View>
          }
        />
      </View>
    );

    if (bookView === 'time') return (
      <View style={{ flex: 1 }}>
        <View style={[rowB, { padding: 16, paddingBottom: 12, borderBottomWidth: .5, borderBottomColor: c.divider }]}>
          <TouchableOpacity onPress={() => setBookView('form')} hitSlop={hs}>
            <MaterialCommunityIcons name="arrow-left" size={24} color={c.text} />
          </TouchableOpacity>
          <Text style={{ color: c.text, fontSize: 17, fontWeight: '800' }}>{tr('Select Start Time')}</Text>
          <View style={{ width: 24 }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {TIME_SLOTS.map(slot => {
              const gone = isPast(date, slot);
              const on = bStart === slot;
              return (
                <TouchableOpacity key={slot} disabled={gone}
                  style={{ paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, borderWidth: 1.5, minWidth: 82, alignItems: 'center', opacity: gone ? 0.35 : 1,
                    backgroundColor: on ? c.primary : c.surface,
                    borderColor: on ? c.primary : c.border }}
                  onPress={() => { setBStart(slot); setBookView('form'); }}>
                  <Text style={{ color: on ? c.onPrimary : c.text, fontWeight: on ? '800' : '400', fontSize: 15 }}>{slot}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
      </View>
    );

    // MAIN BOOKING FORM
    // Uses automaticallyAdjustKeyboardInsets (RN 0.73+) instead of KAV - works inside modals on both platforms
    return (
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 60 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        automaticallyAdjustKeyboardInsets={true}>
        <View style={rowB}>
          <Text style={{ color: c.text, fontSize: 20, fontWeight: '900' }}>{tr('Book Appointment')}</Text>
          <TouchableOpacity onPress={closeModal} hitSlop={hs}>
            <MaterialCommunityIcons name="close" size={24} color={c.textMuted} />
          </TouchableOpacity>
        </View>
        <Text style={{ color: c.textMuted, fontSize: 13, marginBottom: 20, marginTop: 4 }}>📅 {displayDate}</Text>

        {/* Walk-in */}
        <View style={[rowB, { marginBottom: 16 }]}>
          <Text style={{ color: c.text, fontSize: 14, fontWeight: '500' }}>{tr('Walk-in Customer')}</Text>
          <Switch value={bWalkin} onValueChange={v => { setBWalkin(v); if (v) setBClient(null); }}
            trackColor={{ true: c.primary + '60', false: c.border }} thumbColor={bWalkin ? c.primary : c.textLight} />
        </View>

        {/* Notes FIRST so it's not buried at bottom when keyboard opens */}
        <SLabel text={tr("Notes (optional)")} c={c} />
        <TextInput style={[inp(c), { minHeight: 64, textAlignVertical: 'top', marginBottom: 16 }]}
          placeholder={tr("Special requests, allergy info, preferences…")}
          placeholderTextColor={c.textMuted} value={bNotes} onChangeText={setBNotes}
          multiline returnKeyType="done" blurOnSubmit />

        {/* Client */}
        {!bWalkin && (<>
          <SLabel text={tr("Client *")} c={c} />
          <TouchableOpacity style={[srow(c), { marginBottom: 16 }]} onPress={() => { setClientSearch(''); setBookView('client'); }}>
            <Text style={{ color: bClient ? c.text : c.textMuted, fontSize: 14, flex: 1 }} numberOfLines={1}>
              {bClient ? `${bClient.name}  •  ${bClient.phone || tr('no phone')}` : tr('Tap to select client →')}
            </Text>
            <MaterialCommunityIcons name="chevron-right" size={20} color={c.primary} />
          </TouchableOpacity>
          {bClient?.id ? (
            <ClientAlertBadge clientId={bClient.id} fallbackText={bClient.allergies} noShowCount={bClient.no_show_count} compact style={{ marginTop: -8, marginBottom: 16 }} />
          ) : null}
        </>)}

        {/* Stylist */}
        <SLabel text={tr("Stylist *")} c={c} />
        {staff.length === 0
          ? <Text style={{ color: c.textMuted, fontSize: 13, marginBottom: 16 }}>{tr('No staff found. Add in Settings → Staff first.')}</Text>
          : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
              {staff.map(st => (
                <TouchableOpacity key={st.id} style={[chip(c, bStaff?.id === st.id), { marginRight: 8 }]} onPress={() => setBStaff(st)}>
                  <Text style={{ color: bStaff?.id === st.id ? c.onPrimary : c.textSecondary, fontWeight: '700', fontSize: 13 }}>{st.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )
        }

        {/* Services */}
        <SLabel text={tr("Services *")} c={c} />
        {bServices.map((sv, i) => (
          <View key={`${sv.id}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: c.primaryLight, borderRadius: 10, padding: 10, marginBottom: 8 }}>
            <Text style={{ color: c.primary, fontSize: 13, flex: 1 }}>{sv.name}  •  {currencySymbol}{sv.price}  •  {sv.duration} min</Text>
            <TouchableOpacity onPress={() => setBServices(p => p.filter((_, j) => j !== i))} hitSlop={hs}>
              <MaterialCommunityIcons name="close-circle" size={20} color={c.primary} />
            </TouchableOpacity>
          </View>
        ))}
        <TouchableOpacity style={[srow(c), { marginBottom: 8 }]} onPress={() => { setServiceSearch(''); setBookView('service'); }}>
          <MaterialCommunityIcons name="plus" size={18} color={c.primary} />
          <Text style={{ color: c.primary, fontWeight: '700', fontSize: 14, marginLeft: 6 }}>{tr('Add Service')}</Text>
        </TouchableOpacity>
        {bServices.length > 0 && (
          <Text style={{ color: endsAfterMidnight || bEndMin > CLOSING_MIN ? c.warning : c.textMuted, fontSize: 12, marginBottom: 12 }}>
            {tr('⏱ Total: {dur} min  •  Ends: {end}  •  {amt}', { dur: totalDur, end: endsAfterMidnight ? tr('after midnight') : bEnd, amt: money(currencySymbol, expectedTotal) })}
          </Text>
        )}

        {/* Time */}
        <SLabel text={tr("Start Time *")} c={c} />
        <TouchableOpacity style={[srow(c), { marginBottom: 20 }]} onPress={() => setBookView('time')}>
          <Text style={{ color: c.text, fontSize: 16, fontWeight: '800' }}>⏰  {bStart}</Text>
          <MaterialCommunityIcons name="chevron-down" size={20} color={c.primary} />
        </TouchableOpacity>

        {/* Advance / token — bridal, makeup, big bookings */}
        <SLabel text={tr('Advance / token (optional)')} c={c} />
        <View style={[srow(c), { paddingVertical: 0, marginBottom: 8, borderColor: advanceBad ? c.danger : c.border }]}>
          <Text style={{ color: c.textMuted, fontSize: 16, fontWeight: '800' }}>{currencySymbol}</Text>
          <TextInput style={{ flex: 1, color: c.text, fontSize: 15, paddingVertical: 13, marginLeft: 6 }}
            placeholder={tr('e.g. 2,000 for bridal')} placeholderTextColor={c.textMuted} keyboardType="decimal-pad"
            value={bAdvance} onChangeText={v => setBAdvance(cleanAmountInput(v))} />
        </View>
        {advanceNum > 0 && !advanceBad ? (
          <View style={{ marginBottom: 8 }}>
            <PayMethodPicker value={bAdvMethod} onChange={setBAdvMethod} />
            <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 6 }}>{tr('It will be adjusted automatically when you bill this appointment.')}</Text>
          </View>
        ) : advanceBad && bAdvance.trim() ? (
          <Text style={{ color: c.danger, fontSize: 12, marginBottom: 8 }}>{tr('Advance cannot be more than {amt}.', { amt: money(currencySymbol, expectedTotal) })}</Text>
        ) : null}
        <View style={{ height: 8 }} />

        {/* Home service */}
        <View style={[rowB, { marginBottom: bHome ? 10 : 20 }]}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <MaterialCommunityIcons name="home-account" size={20} color={bHome ? c.primary : c.textMuted} />
            <Text style={{ color: c.text, fontSize: 14, fontWeight: '600' }}>{tr('Home service')}</Text>
          </View>
          <Switch value={bHome} onValueChange={v => { setBHome(v); if (v && !bAddress && bClient?.address) setBAddress(String(bClient.address)); }}
            trackColor={{ true: c.primary + '60', false: c.border }} thumbColor={bHome ? c.primary : c.textLight} />
        </View>
        {bHome && (
          <View style={{ marginBottom: 20 }}>
            <TextInput style={[inp(c), { minHeight: 60, textAlignVertical: 'top' }]} multiline maxLength={300}
              placeholder={tr('Full address with landmark')} placeholderTextColor={c.textMuted} value={bAddress} onChangeText={setBAddress} />
            <View style={[srow(c), { paddingVertical: 0, borderColor: bHome && isNaN(travelNum) ? c.danger : c.border }]}>
              <Text style={{ color: c.textMuted, fontSize: 13, fontWeight: '700' }}>{tr('Travel charge')}  {currencySymbol}</Text>
              <TextInput style={{ flex: 1, color: c.text, fontSize: 15, paddingVertical: 13, marginLeft: 6 }}
                placeholder="0" placeholderTextColor={c.textMuted} keyboardType="decimal-pad"
                value={bTravel} onChangeText={v => setBTravel(cleanAmountInput(v))} />
            </View>
            {bAddress.trim() ? (
              <TouchableOpacity onPress={() => openInMaps(bAddress)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 }}>
                <MaterialCommunityIcons name="map-marker-outline" size={16} color={c.info} />
                <Text style={{ color: c.info, fontWeight: '700', fontSize: 13 }}>{tr('Check on Maps')}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}

        {/* Confirm */}
        <TouchableOpacity style={[btnS(c.primary), { opacity: booking ? 0.6 : 1 }]} onPress={bookAppointment} disabled={booking}>
          {booking ? <ActivityIndicator color={c.onPrimary} /> :
            <Text style={{ color: c.onPrimary, fontWeight: '900', fontSize: 16 }} numberOfLines={1} adjustsFontSizeToFit>
              {tr('Confirm Booking')}{bServices.length > 0 ? `  •  ${money(currencySymbol, expectedTotal)}` : ''}
            </Text>}
        </TouchableOpacity>
        <TouchableOpacity style={[btnS(c.surface), { marginTop: 10 }]} onPress={closeModal}>
          <Text style={{ color: c.textSecondary, fontWeight: '700', fontSize: 15 }}>{tr('Cancel')}</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // ── Main render ────────────────────────────────────────────────
  return (
    <SafeScreen>
      {/* Date nav */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: .5, borderBottomColor: c.divider }}>
        <TouchableOpacity onPress={() => changeDate(-1)} style={{ padding: 8 }} hitSlop={hs}>
          <MaterialCommunityIcons name="chevron-left" size={30} color={c.primary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setJumpOpen(true)} style={{ flex: 1, alignItems: 'center' }} accessibilityLabel={tr('Jump to Date')}>
          <Text style={{ color: c.text, fontSize: 15, fontWeight: '800' }} numberOfLines={1}>{displayDate}</Text>
          <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 2 }}>{apts.length !== 1 ? tr('{n} appointments  •  tap to jump', { n: apts.length }) : tr('{n} appointment  •  tap to jump', { n: apts.length })}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => changeDate(1)} style={{ padding: 8 }} hitSlop={hs}>
          <MaterialCommunityIcons name="chevron-right" size={30} color={c.primary} />
        </TouchableOpacity>
      </View>

      {date !== todayStr() && (
        <TouchableOpacity style={{ margin: 8, padding: 8, borderRadius: 10, backgroundColor: c.primaryLight, alignSelf: 'center', paddingHorizontal: 20 }}
          onPress={() => setDate(todayStr())}>
          <Text style={{ color: c.primary, fontWeight: '700', fontSize: 13 }}>{tr('⬅ Back to Today')}</Text>
        </TouchableOpacity>
      )}

      {canBook && date >= todayStr() && (
        <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', margin: 12, padding: 14, borderRadius: 14, backgroundColor: c.primary, gap: 8 }}
          onPress={openBooking} accessibilityRole="button">
          <MaterialCommunityIcons name="calendar-plus" size={20} color={c.onPrimary} />
          <Text style={{ color: c.onPrimary, fontWeight: '800', fontSize: 15 }}>{tr('Book Appointment')}</Text>
        </TouchableOpacity>
      )}

      {loading
        ? <ActivityIndicator color={c.primary} style={{ marginTop: 40 }} />
        : (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
            {apts.length === 0 && (
              <View style={{ alignItems: 'center', marginTop: 50, gap: 14 }}>
                <MaterialCommunityIcons name="calendar-blank-outline" size={72} color={c.textLight} />
                <Text style={{ color: c.textMuted, fontSize: 16, fontWeight: '600', textAlign: 'center' }}>
                  {date === todayStr() ? tr('No appointments today') : tr('No appointments on {d}', { d: prettyDate(date) })}
                </Text>
                {canBook && date >= todayStr() ? <Text style={{ color: c.textMuted, fontSize: 13 }}>{tr('Tap "Book Appointment" to add one')}</Text> : null}
              </View>
            )}
            {apts.map((apt: any) => {
              const meta = STATUS_META[apt.status] || STATUS_META.confirmed;
              const canConvert = canBill && apt.status === 'completed' && !apt.converted_to_bill;
              const busyRow = statusBusy === apt.id;
              return (
                <View key={apt.id} style={{ borderRadius: 14, padding: 16, marginBottom: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderLeftWidth: 4, borderLeftColor: meta.color }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: c.text, fontSize: 16, fontWeight: '800' }}>
                        {apt.is_walkin ? tr('🚶 Walk-in') : apt.client_name || tr('Unknown Client')}
                      </Text>
                      <Text style={{ color: c.textSecondary, fontSize: 13, marginTop: 3 }}>
                        👤 {apt.staff_name || '—'}  •  ⏰ {apt.start_time} – {apt.end_time}
                      </Text>
                      {apt.service_names ? <Text style={{ color: c.primary, fontSize: 12, marginTop: 5 }}>✂️  {apt.service_names}</Text> : null}
                      {apt.total_amount > 0 ? <Text style={{ color: c.success, fontSize: 12, marginTop: 3 }}>{money(currencySymbol, apt.total_amount)}{Number(apt.travel_charge) > 0 ? `  (${tr('incl. travel {amt}', { amt: money(currencySymbol, apt.travel_charge) })})` : ''}</Text> : null}
                      {Number(apt.advance_amount) > 0 ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 5, alignSelf: 'flex-start', backgroundColor: c.successLight, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
                          <MaterialCommunityIcons name="cash-check" size={13} color={c.success} />
                          <Text style={{ color: c.success, fontSize: 11.5, fontWeight: '800' }}>
                            {tr('Advance {amt}', { amt: money(currencySymbol, apt.advance_amount) })}{apt.advance_method ? ` · ${String(apt.advance_method).toUpperCase()}` : ''}
                          </Text>
                        </View>
                      ) : null}
                      {apt.address ? (
                        <View style={{ marginTop: 6 }}>
                          <Text style={{ color: c.textSecondary, fontSize: 12 }} numberOfLines={2}>🏠 {apt.address}</Text>
                          <TouchableOpacity onPress={() => openInMaps(apt.address)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="link"
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 }}>
                            <MaterialCommunityIcons name="map-marker-outline" size={14} color={c.info} />
                            <Text style={{ color: c.info, fontSize: 12, fontWeight: '800' }}>{tr('Open in Maps')}</Text>
                          </TouchableOpacity>
                        </View>
                      ) : null}
                      {apt.client_allergies ? <Text style={{ color: c.danger, fontSize: 11.5, marginTop: 4, fontWeight: '700' }}>⚠️  {tr('Allergy')}: {apt.client_allergies}</Text> : null}
                      {!apt.is_walkin && Number(apt.client_no_shows) > 0 ? <NoShowBadge count={apt.client_no_shows} style={{ marginTop: 5 }} /> : null}
                      {apt.notes ? <Text style={{ color: c.textMuted, fontSize: 11, marginTop: 3, fontStyle: 'italic' }} numberOfLines={2}>{apt.notes}</Text> : null}
                    </View>
                    <Text style={{ color: meta.color, fontSize: 11, fontWeight: '700' }}>{tr(meta.label)}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                    {busyRow ? <ActivityIndicator size="small" color={c.primary} /> : null}
                    {apt.status === 'confirmed' && canBook && !busyRow && (<>
                      {!!apt.client_phone && !apt.is_walkin && (
                        <AptBtn label={tr("💬 WhatsApp")} color={c.whatsapp} onPress={() => {
                          const m = minutesUntil(apt);
                          const p = m > 0 && m <= 90 ? AppointmentReminderService.sendUpcomingReminder(apt) : AppointmentReminderService.sendConfirmation(apt);
                          Promise.resolve(p).catch(e => showError(e, 'WhatsApp did not open'));
                        }} />
                      )}
                      <AptBtn label={tr("✓ Done")} color={c.success} onPress={() => updateStatus(apt, 'completed')} />
                      <AptBtn label={tr("Reschedule")} color={c.info} onPress={() => { setRescheduleApt(apt); setReschDate(date < todayStr() ? todayStr() : date); setReschStart(apt.start_time || '10:00'); setShowResch(true); }} />
                      <AptBtn label={tr("No-show")} color={c.warning} onPress={() => updateStatus(apt, 'no_show')} />
                      <AptBtn label={tr("Cancel")} color={c.danger} onPress={() =>
                        Alert.alert(tr('Cancel Appointment'), tr('Cancel for {name}?', { name: apt.client_name || tr('Walk-in') }),
                          [{ text: tr('No'), style: 'cancel' }, { text: tr('Yes, cancel'), style: 'destructive', onPress: () => updateStatus(apt, 'cancelled') }])} />
                    </>)}
                    {canConvert && <AptBtn label={tr("💰 Create Bill")} color={c.primary} onPress={() => convertToBill(apt)} />}
                    {apt.converted_to_bill ? <Text style={{ color: c.success, fontSize: 12, fontWeight: '700', alignSelf: 'center' }}>{tr('✓ Bill Created')}</Text> : null}
                  </View>
                </View>
              );
            })}
          </ScrollView>
        )
      }

      {/* ── UNIFIED BOOKING MODAL ── */}
      <BottomModal visible={modalOpen} onClose={closeModal} height={MODAL_H} disableDismissOnBackdrop>
        <View style={{ height: MODAL_H, overflow: 'hidden' }}>
          {renderModalContent()}
        </View>
      </BottomModal>

      {/* ── RESCHEDULE ── */}
      <BottomModal visible={showResch} onClose={() => setShowResch(false)} height="70%">
          <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
            <Text style={{ color: c.text, fontSize: 18, fontWeight: '800', marginBottom: 4 }}>{tr('Reschedule')}</Text>
            <Text style={{ color: c.textMuted, fontSize: 13, marginBottom: 16 }}>
              {rescheduleApt?.is_walkin ? tr('Walk-in') : rescheduleApt?.client_name} — {rescheduleApt?.service_names}
            </Text>
            <Text style={{ color: c.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 8 }}>{tr('New date')}</Text>
            <TouchableOpacity style={[srow(c), { marginBottom: 16 }]} onPress={() => setReschDateOpen(true)}>
              <Text style={{ color: c.text, fontSize: 15, fontWeight: '700' }}>📅  {prettyDate(reschDate, true)}</Text>
              <MaterialCommunityIcons name="chevron-down" size={20} color={c.primary} />
            </TouchableOpacity>
            <Text style={{ color: c.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 8 }}>{tr('New start time')}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
              {TIME_SLOTS.map(slot => {
                const gone = isPast(reschDate, slot);
                const on = reschStart === slot;
                return (
                  <TouchableOpacity key={slot} disabled={gone}
                    style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5, minWidth: 66, alignItems: 'center', opacity: gone ? 0.35 : 1,
                      backgroundColor: on ? c.primary : c.surface, borderColor: on ? c.primary : c.border }}
                    onPress={() => setReschStart(slot)}>
                    <Text style={{ color: on ? c.onPrimary : c.text, fontWeight: on ? '800' : '400', fontSize: 13 }}>{slot}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={{ color: c.textMuted, fontSize: 12, marginBottom: 12 }}>{tr('The booking keeps its length. If the stylist is busy then, you will be told.')}</Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity style={{ flex: 1, padding: 14, borderRadius: 12, backgroundColor: c.surface, alignItems: 'center', borderWidth: 1, borderColor: c.border }} onPress={() => setShowResch(false)}>
                <Text style={{ color: c.textSecondary, fontWeight: '700' }}>{tr('Cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 1, padding: 14, borderRadius: 12, backgroundColor: c.primary, alignItems: 'center', opacity: reschBusy ? 0.6 : 1 }} onPress={doReschedule} disabled={reschBusy}>
                {reschBusy ? <ActivityIndicator color={c.onPrimary} /> : <Text style={{ color: c.onPrimary, fontWeight: '800' }}>{tr('Reschedule')}</Text>}
              </TouchableOpacity>
            </View>
          </ScrollView>
          <DatePickerSheet visible={reschDateOpen} onClose={() => setReschDateOpen(false)} value={reschDate} onPick={setReschDate} title="New date" minDate={todayStr()} />
      </BottomModal>

      <DatePickerSheet visible={jumpOpen} onClose={() => setJumpOpen(false)} value={date} onPick={setDate} title="Jump to Date" />
      {undo.element}
    </SafeScreen>
  );
}

function AptBtn({ label, color, onPress }: any) {
  return (
    <TouchableOpacity style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: color + '18', borderWidth: 1, borderColor: color + '40' }} onPress={onPress}>
      <Text style={{ color, fontSize: 12, fontWeight: '700' }}>{label}</Text>
    </TouchableOpacity>
  );
}
function SLabel({ text, c }: any) {
  return <Text style={{ color: c.textMuted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>{text}</Text>;
}

const hs = { top: 12, bottom: 12, left: 12, right: 12 };
const rowB = { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const };
const inp  = (c: any) => ({ backgroundColor: c.surface, color: c.text, borderRadius: 12, padding: 13, fontSize: 14, borderWidth: 1, borderColor: c.border, marginBottom: 10 });
const srow = (c: any) => ({ flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface });
const chip = (c: any, active: boolean) => ({ paddingHorizontal: 16, paddingVertical: 9, borderRadius: 20, borderWidth: 1.5, backgroundColor: active ? c.primary : c.surface, borderColor: active ? c.primary : c.border });
const btnS = (bg: string) => ({ borderRadius: 14, paddingVertical: 15, alignItems: 'center' as const, backgroundColor: bg, justifyContent: 'center' as const });
