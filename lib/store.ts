/**
 * DB 접근은 전부 이 파일을 거친다.
 *
 * 화면·엔진 어디에서도 supabase 클라이언트를 직접 부르지 않는다.
 * 나중에 DB를 바꿔도 이 파일만 고치면 된다.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Chunk, Conditions } from "./types";

// 접속은 처음 쓸 때 만든다.
// 불러오기만 해도 터지면 DB 없이 도는 스크립트(정규화 검증 등)를 못 돌린다.
let _db: SupabaseClient | null = null;

export function getDb(): SupabaseClient {
  if (_db) return _db;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL / SUPABASE_SERVICE_KEY 가 없습니다. .env.local 을 확인하세요."
    );
  }
  _db = createClient(url, key, { auth: { persistSession: false } });
  return _db;
}

/** 기존 코드 호환용 — db.from(...) 을 그대로 쓸 수 있게 한다 */
export const db = new Proxy({} as SupabaseClient, {
  get(_t, prop) {
    const real = getDb() as unknown as Record<string | symbol, unknown>;
    const v = real[prop];
    return typeof v === "function" ? (v as Function).bind(real) : v;
  },
});

// ─────────────────────────────────────────────
// 필터 5개로 카드 꺼내기
//
// 규칙 하나만 기억하면 된다:
//   칸이 비어 있으면(null) 모든 경우에 해당한다.
//   즉 "modality가 null이거나 내 값과 같은 것"을 고른다.
// ─────────────────────────────────────────────
export type FindOpts = {
  domain?: string | string[];
  kind?: Chunk["layer"];
  limit?: number;
};

export async function findChunks(
  cond: Partial<Conditions>,
  opts: FindOpts = {}
): Promise<Chunk[]> {
  let q = db.from("chunks").select("*");

  if (opts.domain) {
    const ds = Array.isArray(opts.domain) ? opts.domain : [opts.domain];
    q = q.in("domain_id", ds);
  }
  if (opts.kind) q = q.eq("kind", opts.kind);

  // 필터 5개 — 비어 있으면 통과
  if (cond.modality)        q = q.or(`modality.is.null,modality.eq.${cond.modality}`);
  if (cond.indication_code) q = q.or(`indication_code.is.null,indication_code.eq.${cond.indication_code}`);
  if (cond.phase)           q = q.or(`phase.is.null,phase.eq.${cond.phase}`);
  if (cond.rare)            q = q.or(`rare.is.null,rare.eq.${cond.rare}`);
  // 관할은 규칙이 하나 더 있다.
  // GLOBAL 은 "어느 나라에나 해당"이라는 뜻이라, KR 을 찾을 때도 걸려야 한다.
  // 카드 1,746장 중 1,506장이 GLOBAL 이다. 이걸 빼면 아무것도 안 나온다.
  // 관할. "KR|US" 처럼 세로줄로 묶인 칸은 그중 하나만 맞아도 해당한다 —
  // R01 12건 중 8건이 이 꼴이라 KR 로는 하나도 안 걸리고 있었다.
  // like 로 거를 때 묶음 안의 다른 나라(예: "KRX")에 걸리지 않도록
  // 세로줄을 앞뒤에 붙여 양끝을 맞춘다.
  if (cond.jurisdiction) {
    const j = cond.jurisdiction;
    q = q.or(
      [
        "jurisdiction.is.null",
        "jurisdiction.eq.GLOBAL",
        `jurisdiction.eq.${j}`,
        `jurisdiction.like.${j}|%`,
        `jurisdiction.like.%|${j}`,
        `jurisdiction.like.%|${j}|%`,
      ].join(",")
    );
  }

  // 우선순위: 조건이 구체적인 것 → 신뢰 등급 높은 것 → 유효기간 긴 것
  q = q.order("trust_tier", { ascending: true })
       .order("valid_until", { ascending: false, nullsFirst: false })
       .order("chunk_id", { ascending: true });

  if (opts.limit) q = q.limit(opts.limit);

  const { data, error } = await q;
  if (error) throw new Error(`findChunks 실패: ${error.message}`);
  return (data ?? []) as unknown as Chunk[];
}

/** 카드 ID 몇 개를 정확히 집어서 꺼낼 때 (엔진이 파라미터를 읽는 방식) */
export async function getChunks(ids: string[]): Promise<Record<string, Chunk>> {
  if (ids.length === 0) return {};
  const { data, error } = await db.from("chunks").select("*").in("chunk_id", ids);
  if (error) throw new Error(`getChunks 실패: ${error.message}`);
  const out: Record<string, Chunk> = {};
  for (const r of data ?? []) out[(r as any).chunk_id] = r as unknown as Chunk;
  return out;
}

export async function countChunks(): Promise<number> {
  const { count, error } = await db
    .from("chunks")
    .select("*", { count: "exact", head: true });
  if (error) throw new Error(`countChunks 실패: ${error.message}`);
  return count ?? 0;
}

/**
 * 종류별 개수.
 *
 * select("kind") 로 다 받아서 세면 안 된다 — 한 번에 1,000행까지만 오기 때문에
 * mapping 1,050개가 304개로 보인다. 종류마다 따로 세야 한다.
 */
export async function countByKind(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const kind of ["mapping", "parameter", "rule", "method"]) {
    const { count, error } = await getDb()
      .from("chunks")
      .select("*", { count: "exact", head: true })
      .eq("kind", kind);
    if (error) throw new Error(`countByKind(${kind}) 실패: ${error.message}`);
    out[kind] = count ?? 0;
  }
  return out;
}

/**
 * 축별 개수.
 *
 * 열 이름은 domain_id 다(domain 이 아니다 — 여기서 틀려서 500이 났다).
 * 값은 "C01" "F04" 처럼 축 글자 + 번호이므로 앞 글자로 센다.
 * 여기서도 행을 받아 세면 안 된다 — 1,000행 제한에 걸린다. head count 만 쓴다.
 */
export async function countByAxis(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const axis of ["C", "F", "M", "R", "T", "N"]) {
    const { count, error } = await getDb()
      .from("chunks")
      .select("*", { count: "exact", head: true })
      .like("domain_id", `${axis}%`);
    if (error) throw new Error(`countByAxis(${axis}) 실패: ${error.message}`);
    out[axis] = count ?? 0;
  }
  return out;
}

// ─────────────────────────────────────────────
// 레코드 (밖에서 가져온 사실)
// ─────────────────────────────────────────────
export async function findRecords(source: string, sourceKey?: string) {
  let q = db.from("records").select("*").eq("source", source);
  if (sourceKey) q = q.eq("source_key", sourceKey);
  const { data, error } = await q;
  if (error) throw new Error(`findRecords 실패: ${error.message}`);
  return data ?? [];
}

// ─────────────────────────────────────────────
// 진단 결과 (시연 3건은 여기에 미리 저장)
// ─────────────────────────────────────────────
export async function saveRun(run: {
  run_id: string;
  input: unknown;
  normalized: unknown;
  cards: unknown;
  basis_chunks?: string[];
  records_used?: string[];
  as_of?: string;
}) {
  const { error } = await db.from("runs").upsert(run);
  if (error) throw new Error(`saveRun 실패: ${error.message}`);
}

/** 최근 진단 목록. 카드 전체는 무거우니 머리말만 꺼낸다 */
export async function listRuns(limit = 30) {
  const { data, error } = await db
    .from("runs")
    .select("run_id, input, normalized, as_of, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`listRuns 실패: ${error.message}`);
  return data ?? [];
}

export async function getRun(run_id: string) {
  const { data, error } = await db.from("runs").select("*").eq("run_id", run_id).maybeSingle();
  if (error) throw new Error(`getRun 실패: ${error.message}`);
  return data;
}
