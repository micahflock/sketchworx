import { useEffect, useRef, useState } from "preact/hooks";
import { CommandManager } from "./CommandManager";
import { useApp, useUi } from "./hooks";
import { PropertyManager } from "./PropertyManager";
import { FeatureTree } from "./FeatureTree";
import { StatusBar } from "./StatusBar";
import { Overlays } from "./Overlays";
import css from "./ui.module.css";

export function Shell() {
  const app = useApp();
  const ui = useUi();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Phones: start with the PropertyManager collapsed so the canvas gets the screen.
  const [pmOpen, setPmOpen] = useState(() => typeof window === "undefined" || window.innerWidth >= 700);
  useEffect(() => {
    if (canvasRef.current) app.attach(canvasRef.current);
  }, [app]);
  return (
    <div class={css.shell}>
      <CommandManager />
      <div class={css.main}>
        <div class={`${css.pmWrap} ${pmOpen ? "" : css.pmClosed}`}>
          {pmOpen && (
            <div class={css.leftCol}>
              <FeatureTree />
              <PropertyManager />
            </div>
          )}
          <button class={css.pmToggle} title={pmOpen ? "Collapse PropertyManager" : "Show PropertyManager"} onClick={() => setPmOpen(!pmOpen)}>
            {pmOpen ? "◂" : "▸"}
          </button>
        </div>
        <div class={css.canvasWrap}>
          <canvas ref={canvasRef} class={css.canvas} style={{ touchAction: "none" }} />
          <Overlays />
          {ui.touchUi && <TouchKeys />}
        </div>
      </div>
      <StatusBar />
    </div>
  );
}

/** On-screen Esc / Ctrl / Undo for iPad without a keyboard. */
function TouchKeys() {
  const app = useApp();
  const ui = useUi();
  return (
    <div class={css.touchKeys}>
      <button
        class={ui.fingerDraws ? css.active : ""}
        title={ui.fingerDraws ? "One finger draws with the active tool (two fingers pan and zoom)" : "One finger pans (draw with Apple Pencil)"}
        onClick={() => app.setFingerDraws(!ui.fingerDraws)}
      >
        {ui.fingerDraws ? "Finger: Draw" : "Finger: Pan"}
      </button>
      <button onClick={() => app.escape()}>Esc</button>
      <button class={ui.touchCtrl ? css.active : ""} onClick={() => app.store.set({ touchCtrl: !ui.touchCtrl })}>
        Ctrl
      </button>
      <button onClick={() => app.undo()}>Undo</button>
      <button onClick={() => app.redo()}>Redo</button>
      <button onClick={() => app.deleteSelection()}>Delete</button>
    </div>
  );
}
