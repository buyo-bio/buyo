/**
 * ME-17 단계 차이 검사 — npm run gap:check
 *
 * 목표값은 대표님 작업대 추적 결과다(docs/jinmo_todo_market_20261007.md 1장 6항).
 *   C 비임상 ADC, 출구 P1_end → earlier
 *   A 1상 항체,  기본 출구 P2 → earlier
 *   B 2상 저분자, 기본 출구 P2 → same
 *
 * 라벨뿐 아니라 "그래서 어느 규칙이 걸리는가" 까지 본다. 라벨만 맞고 규칙이
 * 안 걸리면 화면에는 아무 설명도 안 나온다.
 */
import { useFileChunks } from "./_file-source";
import { normalize } from "../lib/normalize";
import { factsFromInput } from "../lib/facts";
import { matchRules } from "../lib/engines/rules";
import { ME_08, dealExitPhase, dealPoolPhase, phaseGapOf } from "../lib/engines/market";
import { DEMO_CASES, toRequest, type DemoKey } from "../lib/demo-cases";

useFileChunks();

/** 라벨 → 그때 걸려야 하는 규칙 */
const RULE_FOR: Record<string, string | null> = {
  earlier: "M03-1007", later: "M03-1008", same: null,
};
const WANT: Record<string, "earlier" | "same" | "later"> = {
  A: "earlier", B: "same", C: "earlier",
};

const problems: string[] = [];

(async () => {
  console.log("━ 시연 세 건 ━");
  for (const k of ["A", "B", "C"] as DemoKey[]) {
    const req = toRequest(DEMO_CASES[k].form) as unknown as Record<string, unknown>;
    const { cond } = await normalize(req as never);
    const d = await ME_08(cond as never);
    const stages = ((d.values as { deals?: { stage: string }[] }).deals ?? []).map((x) => x.stage);

    const pool = dealPoolPhase(stages, cond.phase);
    const exit = dealExitPhase(cond.phase, req.exit_route as string, req.exit_point as string);
    const gap = phaseGapOf(pool, exit);
    const want = WANT[k];
    const okGap = gap === want;
    if (!okGap) problems.push(`${k}: 단계 차이 ${gap} (기대 ${want})`);

    // 라벨이 실제로 규칙을 걸었는가
    const facts = factsFromInput(cond, req, { phase_gap_label: gap ?? undefined });
    const r = await matchRules("ME-17", cond, { limit: 4, facts });
    const ids = ((r.values as { rules?: { chunk_id: string }[] }).rules ?? []).map((x) => x.chunk_id);
    const need = RULE_FOR[want];
    const okRule = need === null ? !ids.includes("M03-1007") && !ids.includes("M03-1008")
                                 : ids.includes(need);
    if (!okRule)
      problems.push(`${k}: ${want} 인데 ${need ?? "단계 차이 규칙 없음"} 이 안 걸렸습니다 (걸린 것: ${ids.join(", ") || "없음"})`);

    console.log(`  ${okGap && okRule ? "✅" : "❌"} ${k}  딜 ${stages.length}건 · 풀 ${pool ?? "—"} / 출구 ${exit ?? "—"} → ${gap ?? "판단 안 함"}`);
    console.log(`       걸린 규칙 ${ids.join(", ") || "없음"}`);
  }

  // ── 섞인 풀은 판단하지 않는다
  console.log("\n━ 섞인 풀·값 없음 ━");
  const mixed = dealPoolPhase(["P1", "P3"], "P2");
  if (mixed !== null) problems.push(`단계가 섞였는데 ${mixed} 로 판단했습니다`);
  console.log(`  ${mixed === null ? "✅" : "❌"} 단계가 섞이면 판단하지 않음`);

  const multi = dealPoolPhase(["preclinical|P1", "P1"], "P1");
  console.log(`  ${multi === "P1" ? "✅" : "❌"} 모든 딜이 지금 단계를 품으면 지금 단계 (${multi})`);
  if (multi !== "P1") problems.push(`여러 단계 표기를 ${multi} 로 읽었습니다 (기대 P1)`);

  const empty = dealPoolPhase([], "P2");
  if (empty !== null) problems.push("풀이 비었는데 단계를 냈습니다");
  console.log(`  ${empty === null ? "✅" : "❌"} 풀이 비면 판단하지 않음`);

  // 자가개발은 기술이전 시점이 없다
  const self = dealExitPhase("P2", "self_develop", undefined);
  if (self !== null) problems.push(`자가개발인데 출구 단계를 냈습니다: ${self}`);
  console.log(`  ${self === null ? "✅" : "❌"} 자가개발이면 출구 단계 없음`);

  // 목표 시점 표기 두 가지를 다 받는가
  const a = dealExitPhase("preclinical", "license_out", "P1_end");
  const b = dealExitPhase("preclinical", "license_out", "P1_complete");
  if (a !== "P1" || b !== "P1") problems.push(`목표 시점 표기를 못 읽었습니다: P1_end→${a}, P1_complete→${b}`);
  console.log(`  ${a === "P1" && b === "P1" ? "✅" : "❌"} P1_end·P1_complete 둘 다 P1 로 읽음`);

  console.log("\n" + "─".repeat(52));
  if (problems.length) {
    console.log(`⚠️ 지적 ${problems.length}건`);
    problems.forEach((p) => console.log("  " + p));
    process.exitCode = 1;
  } else console.log("✅ 통과");
})();
