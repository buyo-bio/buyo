/**
 * applies_when 평가기
 *
 * 규칙 청크에는 "이 규칙이 언제 걸리는가" 가 한 줄 식으로 적혀 있다.
 *
 *   "rcr >= 1.0 and rcr < 1.5"
 *   "'KR' in jurisdictions and (disease_group == '항암' or rare == 'Y')"
 *   "'US' in jurisdictions and modality not in ['antibody', ...]"
 *   "always"
 *
 * 대표님 감사 도구는 파이썬이라 이 식을 eval 로 돌린다.
 * 우리 조회 코드는 TypeScript 라서 같은 문법을 직접 읽어야 한다.
 * 문법은 파이썬의 아주 좁은 부분집합이다 — 아래 문법 설명 그대로만 받는다.
 *
 * 값이 셋이다 — true · false · null
 *   null 은 "확인 필요" 다. 사용자가 그 칸을 아직 안 적었다는 뜻이고,
 *   거짓과 다르다. 안 적은 것을 거짓으로 치면 "해당 없음" 이라고 단정하게 된다.
 *   그래서 걸림/안 걸림과 별개로 "물어봐야 한다" 를 돌려준다.
 *
 * 문법
 *   식      := or식
 *   or식    := and식 ( "or" and식 )*
 *   and식   := not식 ( "and" not식 )*
 *   not식   := "not" not식 | 원자
 *   원자    := "(" 식 ")" | "always" | 비교
 *   비교    := 값 ( ("=="|"!="|">="|"<="|">"|"<") 값
 *                 | ("in"|"not" "in") 목록 )?
 *   값      := 이름 | 문자열 | 숫자
 *   목록    := "[" 값 ( "," 값 )* "]"
 *
 * 숫자를 여기에 적지 않는다. 임계값은 전부 식 안에, 식은 청크 안에 있다.
 */

/** 셋 중 하나 — null 은 "확인 필요" */
export type Tri = boolean | null;

export type EvalResult = {
  value: Tri;
  /** null 이 나온 이유 — 어떤 칸을 못 봤나. 화면에서 "○○를 적어 주세요" 로 쓴다 */
  missing: string[];
};

// ─────────────────────────────────────────────
// 토큰
// ─────────────────────────────────────────────
type Tok =
  | { t: "name"; v: string }
  | { t: "str"; v: string }
  | { t: "num"; v: number }
  | { t: "op"; v: string };

const OPS = ["==", "!=", ">=", "<=", ">", "<", "(", ")", "[", "]", ","];

export class AppliesWhenError extends Error {}

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }

    // 문자열 — 'KR' · '항암'. 작은따옴표와 큰따옴표 둘 다 받는다
    if (ch === "'" || ch === '"') {
      const end = src.indexOf(ch, i + 1);
      if (end < 0) throw new AppliesWhenError(`따옴표가 닫히지 않았습니다: ${src.slice(i)}`);
      out.push({ t: "str", v: src.slice(i + 1, end) });
      i = end + 1;
      continue;
    }

    // 숫자 — 0.5 · 12 · -3
    const numAt = /^-?\d+(\.\d+)?/.exec(src.slice(i));
    if (numAt && (/\d/.test(ch) || (ch === "-" && /\d/.test(src[i + 1] ?? "")))) {
      out.push({ t: "num", v: Number(numAt[0]) });
      i += numAt[0].length;
      continue;
    }

    // 두 글자 연산자를 먼저 본다 — ">=" 를 ">" 로 끊으면 안 된다
    const op = OPS.find((o) => src.startsWith(o, i));
    if (op) { out.push({ t: "op", v: op }); i += op.length; continue; }

    // 이름 — 칸 이름이거나 and/or/not/in/always
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (name) { out.push({ t: "name", v: name[0] }); i += name[0].length; continue; }

    throw new AppliesWhenError(`읽을 수 없는 글자 '${ch}' (위치 ${i}): ${src}`);
  }
  return out;
}

// ─────────────────────────────────────────────
// 구문 나무
// ─────────────────────────────────────────────
type Val =
  | { k: "name"; v: string }
  | { k: "lit"; v: string | number }
  /** 목록 그 자체를 값으로 비교할 때 — "grant_programs != []" */
  | { k: "list"; v: Val[] };
type Node =
  | { k: "always" }
  | { k: "and" | "or"; a: Node; b: Node }
  | { k: "not"; a: Node }
  | { k: "cmp"; op: string; l: Val; r: Val }
  /**
   * 들어 있나 — 두 꼴이 다 온다.
   *   modality in ['ADC','protein']     목록이 식 안에 적혀 있다
   *   'KR' in jurisdictions             목록이 사용자 입력 칸에 있다
   */
  | { k: "in"; neg: boolean; l: Val; rhs: { kind: "list"; xs: Val[] } | { kind: "val"; v: Val } }
  /** 칸 이름 하나만 있을 때 — 참/거짓으로 읽는다 */
  | { k: "truthy"; v: string };

/** 식 하나를 나무로. 같은 식을 여러 번 보므로 결과를 담아 둔다 */
const parsed = new Map<string, Node>();

export function parseAppliesWhen(src: string): Node {
  const hit = parsed.get(src);
  if (hit) return hit;

  const toks = lex(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => { const t = peek(); return t?.t === "op" && t.v === v; };
  const isName = (v: string) => { const t = peek(); return t?.t === "name" && t.v === v; };
  const eat = (v: string) => {
    if (!isOp(v) && !isName(v))
      throw new AppliesWhenError(`'${v}' 가 와야 하는데 '${JSON.stringify(peek() ?? null)}' 입니다: ${src}`);
    p++;
  };

  const value = (): Val => {
    // 목록이 비교 대상으로 올 수 있다 — "grant_programs != []" (비어 있지 않은가)
    if (isOp("[")) return { k: "list", v: list() };

    const t = toks[p++];
    if (!t) throw new AppliesWhenError(`식이 중간에 끊겼습니다: ${src}`);
    if (t.t === "str" || t.t === "num") return { k: "lit", v: t.v };
    if (t.t === "name") return { k: "name", v: t.v };
    throw new AppliesWhenError(`값이 와야 합니다: ${src}`);
  };

  const rhs = (): { kind: "list"; xs: Val[] } | { kind: "val"; v: Val } =>
    isOp("[") ? { kind: "list", xs: list() } : { kind: "val", v: value() };

  const list = (): Val[] => {
    eat("[");
    const xs: Val[] = [];
    while (!isOp("]")) {
      xs.push(value());
      if (isOp(",")) p++;
    }
    eat("]");
    return xs;
  };

  const atom = (): Node => {
    if (isOp("(")) { p++; const n = expr(); eat(")"); return n; }
    if (isName("always")) { p++; return { k: "always" }; }

    const l = value();

    // in / not in
    if (isName("in")) { p++; return { k: "in", neg: false, l, rhs: rhs() }; }
    if (isName("not")) {
      p++; eat("in");
      return { k: "in", neg: true, l, rhs: rhs() };
    }

    const t = peek();
    if (t?.t === "op" && ["==", "!=", ">=", "<=", ">", "<"].includes(t.v)) {
      p++;
      return { k: "cmp", op: t.v, l, r: value() };
    }

    // 칸 이름 하나만 — "platform_flag" 처럼
    if (l.k === "name") return { k: "truthy", v: l.v };
    throw new AppliesWhenError(`비교가 없는 값만 있습니다: ${src}`);
  };

  const notExpr = (): Node => {
    if (isName("not")) { p++; return { k: "not", a: notExpr() }; }
    return atom();
  };

  const andExpr = (): Node => {
    let n = notExpr();
    while (isName("and")) { p++; n = { k: "and", a: n, b: notExpr() }; }
    return n;
  };

  function expr(): Node {
    let n = andExpr();
    while (isName("or")) { p++; n = { k: "or", a: n, b: expr() }; }
    return n;
  }

  const node = expr();
  if (p !== toks.length)
    throw new AppliesWhenError(`식 뒤에 남은 글자가 있습니다: ${src}`);
  parsed.set(src, node);
  return node;
}

/** 식에 쓰인 칸 이름 전부 — 등록부와 맞는지 검사할 때 쓴다 */
export function fieldsUsed(src: string): string[] {
  const out = new Set<string>();
  const walk = (n: Node): void => {
    switch (n.k) {
      case "always": return;
      case "and": case "or": walk(n.a); walk(n.b); return;
      case "not": walk(n.a); return;
      case "truthy": out.add(n.v); return;
      case "cmp": {
        const walkVal = (v: Val) => {
          if (v.k === "name") out.add(v.v);
          else if (v.k === "list") v.v.forEach(walkVal);
        };
        walkVal(n.l); walkVal(n.r);
        return;
      }
      case "in":
        if (n.l.k === "name") out.add(n.l.v);
        if (n.rhs.kind === "list") {
          for (const x of n.rhs.xs) if (x.k === "name") out.add(x.v);
        } else if (n.rhs.v.k === "name") out.add(n.rhs.v.v);
        return;
    }
  };
  walk(parseAppliesWhen(src));
  return [...out];
}

// ─────────────────────────────────────────────
// 평가
// ─────────────────────────────────────────────
export type Facts = Record<string, unknown>;

/** 그 칸이 채워져 있나. null·undefined·빈 문자열은 안 채운 것으로 본다 */
function has(facts: Facts, k: string): boolean {
  if (!(k in facts)) return false;
  const v = facts[k];
  return v !== null && v !== undefined && v !== "";
}

/** 목록끼리는 길이와 각 칸을 글자로 비교한다 — "grant_programs != []" 가 주 용도다 */
function sameList(a: unknown[], b: unknown[]): boolean {
  return a.length === b.length && a.every((x, i) => String(x) === String(b[i]));
}

function cmp(op: string, a: unknown, b: unknown): Tri {
  // 한쪽이 목록이면 목록끼리만 견준다
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return op === "!=" ? true : false;
    const same = sameList(a, b);
    if (op === "==") return same;
    if (op === "!=") return !same;
    return null;   // 목록에 크기 비교는 뜻이 없다
  }

  switch (op) {
    case "==": return a === b || String(a) === String(b);
    case "!=": return !(a === b || String(a) === String(b));
    default: {
      // 크기 비교는 숫자끼리만. 글자를 숫자로 억지로 바꾸지 않는다
      const x = typeof a === "number" ? a : Number(a);
      const y = typeof b === "number" ? b : Number(b);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      switch (op) {
        case ">=": return x >= y;
        case "<=": return x <= y;
        case ">": return x > y;
        case "<": return x < y;
      }
      return null;
    }
  }
}

/**
 * 식을 사실(facts)에 대고 푼다.
 *
 * 세 값 논리
 *   and  하나라도 거짓이면 거짓. 거짓이 없고 모름이 있으면 모름.
 *   or   하나라도 참이면 참.   참이 없고 모름이 있으면 모름.
 * 이렇게 두는 이유: "희귀인가" 를 안 적었어도 'US' 가 아니면 규칙은 확실히 안 걸린다.
 * 안 적은 칸 때문에 전부 "확인 필요" 가 되면 화면이 물음표로 덮인다.
 */
export function evalAppliesWhen(src: string, facts: Facts): EvalResult {
  const missing = new Set<string>();

  const val = (v: Val): { ok: boolean; v: unknown } => {
    if (v.k === "lit") return { ok: true, v: v.v };
    if (v.k === "list") {
      const xs: unknown[] = [];
      for (const x of v.v) { const e = val(x); if (!e.ok) return { ok: false, v: null }; xs.push(e.v); }
      return { ok: true, v: xs };
    }
    if (!has(facts, v.v)) { missing.add(v.v); return { ok: false, v: null }; }
    return { ok: true, v: facts[v.v] };
  };

  const run = (n: Node): Tri => {
    switch (n.k) {
      case "always": return true;

      case "and": {
        const a = run(n.a), b = run(n.b);
        if (a === false || b === false) return false;
        if (a === null || b === null) return null;
        return true;
      }
      case "or": {
        const a = run(n.a), b = run(n.b);
        if (a === true || b === true) return true;
        if (a === null || b === null) return null;
        return false;
      }
      case "not": {
        const a = run(n.a);
        return a === null ? null : !a;
      }

      case "truthy": {
        if (!has(facts, n.v)) { missing.add(n.v); return null; }
        const v = facts[n.v];
        if (v === "Y" || v === true) return true;
        if (v === "N" || v === false) return false;
        return Boolean(v);
      }

      case "cmp": {
        const l = val(n.l), r = val(n.r);
        if (!l.ok || !r.ok) return null;
        return cmp(n.op, l.v, r.v);
      }

      case "in": {
        const l = val(n.l);
        if (!l.ok) return null;

        let xs: unknown[];
        if (n.rhs.kind === "list") {
          xs = [];
          for (const x of n.rhs.xs) {
            const e = val(x);
            if (!e.ok) return null;
            xs.push(e.v);
          }
        } else {
          // 목록이 사용자 입력 칸에 있다 — "'KR' in jurisdictions"
          const r = val(n.rhs.v);
          if (!r.ok) return null;
          xs = Array.isArray(r.v) ? r.v : String(r.v).split("|").map((x) => x.trim());
        }

        const hit = xs.some((x) => x === l.v || String(x) === String(l.v));
        return n.neg ? !hit : hit;
      }
    }
  };

  return { value: run(parseAppliesWhen(src)), missing: [...missing] };
}
