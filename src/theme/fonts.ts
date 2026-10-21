import { Platform } from 'react-native';
// Import each weight from its own subpath so Metro only bundles these 6 files,
// not the entire Inter family (all weights + italics ≈ 6 MB).
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { Inter_800ExtraBold } from '@expo-google-fonts/inter/800ExtraBold';
import { Inter_900Black } from '@expo-google-fonts/inter/900Black';

// Font map handed to expo-font's useFonts(). Bundling every weight as its own
// file is what makes headings look identical on iOS and Android — see
// src/theme/Text.tsx for the weight -> family mapping applied to every <Text>.
export const APP_FONTS = {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
  Inter_900Black,
};

export const AppFontFamily = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  extrabold: 'Inter_800ExtraBold',
  black: 'Inter_900Black',
  mono: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
};
