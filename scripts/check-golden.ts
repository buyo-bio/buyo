/**
 * 골든 테스트 — 조회 순서가 대표님 정답표와 같은지 확인
 *
 * 실행:  npm run golden
 *
 * data/ref/golden_cases.json 에 입력 조합 588개 × 자리 13개의 정답이 있다.
 * 각 자리마다 "어느 칸(level)에서 어느 청크가 나와야 하는지"가 적혀 있고,
 * 이 스크립트가 lib/resolve.ts 를 그 입력으로 돌려서 맞는지 센다.
 *
 * DB 없이 돈다 — data/chunks/*.jsonl 을 그대로 읽는다.
 */
import fs from "node:fs";
import path from "node:path";
import type { Chunk } from "../lib/types";
import { resolveSlot, type SlotSpec, type ResolveInput } from "../lib/resolve";

const DIR = path.join(process.cwd(), "data", "chunks");
const all: Chunk[] = [];
for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith(".jsonl")))
  for (const l of fs.readFileSync(path.join(DIR, f), "utf8").split("\n"))
    if (l.trim()) all.push(JSON.parse(l) as Chunk);

const golden = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "data", "ref", "golden_cases.json"), "utf8")
) as {
  version: string;
  levels: Record<string, string>;
  slot_spec: Record<string, SlotSpec>;
  cases: {
    input: ResolveInput & { indication_name?: string };
    expected: Record<string, { level: number; accept_chunk_ids: string[]; note?: string }>;
  }[];
};

type Fail = {
  slot: string;
  input: string;
  wantLevel: number;
  gotLevel: number;
  want: string[];
  got: string[];
};

const fails: Fail[] = [];
const bySlot: Record<string, { ok: number; no: number }> = {};
let total = 0;

for (const cs of golden.cases) {
  for (const [slot, exp] of Object.entries(cs.expected)) {
    const spec = golden.slot_spec[slot];
    if (!spec) continue;
    total++;
    bySlot[slot] ??= { ok: 0, no: 0 };

    const got = resolveSlot(all, spec, cs.input);
    const gotIds = got.chunks.map((c) => c.chunk_id);

    // 통과 조건
    //   level 이 같아야 하고,
    //   정답에 청크가 적혀 있으면 그중 하나라도 나와야 한다.
    const levelOk = got.level === exp.level;
    const idsOk =
      exp.accept_chunk_ids.length === 0
        ? gotIds.length === 0
        : gotIds.some((id) => exp.accept_chunk_ids.includes(id));

    if (levelOk && idsOk) bySlot[slot].ok++;
    else {
      bySlot[slot].no++;
      if (fails.length < 4000)
        fails.push({
          slot,
          input: `${cs.input.therapeutic_area}·${cs.input.modality}·${cs.input.phase}·rare${cs.input.rare}`,
          wantLevel: exp.level,
          gotLevel: got.level,
          want: exp.accept_chunk_ids.slice(0, 3),
          got: gotIds.slice(0, 3),
        });
    }
  }
}

const ok = Object.values(bySlot).reduce((s, v) => s + v.ok, 0);

console.log(`\n━━ 골든 테스트 (${golden.version}) ━━━━━━━━━━━━━━━━━━━━━━━━\n`);
console.log(`  입력 조합 ${golden.cases.length}개 × 자리 ${Object.keys(golden.slot_spec).length}개 = ${total}건\n`);

for (const [slot, v] of Object.entries(bySlot)) {
  const rate = ((v.ok / (v.ok + v.no)) * 100).toFixed(0);
  const mark = v.no === 0 ? "✅" : "❌";
  console.log(`  ${mark} ${slot.padEnd(9)} ${String(v.ok).padStart(4)}/${String(v.ok + v.no).padEnd(4)} ${rate}%`);
}

console.log(`\n  통과 ${ok} / ${total}  (${((ok / total) * 100).toFixed(1)}%)\n`);

// 실패를 "같은 모양"끼리 묶어 보여 준다 — 588개를 하나씩 읽을 수는 없다
if (fails.length) {
  const grouped: Record<string, { n: number; ex: Fail }> = {};
  for (const f of fails) {
    const key = `${f.slot}|기대 L${f.wantLevel}|나옴 L${f.gotLevel}`;
    grouped[key] ??= { n: 0, ex: f };
    grouped[key].n++;
  }
  console.log("── 실패 모양별 ──────────────────────────────");
  for (const [k, v] of Object.entries(grouped).sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  ${k}  ${v.n}건`);
    console.log(`     예) ${v.ex.input}`);
    console.log(`         기대 ${v.ex.want.join(", ") || "(빈 결과)"}`);
    console.log(`         나옴 ${v.ex.got.join(", ") || "(빈 결과)"}`);
  }
  console.log("");
}

console.log("━".repeat(52));
