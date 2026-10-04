/**
 * C축 엔진 — 성공확률 · 기간 · 신뢰 게이트
 *
 *   CE-01  층화 성공확률 조회
 *   CE-02  단계 기간 조회
 *   CE-06  임상 데이터 신뢰 게이트
 */
import type { Conditions } from "../types";
import {
  Ctx, chunkSource, field, num,
  type EngineResult,
} from "./base";
import { MONTHS_PER_YEAR, nextPhase } from "./axes";
import { resolveSlotFrom, type ResolveInput, type SlotSpec } from "../resolve";
import { slot, levelNote } from "../slots";

// ─────────────────────────────────────────────
// CE-01 층화 성공확률 조회
//
// 규칙(설계서 CE-01)
//   · 누적(cumulative)과 조건부(conditional)는 따로 돌려준다. 다시 곱하지 않는다.
//   · rare=Y 면 질환군 값 한 줄 + 희귀 값 한 줄. 두 값을 곱하거나 평균내지 않는다.
// ─────────────────────────────────────────────
/** 값 하나 + 그 값을 어느 칸에서 찾았는지 */
export type Picked = {
  value: number;
  chunk_id: string;
  /** 1 정확 · 2 질환군 · 3 비항암 대표 · 4 전체 평균 · 5 설계상 전체값 */
  level: number;
  phase_to?: string | null;
};

export type SuccessValues = {
  conditional: Picked | null;
  /** CLIN-1a — 모달리티 기준 누적 승인확률 */
  cumulative: (Picked & { basis_label?: string }) | null;
  /** CLIN-1b — 적응증(치료영역) 기준. 두 값을 곱하거나 평균내지 않는다 */
  cumulative_alt: (Picked & { basis_label: string }) | null;
  /** CLIN-1c — 희귀 둘째 줄 */
  rare_row: Picked | null;
  /**
   * CLIN-1p — 비임상→1상 진입 확률. 비임상 단계에서만 나온다.
   *
   * 위 누적·조건부 값과 곱하지 않는다(대표님 20261003_1501).
   * 누적 값은 '1상 진입 이후' 를 세는 값이고 이건 '1상에 들어가는가' 를 세는 값이다.
   * 둘을 곱하면 출처가 다른 두 집계를 하나로 만드는 셈이 된다.
   */
  entry: Picked | null;
  /** 비임상이라 위 값들이 '1상 진입 이후' 기준인가 */
  from_p1: boolean;
};

export async function CE_01(cond: Conditions): Promise<EngineResult<SuccessValues>> {
  const ctx = new Ctx("CE-01");
  const src = await chunkSource();

  // 자리 정의와 찾는 순서는 golden_cases.json 이 정본이다. 여기서 또 정하지 않는다.
  //   CLIN-1a  모달리티 기준   → modality → 전체 모달리티
  //   CLIN-1b  치료영역 기준   → ta → 질환군 → 비항암 대표 → 전체
  //   CLIN-1c  희귀 둘째 줄    → rare
  const inp: ResolveInput = {
    modality: cond.modality,
    phase: cond.phase,
    therapeutic_area: cond.therapeutic_area ?? null,
    disease_group: cond.disease_group,
    rare: cond.rare,
  };

  /** 사다리로 찾은 것 중 숫자가 있는 첫 장 */
  const take = async (
    spec: ReturnType<typeof slot>,
    over?: Partial<SlotSpec>
  ): Promise<Picked | null> => {
    const r = await resolveSlotFrom(src, { ...spec, ...over }, inp);
    const hit = r.chunks.find((c) => num(c) !== null);
    if (!hit) return null;
    ctx.use(hit);
    const note = levelNote(r.level);
    if (note) ctx.badge(`${spec.label} — ${note}`);
    return {
      value: num(hit)!,
      chunk_id: hit.chunk_id,
      level: r.level,
      phase_to: (field(hit, "phase_to") as string) ?? null,
    };
  };

  const a = slot("CLIN-1a");
  const b = slot("CLIN-1b");

  // 누적(cumulative) 두 줄 — 모달리티 기준과 치료영역 기준
  const cumulative = await take(a);
  const alt = await take(b);

  // 조건부(conditional)는 같은 사다리에 기준만 바꿔 쓴다.
  // 누적과 조건부를 다시 곱하지 않는다(설계서 CE-01).
  const conditional = await take(a, {
    filter: { ...(a.filter ?? {}), basis: "conditional", to: undefined },
  });

  if (!conditional) ctx.lack("이 조건의 조건부 성공확률");
  if (!cumulative) ctx.lack("이 조건의 누적 성공확률");

  // 희귀는 곱하지 않고 한 줄 더 붙인다
  let rare_row: Picked | null = null;
  if (cond.rare === "Y") {
    rare_row = await take(slot("CLIN-1c"));
    if (rare_row) ctx.badge("희귀 값은 별도 줄로 표시합니다 — 질환군 값과 곱하지 않습니다");
    else ctx.note("희귀 전용 성공확률 행이 없어 질환군 값만 표시합니다");
  }

  // 비임상 칸 — 1상에 들어갈 확률을 한 줄 더 붙인다
  const entry = cond.phase === "preclinical" ? await take(slot("CLIN-1p")) : null;
  if (cond.phase === "preclinical" && !entry)
    ctx.lack("비임상→1상 진입 확률");

  const values: SuccessValues = {
    conditional,
    cumulative,
    // 두 줄이 같은 청크면 한 줄만 보여 준다
    cumulative_alt:
      alt && cumulative && alt.chunk_id !== cumulative.chunk_id
        ? { ...alt, basis_label: cond.disease_group ?? "적응증" }
        : null,
    rare_row,
    entry,
    from_p1: cond.phase === "preclinical",
  };

  if (!values.conditional && !values.cumulative)
    return ctx.none(values, "이 조건에 맞는 성공확률 행이 없습니다");

  return ctx.done(values);
}

// ─────────────────────────────────────────────
// CE-02 단계 기간 조회
//
// 규칙(설계서 CE-02)
//   · 기본은 program_phase_transition(BIO) — 프로그램 기준.
//   · single_trial(Wong)은 상세에만. 둘을 합치지 않는다.
// ─────────────────────────────────────────────
export type DurationRow = {
  phase: string;
  phase_to: string | null;
  years: number;
  chunk_id: string;
};

export type DurationValues = {
  /** 변곡점까지 거치는 단계별 기간 */
  legs: DurationRow[];
  years_total: number | null;
  months_total: number | null;
  /** 보통 program_phase_transition. 그 값이 없어 단일시험 값을 쓴 단계도 있다 */
  duration_kind: string;
};

/**
 * stages 는 FE-D02 가 준 '변곡점까지 거치는 단계 목록'이다.
 * 각 단계의 '그 단계를 통과하는 데 걸린 기간'을 더한다.
 *
 * 찾는 순서는 golden_cases.json 의 CLIN-2 자리가 정한다
 *   치료영역 → 질환군 → 비항암 대표 → 전체
 *
 * 같은 칸에 두 종류가 섞여 있으면 프로그램 기준(BIO)을 먼저 쓴다.
 * 단일시험(Wong) 값만 있으면 그걸 쓰되 배지를 붙인다 — 둘을 합치지는 않는다(CE-02).
 */
export async function CE_02(
  cond: Conditions,
  stages: string[]
): Promise<EngineResult<DurationValues>> {
  const ctx = new Ctx("CE-02");
  const src = await chunkSource();
  const spec = slot("CLIN-2");

  const legs: DurationRow[] = [];
  let borrowedKind = false;

  for (const ph of stages) {
    const to = nextPhase(ph);
    const inp: ResolveInput = {
      modality: cond.modality,
      phase: ph,
      therapeutic_area: cond.therapeutic_area ?? null,
      disease_group: cond.disease_group,
      rare: cond.rare,
    };
    const r = await resolveSlotFrom(
      src,
      { ...spec, filter: { ...(spec.filter ?? {}), to } },
      inp
    );

    const withValue = r.chunks.filter((c) => num(c) !== null);
    const prog = withValue.find(
      (c) => field(c, "duration_kind") === "program_phase_transition"
    );
    const hit = prog ?? withValue[0] ?? null;

    if (!hit) {
      ctx.lack(`${ph} 단계 기간`);
      continue;
    }
    ctx.use(hit);

    const note = levelNote(r.level);
    if (note) ctx.badge(`${ph} 단계 기간 — ${note}`);
    if (!prog) {
      borrowedKind = true;
      ctx.badge(`${ph} 단계 기간은 프로그램 기준 값이 없어 단일시험 기준으로 표시합니다`);
    }

    legs.push({
      phase: ph,
      phase_to: to,
      years: num(hit)!,
      chunk_id: hit.chunk_id,
    });
  }

  const complete = legs.length === stages.length && stages.length > 0;
  const years = complete ? legs.reduce((s, l) => s + l.years, 0) : null;

  const values: DurationValues = {
    legs,
    years_total: years,
    months_total: years === null ? null : years * MONTHS_PER_YEAR,
    duration_kind: borrowedKind ? "mixed" : "program_phase_transition",
  };

  if (legs.length === 0) return ctx.none(values, "이 단계의 기간 행이 없습니다");
  return ctx.done(values);
}

/**
 * 승인까지 몇 년인가 — 출시 시점을 잡을 때 쓴다.
 *
 * 변곡점까지 기간(CE-02)과 다르다. 특허가 언제까지 유효한지 보려면
 * "변곡점" 이 아니라 "승인" 까지를 봐야 한다.
 * C02 의 phase→approved 행(예: 항암 P1→승인 10.3년)을 읽는다.
 */
export async function durationToApproval(cond: Conditions): Promise<{
  years: number | null; chunk_id: string | null;
}> {
  const src = await chunkSource();
  const spec = slot("CLIN-2");
  const inp: ResolveInput = {
    modality: cond.modality,
    phase: cond.clinical_phase ?? cond.phase,
    therapeutic_area: cond.therapeutic_area ?? null,
    disease_group: cond.disease_group,
    rare: cond.rare,
  };
  const r = await resolveSlotFrom(
    src,
    { ...spec, filter: { ...(spec.filter ?? {}), to: "approved" } },
    inp
  );
  const withValue = r.chunks.filter((c) => num(c) !== null);
  const hit =
    withValue.find((c) => field(c, "duration_kind") === "program_phase_transition") ??
    withValue[0] ?? null;

  return hit ? { years: num(hit)!, chunk_id: hit.chunk_id } : { years: null, chunk_id: null };
}

// ─────────────────────────────────────────────
// CE-06 임상 데이터 신뢰 게이트
//
// 이 값을 화면 첫 줄에 써도 되는가만 판정한다.
//   첫 줄 조건: 배지 없음 ∧ trust_tier ≤ 2
// ─────────────────────────────────────────────
export type GateValues = {
  display_tier: "first_line" | "second_line" | "detail_only";
  per_chunk: { chunk_id: string; badges: string[]; trust_tier: number | null }[];
};

export async function CE_06(chunkIds: string[]): Promise<EngineResult<GateValues>> {
  const ctx = new Ctx("CE-06");
  const src = await chunkSource();
  const got = await src.get(chunkIds);

  const per: GateValues["per_chunk"] = [];
  let worst: GateValues["display_tier"] = "first_line";

  const now = new Date().toISOString().slice(0, 7);

  for (const id of chunkIds) {
    const c = got[id];
    if (!c) {
      ctx.lack(`근거 카드 ${id}`);
      worst = "detail_only";
      continue;
    }
    ctx.use(c);

    const badges = [...((field(c, "badges") as string[]) ?? [])];
    const n = field(c, "reported_n");
    if (typeof n === "number" && n < 10) badges.push("small_sample");
    if (field(c, "illustrative") === true) badges.push("limited_mapping");

    // 유효기간이 지났으면 expired — 다만 대체할 자료가 없는 값은 빼 준다.
    //
    // no_successor_reference 는 "더 새 공개 자료가 존재하지 않는다"는 뜻이다.
    // 이걸 expired 로 내리면 비임상 칸 첫 줄이 영영 빈다(대표 결정 2026-10-03).
    // 대신 왜 옛 값인지는 화면에 적는다.
    const tv = field(c, "temporal_validity");
    const noSucc = badges.includes("no_successor_reference");
    if (typeof tv === "string" && !noSucc) {
      const end = tv.split("/")[1]?.trim();
      if (end && /^\d{4}-\d{2}$/.test(end) && end < now) badges.push("expired");
    }

    const tier = (field(c, "trust_tier") as number) ?? null;
    per.push({ chunk_id: id, badges, trust_tier: tier });

    for (const b of badges) ctx.badge(b);

    if (badges.includes("expired")) worst = "detail_only";
    else if (badges.length > 0 && worst === "first_line") worst = "second_line";
    else if (tier !== null && tier > 2 && worst === "first_line") worst = "second_line";
  }

  return ctx.done({ display_tier: worst, per_chunk: per });
}
