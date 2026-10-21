import React, { useState, useCallback, useContext } from 'react';
import { View, ScrollView, TouchableOpacity, Alert, ActivityIndicator, Image } from 'react-native';
import { Text, TextInput } from '../theme/Text';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeScreen } from '../components/SafeScreen';
import { BottomModal } from '../components/BottomModal';
import { ScreenHeader, Chip, StatCard, Avatar, Pill, SectionLabel, IconTile } from '../components/UI';
import { useTheme } from '../context/ThemeContext';
import { AppContext } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { DatabaseService } from '../database/Database';
import { WhatsAppService } from '../services/WhatsAppService';
import { toLocalDateStr } from '../utils/helpers';
import { renderCertificateHTML, escapeHtml } from '../utils/certificate';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useChoiceSheet } from '../components/ChoiceSheet';
import { DateField, TimeField } from '../components/DateTimePicker';
import { parseAmount, cleanAmountInput, isValidDateStr, normaliseIndianPhone, showError } from '../components/formUtils';
import { appLocale, phoneHint } from '../config/regions';

const FS_DOC_DIR = (FileSystem as any).documentDirectory ?? (FileSystem as any).cacheDirectory ?? '';
const FS_BASE64 = (FileSystem as any).EncodingType?.Base64 ?? 'base64';

type AcadTab = 'overview' | 'courses' | 'batches' | 'students' | 'attendance' | 'fees';

const COURSE_CATEGORIES = ['Hair', 'Makeup', 'Skincare', 'Nail Art', 'Mehendi', 'Threading', 'Waxing', 'Bridal', 'Full Course'];

const TABS: { key: AcadTab; label: string; icon: string; tone: any }[] = [
  { key: 'overview',   label: 'Overview',   icon: 'view-dashboard-outline', tone: 'primary' },
  { key: 'courses',    label: 'Courses',    icon: 'book-open-variant',      tone: 'info' },
  { key: 'batches',    label: 'Batches',    icon: 'calendar-multiselect',   tone: 'accent' },
  { key: 'students',   label: 'Students',   icon: 'account-school-outline', tone: 'primary' },
  { key: 'attendance', label: 'Attendance', icon: 'clipboard-check-outline',tone: 'warning' },
  { key: 'fees',       label: 'Fees',       icon: 'cash-multiple',          tone: 'success' },
];

const emptyStudent = { name: '', phone: '', email: '', gender: '', date_of_birth: '', aadhar: '', emergency_contact: '', batch_id: '', fee_total: '', notes: '', photo: '' };

export default function AcademyScreen({ navigation }: any) {
  const { colors: c } = useTheme();
  const { currencySymbol } = useContext(AppContext);
  const { can } = useAuth();
  const canCert = can('academy.certificate');
  const canManage = can('academy.manage');
  const choice = useChoiceSheet();
  const [attLoading, setAttLoading] = useState(false);

  const [tab, setTab] = useState<AcadTab>('overview');
  const [stats, setStats] = useState<any>({});
  const [courses, setCourses] = useState<any[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [profile, setProfile] = useState<any>({});
  const [loading, setLoading] = useState(false);
  const [studentSearch, setStudentSearch] = useState('');

  const [selectedBatch, setSelectedBatch] = useState<any>(null);
  const [attendanceDate, setAttendanceDate] = useState(toLocalDateStr());
  const [attendanceData, setAttendanceData] = useState<any[]>([]);

  const [showAddCourse, setShowAddCourse] = useState(false);
  const [showAddBatch, setShowAddBatch] = useState(false);
  const [showAddStudent, setShowAddStudent] = useState(false);
  const [showFeeModal, setShowFeeModal] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<any>(null);
  const [staff, setStaff] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  const [courseForm, setCourseForm] = useState({ name: '', category: 'Hair', duration_days: '30', fee: '', description: '', seats_per_batch: '10' });
  const [batchForm, setBatchForm] = useState({ course_id: '', batch_name: '', start_date: '', end_date: '', trainer_id: '', class_time: '10:00' });
  const [studentForm, setStudentForm] = useState({ ...emptyStudent });
  const [feeAmount, setFeeAmount] = useState('');
  const [feeMethod, setFeeMethod] = useState<'cash'|'upi'|'card'>('cash');

  const fmt = (n: number) => `${currencySymbol}${(n || 0).toLocaleString(appLocale(), { maximumFractionDigits: 0 })}`;

  useFocusEffect(useCallback(() => { load(); }, []));

  async function load() {
    setLoading(true);
    try {
      const [s, co, ba, st, stf, prof] = await Promise.all([
        (DatabaseService as any).getAcademyStats(),
        (DatabaseService as any).getAcademyCourses(),
        (DatabaseService as any).getAcademyBatches(),
        (DatabaseService as any).getAcademyStudents(),
        DatabaseService.getStaff(),
        DatabaseService.getSalonProfile(),
      ]);
      setStats(s || {}); setCourses(co || []); setBatches(ba || []);
      setStudents(st || []); setStaff(stf as any[]); setProfile(prof || {});
    } catch (e) { showError(e, 'Could not load academy'); }
    finally { setLoading(false); }
  }

  // ── Student photo ──────────────────────────────────────────────────────────
  async function saveStudentPhoto(uri: string): Promise<string> {
    const dir = FS_DOC_DIR + 'student_photos/';
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    const dest = `${dir}stu_${Date.now()}.jpg`;
    try { await FileSystem.copyAsync({ from: uri, to: dest }); } catch { return uri; }
    return dest;
  }

  async function pickStudentPhoto(mode: 'camera' | 'library') {
    try {
      const perm = mode === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== 'granted') { Alert.alert('Permission needed', `Please allow ${mode === 'camera' ? 'camera' : 'photo library'} access.`); return; }
      const opts: ImagePicker.ImagePickerOptions = { allowsEditing: true, aspect: [1, 1], quality: 0.6, mediaTypes: ['images'] };
      const res = mode === 'camera'
        ? await ImagePicker.launchCameraAsync(opts)
        : await ImagePicker.launchImageLibraryAsync(opts);
      if (!res.canceled && res.assets?.[0]) {
        const saved = await saveStudentPhoto(res.assets[0].uri);
        setStudentForm(p => ({ ...p, photo: saved }));
      }
    } catch { Alert.alert('Error', 'Could not add the photo. Please try again.'); }
  }

  // Was a 4-button Alert — Android drops the 4th, so "Take Photo" vanished.
  function chooseStudentPhoto() {
    choice.open({
      title: 'Student photo',
      message: 'Add a photo for the student ID card',
      options: [
        { label: 'Take photo', icon: 'camera-outline', onPress: () => pickStudentPhoto('camera') },
        { label: 'Choose from gallery', icon: 'image-outline', onPress: () => pickStudentPhoto('library') },
        ...(studentForm.photo ? [{ label: 'Remove photo', icon: 'delete-outline', tone: 'danger' as const, onPress: () => setStudentForm(p => ({ ...p, photo: '' })) }] : []),
      ],
    });
  }

  async function photoDataUri(uri?: string): Promise<string> {
    if (!uri) return '';
    try {
      const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FS_BASE64 });
      return `data:image/jpeg;base64,${b64}`;
    } catch { return ''; }
  }

  // ── Saves ─────────────────────────────────────────────────────────────────
  async function saveCourse() {
    if (!courseForm.name.trim()) { Alert.alert('Required', 'Please enter a course name.'); return; }
    const courseFee = parseAmount(courseForm.fee);
    if (isNaN(courseFee) || courseFee <= 0) { Alert.alert('Check the fee', 'Please enter a valid course fee (e.g. 15,000).'); return; }
    if (busy) return;
    setBusy(true);
    try {
      await (DatabaseService as any).addAcademyCourse({
        ...courseForm,
        duration_days: parseInt(courseForm.duration_days) || 30,
        fee: courseFee,
        seats_per_batch: parseInt(courseForm.seats_per_batch) || 10,
      });
      setShowAddCourse(false);
      setCourseForm({ name: '', category: 'Hair', duration_days: '30', fee: '', description: '', seats_per_batch: '10' });
      load();
      Alert.alert('Done', 'Course added.');
    } catch { Alert.alert('Error', 'Could not save course'); }
    finally { setBusy(false); }
  }

  async function saveBatch() {
    if (!batchForm.course_id) { Alert.alert('Required', 'Please select a course.'); return; }
    if (!batchForm.batch_name.trim()) { Alert.alert('Required', 'Please enter a batch name.'); return; }
    if (!isValidDateStr(batchForm.start_date)) { Alert.alert('Start date needed', 'Pick the start date from the calendar.'); return; }
    if (!isValidDateStr(batchForm.end_date)) { Alert.alert('End date needed', 'Pick the end date from the calendar.'); return; }
    if (batchForm.start_date >= batchForm.end_date) { Alert.alert('Check the dates', 'End date must be after the start date.'); return; }
    if (busy) return;
    setBusy(true);
    try {
      await (DatabaseService as any).addAcademyBatch({ ...batchForm, course_id: parseInt(batchForm.course_id), trainer_id: parseInt(batchForm.trainer_id) || 0 });
      setShowAddBatch(false);
      setBatchForm({ course_id: '', batch_name: '', start_date: '', end_date: '', trainer_id: '', class_time: '10:00' });
      load();
      Alert.alert('Done', 'Batch created.');
    } catch (e) { showError(e, 'Batch not created'); }
    finally { setBusy(false); }
  }

  async function saveStudent() {
    if (!studentForm.name.trim()) { Alert.alert('Required', 'Please enter the student name.'); return; }
    if (!studentForm.phone.trim()) { Alert.alert('Required', 'Please enter a phone number.'); return; }
    const stuPhone = normaliseIndianPhone(studentForm.phone);
    if (!stuPhone) { Alert.alert('Check the number', phoneHint()); return; }
    if (!studentForm.batch_id) { Alert.alert('Required', 'Please select a batch.'); return; }
    const feeTotal = studentForm.fee_total.trim() ? parseAmount(studentForm.fee_total) : NaN;
    if (studentForm.fee_total.trim() && isNaN(feeTotal)) { Alert.alert('Check the fee', 'Course fee must be a number (e.g. 15,000).'); return; }
    if (studentForm.date_of_birth && !isValidDateStr(studentForm.date_of_birth)) { Alert.alert('Check birthday', 'Pick the date of birth from the calendar.'); return; }
    if (busy) return;
    setBusy(true);
    try {
      const b = batches.find(x => x.id === parseInt(studentForm.batch_id));
      await (DatabaseService as any).addAcademyStudent({
        ...studentForm,
        phone: stuPhone,
        batch_id: parseInt(studentForm.batch_id),
        fee_total: !isNaN(feeTotal) ? feeTotal : (b?.course_fee || 0),
        fee_paid: 0,
      });
      setShowAddStudent(false);
      setStudentForm({ ...emptyStudent });
      load();
      Alert.alert('Enrolled', 'Student enrolled successfully.');
    } catch { Alert.alert('Error', 'Could not enroll student'); }
    finally { setBusy(false); }
  }

  async function collectFee() {
    const amt = parseAmount(feeAmount);
    if (!selectedStudent || isNaN(amt) || amt <= 0) { Alert.alert('Check the amount', 'Enter a valid fee amount (e.g. 5,000).'); return; }
    const due = (selectedStudent.fee_total || 0) - (selectedStudent.fee_paid || 0);
    if (amt > due + 0.5) { Alert.alert('Too much', `Only ${fmt(due)} is due for ${selectedStudent.name}.`); return; }
    if (busy) return;
    setBusy(true);
    try {
      const receipt = await (DatabaseService as any).addAcademyFeePayment({ student_id: selectedStudent.id, amount: amt, payment_method: feeMethod });
      setShowFeeModal(false); setFeeAmount(''); load();
      Alert.alert('Payment Recorded', `Receipt No: ${receipt}\nAmount: ${fmt(amt)}`);
    } catch { Alert.alert('Error', 'Could not record payment'); }
    finally { setBusy(false); }
  }

  function feeReminder(student: any) {
    if (!student.phone) { Alert.alert('No phone', 'No phone number on file for this student.'); return; }
    const due = (student.fee_total || 0) - (student.fee_paid || 0);
    const msg = `Hi ${student.name},\n\nThis is a gentle reminder from ${profile.name || 'our academy'} — your course fee balance of ${fmt(due)} for *${student.course_name || 'your course'}* is pending.\n\nPaid so far: ${fmt(student.fee_paid)} of ${fmt(student.fee_total)}.\n\nPlease clear it at your earliest convenience. Thank you! 🙏`;
    Promise.resolve(WhatsAppService.sendMessage(student.phone, msg)).catch(e => showError(e, 'WhatsApp did not open'));
  }

  function markGraduated(student: any) {
    Alert.alert('Mark as Graduated', `Move ${student.name} to graduated students? They'll be removed from the active list. You can still generate their certificate now.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Graduate', onPress: async () => { try { await (DatabaseService as any).updateAcademyStudent(student.id, { status: 'graduated' }); load(); } catch { Alert.alert('Error', 'Could not update.'); } } },
    ]);
  }

  async function loadBatchAttendance(batch: any, date = attendanceDate) {
    setSelectedBatch(batch);
    setTab('attendance');
    setAttLoading(true);
    try {
      const att = await (DatabaseService as any).getAcademyAttendance(batch.id, date);
      setAttendanceData(att || []);
    } catch (e) { showError(e, 'Could not load attendance'); }
    finally { setAttLoading(false); }
  }
  async function markAttendance(studentId: number, status: string) {
    const prev = attendanceData;
    setAttendanceData(p => p.map(s => s.student_id === studentId ? { ...s, status } : s));
    try { await (DatabaseService as any).markAcademyAttendance(studentId, selectedBatch.id, attendanceDate, status); }
    catch (e) { setAttendanceData(prev); showError(e, 'Attendance not saved'); }
  }

  function courseFor(student: any) {
    return courses.find(cc => cc.id === batches.find(b => b.id === student.batch_id)?.course_id);
  }

  async function generateIdCard(student: any) {
    try {
      const img = await photoDataUri(student.photo);
      const html = buildIdCardHTML(student, courseFor(student), profile, img);
      const { uri } = await Print.printToFileAsync({ html });
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `ID Card — ${student.name}` });
    } catch { Alert.alert('Error', 'Could not generate ID card'); }
  }

  async function generateCertificate(student: any) {
    try {
      const template = await (DatabaseService as any).getCertificateTemplate();
      const [img, sig1, sig2, seal] = await Promise.all([
        photoDataUri(student.photo),
        photoDataUri(template.signatory1_image),
        photoDataUri(template.signatory2_image),
        photoDataUri(template.seal_image),
      ]);
      const html = renderCertificateHTML({
        student,
        course: courseFor(student),
        batch: batches.find(b => b.id === student.batch_id),
        profile,
        template,
        photoDataUri: img || undefined,
        sig1DataUri: sig1 || undefined,
        sig2DataUri: sig2 || undefined,
        sealDataUri: seal || undefined,
      });
      const { uri } = await Print.printToFileAsync({ html, width: 842, height: 595 });
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `Certificate — ${student.name}` });
    } catch { Alert.alert('Error', 'Could not generate certificate'); }
  }

  const filteredStudents = students.filter(s =>
    !studentSearch ||
    String(s.name || '').toLowerCase().includes(studentSearch.toLowerCase()) ||
    String(s.phone || '').includes(studentSearch) ||
    String(s.batch_name || '').toLowerCase().includes(studentSearch.toLowerCase())
  );
  const pendingStudents = students.filter(s => s.fee_status !== 'paid');

  return (
    <SafeScreen>
      <ScreenHeader
        title="Academy"
        subtitle="Training institute"
        onBack={() => (navigation?.canGoBack?.() ? navigation.goBack() : navigation?.navigate?.('Main'))}
        right={(tab === 'courses' || tab === 'batches' || tab === 'students') ? (
          <TouchableOpacity style={{ backgroundColor: c.primary, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 9 }}
            onPress={() => {
              if (tab === 'courses') setShowAddCourse(true);
              else if (tab === 'batches') {
                if (courses.length === 0) { Alert.alert('Add a course first', 'Create at least one course before creating a batch.'); return; }
                setShowAddBatch(true);
              } else {
                if (batches.length === 0) { Alert.alert('Add a batch first', 'Create at least one batch before enrolling students.'); return; }
                setStudentForm({ ...emptyStudent }); setShowAddStudent(true);
              }
            }}>
            <Text style={{ color: c.onPrimary, fontWeight: '800', fontSize: 12.5 }}>
              + {tab === 'courses' ? 'Course' : tab === 'batches' ? 'Batch' : 'Student'}
            </Text>
          </TouchableOpacity>
        ) : undefined}
      />

      {/* Tab bar — modern coloured icons */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ paddingHorizontal: 16, marginVertical: 12 }} contentContainerStyle={{ paddingRight: 8, gap: 8 }}>
        {TABS.map(t => {
          const on = tab === t.key;
          return (
            <TouchableOpacity key={t.key} onPress={() => setTab(t.key)} activeOpacity={0.8}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 6, paddingRight: 14, paddingVertical: 6, borderRadius: 999, backgroundColor: on ? c.primary : c.surface, borderWidth: 1, borderColor: on ? c.primary : c.border }}>
              <View style={{ width: 26, height: 26, borderRadius: 999, backgroundColor: on ? 'rgba(255,255,255,0.22)' : c.card, alignItems: 'center', justifyContent: 'center' }}>
                <MaterialCommunityIcons name={t.icon as any} size={15} color={on ? c.onPrimary : c.textSecondary} />
              </View>
              <Text style={{ color: on ? c.onPrimary : c.textSecondary, fontWeight: '800', fontSize: 12.5 }}>{t.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {loading ? <ActivityIndicator color={c.primary} style={{ marginTop: 40 }} /> : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

          {/* OVERVIEW */}
          {tab === 'overview' && (
            <>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
                <StatCard icon="account-school" label="Active students" value={String(stats.activeStudents || 0)} tone="primary" />
                <StatCard icon="calendar-multiselect" label="Active batches" value={String(stats.activeBatches || 0)} tone="accent" />
                <StatCard icon="book-open-variant" label="Courses" value={String(stats.totalCourses || 0)} tone="info" />
                <StatCard icon="cash-multiple" label="Fees this month" value={fmt(stats.monthlyFees || 0)} tone="success" />
              </View>
              {stats.pendingFees > 0 && (
                <TouchableOpacity onPress={() => setTab('fees')}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.warningLight, borderRadius: 16, padding: 16, marginBottom: 16 }}>
                  <IconTile icon="alert-decagram-outline" tone="warning" size={42} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.warning, fontWeight: '800', fontSize: 13 }}>Pending fees</Text>
                    <Text style={{ color: c.warning, fontSize: 20, fontWeight: '900', marginTop: 2 }}>{fmt(stats.pendingFees)}</Text>
                  </View>
                  <MaterialCommunityIcons name="chevron-right" size={22} color={c.warning} />
                </TouchableOpacity>
              )}
              <SectionLabel>Quick actions</SectionLabel>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                {[
                  { icon: 'book-plus-outline', label: 'New course', tone: 'info', onPress: () => setShowAddCourse(true) },
                  { icon: 'calendar-plus', label: 'New batch', tone: 'accent', onPress: () => courses.length ? setShowAddBatch(true) : Alert.alert('Add a course first', 'Create a course before a batch.') },
                  { icon: 'account-plus-outline', label: 'Enroll student', tone: 'primary', onPress: () => batches.length ? (setStudentForm({ ...emptyStudent }), setShowAddStudent(true)) : Alert.alert('Add a batch first', 'Create a batch before enrolling.') },
                  { icon: 'clipboard-check-outline', label: 'Attendance', tone: 'warning', onPress: () => setTab('attendance') },
                  ...(canCert ? [{ icon: 'certificate-outline', label: 'Certificate design', tone: 'accent', onPress: () => navigation.navigate('CertificateTemplate') }] : []),
                ].map(a => (
                  <TouchableOpacity key={a.label} onPress={a.onPress} activeOpacity={0.85}
                    style={{ width: '47.5%', flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.card, borderRadius: 16, padding: 12, borderWidth: 0.5, borderColor: c.borderLight }}>
                    <IconTile icon={a.icon} tone={a.tone as any} size={38} />
                    <Text style={{ color: c.text, fontWeight: '700', fontSize: 12.5, flex: 1 }}>{a.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          {/* COURSES */}
          {tab === 'courses' && (courses.length === 0 ? (
            <EmptyBlock c={c} icon="book-open-page-variant" title="No courses yet" sub="Tap + Course to create your first" />
          ) : courses.map(course => (
            <View key={course.id} style={cardStyle(c)}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <IconTile icon="book-open-variant" tone="info" size={44} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.text, fontSize: 15.5, fontWeight: '800' }}>{course.name}</Text>
                  <Text style={{ color: c.textMuted, fontSize: 12.5, marginTop: 2 }}>{course.category} · {course.duration_days} days · max {course.seats_per_batch}/batch</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ color: c.primary, fontSize: 17, fontWeight: '900' }}>{fmt(course.fee)}</Text>
                  <Text style={{ color: c.textMuted, fontSize: 10.5 }}>per student</Text>
                </View>
              </View>
              {course.description ? <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 10 }}>{course.description}</Text> : null}
            </View>
          )))}

          {/* BATCHES */}
          {tab === 'batches' && (batches.length === 0 ? (
            <EmptyBlock c={c} icon="calendar-multiselect" title="No batches yet" sub="Create a batch from an existing course" />
          ) : batches.map(batch => {
            const cap = batch.capacity || 0;
            const pct = cap > 0 ? Math.min(100, Math.round((batch.enrolled_count / cap) * 100)) : 0;
            const tone = batch.status === 'ongoing' ? 'success' : batch.status === 'upcoming' ? 'primary' : 'neutral';
            return (
              <TouchableOpacity key={batch.id} style={cardStyle(c)} onPress={() => loadBatchAttendance(batch)} activeOpacity={0.85}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.text, fontSize: 15.5, fontWeight: '800' }}>{batch.batch_name}</Text>
                    <Text style={{ color: c.primary, fontSize: 12.5, marginTop: 2, fontWeight: '700' }}>{batch.course_name}</Text>
                    <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 4 }}>{batch.start_date} → {batch.end_date}</Text>
                    {batch.trainer_name ? <Text style={{ color: c.textMuted, fontSize: 12 }}>Trainer: {batch.trainer_name}</Text> : null}
                  </View>
                  <Pill label={batch.status} tone={tone as any} />
                </View>
                {cap > 0 && (
                  <View style={{ marginTop: 12 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 }}>
                      <Text style={{ color: c.textMuted, fontSize: 11.5, fontWeight: '700' }}>Seats filled</Text>
                      <Text style={{ color: c.textSecondary, fontSize: 11.5, fontWeight: '700' }}>{batch.enrolled_count}/{cap}</Text>
                    </View>
                    <View style={{ height: 7, backgroundColor: c.surface, borderRadius: 4, overflow: 'hidden' }}>
                      <View style={{ height: 7, width: `${pct}%` as any, borderRadius: 4, backgroundColor: pct >= 100 ? c.danger : pct >= 80 ? c.warning : c.success }} />
                    </View>
                  </View>
                )}
                <Text style={{ color: c.primary, fontSize: 12, marginTop: 10, fontWeight: '700' }}>Tap to mark attendance →</Text>
              </TouchableOpacity>
            );
          }))}

          {/* STUDENTS */}
          {tab === 'students' && (
            <>
              {students.length > 0 && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.surface, borderRadius: 14, paddingHorizontal: 13, marginBottom: 12, borderWidth: 1, borderColor: c.border }}>
                  <MaterialCommunityIcons name="magnify" size={19} color={c.textMuted} />
                  <TextInput style={{ flex: 1, paddingVertical: 11, color: c.text, fontSize: 14 }} placeholder="Search students…" placeholderTextColor={c.textMuted} value={studentSearch} onChangeText={setStudentSearch} />
                  {studentSearch ? <TouchableOpacity onPress={() => setStudentSearch('')}><MaterialCommunityIcons name="close-circle" size={17} color={c.textMuted} /></TouchableOpacity> : null}
                </View>
              )}
              {filteredStudents.length === 0 ? (
                <EmptyBlock c={c} icon="account-school-outline" title={studentSearch ? 'No match' : 'No students enrolled'} sub={studentSearch ? 'Try a different search' : 'Tap + Student to enroll'} />
              ) : filteredStudents.map(student => {
                const due = (student.fee_total || 0) - (student.fee_paid || 0);
                const feeTone = student.fee_status === 'paid' ? 'success' : student.fee_status === 'partial' ? 'warning' : 'danger';
                return (
                  <View key={student.id} style={cardStyle(c)}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Avatar name={student.name} uri={student.photo || undefined} size={46} />
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={{ color: c.text, fontSize: 15, fontWeight: '800' }}>{student.name}</Text>
                        <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 1 }}>{student.course_name} · {student.batch_name}</Text>
                        {student.phone ? <Text style={{ color: c.textLight, fontSize: 11.5, marginTop: 1 }}>{student.phone}</Text> : null}
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: 4 }}>
                        <Pill label={student.fee_status} tone={feeTone as any} />
                        <Text style={{ color: c.textMuted, fontSize: 11 }}>{fmt(student.fee_paid)} / {fmt(student.fee_total)}</Text>
                      </View>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                      {due > 0 && (
                        <PillBtn c={c} tone="success" icon="cash-plus" label="Collect fee"
                          onPress={() => { setSelectedStudent(student); setFeeAmount(String(due)); setShowFeeModal(true); }} />
                      )}
                      {canCert && <PillBtn c={c} tone="primary" icon="card-account-details-outline" label="ID card" onPress={() => generateIdCard(student)} />}
                      {canCert && <PillBtn c={c} tone="accent" icon="certificate-outline" label="Certificate" onPress={() => generateCertificate(student)} />}
                    </View>
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                      {student.phone ? <PillBtn c={c} tone="success" icon="whatsapp" label="WhatsApp" onPress={() => WhatsAppService.sendMessage(student.phone, `Hi ${student.name}! 👋`)} /> : null}
                      <PillBtn c={c} tone="warning" icon="school-outline" label="Graduate" onPress={() => markGraduated(student)} />
                    </View>
                  </View>
                );
              })}
            </>
          )}

          {/* ATTENDANCE */}
          {tab === 'attendance' && (!selectedBatch ? (
            <View style={{ alignItems: 'center', marginTop: 40 }}>
              <IconTile icon="clipboard-check-outline" tone="warning" size={60} />
              <Text style={{ color: c.textMuted, fontSize: 15, marginTop: 14 }}>Pick a batch to take attendance</Text>
              <TouchableOpacity style={{ marginTop: 16, backgroundColor: c.primary, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12 }} onPress={() => setTab('batches')}>
                <Text style={{ color: c.onPrimary, fontWeight: '800' }}>Go to Batches</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={cardStyle(c)}>
                <Text style={{ color: c.text, fontWeight: '800', fontSize: 16 }}>{selectedBatch.batch_name}</Text>
                <Text style={{ color: c.textMuted, fontSize: 13 }}>{selectedBatch.course_name}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 }}>
                  <View style={{ flex: 1, marginBottom: -14 }}>
                    <DateField value={attendanceDate} maxDate={toLocalDateStr()} onChange={d => { setAttendanceDate(d); loadBatchAttendance(selectedBatch, d); }} />
                  </View>
                  {attLoading ? <ActivityIndicator color={c.primary} /> : null}
                </View>
              </View>
              {attendanceData.length === 0 ? (
                <Text style={{ color: c.textMuted, textAlign: 'center', marginTop: 20 }}>No students in this batch, or tap Load.</Text>
              ) : attendanceData.map(s => (
                <View key={s.student_id} style={{ backgroundColor: c.card, borderRadius: 14, padding: 12, marginBottom: 8, flexDirection: 'row', alignItems: 'center', borderWidth: 0.5, borderColor: c.borderLight }}>
                  <Avatar name={s.name} uri={s.photo || undefined} size={34} />
                  <Text style={{ flex: 1, color: c.text, fontSize: 14, fontWeight: '700', marginLeft: 10 }}>{s.name}</Text>
                  {(['present', 'absent', 'late'] as const).map(st => (
                    <TouchableOpacity key={st} onPress={() => markAttendance(s.student_id, st)}
                      style={{ marginLeft: 7, width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center',
                        backgroundColor: s.status === st ? (st === 'present' ? c.success : st === 'absent' ? c.danger : c.warning) : c.surface }}>
                      <Text style={{ color: s.status === st ? c.onPrimary : c.textMuted, fontSize: 12.5, fontWeight: '900' }}>{st[0].toUpperCase()}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ))}
            </>
          ))}

          {/* FEES */}
          {tab === 'fees' && (pendingStudents.length === 0 ? (
            <View style={{ alignItems: 'center', marginTop: 40 }}>
              <IconTile icon="check-decagram" tone="success" size={60} />
              <Text style={{ color: c.success, fontSize: 16, fontWeight: '800', marginTop: 12 }}>All fees collected 🎉</Text>
            </View>
          ) : (
            <>
              <SectionLabel>Students with a balance</SectionLabel>
              {pendingStudents.map(student => (
                <View key={student.id} style={cardStyle(c)}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Avatar name={student.name} uri={student.photo || undefined} size={40} />
                    <View style={{ flex: 1, marginLeft: 11 }}>
                      <Text style={{ color: c.text, fontSize: 14.5, fontWeight: '800' }}>{student.name}</Text>
                      <Text style={{ color: c.textMuted, fontSize: 12 }}>{student.batch_name}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ color: c.danger, fontSize: 15.5, fontWeight: '900' }}>Due {fmt((student.fee_total || 0) - (student.fee_paid || 0))}</Text>
                      <Text style={{ color: c.textMuted, fontSize: 11 }}>Paid {fmt(student.fee_paid)} / {fmt(student.fee_total)}</Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                    <PillBtn c={c} tone="success" icon="cash-plus" label="Collect"
                      onPress={() => { setSelectedStudent(student); setFeeAmount(String((student.fee_total || 0) - (student.fee_paid || 0))); setShowFeeModal(true); }} />
                    {student.phone ? <PillBtn c={c} tone="warning" icon="whatsapp" label="Remind" onPress={() => feeReminder(student)} /> : null}
                  </View>
                </View>
              ))}
            </>
          ))}
        </ScrollView>
      )}

      {/* ── ADD COURSE ── */}
      <BottomModal visible={showAddCourse} onClose={() => setShowAddCourse(false)}>
        <ModalShell c={c} title="New Course">
          {([
            ['Course name *', 'name', 'e.g. Advanced Hair Styling', 'default'],
            ['Duration (days)', 'duration_days', '30', 'numeric'],
            ['Fee *', 'fee', '0', 'numeric'],
            ['Seats per batch', 'seats_per_batch', '10', 'numeric'],
            ['Description', 'description', 'Course details…', 'default'],
          ] as const).map(([label, field, ph, kb]) => (
            <FieldRow key={field} c={c} label={label}>
              <TextInput style={fieldInput(c)} value={(courseForm as any)[field]} onChangeText={v => setCourseForm(p => ({ ...p, [field]: v }))}
                placeholder={ph} placeholderTextColor={c.textMuted} keyboardType={kb as any} />
            </FieldRow>
          ))}
          <FieldRow c={c} label="Category">
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {COURSE_CATEGORIES.map(cat => <Chip key={cat} label={cat} active={courseForm.category === cat} onPress={() => setCourseForm(p => ({ ...p, category: cat }))} />)}
            </ScrollView>
          </FieldRow>
          <FormActions c={c} busy={busy} submitLabel="Add course" onCancel={() => setShowAddCourse(false)} onSubmit={saveCourse} />
        </ModalShell>
      </BottomModal>

      {/* ── ADD BATCH ── */}
      <BottomModal visible={showAddBatch} onClose={() => setShowAddBatch(false)}>
        <ModalShell c={c} title="New Batch">
          <FieldRow c={c} label="Course *">
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {courses.map(course => <Chip key={course.id} label={course.name} active={batchForm.course_id === String(course.id)} onPress={() => setBatchForm(p => ({ ...p, course_id: String(course.id) }))} />)}
            </ScrollView>
          </FieldRow>
          <FieldRow c={c} label="Batch name *">
            <TextInput style={fieldInput(c)} value={batchForm.batch_name} onChangeText={v => setBatchForm(p => ({ ...p, batch_name: v }))} placeholder="e.g. Batch A — Jan 2026" placeholderTextColor={c.textMuted} />
          </FieldRow>
          <DateField label="Start date *" value={batchForm.start_date} onChange={v => setBatchForm(p => ({ ...p, start_date: v }))} />
          <DateField label="End date *" value={batchForm.end_date} onChange={v => setBatchForm(p => ({ ...p, end_date: v }))} minDate={batchForm.start_date || undefined} />
          <TimeField label="Class time" value={batchForm.class_time} onChange={v => setBatchForm(p => ({ ...p, class_time: v }))} minuteStep={15} />
          <FieldRow c={c} label="Trainer">
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {staff.map(s => <Chip key={s.id} label={s.name} active={batchForm.trainer_id === String(s.id)} onPress={() => setBatchForm(p => ({ ...p, trainer_id: String(s.id) }))} />)}
            </ScrollView>
          </FieldRow>
          <FormActions c={c} busy={busy} submitLabel="Create batch" onCancel={() => setShowAddBatch(false)} onSubmit={saveBatch} />
        </ModalShell>
      </BottomModal>

      {/* ── ADD STUDENT ── */}
      <BottomModal visible={showAddStudent} onClose={() => setShowAddStudent(false)}>
        <ModalShell c={c} title="Enroll Student">
          {/* Photo */}
          <View style={{ alignItems: 'center', marginBottom: 16 }}>
            <TouchableOpacity onPress={chooseStudentPhoto} activeOpacity={0.8}>
              {studentForm.photo ? (
                <Image source={{ uri: studentForm.photo }} style={{ width: 92, height: 92, borderRadius: 46, backgroundColor: c.surface }} />
              ) : (
                <View style={{ width: 92, height: 92, borderRadius: 46, backgroundColor: c.primaryLight, alignItems: 'center', justifyContent: 'center' }}>
                  <MaterialCommunityIcons name="camera-plus-outline" size={30} color={c.primary} />
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={chooseStudentPhoto} style={{ marginTop: 8 }}>
              <Text style={{ color: c.primary, fontWeight: '700', fontSize: 13 }}>
                {studentForm.photo ? 'Change photo' : 'Upload or take a photo'}
              </Text>
            </TouchableOpacity>
            <Text style={{ color: c.textMuted, fontSize: 11, marginTop: 3 }}>Shows on the ID card & certificate</Text>
          </View>

          <FieldRow c={c} label="Batch *">
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {batches.map(b => <Chip key={b.id} label={b.batch_name} active={studentForm.batch_id === String(b.id)} onPress={() => setStudentForm(p => ({ ...p, batch_id: String(b.id), fee_total: String(b.course_fee || '') }))} />)}
            </ScrollView>
          </FieldRow>
          {([
            ['Full name *', 'name', 'Student full name', 'default'],
            ['Phone *', 'phone', 'Mobile number', 'phone-pad'],
            ['Email', 'email', 'email@example.com', 'email-address'],
            ['ID proof (last 4 digits)', 'aadhar', 'Last 4 digits only', 'numeric'],
            ['Emergency contact', 'emergency_contact', 'Parent / guardian phone', 'phone-pad'],
            ['Course fee', 'fee_total', '0', 'decimal-pad'],
            ['Notes', 'notes', 'Any special notes…', 'default'],
          ] as const).map(([label, field, ph, kb]) => (
            <FieldRow key={field} c={c} label={label}>
              <TextInput style={fieldInput(c)} value={(studentForm as any)[field]} onChangeText={v => setStudentForm(p => ({ ...p, [field]: v }))} placeholder={ph} placeholderTextColor={c.textMuted} keyboardType={kb as any} autoCapitalize={field === 'email' ? 'none' : 'sentences'} />
            </FieldRow>
          ))}
          <DateField label="Date of birth" value={studentForm.date_of_birth} onChange={v => setStudentForm(p => ({ ...p, date_of_birth: v }))} allowClear maxDate={toLocalDateStr()} />
          <FieldRow c={c} label="Gender">
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {['Female', 'Male', 'Other'].map(g => (
                <TouchableOpacity key={g} onPress={() => setStudentForm(p => ({ ...p, gender: g }))}
                  style={{ flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center', backgroundColor: studentForm.gender === g ? c.primary : c.surface, borderWidth: 1, borderColor: studentForm.gender === g ? c.primary : c.border }}>
                  <Text style={{ color: studentForm.gender === g ? c.onPrimary : c.textSecondary, fontWeight: '700', fontSize: 13 }}>{g}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </FieldRow>
          <FormActions c={c} busy={busy} submitLabel="Enroll student" onCancel={() => setShowAddStudent(false)} onSubmit={saveStudent} />
        </ModalShell>
      </BottomModal>

      {/* ── FEE ── */}
      <BottomModal visible={showFeeModal} onClose={() => setShowFeeModal(false)}>
        <ModalShell c={c} title="Collect Fee">
          <Text style={{ color: c.textMuted, fontSize: 14, marginBottom: 14, marginTop: -4 }}>{selectedStudent?.name}</Text>
          <FieldRow c={c} label={`Amount  ·  ${fmt((selectedStudent?.fee_total || 0) - (selectedStudent?.fee_paid || 0))} due`}>
            <TextInput style={[fieldInput(c), { fontSize: 22, fontWeight: '800', borderColor: c.primary }]} value={feeAmount} onChangeText={v => setFeeAmount(cleanAmountInput(v))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={c.textMuted} />
          </FieldRow>
          <FieldRow c={c} label="Payment method">
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(['cash', 'upi', 'card'] as const).map(m => (
                <TouchableOpacity key={m} onPress={() => setFeeMethod(m)}
                  style={{ flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center', backgroundColor: feeMethod === m ? c.primary : c.surface, borderWidth: 1, borderColor: feeMethod === m ? c.primary : c.border }}>
                  <Text style={{ color: feeMethod === m ? c.onPrimary : c.textSecondary, fontWeight: '700', textTransform: 'capitalize', fontSize: 13 }}>{m}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </FieldRow>
          <FormActions c={c} busy={busy} submitLabel={`Record payment${feeAmount ? ` · ${fmt(parseAmount(feeAmount) || 0)}` : ''}`} submitTone={c.success} onCancel={() => setShowFeeModal(false)} onSubmit={collectFee} />
        </ModalShell>
      </BottomModal>
    </SafeScreen>
  );
}

// ── local helpers ───────────────────────────────────────────────────────────
const cardStyle = (c: any) => ({ backgroundColor: c.card, borderRadius: 18, padding: 16, marginBottom: 12, borderWidth: 0.5, borderColor: c.borderLight });
const fieldInput = (c: any) => ({ backgroundColor: c.surface, color: c.text, borderRadius: 12, padding: 12, fontSize: 14.5, borderWidth: 1.5, borderColor: c.border });

function EmptyBlock({ c, icon, title, sub }: any) {
  return (
    <View style={{ alignItems: 'center', marginTop: 44 }}>
      <IconTile icon={icon} tone="primary" size={62} />
      <Text style={{ color: c.text, fontSize: 16, fontWeight: '800', marginTop: 14 }}>{title}</Text>
      <Text style={{ color: c.textMuted, fontSize: 13, marginTop: 4 }}>{sub}</Text>
    </View>
  );
}

function FieldRow({ c, label, children }: any) {
  return (
    <View style={{ marginBottom: 13 }}>
      <Text style={{ color: c.textSecondary, fontSize: 12.5, fontWeight: '700', marginBottom: 7 }}>{label}</Text>
      {children}
    </View>
  );
}

function ModalShell({ c, title, children }: any) {
  return (
    <ScrollView style={{ backgroundColor: c.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24 }} contentContainerStyle={{ padding: 20, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
      <Text style={{ color: c.text, fontSize: 20, fontWeight: '900', marginBottom: 16 }}>{title}</Text>
      {children}
    </ScrollView>
  );
}

function FormActions({ c, busy, submitLabel, submitTone, onCancel, onSubmit }: any) {
  return (
    <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
      <TouchableOpacity style={{ flex: 1, paddingVertical: 15, borderRadius: 14, alignItems: 'center', backgroundColor: c.surface }} onPress={onCancel} disabled={busy}>
        <Text style={{ color: c.textSecondary, fontWeight: '800', fontSize: 15 }}>Cancel</Text>
      </TouchableOpacity>
      <TouchableOpacity style={{ flex: 1.4, paddingVertical: 15, borderRadius: 14, alignItems: 'center', backgroundColor: busy ? c.textMuted : (submitTone || c.primary) }} onPress={onSubmit} disabled={busy}>
        <Text style={{ color: c.onPrimary, fontWeight: '900', fontSize: 15 }}>{busy ? 'Saving…' : submitLabel}</Text>
      </TouchableOpacity>
    </View>
  );
}

function PillBtn({ c, tone, icon, label, onPress }: any) {
  const map: Record<string, string> = { primary: c.primary, success: c.success, warning: c.warning, danger: c.danger, accent: c.accent, info: c.info };
  const fg = map[tone] || c.primary;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8}
      style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 9, borderRadius: 12, backgroundColor: fg + '18' }}>
      <MaterialCommunityIcons name={icon} size={14} color={fg} />
      <Text style={{ color: fg, fontWeight: '800', fontSize: 12 }}>{label}</Text>
    </TouchableOpacity>
  );
}

// ── PDF templates ───────────────────────────────────────────────────────────
function buildIdCardHTML(student: any, course: any, profile: any, photo: string) {
  const e = escapeHtml;
  const avatar = photo
    ? `<img src="${photo}" style="width:84px;height:84px;border-radius:42px;object-fit:cover;border:3px solid rgba(255,255,255,0.35)" />`
    : `<div class="avatar">${e((student.name || '?')[0]).toUpperCase()}</div>`;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    body{font-family:'Helvetica Neue',Arial,sans-serif;margin:0;padding:24px;background:#eef}
    .card{width:320px;border-radius:18px;overflow:hidden;background:#17151f;color:#fff;margin:auto}
    .header{background:#A84F18;padding:12px;text-align:center;font-size:13px;font-weight:800;letter-spacing:1px}
    .body{padding:20px;text-align:center}
    .avatar{width:84px;height:84px;border-radius:42px;background:#A84F18;margin:0 auto;display:flex;align-items:center;justify-content:center;font-size:34px;line-height:84px}
    .name{font-size:20px;font-weight:800;margin-top:12px}
    .course{font-size:12.5px;color:#9A7CFF;margin-top:2px}
    .rows{text-align:left;margin-top:16px;font-size:12px;color:#cfc9dd}
    .rows div{margin-bottom:6px}.rows b{color:#8b8698;font-weight:600}
    .footer{background:#211c34;padding:9px;text-align:center;font-size:10px;color:#9a94ad}
  </style></head><body><div class="card">
    <div class="header">${e((profile.name || 'SALOONBOSSX ACADEMY').toUpperCase())}</div>
    <div class="body">
      ${avatar}
      <div class="name">${e(student.name)}</div>
      <div class="course">${e(course?.name || 'Beauty Course')}</div>
      <div class="rows">
        <div><b>Batch</b> &nbsp; ${e(student.batch_name || '—')}</div>
        <div><b>Phone</b> &nbsp; ${e(student.phone || '—')}</div>
        <div><b>Enrolled</b> &nbsp; ${e(student.enrollment_date || '—')}</div>
        <div><b>Student ID</b> &nbsp; STU-${String(student.id).padStart(4, '0')}</div>
        ${student.emergency_contact ? `<div><b>Emergency</b> &nbsp; ${e(student.emergency_contact)}</div>` : ''}
      </div>
    </div>
    <div class="footer">${profile.phone ? e(profile.phone) + '  ·  ' : ''}Powered by SaloonBossX</div>
  </div></body></html>`;
}
