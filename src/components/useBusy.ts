import { useCallback, useRef, useState } from 'react';
import { showError } from './formUtils';

/**
 * Busy flag + double-tap guard + friendly error for any async action.
 *
 *   const [saving, runSave] = useBusy();
 *   <Button loading={saving} onPress={() => runSave(async () => { ... })} />
 *
 * A second tap while the first is still running is ignored (ref-based, so it
 * also blocks taps that land in the same frame before React re-renders).
 * Errors are caught and shown with `errorTitle`; the promise resolves to the
 * action's result, or undefined when it failed or was ignored.
 */
export function useBusy(errorTitle = 'Could not complete') {
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>, title?: string): Promise<T | undefined> => {
    if (inFlight.current) return undefined;
    inFlight.current = true;
    setBusy(true);
    try {
      return await fn();
    } catch (e) {
      showError(e, title || errorTitle);
      return undefined;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [errorTitle]);
  return [busy, run] as const;
}

/** Fire-and-forget wrapper for onPress handlers that are async. */
export function safeAsync(fn: () => Promise<any>, title = 'Could not complete') {
  return () => { fn().catch(e => showError(e, title)); };
}
