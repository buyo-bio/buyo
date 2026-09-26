/**
 * C축 엔진 — 성공확률 · 기간 · 신뢰 게이트
 *
 *   CE-01  층화 성공확률 조회
 *   CE-02  단계 기간 조회
 *   CE-06  임상 데이터 신뢰 게이트
 */
import type { Chunk, Conditions } from "../types";
import {
  Ctx, chunkSource, field, indicationCode, num, rankByFit,
  type EngineResult,
} from "./base";
import { MONTHS_PER_YEAR, nextPhase } from "./axes";

/** 청크가 말하는 질환군 이름(=BUYO 질환군 7개 중 하나) */
function indicationText(c: Chunk): string | null {
  const ind = field(c, "indication");
  if (ind && typeof ind === "object") return ((ind as Record<string, unknown>).text as string) ?? null;
  return null;
}

// ─────────────────────────────────────────────
// CE-01 층화 성공확률 조회
//
// 규칙(설계서 CE-01)
//   · 누적(cumulative)과 조건부(conditional)는 따로 돌려준다. 다시 곱하지 않는다.
//   · rare=Y 면 질환군 값 한 줄 + 희귀 값 한 줄. 두 값을 곱하거나 평균내지 않는다.
// ─────────────────────────────────────────────
export type SuccessValues = {
  conditional: { value: number; chunk_id: string; phase_to: string | null } | null;
  cumulative: { value: number; chunk_id: string; phase_to: string | null } | null;
  /** 같은 누적값을 다른 기준(질환군)으로 잡은 행 — 두 값 사이에서 읽게 한다 */
  cumulative_alt: { value: number; chunk_id: string; basis_label: string } | null;
  rare_row: { value: number; chunk_id: string } | null;
};

export async function CE_01(cond: Conditions): Promise<EngineResult<SuccessValues>> {
  const ctx = new Ctx("CE-01");
  const src = await chunkSource();

  // 비임상 회사는 P1 기준 값을 본다(clinical_phase). 배지는 정규화가 붙였다.
  const lookupPhase = cond.clinical_phase ?? cond.phase;
  const rows = await src.find(
    { modality: cond.modality, phase: lookupPhase },
    { domain: "C01", kind: "parameter" }
  );

  // 질환군은 코드가 아니라 이름으로 맞춘다(청크가 '항암'처럼 적어 둔다)
  const fits = rows.filter((c) => {
    const t = indicationText(c);
    return t === null || t === cond.disease_group;
  });
  const ranked = rankByFit(fits, {
    modality: cond.modality,
    indication_code: cond.indication_code,
  });

  const pick = (basis: "conditional" | "cumulative") =>
    ranked.find((c) => field(c, "probability_basis") === basis && num(c) !== null) ?? null;

  const condRow = ctx.use(pick("conditional"));
  const cumRow = ctx.use(pick("cumulative"));

  if (!condRow) ctx.lack("이 조건의 조건부 성공확률");
  if (!cumRow) ctx.lack("이 조건의 누적 성공확률");

  // 희귀는 곱하지 않고 한 줄 더 붙인다
  let rareRow: Chunk | null = null;
  if (cond.rare === "Y") {
    rareRow = ctx.use(ranked.find((c) => field(c, "rare") === "Y" && num(c) !== null) ?? null);
    if (rareRow) ctx.badge("희귀 값은 별도 줄로 표시합니다 — 질환군 값과 곱하지 않습니다");
    else ctx.note("희귀 전용 성공확률 행이 없어 질환군 값만 표시합니다");
  }

  const wrap = (c: Chunk | null) =>
    c && num(c) !== null
      ? { value: num(c)!, chunk_id: c.chunk_id, phase_to: (field(c, "phase_to") as string) ?? null }
      : null;

  // 모달리티로 고른 누적값이 있으면, 질환군으로 고른 누적값도 한 줄 더 보여준다.
  // 두 값을 곱하거나 평균내지 않는다 — 나란히 놓고 "사이에서 읽으라"고 쓴다.
  let altRow: Chunk | null = null;
  if (cumRow && cond.disease_group) {
    altRow = ranked.find(
      (c) =>
        c.chunk_id !== cumRow.chunk_id &&
        field(c, "probability_basis") === "cumulative" &&
        indicationText(c) === cond.disease_group &&
        field(c, "modality") == null &&
        num(c) !== null
    ) ?? null;
    if (altRow) ctx.use(altRow);
  }

  const values: SuccessValues = {
    conditional: wrap(condRow),
    cumulative: wrap(cumRow),
    cumulative_alt: altRow && num(altRow) !== null
      ? { value: num(altRow)!, chunk_id: altRow.chunk_id, basis_label: cond.disease_group! }
      : null,
    rare_row: rareRow && num(rareRow) !== null
      ? { value: num(rareRow)!, chunk_id: rareRow.chunk_id }
      : null,
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
  duration_kind: "program_phase_transition";
};

/**
 * stages 는 FE-D02 가 준 '변곡점까지 거치는 단계 목록'이다.
 * 각 단계의 '그 단계를 통과하는 데 걸린 기간'을 더한다.
 */
export async function CE_02(
  cond: Conditions,
  stages: string[]
): Promise<EngineResult<DurationValues>> {
  const ctx = new Ctx("CE-02");
  const src = await chunkSource();

  const legs: DurationRow[] = [];

  for (const ph of stages) {
    const to = nextPhase(ph);
    const rows = await src.find({ phase: ph }, { domain: "C02", kind: "parameter" });

    const fits = rows.filter(
      (c) =>
        field(c, "duration_kind") === "program_phase_transition" &&
        (field(c, "phase_to") ?? null) === to &&
        num(c) !== null
    );

    // 질환군이 맞는 행 먼저, 없으면 전체(All indications) 행
    const exact = fits.find((c) => indicationText(c) === cond.disease_group);
    const all = fits.find((c) => indicationText(c) === null);
    const hit = exact ?? all ?? null;

    if (!hit) {
      ctx.lack(`${ph} 단계 기간`);
      continue;
    }
    if (!exact && all) ctx.badge(`${ph} 단계 기간은 질환군 값이 없어 전체 기준으로 표시합니다`);

    ctx.use(hit);
    legs.push({ phase: ph, phase_to: to, years: num(hit)!, chunk_id: hit.chunk_id });
  }

  const complete = legs.length === stages.length && stages.length > 0;
  const years = complete ? legs.reduce((s, l) => s + l.years, 0) : null;

  const values: DurationValues = {
    legs,
    years_total: years,
    months_total: years === null ? null : years * MONTHS_PER_YEAR,
    duration_kind: "program_phase_transition",
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
  const phase = cond.clinical_phase ?? cond.phase;
  const rows = await src.find({ phase }, { domain: "C02", kind: "parameter" });

  const fits = rows.filter(
    (c) => (field(c, "phase_to") ?? null) === "approved" && num(c) !== null
  );
  const exact = fits.find((c) => indicationText(c) === cond.disease_group);
  const all = fits.find((c) => indicationText(c) === null);
  const hit = exact ?? all ?? null;

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

    const tv = field(c, "temporal_validity");
    if (typeof tv === "string") {
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
