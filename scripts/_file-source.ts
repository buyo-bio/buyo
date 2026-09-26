/**
 * 파일에서 읽는 청크 소스 — DB 없이 검사를 돌릴 때 쓴다.
 *
 * 규칙은 lib/store.ts 의 findChunks 와 **똑같아야 한다.**
 * 예전에는 검사 스크립트마다 이 코드를 따로 갖고 있었는데,
 * store.ts 만 고치고 여기를 안 고쳐서 "검사는 통과하는데 실제로는 0건"이 났다.
 * 그래서 한 곳으로 모았다.
 */
import fs from "node:fs";
import path from "node:path";
import { useChunkSource, indicationCode, field, type ChunkSource, type FindOpts } from "../lib/engines";
import type { Chunk, Conditions } from "../lib/types";

export const ALL: Chunk[] = [];

const DIR = path.join(process.cwd(), "data", "chunks");
for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith(".jsonl")))
  for (const l of fs.readFileSync(path.join(DIR, f), "utf8").split("\n"))
    if (l.trim()) ALL.push(JSON.parse(l.trim()) as Chunk);

/** 칸이 비어 있으면 모든 경우에 해당 */
function pass(c: Chunk, key: string, want?: string | null): boolean {
  if (!want) return true;
  const v = key === "indication_code"
    ? indicationCode(c)
    : (field(c, key) as string | null | undefined) ?? null;
  if (v == null) return true;

  // 관할만 규칙이 하나 더 있다 — GLOBAL 은 어느 나라에나 해당한다
  if (key === "jurisdiction" && v === "GLOBAL") return true;

  return v === want;
}

export function useFileChunks() {
  const src: ChunkSource = {
    async get(ids) {
      const o: Record<string, Chunk> = {};
      for (const c of ALL) if (ids.includes(c.chunk_id)) o[c.chunk_id] = c;
      return o;
    },
    async find(cond: Partial<Conditions>, opts: FindOpts = {}) {
      const doms = opts.domain
        ? Array.isArray(opts.domain) ? opts.domain : [opts.domain]
        : null;

      const out = ALL.filter((c) =>
        (!doms || doms.includes(c.domain_id)) &&
        (!opts.kind || c.layer === opts.kind) &&
        pass(c, "modality", cond.modality) &&
        pass(c, "indication_code", cond.indication_code) &&
        pass(c, "phase", cond.phase) &&
        pass(c, "rare", cond.rare) &&
        pass(c, "jurisdiction", cond.jurisdiction)
      ).sort((a, b) =>
        (a.trust_tier ?? 9) - (b.trust_tier ?? 9) || a.chunk_id.localeCompare(b.chunk_id)
      );

      return opts.limit ? out.slice(0, opts.limit) : out;
    },
  };
  useChunkSource(src);
  return ALL;
}
