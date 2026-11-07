import { render } from "preact";
import { App } from "./app/app";
import { AppContext } from "./ui/hooks";
import { Shell } from "./ui/Shell";
import "./ui/global.css";
import { letterOSample, slotSample } from "./io/samples";

const app = new App();
(window as any).sketchworx = app; // handy for debugging and Playwright tests
(window as any).sketchworxSamples = { slot: slotSample, o: letterOSample };

render(
  <AppContext.Provider value={app}>
    <Shell />
  </AppContext.Provider>,
  document.getElementById("app")!,
);

app.restoreAutosave();
