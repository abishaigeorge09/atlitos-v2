import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * Whether the software keyboard is up. A composer pinned above the floating
 * nav bar needs this: with the keyboard down it pads for the bar, with the
 * keyboard up the bar is hidden behind the keyboard and the padding would
 * open a blank band between the input and the keys.
 *
 * iOS fires the `will` events before the keyboard animates, so the padding
 * change rides the same animation instead of jumping after it. Android has
 * only the `did` events.
 */
export function useKeyboardShown(): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () =>
      setShown(true),
    );
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () =>
      setShown(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return shown;
}
