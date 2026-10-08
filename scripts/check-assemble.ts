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
import { factsFromInput } from "../lib/facts";
import { loadPatents } from "../lib/collect/patents-cache";
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
  // 필드를 골라 넘기면 새로 생긴 값(치료영역 등)이 조용히 빠진다.
  // 실제로 그래서 시연 A 의 항암 기준 값이 TA 없는 쪽으로 내려갔다.
  // API(app/api/diagnose)와 같은 모양으로 통째로 넘긴다.
  const { cond, badges } = await normalize(req as never);
  const stages = nextInflection(req.phase, req.exit_route, { exit_point: req.exit_point }).stages;
  // 파이프라인과 같이 특허 파일을 읽는다.
  // 안 읽으면 특허 카드가 "만료일 미입력" 으로 보이고, 실제 화면과 어긋난다.
  const patents = loadPatents(req.corp_name);
  // 여기서도 필드를 골라 넘기지 않는다. 세 번이나 같은 구멍이 났다
  //   ① 치료영역이 빠져 항암 값이 전체 값으로 내려감
  //   ② 특허 파일을 안 읽어 "만료일 미입력" 으로 보임
  //   ③ 회사 이름이 빠져 "기업 마스터에 없습니다" 로 보임
  const engines = await runEngines(cond, {
    ...(req as unknown as Record<string, unknown>),
    patent_records: patents.records,
    stages,
  } as never);
  // 사실 묶음은 파이프라인과 같은 함수로 만든다 — 따로 적으면 칸이 조용히 빠진다
  const rcrWorst = (engines.rcr.values as { targets?: { RCR: number }[] }).targets?.slice(-1)[0]?.RCR;
  const facts = factsFromInput(cond, req as unknown as Record<string, unknown>, {
    rcr: rcrWorst,
    backup_n: (req.backup_assets ?? []).length,
    rare_kr: (engines.patients.values as { rare_kr?: string }).rare_kr,
  });
  const des = await matchRules("CE-04", cond, { limit: 6, facts });
  const reg = await matchRules("RE-02", cond, { limit: 4, facts });
  const pat = await matchRules("TE-02", cond, { limit: 2, facts });
  const board = await assemble(cond, badges, engines, {
    corp_name: req.corp_name,
    design: des.values as never, regulatory: reg.values as never, patentRules: pat.values as never,
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
