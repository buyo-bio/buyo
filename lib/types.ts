/**
 * 청크 스키마 + 검사 규칙 V-00 ~ V-10
 *
 * 설계서 부록 A(청크 스키마 v2)와 5장(validate 규칙)을 그대로 옮긴 것.
 * 이 파일 하나가 "타입 정의"이자 "검사기"다.
 */
import { z } from "zod";
import { isKnownDomain, MODALITY_TAGS, DISEASE_GROUPS as ENUM_DISEASE_GROUPS } from "./enums";
import { JUDGE_KEYS } from "./judge-fields";

/** 자기신고 칸은 등록부에서 그대로 받는다 — 빈 글자는 안 온다(폼이 빼고 보낸다) */
const JUDGE_SHAPE = Object.fromEntries(
  JUDGE_KEYS.map((k) => [k, z.string().min(1).optional()])
) as Record<string, z.ZodOptional<z.ZodString>>;

// ─────────────────────────────────────────────
// 값 목록
// ─────────────────────────────────────────────
export const KINDS = ["parameter", "rule", "method", "mapping"] as const;
export const FLAGS = ["positive", "caution", "neutral"] as const;
/**
 * 확률의 종류.
 *
 * 성공확률(C01)은 누적이냐 조건부냐를 반드시 밝혀야 한다(V-04).
 * 다만 이 칸은 그 둘만 담지 않는다 — 표본수·검정력 엔진(CE-09~13)이
 * 들어오면서 power·type_I_error·confidence_level·not_probability 가 생겼다.
 * 값 목록을 여기에 박아 두면 대표님이 새 종류를 더할 때마다 적재가 막힌다.
 * 그래서 글자로 받고, "누적/조건부 중 하나여야 하는 자리"만 V-04 로 거른다.
 */
export const BASIS = ["cumulative", "conditional"] as const;

/** 화면에서 고르는 개발 단계 */
export const PHASES = [
  "preclinical", "P1", "P2", "P3", "NDA", "approved",
] as const;

/**
 * 모달리티 — enums_v1.json 이 정본이다(T01 등록부와 같은 목록).
 * 손으로 적어 두면 새 태그가 생길 때 어긋난다. 실제로 22개에 멈춰 있었다.
 */
export const MODALITIES = MODALITY_TAGS as [string, ...string[]];

/** 질환군 — enums_v1.json 의 disease_group (전체·항암·감염·대사·심혈관·신경·정신·기타) */
export const DISEASE_GROUPS = ENUM_DISEASE_GROUPS;

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
  probability_basis: z.string().nullable().optional(),
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
// 청크 ID 는 "<도메인>-<네 자리>" 다. 도메인 목록은 enums_v1.json 이 정본이다.
//   예전 정규식 /^[A-Z]{1,3}-?\d{2}-\d{4}$/ 는 글자가 뒤에 오는 R02X 를 막았다.
const ID_RE = /^([A-Z][A-Z0-9]{1,4})-(\d{4})$/;

export function validateChunk(c: Chunk): string[] {
  const e: string[] = [];

  // V-00 필수 필드
  if (!c.chunk_id) e.push("V-00 chunk_id 없음");
  if (!c.domain_id) e.push("V-00 domain_id 없음");
  if (!c.text?.trim()) e.push("V-00 text 비어 있음");
  if (!c.trust_tier) e.push("V-00 trust_tier 없음");

  // V-02 ID 형식 + 등록된 도메인인가
  if (c.chunk_id) {
    const m = ID_RE.exec(c.chunk_id);
    if (!m) e.push(`V-02 ID 형식 위반: ${c.chunk_id}`);
    else if (!isKnownDomain(m[1]))
      e.push(`V-02 등록되지 않은 도메인: ${m[1]} (enums_v1.json 의 domain_id 에 없음)`);
  }

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

  // 값이 숫자 하나가 아니면, 무엇인지 밝혀야 한다
  //
  // 검사의 뜻: value를 숫자로 읽는 엔진이 NaN을 집어 들지 않게 막는 것이다.
  // 숫자 하나가 아닌 모양은 지금 두 가지뿐이다.
  //   ① 범위 — statistic 에 range 라고 적어 밝힌다 ("10-20", statistic: "range")
  //   ② 열거된 집합 — 쌍반점으로 잇는다 ("P3;NDA", "80;90")
  // 쌍반점은 숫자 하나에도, 범위 표기에도 쓰이지 않으므로 그 자체가 표시다.
  // 집합을 범위로 적으라고 하면 뜻이 달라진다 — "80;90"은 80 과 90 두 기준에서
  // 각각 계산한다는 뜻이고, 80 에서 90 사이가 아니다.
  if (typeof c.value === "string") {
    const parts = c.value.split(";").map((x) => x.trim());
    const isSet = parts.length >= 2 && parts.every(Boolean);
    if (!isSet && !/range/i.test(c.statistic ?? ""))
      e.push(`값이 문자열(${c.value})인데 statistic에 range 표시가 없음`);
  }

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

  // C01 성공확률 자리에는 누적·조건부만 온다. 다른 종류가 섞이면 곱셈 규칙이 깨진다.
  if (
    c.domain_id === "C01" &&
    c.layer === "parameter" &&
    c.unit === "%" &&
    c.probability_basis &&
    !(BASIS as readonly string[]).includes(c.probability_basis)
  )
    e.push(`V-04 성공확률의 probability_basis 가 누적/조건부가 아님: ${c.probability_basis}`);

  // V-05 rule 청크에는 숫자를 넣지 않는다
  if (c.layer === "rule" && c.value !== null && c.value !== undefined)
    e.push("V-05 rule 청크에 value가 들어 있음");

  // V-06 등급 1은 고칠 수 없어야 한다
  const ov = (c as any).override_capability;
  if (c.trust_tier === 1 && ov && ov !== "immutable")
    e.push("V-06 trust_tier 1 인데 immutable 아님");

  // V-09 유효기간 지남
  //
  // 예외: no_successor_reference 배지.
  //   "대체할 후속 공개 자료가 존재하지 않는 업계 표준값"이라는 뜻이다.
  //   비임상→1상 전환(Paul 2010)이 그렇다 — Citeline·BIO·IQVIA 가 1상부터
  //   집계해서 더 새 자료가 아예 없다. 기간이 지났다고 내리면 그 자리가 영영 빈다.
  if (c.temporal_validity && c.temporal_validity !== "계속") {
    const end = c.temporal_validity.split("/")[1]?.trim();
    if (end && end !== "계속" && /^\d{4}-\d{2}$/.test(end)) {
      const now = new Date().toISOString().slice(0, 7);
      const bs = c.badges ?? [];
      if (end < now && !bs.includes("expired") && !bs.includes("no_successor_reference"))
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

  // ── 자동완성에서 고른 값 (목록에서 골랐을 때만 온다)
  //
  // 손으로 적은 글자만으로는 질환군을 알 수 없다. 골랐으면 화면이 같이 보내 준다.
  // 안 보내면 ②정규화가 예전처럼 글자로 찾아보고, 못 찾으면 질환군 없이 돈다.
  /** 1층 "MeSH:D003924" / 2층 "KCD:E11" */
  indication_code: z.string().optional(),
  disease_group: z.string().optional(),
  /** 세부 치료영역 — 질환군 아래 한 겹 (endocrine, oncology_solid …) */
  therapeutic_area: z.string().optional(),
  /** CT.gov 조회어. 한글로는 안 잡힌다 */
  query_en: z.string().optional(),
  rare: z.enum(["Y", "N"]).optional(),
  phase: z.enum(PHASES),
  exit_route: z.enum(["license_out", "self_develop"]).default("license_out"),
  /** 회사가 밝힌 출구 시점 — "P1_complete" 처럼. 없으면 등록부 기본값 */
  exit_point: z.string().optional(),

  // 설계안
  endpoint: z.string().optional(),
  comparator: z.string().optional(),
  n: z.number().optional(),
  duration_m: z.number().optional(),
  /** 이번 라운드 희석률(%) — F02-0004~0006 이 쓴다 */
  dilution_min_pct: z.number().optional(),
  dilution_max_pct: z.number().optional(),
  primary_endpoints_n: z.number().optional(),

  // 판정 자기신고 — 칸 이름과 고를 수 있는 값은 lib/judge-fields.ts 등록부가 정본이다.
  //
  // 여기서 값 목록을 z.enum 으로 묶지 않는다. 등록부에 칸을 하나 더할 때마다
  // 이 파일도 고쳐야 하고, 빠뜨리면 값이 조용히 버려진다. 글자로 받고
  // 걸러내는 일은 applies_when 평가기가 한다 — 모르는 값은 그냥 안 맞는 값이다.
  ...JUDGE_SHAPE,

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
  /** 세부 치료영역. 질환군 아래 한 겹 — 조회 우선순위에서 질환군보다 먼저 본다 */
  therapeutic_area?: string | null;
  /** CT.gov 조회어(영문). 한글 적응증명으로는 안 잡힌다 */
  query_en?: string | null;
  /** 적응증 마스터의 name_ko — M02 국내 환자 수가 이 이름으로 걸려 있다 */
  indication_name?: string | null;
  phase: string;
  /** 임상 값이 붙는 단계 — 비임상이면 P1. 확률·기간·비용 조회는 이걸 쓴다 */
  clinical_phase?: string;
  rare: "Y" | "N";
  jurisdiction: string;        // "KR"
  fin_state?: string;          // S1~S6
  next_inflection?: string;
};
