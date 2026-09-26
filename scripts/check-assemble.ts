/**
 * DB 없이 ⑤카드 조립까지 돌려서 화면 문장을 눈으로 확인한다.
 *
 * 실행:  npm run cards:check
 *
 * 결과화면 명세의 케이스 A 문장과 맞아야 한다.
 *   임상  "누적 승인 확률 12.1%(단클론항체 기준), 항암 기준 5.3% — 두 값 사이에서 읽어야 합니다."
 *   재무  "런웨이 11.4개월, 변곡점까지 6.4년 → 커버리지 0.15"
 *   특허  "만료일 미입력"
 */
import { useFileChunks } from "./_file-source";
import { runEngines, matchRules } from "../lib/engines";
import { assemble, type BoardCard } from "../lib/assemble";
import { normalize, nextInflection } from "../lib/normalize";
import { DEMO_CASES, toRequest, type DemoKey } from "../lib/demo-cases";
import type { Chunk, Conditions } from "../lib/types";

const ALL = useFileChunks();

const LAMP: Record<string, string> = {
  positive: "🟢 양호", caution: "🟠 주의", neutral: "⚪ 중립", no_evidence: "⚫ 근거 없음",
};

function show(c: BoardCard) {
  console.log(`\n  ┌ ${c.title}  ${LAMP[c.flag]}`);
  for (const l of c.lines) {
    const head = l.text.length > 150 ? l.text.slice(0, 150) + "…" : l.text;
    console.log(`  │ ${head}`);
    const tail = [
      l.basis.length ? `근거 ${l.basis.join(", ")}` : "",
      l.badges?.length ? `배지 ${l.badges.join(" / ")}` : "",
    ].filter(Boolean).join("  ·  ");
    if (tail) console.log(`  │    ${tail}`);
  }
  if (c.pending) console.log(`  └ 대기: ${c.pending}`);
  else console.log("  └");
}

async function runCase(k: DemoKey) {
  const req = toRequest(DEMO_CASES[k].form);
  const { cond, badges } = await normalize({
    modality: req.modality as never, indication: req.indication,
    phase: req.phase as never, exit_route: req.exit_route, exit_point: req.exit_point,
    cash: req.cash, monthly_burn: req.monthly_burn,
    listed: req.listed, convertible: req.convertible,
    license_income_ttm: req.license_income_ttm,
  });
  const stages = nextInflection(req.phase, req.exit_route, { exit_point: req.exit_point }).stages;
  const engines = await runEngines(cond, {
    cash: req.cash, restricted_cash: req.restricted_cash,
    monthly_burn: req.monthly_burn, committed_raise: req.committed_raise,
    stages, planned_n: req.planned_n,
    backup_assets: req.backup_assets, targets: req.targets,
  });
  const reg = await matchRules("RE-02", cond, { limit: 4 });
  const pat = await matchRules("TE-02", cond, { limit: 2 });
  const board = await assemble(cond, badges, engines, {
    regulatory: reg.values as never, patentRules: pat.values as never,
  });
  return { cond, board };
}

async function main() {
  console.log(`청크 ${ALL.length}건 읽음`);

  for (const k of ["A", "B", "C"] as DemoKey[]) {
    const { cond, board } = await runCase(k);
    console.log("\n" + "━".repeat(64));
    console.log(`[${DEMO_CASES[k].label}]  ${cond.modality || "(전체)"} · ${cond.disease_group ?? "(전체)"} · ${cond.phase} · rare=${cond.rare}`);
    for (const b of board.badges) console.log(`  배지: ${b}`);
    for (const card of board.cards) show(card);
  }

  // ── 명세 문장과 맞나 (케이스 A)
  console.log("\n" + "━".repeat(64));
  console.log("━ 케이스 A 문장 대조 ━");
  const { board } = await runCase("A");
  const find = (k: string) => board.cards.find((x) => x.key === k)!;
  const want: [string, string, string][] = [
    ["임상", "누적 승인 확률 12.1%(단클론항체 기준), 항암 기준 5.3% — 두 값 사이에서 읽어야 합니다.",
      find("clinical").lines[0].text],
  ];
  let ok = true;
  for (const [name, expected, got] of want) {
    const hit = got === expected;
    if (!hit) ok = false;
    console.log(`  ${hit ? "✅" : "❌"} ${name}`);
    if (!hit) { console.log(`       명세 ${expected}`); console.log(`       결과 ${got}`); }
  }
  console.log("\n" + (ok ? "  ✅ 문장 일치." : "  ⚠️ 문장이 다릅니다."));
  console.log("━".repeat(64));
  if (!ok) process.exitCode = 1;
}

main().catch((e) => { console.error("\n❌ " + (e as Error).stack); process.exit(1); });
