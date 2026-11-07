import { init_planegcs_module, GcsWrapper } from "@salusoft89/planegcs";
const mod = await init_planegcs_module();
const g = new GcsWrapper(new mod.GcsSystem(), mod);
g.debug_mode = 0;
const pt = (id, x, y) => ({ id, type: "point", x, y, fixed: false });
g.push_sketch_param("t1", 0.3, false);
g.push_primitives_and_params([
  pt("c0", 0, 0), pt("c1", 50, 100), pt("c2", 150, 100), pt("c3", 200, 0), pt("p", 120, 20),
  { id: "b", type: "bspline", pole_ids: ["c0", "c1", "c2", "c3"], weights: [1, 1, 1, 1], knots: [0, 1], mult: [4, 4], degree: 3, periodic: false },
  { id: "side0", type: "line", p1_id: "c0", p2_id: "c1" },
  { id: "fx0", type: "coordinate_x", p_id: "c0", x: 0 }, { id: "fy0", type: "coordinate_y", p_id: "c0", y: 0 },
  { id: "h", type: "horizontal_l", l_id: "side0" },
  { id: "on", type: "point_on_bspline", p_id: "p", b_id: "b", pointparam: "t1" },
]);
const st = g.solve(); g.apply_solution();
const P = (id) => g.sketch_index.get_primitive(id);
const cps = ["c0", "c1", "c2", "c3"].map(P);
const t = g.get_sketch_param_value("t1");
const u = 1 - t;
const bx = u**3*cps[0].x + 3*u*u*t*cps[1].x + 3*u*t*t*cps[2].x + t**3*cps[3].x;
const by = u**3*cps[0].y + 3*u*u*t*cps[1].y + 3*u*t*t*cps[2].y + t**3*cps[3].y;
console.log("status", st, "t", t.toFixed(4), "p", P("p").x.toFixed(4), P("p").y.toFixed(4), "B(t)", bx.toFixed(4), by.toFixed(4), "c1", cps[1].x.toFixed(3), cps[1].y.toFixed(3));
