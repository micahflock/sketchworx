import type { Vec2 } from "../geom/vec";
import type { SnapOptions, SnapResult } from "../inference/snap";
import type { CommandFn } from "../model/editor";
import type { Doc, Id, Sketch } from "../model/types";
import type { Hit } from "../render/hit";
import type { Painter } from "../render/painter";
import type { View } from "../render/view";
import type { DragTarget } from "../solver/types";

export interface PEvent {
  world: Vec2;
  screen: Vec2;
  button: number;
  shift: boolean;
  /** Ctrl (or Cmd, or the latched on-screen Ctrl). */
  ctrl: boolean;
  alt: boolean;
  pointerType: string;
}

/** What tools may do. Tools never mutate the model directly; they emit commands. */
export interface ToolHost {
  readonly view: View;
  sketch(): Sketch;
  doc(): Doc;
  commit(label: string, fn: CommandFn): Doc;
  /** Snap tolerance in sketch units for the given pointer type. */
  tol(pointerType?: string): number;
  snap(raw: Vec2, opts?: Partial<SnapOptions>): SnapResult;
  hit(world: Vec2, pointerType?: string, opts?: { skip?: Set<Id>; points?: boolean; curves?: boolean }): Hit | null;
  /** Hit test non-geometry objects (dimensions, relation glyphs) at a screen position. */
  hitAnnotation(screen: Vec2): { id: Id; kind: "dimension" | "relation" } | null;
  selection(): Id[];
  select(ids: Id[]): void;
  setHover(id: Id | null): void;
  setPrompt(text: string): void;
  requestRender(): void;
  setTool(id: string): void;
  /** Auto-relations suppressed (Ctrl held). */
  suppress(): boolean;
  /** Drag geometry through the solver. */
  dragBegin(targets: DragTarget[]): void;
  dragUpdate(targets: DragTarget[]): void;
  dragEnd(commit: boolean, label?: string): void;
  /** Open the Modify box for a dimension. */
  openModify(dimId: Id, isNew: boolean): void;
  flash(text: string, kind?: "info" | "error"): void;
  /** Context toolbar near the cursor for the current selection. */
  showContextBar(screen: Vec2 | null): void;
}

export interface Tool {
  readonly id: string;
  readonly cursor?: string;
  activate?(): void;
  /** Called when switching away; abandon any in-progress state. */
  deactivate?(): void;
  onDown(e: PEvent): void;
  onMove(e: PEvent): void;
  onUp(e: PEvent): void;
  onDoubleClick?(e: PEvent): void;
  /** Return true when the key was consumed. */
  onKey?(e: KeyboardEvent): boolean;
  /** Esc. Return true if the tool consumed it (had state to cancel). */
  cancel(): boolean;
  draw?(p: Painter): void;
  /** Tool options for the PropertyManager. */
  options?(): ToolOption[];
}

export type ToolOption =
  | { kind: "check"; key: string; label: string; value: boolean; set(v: boolean): void }
  | { kind: "number"; key: string; label: string; value: number; set(v: number): void }
  | { kind: "choice"; key: string; label: string; value: string; choices: { value: string; label: string }[]; set(v: string): void }
  | { kind: "info"; key: string; label: string };
