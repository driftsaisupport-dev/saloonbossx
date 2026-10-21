import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet, Image } from 'react-native';
import { Text } from '../theme/Text';

const SplashScreen = () => {
  const scale = useRef(new Animated.Value(0.6)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const textOp = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.spring(scale, { toValue: 1, friction: 5, tension: 40, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      ]),
      Animated.timing(textOp, { toValue: 1, duration: 400, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <View style={s.container}>
      <View style={s.glow1} />
      <View style={s.glow2} />
      <Animated.View style={{ transform: [{ scale }], opacity }}>
        <Image source={require('../../assets/logo.png')} style={s.logo} resizeMode="contain" />
      </Animated.View>
      <Animated.View style={[s.taglineRow, { opacity: textOp }]}>
        <Text style={s.tagline}>Manage • Grow • Shine</Text>
      </Animated.View>
      <Animated.View style={[s.loader, { opacity: textOp }]}>
        <View style={[s.dot, { backgroundColor: '#8A6A2A' }]} />
        <View style={[s.dot, { backgroundColor: '#D9A441' }]} />
        <View style={[s.dot, { backgroundColor: '#F0D08A' }]} />
      </Animated.View>
    </View>
  );
};

const s = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000000' },
  glow1: { position: 'absolute', width: 300, height: 300, borderRadius: 150, backgroundColor: '#A84F18', opacity: 0.10, top: '20%' },
  glow2: { position: 'absolute', width: 200, height: 200, borderRadius: 100, backgroundColor: '#9A7CFF', opacity: 0.06, bottom: '25%', right: '10%' },
  logo: { width: 220, height: 220 },
  taglineRow: { marginTop: 8 },
  tagline: { fontSize: 13, color: '#9A7CFF', letterSpacing: 3, fontWeight: '700' },
  loader: { flexDirection: 'row', gap: 8, position: 'absolute', bottom: 80 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});

export default SplashScreen;
