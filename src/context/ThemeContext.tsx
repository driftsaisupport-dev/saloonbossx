import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useColorScheme } from 'react-native';
import { LightTheme, DarkTheme, ThemeColors } from '../theme/colors';
import { DatabaseService } from '../database/Database';

type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeContextType {
  colors: ThemeColors;
  isDark: boolean;
  mode: ThemeMode;
  toggleTheme: () => void;
  setTheme: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextType>({} as ThemeContextType);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const systemScheme = useColorScheme();
  const [mode, setMode] = useState<'light' | 'dark' | 'system'>('system');
  const isDark = mode === 'system' ? systemScheme === 'dark' : mode === 'dark';
  const colors = isDark ? DarkTheme : LightTheme;

  useEffect(() => {
    (async () => {
      try {
        const saved = await DatabaseService.getSetting('theme_mode');
        if (saved === 'light' || saved === 'dark' || saved === 'system') setMode(saved);
      } catch {}
    })();
  }, []);

  const toggleTheme = useCallback(() => {
    const next = isDark ? 'light' : 'dark';
    setMode(next);
    DatabaseService.setSetting('theme_mode', next).catch(() => {});
  }, [isDark]);

  const setTheme = useCallback((m: 'light' | 'dark' | 'system') => {
    setMode(m);
    DatabaseService.setSetting('theme_mode', m).catch(() => {});
  }, []);

  return (
    <ThemeContext.Provider value={{ colors, isDark, mode, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
