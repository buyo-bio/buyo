/**
 * 시연 3건을 미리 돌려 파일로 굳힌다
 *
 * 실행:  npm run cache:demos
 *
 * 왜 필요한가
 *   발표장(10/13)에서 네트워크가 끊기거나 Supabase(뭄바이)가 느리면
 *   시연 버튼이 빈 화면을 띄운다. 그 순간 복구할 방법이 없다.
 *   그래서 결과를 파일로 들고 간다 — 네트워크가 아예 없어도 돈다.
 *
 * DB 를 쓰지 않는다. 청크는 data/chunks 파일에서 읽는다.
 * DB 에 넣은 것과 같은 파일이므로 같은 결과가 나온다(manifest.json 으로 맞춰 둔다).
 *
 * 굳힌 결과는 "저장된 결과" 라고 화면에 밝힌다. 실시간인 척하지 않는다.
 */
import fs from "node:fs";
import path from "node:path";
import { useFileChunks } from "./_file-source";
import { runDiagnose } from "../lib/pipeline";
import { DEMO_CASES, toRequest, type DemoKey } from "../lib/demo-cases";
import crypto from "node:crypto";

/** 어떤 자료로 굳혔는지 — 자료가 바뀌면 굳힌 결과가 낡는다. 검사가 이걸 보고 알려 준다 */
function dataStamp(): { chunks: number; manifest: string } {
  const mf = path.join(process.cwd(), "data", "ref", "manifest.json");
  return {
    chunks: ALL.length,
    manifest: fs.existsSync(mf)
      ? crypto.createHash("sha256").update(fs.readFileSync(mf)).digest("hex").slice(0, 12)
      : "(manifest 없음)",
  };
}

const ALL = useFileChunks();
const OUT = path.join(process.cwd(), "data", "runs");

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  console.log(`청크 ${ALL.length}건 읽음`);

  const index: { run_id: string; label: string; cards: number; basis: number }[] = [];

  for (const k of ["A", "B", "C"] as DemoKey[]) {
    const demo = DEMO_CASES[k];
    const req = toRequest(demo.form, demo.run_id);

    const steps: { id: string; label: string; detail: string; ms: number }[] = [];
    const payload = await runDiagnose(req, (s) => { steps.push(s); });

    // 굳힌 결과임을 결과 안에 적어 둔다 — 화면이 이걸 보고 배지를 붙인다
    const baked = { ...payload, steps, cached: true, cached_at: new Date().toISOString() };

    const file = path.join(OUT, `${demo.run_id}.json`);
    fs.writeFileSync(file, JSON.stringify(baked, null, 1) + "\n");

    const cards = (baked.cards as { cards?: unknown[] }).cards?.length ?? 0;
    index.push({
      run_id: demo.run_id, label: demo.label,
      cards, basis: baked.basis_chunks.length,
    });
    console.log(`  ✅ ${demo.run_id}  카드 ${cards}장 · 근거 ${baked.basis_chunks.length}건 · ${steps.length}단계`);
  }

  fs.writeFileSync(
    path.join(OUT, "index.json"),
    JSON.stringify(
      { built_at: new Date().toISOString(), ...dataStamp(), runs: index },
      null, 1
    ) + "\n"
  );
  console.log(`\n✅ data/runs/ — ${index.length}건 굳혔습니다. 네트워크 없이도 시연이 돕니다.`);
}

main().catch((e) => { console.error("\n❌ " + (e as Error).stack); process.exit(1); });
