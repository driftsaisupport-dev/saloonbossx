import React from 'react';
import {
  Text as RNText,
  TextInput as RNTextInput,
  StyleSheet,
  TextProps,
  TextInputProps,
  Platform,
} from 'react-native';
import { getLanguage, useLanguage } from '../i18n';

// fontWeight -> concrete bundled Inter file. Android's stock Roboto only ships
// 400/500/700, so '600'/'800'/'900' silently fall back and headings render
// thin/wrong. Mapping every weight to a real file makes iOS and Android match.
const WEIGHT_TO_FAMILY: Record<string, string> = {
  '100': 'Inter_400Regular',
  '200': 'Inter_400Regular',
  '300': 'Inter_400Regular',
  '400': 'Inter_400Regular',
  normal: 'Inter_400Regular',
  '500': 'Inter_500Medium',
  '600': 'Inter_600SemiBold',
  '700': 'Inter_700Bold',
  bold: 'Inter_700Bold',
  '800': 'Inter_800ExtraBold',
  '900': 'Inter_900Black',
};

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

// Inter covers Latin, Greek and Cyrillic. It has no Devanagari, Tamil, Telugu,
// Bengali, Gujarati or Kannada glyphs at all. Forcing it on those scripts left
// rendering to per-glyph OS fallback, which changes metrics mid-string and on
// some OEM ROMs produces tofu boxes. For non-Latin languages we hand type back
// to the system font, which every Indian device ships with full coverage for,
// and carry weight through fontWeight instead of a family name.
const NON_LATIN_LANGS = new Set(['hi', 'mr', 'ta', 'te', 'bn', 'gu', 'kn', 'pa', 'ml', 'or']);

function usesSystemFont(): boolean {
  try {
    return NON_LATIN_LANGS.has(getLanguage());
  } catch {
    return false;
  }
}

export function mapFontStyle(style: any): any {
  const flat = StyleSheet.flatten(style) || {};
  const fam = flat.fontFamily;

  if (fam === 'monospace' || fam === 'Menlo' || fam === MONO) return flat;
  if (fam && !fam.startsWith('Inter_')) return flat;

  if (usesSystemFont()) {
    // Keep the weight, drop the family. Roboto / SF handle Indic correctly and
    // stay metrically consistent across the whole string.
    const w = flat.fontWeight != null ? String(flat.fontWeight) : undefined;
    return {
      ...flat,
      fontFamily: undefined,
      fontWeight: w === '800' || w === '900' ? '700' : w,
    };
  }

  const weight = flat.fontWeight != null ? String(flat.fontWeight) : '400';
  return {
    ...flat,
    fontFamily: WEIGHT_TO_FAMILY[weight] || 'Inter_400Regular',
    fontWeight: undefined,
  };
}

/**
 * mapFontStyle flattens and rebuilds the style object on every render of
 * every Text — thousands of times on a long list. Cache the result per
 * (style identity, language): StyleSheet ids / stable objects hit the cache,
 * and a language switch naturally misses it. WeakMap so nothing leaks.
 */
const objCache = new WeakMap<object, Map<string, any>>();
const idCache = new Map<string, any>();
function cachedFontStyle(style: any): any {
  if (style == null || style === false) return mapFontStyle(style);
  const lang = (() => { try { return getLanguage(); } catch { return 'en'; } })();
  if (typeof style === 'number') {
    const k = `${style}|${lang}`;
    let v = idCache.get(k);
    if (v === undefined) { v = mapFontStyle(style); idCache.set(k, v); }
    return v;
  }
  if (typeof style === 'object') {
    // Inline literals are new objects each render: they just miss the cache
    // and are collected with the WeakMap entry. Stable objects hit it.
    let m = objCache.get(style);
    if (!m) { m = new Map(); objCache.set(style, m); }
    let v = m.get(lang);
    if (v === undefined) { v = mapFontStyle(style); m.set(lang, v); }
    return v;
  }
  return mapFontStyle(style);
}

export const Text = React.forwardRef<RNText, TextProps>((props, ref) => {
  const lang = useLanguage();
  // Inline style objects change identity each render; useMemo keyed on the
  // object still avoids recomputing when the parent re-renders with the same one.
  const style = React.useMemo(() => cachedFontStyle(props.style), [props.style, lang]);
  return (
    <RNText
      ref={ref}
      maxFontSizeMultiplier={1.3}
      {...props}
      style={style}
    />
  );
});
Text.displayName = 'Text';

export const TextInput = React.forwardRef<RNTextInput, TextInputProps>((props, ref) => {
  const lang = useLanguage();
  const style = React.useMemo(() => cachedFontStyle(props.style), [props.style, lang]);
  return (
    <RNTextInput
      ref={ref}
      maxFontSizeMultiplier={1.3}
      {...props}
      style={style}
    />
  );
});
TextInput.displayName = 'TextInput';
