/** Pure helpers for importing customers (no React Native — unit-tested in Node). */

/** Minimal CSV reader: quoted fields, commas or semicolons, header row detection. */
export function parseCsv(text: string): { name: string; phone: string; dob: string }[] {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const sep = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',';
  const split = (l: string) => {
    const out: string[] = []; let cur = '', q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (ch === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (ch === sep && !q) { out.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  const head = split(lines[0]).map(h => h.toLowerCase());
  const hasHeader = head.some(h => /name|phone|mobile|contact|number/.test(h));
  const iName = hasHeader ? Math.max(0, head.findIndex(h => /name/.test(h))) : 0;
  const iPhone = hasHeader ? head.findIndex(h => /phone|mobile|contact|number|whatsapp/.test(h)) : 1;
  const iDob = hasHeader ? head.findIndex(h => /birth|dob|bday/.test(h)) : -1;
  return lines.slice(hasHeader ? 1 : 0).map(l => {
    const c = split(l);
    let dob = iDob >= 0 ? c[iDob] || '' : '';
    const m = dob.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);           // 25/12/1995 → 1995-12-25
    if (m) dob = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return { name: (c[iName] || '').trim(), phone: iPhone >= 0 ? c[iPhone] || '' : '', dob };
  }).filter(r => r.name);
}

