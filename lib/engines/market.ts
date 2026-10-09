/**
 * M축 엔진 — 기술이전 딜 컴프
 *
 *   FE-B07 / ME-08  같은 조건의 기술이전은 얼마에 이루어졌나
 *
 * 규칙 F06-09 그대로.
 *   M03 에서 모달리티(상위 태그 허용) ∧ 단계 일치.
 *   N ≥ 5 면 사분위, 아니면 목록.
 *   비공개 계약금은 금액에서 빼고 건수만 센다.
 *
 * 통화를 섞지 않는다. 달러는 달러대로, 원화는 원화대로 센다.
 */
import type { Chunk, Conditions } from "../types";
import { Ctx, chunkSource, field, num, type EngineResult } from "./base";
import { resolveSlotFrom, type ResolveInput, LEVEL } from "../resolve";
import { slot } from "../slots";

/**
 * 딜 표 한 줄 — 이름은 대표님 deal_master.csv 의 열 이름 그대로다.
 *
 * 예전에는 counterparty·signed·deal_stage 로 읽고 있었는데 표에는 그런 열이 없다.
 * 그래서 화면에 "아델 → — (—)" 처럼 상대방과 날짜가 줄표로 나갔다.
 */
type Deal = {
  licensor?: string; licensee?: string; licensee_country?: string;
  asset?: string; announce_date?: string; phase_at_deal?: string;
  upfront?: string; upfront_currency?: string; upfront_krw_at_announce?: string;
  total_deal?: string; total_currency?: string; territory?: string;
  deal_type?: string; status?: string;
  // 20261007 에 늘어난 열 — 로열티·권리 범위·검증
  royalty_disclosed?: string; royalty_low?: string; royalty_high?: string;
  royalty_structure?: string; royalty_note?: string;
  rights_indication_scope?: string; exclusivity?: string;
  verified_by?: string; verified_date?: string;
  /** 넘긴 권리 지역 기준 단계. 비어 있으면 표시하지 않는다(247건 중 3건만 채워짐) */
  phase_in_licensed_territory?: string;
};

export type DealComp = {
  chunk_id: string;
  licensor: string;
  counterparty: string;
  signed: string;
  stage: string;
  /** 원문 그대로 — "＄130.4M(1304억)" */
  upfront_text: string;
  /** 공개된 경우에만 */
  upfront_krw_억: number | null;
  upfront_usd_m: number | null;
  disclosed: boolean;
  /** 계약 지역 기준 단계 — 값이 있을 때만 phase_at_deal 옆에 병기 */
  stage_in_territory: string | null;
  /**
   * 로열티. 숫자를 추정하지 않는다(M03-1002) — "mid-teens" 처럼 말로만 공개한
   * 딜은 범위가 비어 있고 표현만 있다. 그때는 표현을 그대로 적는다.
   */
  royalty: string | null;
  /** 권리 범위 — 전체 적응증인지 일부인지 */
  rights_scope: string | null;
  exclusivity: string | null;
  territory: string | null;
};

export type DealValues = {
  deals: DealComp[];
  n_total: number;
  n_disclosed: number;
  /** N ≥ 5 이고 같은 통화가 5건 이상일 때만 */
  quartiles_krw_억: { q1: number; med: number; q3: number } | null;
  /** 어느 사다리 칸에서 찾았나 — 1 같은 모달리티·단계 · 2 단계 풀고 · 4 전체 */
  level: number;
  /** 같은 조건이지만 비교군에서 뺀 딜 — 상세에만 이유와 함께 보여 준다 */
  excluded: { chunk_id: string; licensor: string; reason: string }[];
};

/**
 * 계약금을 읽는다.
 *
 * 표의 upfront 는 두 모양으로 온다 — 옛 표기 "$130.4M(1304억)" 과
 * 20261007 뒤의 숫자만 적은 "80000000"(통화는 upfront_currency).
 * 숫자만 온 것을 글자로 그대로 내보내 화면에 "계약금 80000000" 이 찍히고 있었다.
 */
function parseUpfront(
  t: string | undefined,
  currency?: string,
  krwAtAnnounce?: string
): { usd_m: number | null; krw: number | null; disclosed: boolean; text: string } {
  if (!t || !t.trim() || /base_required|비공개|미보고/.test(t))
    return { usd_m: null, krw: null, disclosed: false, text: "비공개" };

  // ① 숫자만 — 통화 열과 함께 온다
  if (/^[\d,.]+$/.test(t.trim())) {
    const n = Number(t.replace(/,/g, ""));
    const krw억 = krwAtAnnounce && /^[\d,.]+$/.test(krwAtAnnounce)
      ? Math.round(Number(krwAtAnnounce.replace(/,/g, "")) / 1e8)
      : null;
    const cur = (currency ?? "").toUpperCase();
    if (cur === "KRW") {
      const 억 = Math.round(n / 1e8);
      return { usd_m: null, krw: 억, disclosed: true, text: `${억.toLocaleString()}억 원` };
    }
    const m = n / 1e6;
    const head = `$${m % 1 === 0 ? m : m.toFixed(1)}M`;
    return {
      usd_m: m, krw: krw억, disclosed: true,
      text: krw억 ? `${head}(${krw억.toLocaleString()}억 원)` : head,
    };
  }

  // ② 옛 표기 — 글자 안에 금액이 적혀 있다
  const krw = t.match(/([\d,.]+)\s*억/);
  const usd = t.match(/[$＄]\s*([\d,.]+)\s*M/i);
  return {
    usd_m: usd ? Number(usd[1].replace(/,/g, "")) : null,
    krw: krw ? Number(krw[1].replace(/,/g, "")) : null,
    disclosed: true,
    text: t,
  };
}

/**
 * 로열티 한 줄. 숫자를 지어내지 않는다(M03-1002).
 * 범위가 있으면 범위를, 말로만 공개됐으면 그 표현을 그대로 적는다.
 */
function royaltyText(d: Deal): string | null {
  const lo = d.royalty_low?.trim();
  const hi = d.royalty_high?.trim();
  if (lo && hi) return `${lo}~${hi}%`;
  if (lo) return `${lo}%`;
  const s = d.royalty_structure?.trim() || d.royalty_note?.trim();
  return s || null;
}

function quartiles(xs: number[]) {
  const a = [...xs].sort((p, q) => p - q);
  const at = (f: number) => {
    const i = (a.length - 1) * f;
    const lo = Math.floor(i), hi = Math.ceil(i);
    return lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (i - lo);
  };
  return { q1: at(0.25), med: at(0.5), q3: at(0.75) };
}

export async function ME_08(cond: Conditions): Promise<EngineResult<DealValues>> {
  const ctx = new Ctx("ME-08");
  const src = await chunkSource();

  // 규칙 카드를 먼저 읽는다 — 이 엔진이 무엇을 하는지는 카드가 정한다
  const rules = await src.find({}, { domain: "F06", kind: "rule" });
  const r09 = rules.find((c) => c.text.startsWith("[F06-09")) ?? null;
  if (r09) ctx.use(r09);

  // 찾는 순서는 golden_cases.json 의 MKT-2 자리가 정한다
  //   같은 모달리티·같은 단계(5건 이상이면 사분위) → 단계를 풀고 → 전체
  // 딜 컴프는 '지금 이 회사가 서 있는 단계' 로 본다.
  // 비임상 회사는 비임상 딜이 궁금한 것이지, 1상 딜이 궁금한 게 아니다.
  const spec = slot("MKT-2");
  const inp: ResolveInput = {
    modality: cond.modality,
    phase: cond.phase,
    therapeutic_area: cond.therapeutic_area ?? null,
    disease_group: cond.disease_group,
    rare: cond.rare,
  };
  const r = await resolveSlotFrom(src, spec, inp);

  const deals: DealComp[] = r.chunks.map((c) => {
    ctx.use(c);
    const d = (field(c, "deal") ?? {}) as Deal;
    const u = parseUpfront(d.upfront, d.upfront_currency, d.upfront_krw_at_announce);
    const some = (v: string | undefined) => (v && v.trim() ? v.trim() : null);
    return {
      chunk_id: c.chunk_id,
      licensor: d.licensor ?? "—",
      counterparty: some(d.licensee) ?? "—",
      signed: some(d.announce_date) ?? "—",
      stage: some(d.phase_at_deal) ?? "—",
      upfront_text: u.text,
      upfront_krw_억: u.krw,
      upfront_usd_m: u.usd_m,
      disclosed: u.disclosed,
      stage_in_territory: some(d.phase_in_licensed_territory),
      royalty: royaltyText(d),
      rights_scope: some(d.rights_indication_scope),
      exclusivity: some(d.exclusivity),
      territory: some(d.territory),
    };
  });

  deals.sort((a, b) => b.signed.localeCompare(a.signed));

  // 기술도입·제네릭·계열사 딜은 비교군이 아니다(대표님 20261003_1501).
  // 셈에는 넣지 않지만, 왜 빠졌는지는 상세에 적는다.
  const all = await src.find({}, { domain: "M03", kind: "parameter" });
  const excluded = all
    .filter((c) => field(c, "comps_eligible") === false)
    .filter((c) => {
      const m = field(c, "modality");
      return m != null && String(m) === cond.modality;
    })
    .map((c) => {
      const d = (field(c, "deal") ?? {}) as Deal;
      return {
        chunk_id: c.chunk_id,
        licensor: d.licensor ?? "—",
        reason: String(field(c, "comps_exclusion_reason") ?? "비교군 아님"),
      };
    });

  const krw = deals.map((d) => d.upfront_krw_억).filter((x): x is number => x !== null);
  const values: DealValues = {
    deals,
    n_total: deals.length,
    n_disclosed: deals.filter((d) => d.disclosed).length,
    // 같은 통화가 5건 이상일 때만 사분위. 통화를 섞지 않는다.
    quartiles_krw_억: krw.length >= 5 ? quartiles(krw) : null,
    level: r.level,
    excluded,
  };

  if (deals.length === 0)
    return ctx.none(values, "이 약 종류·단계에 맞는 기술이전 사례가 없습니다");

  // 어디서 찾았는지 그대로 적는다.
  // 숫자만 보여 주고 출신을 숨기면 비교가 아니라 착각이 된다.
  //
  // 다른 자리와 달리 딜의 레벨은 '질환군을 빌렸다'는 뜻이 아니다.
  //   modality_phase 에서 L2  → 같은 단계지만 건수가 기준 미만
  //   modality       에서     → 단계를 풀고 모은 것
  //   all            에서     → 모달리티까지 풀고 모은 것
  const min = spec.min_n ?? 5;
  if (r.step === "modality_phase") {
    if (r.level > LEVEL.EXACT)
      ctx.note(`같은 약 종류·단계 딜이 ${deals.length}건(기준 ${min}건)이라 사분위 대신 목록으로 표시합니다`);
  } else if (r.step === "modality") {
    ctx.badge(`같은 단계 딜이 ${min}건 미만이라 단계를 풀고 같은 약 종류 딜로 모았습니다`);
  } else {
    ctx.badge("같은 약 종류 딜이 없어 전체 딜로 모았습니다");
  }

  if (values.n_disclosed < deals.length)
    ctx.badge(`계약금 비공개 ${deals.length - values.n_disclosed}건은 건수로만 셌습니다`);
  if (!values.quartiles_krw_억 && deals.length >= 5)
    ctx.note("원화로 공개된 건이 5건 미만이라 사분위 대신 목록으로 표시합니다");

  return ctx.done(values);
}

// ─────────────────────────────────────────────
// ME-02 국내 환자 수 (M02)
//
// 규칙(대표님 20261003_1501)
//   · 숫자는 청크 text 그대로 옮긴다. 코드가 여러 개면 코드별로 한 줄씩 —
//     청구 기반 집계라 코드끼리 더하면 중복이 생긴다. 합계를 만들지 않는다.
//   · display_role 이 둘로 갈린다.
//       default — 적응증 단위로 읽어도 되는 값. 첫 줄에 쓴다.
//       detail  — 코드가 적응증보다 넓거나 좁은 값. 첫 줄에 쓰지 않는다.
//                 첫 줄에는 "확인되지 않았습니다" 를 쓰고 숫자는 상세로 내린다.
//   · 희귀 2만 명 판정은 이 숫자로만 한다(REG-2v). 추정하지 않는다.
// ─────────────────────────────────────────────
export type PatientRow = {
  chunk_id: string;
  /** "KCD:C34" */
  code: string;
  name: string;
  value: number;
  /** 화면에 나가는 문장 — 청크 text 그대로 */
  text: string;
  role: "default" | "detail";
  /** 화면에 붙일 한글 꼬리표 */
  notes: string[];
  /** M02 가 적어 둔 희귀 판정 글자 */
  judgement: string | null;
};

/** M02 가 적어 둔 국내 희귀 판정 → 규제 규칙이 쓰는 rare_kr */
export type RareKr = "Y" | "N" | "unknown";

export type PatientsValues = {
  rows: PatientRow[];
  /** 첫 줄에 숫자를 쓸 수 있나 — default 행이 하나라도 있으면 true */
  first_line: boolean;
  /** 코드 기준 값뿐일 때 첫 줄에 쓸 문장 */
  held_sentence: string | null;
  /**
   * 국내 희귀 요건 판정 (대표님 20261004_1709).
   *
   *   below_threshold               → Y
   *   above_threshold               → N
   *   above_threshold_code_broader  → unknown  (코드가 적응증보다 넓다)
   *   below_threshold_code_partial  → unknown  (코드가 적응증 일부만 덮는다)
   *   M02 청크 없음                  → unknown
   *
   * 모르면 'unknown' 이다 — 빈 값이 아니다. R02-0016(판정 보류) 규칙이
   * rare_kr == 'unknown' 으로 걸리기 때문에, 비워 두면 그 안내도 안 나온다.
   */
  rare_kr: RareKr;
};

/** M02 판정 글자 → Y/N/unknown */
function toRareKr(judgement: unknown): RareKr {
  switch (judgement) {
    case "below_threshold": return "Y";
    case "above_threshold": return "N";
    default: return "unknown";   // 코드가 넓거나 일부만 덮으면 판정하지 않는다
  }
}

/** M02 배지 → 화면 꼬리표. 뜻을 모르는 배지는 그대로 둔다 */
const M02_NOTE: Record<string, string> = {
  code_broader: "상한값",
  code_partial: "과소 가능",
};

const HELD =
  "적응증 단위 국내 환자 수는 확인되지 않았습니다 — 코드 기준 값은 상세에서 볼 수 있습니다.";

export async function ME_02(cond: Conditions): Promise<EngineResult<PatientsValues>> {
  const ctx = new Ctx("ME-02");
  const src = await chunkSource();
  const spec = slot("MKT-4");

  const inp: ResolveInput = {
    modality: cond.modality,
    phase: cond.phase,
    therapeutic_area: cond.therapeutic_area ?? null,
    disease_group: cond.disease_group,
    rare: cond.rare,
    indication_name: cond.indication_name ?? null,
  };

  const empty: PatientsValues = {
    rows: [], first_line: false, held_sentence: null, rare_kr: "unknown",
  };
  if (!inp.indication_name)
    return ctx.none(empty, "적응증을 목록에서 고르면 국내 환자 수를 찾습니다");

  const r = await resolveSlotFrom(src, spec, inp);
  const rows: PatientRow[] = r.chunks
    .filter((c) => num(c) !== null)
    .map((c) => {
      ctx.use(c);
      const badges = (field(c, "badges") as string[]) ?? [];
      return {
        chunk_id: c.chunk_id,
        code: String((field(c, "indication") as { code?: string } | null)?.code ?? "—"),
        name: String((field(c, "indication") as { text?: string } | null)?.text ?? "—"),
        value: num(c)!,
        text: c.text,
        role: ((field(c, "display_role") ?? "default") === "detail"
          ? "detail"
          : "default") as PatientRow["role"],
        judgement: (field(c, "rare_judgement") as string) ?? null,
        notes: badges.map((b) => M02_NOTE[b]).filter(Boolean),
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));

  if (rows.length === 0)
    return ctx.none(empty, `${inp.indication_name} 의 국내 환자 수 카드가 없습니다`);

  const firstLine = rows.some((x) => x.role === "default");
  for (const n of new Set(rows.flatMap((x) => x.notes))) ctx.badge(n);
  if (!firstLine) ctx.note(HELD);
  if (rows.length > 1)
    ctx.note("상병코드가 여러 개입니다 — 청구 기반 집계라 코드끼리 더하지 않고 따로 표시합니다");

  // 희귀 판정은 첫 줄에 쓸 수 있는 값(default)에서만 가져온다.
  // 코드가 적응증보다 넓은 값으로 "2만 명 초과" 를 단정하면 안 된다.
  const head = rows.find((x) => x.role === "default") ?? null;
  const rare_kr = head ? toRareKr(head.judgement) : "unknown";

  return ctx.done({
    rows,
    first_line: firstLine,
    held_sentence: firstLine ? null : HELD,
    rare_kr,
  });
}

// ─────────────────────────────────────────────
// ME-17 단계 차이 표시 (phase_gap_label)
//
// 비교로 쓴 딜들이 "우리가 팔려는 시점" 보다 이른 단계의 딜이면, 그 금액은
// 하한으로 봐야 한다. 늦은 단계면 상한이다. 같은 단계일 때만 그대로 견준다.
//
// 라벨만 낸다. 보수적·낙관적이라는 말은 M03-1007·1008 청크가 들고 있고,
// 그 두 규칙이 phase_gap_label 을 조건으로 걸린다 — 여기서 문장을 짓지 않는다.
//
// 대표님 기준 구현: trace/trace_case.py 의 deal_phase_gap()
// ─────────────────────────────────────────────

/** 단계 순서 — 차이의 부호가 뜻을 가진다 */
const PHASE_ORDER = ["preclinical", "P1", "P2", "P3", "NDA", "approved"] as const;

export type PhaseGap = "earlier" | "same" | "later";

/**
 * 기술이전이 일어날 때 자산이 있을 단계.
 *
 * 자가개발이면 기술이전 시점이 없다 — 계산하지 않는다(규칙은 '확인 필요'로 남는다).
 */
export function dealExitPhase(
  phase: string,
  exitRoute: string | undefined,
  exitPoint: string | undefined
): string | null {
  if (exitRoute !== "license_out") return null;

  // 회사가 목표 시점을 적었으면 그것을 쓴다.
  // 화면 입력은 "P1_complete", 대표님 문서는 "P1_end" — 둘 다 받는다.
  const m = /^(P[123])_(end|complete)$/.exec(exitPoint ?? "");
  if (m) return m[1];

  // 기본 규칙(FE-D02·M-D05): 2상 개념증명 뒤에 기술이전하는 것이 일반적이다
  if (phase === "preclinical" || phase === "P1" || phase === "P2") return "P2";
  if (phase === "P3" || phase === "NDA") return phase;
  return null;
}

/**
 * 비교 딜 풀의 단계.
 *
 * 딜 하나가 "preclinical|P1" 처럼 단계를 둘 이상 들고 있을 수 있다.
 * 모든 딜이 지금 단계를 품고 있으면 지금 단계로 본다. 섞여 있으면 판단하지 않는다 —
 * 섞인 풀에 하나의 단계를 붙이면 없는 사실을 만들어 내는 것이다.
 */
export function dealPoolPhase(stages: string[], currentPhase: string): string | null {
  const sets = stages
    .filter((s) => s && s !== "—")
    .map((s) => s.split("|").map((x) => x.trim()).filter(Boolean));
  if (!sets.length) return null;

  const single = new Set(sets.filter((s) => s.length === 1).map((s) => s[0]));
  if (single.size === 1 && sets.every((s) => s.length === 1)) return [...single][0];

  if (sets.every((s) => s.includes(currentPhase))) return currentPhase;
  return null;
}

/** 풀 단계 − 출구 단계 */
export function phaseGapOf(poolPhase: string | null, exitPhase: string | null): PhaseGap | null {
  if (!poolPhase || !exitPhase) return null;
  const a = PHASE_ORDER.indexOf(poolPhase as (typeof PHASE_ORDER)[number]);
  const b = PHASE_ORDER.indexOf(exitPhase as (typeof PHASE_ORDER)[number]);
  if (a < 0 || b < 0) return null;
  return a < b ? "earlier" : a > b ? "later" : "same";
}
