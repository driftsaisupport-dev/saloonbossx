import { localPrice } from '../config/regions';
/**
 * Demo salon — one tap fills the app with ~75 days of realistic data so an
 * owner sees a living business (reports, Boss AI, forecasts, dues, alerts)
 * instead of empty screens. "Start fresh" wipes it all again.
 *
 * Demo phone numbers start with 5, which no Indian mobile number does, so a
 * WhatsApp tapped during a demo can never reach a real person.
 */
import { DBX } from '../database/Database';
import { BossAI } from './ai/BossAI';
import { BusinessType, CATALOG, STAFF_SEED, COMBOS } from '../config/businessTypes';
import { toLocalDateStr } from '../utils/helpers';

const FIRST_F = ['Priya', 'Neha', 'Pooja', 'Anjali', 'Sneha', 'Kavya', 'Riya', 'Shreya', 'Divya', 'Meera', 'Aarti', 'Swati', 'Nisha', 'Komal', 'Simran', 'Tanvi', 'Isha', 'Ritu', 'Payal', 'Sakshi', 'Fatima', 'Zoya', 'Ayesha', 'Mary', 'Lakshmi', 'Deepa', 'Rashmi', 'Kirti', 'Mansi', 'Jyoti'];
const FIRST_M = ['Rahul', 'Amit', 'Rohan', 'Vikram', 'Arjun', 'Karan', 'Sahil', 'Imran', 'Aditya', 'Nikhil', 'Suresh', 'Manoj', 'Varun', 'Yash', 'Harsh', 'Faizan', 'Joseph', 'Prakash', 'Ankit', 'Deepak'];
const LAST = ['Sharma', 'Patil', 'Deshmukh', 'Iyer', 'Nair', 'Khan', 'Shaikh', 'Gupta', 'Joshi', 'Kulkarni', 'Reddy', 'Mehta', 'Singh', 'Verma', 'Pawar', 'Jadhav', 'Fernandes', 'Chopra', 'Rao', 'Bhosale'];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export interface DemoProgress { step: string; pct: number }

export const DemoDataService = {
  async isDemo(): Promise<boolean> { return (await DBX.getSetting('demo_mode')) === 'true'; },

  async load(type: BusinessType, onProgress?: (p: DemoProgress) => void): Promise<{ bills: number; clients: number }> {
    const r = rng(20261001);
    const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
    const P = (step: string, pct: number) => onProgress?.({ step, pct });

    P('Setting up services…', 2);
    const existingSvc = await DBX.getServices(false) as any[];
    if (!existingSvc.length) for (const s of CATALOG[type]) await DBX.addService({ ...s, price: localPrice(s.price) });
    const services = (await DBX.getServices()) as any[];

    P('Adding staff…', 6);
    let staff = (await DBX.getStaff()) as any[];
    if (staff.length < 2) {
      for (const s of STAFF_SEED[type]) await DBX.addStaff({ name: s.name, role: s.role, commission_rate: 10, salary: localPrice(12000 + Math.round(r() * 8) * 1000), salary_type: 'hybrid' });
      staff = (await DBX.getStaff()) as any[];
    }

    P('Adding clients…', 10);
    const female = type !== 'mens';
    const clientIds: number[] = [];
    const nClients = 85;
    for (let i = 0; i < nClients; i++) {
      const isF = type === 'mens' ? false : type === 'parlour' || type === 'bridal' || type === 'nails' ? true : r() < 0.6;
      const name = `${pick(isF ? FIRST_F : FIRST_M)} ${pick(LAST)}`;
      const month = 1 + Math.floor(r() * 12), day = 1 + Math.floor(r() * 28);
      const id = await DBX.addClient({
        name, phone: '5' + String(100000000 + Math.floor(r() * 899999999)), gender: isF ? 'Female' : 'Male',
        date_of_birth: r() < 0.5 ? `199${Math.floor(r() * 9)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : '',
        notes: 'Demo client', referral_source: pick(['Walk-in', 'Instagram', 'Friend', 'Google', 'Justdial']),
        created_at: `${toLocalDateStr(new Date(Date.now() - (75 + Math.floor(r() * 200)) * 86400000))} 11:00:00`,
      });
      clientIds.push(Number(id));
    }
    // A couple of birthdays today / this week so the briefing shows them.
    const today = new Date();
    for (let k = 0; k < 2; k++) {
      const d = new Date(today.getTime() + k * 2 * 86400000);
      await DBX.updateClient(clientIds[k], { date_of_birth: `1994-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` });
    }

    P('Adding stock…', 14);
    const products = [
      ['L’Oréal Shampoo 1L', 'Hair', 18, 4, 650, 0], ['Hair Spa Cream 500g', 'Hair', 3, 4, 480, 0], ['Wax (Rica) 800ml', 'Skin', 2, 3, 900, 0],
      ['Facial Kit (Gold)', 'Skin', 6, 3, 1200, 0], ['Hair Colour Tube', 'Hair', 24, 10, 260, 0], ['Disposable Towels (100)', 'General', 2, 5, 300, 0],
      ['Keratin Shampoo 250ml (Retail)', 'Retail', 9, 3, 450, 799], ['Serum 100ml (Retail)', 'Retail', 7, 3, 300, 549], ['Beard Oil 30ml (Retail)', 'Retail', 12, 3, 150, 299],
    ] as const;
    for (const [name, category, qty, min, cost, sell] of products) {
      await DBX.addInventoryItem({ name, category, quantity: qty, min_stock: min, cost_price: localPrice(cost), sell_price: sell ? localPrice(sell) : 0, unit: 'pcs', supplier: 'Demo Distributor',
        expiry_date: name.startsWith('Facial') ? toLocalDateStr(new Date(Date.now() + 18 * 86400000)) : '' });
    }

    // ── Bills ─────────────────────────────────────────────────────────────
    const DAYS = 75;
    const byName = (frag: string) => services.filter(s => s.name.toLowerCase().includes(frag.toLowerCase()));
    const comboFor = (svc: any): any | null => {
      for (const [a, b] of COMBOS) {
        if (svc.name.toLowerCase().includes(a.toLowerCase())) { const m = byName(b); if (m.length) return pick(m); }
      }
      return null;
    };
    const popular = [...services].sort((a, b) => a.price - b.price); // cheaper services sell more often
    const weighted = () => popular[Math.min(popular.length - 1, Math.floor(Math.pow(r(), 1.8) * popular.length))];
    const leaky = staff[staff.length - 1];      // one staff member gives too many discounts → AI alert demo
    const lastVisitOf = new Map<number, number>();
    let billCount = 0;
    const dueBillIds: number[] = [];

    for (let d = DAYS; d >= 0; d--) {
      const date = new Date(Date.now() - d * 86400000);
      const dow = date.getDay();
      const base = dow === 0 ? 16 : dow === 6 ? 14 : dow === 2 ? 5 : 9;
      const trend = 1 + (DAYS - d) / DAYS * 0.15;
      const n = d === 0 ? Math.min(6, Math.round(base * 0.5)) : d === 1 ? Math.round(base * trend * 1.25) : Math.max(2, Math.round(base * trend * (0.75 + r() * 0.5)));
      for (let k = 0; k < n; k++) {
        const hour = 10 + Math.floor(r() * 10), min = Math.floor(r() * 60);
        if (d === 0 && hour > new Date().getHours()) continue;
        const stamp = `${toLocalDateStr(date)} ${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`;
        const first = weighted();
        const items = [{ type: 'service', id: first.id, name: first.name, price: first.price, qty: 1 }];
        const combo = comboFor(first);
        if (combo && r() < 0.45) items.push({ type: 'service', id: combo.id, name: combo.name, price: combo.price, qty: 1 });
        if (r() < 0.15) { const x = weighted(); if (!items.some(i => i.id === x.id)) items.push({ type: 'service', id: x.id, name: x.name, price: x.price, qty: 1 }); }

        // 72 % of bills belong to a known client, who come back on a rhythm.
        let clientId = 0;
        if (r() < 0.72) {
          for (let tries = 0; tries < 6; tries++) {
            const cand = pick(clientIds);
            const last = lastVisitOf.get(cand);
            if (last === undefined || last - d >= 14) { clientId = cand; break; }
          }
        }
        const st = r() < 0.12 ? leaky : pick(staff);
        const subtotal = items.reduce((s, i) => s + i.price, 0);
        let discount = 0;
        if (st.id === leaky.id && r() < 0.55) discount = Math.round(subtotal * (0.15 + r() * 0.1));
        else if (r() < 0.08) discount = Math.round(subtotal * 0.1);
        const total = subtotal - discount;
        const roll = r();
        let method: string = roll < 0.56 ? 'upi' : roll < 0.9 ? 'cash' : roll < 0.97 ? 'card' : 'split';
        let split: any = {};
        if (method === 'split') split = { cash: Math.round(total / 2), upi: total - Math.round(total / 2) };
        if (clientId && d < 20 && r() < 0.04) { method = 'due'; split = { cash: r() < 0.5 ? Math.round(total * 0.4) : 0 }; }
        try {
          const res = await DBX.createBill({
            client_id: clientId, staff_id: st.id, items, subtotal, tax_amount: 0, discount_amount: discount, discount_type: 'flat',
            total, payment_method: method, payment_split: split, is_walkin: clientId ? 0 : 1, created_at: stamp,
          });
          billCount++;
          if (clientId) lastVisitOf.set(clientId, d);
          if (method === 'due') dueBillIds.push(res.billId);
        } catch { /* skip */ }
      }
      if (d % 8 === 0) P(`Creating bills… ${billCount}`, 16 + Math.round(((DAYS - d) / DAYS) * 64));
    }

    // Collect part of one due so the ledger has history.
    if (dueBillIds.length > 1) {
      const b: any = await DBX.getBill(dueBillIds[0]);
      if (b?.amount_due > 0) await DBX.collectDue(b.id, Math.round(b.amount_due / 2), 'upi', 'Demo part payment');
    }

    P('Cancelling a few bills (for the leakage demo)…', 82);
    const recent = (await DBX.getBills(toLocalDateStr(new Date(Date.now() - 20 * 86400000)))) as any[];
    // Spread over different days, and never yesterday/today, so the demo's
    // "yesterday" figure stays a normal day.
    const twoDaysAgo = toLocalDateStr(new Date(Date.now() - 2 * 86400000));
    const leakyBills = recent
      .filter(b => b.staff_id === leaky.id && b.payment_status === 'paid' && String(b.created_at).slice(0, 10) < twoDaysAgo)
      .filter((_, i) => i % 4 === 1).slice(0, 3);
    for (const b of leakyBills) { try { await DBX.voidBill(b.id, 'Wrong entry'); } catch {} }

    P('Bookings, expenses, attendance…', 86);
    const todayStr = toLocalDateStr();
    const tomorrow = toLocalDateStr(new Date(Date.now() + 86400000));
    const slots = ['11:00', '12:00', '13:30', '15:00', '16:30', '18:00'];
    for (const [day, list] of [[todayStr, slots.slice(2)], [tomorrow, slots]] as const) {
      for (const t of list) {
        const svc = weighted(), st = pick(staff);
        const [h, m] = t.split(':').map(Number);
        const end = `${String(h + Math.floor((m + svc.duration) / 60)).padStart(2, '0')}:${String((m + svc.duration) % 60).padStart(2, '0')}`;
        try {
          await DBX.addAppointment({ client_id: pick(clientIds), staff_id: st.id, service_ids: [svc.id], service_names: svc.name, date: day, start_time: t, end_time: end, total_amount: svc.price, allow_past: true });
        } catch { /* slot clash */ }
      }
    }

    for (let mBack = 2; mBack >= 0; mBack--) {
      const dt = new Date(today.getFullYear(), today.getMonth() - mBack, 1);
      const ds = (day: number) => toLocalDateStr(new Date(dt.getFullYear(), dt.getMonth(), Math.min(day, mBack === 0 ? today.getDate() : 28)));
      await DBX.addExpense({ category: 'Rent', amount: localPrice(25000), description: 'Shop rent', date: ds(1), payment_method: 'upi' });
      await DBX.addExpense({ category: 'Electricity', amount: localPrice(4200 + Math.round(r() * 1500)), description: 'Electricity bill', date: ds(8), payment_method: 'upi' });
      await DBX.addExpense({ category: 'Product Purchase', amount: localPrice(9000 + Math.round(r() * 5000)), description: 'Distributor', date: ds(5), payment_method: 'cash' });
      await DBX.addExpense({ category: 'Miscellaneous', amount: localPrice(600 + Math.round(r() * 400)), description: 'Tea & snacks', date: ds(3), payment_method: 'cash' });
    }

    for (let d = 1; d <= 26; d++) {
      const day = toLocalDateStr(new Date(Date.now() - d * 86400000));
      if (new Date(Date.now() - d * 86400000).getDay() === 2) continue;
      for (const s of staff) {
        const roll = r();
        if (roll < 0.06) await DBX.manualAttendance(s.id, day, '', '', 'absent');
        else if (roll < 0.12) await DBX.manualAttendance(s.id, day, '10:00', '14:30', 'half_day');
        else await DBX.manualAttendance(s.id, day, `${10 + (r() < 0.2 ? 1 : 0)}:0${Math.floor(r() * 5)}`, '20:30', 'present');
      }
    }

    P('Packages & targets…', 94);
    try {
      await DBX.addMembership({ name: 'Hair Spa × 5', price: localPrice(3500), duration_days: 180, max_sessions: 5, discount_percent: 0 });
      await DBX.addMembership({ name: 'Gold Membership (10% off for a year)', price: localPrice(1999), duration_days: 365, max_sessions: 0, discount_percent: 10 });
    } catch {}
    const monthRev = (await DBX.getPLSummary(toLocalDateStr(new Date(today.getFullYear(), today.getMonth() - 1, 1)), toLocalDateStr(new Date(today.getFullYear(), today.getMonth(), 0)))).revenue;
    if (monthRev > 0) await (DBX as any).setRevenueTarget(Math.round(monthRev * 1.12 / 1000) * 1000);
    await DBX.setSetting('reengage_days', '45');
    await DBX.recalculateClientStats();
    await DBX.setSetting('demo_mode', 'true');
    BossAI.invalidate();
    P('Done', 100);
    return { bills: billCount, clients: nClients };
  },

  /** Remove every business record (demo or not). Logins, licence and profile stay. */
  async clearAll(): Promise<void> {
    await DBX.wipeBusinessData();
    await DBX.setSetting('onboarding_complete', 'false');
    BossAI.invalidate();
  },
};
