import { createContext } from "preact";
import { useContext, useEffect, useState } from "preact/hooks";
import type { App } from "../app/app";
import type { UiState } from "../app/store";

export const AppContext = createContext<App>(null as unknown as App);
export const useApp = () => useContext(AppContext);

/** Re-render when the store changes; returns the current state. */
export function useUi(): UiState {
  const app = useApp();
  const [, setV] = useState(0);
  useEffect(() => app.store.subscribe(() => setV(app.store.version)), [app]);
  return app.store.state;
}

/** Phone-sized screen (matches the max-width: 600px rules in ui.module.css). */
const PHONE_QUERY = "(max-width: 600px)";
export function usePhone(): boolean {
  const mq = typeof matchMedia === "function" ? matchMedia(PHONE_QUERY) : null;
  const [phone, setPhone] = useState(!!mq?.matches);
  useEffect(() => {
    if (!mq) return;
    const on = () => setPhone(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return phone;
}
