/**
 * applies_when 이 묻는 칸 38개를 한 군데서 모은다
 *
 * 규칙 청크의 applies_when 은 "endpoint_type == 'surrogate'" 처럼
 * 사용자 입력·엔진 결과를 섞어 묻는다. 그 칸 이름은
 * enums_v1.json 의 applies_when_fields 가 정본이다.
 *
 * 여기서 하는 일은 모으기뿐이다. 없는 값을 추정해 채우지 않는다 —
 * 채우면 "확인 필요" 가 "해당 없음" 으로 바뀌어 거짓 판정이 된다.
 * 안 받은 칸은 넣지 않는다. 평가기가 그걸 "확인 필요" 로 돌려준다.
 */
import type { Conditions } from "./types";
import type { Facts } from "./applies-when";
import { MODALITY_PARENT } from "./enums";
import { judgeToRequest } from "./judge-fields";

/** 설계안·회사 칸 — 화면에서 받은 그대로 */
export type FactInput = {
  /** 출구 전략 — license_out · self_develop */
  exit_route?: string;

  /**
   * 국내 희귀 요건 판정 — M02 가 만든다(사용자에게 묻지 않는다).
   * 규제 규칙은 이제 rare 가 아니라 rare_kr 을 본다(대표님 20261004_1709).
   * 모르면 'unknown' 을 넣는다 — 비우면 "판정 보류" 안내(R02-0016)도 안 나온다.
   */
  rare_kr?: string;

  // 설계안
  endpoint_type?: string;
  comparator?: string;
  blinding?: string;
  design_type?: string;
  population?: string;
  population_type?: string;
  planned_n?: number;
  duration_months?: number;
  primary_endpoints_n?: number;
  multiplicity_plan?: string;
  margin_specified?: string;
  chronic?: string;
  /** CT.gov 같은 시험의 1사분위 인원 — 엔진이 채운다 */
  ctgov_n_q1?: number;

  // 규제 자기신고 (아직 화면에 칸이 없으면 안 넣는다)
  serious_unmet?: string;
  life_threatening?: string;
  no_alternative?: string;
  sanjeong_teukrye?: string;
  companion_dx?: string;
  cosmetic?: string;
  improvement_claim?: string;
  novelty?: string;
  pediatric_plan?: string;
  platform_flag?: string;
  has_target_evidence?: string;

  // 재무 — 엔진 결과
  rcr?: number;
  cashout_months?: number;
  committed_raise?: number;
  raise_after_cashout?: string;
  backup_n?: number;
};

/**
 * 조건 + 입력 → 사실 묶음.
 *
 * null·undefined·빈 문자열은 넣지 않는다. "안 받았다" 와 "N 이다" 는 다르다.
 */
export function buildFacts(cond: Conditions, inp: FactInput = {}): Facts {
  const f: Facts = {};
  const put = (k: string, v: unknown) => {
    if (v === null || v === undefined || v === "") return;
    f[k] = v;
  };

  // ── 조건 다섯 개에서 바로 오는 것
  put("modality", cond.modality);
  put("parent_modality", cond.modality ? MODALITY_PARENT[cond.modality] : undefined);
  put("phase", cond.phase);
  put("rare", cond.rare);
  put("disease_group", cond.disease_group);
  put("ta", cond.therapeutic_area);
  put("financial_state", cond.fin_state);
  // 관할은 목록으로 묻는다 — "'KR' in jurisdictions"
  put("jurisdictions", cond.jurisdiction ? [cond.jurisdiction] : undefined);

  // ── 화면·엔진에서 온 것
  for (const [k, v] of Object.entries(inp)) put(k, v);

  return f;
}

/**
 * 진단 입력 한 덩어리 → 사실 묶음.
 *
 * 파이프라인과 검사 스크립트가 같은 함수를 쓴다.
 * 각자 필드를 골라 넘기면 새로 생긴 칸이 조용히 빠진다 —
 * 이 프로젝트에서 두 번 그랬다(치료영역, 그리고 자기신고 칸).
 */
export function factsFromInput(
  cond: Conditions,
  input: Record<string, unknown>,
  engine: { rcr?: number; backup_n?: number; rare_kr?: string } = {}
): Facts {
  const num = (v: unknown) => (typeof v === "number" ? v : undefined);
  const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : undefined);

  return buildFacts(cond, {
    exit_route: str(input.exit_route),

    // 회사가 직접 적었으면 그 값이 먼저다. 없으면 M02 판정을 쓴다.
    rare_kr: str(input.rare_kr) ?? engine.rare_kr ?? "unknown",

    // 설계안 — 숫자 칸
    comparator: str(input.comparator),
    planned_n: num(input.planned_n) ?? num(input.n),
    duration_months: num(input.duration_m),
    primary_endpoints_n: num(input.primary_endpoints_n),
    ctgov_n_q1: num(input.ctgov_n_q1),

    // 재무 — 엔진이 낸 값
    rcr: engine.rcr,
    committed_raise: num(input.committed_raise),
    cashout_months: num(input.cashout_months),
    raise_after_cashout: str(input.raise_after_cashout),
    backup_n: engine.backup_n
      ?? (Array.isArray(input.backup_assets) ? input.backup_assets.length : undefined),

    // 자기신고 — 등록부 칸 그대로. 빈 글자는 judgeToRequest 가 이미 뺐다.
    ...judgeToRequest(input as Record<string, string>),
  });
}
