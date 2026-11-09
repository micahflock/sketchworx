import type { JSX } from "preact";

const S = (props: { children: JSX.Element | JSX.Element[] }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    {props.children}
  </svg>
);
const dot = (x: number, y: number) => <circle cx={x} cy={y} r="1.6" fill="currentColor" stroke="none" />;

export const icons: Record<string, () => JSX.Element> = {
  select: () => (
    <S>
      <path d="M6 3l12 9-5.5 1 3 6-2.4 1.2-3-6L6 17z" />
    </S>
  ),
  line: () => (
    <S>
      <path d="M4 19L20 5" />
      {dot(4, 19)}
      {dot(20, 5)}
    </S>
  ),
  centerline: () => (
    <S>
      <path d="M12 3v18" stroke-dasharray="5 2.5 0.5 2.5" />
    </S>
  ),
  midline: () => (
    <S>
      <path d="M4 19L20 5" />
      {dot(12, 12)}
    </S>
  ),
  rect: () => (
    <S>
      <rect x="4" y="6" width="16" height="12" />
      {dot(4, 18)}
      {dot(20, 6)}
    </S>
  ),
  rectCenter: () => (
    <S>
      <rect x="4" y="6" width="16" height="12" />
      {dot(12, 12)}
      {dot(20, 6)}
    </S>
  ),
  rect3: () => (
    <S>
      <path d="M3 14l7-9 11 7-7 9z" />
      {dot(3, 14)}
      {dot(10, 5)}
      {dot(21, 12)}
    </S>
  ),
  rect3Center: () => (
    <S>
      <path d="M3 14l7-9 11 7-7 9z" />
      {dot(12, 13)}
      {dot(3, 14)}
      {dot(10, 5)}
      {dot(21, 12)}
    </S>
  ),
  parallelogram: () => (
    <S>
      <path d="M7 6h14l-4 12H3z" />
    </S>
  ),
  circle: () => (
    <S>
      <circle cx="12" cy="12" r="8" />
      {dot(12, 12)}
      {dot(17.66, 6.34)}
    </S>
  ),
  circle3: () => (
    <S>
      <circle cx="12" cy="12" r="8" />
      {dot(4, 12)}
      {dot(17.6, 6.3)}
      {dot(17.6, 17.7)}
    </S>
  ),
  arc: () => (
    <S>
      <path d="M18 18A12 12 0 0 0 6 6" />
      {dot(6, 18)}
      {dot(18, 18)}
      {dot(6, 6)}
    </S>
  ),
  arc3: () => (
    <S>
      <path d="M18 20A14 14 0 0 0 4 6" />
      {dot(18, 20)}
      {dot(13.9, 10.1)}
      {dot(4, 6)}
    </S>
  ),
  tangentArc: () => (
    <S>
      <path d="M3 8h7a9 9 0 0 1 9 9" />
      {dot(10, 8)}
      {dot(19, 17)}
    </S>
  ),
  spline: () => (
    <S>
      <path d="M4 18C6 6 16 20 20 6" />
      <path d="M4 18L6 6 16 20 20 6" stroke-dasharray="2 2" stroke-width="1" />
    </S>
  ),
  point: () => (
    <S>
      <circle cx="12" cy="12" r="2.5" fill="currentColor" />
      <circle cx="12" cy="12" r="5" />
    </S>
  ),
  dimension: () => (
    <S>
      <path d="M4 7v10M20 7v10M4 12h16" />
      <path d="M7 10l-3 2 3 2M17 10l3 2-3 2" />
    </S>
  ),
  relations: () => (
    <S>
      <path d="M5 19L19 5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" style={{ fill: "var(--sw-glyph-bg)", stroke: "var(--sw-glyph-fg)" }} />
      <path d="M15 16.5h3" style={{ stroke: "var(--sw-glyph-fg)" }} />
    </S>
  ),
  addRelation: () => (
    <S>
      <path d="M3 11h12M3 16h12" />
      <path d="M19 3v6M16 6h6" />
    </S>
  ),
  variables: () => (
    <S>
      <path d="M17.5 5H6.5l5.5 7-5.5 7h11" />
    </S>
  ),
  trim: () => (
    <S>
      <circle cx="6.5" cy="6.5" r="2.7" />
      <circle cx="6.5" cy="17.5" r="2.7" />
      <path d="M8.7 8.2L20 18M8.7 15.8L20 6" />
    </S>
  ),
  extend: () => (
    <S>
      <path d="M3 12h6" />
      <path d="M12 12h1.2M16 12h1.2" />
      <path d="M20 4v16" />
    </S>
  ),
  fillet: () => (
    <S>
      <path d="M3 5h7.5" />
      <path d="M12.5 5a7 7 0 0 1 7 7" />
      <path d="M19.5 14v7" />
    </S>
  ),
  convert: () => (
    <S>
      <rect x="4" y="8" width="12" height="12" />
      <path d="M8 8V4h12v12h-4" stroke-dasharray="2.2 2.4" />
    </S>
  ),
  offset: () => (
    <S>
      <rect x="9" y="3" width="12" height="12" stroke-dasharray="2.2 2.4" />
      <path d="M5 7v12h12" />
    </S>
  ),
  mirror: () => (
    <S>
      <path d="M12 3v18" stroke-dasharray="4 2 1 2" />
      <path d="M9 6L4 16h5zM15 6l5 10h-5z" />
    </S>
  ),
  dynamicMirror: () => (
    <S>
      <path d="M12 3v18" stroke-dasharray="4 2 1 2" />
      <path d="M9 7L4 15M15 7l5 8" />
    </S>
  ),
  construction: () => (
    <S>
      <path d="M7 4v16" />
      <path d="M17 4.5v15" stroke-dasharray="2.4 2.8" />
    </S>
  ),
  fit: () => (
    <S>
      <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
      <rect x="8" y="8" width="8" height="8" />
    </S>
  ),
  undo: () => (
    <S>
      <path d="M9 7L4 12l5 5" />
      <path d="M4 12h10a6 6 0 0 1 0 12" />
    </S>
  ),
  redo: () => (
    <S>
      <path d="M15 7l5 5-5 5" />
      <path d="M20 12H10a6 6 0 0 0 0 12" />
    </S>
  ),
  open: () => (
    <S>
      <path d="M3 7h6l2 2h10v10H3z" />
    </S>
  ),
  save: () => (
    <S>
      <path d="M5 4h11l3 3v13H5z" />
      <path d="M8 4v5h8V4M8 20v-6h8v6" />
    </S>
  ),
  export: () => (
    <S>
      <path d="M12 4v11M8 8l4-4 4 4" />
      <path d="M5 14v6h14v-6" />
    </S>
  ),
  sketchView: () => (
    <S>
      <path d="M4 18L12 5l8 13z" />
    </S>
  ),
  artView: () => (
    <S>
      <path d="M4 18L12 5l8 13z" fill="currentColor" />
    </S>
  ),
  splitView: () => (
    <S>
      <rect x="3" y="5" width="18" height="14" />
      <path d="M12 5v14" />
    </S>
  ),
  picture: () => (
    <S>
      <rect x="3" y="5" width="18" height="14" rx="1" />
      <path d="M3 16l5-5 4 4 3-3 6 6" />
      <circle cx="16" cy="9" r="1.5" />
    </S>
  ),
  check: () => (
    <S>
      <path d="M5 12l5 5 9-10" stroke-width="2.2" />
    </S>
  ),
  combs: () => (
    <S>
      <path d="M3 19C7 9 17 9 21 19" />
      <path d="M5 14l-1-4M9 11.5l-.5-5M13 11l.5-5M17 12.5l1.5-4.5" stroke-width="1.1" />
    </S>
  ),
  keys: () => (
    <S>
      <rect x="3" y="7" width="18" height="11" rx="2" />
      <path d="M6 10h1M9 10h1M12 10h1M15 10h1M18 10h0M7 14h10" />
    </S>
  ),
  grid: () => (
    <S>
      {dot(6, 6)}
      {dot(12, 6)}
      {dot(18, 6)}
      {dot(6, 12)}
      {dot(12, 12)}
      {dot(18, 12)}
      {dot(6, 18)}
      {dot(12, 18)}
      {dot(18, 18)}
    </S>
  ),
  search: () => (
    <S>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5 5" />
    </S>
  ),
  sun: () => (
    <S>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </S>
  ),
  moon: () => (
    <S>
      <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z" />
    </S>
  ),
  hell: () => (
    <S>
      <path d="M12 21c-3.9 0-6.5-2.6-6.5-6.1 0-3.3 2.4-5.2 3.4-8.4 1.4 1.4 2 2.9 2 4.5 1.3-1 2.2-3 2-6 3.2 2.3 5.6 5.8 5.6 9.9 0 3.5-2.6 6.1-6.5 6.1z" />
      <path d="M12 21c-1.6 0-2.7-1.1-2.7-2.6 0-1.6 1.3-2.6 2.7-4.4 1.4 1.8 2.7 2.8 2.7 4.4 0 1.5-1.1 2.6-2.7 2.6z" />
    </S>
  ),
  newSketch: () => (
    <S>
      <path d="M11 17H3V3h14v8" stroke-dasharray="3 2.4" />
      <path d="M18 14v8M14 18h8" />
    </S>
  ),
};

export const Icon = ({ name }: { name: string }) => (icons[name] ?? icons.select)();
