import { createContext } from 'react';

/**
 * Lets deep screens (e.g. Settings) drive the top-level app shell state that
 * lives in App.tsx — for example sending the user back to the activation
 * screen after they remove their license from this device.
 */
export interface AppShellContextType {
  resetToActivation: () => void;
  /** Re-run the boot checks (onboarding → licence → app). Used after "start fresh". */
  restart: () => void;
}

export const AppShellContext = createContext<AppShellContextType>({
  resetToActivation: () => {},
  restart: () => {},
});
