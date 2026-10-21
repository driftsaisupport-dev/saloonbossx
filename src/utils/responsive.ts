import { useWindowDimensions, PixelRatio, Platform } from 'react-native';

/**
 * Layout scaling.
 *
 * Baseline is 375dp wide — a mid-size phone. Everything below that (small
 * Androids at 320dp are still common in India) scales down; large phones scale
 * up but are clamped so a 6.9" screen doesn't get cartoon-sized chrome.
 *
 * Never read Dimensions at module scope. Foldables, split screen and rotation
 * all change the value after import, and a captured constant goes stale.
 */

const BASE_WIDTH = 375;
const MIN_SCALE = 0.85;
const MAX_SCALE = 1.15;

export function useScale() {
  const { width, height, fontScale } = useWindowDimensions();
  const shortSide = Math.min(width, height);
  const raw = shortSide / BASE_WIDTH;
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, raw));

  return {
    width,
    height,
    scale,
    fontScale,

    /** Scale a layout dimension (padding, radius, icon box). */
    s: (n: number) => Math.round(n * scale),

    /**
     * Scale a font size, at half strength. Type should stay legible on a small
     * phone rather than shrink in proportion with the chrome around it.
     */
    f: (n: number) => Math.round(n * (1 + (scale - 1) * 0.5)),

    isSmall: shortSide < 350,
    isLarge: shortSide >= 414,
    isTablet: shortSide >= 600,
    isLandscape: width > height,

    /** True when the user has cranked system font size up. Tighten layouts. */
    isLargeText: fontScale > 1.15,
  };
}

/** Round to the nearest device pixel so hairlines don't blur. */
export function crisp(n: number): number {
  return PixelRatio.roundToNearestPixel(n);
}

export const hairline = Platform.select({ ios: 0.5, default: 0.6 }) as number;
