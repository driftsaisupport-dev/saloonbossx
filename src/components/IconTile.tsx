import React, { useMemo } from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Path, Rect, G, Ellipse } from 'react-native-svg';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';

/**
 * Dimensional icon tiles.
 *
 * Flat single-colour glyphs on a flat card read as unfinished at this screen
 * size. These tiles give each icon a physical body: a squircle plate lit from
 * above, a bright top bevel, a darker floor inside the bottom edge, and a
 * contact shadow on the surface below. The glyph sits on the lit face.
 *
 * Everything is drawn with react-native-svg — no raster assets, so the tiles
 * stay sharp on any density and add nothing to the bundle.
 */

export type Tone =
  | 'violet' | 'teal' | 'amber' | 'rose' | 'sky' | 'lime' | 'slate' | 'clay';

type ToneSpec = { top: string; bottom: string; bevel: string; floor: string; glyph: string };

const TONES: Record<Tone, ToneSpec> = {
  violet: { top: '#8B7CF6', bottom: '#5B4BD6', bevel: '#B6ACFB', floor: '#4635B8', glyph: '#FFFFFF' },
  teal:   { top: '#2DD4A7', bottom: '#12A17C', bevel: '#7CEBCD', floor: '#0B7C60', glyph: '#FFFFFF' },
  amber:  { top: '#FBB040', bottom: '#E08608', bevel: '#FDD489', floor: '#B76B04', glyph: '#FFFFFF' },
  rose:   { top: '#FB7185', bottom: '#DC3A55', bevel: '#FDA9B5', floor: '#B32742', glyph: '#FFFFFF' },
  sky:    { top: '#54A8F5', bottom: '#2176D4', bevel: '#9BCCFA', floor: '#175CAC', glyph: '#FFFFFF' },
  lime:   { top: '#8FCF3F', bottom: '#5FA018', bevel: '#BCE383', floor: '#4A7F0F', glyph: '#FFFFFF' },
  slate:  { top: '#94A3B8', bottom: '#5C6C81', bevel: '#C3CEDB', floor: '#475467', glyph: '#FFFFFF' },
  clay:   { top: '#E8927C', bottom: '#C4644C', bevel: '#F3BCAC', floor: '#A34E39', glyph: '#FFFFFF' },
};

/** Squircle path — a superellipse, softer than a rounded rect at these sizes. */
function squircle(size: number): string {
  const n = size;
  const k = n * 0.28;
  return (
    `M ${n / 2} 0 ` +
    `C ${n - k} 0 ${n} ${k} ${n} ${n / 2} ` +
    `C ${n} ${n - k} ${n - k} ${n} ${n / 2} ${n} ` +
    `C ${k} ${n} 0 ${n - k} 0 ${n / 2} ` +
    `C 0 ${k} ${k} 0 ${n / 2} 0 Z`
  );
}

export interface IconTileProps {
  name: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  tone?: Tone;
  /** Outer size of the tile in dp. */
  size?: number;
  /** Turn off the contact shadow when the tile sits on a busy surface. */
  grounded?: boolean;
  style?: ViewStyle;
}

export function IconTile({
  name,
  tone = 'violet',
  size = 44,
  grounded = true,
  style,
}: IconTileProps) {
  const t = TONES[tone];
  const path = useMemo(() => squircle(size), [size]);
  const glyphSize = Math.round(size * 0.48);
  const shadowH = Math.max(4, size * 0.13);
  const id = `${tone}-${size}`;

  return (
    <View style={[{ width: size, height: size + (grounded ? shadowH * 0.6 : 0) }, style]}>
      {grounded ? (
        <Svg
          width={size}
          height={shadowH * 2}
          style={{ position: 'absolute', bottom: 0, left: 0 }}
          pointerEvents="none"
        >
          <Ellipse
            cx={size / 2}
            cy={shadowH}
            rx={size * 0.36}
            ry={shadowH * 0.5}
            fill={t.floor}
            opacity={0.22}
          />
        </Svg>
      ) : null}

      <Svg width={size} height={size} style={{ position: 'absolute', top: 0, left: 0 }}>
        <Defs>
          <LinearGradient id={`face-${id}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={t.top} />
            <Stop offset="1" stopColor={t.bottom} />
          </LinearGradient>
          <LinearGradient id={`bevel-${id}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={t.bevel} stopOpacity="0.95" />
            <Stop offset="1" stopColor={t.bevel} stopOpacity="0" />
          </LinearGradient>
          <LinearGradient id={`floor-${id}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={t.floor} stopOpacity="0" />
            <Stop offset="1" stopColor={t.floor} stopOpacity="0.55" />
          </LinearGradient>
        </Defs>

        <Path d={path} fill={`url(#face-${id})`} />

        <G>
          <Rect
            x={size * 0.12}
            y={size * 0.04}
            width={size * 0.76}
            height={size * 0.3}
            rx={size * 0.14}
            fill={`url(#bevel-${id})`}
          />
          <Rect
            x={0}
            y={size * 0.58}
            width={size}
            height={size * 0.42}
            fill={`url(#floor-${id})`}
            opacity={0.85}
          />
        </G>

        <Path d={path} fill="none" stroke={t.bevel} strokeOpacity={0.4} strokeWidth={1} />
      </Svg>

      <View
        style={[
          StyleSheet.absoluteFill,
          { width: size, height: size, alignItems: 'center', justifyContent: 'center' },
        ]}
        pointerEvents="none"
      >
        <MaterialCommunityIcons name={name} size={glyphSize} color={t.glyph} />
      </View>
    </View>
  );
}

/**
 * Flat glyph for inline use — list chevrons, field affixes, button leading
 * icons. Tiles are for things that name a destination or a category; using one
 * inline makes every row shout.
 */
export function Glyph({
  name,
  size = 20,
  color,
  style,
}: {
  name: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  size?: number;
  color?: string;
  style?: ViewStyle;
}) {
  const { colors } = useTheme();
  return (
    <MaterialCommunityIcons
      name={name}
      size={size}
      color={color || colors.textSecondary}
      style={style}
    />
  );
}

/** Tone assignments so the same concept keeps the same colour app-wide. */
export const ICON_TONES: Record<string, Tone> = {
  billing: 'violet',
  clients: 'sky',
  calendar: 'amber',
  staff: 'teal',
  inventory: 'clay',
  reports: 'lime',
  academy: 'rose',
  settings: 'slate',
  memberships: 'violet',
  expenses: 'rose',
  gst: 'lime',
  backup: 'teal',
};
