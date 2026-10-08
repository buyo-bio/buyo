/**
 * 판정에 필요한 자기신고 칸 등록부
 *
 * 규칙 청크의 applies_when 이 묻는 칸 중, 다른 데서 알아낼 수 없어
 * 사용자에게 직접 물어야 하는 것들이다.
 *
 *   "'KR' in jurisdictions and serious_unmet == 'Y'"
 *                             ↑ 이 칸을 안 받으면 우선심사를 판정할 수 없다.
 *
 * 왜 한 군데 모아 두는가
 *   화면 · 폼 타입 · API 전달을 따로 적어 두면 칸을 하나 더할 때 세 곳을 고쳐야 하고,
 *   한 곳을 빠뜨리면 값이 조용히 안 넘어간다. 이 프로젝트에서 실제로 그랬다
 *   (치료영역이 스크립트에서 빠져 항암 값이 전체 값으로 내려간 일).
 *   그래서 등록부 하나에서 화면을 그리고, 그대로 API 로 넘긴다.
 *
 * 값은 applies_when 이 비교하는 글자와 정확히 같아야 한다.
 * 화면에 보이는 것은 label, 넘어가는 것은 value 다.
 *
 * 안 고른 것은 빈 글자로 둔다 — "모름" 과 "아니다" 는 다르다.
 * 빈 글자는 넘기지 않고, 평가기가 "확인 필요" 로 돌려준다.
 */
export type JudgeField = {
  /** applies_when 칸 이름 (enums_v1.json 의 applies_when_fields) */
  key: string;
  label: string;
  hint?: string;
  /** 고를 수 있는 값 — [넘기는 값, 화면 글자] */
  options: [string, string][];
  group: "regulatory" | "design";
  /** 이 조건일 때만 묻는다 — 감염 치료제가 아니면 병원체를 물을 이유가 없다 */
  only_disease_group?: string;
};

const YN: [string, string][] = [["Y", "예"], ["N", "아니오"]];

export const JUDGE_FIELDS: JudgeField[] = [
  // ── 규제·판정 (R01 · R02 · R02X · M01 · T04)
  {
    key: "serious_unmet", group: "regulatory",
    label: "중대한 미충족 수요",
    hint: "우선심사·조건부 허가 판정에 씁니다",
    options: YN,
  },
  {
    key: "life_threatening", group: "regulatory",
    label: "생명을 위협하는 질환",
    options: YN,
  },
  {
    key: "no_alternative", group: "regulatory",
    label: "대체 치료제 없음",
    options: YN,
  },
  {
    key: "sanjeong_teukrye", group: "regulatory",
    label: "산정특례 해당",
    hint: "희귀·중증난치 산정특례 대상 상병인지",
    options: YN,
  },
  {
    key: "novelty", group: "regulatory",
    label: "신규성",
    hint: "허가 트랙과 자료요건이 갈립니다",
    options: [
      ["new_entity", "신규 물질"],
      ["new_salt", "염 변경"],
      ["new_route", "투여경로 변경"],
      ["new_formulation", "제형 변경"],
      ["new_combination", "복합제"],
      ["new_dose", "용량 변경"],
      ["new_indication", "적응증 추가"],
    ],
  },
  {
    key: "improvement_claim", group: "regulatory",
    label: "개선 효과 주장",
    hint: "기존 약보다 낫다고 표시·광고할 계획인지",
    options: YN,
  },
  {
    key: "pediatric_plan", group: "regulatory",
    label: "소아 개발 계획",
    options: YN,
  },
  {
    key: "companion_dx", group: "regulatory",
    label: "동반진단 필요",
    options: YN,
  },
  {
    key: "cosmetic", group: "regulatory",
    label: "미용 목적",
    options: YN,
  },
  {
    key: "has_target_evidence", group: "regulatory",
    label: "표적 근거 보유",
    hint: "표적-질환 연관 근거(유전학·임상)를 갖고 있는지",
    options: YN,
  },
  {
    key: "platform_flag", group: "regulatory",
    label: "플랫폼 기술",
    hint: "같은 기반기술로 여러 자산을 만드는지",
    options: YN,
  },

  // ── 해외 희귀 요건 (대표님 20261004_1709)
  //
  // 국내(rare_kr)는 M02 환자 수에서 만든다 — 묻지 않는다.
  // 해외는 우리가 가진 자료가 없어 회사가 아는 것을 받는다.
  // "모른다" 를 고를 수 있어야 한다 — 안 고르면 '확인 필요' 로 남는다.
  {
    key: "rare_us", group: "regulatory",
    label: "미국 희귀 요건",
    hint: "미국 환자 수가 20만 명 미만이라는 자료가 있습니까",
    options: [["Y", "예"], ["N", "아니오"], ["unknown", "모름"]],
  },
  {
    key: "rare_eu", group: "regulatory",
    label: "유럽 희귀 요건",
    hint: "유럽 유병률이 1만 명당 5명 이하라는 자료가 있습니까",
    options: [["Y", "예"], ["N", "아니오"], ["unknown", "모름"]],
  },
  {
    key: "rare_jp", group: "regulatory",
    label: "일본 희귀 요건",
    hint: "일본 환자 수가 희귀질환 기준 미만이라는 자료가 있습니까",
    options: [["Y", "예"], ["N", "아니오"], ["unknown", "모름"]],
  },
  {
    key: "anti_infective_type", group: "regulatory",
    label: "작용 병원체",
    hint: "감염 치료제일 때만 묻습니다",
    only_disease_group: "감염",
    options: [
      ["antibacterial", "세균"],
      ["antifungal", "진균"],
      ["antiviral", "바이러스"],
      ["other", "그 밖"],
    ],
  },

  // ── 설계안 (C04)
  {
    key: "endpoint_type", group: "design",
    label: "평가변수 종류",
    options: [
      ["hard", "임상적 결과 지표"],
      ["surrogate", "대리지표"],
      ["ORR", "반응률(ORR)"],
      ["subjective", "주관적 지표"],
    ],
  },
  {
    key: "blinding", group: "design",
    label: "눈가림",
    options: [
      ["open_label", "공개(open-label)"],
      ["single_blind", "단일 눈가림"],
      ["double_blind", "이중 눈가림"],
    ],
  },
  {
    key: "design_type", group: "design",
    label: "설계 유형",
    options: [
      ["superiority", "우월성"],
      ["non_inferiority", "비열등성"],
      ["equivalence", "동등성"],
      ["single_arm_descriptive", "단일군 기술적"],
    ],
  },
  {
    key: "margin_specified", group: "design",
    label: "비열등성 한계 명시",
    hint: "비열등성 설계일 때만 봅니다",
    options: YN,
  },
  {
    key: "population", group: "design",
    label: "대상 집단",
    options: [
      ["all_comers", "전체(선별 없음)"],
      ["biomarker_selected", "바이오마커 선별"],
    ],
  },
  {
    key: "population_type", group: "design",
    label: "대상자 구분",
    options: [
      ["patients", "환자"],
      ["healthy", "건강인"],
    ],
  },
  {
    key: "multiplicity_plan", group: "design",
    label: "다중성 보정 계획",
    hint: "1차 평가변수가 둘 이상일 때 봅니다",
    options: YN,
  },
  {
    key: "chronic", group: "design",
    label: "만성 질환",
    hint: "시험 기간이 충분한지 보는 데 씁니다",
    options: YN,
  },
];

export const JUDGE_KEYS = JUDGE_FIELDS.map((f) => f.key);

/** 빈 값은 빼고 넘긴다 — 안 고른 칸을 'N' 으로 보내면 거짓 판정이 된다 */
export function judgeToRequest(j: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of JUDGE_KEYS) {
    const v = j[k];
    if (v !== undefined && v !== null && v !== "") out[k] = v;
  }
  return out;
}
