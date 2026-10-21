/**
 * BottomModal — a full-height, keyboard-safe bottom sheet for callers that
 * draw their own header. Shares its keyboard handling with UI.BottomSheet
 * (useKeyboardInset), so both sheets behave identically: on Android a Modal is
 * its own window and may not be resized by the keyboard, on iOS it never is.
 * We shrink the sheet by exactly the part of the keyboard still covering it.
 */
import React from 'react';
import { Modal, View, TouchableWithoutFeedback, Keyboard, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { useKeyboardInset } from './useKeyboardInset';

interface Props {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  height?: string | number; // e.g. '80%' or 500
  disableDismissOnBackdrop?: boolean;
}

export function BottomModal({ visible, onClose, children, height, disableDismissOnBackdrop }: Props) {
  const { colors: c } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const kb = useKeyboardInset(visible);

  const wanted = typeof height === 'number'
    ? height
    : typeof height === 'string' && height.endsWith('%')
      ? (windowHeight * parseFloat(height)) / 100
      : windowHeight * 0.92;
  const sheetHeight = kb > 0 ? Math.max(240, Math.min(wanted, windowHeight - kb - Math.max(insets.top, 12))) : wanted;

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: c.overlay }}>
        {!disableDismissOnBackdrop ? (
          <TouchableWithoutFeedback onPress={() => { Keyboard.dismiss(); onClose(); }}>
            <View style={{ flex: 1 }} />
          </TouchableWithoutFeedback>
        ) : <View style={{ flex: 1 }} />}
        <View style={{
          backgroundColor: c.bg,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          height: sheetHeight,
          marginBottom: kb,
          paddingBottom: kb > 0 ? 0 : Math.max(insets.bottom, 16),
          overflow: 'hidden',
        }}>
          {children}
        </View>
      </View>
    </Modal>
  );
}
