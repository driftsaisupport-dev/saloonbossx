import { useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, useWindowDimensions } from 'react-native';

/**
 * How many pixels the on-screen keyboard overlaps the bottom of a Modal.
 *
 * A React Native <Modal> is a separate Android window: depending on the
 * device / edge-to-edge mode it may or may not be resized when the keyboard
 * opens. We measure both the keyboard height and how much the window actually
 * shrank, and only return the part still covered — so a sheet never ends up
 * pushed up twice (big gap) or not at all (fields hidden).
 */
export function useKeyboardInset(active = true): number {
  const { height: winH } = useWindowDimensions();
  const baseH = useRef(winH);
  const [kb, setKb] = useState(0);

  useEffect(() => { if (kb === 0) baseH.current = winH; }, [winH, kb]);

  useEffect(() => {
    if (!active) { setKb(0); return; }
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const a = Keyboard.addListener(showEvt, e => setKb(Math.max(0, e?.endCoordinates?.height || 0)));
    const b = Keyboard.addListener(hideEvt, () => setKb(0));
    return () => { a.remove(); b.remove(); };
  }, [active]);

  if (!kb) return 0;
  const shrunk = Math.max(0, baseH.current - winH);
  return Math.max(0, kb - shrunk);
}
