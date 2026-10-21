/**
 * Invoices and receipts — one place for every printed / shared bill.
 *
 * BillingScreen and BillHistoryScreen each had their own copy of the HTML; the
 * history copy dropped GST split, discounts and the salon address, so a
 * reprinted bill did not match the original. Both now call here.
 *
 *  - buildInvoiceHTML   A4 tax invoice (PDF / share)
 *  - buildReceiptHTML   58 mm / 80 mm thermal receipt (Android print service,
 *                       e.g. RawBT or the printer maker's own print plugin)
 *  - upiQrSvg           "Scan to pay" UPI QR with the exact amount filled in
 */
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import qrcode from 'qrcode-generator';
import { escapeHtml as esc } from './sanitize';
import { formatDateTime } from './helpers';
import * as FileSystem from 'expo-file-system/legacy';
import { DatabaseService } from '../database/Database';
import { invoiceTaxBreakup, round2, toPaise } from './money';
import { getRegion, usesUpi, payLabel as walletLabel, taxName, taxIdLabel, splitsTax } from '../config/regions';

const halves = (): [string, string] => getRegion().tax.splitHalves || ['CGST', 'SGST'];

export interface Branding { logo: string; footer: string; review?: string }

/** Logo (as an embedded data URI — print engines cannot read app files) + custom footer. */
export async function loadBranding(profile: any): Promise<Branding> {
  let footer = '', show = 'true', review = '';
  try { [footer, show, review] = await Promise.all([DatabaseService.getSetting('invoice_footer'), DatabaseService.getSetting('invoice_logo'), DatabaseService.getSetting('google_review_url')]); } catch {}
  let logo = '';
  const uri = profile?.profile_image;
  if (uri && show !== 'false') {
    try {
      const b64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' as any });
      const type = /\.png$/i.test(uri) ? 'png' : 'jpeg';
      if (b64 && b64.length < 1_500_000) logo = `data:image/${type};base64,${b64}`;
    } catch { /* image moved or deleted */ }
  }
  return { logo, footer: String(footer || '').slice(0, 300), review: /^https:\/\//.test(review || '') ? String(review) : '' };
}

export type ReceiptWidth = 'a4' | '80' | '58';

const money = (n: number) => {
  const v = Number(n || 0);
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, '');
};

/**
 * What the printed document is called. Only a GST-registered salon (GSTIN on
 * file) charging GST issues a "Tax Invoice"; a registered salon billing without
 * GST issues a "Bill of Supply"; everyone else gets a plain "Bill".
 */
export function documentTitle(bill: any, profile: any): string {
  if (bill?.payment_status === 'credit_note') return 'Credit Note';
  const hasGstin = !!String(profile?.gst_number || '').trim();
  const hasTax = toPaise(bill?.tax_amount || 0) !== 0;
  if (hasGstin && hasTax) return 'Tax Invoice';
  if (hasGstin) return getRegion().code === 'IN' ? 'Bill of Supply' : 'Invoice';
  return getRegion().code === 'IN' ? 'Bill' : 'Receipt';
}

/**
 * What the "scan to pay" QR encodes. India: a UPI intent with the exact amount.
 * Elsewhere the owner saves a payment link (PayPal.me, Stripe/Square link,
 * Revolut, Tikkie…) or a wallet id (PIX key, PayNow UEN, M-Pesa till); links
 * that accept an amount get it appended, anything else is encoded as is.
 */
export function upiString(p: { vpa: string; name: string; amount: number; note?: string }): string {
  if (!usesUpi()) {
    const v = String(p.vpa || '').trim();
    const amt = Math.max(0, p.amount);
    if (/^https?:\/\/(www\.)?paypal\.me\/[^/?#]+\/?$/i.test(v) && amt > 0) return `${v.replace(/\/$/, '')}/${amt.toFixed(2)}${getRegion().currency}`;
    if (/^https?:\/\/(www\.)?revolut\.me\/[^/?#]+\/?$/i.test(v) && amt > 0) return `${v.replace(/\/$/, '')}?amount=${Math.round(amt * 100)}&currency=${getRegion().currency}`;
    return v;
  }
  return `upi://pay?pa=${encodeURIComponent(p.vpa)}&pn=${encodeURIComponent(p.name || 'Salon')}` +
    `&am=${Math.max(0, p.amount).toFixed(2)}&cu=INR&tn=${encodeURIComponent(p.note || 'Salon bill')}`;
}

/** SVG markup for a QR code. Returns '' if the text cannot be encoded. */
export function upiQrSvg(text: string, cell = 4): string {
  try {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag(cell, cell * 2);
  } catch { return ''; }
}

function statusStamp(bill: any): string {
  if (bill.payment_status === 'cancelled') return '<span class="stamp red">CANCELLED</span>';
  if (bill.payment_status === 'credit_note') return '<span class="stamp red">CREDIT NOTE</span>';
  if (bill.payment_status === 'due' && bill.amount_due > 0) return '<span class="stamp amber">PAYMENT DUE</span>';
  return '<span class="stamp green">✓ PAID</span>';
}

function payLabel(bill: any): string {
  const m = String(bill.payment_method || '').toLowerCase();
  const s = bill.payment_split || {};
  const keys = ['cash', 'upi', 'card', 'wallet', 'advance'];
  if (m === 'split' || Number(s.wallet) || Number(s.advance)) {
    const label = keys.filter(k => Math.abs(Number(s[k])) > 0).map(k => `${(k === 'upi' ? walletLabel() : k).toUpperCase()} ${money(Math.abs(Number(s[k])))}`).join(' + ');
    if (label) return m === 'due' ? `${label} + PAY LATER` : label;
    if (m === 'split') return 'SPLIT';
  }
  if (m === 'due') return 'PAY LATER';
  return (m === 'upi' ? walletLabel() : m).toUpperCase();
}

/**
 * The GST rate a bill was ACTUALLY charged at. Bills carry their own rate
 * (bills.tax_rate, back-filled for old bills), so a reprint after the salon
 * changes its rate still shows the original figure. Falls back to deriving it
 * from the bill's own amounts, and only then to the profile.
 */
export function billTaxRate(bill: any, profile?: any): number {
  const r = Number(bill?.tax_rate);
  if (Number.isFinite(r) && r > 0) return r;
  const tax = Math.abs(Number(bill?.tax_amount || 0));
  if (!tax) return 0;
  const br = invoiceTaxBreakup(bill);
  const taxable = Math.abs(br.taxable);
  if (taxable > 0) return Math.round((tax * 1000) / taxable) / 10;
  return parseFloat(profile?.tax_rate ?? 0) || 0;
}

const pct = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ''));

function itemType(i: any): string {
  if (i.package_cm_id) return 'Package';
  if (i.type === 'service') return 'Service';
  if (i.type === 'package') return 'Package sale';
  return 'Product';
}

export function buildInvoiceHTML(bill: any, profile: any, sym: string, brand: Branding = { logo: '', footer: '' }): string {
  const taxRate = billTaxRate(bill, profile);
  const br = invoiceTaxBreakup(bill);
  const inclusive = !!Number(bill.prices_include_gst || 0);
  const hasTax = toPaise(bill.tax_amount) !== 0;
  const rows = (bill.items || []).map((i: any) =>
    `<tr><td>${esc(i.name)}${i.note ? `<div class="info">${esc(i.note)}</div>` : ''}</td><td>${itemType(i)}</td><td>${i.qty || 1}</td>` +
    `<td>${sym}${money(i.price)}</td><td>${sym}${money(round2(i.price * (i.qty || 1)))}</td></tr>`
  ).join('');
  const nz = (v: any) => toPaise(v) !== 0;
  // v5.6 bills take loyalty off before GST, so it is printed above the tax rows.
  const loyaltyRow = nz(bill.loyalty_discount) ? `<tr><td>Loyalty discount</td><td style="text-align:right">-${sym}${money(Math.abs(bill.loyalty_discount))}</td></tr>` : '';
  const gstRows = !hasTax ? '' : (profile?.gst_number && splitsTax()
    ? `<tr><td>Taxable value</td><td style="text-align:right">${sym}${money(br.taxable)}</td></tr>
       <tr><td>${halves()[0]} @${pct(taxRate / 2)}%${inclusive ? ' (incl.)' : ''}</td><td style="text-align:right">${sym}${br.cgst.toFixed(2)}</td></tr>
       <tr><td>${halves()[1]} @${pct(taxRate / 2)}%${inclusive ? ' (incl.)' : ''}</td><td style="text-align:right">${sym}${br.sgst.toFixed(2)}</td></tr>`
    : `<tr><td>${taxName()} @${pct(taxRate)}%${inclusive ? ' (incl.)' : ''}</td><td style="text-align:right">${sym}${money(bill.tax_amount)}</td></tr>`);
  const due = Number(bill.amount_due || 0);
  const qr = due > 0 && profile?.upi_id
    ? upiQrSvg(upiString({ vpa: profile.upi_id, name: profile.name, amount: due, note: `Bill ${bill.bill_number}` }), 3)
    : '';

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    *{box-sizing:border-box}body{font-family:'Helvetica Neue',Arial,sans-serif;color:#1a1a2e;margin:0;padding:24px;font-size:13px}
    .header{display:flex;justify-content:space-between;border-bottom:2px solid #1a1a2e;padding-bottom:12px;margin-bottom:16px}
    .salon-name{font-size:22px;font-weight:900}.info{font-size:11px;color:#555;margin-top:2px}
    .badge{display:inline-block;background:#f0f4ff;border:1px solid #c7d2fe;padding:2px 8px;border-radius:4px;font-size:11px;margin-top:4px}
    table{width:100%;border-collapse:collapse;margin:12px 0}th,td{border:1px solid #e5e7eb;padding:8px;text-align:left}th{background:#f9fafb;font-size:12px}
    .totals{width:280px;margin-left:auto;border:none}.totals td{border:none;padding:4px 8px}
    .grand td{font-size:16px;font-weight:900;background:#1a1a2e;color:#fff;padding:10px 8px}
    .footer{text-align:center;margin-top:20px;font-size:11px;color:#888;border-top:1px solid #eee;padding-top:12px}
    .stamp{font-size:15px;font-weight:900;border:2px solid;padding:3px 10px;border-radius:4px;display:inline-block}
    .green{color:#059669}.red{color:#DC2626}.amber{color:#D97706}
    .pay{display:flex;gap:16px;align-items:center;justify-content:flex-end;margin-top:10px}
  </style></head><body>
  <div class="header">
    <div style="display:flex;gap:12px;align-items:center">
      ${brand.logo ? `<img src="${brand.logo}" style="width:64px;height:64px;object-fit:cover;border-radius:12px"/>` : ''}
      <div>
      <div class="salon-name">${esc(profile?.name || 'Salon')}</div>
      <div class="info">${esc([profile?.address, profile?.city, profile?.state].filter(Boolean).join(', '))}</div>
      <div class="info">${profile?.phone ? `Ph: ${esc(profile.phone)}` : ''}${profile?.email ? ` &nbsp; ${esc(profile.email)}` : ''}</div>
      ${profile?.gst_number ? `<div class="badge">${esc(taxIdLabel())}: ${esc(profile.gst_number)}</div>` : ''}
      </div>
    </div>
    <div style="text-align:right">
      <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px">${esc(documentTitle(bill, profile))}</div>
      <div style="font-size:18px;font-weight:900">#${esc(bill.bill_number)}</div>
      <div class="info">${esc(formatDateTime(bill.created_at))}</div>
      <div style="margin-top:6px">${statusStamp(bill)}</div>
    </div>
  </div>
  <div style="display:flex;justify-content:space-between;margin-bottom:12px">
    <div><div style="font-weight:700">${esc(bill.client_name || 'Walk-in Customer')}</div><div class="info">${esc(bill.client_phone || '')}</div></div>
    <div style="text-align:right"><div class="info">Served by: ${esc(bill.staff_name || '—')}</div></div>
  </div>
  <table><thead><tr><th>Item</th><th>Type</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table>
  <table class="totals">
    <tr><td>Subtotal</td><td style="text-align:right">${sym}${money(bill.subtotal)}</td></tr>
    ${nz(bill.discount_amount) ? `<tr><td>Discount</td><td style="text-align:right">-${sym}${money(Math.abs(bill.discount_amount))}</td></tr>` : ''}
    ${br.loyaltyBeforeTax ? loyaltyRow : ''}
    ${gstRows}
    ${br.loyaltyBeforeTax ? '' : loyaltyRow}
    <tr class="grand"><td>TOTAL</td><td style="text-align:right">${sym}${money(bill.total)}</td></tr>
    ${inclusive && hasTax ? `<tr><td colspan="2" style="font-size:11px;color:#777;padding-top:6px">Prices inclusive of ${taxName()}</td></tr>` : ''}
    <tr><td colspan="2" style="font-size:11px;color:#777;padding-top:6px">Payment: ${esc(payLabel(bill))}</td></tr>
    ${due > 0 ? `<tr><td style="color:#D97706;font-weight:800">Balance due</td><td style="text-align:right;color:#D97706;font-weight:800">${sym}${money(due)}</td></tr>` : ''}
  </table>
  ${qr ? `<div class="pay"><div class="info" style="text-align:right">${usesUpi() ? 'Scan with any UPI app' : `Scan to pay by ${esc(walletLabel())}`}<br/>to pay ${sym}${money(due)}</div>${qr}</div>` : ''}
  ${bill.loyalty_points_earned > 0 ? `<p class="green" style="font-size:12px">+${bill.loyalty_points_earned} loyalty points earned</p>` : ''}
  ${bill.notes ? `<p class="info">Notes: ${esc(bill.notes)}</p>` : ''}
  ${brand.review ? `<div style="display:flex;align-items:center;justify-content:center;gap:14px;margin-top:18px;padding:12px;border:1px dashed #d9a441;border-radius:12px"><div style="width:112px">${upiQrSvg(brand.review, 3)}</div><div style="font-size:13px"><b>⭐ Loved our service?</b><br/>Scan to rate us on Google —<br/>it takes 10 seconds. Thank you!</div></div>` : ''}
  <div class="footer">${brand.footer ? `${esc(brand.footer).replace(/\n/g, '<br/>')}<br/>` : `Thank you for visiting ${esc(profile?.name || 'us')}!<br/>`}
  ${profile?.upi_id ? `${esc(walletLabel())}: ${esc(profile.upi_id)} &nbsp;|&nbsp; ` : ''}Powered by SaloonBossX</div>
  </body></html>`;
}

/** Narrow receipt for 58 mm / 80 mm thermal printers. Plain, high-contrast, no colours. */
export function buildReceiptHTML(bill: any, profile: any, sym: string, width: '58' | '80' = '80', brand: Branding = { logo: '', footer: '' }): string {
  const mm = width === '58' ? 48 : 72; // printable width
  const fs = width === '58' ? 10 : 11.5;
  const line = (l: string, r: string, bold = false) =>
    `<div class="row${bold ? ' b' : ''}"><span>${l}</span><span>${r}</span></div>`;
  const items = (bill.items || []).map((i: any) =>
    `<div class="item">${esc(i.name)}${i.package_cm_id ? ' (package)' : ''}</div>` +
    line(`&nbsp;${i.qty || 1} x ${money(i.price)}`, `${money(round2(i.price * (i.qty || 1)))}`)
  ).join('');
  const taxRate = billTaxRate(bill, profile);
  const br = invoiceTaxBreakup(bill);
  const inclusive = !!Number(bill.prices_include_gst || 0);
  const due = Number(bill.amount_due || 0);
  const qr = profile?.upi_id && (due > 0 || bill.payment_method === 'upi')
    ? upiQrSvg(upiString({ vpa: profile.upi_id, name: profile.name, amount: due > 0 ? due : bill.total, note: `Bill ${bill.bill_number}` }), 2)
    : '';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    @page{size:${width}mm auto;margin:2mm}
    body{width:${mm}mm;margin:0 auto;font-family:monospace,Courier;font-size:${fs}px;color:#000}
    .c{text-align:center}.b{font-weight:bold}.big{font-size:${fs + 4}px;font-weight:bold}
    .row{display:flex;justify-content:space-between;gap:4px}.item{margin-top:3px}
    hr{border:none;border-top:1px dashed #000;margin:5px 0}
    svg{display:block;margin:4px auto}
  </style></head><body>
    ${brand.logo ? `<img src="${brand.logo}" style="display:block;margin:0 auto 4px;width:${width === '58' ? 28 : 36}mm;filter:grayscale(1)"/>` : ''}
    <div class="c big">${esc(profile?.name || 'Salon')}</div>
    ${profile?.address ? `<div class="c">${esc([profile.address, profile.city].filter(Boolean).join(', '))}</div>` : ''}
    ${profile?.phone ? `<div class="c">Ph: ${esc(profile.phone)}</div>` : ''}
    ${profile?.gst_number ? `<div class="c">${esc(taxIdLabel())}: ${esc(profile.gst_number)}</div>` : ''}
    <hr/>
    <div class="c b">${esc(documentTitle(bill, profile).toUpperCase())}</div>
    ${line('Bill', `#${esc(bill.bill_number)}`)}
    ${line('Date', esc(formatDateTime(bill.created_at)))}
    ${line('Client', esc(bill.client_name || 'Walk-in'))}
    ${bill.staff_name ? line('Staff', esc(bill.staff_name)) : ''}
    <hr/>${items}<hr/>
    ${line('Subtotal', money(bill.subtotal))}
    ${toPaise(bill.discount_amount) !== 0 ? line('Discount', `-${money(Math.abs(bill.discount_amount))}`) : ''}
    ${br.loyaltyBeforeTax && toPaise(bill.loyalty_discount) !== 0 ? line('Loyalty', `-${money(Math.abs(bill.loyalty_discount))}`) : ''}
    ${toPaise(bill.tax_amount) !== 0 ? (profile?.gst_number && splitsTax()
      ? line('Taxable', money(br.taxable)) + line(`${halves()[0]} ${pct(taxRate / 2)}%`, br.cgst.toFixed(2)) + line(`${halves()[1]} ${pct(taxRate / 2)}%`, br.sgst.toFixed(2))
      : line(`${taxName()} ${pct(taxRate)}%`, money(bill.tax_amount))) : ''}
    ${!br.loyaltyBeforeTax && toPaise(bill.loyalty_discount) !== 0 ? line('Loyalty', `-${money(Math.abs(bill.loyalty_discount))}`) : ''}
    ${line('TOTAL', `${sym}${money(bill.total)}`, true)}
    ${inclusive && toPaise(bill.tax_amount) !== 0 ? `<div class="c">Prices inclusive of ${taxName()}</div>` : ''}
    ${line('Paid by', esc(payLabel(bill)))}
    ${due > 0 ? line('BALANCE DUE', `${sym}${money(due)}`, true) : ''}
    ${qr ? `<hr/><div class="c">Scan to pay by ${esc(walletLabel())}</div>${qr}` : ''}
    ${brand.review ? `<hr/><div class="c b">Rate us on Google</div>${upiQrSvg(brand.review, 2)}<div class="c">Scan · takes 10 sec · Thank you!</div>` : ''}
    <hr/><div class="c">${brand.footer ? esc(brand.footer).replace(/\n/g, '<br/>') : 'Thank you! Visit again'}</div>
    <div class="c" style="font-size:${fs - 2}px">SaloonBossX</div>
  </body></html>`;
}

export async function shareInvoicePDF(bill: any, profile: any, sym: string): Promise<void> {
  const { uri } = await Print.printToFileAsync({ html: buildInvoiceHTML(bill, profile, sym, await loadBranding(profile)), base64: false });
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `Invoice ${bill.bill_number}`, UTI: 'com.adobe.pdf' });
}

/**
 * Print. A4 goes to the normal Android/iOS print dialog; 58/80 mm sends the
 * narrow receipt, which any thermal printer with an Android print service
 * (RawBT, or the vendor's plugin) accepts.
 */
export async function printBill(bill: any, profile: any, sym: string, width: ReceiptWidth = 'a4'): Promise<void> {
  const brand = await loadBranding(profile);
  const html = width === 'a4' ? buildInvoiceHTML(bill, profile, sym, brand) : buildReceiptHTML(bill, profile, sym, width, brand);
  await Print.printAsync({ html });
}
