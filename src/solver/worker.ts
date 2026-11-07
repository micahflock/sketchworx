/// <reference lib="webworker" />
import wasmUrl from "@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm?url";
import { GcsCore } from "./gcs";
import type { WorkerRequest, WorkerResponse } from "./protocol";

const corePromise = GcsCore.create({ locateFile: () => wasmUrl });

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const core = await corePromise;
  const m = ev.data;
  let res: WorkerResponse;
  try {
    switch (m.type) {
      case "solve":
        res = { reqId: m.reqId, type: "solve", result: core.solve(m.params, m.constraints, m.drag) };
        break;
      case "dragStart":
        res = { reqId: m.reqId, type: "params", params: core.dragStart(m.params, m.constraints, m.targets) };
        break;
      case "dragMove":
        res = { reqId: m.reqId, type: "params", params: core.dragMove(m.targets) };
        break;
      case "dragEnd":
        core.dragEnd();
        return;
    }
  } catch (e) {
    res = { reqId: m.reqId, type: "error", message: String((e as Error)?.message ?? e) };
  }
  (self as unknown as Worker).postMessage(res);
};
