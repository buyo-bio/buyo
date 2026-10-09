/**
 * applies_when 칸 이름 → 화면 한글
 *
 * 평가기가 "serious_unmet 을 못 봤다" 고 돌려주면 화면에는
 * "중대한 미충족 수요 여부를 적어 주세요" 로 나가야 한다.
 *
 * 이름표의 정본은 대표님 labels.json 의 "입력 이름" 이다(81개).
 * 아래 표는 그 파일에 없는 이름만 메우는 보충이다 — 이름을 우리가 짓지 않는다.
 *
 * 전에는 이 표만 썼다. 그래서 묶음이 새 칸을 들고 올 때마다 화면에
 * 영어 칸 이름이 그대로 나갔다(실제로 trial_purpose · power 가 설계안
 * 카드에 노출됐다). 이제 labels.json 을 먼저 보므로 그 일이 안 생긴다.
 */
import labels from "../data/ref/labels.json";

const FROM_RELEASE: Record<string, string> =
  (labels as Record<string, Record<string, string>>)["입력 이름"] ?? {};

/** labels.json 에 없는 칸만 — 있으면 대표님 이름이 이깁니다 */
const EXTRA: Record<string, string> = {
  "serious_unmet": "중대한 미충족 수요 여부",
  "life_threatening": "생명을 위협하는 질환 여부",
  "no_alternative": "대체 치료제 유무",
  "sanjeong_teukrye": "산정특례 해당 여부",
  "companion_dx": "동반진단 필요 여부",
  "cosmetic": "미용 목적 여부",
  "improvement_claim": "개선 효과 주장 여부",
  "novelty": "신규성",
  "pediatric_plan": "소아 개발 계획",
  "platform_flag": "플랫폼 기술 여부",
  "has_target_evidence": "표적 근거 보유 여부",
  "endpoint_type": "평가변수 종류",
  "comparator": "대조군",
  "blinding": "눈가림",
  "design_type": "설계 유형",
  "population": "대상 집단",
  "population_type": "대상자 구분(환자/건강인)",
  "planned_n": "계획 대상자 수",
  "duration_months": "시험 기간(개월)",
  "primary_endpoints_n": "1차 평가변수 개수",
  "multiplicity_plan": "다중성 보정 계획",
  "margin_specified": "비열등성 한계 명시 여부",
  "chronic": "만성 질환 여부",
  "ctgov_n_q1": "같은 시험 1사분위 인원",
  "rcr": "자금 충족 비율",
  "cashout_months": "현금 소진까지 개월",
  "committed_raise": "확정 조달액",
  "raise_after_cashout": "소진 후 조달 예정 여부",
  "backup_n": "후속 자산 수",
  "exit_route": "출구 전략",
  "modality": "약 종류",
  "parent_modality": "상위 약 종류",
  "phase": "개발 단계",
  "rare": "희귀 여부",
  "disease_group": "질환군",
  "ta": "치료영역",
  "financial_state": "재무 상태",
  "jurisdictions": "대상 국가"
};

/**
 * 사용자가 적을 수 없는 칸 — 우리가 아직 못 모은 자료다.
 *
 * "같은 시험 1사분위 인원을 적으면 판정할 수 있습니다" 는 틀린 안내다.
 * 사용자는 그 숫자를 알 수 없다. CT.gov 수집이 들어오면 자동으로 채워진다.
 */
export const ENGINE_FACTS = new Set(["ctgov_n_q1", "cashout_months", "rcr", "financial_state"]);

/** 못 받은 칸이 전부 우리 쪽 자료인가 — 안내 문구가 달라진다 */
export function allEngineSide(fields: string[]): boolean {
  return fields.length > 0 && fields.every((f) => ENGINE_FACTS.has(f));
}

/** 사용자가 적을 수 있는 칸만 — 섞여 있으면 적을 수 있는 쪽만 묻는다 */
export function userSide(fields: string[]): string[] {
  return fields.filter((f) => !ENGINE_FACTS.has(f));
}

/**
 * 칸 이름 → 한글. labels.json 이 먼저, 없으면 보충표, 그것도 없으면 칸 이름.
 *
 * 마지막 갈래(칸 이름 그대로)는 화면에 영어가 나가는 경우다. 남겨 두지만
 * `npm run aw:check` 가 그런 칸이 있으면 알려 준다 — 조용히 새면 안 된다.
 */
export const FACT_LABEL: Record<string, string> = { ...EXTRA, ...FROM_RELEASE };

/** 이름표가 없는 칸 — 검사에서 쓴다 */
export function unlabeled(fields: string[]): string[] {
  return fields.filter((f) => !FACT_LABEL[f]);
}

/** 못 받은 칸들을 "A · B · C" 로 — 이름표가 없으면 칸 이름 그대로 */
export function factLabels(fields: string[]): string {
  return fields.map((f) => FACT_LABEL[f] ?? f).join(" · ");
}
