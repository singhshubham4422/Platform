import { useCallback, useEffect, useState } from 'react';
import type { LanguageId } from '@lplatform/language-config';

export interface EditorPreferences {
  fontSize: number;
  theme: 'light' | 'dark';
  autoSave: boolean;
  formatOnSave: boolean;
  minimap: boolean;
  wordWrap: boolean;
  defaultLanguage: LanguageId | null;
}

const KEY = 'lp_editor_prefs_v1';
export const DEFAULT_PREFS: EditorPreferences = {
  fontSize: 14,
  theme: 'light',
  autoSave: true,
  formatOnSave: false,
  minimap: false,
  wordWrap: false,
  defaultLanguage: null,
};

export function loadPreferences(): EditorPreferences {
  try {
    return { ...DEFAULT_PREFS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<EditorPreferences>) };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function applyTheme(theme: 'light' | 'dark'): void {
  document.documentElement.dataset.theme = theme;
}

/** Shared, persisted editor/app preferences (synchronised across components via a window event). */
export function useEditorPreferences() {
  const [prefs, setState] = useState<EditorPreferences>(loadPreferences);
  useEffect(() => {
    const sync = () => setState(loadPreferences());
    window.addEventListener('lp-prefs-changed', sync);
    return () => window.removeEventListener('lp-prefs-changed', sync);
  }, []);
  const setPrefs = useCallback((patch: Partial<EditorPreferences>) => {
    const next = { ...loadPreferences(), ...patch };
    localStorage.setItem(KEY, JSON.stringify(next));
    if (patch.theme) applyTheme(patch.theme);
    setState(next);
    window.dispatchEvent(new Event('lp-prefs-changed'));
  }, []);
  return { prefs, setPrefs };
}
