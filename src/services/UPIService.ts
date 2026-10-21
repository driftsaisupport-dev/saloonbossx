import * as Linking from 'expo-linking';

export const UPIService = {
  generateUPIString(p: { vpa: string; name: string; amount: number; note?: string; ref?: string }): string {
    return `upi://pay?pa=${encodeURIComponent(p.vpa)}&pn=${encodeURIComponent(p.name)}&am=${p.amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(p.note || 'Payment')}&tr=${p.ref || `SOS${Date.now()}`}`;
  },
  async pay(p: { vpa: string; name: string; amount: number; billNumber: string }): Promise<boolean> {
    try { const url = this.generateUPIString({ ...p, note: `Bill ${p.billNumber}`, ref: p.billNumber }); await Linking.openURL(url); return true; } catch { return false; }
  },
};
