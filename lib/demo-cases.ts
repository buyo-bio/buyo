/**
 * 시연 3건 입력 프리셋
 *
 * 발표 때 버튼 하나로 불러오는 값이다.
 * 결과 자체는 runs 에 미리 저장해 두고 GET 으로 읽는다(네트워크가 끊겨도 돌게).
 */
export type DiagnoseForm = {
  modality: string;
  indication: string;
  phase: string;
  exit_route: "license_out" | "self_develop";
  /** 회사가 밝힌 출구 시점 — "P1_complete" 등. 비우면 등록부 기본값 */
  exit_point: string;
  endpoint: string;
  comparator: string;
  n: string;
  duration_m: string;
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
};

export const EMPTY_FORM: DiagnoseForm = {
  modality: "", indication: "", phase: "", exit_route: "license_out", exit_point: "",
  endpoint: "", comparator: "단일군", n: "", duration_m: "",
  cash: "", restricted_cash: "", monthly_burn: "", committed_raise: "", planned_raise: "",
  listed: false, convertible: false, license_income_ttm: "", corp_name: "",
  backup_assets: [], targets: [],
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
      phase: "P1", exit_route: "license_out",
      endpoint: "ORR", comparator: "단일군", n: "", duration_m: "24",
      cash: "560", restricted_cash: "", monthly_burn: "49",
      committed_raise: "0", planned_raise: "0",
      listed: true, license_income_ttm: "1",
      backup_assets: ["ABL001", "ABL111"],
    },
  },
  B: {
    label: "B · SB17170", run_id: "case-B",
    form: {
      ...EMPTY_FORM,
      corp_name: "SPARK Biopharma",
      modality: "small_molecule",
      indication: "특발성 폐섬유증",
      phase: "P2", exit_route: "license_out",
      endpoint: "FVC 변화량", comparator: "위약 대조", n: "120", duration_m: "52",
      cash: "120", restricted_cash: "", monthly_burn: "8",
      committed_raise: "0", planned_raise: "0",
      listed: false, license_income_ttm: "",
    },
  },
  C: {
    label: "C · LMB-201", run_id: "case-C",
    form: {
      ...EMPTY_FORM,
      corp_name: "(주)루미어스바이오(가상)",
      modality: "ADC",
      indication: "CLDN18.2 양성 위암·위식도접합부 선암",
      phase: "preclinical", exit_route: "license_out",
      exit_point: "P1_complete",   // 회사 목표: P1 완료 후 기술이전
      endpoint: "DLT·RP2D", comparator: "단일군", n: "36", duration_m: "24",
      // 억 원. 정부과제 전용 9억은 런웨이에서 뺀다(F01-13)
      cash: "58", restricted_cash: "9", monthly_burn: "3.1",
      committed_raise: "0", planned_raise: "150",
      listed: false,
      convertible: true,          // RCPS 58억 → FE-D01 S2
      license_income_ttm: "",
      backup_assets: ["LMB-305(탐색 단계)"],
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
  return {
    modality: f.modality,
    indication: f.indication.trim(),
    phase: f.phase,
    exit_route: f.exit_route,
    exit_point: f.exit_point || undefined,
    endpoint: f.endpoint || undefined,
    comparator: f.comparator || undefined,
    n: n(f.n),
    duration_m: n(f.duration_m),
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
  };
}
