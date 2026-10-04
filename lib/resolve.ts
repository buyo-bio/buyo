/**
 * 자리(slot)별 청크 찾기 — 사다리 방식
 *
 * 왜 사다리인가
 *   "이 치료영역 값이 있으면 그걸 쓰고, 없으면 질환군 값, 그것도 없으면
 *    비항암 대표값, 마지막으로 전체 평균" 처럼 정확한 쪽부터 차례로 내려간다.
 *   어느 칸에서 찾았는지(level)를 같이 돌려주므로, 화면이 "정확한 값"과
 *   "빌려 온 값"을 구분해 표시할 수 있다.
 *
 * 순서와 단계 이름은 대표님 golden_cases.json 의 chain_steps 와 같다.
 * 숫자나 임계값을 여기에 적지 않는다 — 어떤 청크를 고를지만 정한다.
 */
import type { Chunk } from "./types";
import { modalityLadder } from "./enums";

/** 찾은 자리 */
export const LEVEL = {
  NA: 0,            // 이 단계에 해당하지 않음
  EXACT: 1,         // L1 정확
  GROUP: 2,         // L2 질환군·대체 태그
  NONONC: 3,        // L3 비항암 대표
  ALL: 4,           // L4 전체 평균
  DESIGN_ALL: 5,    // 설계상 전체값(원래 하나뿐인 값)
  NONE: 9,          // L9 미확보
} as const;

export type ResolveInput = {
  modality: string;
  phase: string;
  therapeutic_area: string | null;
  disease_group: string | null;
  rare: "Y" | "N";
  indication_name?: string | null;
};

export type Resolved = {
  level: number;
  /** 어느 사다리 칸에서 찾았나 — 화면 배지와 감사에 쓴다 */
  step: string | null;
  chunks: Chunk[];
};

// ─────────────────────────────────────────────
// 청크 한 장 읽기
// ─────────────────────────────────────────────
type Ind = { text?: string | null; code?: string | null; ta?: string | null };

function ind(c: Chunk): Ind | null {
  const v = (c as unknown as Record<string, unknown>).indication;
  return v && typeof v === "object" ? (v as Ind) : null;
}

/** indication.ta 는 "oncology_solid|oncology_heme" 처럼 세로줄로 여럿일 수 있다 */
function taList(c: Chunk): string[] {
  const t = ind(c)?.ta;
  return t ? String(t).split("|").map((x) => x.trim()).filter(Boolean) : [];
}

function groupOf(c: Chunk): string | null {
  return ind(c)?.text ?? null;
}

function f(c: Chunk, k: string): unknown {
  return (c as unknown as Record<string, unknown>)[k];
}

/** modality 칸도 "antibody_mAb|small_molecule" 처럼 복수일 수 있다 */
function modList(c: Chunk): string[] {
  const m = f(c, "modality");
  return m == null ? [] : String(m).split("|").map((x) => x.trim()).filter(Boolean);
}

/** phase 칸은 "preclinical|P1" 처럼 복수일 수 있다 */
function phaseHit(c: Chunk, want: string): boolean {
  const p = f(c, "phase");
  if (p == null) return true;
  return String(p).split("|").map((x) => x.trim()).includes(want);
}

// ─────────────────────────────────────────────
// 사다리 한 칸씩
//
// 각 함수는 "이 칸에 해당하는 청크"만 걸러 낸다. 순서는 chain 이 정한다.
// ─────────────────────────────────────────────
const STEPS: Record<
  string,
  (rows: Chunk[], inp: ResolveInput, spec: SlotSpec) => { hit: Chunk[]; level: number }
> = {
  /** 모달리티가 같고(상위·대체 태그 포함) 적응증이 없는 청크 */
  modality(rows, inp) {
    // 감사 도구(golden_cases.json)는 modality 칸을 글자 그대로 비교한다.
    // 그래서 여기도 세로줄로 묶인 칸("antibody_mAb|small_molecule")은 맞히지 않는다.
    //   → T02-0028 한 장이 이 때문에 아무 모달리티에도 안 걸린다.
    //     청크를 두 장으로 쪼개 달라고 대표님께 올렸다(2026-10-04).
    //     코드로 먼저 풀면 감사와 화면이 어긋나므로 데이터에서 고친다.
    const ladder = modalityLadder(inp.modality);
    const hit = rows.filter((c) => {
      const m = f(c, "modality");
      return m != null && ladder.includes(String(m)) && ind(c) == null;
    });
    if (hit.length === 0) return { hit, level: LEVEL.NONE };
    // 자기 태그로 바로 맞았으면 정확, 상위·대체를 빌렸으면 한 칸 아래
    const exact = hit.some((c) => String(f(c, "modality")) === inp.modality);
    return { hit, level: exact ? LEVEL.EXACT : LEVEL.GROUP };
  },

  /** 세부 치료영역이 맞는 청크 */
  ta(rows, inp) {
    if (!inp.therapeutic_area) return { hit: [], level: LEVEL.NONE };
    const hit = rows.filter((c) => taList(c).includes(inp.therapeutic_area!));
    return { hit, level: hit.length ? LEVEL.EXACT : LEVEL.NONE };
  },

  /** 질환군이 맞고 치료영역 태그가 없는 청크. 질환군이 '기타'면 건너뛴다 */
  group(rows, inp) {
    if (!inp.disease_group || inp.disease_group === "기타")
      return { hit: [], level: LEVEL.NONE };
    const hit = rows.filter(
      (c) => groupOf(c) === inp.disease_group && taList(c).length === 0
    );
    return { hit, level: hit.length ? LEVEL.GROUP : LEVEL.NONE };
  },

  /** 비항암 대표값 — 질환군이 '기타'이고 치료영역 태그가 없는 청크 */
  nononc(rows) {
    const hit = rows.filter((c) => groupOf(c) === "기타" && taList(c).length === 0);
    return { hit, level: hit.length ? LEVEL.NONONC : LEVEL.NONE };
  },

  /**
   * 적응증도 모달리티도 없는 전체값.
   *
   * 같은 L4 라도 두 가지가 섞인다.
   *   ① 치료영역·질환군 값이 있는데 못 찾아 내려온 것   → 전체 평균(L4)
   *   ② 애초에 그런 구분이 없는 표(C03 산업 평균 등)   → 설계상 전체값(L5)
   * ②는 "빌려 온 값"이 아니므로 화면에서 깎아 보이면 안 된다.
   */
  all(rows) {
    const hit = rows.filter((c) => ind(c) == null && f(c, "modality") == null);
    if (hit.length === 0) return { hit, level: LEVEL.NONE };
    const hasSplit = rows.some((c) => ind(c) != null || f(c, "modality") != null);
    return { hit, level: hasSplit ? LEVEL.ALL : LEVEL.DESIGN_ALL };
  },

  /** 모든 약에 적용되는 공통 규칙 (T02) */
  general(rows) {
    const hit = rows.filter((c) => f(c, "applies_to_all_modalities") === true);
    return { hit, level: hit.length ? LEVEL.GROUP : LEVEL.NONE };
  },

  /** 모달리티 전용 값이 없을 때 쓰는 전체 모달리티 값 */
  modality_fallback_all(rows) {
    const hit = rows.filter((c) => f(c, "modality") == null && ind(c) == null);
    return { hit, level: hit.length ? LEVEL.ALL : LEVEL.NONE };
  },

  /** 희귀 둘째 줄 — rare=Y 이고 항암 여부에 맞는 rare_scope */
  rare(rows, inp) {
    if (inp.rare !== "Y") return { hit: [], level: LEVEL.NONE };
    const onc = inp.disease_group === "항암";
    const hit = rows.filter((c) => {
      if (f(c, "rare") !== "Y") return false;
      const scope = f(c, "rare_scope");
      if (scope == null) return true;
      const s = String(scope);
      return onc ? s !== "excl_oncology" : s !== "only_oncology";
    });
    return { hit, level: hit.length ? LEVEL.EXACT : LEVEL.NONE };
  },

  /**
   * 딜 — 같은 모달리티·같은 단계의 기술이전.
   *
   * 다른 자리와 두 가지가 다르다.
   *   ① 사다리를 쓰지 않는다. "이중항체 딜"을 묻는데 단클론항체 딜을 섞으면
   *      비교가 안 된다. 자기 태그만 본다.
   *   ② 단계 칸이 빈 청크는 넣지 않는다. 빈 칸이 '전체'를 뜻하는 다른 자리와 달리,
   *      여기서는 "그 단계의 딜"이 아니면 비교 대상이 아니다.
   *
   * 몇 건이냐가 레벨을 가른다(min_n, 보통 5).
   *   5건 이상 → L1. 사분위를 낼 수 있다.
   *   5건 미만 → L2. 숫자 분포 대신 목록으로만 보여 준다.
   */
  modality_phase(rows, inp, spec) {
    const hit = rows.filter((c) => {
      const m = f(c, "modality");
      const p = f(c, "phase");
      if (m == null || p == null) return false;
      return modList(c).includes(inp.modality) &&
        String(p).split("|").map((x) => x.trim()).includes(inp.phase);
    });
    if (hit.length === 0) return { hit, level: LEVEL.NONE };
    const min = spec.min_n ?? 0;
    return { hit, level: hit.length >= min ? LEVEL.EXACT : LEVEL.GROUP };
  },

  /** 적응증 이름이 같은 것 (M02 국내 환자 수) */
  indication(rows, inp) {
    if (!inp.indication_name) return { hit: [], level: LEVEL.NONE };
    const hit = rows.filter((c) => ind(c)?.text === inp.indication_name);
    if (hit.length === 0) return { hit, level: LEVEL.NONE };
    // 첫 줄에 쓸 수 있는 값(default)이 있으면 정확, 상세 전용뿐이면 한 칸 아래
    const hasDefault = hit.some((c) => (f(c, "display_role") ?? "default") === "default");
    return { hit, level: hasDefault ? LEVEL.EXACT : LEVEL.GROUP };
  },
};

// ─────────────────────────────────────────────
// 자리 하나 풀기
// ─────────────────────────────────────────────
export type SlotSpec = {
  domain: string;
  filter?: Record<string, unknown>;
  chain: string[];
  /** 비임상은 임상 값이 없다. 어느 단계 값을 대신 볼지 */
  preclinical_alias?: string;
  /** 이 단계들에서는 "해당 없음"(회색이 아니다) */
  na_phases?: string[];
  /** 이 단계에서만 나오는 자리 */
  only_phases?: string[];
  /** rare=Y 일 때만 */
  only_if_rare?: boolean;
  /** 단계 구분 없이 값이 하나뿐인 자리 — 찾으면 L5 */
  design_all_phases?: string[];
  min_n?: number;
};

/** slot 의 filter 를 청크에 적용 */
function passFilter(c: Chunk, spec: SlotSpec, phase: string): boolean {
  const fl = spec.filter ?? {};
  if (fl.basis && f(c, "probability_basis") !== fl.basis) return false;
  if (fl.to && (f(c, "phase_to") ?? null) !== fl.to) return false;
  if (fl.cost_kind && f(c, "cost_kind") !== fl.cost_kind) return false;
  if (fl.rare && f(c, "rare") !== fl.rare) return false;
  if (fl.phase_from_input && !phaseHit(c, phase)) return false;
  return true;
}

export function resolveSlot(
  all: Chunk[],
  spec: SlotSpec,
  inp: ResolveInput
): Resolved {
  // 이 단계에 아예 해당하지 않는 자리
  if (spec.na_phases?.includes(inp.phase))
    return { level: LEVEL.NA, step: null, chunks: [] };
  if (spec.only_phases && !spec.only_phases.includes(inp.phase))
    return { level: LEVEL.NA, step: null, chunks: [] };
  if (spec.only_if_rare && inp.rare !== "Y")
    return { level: LEVEL.NA, step: null, chunks: [] };

  // 비임상은 임상 값이 없다 — 대신 볼 단계가 지정돼 있으면 그걸 쓴다
  const phase =
    inp.phase === "preclinical" && spec.preclinical_alias
      ? spec.preclinical_alias
      : inp.phase;

  const rows = all.filter(
    (c) =>
      c.domain_id === spec.domain &&
      passFilter(c, spec, phase) &&
      // 기술도입·제네릭·계열사 딜은 비교군이 아니다(대표님 20261003_1501).
      // 상세에는 "비교군 제외: <이유>"로 따로 보여 준다.
      f(c, "comps_eligible") !== false
  );

  for (let i = 0; i < spec.chain.length; i++) {
    const name = spec.chain[i];
    const step = STEPS[name];
    if (!step) continue;
    const { hit, level } = step(rows, { ...inp, phase }, spec);
    if (hit.length === 0) continue;

    // 사다리를 한 칸 내려올 때마다 값이 덜 정확해진다.
    // 그래서 "몇 칸째에서 찾았는가"가 레벨의 하한이 된다.
    //   0칸째(첫 칸)에서 찾으면 그 칸이 낸 레벨 그대로,
    //   1칸째면 아무리 잘 맞아도 최소 L2.
    // 예) 딜은 같은 단계에서 못 찾아 단계를 풀고 찾았으면, 모달리티가
    //     정확히 같아도 "정확"이라고 하지 않는다.
    let lv = Math.max(level, i + 1);

    // 단계 구분 없이 값이 하나뿐인 자리는 '설계상 전체값'으로 센다
    if (spec.design_all_phases?.includes(inp.phase) && lv === LEVEL.ALL)
      lv = LEVEL.DESIGN_ALL;

    return { level: lv, step: name, chunks: hit };
  }

  return { level: LEVEL.NONE, step: null, chunks: [] };
}

// ─────────────────────────────────────────────
// DB(또는 파일)에서 바로 풀기
//
// resolveSlot 은 청크 배열을 받는다. 엔진은 ChunkSource 로 꺼내 쓰므로
// 그 도메인만 한 번 가져와 넘겨 주는 겉옷이 필요하다.
// 도메인 하나는 많아야 300장 안쪽이라 통째로 들고 와도 가볍다.
// ─────────────────────────────────────────────
import type { ChunkSource } from "./engines/base";

const cache = new Map<string, Chunk[]>();

/** 한 진단 안에서 같은 도메인을 여러 자리가 본다. 한 번만 가져온다 */
export function clearDomainCache() {
  cache.clear();
}

export async function resolveSlotFrom(
  src: ChunkSource,
  spec: SlotSpec,
  inp: ResolveInput
): Promise<Resolved> {
  let rows = cache.get(spec.domain);
  if (!rows) {
    rows = await src.find({}, { domain: spec.domain, limit: 2000 });
    cache.set(spec.domain, rows);
  }
  return resolveSlot(rows, spec, inp);
}
