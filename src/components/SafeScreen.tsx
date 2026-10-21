import React from 'react';
import { View, StyleSheet, Platform, KeyboardAvoidingView } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HeaderShownContext } from '@react-navigation/elements';
import { useTheme } from '../context/ThemeContext';

interface Props {
  children: React.ReactNode;
  /** Wrap content so fields stay visible when the keyboard opens. */
  keyboard?: boolean;
  /**
   * Set false on any screen rendered inside the tab navigator.
   *
   * The custom TabBar already reserves the bottom safe-area inset. If the
   * screen reserves it too, the inset is counted twice — which is why a
   * three-button-nav Android showed a large dead band above the tab bar while
   * a gesture-nav phone showed almost none. The tab bar owns the bottom.
   */
  bottomInset?: boolean;
  /** Skip the top inset when the screen renders its own full-bleed header. */
  topInset?: boolean;
}

export const SafeScreen = ({
  children,
  keyboard = false,
  bottomInset = true,
  topInset = true,
}: Props) => {
  const { colors: c, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  // Inside a stack screen that shows its own header, the header already sits
  // below the status bar. Adding the inset again left a blank band under the
  // title on every such screen (Expenses, Bill History, Staff…).
  const headerShown = React.useContext(HeaderShownContext);

  const paddingBottom = bottomInset
    ? Platform.OS === 'android'
      ? Math.max(insets.bottom, 12)
      : insets.bottom
    : 0;

  const body = (
    <View
      style={[
        s.container,
        {
          backgroundColor: c.bg,
          paddingTop: topInset && !headerShown ? insets.top : 0,
          paddingBottom,
        },
      ]}
    >
      <StatusBar style={isDark ? 'light' : 'dark'} />
      {children}
    </View>
  );

  if (!keyboard) return body;

  return (
    <KeyboardAvoidingView
      style={s.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      {body}
    </KeyboardAvoidingView>
  );
};

/**
 * Convenience wrapper for screens inside the tab navigator. Identical to
 * SafeScreen with the bottom inset handed back to the tab bar.
 */
export const TabScreen = (props: Omit<Props, 'bottomInset'>) => (
  <SafeScreen {...props} bottomInset={false} />
);

const s = StyleSheet.create({
  container: { flex: 1 },
});
