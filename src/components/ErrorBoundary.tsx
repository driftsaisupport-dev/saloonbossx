import React, { Component } from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Text } from '../theme/Text';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CrashLog } from '../utils/crashLog';
import { contactSupport, SUPPORT_WHATSAPP, SUPPORT_EMAIL } from '../config/sales';

interface P { children: React.ReactNode; fallback?: React.ReactNode; where?: string; onBack?: () => void; compact?: boolean }
interface S { hasError: boolean; error: string; tries: number }

/**
 * Catches a crash in one screen (or the whole app) and offers a way out
 * instead of a white screen: try again, go back, or send a report.
 * Data lives in the database, so nothing is lost when a screen fails.
 */
export class ErrorBoundary extends Component<P, S> {
  state: S = { hasError: false, error: '', tries: 0 };

  static getDerivedStateFromError(e: Error): Partial<S> {
    return { hasError: true, error: e?.message || 'An unexpected error occurred.' };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    CrashLog.record({ message: error?.message, stack: `${error?.stack || ''}\n${info?.componentStack || ''}` }, this.props.where || 'screen').catch(() => {});
  }

  private reset = () => this.setState(s => ({ hasError: false, error: '', tries: s.tries + 1 }));

  private send = async () => {
    const r = await CrashLog.report();
    await contactSupport(`Hi, SaloonBossX showed an error:\n${r}`);
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback;
    const canSend = !!(SUPPORT_WHATSAPP || SUPPORT_EMAIL);
    return (
      <View style={[s.container, this.props.compact && { backgroundColor: 'transparent' }]}>
        <View style={s.iconBox}>
          <MaterialCommunityIcons name="lifebuoy" size={44} color="#D9A441" />
        </View>
        <Text style={s.title}>This screen hit a problem</Text>
        <Text style={s.safe}>✅ Your bills and customers are safe.</Text>
        <Text style={s.message} numberOfLines={3}>{this.state.error}</Text>
        <TouchableOpacity style={s.btn} onPress={this.reset}>
          <Text style={s.btnText}>Try again</Text>
        </TouchableOpacity>
        {this.props.onBack && (
          <TouchableOpacity style={s.btn2} onPress={() => { this.reset(); this.props.onBack!(); }}>
            <Text style={s.btn2Text}>Go back</Text>
          </TouchableOpacity>
        )}
        {canSend && (
          <TouchableOpacity style={s.link} onPress={this.send}>
            <Text style={s.linkText}>Send error report to support</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }
}

const s = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, backgroundColor: '#0E0B09' },
  iconBox: { width: 80, height: 80, borderRadius: 26, backgroundColor: '#2A2214', justifyContent: 'center', alignItems: 'center', marginBottom: 18 },
  title: { fontSize: 21, fontWeight: '800', color: '#F5EFE9', marginBottom: 6, letterSpacing: -0.3, textAlign: 'center' },
  safe: { fontSize: 14, color: '#7BD88F', fontWeight: '700', marginBottom: 10 },
  message: { fontSize: 12.5, color: '#958A80', textAlign: 'center', marginBottom: 24, lineHeight: 19 },
  btn: { backgroundColor: '#A84F18', paddingHorizontal: 36, paddingVertical: 14, borderRadius: 14, minWidth: 200, alignItems: 'center' },
  btnText: { color: '#FFF', fontSize: 15.5, fontWeight: '800' },
  btn2: { marginTop: 10, borderWidth: 1.5, borderColor: '#A84F18', paddingHorizontal: 36, paddingVertical: 12, borderRadius: 14, minWidth: 200, alignItems: 'center' },
  btn2Text: { color: '#F0954E', fontSize: 15, fontWeight: '800' },
  link: { marginTop: 18, padding: 6 },
  linkText: { color: '#958A80', fontSize: 13, textDecorationLine: 'underline' },
});
