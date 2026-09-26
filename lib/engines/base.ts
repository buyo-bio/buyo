/**
 * 엔진 공통 뼈대
 *
 * 엔진 하나는 네 칸으로 되어 있다(설계서 3장).
 *   ① 입력     — ②정규화가 만든 조건 + 사용자가 적은 숫자
 *   ② 파라미터 — 청크 ID 로 꺼낸다. 코드에 숫자를 적지 않는다.
 *   ③ 산식     — 위 두 가지만 쓴다.
 *   ④ 출력     — values + basis_chunks + status
 *
 * status 세 가지
 *   ok          재료가 다 있어서 그대로 계산했다
 *   partial     일부가 없어서 '최소' 같은 단서를 붙여야 한다
 *   no_evidence 아예 계산하지 않았다. 0이나 평균으로 채우지 않는다.
 */
import type { Chunk, Conditions } from "../types";

export type Status = "ok" | "partial" | "no_evidence";

export type EngineResult<V = Record<string, unknown>> = {
  engine_id: string;
  status: Status;
  /** 화면 문장에 끼울 숫자·판정 */
  values: V;
  /** 이 결과를 만든 청크 ID. 화면의 '근거 보기'가 이걸 쓴다 */
  basis_chunks: string[];
  /** 값 옆에 붙는 꼬리표 */
  badges: string[];
  /** 왜 partial·no_evidence 인지 사람이 읽는 문장 */
  notes: string[];
};

// ─────────────────────────────────────────────
// 청크를 어디서 꺼낼지
//
// 기본은 Supabase(lib/store.ts).
// 검증 스크립트는 jsonl 파일을 꽂아서 DB 없이 돌린다.
// ─────────────────────────────────────────────
export type FindOpts = { domain?: string | string[]; kind?: Chunk["layer"]; limit?: number };

export type ChunkSource = {
  get(ids: string[]): Promise<Record<string, Chunk>>;
  find(cond: Partial<Conditions>, opts?: FindOpts): Promise<Chunk[]>;
};

let source: ChunkSource | null = null;

// ─────────────────────────────────────────────
// 몇 장을 꺼내 봤는가
//
// 화면 진행 표시("1,746장 중 218장을 꺼냈습니다")에 쓴다.
// 세는 것뿐이고 판단에는 쓰지 않는다.
// 진단 한 건을 처음부터 끝까지 돌리는 동안만 의미가 있으므로
// ⑤조립 직전에 읽고 다음 진단 시작 때 resetReads() 한다.
// ─────────────────────────────────────────────
const reads = { calls: 0, seen: new Set<string>() };

export function resetReads() {
  reads.calls = 0;
  reads.seen = new Set();
}

export function readStats(): { calls: number; unique: number } {
  return { calls: reads.calls, unique: reads.seen.size };
}

/** 꺼낸 카드를 센다 */
function counted(s: ChunkSource): ChunkSource {
  return {
    async get(ids) {
      reads.calls += 1;
      const r = await s.get(ids);
      for (const k of Object.keys(r)) reads.seen.add(k);
      return r;
    },
    async find(cond, opts) {
      reads.calls += 1;
      const r = await s.find(cond, opts);
      for (const c of r) reads.seen.add(c.chunk_id);
      return r;
    },
  };
}

/** 검증 스크립트가 파일 기반 소스를 꽂을 때 쓴다 */
export function useChunkSource(s: ChunkSource) {
  source = counted(s);
}

export async function chunkSource(): Promise<ChunkSource> {
  if (source) return source;
  const store = await import("../store");
  source = counted({
    get: (ids) => store.getChunks(ids),
    find: (cond, opts) => store.findChunks(cond, opts ?? {}),
  });
  return source;
}

// ─────────────────────────────────────────────
// 청크 한 장에서 값 꺼내기
//
// 적재할 때 컬럼 10개만 펼치고 나머지는 meta 에 접어 넣었다.
// 그래서 위칸·meta 둘 다 본다.
// ─────────────────────────────────────────────
export function field(c: Chunk | null | undefined, key: string): unknown {
  if (!c) return undefined;
  const top = (c as unknown as Record<string, unknown>)[key];
  if (top !== undefined && top !== null) return top;
  const meta = (c as unknown as Record<string, unknown>).meta as Record<string, unknown> | undefined;
  return meta?.[key];
}

/** 적응증 코드 — 문자열일 수도, { text, code } 일 수도 있다 */
export function indicationCode(c: Chunk | null | undefined): string | null {
  const direct = field(c, "indication_code");
  if (typeof direct === "string") return direct;
  const ind = field(c, "indication");
  if (typeof ind === "string") return ind;
  if (ind && typeof ind === "object") {
    const o = ind as Record<string, unknown>;
    return (o.code as string) ?? (o.text as string) ?? null;
  }
  return null;
}

/** 숫자 칸. 범위 문자열("15-22")은 숫자로 쓰지 않는다 */
export function num(c: Chunk | null | undefined): number | null {
  const v = field(c, "value");
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// ─────────────────────────────────────────────
// 엔진 한 개를 쓰는 동안 근거·꼬리표를 모아 두는 그릇
// ─────────────────────────────────────────────
export class Ctx {
  basis: string[] = [];
  badges: string[] = [];
  notes: string[] = [];
  private missing = 0;

  constructor(public readonly engineId: string) {}

  /** 쓴 청크를 근거로 남긴다 */
  use<T extends Chunk | null | undefined>(c: T): T {
    if (c && !this.basis.includes(c.chunk_id)) this.basis.push(c.chunk_id);
    return c;
  }

  badge(b?: string | null) {
    if (b && !this.badges.includes(b)) this.badges.push(b);
  }

  note(n?: string | null) {
    if (n && !this.notes.includes(n)) this.notes.push(n);
  }

  /** 없어서 못 채운 재료 하나 */
  lack(what: string) {
    this.missing += 1;
    this.note(`${what} 없음 — 근거 없음으로 둡니다`);
  }

  get lacked(): number {
    return this.missing;
  }

  done<V extends object>(values: V, status?: Status): EngineResult<V> {
    return {
      engine_id: this.engineId,
      status: status ?? (this.missing === 0 ? "ok" : "partial"),
      values,
      basis_chunks: this.basis,
      badges: this.badges,
      notes: this.notes,
    };
  }

  /** 아예 계산하지 않았을 때 */
  none<V extends object>(values: V, why: string): EngineResult<V> {
    this.note(why);
    return {
      engine_id: this.engineId,
      status: "no_evidence",
      values,
      basis_chunks: this.basis,
      badges: this.badges,
      notes: this.notes,
    };
  }
}

// ─────────────────────────────────────────────
// 여러 후보 중 조건이 제일 잘 맞는 카드 고르기
//
// 설계서 CE-01 우선순위:
//   (모달리티 일치 ∧ 질환군 일치) > (모달리티 일치) > (질환군 일치) > 전체
// 같은 점수면 신뢰 등급이 높은(숫자가 작은) 것.
// ─────────────────────────────────────────────
export function rankByFit(
  rows: Chunk[],
  cond: { modality?: string | null; indication_code?: string | null }
): Chunk[] {
  const score = (c: Chunk) => {
    const m = field(c, "modality");
    const i = indicationCode(c);
    const mHit = cond.modality && m === cond.modality ? 2 : 0;
    const iHit = cond.indication_code && i === cond.indication_code ? 1 : 0;
    return mHit + iHit;
  };
  return [...rows].sort((a, b) => {
    const d = score(b) - score(a);
    if (d !== 0) return d;
    const t = (a.trust_tier ?? 9) - (b.trust_tier ?? 9);
    if (t !== 0) return t;
    return a.chunk_id.localeCompare(b.chunk_id);
  });
}

// ─────────────────────────────────────────────
// 느슨한 짝 맞추기
//
// findChunks 는 글자가 똑같아야 찾는다. 그런데 카드 쪽 사정이 두 가지 있다.
//   ① phase 칸에 "preclinical|P1" 처럼 두 단계가 한 칸에 들어간 카드가 있다
//   ② 이중항체로 찾을 때 상위 이름표(항체) 카드도 걸려야 한다 (규칙 F06-09)
// 그래서 이 두 함수로 엔진 쪽에서 한 번 더 걸러 준다.
// ─────────────────────────────────────────────

/** 카드의 단계 칸과 맞는가. "preclinical|P1" 은 둘 다로 친다 */
export function phaseMatches(c: Chunk, want?: string | null): boolean {
  const p = field(c, "phase");
  if (p == null || !want) return true;           // 빈 칸은 모든 경우에 해당
  return String(p).split("|").map((x) => x.trim()).includes(want);
}

/**
 * 카드의 약 종류 칸과 맞는가.
 * family 는 "고른 태그 → 그 위 태그 → 더 위" 순서의 목록이다.
 * 예) antibody_bispecific → ["antibody_bispecific", "antibody"]
 */
export function modalityMatches(c: Chunk, family: string[]): boolean {
  const m = field(c, "modality");
  if (m == null) return true;                    // 빈 칸은 모든 경우에 해당
  return family.includes(String(m));
}

/**
 * 카드 종류.
 *
 * jsonl 은 layer, DB 행은 kind 로 들고 있다. 둘 다 봐야 한다.
 * 이걸 안 해서 "파일로는 🟠 주의인데 화면에서는 ⚪ 중립" 이 났다.
 */
export function kindOf(c: Chunk | null | undefined): string | null {
  if (!c) return null;
  return (c.layer as string) ?? ((c as unknown as Record<string, unknown>).kind as string) ?? null;
}

/** 규칙 카드를 [F01-06] 같은 머리표로 찾는다 */
export function byTag(rows: Chunk[], tag: string): Chunk | null {
  return rows.find((c) => c.text.startsWith(`[${tag}]`)) ?? null;
}

/** 규칙 카드 문장에서 '규칙:' 뒤만 떼어낸다(화면에 그대로 나가는 부분) */
export function ruleText(c: Chunk | null | undefined): string | null {
  if (!c) return null;
  const m = c.text.match(/규칙:\s*([\s\S]*?)(?:\s*근거:|$)/);
  return (m?.[1] ?? c.text).trim();
}
