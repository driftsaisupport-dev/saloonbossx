const m = (globalThis.__sbxSecure ||= new Map());
export async function getItemAsync(k) { return m.has(k) ? m.get(k) : null; }
export async function setItemAsync(k, v) { m.set(k, v); }
export async function deleteItemAsync(k) { m.delete(k); }
