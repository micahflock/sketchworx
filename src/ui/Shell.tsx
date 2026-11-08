import { useEffect, useRef, useState } from "preact/hooks";
import { CommandManager } from "./CommandManager";
import { useApp, useUi } from "./hooks";
import { PropertyManager, toolTitle } from "./PropertyManager";
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
  const selecting = ui.toolId === "select";
  const drawTool = app.drawToolId();
  return (
    <div class={css.touchKeys}>
      <div class={css.fingerMode} title="What one finger does. Two fingers always pan and zoom">
        <button class={selecting ? css.active : ""} onClick={() => app.setFingerMode("select")}>
          Select
        </button>
        <button class={selecting ? "" : css.active} title={toolTitle(drawTool)} onClick={() => app.setFingerMode("draw")}>
          Draw
        </button>
      </div>
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
