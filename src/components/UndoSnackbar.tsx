/**
 * UndoSnackbar — a short bottom toast with an "Undo" action.
 *
 *   const undo = useUndoSnackbar();
 *   ...
 *   await markDone(id);
 *   undo.show('Marked as done', async () => { await setStatus(id, prev); reload(); });
 *   ...
 *   return <View style={{ flex: 1 }}>{...}{undo.element}</View>;
 *
 * Auto-hides after `durationMs` (default 5 s). Showing a new message replaces
 * the old one (the old undo is simply no longer offered).
 */
import React from 'react';
import { Animated, TouchableOpacity, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from '../theme/Text';
import { useTheme } from '../context/ThemeContext';
import { useTr } from '../i18n/tr';
import { showError } from './formUtils';

export function useUndoSnackbar(opts: { durationMs?: number; bottomOffset?: number } = {}) {
  const { colors: c } = useTheme();
  const tr = useTr();
  const insets = useSafeAreaInsets();
  const [state, setState] = React.useState<{ msg: string; undo?: () => Promise<void> | void; key: number } | null>(null);
  const anim = React.useRef(new Animated.Value(0)).current;
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [undoing, setUndoing] = React.useState(false);

  const hide = React.useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    // Only clear when the fade-out really finished: a show() that interrupts it
    // stops this animation (finished = false) and must keep its new message.
    Animated.timing(anim, { toValue: 0, duration: 160, useNativeDriver: true }).start(({ finished }) => { if (finished) setState(null); });
  }, [anim]);

  const show = React.useCallback((msg: string, undo?: () => Promise<void> | void) => {
    if (timer.current) clearTimeout(timer.current);
    setState({ msg, undo, key: Date.now() });
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    timer.current = setTimeout(hide, opts.durationMs ?? 5000);
  }, [anim, hide, opts.durationMs]);

  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const element = state ? (
    <Animated.View
      pointerEvents="box-none"
      style={[sn.wrap, {
        bottom: (opts.bottomOffset ?? 16) + Math.max(insets.bottom, 0),
        opacity: anim,
        transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [30, 0] }) }],
      }]}>
      <View style={[sn.bar, { backgroundColor: c.text }]}>
        <MaterialCommunityIcons name="check-circle" size={18} color={c.bg} />
        <Text style={[sn.msg, { color: c.bg }]} numberOfLines={2}>{state.msg}</Text>
        {state.undo ? (
          <TouchableOpacity disabled={undoing} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            onPress={async () => {
              const u = state.undo; if (!u) return;
              setUndoing(true);
              try { await u(); hide(); } catch (e) { showError(e, 'Could not undo'); } finally { setUndoing(false); }
            }}>
            <Text style={[sn.undo, { color: c.primaryLight }]}>{undoing ? '…' : tr('UNDO')}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </Animated.View>
  ) : null;

  return { show, hide, element };
}

const sn = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, zIndex: 50, elevation: 12 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 13 },
  msg: { flex: 1, fontSize: 14, fontWeight: '700' },
  undo: { fontSize: 14, fontWeight: '900', letterSpacing: 0.6 },
});
