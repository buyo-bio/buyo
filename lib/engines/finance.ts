/**
 * F축 엔진 — 런웨이 · 필요자금 · 갭 · 커버리지 · 하방
 *
 *   FE-A01  런웨이
 *   FE-A02  변곡점까지 필요자금(벤치마크 경로)
 *   FE-A04  자금 갭
 *   FE-A05  런웨이 커버리지 비율(RCR)
 *   FE-B10  하방·단일자산 노출
 *
 * 숫자 상수를 코드에 적지 않는다. 임계값·기간은 전부 F01 규칙 카드에서 읽는다.
 */
import type { Chunk, Conditions } from "../types";
import {
  Ctx, byTag, chunkSource, field, num, ruleText,
  type EngineResult,
} from "./base";
import { TA_FALLBACK, taLabel } from "./axes";

/** F01 규칙 카드 전부 (한 번 읽어 여러 엔진이 나눠 쓴다) */
async function f01Rules(): Promise<Chunk[]> {
  const src = await chunkSource();
  return src.find({}, { domain: "F01", kind: "rule" });
}

/**
 * 날짜에 개월을 더한다. 소수점 개월(15.8)을 살려야 한다.
 * setMonth(+15) 로 깎으면 소진 시점이 한 달 당겨진다.
 */
function addMonths(from: Date, months: number): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + Math.round(months * 30.44));
  return d;
}

/** 규칙 문장 안에 적힌 개월 수를 꺼낸다 — 숫자의 출처는 언제나 청크다 */
function monthsInRule(c: Chunk | null): number | null {
  if (!c) return null;
  const m = c.text.match(/기본값\s*([\d.]+)\s*개월/);
  return m ? Number(m[1]) : null;
}

// ─────────────────────────────────────────────
// FE-A01 런웨이
//
//   쓸 수 있는 현금 = 현금 − 제한 현금        (F01-01, 정부과제 전용은 F01-13)
//   런웨이(개월)   = 쓸 수 있는 현금 ÷ 월 소진
//   확정 조달은 둘째 값으로 병기, 예정 조달은 넣지 않는다 (F01-02)
// ─────────────────────────────────────────────
export type RunwayInput = {
  cash?: number;
  restricted_cash?: number;
  monthly_burn?: number;
  committed_raise?: number;
  /** 월 소진을 1개월치로만 잡았다면 true — '단월 기준' 배지 */
  burn_single_month?: boolean;
};

export type RunwayValues = {
  cash_available: number | null;
  runway_m: number | null;
  runway_m_committed: number | null;
  cash_out_date: string | null;
};

export async function FE_A01(inp: RunwayInput): Promise<EngineResult<RunwayValues>> {
  const ctx = new Ctx("FE-A01");
  const rules = await f01Rules();

  ctx.use(byTag(rules, "F01-01"));
  if (inp.restricted_cash) ctx.use(byTag(rules, "F01-13"));
  if (inp.committed_raise) ctx.use(byTag(rules, "F01-02"));
  ctx.use(byTag(rules, "F01-16")); // provenance 배지 규칙

  const empty: RunwayValues = {
    cash_available: null, runway_m: null, runway_m_committed: null, cash_out_date: null,
  };

  if (inp.cash == null) return ctx.none(empty, "현금 값이 없습니다");
  if (!inp.monthly_burn) return ctx.none(empty, "월 소진 값이 없습니다");

  const available = inp.cash - (inp.restricted_cash ?? 0);
  const runway = available / inp.monthly_burn;
  const withCommitted = (available + (inp.committed_raise ?? 0)) / inp.monthly_burn;

  if (inp.burn_single_month) ctx.badge("단월 기준");

  // 12개월 이내 소진이면 주의 플래그 (F01-17)
  const warn = byTag(rules, "F01-17");
  if (warn && runway <= 12) {
    ctx.use(warn);
    ctx.badge(ruleText(warn) ?? "");
  }

  return ctx.done({
    cash_available: available,
    runway_m: runway,
    runway_m_committed: withCommitted,
    cash_out_date: addMonths(new Date(), runway).toISOString().slice(0, 10),
  });
}

// ─────────────────────────────────────────────
// FE-A02 변곡점까지 필요자금 — 업계 평균 경로
//
//   단계마다 C03 '단계 비용' 카드를 그대로 읽어 더한다.
//   비임상 5.0M$(Paul 2010) · P1 25.3M$(DiMasi 2016) 같은 값이다.
//
// 이 값은 대형 제약사 규모에 실패한 프로그램의 지출까지 포함한 금액이다.
// 설계안 기준(FE-A03)과 산정 방식이 다르므로 **합치지 않고 나란히 놓는다** (F01-11).
// ─────────────────────────────────────────────
export type BenchLeg = { phase: string; usd_m: number; basis: string; chunk_id: string };

export type BenchValues = {
  currency: "USD";
  legs: BenchLeg[];
  total_usd_m: number | null;
};

export async function FE_A02(
  _cond: Conditions,
  stages: string[]
): Promise<EngineResult<BenchValues>> {
  const ctx = new Ctx("FE-A02");
  const src = await chunkSource();
  const rules = await f01Rules();
  ctx.use(byTag(rules, "F01-11")); // 두 값을 합치지 않는다
  ctx.use(byTag(rules, "F01-12")); // 총개발비로 부르지 않는다

  const legs: BenchLeg[] = [];

  for (const ph of stages) {
    const rows = await src.find({ phase: ph }, { domain: "C03", kind: "parameter" });
    const withValue = rows.filter((c) => num(c) !== null);

    // 가중평균(DiMasi) 이 있으면 그것, 없으면 모델 입력값(Paul)
    const hit =
      withValue.find((c) => field(c, "statistic") === "weighted_mean") ??
      withValue.find((c) => field(c, "statistic") === "model_input") ??
      withValue[0] ?? null;

    if (!hit) { ctx.lack(`${ph} 단계 비용`); continue; }
    ctx.use(hit);

    const src_title = (field(hit, "source") as { title?: string } | null)?.title ?? "";
    legs.push({
      phase: ph,
      usd_m: num(hit)!,
      basis: `${src_title.slice(0, 40)} · ${field(hit, "statistic") ?? ""}`,
      chunk_id: hit.chunk_id,
    });
  }

  const values: BenchValues = {
    currency: "USD",
    legs,
    total_usd_m: legs.length === stages.length && legs.length > 0
      ? legs.reduce((s, l) => s + l.usd_m, 0) : null,
  };

  if (legs.length === 0) return ctx.none(values, "이 단계의 C03 단계 비용 카드가 없습니다");
  return ctx.done(values);
}

// ─────────────────────────────────────────────
// FE-A03 설계안 기준 임상 직접비 (최소값)
//
//   필요자금 = 환자 1인당 비용 × 대상자 수
//              ↑ F04 카드        ↑ 사용자가 적은 계획 인원.
//                                 안 적었으면 F04 벤치마크 인원으로 대신하고 배지.
//
// 이 값은 '대상자 수 × 단가' 만 본 것이다.
// 기관 개설비·CRO 월 비용·국내 환자당 단가·제조(CMC) 비용이 빠져 있다.
// 그래서 결과에는 반드시 '최소' 를 붙인다 (F01-09).
// 업계 평균(FE-A02)과 합치지 않는다 — 산정 방식이 다르다 (F01-11).
// 원화 환산·갭은 MVP에서 하지 않는다 (F01-10).
// ─────────────────────────────────────────────
export type NeedLeg = {
  phase: string;
  cost_per_patient: number;
  patients: number;
  usd: number;
  chunk_ids: string[];
};

export type NeedValues = {
  currency: "USD";
  /** 현 단계 시험 1건 벤치마크 — 화면 첫 줄 */
  need_current_phase_usd: number | null;
  /** 변곡점까지 거치는 단계 합 */
  need_to_inflection_usd: number | null;
  legs: NeedLeg[];
  /** 부분합이라 '최소' 표기를 붙여야 하는가 */
  is_minimum: boolean;
  missing_items: string[];
};

export async function FE_A03(
  cond: Conditions,
  stages: string[],
  plannedN?: number
): Promise<EngineResult<NeedValues>> {
  const ctx = new Ctx("FE-A03");
  const src = await chunkSource();
  const rules = await f01Rules();

  const ta = taLabel(cond.disease_group);
  const wanted = ta ? [ta, ...TA_FALLBACK] : TA_FALLBACK;

  const legs: NeedLeg[] = [];

  for (const ph of stages) {
    const rows = await src.find({ phase: ph }, { domain: "F04", kind: "parameter" });

    const pickBy = (kind: string) => {
      for (const label of wanted) {
        const hit = rows.find(
          (c) => field(c, "cost_kind") === kind && field(c, "source_ta_label") === label && num(c) !== null
        );
        if (hit) return { hit, label };
      }
      return null;
    };

    const cpp = pickBy("cost_per_patient");
    if (!cpp) {
      // 비임상은 환자가 없으니 임상 직접비도 없다. 빠진 게 아니라 해당이 없는 것이다.
      if (ph === "preclinical") ctx.note("비임상 단계에는 임상 직접비가 없습니다 — 1상부터 계산합니다");
      else ctx.lack(`${ph} 단계 환자당 단가`);
      continue;
    }
    if (ta && cpp.label !== ta)
      ctx.badge(`${ph} 단계 단가는 치료영역 값이 없어 전체 기준으로 표시합니다`);
    ctx.use(cpp.hit);

    // 대상자 수 — 처음 잡히는 임상 구간에 사용자가 적은 계획 인원을 쓴다
    let patients: number | null = legs.length === 0 && plannedN ? plannedN : null;
    const chunkIds = [cpp.hit.chunk_id];

    if (patients === null) {
      const pts = pickBy("patients_per_trial");
      if (!pts) {
        ctx.lack(`${ph} 단계 대상자 수`);
        continue;
      }
      ctx.use(pts.hit);
      chunkIds.push(pts.hit.chunk_id);
      patients = num(pts.hit)!;
      ctx.badge(`${ph} 대상자 수를 적지 않아 업계 벤치마크 ${patients}명으로 계산했습니다`);
    }

    legs.push({
      phase: ph,
      cost_per_patient: num(cpp.hit)!,
      patients,
      usd: num(cpp.hit)! * patients,
      chunk_ids: chunkIds,
    });
  }

  // 아직 카드가 없어 못 넣은 항목 — F01-09 에 따라 문장에 나열한다
  const missing = ["기관 개설비", "CRO 월 비용", "국내 환자당 단가", "제조(CMC) 비용"];
  ctx.use(byTag(rules, "F01-09"));
  ctx.use(byTag(rules, "F01-10"));
  ctx.use(byTag(rules, "F01-11"));
  ctx.badge("최소");
  ctx.note(ruleText(byTag(rules, "F01-10")) ?? "");

  const values: NeedValues = {
    currency: "USD",
    need_current_phase_usd: legs[0]?.usd ?? null,
    need_to_inflection_usd:
      legs.length === stages.length && legs.length > 0
        ? legs.reduce((s, l) => s + l.usd, 0)
        : null,
    legs,
    is_minimum: true,
    missing_items: missing,
  };

  if (legs.length === 0) return ctx.none(values, "이 단계의 벤치마크 비용 카드가 없습니다");
  return ctx.done(values, "partial"); // 빠진 항목이 있으므로 언제나 부분합
}

// ─────────────────────────────────────────────
// FE-A04 자금 갭
//
// F01-10: MVP는 자동 갭(원화) 계산을 하지 않는다.
// 그래서 이 엔진이 내는 것은 '날짜' 둘뿐이다.
//   현금 소진 시점 = 오늘 + 런웨이
//   조달 마감일    = 현금 소진 시점 − 조달 소요 기간(F01-06 또는 F01-07)
// ─────────────────────────────────────────────
export type GapValues = {
  gap_now: null;
  gap_currency_note: string | null;
  shortfall_date: string | null;
  fundraising_lead_m: number | null;
  raise_deadline: string | null;
  planned_raise_conflict: boolean;
};

export async function FE_A04(
  runway: RunwayValues,
  finState: string | undefined,
  opts: { planned_raise_date?: string } = {}
): Promise<EngineResult<GapValues>> {
  const ctx = new Ctx("FE-A04");
  const rules = await f01Rules();

  const noGap = ctx.use(byTag(rules, "F01-10"));

  const empty: GapValues = {
    gap_now: null, gap_currency_note: ruleText(noGap),
    shortfall_date: null, fundraising_lead_m: null,
    raise_deadline: null, planned_raise_conflict: false,
  };

  if (runway.runway_m == null) return ctx.none(empty, "런웨이가 없어 소진 시점을 잡을 수 없습니다");

  // 상장사(S5)면 조달이 빠르다 — 어느 규칙을 쓰는지는 재무 상태가 정한다
  const leadRule = ctx.use(finState === "S5" ? byTag(rules, "F01-07") : byTag(rules, "F01-06"));
  const lead = monthsInRule(leadRule);
  if (lead == null) ctx.lack("조달 소요 기간");

  const shortfall = addMonths(new Date(), runway.runway_m);
  const deadline = lead != null ? addMonths(shortfall, -lead) : null;

  let conflict = false;
  if (opts.planned_raise_date) {
    conflict = new Date(opts.planned_raise_date) > shortfall;
    if (conflict) {
      const c = ctx.use(byTag(rules, "F01-08"));
      ctx.badge(ruleText(c) ?? "");
    }
  }

  return ctx.done({
    gap_now: null,
    gap_currency_note: ruleText(noGap),
    shortfall_date: shortfall.toISOString().slice(0, 10),
    fundraising_lead_m: lead,
    raise_deadline: deadline ? deadline.toISOString().slice(0, 10) : null,
    planned_raise_conflict: conflict,
  });
}

// ─────────────────────────────────────────────
// FE-A05 런웨이 커버리지 비율 (RCR)
//
//   RCR = 확정 조달 포함 런웨이(개월) ÷ 목표 시점까지 필요 기간(개월)
//   밴드: F01-03(≥1.5 양호) / F01-04(1.0~1.5 주의) / F01-05(<1.0 미달)
//
// 목표 시점은 하나가 아니다.
//   비임상 회사라면  1차 = IND 제출,  2차 = P1 완료(기술이전 시점)
// 두 값을 다 내야 "IND까지는 되는데 P1 완료는 안 된다"를 말할 수 있다.
//
// 확률로 바꾸지 않는다. 비율과 밴드만 낸다.
//
// ⚠️ 지연 계수(F04-0097, 2.0x)는 '실제 모집기간 ≈ 계획의 2배'라는 뜻이라
//    등록부 산식의 (1 + delay_factor) 와 해석이 어긋난다.
//    기본값은 지연 없이 내고, 지연 반영값은 둘째 값으로만 병기한다. 대표 확인 필요.
// ─────────────────────────────────────────────
export type Band = "양호" | "주의" | "미달";

/** 돈이 버텨야 하는 시점 하나 */
export type Target = {
  /** 화면에 그대로 나가는 이름 — "IND 제출", "P1 완료" */
  label: string;
  months: number;
  /** 이 기간이 어디서 나왔는지 (근거 카드가 없으면 그 사실을 적는다) */
  note?: string;
  basis?: string[];
};

export type TargetResult = Target & {
  RCR: number;
  band: Band;
  band_text: string | null;
  raises_needed: number | null;
};

export type RcrValues = {
  targets: TargetResult[];
  /** 가장 나쁜 밴드 — 재무 칸 신호등이 이걸 따른다 */
  worst_band: Band | null;
  RCR_with_delay: number | null;
  delay_factor: number | null;
};

export async function FE_A05(
  runway: RunwayValues,
  targets: Target[]
): Promise<EngineResult<RcrValues>> {
  const ctx = new Ctx("FE-A05");
  const src = await chunkSource();
  const rules = await f01Rules();

  const empty: RcrValues = {
    targets: [], worst_band: null, RCR_with_delay: null, delay_factor: null,
  };

  if (runway.runway_m_committed == null) return ctx.none(empty, "런웨이가 없습니다");
  const usable = targets.filter((t) => t.months > 0);
  if (usable.length === 0) return ctx.none(empty, "목표 시점까지 기간이 없습니다");

  const out: TargetResult[] = [];

  for (const t of usable) {
    const rcr = runway.runway_m_committed / t.months;

    let band: Band;
    let rule: Chunk | null;
    if (rcr >= 1.5) { band = "양호"; rule = byTag(rules, "F01-03"); }
    else if (rcr >= 1.0) { band = "주의"; rule = byTag(rules, "F01-04"); }
    else { band = "미달"; rule = byTag(rules, "F01-05"); }
    ctx.use(rule);

    // 미달이면 변곡점 전에 몇 번 더 조달해야 하는가 (F01-05)
    const raises = band === "미달" && runway.runway_m_committed > 0
      ? Math.ceil(t.months / runway.runway_m_committed) - 1
      : null;

    for (const b of t.basis ?? []) ctx.basis.includes(b) || ctx.basis.push(b);
    if (t.note) ctx.note(`${t.label}: ${t.note}`);

    out.push({ ...t, RCR: rcr, band, band_text: ruleText(rule), raises_needed: raises });
  }

  const order: Band[] = ["미달", "주의", "양호"];
  const worst = order.find((b) => out.some((t) => t.band === b)) ?? null;

  // 지연 계수는 있으면 둘째 값으로만
  const f04 = await src.find({}, { domain: "F04", kind: "parameter" });
  const delayRow = f04.find((c) => field(c, "cost_kind") === "delay_factor" && num(c) !== null) ?? null;
  let withDelay: number | null = null;
  if (delayRow) {
    ctx.use(delayRow);
    const last = out[out.length - 1];
    withDelay = runway.runway_m_committed / (last.months * num(delayRow)!);
    ctx.badge("지연 반영값은 상세에만 표시합니다 — 기본값은 지연 없이 계산합니다");
  }

  return ctx.done({
    targets: out,
    worst_band: worst,
    RCR_with_delay: withDelay,
    delay_factor: delayRow ? num(delayRow) : null,
  });
}

// ─────────────────────────────────────────────
// FE-B10 하방·단일자산 노출
//
// 백업 자산의 rNPV 는 정식판이다(F01-15). MVP는 '무엇이 남는가'만 말한다.
// ─────────────────────────────────────────────
export type DownsideValues = {
  single_asset_flag: boolean;
  backup_assets: string[];
  sentence: string | null;
  value_if_fail: null;
};

export async function FE_B10(backups: string[] = []): Promise<EngineResult<DownsideValues>> {
  const ctx = new Ctx("FE-B10");
  const rules = await f01Rules();

  const single = backups.length === 0;
  const rule = ctx.use(byTag(rules, single ? "F01-14" : "F01-15"));

  const text = (ruleText(rule) ?? "").replace("{백업 목록}", backups.join(", "));

  ctx.note("실패 시 잔존가치(rNPV) 계산은 정식판입니다");

  return ctx.done(
    {
      single_asset_flag: single,
      backup_assets: backups,
      sentence: text || null,
      value_if_fail: null,
    },
    "partial"
  );
}
