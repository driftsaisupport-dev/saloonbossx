/**
 * Tiny in-process event bus so screens can tell each other "data changed"
 * without reloading everything on every focus.
 *
 *   appEvents.emit('bill:created');
 *   useEffect(() => appEvents.on('bill:created', () => markStale()), []);
 */
type Evt = 'bill:created' | 'bill:voided' | 'appointment:changed' | 'client:changed' | 'inventory:changed' | 'expense:changed' | 'data:restored';
type Fn = (payload?: any) => void;

const listeners: Record<string, Set<Fn>> = {};

export const appEvents = {
  on(evt: Evt, fn: Fn): () => void {
    (listeners[evt] ||= new Set()).add(fn);
    return () => { listeners[evt]?.delete(fn); };
  },
  emit(evt: Evt, payload?: any) {
    listeners[evt]?.forEach(fn => { try { fn(payload); } catch { /* listener errors never break the emitter */ } });
  },
};
