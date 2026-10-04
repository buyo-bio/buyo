/**
 * DB 없이 카드만 검사한다. Supabase 만들기 전에 돌려 보는 용도.
 *
 * 실행:  npm run chunks:check
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ChunkSchema, validateChunk } from "../lib/types";

const DIR = path.join(process.cwd(), "data", "chunks");

const files = fs.readdirSync(DIR).filter(f => f.endsWith(".jsonl")).sort();
const problems: string[] = [];
const seen = new Set<string>();
const byKind: Record<string, number> = {};
const byDomain: Record<string, number> = {};
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
    byDomain[c.domain_id] = (byDomain[c.domain_id] ?? 0) + 1;
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
// 기대 개수는 손으로 적지 않는다. 묶음이 올 때마다 바뀌어서 늘 어긋났다.
// data/ref/manifest.json(대표님이 묶음과 함께 주시는 파일)과 대조한다.
const manifestPath = path.join(process.cwd(), "data", "ref", "manifest.json");
let expected: number | null = null;
if (fs.existsSync(manifestPath)) {
  const m = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
    total_chunks?: number; by_domain?: Record<string, number>;
  };
  expected = m.total_chunks ?? null;

  // 도메인별 개수까지 맞는지 — 파일 하나를 빠뜨리면 여기서 걸린다
  if (m.by_domain) {
    const off = Object.entries(m.by_domain)
      .filter(([d, n]) => (byDomain[d] ?? 0) !== n)
      .map(([d, n]) => `${d} ${byDomain[d] ?? 0}건(기대 ${n})`);
    if (off.length) console.log(`\n도메인 개수 어긋남: ${off.join(" · ")}`);
  }
}

if (expected !== null && total !== expected)
  console.log(`총 개수 어긋남: ${total}건 (manifest 기대 ${expected}건)`);

console.log("─".repeat(52));
console.log(problems.length === 0 && (expected === null || total === expected)
  ? `✅ 통과 — ${total}건. 이제 npm run db:load 하세요.`
  : "⚠️ 확인이 필요합니다.");


// ─────────────────────────────────────────────
// 굳혀 둔 시연 결과가 낡지 않았나
//
// data/runs/*.json 은 발표장에서 네트워크가 끊길 때 내보내는 결과다.
// 대표님 묶음이 새로 오면 숫자가 바뀌는데, 굳힌 파일은 그대로다.
// 그러면 조용히 옛 숫자를 보여 준다 — 이 프로젝트에서 제일 무서운 종류의 버그다.
// 어긋나면 npm run cache:demos 를 다시 돌리라고 알려 준다.
// ─────────────────────────────────────────────
{
  const idx = path.join(process.cwd(), "data", "runs", "index.json");
  if (!fs.existsSync(idx)) {
    console.log("\n⚠️ 굳혀 둔 시연 결과가 없습니다 — npm run cache:demos");
  } else {
    const saved = JSON.parse(fs.readFileSync(idx, "utf8")) as {
      built_at: string; chunks: number; manifest: string;
    };
    const mf = path.join(process.cwd(), "data", "ref", "manifest.json");
    const now = fs.existsSync(mf)
      ? crypto.createHash("sha256").update(fs.readFileSync(mf)).digest("hex").slice(0, 12)
      : "(manifest 없음)";

    if (saved.chunks !== total || saved.manifest !== now) {
      console.log(
        `\n⚠️ 굳혀 둔 시연 결과가 지금 자료와 다릅니다 — npm run cache:demos 를 다시 돌리세요.` +
        `\n   굳힐 때 청크 ${saved.chunks}건 / manifest ${saved.manifest}` +
        `\n   지금   청크 ${total}건 / manifest ${now}`
      );
      process.exitCode = 1;
    } else {
      console.log(`\n✅ 굳혀 둔 시연 결과 3건이 지금 자료와 같습니다 (${saved.built_at.slice(0, 10)})`);
    }
  }
}
