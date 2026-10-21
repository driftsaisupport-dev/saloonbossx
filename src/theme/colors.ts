// ─────────────────────────────────────────────────────────────────────────────
// SaloonBossX design tokens — v5.6 "Copper" theme, matched to the copper-on-black
// logo: a burnished copper brand, warm paper background, warm near-black ink,
// whisper-soft shadows and generous radii. Text/background pairs are chosen for
// WCAG AA (≥4.5:1) in both modes. Every key from the previous palette is kept (screens are styled
// straight off these tokens) — only the values changed, plus a few additions.
// ─────────────────────────────────────────────────────────────────────────────

export const LightTheme = {
  bg: '#F7F4F1',
  bgSecondary: '#FFFFFF',
  card: '#FFFFFF',
  cardElevated: '#FFFFFF',
  surface: '#F2EDE8',
  surfaceHover: '#EAE3DC',

  text: '#1C1612',
  textSecondary: '#5C524A',
  textMuted: '#736860',
  textLight: '#ADA39A',

  primary: '#A84F18',
  primaryLight: '#FBEBDD',
  primaryDark: '#8A3F10',
  gradient1: '#A84F18',
  gradient2: '#D9782F',

  accent: '#0B8A63',
  accentLight: '#DFF3EC',

  success: '#087A4B',
  successLight: '#E2F4EA',
  warning: '#B45309',
  warningLight: '#FCEFDC',
  danger: '#C8283A',
  dangerLight: '#FCE8EA',
  info: '#2F6BD9',
  infoLight: '#E6EEFC',

  border: '#EAE3DC',
  borderLight: '#F3EEE9',
  divider: '#EEE8E2',

  tabBar: '#FFFFFF',
  tabBarBorder: '#EEE8E2',
  statusBar: 'dark-content' as const,

  shadow: '#3A2A1F',
  overlay: 'rgba(28,18,12,0.45)',

  // Dark "brand ink" surface used on hero / splash / activation panels.
  brandInk: '#0A0807',
  onPrimary: '#FFFFFF',

  tierBronze: '#C88A4B',
  tierSilver: '#98A2B2',
  tierGold: '#D69A1E',
  brandGold: '#E08A3C',
  brandGoldLight: '#F6C08A',
  tierPlatinum: '#8C7BD6',

  whatsapp: '#1F9E50',
  upi: '#5F259F',
};

export const DarkTheme = {
  bg: '#0E0B09',
  bgSecondary: '#16120F',
  card: '#1C1713',
  cardElevated: '#251F1A',
  surface: '#1A1511',
  surfaceHover: '#28211B',

  text: '#F5EFE9',
  textSecondary: '#BDB2A8',
  textMuted: '#958A80',
  textLight: '#6B6159',

  primary: '#F0954E',
  primaryLight: '#3A2414',
  primaryDark: '#C9702C',
  gradient1: '#F0954E',
  gradient2: '#F6B37A',

  accent: '#34D3A6',
  accentLight: '#10302A',

  success: '#34D399',
  successLight: '#0F2A22',
  warning: '#F5B454',
  warningLight: '#2C2210',
  danger: '#F47A80',
  dangerLight: '#2E1416',
  info: '#79A8FF',
  infoLight: '#121C2E',

  border: '#2E2620',
  borderLight: '#221C17',
  divider: '#28211B',

  tabBar: '#16120F',
  tabBarBorder: '#28211B',
  statusBar: 'light-content' as const,

  shadow: '#000000',
  overlay: 'rgba(0,0,0,0.66)',

  brandInk: '#0A0807',
  // Dark text on the light copper primary keeps buttons at ~8:1 contrast.
  onPrimary: '#1F1006',

  tierBronze: '#D4915C',
  tierSilver: '#A6B0C0',
  tierGold: '#FACC15',
  brandGold: '#F0954E',
  brandGoldLight: '#F6C08A',
  tierPlatinum: '#C4B5FD',

  whatsapp: '#25D366',
  upi: '#A78BFA',
};

export type ThemeColors = Omit<typeof LightTheme, 'statusBar'> & {
  statusBar: 'dark-content' | 'light-content';
};

export const Spacing = { xs: 4, sm: 8, md: 12, base: 16, lg: 20, xl: 24, xxl: 32, xxxl: 40, screen: 20 };
export const FontSize = { xs: 10, sm: 12, md: 14, base: 16, lg: 18, xl: 20, xxl: 24, xxxl: 28, hero: 32 };
export const Radius = { sm: 10, md: 14, lg: 18, xl: 22, xxl: 28, pill: 999 };

// Cross-platform elevation. iOS reads shadow*, Android reads elevation only — so
// we tune both. The new theme leans on very soft, wide, low-opacity shadows so
// cards read as "lifted paper" rather than boxed-in.
const shadow = (ios: { height: number; opacity: number; radius: number }, elevation: number) => ({
  shadowColor: '#2A1C12',
  shadowOffset: { width: 0, height: ios.height },
  shadowOpacity: ios.opacity,
  shadowRadius: ios.radius,
  elevation,
});

export const Shadow = {
  sm: shadow({ height: 2, opacity: 0.05, radius: 6 }, 1),
  md: shadow({ height: 6, opacity: 0.08, radius: 16 }, 4),
  lg: shadow({ height: 14, opacity: 0.13, radius: 30 }, 9),
  card: shadow({ height: 3, opacity: 0.06, radius: 12 }, 2),
  glow: (color: string) => ({
    shadowColor: color, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28, shadowRadius: 16, elevation: 6,
  }),
};
