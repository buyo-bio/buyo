/**
 * 축 이름 맞추기
 *
 * 같은 '항암'을 자료마다 다르게 부른다.
 *   BUYO 질환군      항암
 *   F04(Sertkaya)   oncology
 * 이 파일은 그 이름표만 잇는다. 숫자는 하나도 없다.
 *
 * ⚠️ MVP 임시 표. 질환군 등록부가 청크로 들어오면 이 파일을 지우고
 *    등록부 조회로 바꾼다. 모르는 이름은 null 로 두고 추측하지 않는다.
 */

/** BUYO 질환군 7개 → F04 source_ta_label */
const TA_LABEL: Record<string, string> = {
  항암: "oncology",
  감염: "anti-infective",
  "대사·내분비": "endocrine",
  심혈관: "cardiovascular",
  "중추신경(신경)": "central_nervous_system",
  "중추신경(정신)": "central_nervous_system",
};

export function taLabel(diseaseGroup: string | null | undefined): string | null {
  if (!diseaseGroup) return null;
  return TA_LABEL[diseaseGroup] ?? null;
}

/** 값이 없을 때 물러설 자리 — 전체 가중평균 행 */
export const TA_FALLBACK = ["all(weighted)", "all"];

/** 단계 순서. '다음 단계'를 구할 때 쓴다 */
export const PHASE_ORDER = ["preclinical", "P1", "P2", "P3", "NDA", "approved"] as const;

export function nextPhase(phase: string): string | null {
  const i = PHASE_ORDER.indexOf(phase as (typeof PHASE_ORDER)[number]);
  return i >= 0 && i < PHASE_ORDER.length - 1 ? PHASE_ORDER[i + 1] : null;
}

export const MONTHS_PER_YEAR = 12;
