import type { Box, Vec2 } from "../geom/vec";

/** World is y-up (like SolidWorks); screen is y-down CSS pixels. */
export class View {
  cx = 0;
  cy = 0;
  /** CSS pixels per sketch unit. */
  scale = 1;
  width = 800;
  height = 600;
  dpr = 1;

  toScreen(p: Vec2): Vec2 {
    return { x: (p.x - this.cx) * this.scale + this.width / 2, y: this.height / 2 - (p.y - this.cy) * this.scale };
  }
  toWorld(s: Vec2): Vec2 {
    return { x: (s.x - this.width / 2) / this.scale + this.cx, y: (this.height / 2 - s.y) / this.scale + this.cy };
  }
  /** Convert a screen distance (CSS px) to sketch units. */
  px(n: number): number {
    return n / this.scale;
  }
  zoomAt(screen: Vec2, factor: number) {
    const before = this.toWorld(screen);
    this.scale = Math.min(1e5, Math.max(1e-4, this.scale * factor));
    const after = this.toWorld(screen);
    this.cx += before.x - after.x;
    this.cy += before.y - after.y;
  }
  panBy(dxScreen: number, dyScreen: number) {
    this.cx -= dxScreen / this.scale;
    this.cy += dyScreen / this.scale;
  }
  fit(b: Box, margin = 60) {
    const w = Math.max(b.maxX - b.minX, 1e-6);
    const h = Math.max(b.maxY - b.minY, 1e-6);
    this.cx = (b.minX + b.maxX) / 2;
    this.cy = (b.minY + b.maxY) / 2;
    const sx = (this.width - margin * 2) / w;
    const sy = (this.height - margin * 2) / h;
    this.scale = Math.max(1e-4, Math.min(sx, sy, 1e5));
  }
  visibleBox(): Box {
    const a = this.toWorld({ x: 0, y: this.height });
    const b = this.toWorld({ x: this.width, y: 0 });
    return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
  }
}
