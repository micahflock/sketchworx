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
