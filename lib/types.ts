/**
 * 청크 스키마 + 검사 규칙 V-00 ~ V-10
 *
 * 설계서 부록 A(청크 스키마 v2)와 5장(validate 규칙)을 그대로 옮긴 것.
 * 이 파일 하나가 "타입 정의"이자 "검사기"다.
 */
import { z } from "zod";

// ─────────────────────────────────────────────
// 값 목록
// ─────────────────────────────────────────────
export const KINDS = ["parameter", "rule", "method", "mapping"] as const;
export const FLAGS = ["positive", "caution", "neutral"] as const;
export const BASIS = ["cumulative", "conditional"] as const;

/** 화면에서 고르는 개발 단계 */
export const PHASES = [
  "preclinical", "P1", "P2", "P3", "NDA", "approved",
] as const;

/**
 * 모달리티 — T01 등록부(22개) 기준.
 * 화면 선택지도 이 목록을 따른다.
 */
export const MODALITIES = [
  "small_molecule",
  "antibody", "antibody_mAb", "antibody_bispecific",
  "antibody_fragment", "antibody_Fc_fusion", "antibody_other",
  "ADC",
  "cell_therapy", "cell_CART", "cell_TCRT", "cell_NK", "cell_MSC",
  "cell_iPSC", "cell_somatic", "cell_DC_CIK", "cell_other",
  "gene_therapy", "peptide", "vaccine", "biosimilar", "other",
] as const;

/** 질환군 7개 (axes_v3) */
export const DISEASE_GROUPS = [
  "전체", "항암", "감염", "대사·내분비", "심혈관",
  "중추신경(신경)", "중추신경(정신)",
] as const;

// ─────────────────────────────────────────────
// 청크
// ─────────────────────────────────────────────
const Source = z.object({
  type: z.string().optional(),
  title: z.string().optional(),
  publisher: z.string().optional(),
  year: z.number().nullable().optional(),
  page: z.unknown().optional(),
  figure: z.unknown().optional(),
  subgroup: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
}).passthrough();

export const ChunkSchema = z.object({
  // V-00 필수 7필드
  chunk_id: z.string(),
  domain_id: z.string(),
  layer: z.enum(KINDS),                          // V-01 layer enum
  text: z.string().min(1),
  trust_tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  temporal_validity: z.string().nullable().optional(),
  tenant_id: z.string().optional(),

  // 값
  //
  // 보통 숫자지만 "120000-300000" 같은 범위는 문자열로 들어온다.
  // 문자열이면 statistic 에 range 를 밝혀야 한다(아래 검사).
  value: z.union([z.number(), z.string()]).nullable().optional(),
  statistic: z.string().nullable().optional(),
  unit: z.string().nullable().optional(),
  probability_basis: z.enum(BASIS).nullable().optional(),
  reported_n: z.number().nullable().optional(),

  // 필터 5개 (null = 모든 경우에 해당)
  modality: z.string().nullable().optional(),
  indication: z.union([z.string(), z.object({}).passthrough()]).nullable().optional(),
  phase: z.string().nullable().optional(),
  phase_to: z.string().nullable().optional(),
  rare: z.string().nullable().optional(),
  jurisdiction: z.string().nullable().optional(),

  // 판정·표시
  flag_hint: z.enum(FLAGS).nullable().optional(),
  badges: z.array(z.string()).optional(),
  illustrative: z.boolean().optional(),
  pending: z.string().nullable().optional(),

  // 역추적
  source: Source.nullable().optional(),
  source_record_id: z.unknown().optional(),
  engine_id: z.string().nullable().optional(),
}).passthrough();

export type Chunk = z.infer<typeof ChunkSchema>;

// ─────────────────────────────────────────────
// V-00 ~ V-10 검사
// 설계서 5장 그대로. 통과 못 하면 이유를 문자열로 돌려준다.
// ─────────────────────────────────────────────
const ID_RE = /^[A-Z]{1,3}[-]?\d{2}-\d{4}$/;

export function validateChunk(c: Chunk): string[] {
  const e: string[] = [];

  // V-00 필수 필드
  if (!c.chunk_id) e.push("V-00 chunk_id 없음");
  if (!c.domain_id) e.push("V-00 domain_id 없음");
  if (!c.text?.trim()) e.push("V-00 text 비어 있음");
  if (!c.trust_tier) e.push("V-00 trust_tier 없음");

  // V-02 ID 형식
  if (c.chunk_id && !ID_RE.test(c.chunk_id))
    e.push(`V-02 ID 형식 위반: ${c.chunk_id}`);

  // V-03 parameter 완전성 — value·unit·출처가 다 있어야 한다
  //
  // 예외: unit이 "deal_record" 인 M03 기술이전 딜 카드.
  // 숫자가 하나가 아니라 계약금·총규모·로열티로 여러 개라서
  // value를 비우고 deal 객체에 담는다. 이건 정상이다.
  if (c.layer === "parameter") {
    const isRecordLike = c.unit === "deal_record";
    if (!isRecordLike && (c.value === null || c.value === undefined))
      e.push("V-03 parameter에 value 없음");
    if (!c.unit) e.push("V-03 parameter에 unit 없음");
    if (c.source_record_id === undefined || c.source_record_id === null)
      e.push("V-03 parameter에 source_record_id 없음");
  }

  // 범위 문자열은 statistic 으로 그 사실을 밝혀야 한다
  if (typeof c.value === "string" && !/range/i.test(c.statistic ?? ""))
    e.push(`값이 문자열(${c.value})인데 statistic에 range 표시가 없음`);

  // V-04 확률이면 누적/조건부를 밝혀야 한다
  //
  // "%"라고 다 확률은 아니다. 비용 비중(cost_share)이나 등록 분포처럼
  // 그냥 비율인 것도 있다. 성공확률 카드(C01)에만 건다.
  if (
    c.unit === "%" &&
    c.layer === "parameter" &&
    c.domain_id === "C01" &&
    !c.probability_basis
  )
    e.push("V-04 성공확률인데 probability_basis(누적/조건부) 없음");

  // V-05 rule 청크에는 숫자를 넣지 않는다
  if (c.layer === "rule" && c.value !== null && c.value !== undefined)
    e.push("V-05 rule 청크에 value가 들어 있음");

  // V-06 등급 1은 고칠 수 없어야 한다
  const ov = (c as any).override_capability;
  if (c.trust_tier === 1 && ov && ov !== "immutable")
    e.push("V-06 trust_tier 1 인데 immutable 아님");

  // V-09 유효기간 지남
  if (c.temporal_validity && c.temporal_validity !== "계속") {
    const end = c.temporal_validity.split("/")[1]?.trim();
    if (end && end !== "계속" && /^\d{4}-\d{2}$/.test(end)) {
      const now = new Date().toISOString().slice(0, 7);
      if (end < now && !(c.badges ?? []).includes("expired"))
        e.push(`V-09 유효기간 지남(${end}) — expired 배지 없음`);
    }
  }

  return e;
}

// ─────────────────────────────────────────────
// 진단 입력 · 조건
// ─────────────────────────────────────────────
export const DiagnoseInput = z.object({
  modality: z.enum(MODALITIES),
  indication: z.string().min(1),
  phase: z.enum(PHASES),
  exit_route: z.enum(["license_out", "self_develop"]).default("license_out"),
  /** 회사가 밝힌 출구 시점 — "P1_complete" 처럼. 없으면 등록부 기본값 */
  exit_point: z.string().optional(),

  // 설계안
  endpoint: z.string().optional(),
  comparator: z.string().optional(),
  n: z.number().optional(),
  duration_m: z.number().optional(),

  // 재무 (억 원)
  cash: z.number().optional(),
  monthly_burn: z.number().optional(),
  committed_raise: z.number().optional(),
  planned_raise: z.number().optional(),

  // 회사
  corp_name: z.string().optional(),
  stock_code: z.string().optional(),
});
export type DiagnoseInput = z.infer<typeof DiagnoseInput>;

/** ②정규화가 내놓는 조건 5개 */
export type Conditions = {
  modality: string;            // T01 태그
  modality_badge?: string;     // "이중항체 값 미확보 → 단클론항체 값 사용"
  indication_code: string | null;
  disease_group: string | null;
  phase: string;
  /** 임상 값이 붙는 단계 — 비임상이면 P1. 확률·기간·비용 조회는 이걸 쓴다 */
  clinical_phase?: string;
  rare: "Y" | "N";
  jurisdiction: string;        // "KR"
  fin_state?: string;          // S1~S6
  next_inflection?: string;
};
