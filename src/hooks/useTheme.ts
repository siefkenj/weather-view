// App-wide light/dark theme, now backed by the Redux theme slice. `useTheme`
// reads/sets it; `useApplyTheme` (mounted once near the app root) reflects the
// choice on <html data-theme> and persists it to localStorage.

import { useEffect } from "react";
import { useAppDispatch, useAppSelector } from "../store";
import { setTheme as setThemeAction, toggleTheme, THEME_STORAGE_KEY } from "../store/themeSlice";
import type { Theme } from "../store/themeSlice";

export type { Theme } from "../store/themeSlice";

export function useTheme() {
  const theme = useAppSelector((s) => s.theme.theme);
  const dispatch = useAppDispatch();
  return {
    theme,
    setTheme: (t: Theme) => dispatch(setThemeAction(t)),
    toggle: () => dispatch(toggleTheme()),
  };
}

/** Reflect the theme on the document and persist it. Call once, near the root. */
export function useApplyTheme() {
  const theme = useAppSelector((s) => s.theme.theme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // ignore write failures (private mode)
    }
  }, [theme]);
}
