/**
 * 화면 문장 자리(slot) 정의 — golden_cases.json 에서 읽는다
 *
 * 자리마다 "어느 도메인에서 · 어떤 조건으로 · 어떤 순서로 찾는지"가 적혀 있다.
 * 이걸 코드에 또 적으면 감사 도구와 어긋난다 — 어긋나면 골든 테스트가
 * 통과해도 화면은 다른 값을 보여 준다. 정본은 대표님 파일 하나다.
 */
import golden from "../data/ref/golden_cases.json";
import type { SlotSpec } from "./resolve";

const G = golden as unknown as {
  version: string;
  levels: Record<string, string>;
  chain_steps: Record<string, string>;
  slot_spec: Record<string, SlotSpec & { label: string }>;
};

export const SLOTS_VERSION = G.version;
export const SLOT_SPEC = G.slot_spec;

/** 자리 하나 꺼내기. 없는 이름이면 바로 터뜨린다 — 조용히 비는 것보다 낫다 */
export function slot(id: string): SlotSpec & { label: string } {
  const s = G.slot_spec[id];
  if (!s) throw new Error(`자리 정의가 없습니다: ${id} (golden_cases.json 의 slot_spec 확인)`);
  return s;
}

/** 레벨 한글 이름 — 화면 배지에 쓴다 */
export function levelLabel(level: number): string {
  return G.levels[String(level)] ?? `L${level}`;
}

/**
 * 값이 얼마나 정확한지 한 줄로.
 *
 * 화면에서 "이 숫자는 내 조건의 값인가, 빌려 온 값인가"를 알려 주는 문구다.
 * 비어 있으면(L1·L0) 아무것도 붙이지 않는다 — 정확한 값에 토를 달 필요가 없다.
 */
export function levelNote(level: number): string | null {
  switch (level) {
    case 2: return "같은 질환군 값으로 표시합니다";
    case 3: return "비항암 대표값으로 표시합니다";
    case 4: return "전체 평균으로 표시합니다";
    case 5: return null;   // 원래 하나뿐인 값 — 빌려 온 것이 아니다
    case 9: return "근거 없음";
    default: return null;
  }
}
