import React from 'react';
import {
  View, TouchableOpacity, StyleSheet, Modal, Keyboard,
  ScrollView, ActivityIndicator, Image,
} from 'react-native';
import { useKeyboardInset } from './useKeyboardInset';
import { Text, TextInput } from '../theme/Text';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { Radius, Shadow, Spacing, FontSize } from '../theme/colors';

type Tone = 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'accent';

function useToneColor(tone: Tone) {
  const { colors: c } = useTheme();
  const map: Record<Tone, { fg: string; bg: string }> = {
    primary: { fg: c.primary, bg: c.primaryLight },
    success: { fg: c.success, bg: c.successLight },
    warning: { fg: c.warning, bg: c.warningLight },
    danger:  { fg: c.danger,  bg: c.dangerLight },
    info:    { fg: c.info,    bg: c.infoLight },
    accent:  { fg: c.accent,  bg: c.accentLight },
    neutral: { fg: c.textSecondary, bg: c.surface },
  };
  return map[tone] || map.neutral;
}

// ═══ SCREEN HEADER (stack screens: back arrow + centered title) ═══════════════
export const ScreenHeader = ({ title, onBack, right, subtitle }: {
  title: string; onBack?: () => void; right?: React.ReactNode; subtitle?: string;
}) => {
  const { colors: c } = useTheme();
  return (
    <View style={[hd.row, { backgroundColor: c.bg, borderBottomColor: c.divider }]}>
      {onBack ? (
        <TouchableOpacity onPress={onBack} style={[hd.iconBtn, { backgroundColor: c.surface }]} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <MaterialCommunityIcons name="chevron-left" size={26} color={c.text} />
        </TouchableOpacity>
      ) : <View style={{ width: 40 }} />}
      <View style={{ flex: 1, alignItems: 'center' }}>
        <Text style={[hd.title, { color: c.text }]} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={[hd.sub, { color: c.textMuted }]} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      <View style={{ minWidth: 40, alignItems: 'flex-end' }}>{right || <View style={{ width: 40 }} />}</View>
    </View>
  );
};
const hd = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 56 },
  iconBtn: { width: 40, height: 40, borderRadius: 13, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 17, fontWeight: '800', textAlign: 'center', letterSpacing: -0.3 },
  sub: { fontSize: 11.5, marginTop: 1, fontWeight: '600' },
});

// ═══ APP BAR (tab screens: large title + optional action) ════════════════════
export const AppBar = ({ title, subtitle, right }: {
  title: string; subtitle?: string; right?: React.ReactNode;
}) => {
  const { colors: c } = useTheme();
  return (
    <View style={ab.row}>
      <View style={{ flex: 1 }}>
        {subtitle ? <Text style={[ab.sub, { color: c.textMuted }]}>{subtitle}</Text> : null}
        <Text style={[ab.title, { color: c.text }]} numberOfLines={1}>{title}</Text>
      </View>
      {right}
    </View>
  );
};
const ab = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.screen, paddingTop: 12, paddingBottom: 14, gap: 12 },
  title: { fontSize: 27, fontWeight: '900', letterSpacing: -0.8 },
  sub: { fontSize: 12.5, fontWeight: '700', marginBottom: 2, letterSpacing: 0.2 },
});

// ═══ CARD ═══════════════════════════════════════════════════════════════════
export const Card = ({ children, style, onPress, padded = true }: {
  children: React.ReactNode; style?: any; onPress?: () => void; padded?: boolean;
}) => {
  const { colors: c } = useTheme();
  const inner = (
    <View style={[cd.card, { backgroundColor: c.card, borderColor: c.borderLight }, padded && cd.pad, Shadow.card, style]}>
      {children}
    </View>
  );
  if (onPress) return <TouchableOpacity activeOpacity={0.85} onPress={onPress}>{inner}</TouchableOpacity>;
  return inner;
};
const cd = StyleSheet.create({
  card: { borderRadius: Radius.lg, marginBottom: 12, borderWidth: StyleSheet.hairlineWidth },
  pad: { padding: 16 },
});

// ═══ INPUT ══════════════════════════════════════════════════════════════════
export const Input = ({ label, icon, hint, error, style, ...props }: any) => {
  const { colors: c } = useTheme();
  const [focused, setFocused] = React.useState(false);
  const borderColor = error ? c.danger : focused ? c.primary : c.border;
  return (
    <View style={{ marginBottom: 14 }}>
      {label ? <Text style={[inp.label, { color: c.textSecondary }]}>{label}</Text> : null}
      <View style={[inp.wrap, { backgroundColor: c.surface, borderColor }]}>
        {icon ? <MaterialCommunityIcons name={icon} size={18} color={focused ? c.primary : c.textMuted} style={{ marginRight: 9 }} /> : null}
        <TextInput
          style={[inp.input, { color: c.text }, style]}
          placeholderTextColor={c.textMuted}
          onFocus={(e) => { setFocused(true); props.onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); props.onBlur?.(e); }}
          {...props}
        />
      </View>
      {error ? <Text style={[inp.hint, { color: c.danger }]}>{error}</Text>
        : hint ? <Text style={[inp.hint, { color: c.textMuted }]}>{hint}</Text> : null}
    </View>
  );
};
const inp = StyleSheet.create({
  label: { fontSize: 12.5, fontWeight: '700', marginBottom: 7, letterSpacing: 0.1 },
  wrap: { flexDirection: 'row', alignItems: 'center', borderRadius: Radius.md, paddingHorizontal: 14, borderWidth: 1.5 },
  input: { flex: 1, paddingVertical: 14, fontSize: 15 },
  hint: { fontSize: 11.5, marginTop: 5, marginLeft: 2 },
});

// ═══ BUTTON ═════════════════════════════════════════════════════════════════
export const Button = ({ label, onPress, icon, color, disabled, loading, variant = 'primary', size = 'md', full = true, style }: {
  label: string; onPress: () => void; icon?: string; color?: string; disabled?: boolean; loading?: boolean;
  variant?: 'primary' | 'outline' | 'ghost' | 'subtle'; size?: 'sm' | 'md' | 'lg'; full?: boolean; style?: any;
}) => {
  const { colors: c } = useTheme();
  const accent = color || c.primary;
  const pad = size === 'sm' ? 10 : size === 'lg' ? 18 : 15;
  const fontSize = size === 'sm' ? 13.5 : size === 'lg' ? 16.5 : 15.5;
  const bg = variant === 'primary' ? accent : variant === 'subtle' ? accent + '18' : 'transparent';
  const textColor = variant === 'primary' ? c.onPrimary : accent;
  return (
    <TouchableOpacity
      style={[
        btn.base,
        { backgroundColor: bg, paddingVertical: pad, opacity: disabled ? 0.45 : 1, alignSelf: full ? 'stretch' : 'flex-start', paddingHorizontal: full ? 0 : 22 },
        variant === 'primary' && Shadow.glow(accent),
        variant === 'outline' && { borderWidth: 1.5, borderColor: accent },
        style,
      ]}
      onPress={onPress} disabled={disabled || loading} activeOpacity={0.85}>
      {loading ? <ActivityIndicator color={textColor} size="small" /> : (<>
        {icon ? <MaterialCommunityIcons name={icon as any} size={size === 'sm' ? 16 : 19} color={textColor} /> : null}
        <Text style={[btn.text, { color: textColor, fontSize }]}>{label}</Text>
      </>)}
    </TouchableOpacity>
  );
};
const btn = StyleSheet.create({
  base: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: Radius.md },
  text: { fontWeight: '800', letterSpacing: -0.2 },
});

// ═══ ICON BUTTON ════════════════════════════════════════════════════════════
export const IconButton = ({ icon, onPress, tone = 'primary', size = 40, disabled, loading }: {
  icon: string; onPress: () => void; tone?: Tone; size?: number; disabled?: boolean; loading?: boolean;
}) => {
  const t = useToneColor(tone);
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled || loading} activeOpacity={0.7}
      style={{ width: size, height: size, borderRadius: 13, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.5 : 1 }}>
      {loading ? <ActivityIndicator size="small" color={t.fg} /> : <MaterialCommunityIcons name={icon as any} size={size * 0.5} color={t.fg} />}
    </TouchableOpacity>
  );
};

// ═══ ICON TILE — modern rounded-square coloured icon (theme-aware) ═══════════
export const IconTile = ({ icon, tone = 'primary', size = 40, filled }: {
  icon: string; tone?: Tone; size?: number; filled?: boolean;
}) => {
  const { colors: c } = useTheme();
  const t = useToneColor(tone);
  return (
    <View style={{
      width: size, height: size, borderRadius: size * 0.32,
      backgroundColor: filled ? t.fg : t.bg,
      alignItems: 'center', justifyContent: 'center',
    }}>
      <MaterialCommunityIcons name={icon as any} size={size * 0.52} color={filled ? c.onPrimary : t.fg} />
    </View>
  );
};

// ═══ CHIP ═══════════════════════════════════════════════════════════════════
export const Chip = ({ label, active, onPress, icon }: { label: string; active?: boolean; onPress: () => void; icon?: string }) => {
  const { colors: c } = useTheme();
  return (
    <TouchableOpacity
      style={[ch.chip, { backgroundColor: active ? c.primary : c.surface, borderColor: active ? c.primary : c.border }]}
      onPress={onPress} activeOpacity={0.75}>
      {icon ? <MaterialCommunityIcons name={icon as any} size={14} color={active ? c.onPrimary : c.textMuted} /> : null}
      <Text style={[ch.text, { color: active ? c.onPrimary : c.textSecondary }]}>{label}</Text>
    </TouchableOpacity>
  );
};
const ch = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 15, paddingVertical: 9, borderRadius: Radius.pill, marginRight: 8, borderWidth: 1 },
  text: { fontSize: 12.5, fontWeight: '700' },
});

// ═══ SEGMENTED TABS (pill-in-track) ═════════════════════════════════════════
export const SegmentedTabs = ({ tabs, value, onChange, style }: {
  tabs: { key: string; label: string }[]; value: string; onChange: (k: string) => void; style?: any;
}) => {
  const { colors: c } = useTheme();
  return (
    <View style={[seg.track, { backgroundColor: c.surface }, style]}>
      {tabs.map(t => {
        const on = t.key === value;
        return (
          <TouchableOpacity key={t.key} style={[seg.tab, on && { backgroundColor: c.card, ...Shadow.sm }]} onPress={() => onChange(t.key)} activeOpacity={0.8}>
            <Text style={[seg.label, { color: on ? c.primary : c.textMuted }]} numberOfLines={1}>{t.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};
const seg = StyleSheet.create({
  track: { flexDirection: 'row', borderRadius: Radius.md, padding: 4, gap: 3 },
  tab: { flex: 1, paddingVertical: 9, borderRadius: Radius.sm, alignItems: 'center' },
  label: { fontSize: 12, fontWeight: '800', letterSpacing: 0.1 },
});

// ═══ PILL / BADGE (status) ══════════════════════════════════════════════════
export const Pill = ({ label, tone = 'neutral', solid, style }: { label: string; tone?: Tone; solid?: boolean; style?: any }) => {
  const { colors: c } = useTheme();
  const t = useToneColor(tone);
  return (
    <View style={[pl.pill, { backgroundColor: solid ? t.fg : t.bg }, style]}>
      <Text style={[pl.text, { color: solid ? c.onPrimary : t.fg }]}>{label}</Text>
    </View>
  );
};
const pl = StyleSheet.create({
  pill: { paddingHorizontal: 9, paddingVertical: 3.5, borderRadius: Radius.pill, alignSelf: 'flex-start' },
  text: { fontSize: 11, fontWeight: '800', letterSpacing: 0.2 },
});

// ═══ STAT CARD ══════════════════════════════════════════════════════════════
export const StatCard = ({ icon, label, value, tone = 'primary', onPress, style }: {
  icon?: string; label: string; value: string; tone?: Tone; onPress?: () => void; style?: any;
}) => {
  const { colors: c } = useTheme();
  const t = useToneColor(tone);
  const Wrap: any = onPress ? TouchableOpacity : View;
  return (
    <Wrap activeOpacity={0.85} onPress={onPress} style={[sc.card, { backgroundColor: c.card, borderColor: c.borderLight }, Shadow.card, style]}>
      {icon ? (
        <View style={[sc.icon, { backgroundColor: t.bg }]}>
          <MaterialCommunityIcons name={icon as any} size={18} color={t.fg} />
        </View>
      ) : null}
      <Text style={[sc.value, { color: c.text }]} numberOfLines={1}>{value}</Text>
      <Text style={[sc.label, { color: c.textMuted }]} numberOfLines={1}>{label}</Text>
    </Wrap>
  );
};
const sc = StyleSheet.create({
  card: { flex: 1, minWidth: '44%', borderRadius: Radius.lg, padding: 14, borderWidth: StyleSheet.hairlineWidth },
  icon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  value: { fontSize: 19, fontWeight: '900', letterSpacing: -0.5 },
  label: { fontSize: 11.5, marginTop: 3, fontWeight: '600' },
});

// ═══ LIST ROW ═══════════════════════════════════════════════════════════════
export const ListRow = ({ icon, iconTone = 'primary', title, subtitle, right, onPress, onLongPress, danger, chevron = true, last }: {
  icon?: string; iconTone?: Tone; title: string; subtitle?: string; right?: React.ReactNode;
  onPress?: () => void; onLongPress?: () => void; danger?: boolean; chevron?: boolean; last?: boolean;
}) => {
  const { colors: c } = useTheme();
  const t = useToneColor(danger ? 'danger' : iconTone);
  return (
    <TouchableOpacity
      style={[lr.row, { borderBottomColor: c.divider, borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth }]}
      onPress={onPress} onLongPress={onLongPress} activeOpacity={onPress ? 0.6 : 1} disabled={!onPress && !onLongPress}>
      {icon ? (
        <View style={[lr.icon, { backgroundColor: t.bg }]}>
          <MaterialCommunityIcons name={icon as any} size={19} color={t.fg} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={[lr.title, { color: danger ? c.danger : c.text }]} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={[lr.sub, { color: c.textMuted }]} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {right}
      {chevron && onPress ? <MaterialCommunityIcons name="chevron-right" size={20} color={c.textLight} style={{ marginLeft: 4 }} /> : null}
    </TouchableOpacity>
  );
};
const lr = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, gap: 13 },
  icon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 14.5, fontWeight: '700' },
  sub: { fontSize: 12, marginTop: 2, lineHeight: 16 },
});

// ═══ SEARCH BAR ═════════════════════════════════════════════════════════════
export const SearchBar = ({ value, onChangeText, placeholder = 'Search…', style, autoFocus }: {
  value: string; onChangeText: (v: string) => void; placeholder?: string; style?: any; autoFocus?: boolean;
}) => {
  const { colors: c } = useTheme();
  return (
    <View style={[sb.wrap, { backgroundColor: c.surface, borderColor: c.border }, style]}>
      <MaterialCommunityIcons name="magnify" size={20} color={c.textMuted} />
      <TextInput
        style={[sb.input, { color: c.text }]}
        placeholder={placeholder}
        placeholderTextColor={c.textMuted}
        value={value}
        onChangeText={onChangeText}
        autoFocus={autoFocus}
        returnKeyType="search"
      />
      {value.length > 0 ? (
        <TouchableOpacity onPress={() => onChangeText('')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <MaterialCommunityIcons name="close-circle" size={18} color={c.textMuted} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
};
const sb = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: Radius.md, paddingHorizontal: 13, borderWidth: 1 },
  input: { flex: 1, paddingVertical: 12, fontSize: 14.5 },
});

// ═══ AVATAR ═════════════════════════════════════════════════════════════════
export const Avatar = ({ name, uri, size = 44, color }: { name?: string; uri?: string; size?: number; color?: string }) => {
  const { colors: c } = useTheme();
  const bg = (color || c.primary);
  const initials = (name || '?').trim().split(/\s+/).map(n => n[0]).join('').slice(0, 2).toUpperCase();
  if (uri) return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.surface }} />;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg + '1F', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: bg, fontWeight: '900', fontSize: size * 0.38 }}>{initials}</Text>
    </View>
  );
};

// ═══ FAB ════════════════════════════════════════════════════════════════════
export const FAB = ({ icon = 'plus', label, onPress }: { icon?: string; label?: string; onPress: () => void }) => {
  const { colors: c } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <TouchableOpacity
      onPress={onPress} activeOpacity={0.9}
      style={[fab.btn, { backgroundColor: c.primary, bottom: Math.max(insets.bottom, 14) + 8 }, Shadow.glow(c.primary), label ? { paddingHorizontal: 20 } : { width: 56 }]}>
      <MaterialCommunityIcons name={icon as any} size={24} color={c.onPrimary} />
      {label ? <Text style={[fab.label, { color: c.onPrimary }]}>{label}</Text> : null}
    </TouchableOpacity>
  );
};
const fab = StyleSheet.create({
  btn: { position: 'absolute', right: 18, height: 56, borderRadius: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  label: { fontWeight: '800', fontSize: 15 },
});

// ═══ SECTION LABEL / TITLE ══════════════════════════════════════════════════
export const SectionLabel = ({ children, style }: { children: React.ReactNode; style?: any }) => {
  const { colors: c } = useTheme();
  return <Text style={[sl.label, { color: c.textMuted }, style]}>{children}</Text>;
};
const sl = StyleSheet.create({
  label: { fontSize: 11.5, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.9, marginBottom: 10 },
});

export const SectionTitle = ({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) => {
  const { colors: c } = useTheme();
  return (
    <View style={sec.row}>
      <Text style={[sec.title, { color: c.text }]}>{title}</Text>
      {action && onAction ? <TouchableOpacity onPress={onAction}><Text style={[sec.action, { color: c.primary }]}>{action}</Text></TouchableOpacity> : null}
    </View>
  );
};
const sec = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, paddingHorizontal: 2 },
  title: { fontSize: 16.5, fontWeight: '800', letterSpacing: -0.3 },
  action: { fontSize: 13.5, fontWeight: '700' },
});

export const Divider = ({ style }: { style?: any }) => {
  const { colors: c } = useTheme();
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: c.divider }, style]} />;
};

// ═══ BOTTOM SHEET ═══════════════════════════════════════════════════════════
// The one keyboard-safe sheet for the app. Fields inside stay above the
// keyboard on both platforms (see useKeyboardInset), and an optional `footer`
// keeps the primary action pinned and visible while the body scrolls.
export const BottomSheet = ({ visible, onClose, title, children, footer, dismissable = true }: {
  visible: boolean; onClose: () => void; title: string; children: React.ReactNode;
  footer?: React.ReactNode; dismissable?: boolean;
}) => {
  const { colors: c } = useTheme();
  const insets = useSafeAreaInsets();
  const kb = useKeyboardInset(visible);
  const close = () => { if (dismissable) { Keyboard.dismiss(); onClose(); } };
  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent onRequestClose={close}>
      <View style={bs.overlay}>
        <TouchableOpacity style={[bs.backdrop, { backgroundColor: c.overlay }]} onPress={close} activeOpacity={1} accessibilityLabel="Close" />
        <View style={[bs.sheet, { backgroundColor: c.card, paddingBottom: kb > 0 ? kb + 8 : Math.max(insets.bottom, 20) }]}>
          <View style={bs.handleRow}><View style={[bs.handleBar, { backgroundColor: c.textLight }]} /></View>
          <View style={bs.header}>
            <Text style={[bs.title, { color: c.text }]} numberOfLines={2}>{title}</Text>
            {dismissable ? (
              <TouchableOpacity onPress={close} style={[bs.closeBtn, { backgroundColor: c.surface }]} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel="Close">
                <MaterialCommunityIcons name="close" size={20} color={c.textMuted} />
              </TouchableOpacity>
            ) : null}
          </View>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: footer ? 8 : 20 }}>
            {children}
          </ScrollView>
          {footer ? <View style={{ paddingTop: 10 }}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
};
const bs = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { flex: 1 },
  sheet: { borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 20, maxHeight: '88%' },
  handleRow: { alignItems: 'center', paddingTop: 10, paddingBottom: 4 },
  handleBar: { width: 40, height: 4, borderRadius: 2 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 },
  title: { flex: 1, fontSize: 19, fontWeight: '800', letterSpacing: -0.3, marginRight: 10 },
  closeBtn: { width: 34, height: 34, justifyContent: 'center', alignItems: 'center', borderRadius: 11 },
});

// Re-export EmptyState for convenience
export { EmptyState } from './EmptyState';
