/**
 * Small expression language for dimensions and variables:
 * numbers, names, + - * / ( ), unary minus, min, max, sqrt, sin, cos (degrees).
 * Hand-written recursive descent; never uses eval.
 */

export type Expr =
  | { k: "num"; v: number }
  | { k: "var"; name: string }
  | { k: "neg"; a: Expr }
  | { k: "bin"; op: "+" | "-" | "*" | "/"; a: Expr; b: Expr }
  | { k: "call"; fn: string; args: Expr[] };

export class ExprError extends Error {}

const FUNCS: Record<string, { min: number; max: number; f: (...a: number[]) => number }> = {
  min: { min: 1, max: Infinity, f: (...a) => Math.min(...a) },
  max: { min: 1, max: Infinity, f: (...a) => Math.max(...a) },
  sqrt: { min: 1, max: 1, f: (a) => Math.sqrt(a) },
  sin: { min: 1, max: 1, f: (a) => Math.sin((a * Math.PI) / 180) },
  cos: { min: 1, max: 1, f: (a) => Math.cos((a * Math.PI) / 180) },
};

export const isIdent = (s: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(s) && !(s in FUNCS);

type Tok = { t: "num"; v: number } | { t: "id"; v: string } | { t: "op"; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw new ExprError(`Bad number at ${i + 1}`);
      out.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      out.push({ t: "id", v: m[0] });
      i += m[0].length;
      continue;
    }
    if ("+-*/(),".includes(c)) {
      out.push({ t: "op", v: c });
      i++;
      continue;
    }
    // Allow SolidWorks-style quoted names: "stem"
    if (c === '"') {
      const j = src.indexOf('"', i + 1);
      if (j < 0) throw new ExprError("Unclosed quote");
      const name = src.slice(i + 1, j).trim();
      if (!isIdent(name)) throw new ExprError(`Bad name "${name}"`);
      out.push({ t: "id", v: name });
      i = j + 1;
      continue;
    }
    throw new ExprError(`Unexpected "${c}"`);
  }
  return out;
}

export function parseExpr(src: string): Expr {
  const text = src.trim().replace(/^=/, "");
  if (!text) throw new ExprError("Empty");
  const toks = tokenize(text);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.t === "op" && peek()!.v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new ExprError(`Expected "${v}"`);
    p++;
  };
  function expr(): Expr {
    let a = term();
    while (isOp("+") || isOp("-")) {
      const op = toks[p++].v as "+" | "-";
      a = { k: "bin", op, a, b: term() };
    }
    return a;
  }
  function term(): Expr {
    let a = unary();
    while (isOp("*") || isOp("/")) {
      const op = toks[p++].v as "*" | "/";
      a = { k: "bin", op, a, b: unary() };
    }
    return a;
  }
  function unary(): Expr {
    if (isOp("-")) {
      p++;
      return { k: "neg", a: unary() };
    }
    if (isOp("+")) {
      p++;
      return unary();
    }
    return atom();
  }
  function atom(): Expr {
    const t = peek();
    if (!t) throw new ExprError("Unexpected end");
    if (t.t === "num") {
      p++;
      return { k: "num", v: t.v };
    }
    if (t.t === "id") {
      p++;
      if (isOp("(")) {
        p++;
        const fn = t.v.toLowerCase();
        if (!FUNCS[fn]) throw new ExprError(`Unknown function ${t.v}`);
        const args: Expr[] = [];
        if (!isOp(")")) {
          args.push(expr());
          while (isOp(",")) {
            p++;
            args.push(expr());
          }
        }
        expect(")");
        const spec = FUNCS[fn];
        if (args.length < spec.min || args.length > spec.max) throw new ExprError(`${fn} takes ${spec.min === spec.max ? spec.min : `${spec.min}+`} argument(s)`);
        return { k: "call", fn, args };
      }
      return { k: "var", name: t.v };
    }
    if (isOp("(")) {
      p++;
      const e = expr();
      expect(")");
      return e;
    }
    throw new ExprError(`Unexpected "${t.v}"`);
  }
  const e = expr();
  if (p < toks.length) throw new ExprError(`Unexpected "${toks[p].v}"`);
  return e;
}

export function evalExpr(e: Expr, vars: (name: string) => number | undefined): number {
  switch (e.k) {
    case "num":
      return e.v;
    case "var": {
      const v = vars(e.name);
      if (v === undefined) throw new ExprError(`Unknown variable ${e.name}`);
      return v;
    }
    case "neg":
      return -evalExpr(e.a, vars);
    case "bin": {
      const a = evalExpr(e.a, vars);
      const b = evalExpr(e.b, vars);
      if (e.op === "+") return a + b;
      if (e.op === "-") return a - b;
      if (e.op === "*") return a * b;
      if (b === 0) throw new ExprError("Division by zero");
      return a / b;
    }
    case "call":
      return FUNCS[e.fn].f(...e.args.map((x) => evalExpr(x, vars)));
  }
}

export function exprVars(e: Expr, out = new Set<string>()): Set<string> {
  if (e.k === "var") out.add(e.name);
  else if (e.k === "neg") exprVars(e.a, out);
  else if (e.k === "bin") {
    exprVars(e.a, out);
    exprVars(e.b, out);
  } else if (e.k === "call") for (const a of e.args) exprVars(a, out);
  return out;
}

/** True when the text is an expression rather than a plain number. */
export const isExpression = (text: string) => !/^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$/.test(text);

export interface VarEval {
  values: Map<string, number>;
  errors: Map<string, string>;
}

/** Evaluate variables in dependency order; reports unknown names and cycles. */
export function evaluateVariables(vars: { name: string; expr: string }[]): VarEval {
  const values = new Map<string, number>();
  const errors = new Map<string, string>();
  const byName = new Map(vars.map((v) => [v.name, v]));
  const state = new Map<string, 1 | 2>(); // 1 visiting, 2 done
  const visit = (name: string): number | undefined => {
    if (values.has(name)) return values.get(name);
    if (errors.has(name)) return undefined;
    const v = byName.get(name);
    if (!v) return undefined;
    if (state.get(name) === 1) {
      errors.set(name, "Circular reference");
      return undefined;
    }
    state.set(name, 1);
    try {
      const e = parseExpr(v.expr);
      const val = evalExpr(e, (n) => {
        const r = visit(n);
        if (r === undefined && !errors.has(name)) throw new ExprError(errors.has(n) ? `Depends on ${n}, which has an error` : `Unknown variable ${n}`);
        return r;
      });
      if (!Number.isFinite(val)) throw new ExprError("Not a finite number");
      values.set(name, val);
      return val;
    } catch (err) {
      if (!errors.has(name)) errors.set(name, (err as Error).message);
      return undefined;
    } finally {
      state.set(name, 2);
    }
  };
  for (const v of vars) visit(v.name);
  return { values, errors };
}
