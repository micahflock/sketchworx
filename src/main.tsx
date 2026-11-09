import { render } from "preact";
import { App } from "./app/app";
import { AppContext } from "./ui/hooks";
import { Shell } from "./ui/Shell";
import "./ui/fonts.css";
import "./ui/global.css";
import { ovalSample, slotSample } from "./io/samples";

const app = new App();
(window as any).sketchworx = app; // handy for debugging and Playwright tests
(window as any).sketchworxSamples = { slot: slotSample, oval: ovalSample };

render(
  <AppContext.Provider value={app}>
    <Shell />
  </AppContext.Provider>,
  document.getElementById("app")!,
);

app.restoreAutosave();

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((e) => console.warn("service worker registration failed", e));
  });
}
