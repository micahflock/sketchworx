import type { ThemeName } from "../render/theme";

/** What the user chose. "system" follows the operating system's light/dark setting. */
export type ThemePref = "light" | "dark" | "system";

const STORAGE_KEY = "sketchworx.theme";

export function loadThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* storage unavailable */
  }
  return "system";
}

export function saveThemePref(pref: ThemePref) {
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    /* storage unavailable */
  }
}

export function resolveTheme(pref: ThemePref, systemDark: boolean): ThemeName {
  if (pref === "system") return systemDark ? "dark" : "light";
  return pref;
}
