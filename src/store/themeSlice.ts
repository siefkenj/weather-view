// Light/dark theme as a Redux slice. Initialised from localStorage (falling back
// to the OS preference). The DOM side effects — reflecting the choice on
// <html data-theme> and persisting it — live in useApplyTheme (see useTheme.ts),
// which runs once near the app root.

import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "wv-theme";

export function initialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // localStorage unavailable (private mode) — fall through to the media query.
  }
  try {
    return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

const themeSlice = createSlice({
  name: "theme",
  initialState: () => ({ theme: initialTheme() }),
  reducers: {
    setTheme(state, action: PayloadAction<Theme>) {
      state.theme = action.payload;
    },
    toggleTheme(state) {
      state.theme = state.theme === "dark" ? "light" : "dark";
    },
  },
});

export const { setTheme, toggleTheme } = themeSlice.actions;
export const themeReducer = themeSlice.reducer;
