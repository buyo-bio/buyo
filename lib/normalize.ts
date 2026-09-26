/**
 * ② 정규화 — 사용자 입력을 "조건 5개"로 바꾼다
 *
 * 설계서 v4 1장 ②단계 · 작동원리 도식 A②
 *
 *   입력 JSON  →  modality 태그 · 적응증 코드 · 단계 · rare · 관할
 *                 + 재무 상태 S1~S6 (FE-D01)
 *                 + 다음 변곡점 (FE-D02)
 *
 * 규칙 하나: 이름표를 코드에 적지 않는다.
 *   모달리티 대체 규칙은 T01 등록부 청크에서 읽는다.
 *   등록부가 바뀌면 코드를 안 고쳐도 동작이 따라 바뀐다.
 */
import { chunkSource } from "./engines/base";
import type { Chunk, Conditions, DiagnoseInput } from "./types";

// ─────────────────────────────────────────────
// T01 모달리티 등록부
// ─────────────────────────────────────────────
export type ModalityEntry = {
  tag: string;
  parent: string | null;
  label: string;
  inputLabel: string;
  /** "값 있음(...)" / "값 없음 → ..." / "값 미확보 → ..." */
  valueStatus: string;
  hasValue: boolean;
};

let registryCache: Map<string, ModalityEntry> | null = null;

export async function loadModalityRegistry(): Promise<Map<string, ModalityEntry>> {
  if (registryCache) return registryCache;

  const src = await chunkSource();
  const rows = await src.find({}, { domain: "T01" });
  const m = new Map<string, ModalityEntry>();

  for (const r of rows) {
    const meta = (r as any).meta ?? r;
    const tag = meta.tag ?? null;
    if (!tag) continue;
    const status = String(meta.value_status ?? "");
    m.set(tag, {
      tag,
      parent: meta.parent_tag ?? null,
      label: meta.label_ko ?? tag,
      inputLabel: meta.input_label ?? meta.label_ko ?? tag,
      valueStatus: status,
      // "값 있음(...)" 으로 시작하면 그 태그에 실제 숫자가 있다
      hasValue: status.startsWith("값 있음"),
    });
  }
  registryCache = m;
  return m;
}

/**
 * 고른 태그에 값이 없으면 어디서 빌려 쓸지 정한다.
 *
 * 예) antibody_bispecific → 값 미확보 → antibody_mAb 값 + 배지
 *     cell_TCRT          → 값 미확보 → cell_therapy 아래에 값 있는 형제(cell_CART)
 *     tpd / rna 등       → other. 값 없음 → 배지만 남기고 전체값으로
 */
export async function resolveModality(
  picked: string
): Promise<{ tag: string; requested: string; badge?: string; label: string }> {
  const reg = await loadModalityRegistry();
  const entry = reg.get(picked);

  // 등록부에 없는 값 → 그대로 두고 경고만
  if (!entry) {
    return {
      tag: picked, requested: picked, label: picked,
      badge: `등록부에 없는 모달리티(${picked}) — 전체 값으로 조회합니다`,
    };
  }

  if (entry.hasValue) {
    return { tag: entry.tag, requested: picked, label: entry.label };
  }

  // ① 등록부 문구에 대체 태그가 적혀 있으면 그걸 쓴다
  //    "값 미확보 → antibody_mAb 값 + 배지"
  const named = entry.valueStatus.match(/→\s*([a-zA-Z_]+)\s*값/);
  if (named) {
    const alt = reg.get(named[1]);
    if (alt?.hasValue) {
      return {
        tag: alt.tag, requested: picked, label: entry.label,
        badge: `${entry.label} 전용 값이 없어 ${alt.label} 값으로 표시합니다`,
      };
    }
  }

  // ② 같은 부모 아래에서 값 있는 형제를 찾는다
  if (entry.parent) {
    for (const e of reg.values()) {
      if (e.parent === entry.parent && e.hasValue) {
        return {
          tag: e.tag, requested: picked, label: entry.label,
          badge: `${entry.label} 전용 값이 없어 ${e.label} 값으로 표시합니다`,
        };
      }
    }
  }

  // ③ 아무 데도 없으면 모달리티 조건을 걸지 않는다(전체 값)
  return {
    tag: "", requested: picked, label: entry.label,
    badge: `${entry.label}에 해당하는 값이 아직 없어 전체 기준으로 표시합니다`,
  };
}

/**
 * 고른 태그부터 위로 올라가는 이름표 목록.
 *   antibody_bispecific → ["antibody_bispecific", "antibody"]
 * 규칙 F06-09 의 "상위 태그 허용" 이 이걸 쓴다.
 */
export async function modalityFamily(tag: string): Promise<string[]> {
  if (!tag) return [];
  const reg = await loadModalityRegistry();
  const out: string[] = [];
  let cur: string | null = tag;
  while (cur && !out.includes(cur)) {
    out.push(cur);
    cur = reg.get(cur)?.parent ?? null;
  }
  return out;
}

// ─────────────────────────────────────────────
// 적응증
//
// ⚠️ MVP 임시 표. 정식 적응증 등록부가 오면 이 표를 지우고
//    DB 조회로 바꾼다. 모르는 질환은 null(=전체)로 두고 추측하지 않는다.
// ─────────────────────────────────────────────
type IndEntry = { code: string; group: string | null; rare: "Y" | "N"; note?: string };

const INDICATIONS: Record<string, IndEntry> = {
  "진행성·전이성 고형암": { code: "MeSH:D009369", group: "항암", rare: "N" },
  "고형암":              { code: "MeSH:D009369", group: "항암", rare: "N" },
  "비소세포폐암":         { code: "MeSH:D002289", group: "항암", rare: "N" },
  "특발성 폐섬유증": {
    code: "ICD-10:J84.11", group: null, rare: "Y",
    note: "호흡기는 질환군 7개에 없어 전체 기준으로 조회합니다(2019 HIRA 12,031명 → 희귀 기준 해당)",
  },
  "만성 이식편대숙주질환": { code: "MeSH:D006086", group: null, rare: "Y" },
  "CLDN18.2 양성 위암·위식도접합부 선암": { code: "MeSH:D013274", group: "항암", rare: "N" },
  "위암":                { code: "MeSH:D013274", group: "항암", rare: "N" },
  "췌장암":              { code: "MeSH:D010190", group: "항암", rare: "N" },
};

export function resolveIndication(text: string): {
  code: string | null; group: string | null; rare: "Y" | "N"; note?: string;
} {
  const hit = INDICATIONS[text.trim()];
  if (hit) return { code: hit.code, group: hit.group, rare: hit.rare, note: hit.note };
  return {
    code: null, group: null, rare: "N",
    note: "적응증 코드를 찾지 못해 전체 기준으로 조회합니다",
  };
}

// ─────────────────────────────────────────────
// FE-D01 재무 상태 S1~S6
//
// 설계서 3-1 그대로. 우선순위 S6 > S5 > S2 > S3 > S4 > S1.
// 화면에 표시하지 않는 내부 분류다(어느 규칙을 적용할지 고르는 데만 쓴다).
// ─────────────────────────────────────────────
export type FinState = "S1" | "S2" | "S3" | "S4" | "S5" | "S6";

export function financeState(inp: {
  cash?: number;
  monthly_burn?: number;
  listed?: boolean;
  convertible?: boolean;
  grant_committed?: number;
  license_income_ttm?: number;
}): { state: FinState; runway_m: number | null } {
  const runway =
    inp.cash != null && inp.monthly_burn != null && inp.monthly_burn > 0
      ? inp.cash / inp.monthly_burn
      : null;

  if (runway != null && runway < 6) return { state: "S6", runway_m: runway };
  if (inp.listed) return { state: "S5", runway_m: runway };
  if (inp.convertible) return { state: "S2", runway_m: runway };

  const g = inp.grant_committed ?? 0;
  const c = inp.cash ?? 0;
  if (g + c > 0 && g / (g + c) > 0.3) return { state: "S3", runway_m: runway };

  if ((inp.license_income_ttm ?? 0) > 0) return { state: "S4", runway_m: runway };
  return { state: "S1", runway_m: runway };
}

// ─────────────────────────────────────────────
// FE-D02 다음 변곡점
//
// 설계서 3-1 그대로.
// ─────────────────────────────────────────────
export type Exit = "license_out" | "self_develop";

/** 단계 순서 — 출구 시점까지 거치는 단계를 잘라낼 때 쓴다 */
const PHASE_SEQ = ["preclinical", "P1", "P2", "P3", "NDA", "approved"];

/** 임상 값이 붙는 첫 단계. 비임상 회사는 P1 기준 값을 본다. */
export function clinicalPhase(phase: string): { phase: string; badge?: string } {
  if (phase !== "preclinical") return { phase };
  return {
    phase: "P1",
    badge: "비임상 단계라 확률·기간·비용은 임상 1상 진입 이후 기준으로 표시합니다",
  };
}

export function nextInflection(
  phase: string,
  exit: Exit,
  opts: { accelerated_oncology?: boolean; exit_point?: string } = {}
): { inflection: string; stages: string[] } {
  // 회사가 출구 시점을 직접 밝혔으면 그걸 따른다.
  // 예) 비임상 회사가 "P1 완료 후 기술이전" 이라고 하면 변곡점은 IND 제출이 아니라 P1 완료다.
  if (opts.exit_point) {
    const to = opts.exit_point.replace(/_complete$/, "");
    const from = PHASE_SEQ.indexOf(phase);
    const till = PHASE_SEQ.indexOf(to);
    if (from >= 0 && till >= from)
      return { inflection: opts.exit_point, stages: PHASE_SEQ.slice(from, till + 1) };
  }
  switch (phase) {
    case "preclinical":
      return { inflection: "IND_filing", stages: ["preclinical"] };
    case "P1":
      return exit === "license_out"
        ? { inflection: "P2_PoC_readout", stages: ["P1", "P2"] }
        : { inflection: "P3_start", stages: ["P1", "P2"] };
    case "P2":
      if (exit === "license_out")
        return { inflection: "P2_PoC_readout", stages: ["P2"] };
      return opts.accelerated_oncology
        ? { inflection: "NDA_filing", stages: ["P2"] }
        : { inflection: "P3_start", stages: ["P2"] };
    case "P3":
      return { inflection: "NDA_filing", stages: ["P3"] };
    case "NDA":
      return { inflection: "approval", stages: ["NDA"] };
    default:
      return { inflection: "unknown", stages: [] };
  }
}

export const INFLECTION_KO: Record<string, string> = {
  P1_complete: "임상 1상 완료",
  IND_filing: "임상시험계획 신청",
  P2_PoC_readout: "2상 개념증명 결과",
  P3_start: "3상 시작",
  NDA_filing: "허가 신청",
  approval: "승인",
  unknown: "미정",
};

// ─────────────────────────────────────────────
// 전부 묶어서 — 입력 → 조건 5개
// ─────────────────────────────────────────────
export async function normalize(
  inp: DiagnoseInput & {
    listed?: boolean;
    convertible?: boolean;
    grant_committed?: number;
    license_income_ttm?: number;
    accelerated_oncology?: boolean;
    exit_point?: string;
  }
): Promise<{ cond: Conditions; badges: string[] }> {
  const badges: string[] = [];

  const mod = await resolveModality(inp.modality);
  if (mod.badge) badges.push(mod.badge);

  const ind = resolveIndication(inp.indication);
  if (ind.note) badges.push(ind.note);

  const fin = financeState({
    cash: inp.cash,
    monthly_burn: inp.monthly_burn,
    listed: inp.listed,
    convertible: inp.convertible,
    grant_committed: inp.grant_committed,
    license_income_ttm: inp.license_income_ttm,
  });

  const nx = nextInflection(inp.phase, inp.exit_route, {
    accelerated_oncology: inp.accelerated_oncology,
    exit_point: inp.exit_point,
  });

  const cp = clinicalPhase(inp.phase);
  if (cp.badge) badges.push(cp.badge);

  const cond: Conditions = {
    modality: mod.tag,
    modality_badge: mod.badge,
    indication_code: ind.code,
    disease_group: ind.group,
    phase: inp.phase,
    clinical_phase: cp.phase,
    rare: ind.rare,
    jurisdiction: "KR",
    fin_state: fin.state,
    next_inflection: nx.inflection,
  };

  return { cond, badges };
}
