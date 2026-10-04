/**
 * 축 목록 — 대표님이 주신 data/ref/enums_v1.json 을 그대로 읽는다.
 *
 * 왜 파일에서 읽나
 *   모달리티·도메인 목록이 코드 여기저기에 손으로 적혀 있으면,
 *   새 값(protein·oligo_siRNA 등)이 생길 때마다 세 군데를 고쳐야 하고
 *   한 군데를 빠뜨리면 조용히 어긋난다. 목록은 한 곳에서만 온다.
 *
 * 이 파일은 값을 해석하지 않는다. 읽어서 모양만 잡아 준다.
 */
import raw from "../data/ref/enums.json";

export type ModalityDef = { tag: string; parent: string | null; label_ko: string };
export type TaDef = { ta_id: string; ta_ko: string; default_group: string };

const E = raw as {
  version: string;
  modality: ModalityDef[];
  /** 하위 태그 → 상위 태그 (antibody_bispecific → antibody) */
  modality_parent: Record<string, string>;
  /** 전용 값이 없을 때 빌려 쓸 형제 태그 (이중항체 → 단클론항체) */
  modality_sibling_fallback: Record<string, string>;
  disease_group: string[];
  therapeutic_area: TaDef[];
  phase: string[];
  domain_id: string[];
  layer: string[];
  flag_hint: string[];
  badges: string[];
};

export const ENUMS_VERSION = E.version;

export const MODALITY_DEFS = E.modality;
export const MODALITY_TAGS = E.modality.map((m) => m.tag);
export const MODALITY_PARENT = E.modality_parent;
export const MODALITY_SIBLING = E.modality_sibling_fallback;
export const DISEASE_GROUPS = E.disease_group;
export const TA_DEFS = E.therapeutic_area;
export const THERAPEUTIC_AREAS = E.therapeutic_area.map((t) => t.ta_id);

/** 세부 치료영역의 한글 이름 */
export function taLabel(id: string): string {
  return E.therapeutic_area.find((t) => t.ta_id === id)?.ta_ko ?? id;
}

/** 그 치료영역의 기본 질환군 */
export function taDefaultGroup(id: string): string | null {
  return E.therapeutic_area.find((t) => t.ta_id === id)?.default_group ?? null;
}
export const PHASES = E.phase;
export const DOMAIN_IDS = E.domain_id;
export const LAYERS = E.layer;
export const FLAG_HINTS = E.flag_hint;
export const BADGES = E.badges;

/** 한글 이름 */
export function modalityLabel(tag: string): string {
  return E.modality.find((m) => m.tag === tag)?.label_ko ?? tag;
}

/**
 * 조회할 때 쓸 태그 사다리.
 *
 *   antibody_bispecific
 *     → antibody_bispecific  (자기 자신)
 *     → antibody_mAb         (형제 — 전용 값이 없을 때 빌린다)
 *     → antibody             (상위)
 *
 * 앞에 있는 것부터 쓴다. 뒤로 갈수록 "덜 정확하지만 있는" 값이다.
 */
export function modalityLadder(tag: string): string[] {
  const out = [tag];
  const sib = MODALITY_SIBLING[tag];
  if (sib && !out.includes(sib)) out.push(sib);
  let cur = tag;
  // 상위가 또 상위를 가질 수 있다. 고리가 생겨도 멈추게 횟수를 제한한다.
  for (let i = 0; i < 5; i++) {
    const up = MODALITY_PARENT[cur];
    if (!up) break;
    if (!out.includes(up)) out.push(up);
    cur = up;
  }
  return out;
}

/** 청크 ID 앞머리가 등록된 도메인인가 */
export function isKnownDomain(d: string): boolean {
  return DOMAIN_IDS.includes(d);
}
