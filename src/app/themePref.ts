import type { ThemeName } from "../render/theme";

/** What the user chose. "system" follows the operating system's light/dark setting. "hell" needs unlocking. */
export type ThemePref = "light" | "dark" | "system" | "hell";

const STORAGE_KEY = "sketchworx.theme";
const HELL_KEY = "sketchworx.hell";

/** The dimension value that unlocks HELL MODE. */
export const HELL_NUMBER = 666;

export function isHellNumber(value: number): boolean {
  return Math.abs(value - HELL_NUMBER) < 1e-9;
}

export function isHellUnlocked(): boolean {
  try {
    return localStorage.getItem(HELL_KEY) === "1";
  } catch {
    return false;
  }
}

export function unlockHell() {
  try {
    localStorage.setItem(HELL_KEY, "1");
  } catch {
    /* storage unavailable: unlocked for this visit only */
  }
}

export function loadThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
    if (v === "hell" && isHellUnlocked()) return v;
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

/** The theme the toolbar toggle switches to: light → dark → (HELL MODE, once unlocked) → light. */
export function nextTheme(current: ThemeName, hellUnlocked: boolean): ThemeName {
  if (current === "light") return "dark";
  if (current === "dark" && hellUnlocked) return "hell";
  return "light";
}
