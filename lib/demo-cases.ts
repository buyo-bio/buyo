/**
 * 시연 3건 입력 프리셋
 *
 * 발표 때 버튼 하나로 불러오는 값이다.
 * 결과 자체는 runs 에 미리 저장해 두고 GET 으로 읽는다(네트워크가 끊겨도 돌게).
 */
/**
 * 자동완성에서 고른 적응증.
 *
 * 손으로 적은 글자만으로는 질환군을 알 수 없다(대표님이 짚으신 "당뇨 → 질환군 미상").
 * 목록에서 고르면 질환군·세부 치료영역·희귀 힌트가 같이 따라온다.
 * 고르지 않고 그냥 적으면 null 로 두고, 질환군은 사용자가 직접 고른다.
 */
export type PickedIndication = {
  /** 1층은 MeSH: + mesh_id, 2층은 KCD: + 코드 */
  code: string | null;
  disease_group: string | null;
  therapeutic_area: string | null;
  /** CT.gov 는 한글로 안 잡힌다. 영문 라벨로 건다 */
  query_en: string | null;
  rare: "Y" | "N" | null;
  layer: 1 | 2 | null;
};

import { JUDGE_KEYS, judgeToRequest } from "./judge-fields";

export type DiagnoseForm = {
  modality: string;
  indication: string;
  /** 목록에서 고른 경우에만 채워진다 */
  picked: PickedIndication | null;
  /** 목록에 없어서 질환군을 직접 고른 경우 */
  manual_group: string;
  manual_rare: "Y" | "N";
  phase: string;
  exit_route: "license_out" | "self_develop";
  /** 회사가 밝힌 출구 시점 — "P1_complete" 등. 비우면 등록부 기본값 */
  exit_point: string;
  endpoint: string;
  comparator: string;
  n: string;
  duration_m: string;
  /** 이번 라운드 희석률(%) — F02 규칙이 쓴다 */
  dilution_pct: string;
  primary_endpoints_n: string;
  cash: string;
  restricted_cash: string;
  monthly_burn: string;
  committed_raise: string;
  planned_raise: string;
  listed: boolean;
  convertible: boolean;
  license_income_ttm: string;
  corp_name: string;
  backup_assets: string[];
  /** 돈이 버텨야 하는 시점 — 비임상은 보통 두 개(IND 제출 · P1 완료) */
  targets: { label: string; months: number; note?: string }[];
  /**
   * 판정에 필요한 자기신고 — 칸 이름은 lib/judge-fields.ts 등록부가 정본이다.
   * 안 고른 칸은 빈 글자로 둔다. 빈 글자는 API 로 넘기지 않는다.
   */
  judge: Record<string, string>;
};

export const EMPTY_FORM: DiagnoseForm = {
  modality: "", indication: "", picked: null, manual_group: "", manual_rare: "N", phase: "", exit_route: "license_out", exit_point: "",
  endpoint: "", comparator: "", n: "", duration_m: "", primary_endpoints_n: "", dilution_pct: "",
  cash: "", restricted_cash: "", monthly_burn: "", committed_raise: "", planned_raise: "",
  listed: false, convertible: false, license_income_ttm: "", corp_name: "",
  backup_assets: [], targets: [],
  judge: Object.fromEntries(JUDGE_KEYS.map((k) => [k, ""])),
};

export type DemoKey = "A" | "B" | "C";

export const DEMO_CASES: Record<DemoKey, { label: string; run_id: string; form: DiagnoseForm }> = {
  A: {
    label: "A · ABL503", run_id: "case-A",
    form: {
      ...EMPTY_FORM,
      corp_name: "에이비엘바이오",
      modality: "antibody_bispecific",
      indication: "진행성·전이성 고형암",
      // 적응증 마스터(indication_master_v0_4.csv)에 적힌 값 그대로.
      // 화면에서 자동완성으로 고르면 이 값이 채워진다 — 시연은 미리 넣어 둔다.
      picked: { code: "MeSH:D009369", disease_group: "항암", therapeutic_area: "oncology_solid",
                query_en: "Neoplasms", rare: "N", layer: 1 },
      phase: "P1", exit_route: "license_out",
      endpoint: "ORR", comparator: "single_arm", n: "", duration_m: "24", primary_endpoints_n: "1",
      cash: "560", restricted_cash: "", monthly_burn: "49",
      committed_raise: "0", planned_raise: "0",
      listed: true, license_income_ttm: "1",
      backup_assets: ["ABL001", "ABL111"],
      // 회사가 밝힌 값. 안 밝힌 칸은 비워 둔다 — 화면에 "적으면 판정합니다" 로 나간다.
      judge: {
        ...EMPTY_FORM.judge,
        serious_unmet: "Y", life_threatening: "Y", no_alternative: "N",
        novelty: "new_entity", has_target_evidence: "Y", platform_flag: "Y",
        endpoint_type: "ORR", blinding: "open_label",
        design_type: "single_arm_descriptive", population: "all_comers",
        population_type: "patients", chronic: "N",
      },
    },
  },
  B: {
    label: "B · SB17170", run_id: "case-B",
    form: {
      ...EMPTY_FORM,
      corp_name: "SPARK Biopharma",
      modality: "small_molecule",
      indication: "특발성 폐섬유증",
      // 적응증 마스터(indication_master_v0_4.csv)에 적힌 값 그대로.
      // 화면에서 자동완성으로 고르면 이 값이 채워진다 — 시연은 미리 넣어 둔다.
      picked: { code: "MeSH:D054990", disease_group: "기타", therapeutic_area: "respiratory",
                query_en: "Idiopathic Pulmonary Fibrosis", rare: "Y", layer: 1 },
      phase: "P2", exit_route: "license_out",
      endpoint: "FVC 변화량", comparator: "placebo", n: "120", duration_m: "52", primary_endpoints_n: "1",
      cash: "120", restricted_cash: "", monthly_burn: "8",
      committed_raise: "0", planned_raise: "0",
      listed: false, license_income_ttm: "",
      judge: {
        ...EMPTY_FORM.judge,
        serious_unmet: "Y", life_threatening: "Y", no_alternative: "N",
        sanjeong_teukrye: "Y", novelty: "new_entity", has_target_evidence: "Y",
        endpoint_type: "surrogate", blinding: "double_blind",
        design_type: "superiority", population: "all_comers",
        population_type: "patients", chronic: "Y",
      },
    },
  },
  C: {
    label: "C · LMB-201", run_id: "case-C",
    form: {
      ...EMPTY_FORM,
      corp_name: "(주)루미어스바이오(가상)",
      modality: "ADC",
      indication: "CLDN18.2 양성 위암·위식도접합부 선암",
      // 적응증 마스터(indication_master_v0_4.csv)에 적힌 값 그대로.
      // 화면에서 자동완성으로 고르면 이 값이 채워진다 — 시연은 미리 넣어 둔다.
      picked: { code: "MeSH:D013274", disease_group: "항암", therapeutic_area: "oncology_solid",
                query_en: "Stomach Neoplasms", rare: "N", layer: 1 },
      phase: "preclinical", exit_route: "license_out",
      exit_point: "P1_complete",   // 회사 목표: P1 완료 후 기술이전
      endpoint: "DLT·RP2D", comparator: "single_arm", n: "36", duration_m: "24", primary_endpoints_n: "2",
      // 억 원. 정부과제 전용 9억은 런웨이에서 뺀다(F01-13)
      cash: "58", restricted_cash: "9", monthly_burn: "3.1",
      committed_raise: "0", planned_raise: "150",
      listed: false,
      convertible: true,          // RCPS 58억 → FE-D01 S2
      license_income_ttm: "",
      backup_assets: ["LMB-305(탐색 단계)"],
      judge: {
        ...EMPTY_FORM.judge,
        serious_unmet: "Y", life_threatening: "Y", no_alternative: "N",
        novelty: "new_entity", has_target_evidence: "Y", companion_dx: "Y",
        endpoint_type: "hard", blinding: "open_label",
        design_type: "single_arm_descriptive", population: "biomarker_selected",
        population_type: "patients", chronic: "N",
      },
      targets: [
        { label: "IND 제출", months: 8, note: "업계 기간 자료가 없어 회사 계획값 8개월을 적용했습니다" },
        { label: "P1 완료", months: 41.4, note: "IND까지 8개월 + 심사 1개월(근거 카드 없음) + 항암 P1→P2 2.7년" },
      ],
    },
  },
};

/** 필수 3항목 */
export function missingRequired(f: DiagnoseForm): string[] {
  const out: string[] = [];
  if (!f.modality) out.push("모달리티");
  if (!f.indication.trim()) out.push("적응증");
  if (!f.phase) out.push("개발 단계");
  return out;
}

/** 폼 문자열 → API 가 받는 모양 */
export function toRequest(f: DiagnoseForm, runId?: string) {
  const n = (v: string) => (v.trim() === "" ? undefined : Number(v));
  const p = f.picked;
  return {
    modality: f.modality,
    indication: f.indication.trim(),
    // 목록에서 고른 값. 없으면 보내지 않고, ②정규화가 글자로 찾아본다.
    indication_code: p?.code ?? undefined,
    disease_group: p?.disease_group ?? undefined,
    therapeutic_area: p?.therapeutic_area ?? undefined,
    query_en: p?.query_en ?? undefined,
    rare: p?.rare ?? undefined,
    phase: f.phase,
    exit_route: f.exit_route,
    exit_point: f.exit_point || undefined,
    endpoint: f.endpoint || undefined,
    comparator: f.comparator || undefined,
    n: n(f.n),
    duration_m: n(f.duration_m),
    // 희석률은 하나만 받는다. F02 규칙은 범위(min·max)로 물으므로 같은 값을 둘 다 넣는다 —
    // 구간 입력은 대표님이 F02-0003 에 "구간으로 넣으면 범위로 보여 준다" 로 적어 두셨고
    // 그건 아직 화면에 없다.
    dilution_min_pct: n(f.dilution_pct),
    dilution_max_pct: n(f.dilution_pct),
    primary_endpoints_n: n(f.primary_endpoints_n),
    cash: n(f.cash),
    restricted_cash: n(f.restricted_cash),
    monthly_burn: n(f.monthly_burn),
    planned_n: n(f.n),
    committed_raise: n(f.committed_raise),
    planned_raise: n(f.planned_raise),
    corp_name: f.corp_name || undefined,
    listed: f.listed || undefined,
    convertible: f.convertible || undefined,
    license_income_ttm: n(f.license_income_ttm),
    backup_assets: f.backup_assets.length ? f.backup_assets : undefined,
    targets: f.targets.length ? f.targets : undefined,
    run_id: runId,
    // 자기신고 — 고른 것만. 등록부가 칸 이름을 정하므로 여기서 또 적지 않는다.
    ...judgeToRequest(f.judge),
  };
}
