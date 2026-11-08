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
      <path d="M4 19L20 5" stroke-dasharray="5 2 1 2" />
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
    </S>
  ),
  rectCenter: () => (
    <S>
      <rect x="4" y="6" width="16" height="12" />
      <path d="M4 6l16 12M20 6L4 18" stroke-dasharray="2 2" stroke-width="1" />
    </S>
  ),
  rect3: () => (
    <S>
      <path d="M3 14l7-9 11 7-7 9z" />
    </S>
  ),
  rect3Center: () => (
    <S>
      <path d="M3 14l7-9 11 7-7 9z" />
      {dot(12, 12)}
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
      <path d="M10.5 12h3M12 10.5v3" />
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
      <path d="M5 17A9 9 0 0 1 19 9" />
      <path d="M11 17h1M11.5 16.5v1" />
    </S>
  ),
  arc3: () => (
    <S>
      <path d="M4 18A10 10 0 0 1 20 18" />
      {dot(4, 18)}
      {dot(20, 18)}
      {dot(12, 8)}
    </S>
  ),
  tangentArc: () => (
    <S>
      <path d="M3 17h8a6 6 0 0 0 6-6V5" />
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
      <path d="M4 8h12M4 16h12" />
      <path d="M19 5v6M16 8h6" />
    </S>
  ),
  variables: () => (
    <S>
      <path d="M4 7h4M6 5v4M4 17h4M14 6l6 12M20 6l-6 12" />
    </S>
  ),
  trim: () => (
    <S>
      <path d="M4 12h6M14 12h6M12 4v16" />
      <path d="M8 6l8 12" stroke-dasharray="2 2" />
    </S>
  ),
  extend: () => (
    <S>
      <path d="M4 12h8" />
      <path d="M12 12h6" stroke-dasharray="2 2" />
      <path d="M19 4v16" />
    </S>
  ),
  fillet: () => (
    <S>
      <path d="M5 4v8a7 7 0 0 0 7 7h8" />
    </S>
  ),
  convert: () => (
    <S>
      <path d="M4 17c3-7 9-9 16-9" stroke-dasharray="3 2" />
      <path d="M4 20c3-7 9-9 16-9" />
      <path d="M15 4l3 4-4 2" />
    </S>
  ),
  offset: () => (
    <S>
      <path d="M4 18c4-10 12-10 16 0" />
      <path d="M4 12c4-8 12-8 16 0" stroke-dasharray="3 2" />
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
      <path d="M4 18L20 6" stroke-dasharray="6 2 1 2" />
      <path d="M14 18h6" />
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
      <path d="M5 12l5 5 9-10" />
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
  newSketch: () => (
    <S>
      <path d="M4 19l5-12 4 7 3-4 4 9z" />
      <path d="M18 3v6M15 6h6" />
    </S>
  ),
};

export const Icon = ({ name }: { name: string }) => (icons[name] ?? icons.select)();
