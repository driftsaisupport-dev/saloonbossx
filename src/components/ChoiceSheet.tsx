/**
 * ChoiceSheet — replaces Alert.alert with more than 3 buttons.
 *
 * Android's native AlertDialog shows at most three buttons; anything beyond
 * that (often "Cancel", "Camera" or "Present") silently disappears. This sheet
 * shows any number of choices as big, thumb-friendly rows.
 *
 *   <ChoiceSheet
 *     visible={!!pick} onClose={() => setPick(null)}
 *     title="Mark attendance" message="Ravi · 13 Oct"
 *     options={[
 *       { label: 'Present', icon: 'check-circle', tone: 'success', onPress: () => mark('present') },
 *       { label: 'Absent', icon: 'close-circle', tone: 'danger', onPress: () => mark('absent') },
 *     ]}
 *   />
 *
 * The sheet closes itself before running the chosen option's onPress, so the
 * handler can open another modal / picker safely.
 */
import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from '../theme/Text';
import { useTheme } from '../context/ThemeContext';
import { BottomSheet } from './UI';
import { useTr } from '../i18n/tr';

export type ChoiceTone = 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export interface ChoiceOption {
  label: string;
  /** Optional second line. */
  hint?: string;
  icon?: string;
  tone?: ChoiceTone;
  /** Shows a check mark (for "current value" pickers). */
  selected?: boolean;
  disabled?: boolean;
  onPress: () => void | Promise<void>;
}

export function ChoiceSheet({ visible, onClose, onCancel, title, message, options, cancelLabel = 'Cancel' }: {
  visible: boolean;
  onClose: () => void;
  /** Called when the sheet is dismissed WITHOUT picking an option (Cancel, back, backdrop). */
  onCancel?: () => void;
  title: string;
  message?: string;
  options: ChoiceOption[];
  cancelLabel?: string;
}) {
  const { colors: c } = useTheme();
  const tr = useTr();
  const toneColor = (t?: ChoiceTone) => {
    switch (t) {
      case 'success': return [c.success, c.successLight];
      case 'warning': return [c.warning, c.warningLight];
      case 'danger': return [c.danger, c.dangerLight];
      case 'info': return [c.info, c.infoLight];
      case 'neutral': return [c.textSecondary, c.surface];
      default: return [c.primary, c.primaryLight];
    }
  };

  const dismiss = () => { onClose(); onCancel?.(); };

  return (
    <BottomSheet visible={visible} onClose={dismiss} title={title}>
      {message ? <Text style={[s.msg, { color: c.textMuted }]}>{message}</Text> : null}
      {options.map((o, i) => {
        const [fg, bg] = toneColor(o.tone);
        return (
          <TouchableOpacity
            key={`${o.label}-${i}`}
            disabled={o.disabled}
            activeOpacity={0.7}
            accessibilityRole="button"
            onPress={() => { onClose(); setTimeout(() => { Promise.resolve(o.onPress()).catch(() => {}); }, 250); }}
            style={[s.row, { borderColor: o.selected ? fg : c.border, backgroundColor: o.selected ? bg : c.card, opacity: o.disabled ? 0.45 : 1 }]}>
            {o.icon ? (
              <View style={[s.icon, { backgroundColor: bg }]}>
                <MaterialCommunityIcons name={o.icon as any} size={20} color={fg} />
              </View>
            ) : null}
            <View style={{ flex: 1 }}>
              <Text style={[s.label, { color: o.tone === 'danger' ? c.danger : c.text }]}>{o.label}</Text>
              {o.hint ? <Text style={[s.hint, { color: c.textMuted }]}>{o.hint}</Text> : null}
            </View>
            {o.selected ? <MaterialCommunityIcons name="check-circle" size={20} color={fg} /> : null}
          </TouchableOpacity>
        );
      })}
      <TouchableOpacity onPress={dismiss} style={[s.cancel, { backgroundColor: c.surface }]} accessibilityRole="button">
        <Text style={{ color: c.textSecondary, fontWeight: '800', fontSize: 15 }}>{tr(cancelLabel)}</Text>
      </TouchableOpacity>
    </BottomSheet>
  );
}

/**
 * Hook form: `const choice = useChoiceSheet();` then
 * `choice.open({ title, options, onCancel? })` from any handler, and render
 * `{choice.element}` once in the screen.
 */
export function useChoiceSheet() {
  const [cfg, setCfg] = React.useState<{ title: string; message?: string; options: ChoiceOption[]; onCancel?: () => void } | null>(null);
  const element = (
    <ChoiceSheet
      visible={!!cfg}
      onClose={() => setCfg(null)}
      onCancel={cfg?.onCancel}
      title={cfg?.title || ''}
      message={cfg?.message}
      options={cfg?.options || []}
    />
  );
  return { open: setCfg, close: () => setCfg(null), element };
}

const s = StyleSheet.create({
  msg: { fontSize: 13.5, lineHeight: 19, marginBottom: 12, marginTop: -4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8, minHeight: 56 },
  icon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 15, fontWeight: '800' },
  hint: { fontSize: 12, marginTop: 2 },
  cancel: { alignItems: 'center', paddingVertical: 14, borderRadius: 14, marginTop: 6 },
});
