/**
 * data/chunks/*.jsonl  →  Supabase chunks 테이블
 *
 * 실행:  npx tsx scripts/load.ts
 *
 * 하는 일
 *   1. jsonl 전부 읽는다
 *   2. V-00~V-10 검사한다 (실패해도 멈추지 않고 보고만 한다)
 *   3. 컬럼 10개로 펼치고 나머지는 meta에 접는다
 *   4. 500개씩 끊어서 넣는다
 */
import fs from "node:fs";
import path from "node:path";
import "../lib/env";
import { db } from "../lib/store";
import { ChunkSchema, validateChunk, type Chunk } from "../lib/types";

const DIR = path.join(process.cwd(), "data", "chunks");
const BATCH = 500;

/** 청크 한 줄 → DB 행 하나 */
function toRow(c: Chunk) {
  const {
    chunk_id, domain_id, layer, text, value, unit, flag_hint, statistic,
    modality, phase, rare, jurisdiction,
    trust_tier, temporal_validity, badges, source,
    ...rest
  } = c as any;

  // 값이 "120000-300000" 같은 범위 문자열이면 숫자 칸에 못 넣는다.
  // value(숫자)와 value_text(범위)를 나눠 담고, 어느 쪽인지는 statistic 이 밝힌다.
  const isRange = typeof value === "string";

  // indication 은 문자열일 수도 { text, code } 일 수도 있다
  let indication_code: string | null = null;
  if (typeof c.indication === "string") indication_code = c.indication;
  else if (c.indication && typeof c.indication === "object")
    indication_code = (c.indication as any).code ?? (c.indication as any).text ?? null;

  // 유효기간 "2011-01/2035-12" → 뒤쪽만
  let valid_until: string | null = null;
  if (temporal_validity) {
    const parts = String(temporal_validity).split("/");
    valid_until = (parts[1] ?? parts[0]).trim();
  }

  return {
    chunk_id, domain_id,
    kind: layer,
    text,
    value: isRange ? null : (value ?? null),
    value_text: isRange ? value : null,
    statistic: statistic ?? null,
    unit: unit ?? null,
    flag_hint: flag_hint ?? null,
    modality: modality ?? null,
    indication_code,
    phase: phase ?? null,
    rare: rare ?? null,
    jurisdiction: jurisdiction ?? null,
    trust_tier: trust_tier ?? null,
    valid_until,
    badges: badges ?? [],
    source: source ?? null,
    meta: {
      ...rest,
      statistic: statistic ?? null,
      indication: c.indication ?? null,
      temporal_validity: temporal_validity ?? null,
    },
  };
}

async function main() {
  const files = fs.readdirSync(DIR).filter(f => f.endsWith(".jsonl")).sort();
  if (files.length === 0) throw new Error(`${DIR} 에 jsonl 이 없습니다`);

  const rows: ReturnType<typeof toRow>[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const f of files) {
    const lines = fs.readFileSync(path.join(DIR, f), "utf8")
      .split("\n").map(l => l.trim()).filter(Boolean);

    for (const line of lines) {
      const parsed = ChunkSchema.safeParse(JSON.parse(line));
      if (!parsed.success) {
        problems.push(`${f} · 스키마 불일치 · ${parsed.error.issues[0]?.message}`);
        continue;
      }
      const c = parsed.data;

      // V-02 중복 ID 금지
      if (seen.has(c.chunk_id)) { problems.push(`중복 ID: ${c.chunk_id}`); continue; }
      seen.add(c.chunk_id);

      for (const e of validateChunk(c)) problems.push(`${c.chunk_id} · ${e}`);
      rows.push(toRow(c));
    }
    console.log(`  읽음  ${f.padEnd(34)} ${lines.length}건`);
  }

  console.log(`\n총 ${rows.length}건 · 검사 지적 ${problems.length}건`);
  if (problems.length) {
    console.log("\n── 검사 지적(상위 15) ──");
    problems.slice(0, 15).forEach(p => console.log("  " + p));
    if (problems.length > 15) console.log(`  … 외 ${problems.length - 15}건`);
  }

  // 적재
  console.log("\n적재 중…");
  await db.from("chunks").delete().neq("chunk_id", "");
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const { error } = await db.from("chunks").insert(slice);
    if (error) throw new Error(`적재 실패 (${i}~): ${error.message}`);
    console.log(`  ${Math.min(i + BATCH, rows.length)} / ${rows.length}`);
  }

  // 확인
  const { count } = await db.from("chunks").select("*", { count: "exact", head: true });
  console.log(`\n✅ 적재 완료 — chunks ${count}건`);

  // 기대 개수는 묶음과 함께 오는 manifest.json 에서 읽는다(손으로 적지 않는다)
  const mf = path.join(process.cwd(), "data", "ref", "manifest.json");
  if (fs.existsSync(mf)) {
    const want = (JSON.parse(fs.readFileSync(mf, "utf8")) as { total_chunks?: number }).total_chunks;
    if (want && count !== want) console.log(`⚠️  manifest 기대값 ${want}건과 다릅니다`);
  }
}

main().catch(e => { console.error("\n❌ " + e.message); process.exit(1); });
