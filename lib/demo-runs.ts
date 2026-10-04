/**
 * 미리 굳혀 둔 시연 결과
 *
 * 발표장에서 네트워크가 끊기거나 DB(뭄바이)가 답하지 않으면
 * 시연 버튼이 빈 화면을 띄운다. 그때 이 파일을 대신 내보낸다.
 *
 * 만드는 법:  npm run cache:demos  (data/runs/*.json)
 *
 * 실시간인 척하지 않는다 — cached: true 가 붙어 있고 화면이 배지를 보여 준다.
 */
import caseA from "../data/runs/case-A.json";
import caseB from "../data/runs/case-B.json";
import caseC from "../data/runs/case-C.json";

export type CachedRun = {
  run_id: string;
  input: unknown;
  normalized: unknown;
  cards: unknown;
  basis_chunks: string[];
  as_of?: string;
  steps?: { id: string; label: string; detail: string; ms: number }[];
  cached: true;
  cached_at: string;
};

const RUNS: Record<string, CachedRun> = Object.fromEntries(
  [caseA, caseB, caseC].map((r) => [(r as unknown as CachedRun).run_id, r as unknown as CachedRun])
);

/** 굳혀 둔 결과가 있나 */
export function cachedRun(runId: unknown): CachedRun | null {
  return typeof runId === "string" ? RUNS[runId] ?? null : null;
}

export const CACHED_IDS = Object.keys(RUNS);
