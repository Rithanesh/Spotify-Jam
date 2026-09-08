'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { apiFetch } from '../lib/api';

type ThemeMode = 'light' | 'dark' | 'custom';

interface ThemeContextValue {
  mode: 'light' | 'dark';
  accent: string;
  setMode: (m: 'light' | 'dark') => void;
  setAccent: (hex: string) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'spotify-jam-theme';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<'light' | 'dark'>('dark');
  const [accent, setAccentState] = useState('#7C5CFF');
  const [loaded, setLoaded] = useState(false);

  // Load: local first (instant, no flash), then reconcile with the
  // backend's app-wide default in case another device changed it.
  useEffect(() => {
    const local = localStorage.getItem(STORAGE_KEY);
    if (local) {
      try {
        const parsed = JSON.parse(local);
        if (parsed.mode === 'light' || parsed.mode === 'dark') {
          setModeState(parsed.mode);
        }
        if (parsed.accent) {
          setAccentState(parsed.accent);
        }
      } catch {}
    }
    setLoaded(true);

    apiFetch('/api/settings')
      .then((s) => {
        if (s?.theme_mode) {
          const m = s.theme_mode === 'light' ? 'light' : 'dark';
          setModeState(m);
        }
        if (s?.theme_accent) setAccentState(s.theme_accent);
      })
      .catch(() => {}); // offline/first-run — local default is fine
  }, []);

  useEffect(() => {
    if (!loaded) return;
    document.documentElement.setAttribute('data-theme', mode);
    // Always apply the user-chosen accent color to the document root,
    // whether the user is in light theme or dark theme!
    if (accent) {
      document.documentElement.style.setProperty('--accent', accent);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode, accent }));
  }, [mode, accent, loaded]);

  const setMode = (m: 'light' | 'dark') => {
    setModeState(m);
    apiFetch('/api/settings/theme', { method: 'PATCH', body: JSON.stringify({ mode: m, accent }) }).catch(() => {});
  };

  const setAccent = (hex: string) => {
    setAccentState(hex);
    // Keep current mode (light or dark) — DO NOT switch to dark or custom mode!
    apiFetch('/api/settings/theme', { method: 'PATCH', body: JSON.stringify({ mode, accent: hex }) }).catch(() => {});
  };

  return (
    <ThemeContext.Provider value={{ mode, accent, setMode, setAccent }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
