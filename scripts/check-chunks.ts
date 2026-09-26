/**
 * DB 없이 카드만 검사한다. Supabase 만들기 전에 돌려 보는 용도.
 *
 * 실행:  npm run chunks:check
 */
import fs from "node:fs";
import path from "node:path";
import { ChunkSchema, validateChunk } from "../lib/types";

const DIR = path.join(process.cwd(), "data", "chunks");

const files = fs.readdirSync(DIR).filter(f => f.endsWith(".jsonl")).sort();
const problems: string[] = [];
const seen = new Set<string>();
const byKind: Record<string, number> = {};
let total = 0;

for (const f of files) {
  const lines = fs.readFileSync(path.join(DIR, f), "utf8")
    .split("\n").map(l => l.trim()).filter(Boolean);

  for (const line of lines) {
    total++;
    const parsed = ChunkSchema.safeParse(JSON.parse(line));
    if (!parsed.success) {
      problems.push(`${f} · 스키마 불일치 · ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
      continue;
    }
    const c = parsed.data;
    if (seen.has(c.chunk_id)) problems.push(`중복 ID: ${c.chunk_id}`);
    seen.add(c.chunk_id);
    byKind[c.layer] = (byKind[c.layer] ?? 0) + 1;
    for (const e of validateChunk(c)) problems.push(`${c.chunk_id} · ${e}`);
  }
  console.log(`  ${f.padEnd(34)} ${String(lines.length).padStart(5)}건`);
}

console.log("\n" + "─".repeat(52));
console.log(`총 ${total}건 · 고유 ID ${seen.size}개`);
console.log("  " + Object.entries(byKind).sort((a,b)=>b[1]-a[1])
  .map(([k,v]) => `${k} ${v}`).join(" · "));
console.log(`검사 지적 ${problems.length}건`);
problems.slice(0, 15).forEach(p => console.log("  " + p));
if (problems.length > 15) console.log(`  … 외 ${problems.length - 15}건`);
console.log("─".repeat(52));
console.log(total === 1746 && problems.length === 0
  ? "✅ 통과 — 이제 Supabase를 만들고 npm run db:load 하세요."
  : "⚠️ 확인이 필요합니다.");
