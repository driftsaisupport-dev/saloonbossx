/** Parse saloonbossx:// setup links. Pure — unit-tested in Node. */

export function parseSetupLink(url: string): { kind: 'connect' | 'join'; value: string } | null {
  try {
    const m = String(url || '').match(/^saloonbossx:\/\/(connect|join)\?(.*)$/i);
    if (!m) return null;
    const params = new Map(m[2].split('&').map(kv => { const i = kv.indexOf('='); return [kv.slice(0, i), decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' '))] as [string, string]; }));
    const kind = m[1].toLowerCase() as 'connect' | 'join';
    const value = kind === 'connect' ? params.get('u') || '' : params.get('c') || '';
    if (kind === 'connect' && !/^https:\/\/script\.google(usercontent)?\.com\//.test(value)) return null;
    if (kind === 'join' && !value.startsWith('SBXJOIN1.')) return null;
    return { kind, value };
  } catch { return null; }
}

