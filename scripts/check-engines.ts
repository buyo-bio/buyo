/**
 * DB 없이 엔진만 검증한다. 청크는 data/chunks/*.jsonl 에서 직접 읽는다.
 *
 * 실행:  npm run engines:check
 *
 * 목표값 출처
 *   케이스 A — 결과화면 명세
 *   케이스 C — 예시 보고서 BUYO-DX-S01 (2026-09-25)
 */
import { useFileChunks } from "./_file-source";
import { runEngines } from "../lib/engines";
import { normalize, nextInflection } from "../lib/normalize";
import { DEMO_CASES, toRequest, type DemoKey } from "../lib/demo-cases";
import type { Chunk, Conditions } from "../lib/types";

const ALL = useFileChunks();

const f1 = (x: number | null | undefined, d = 1) =>
  x === null || x === undefined ? "—" : x.toFixed(d);
const usdM = (v: number | null) => (v === null ? "근거 없음" : `$${(v / 1e6).toFixed(2)}M`);

async function runCase(k: DemoKey) {
  const req = toRequest(DEMO_CASES[k].form);
  // 필드를 골라 넘기면 새로 생긴 값(치료영역 등)이 조용히 빠진다.
  // 실제로 그래서 설계안 최소 비용이 '전체' 값으로 내려갔다.
  // API(app/api/diagnose)와 같은 모양으로 통째로 넘긴다.
  const { cond, badges } = await normalize(req as never);
  const stages = nextInflection(req.phase, req.exit_route, { exit_point: req.exit_point }).stages;
  const engines = await runEngines(cond, {
    cash: req.cash, restricted_cash: req.restricted_cash,
    monthly_burn: req.monthly_burn, committed_raise: req.committed_raise,
    stages, planned_n: req.planned_n,
    backup_assets: req.backup_assets, targets: req.targets,
  });
  return { cond, badges, engines, stages };
}

async function main() {
  console.log(`청크 ${ALL.length}건 읽음`);

  for (const k of ["A", "B", "C"] as DemoKey[]) {
    const { cond, engines: r } = await runCase(k);
    const run = r.runway.values as { runway_m: number | null };
    const dur = r.duration.values as { years_total: number | null };
    const rcr = r.rcr.values as {
      targets: { label: string; months: number; RCR: number; band: string; raises_needed: number | null }[];
      worst_band: string | null;
    };
    const need = r.need.values as { need_current_phase_usd: number | null };
    const bench = r.bench.values as { total_usd_m: number | null; legs: { phase: string; usd_m: number }[] };
    const suc = r.success.values as {
      conditional: { value: number; chunk_id: string } | null;
      cumulative: { value: number; chunk_id: string } | null;
      cumulative_alt: { value: number; chunk_id: string } | null;
    };

    console.log("\n" + "━".repeat(64));
    console.log(`[${DEMO_CASES[k].label}]  ${cond.modality || "(전체)"} · ${cond.disease_group ?? "(전체)"} · ${cond.phase} · ${cond.fin_state}`);
    console.log(`  성공확률   조건부 ${suc.conditional ? suc.conditional.value + "% (" + suc.conditional.chunk_id + ")" : "근거 없음"}` +
      ` / 누적 ${suc.cumulative ? suc.cumulative.value + "% (" + suc.cumulative.chunk_id + ")" : "근거 없음"}` +
      (suc.cumulative_alt ? ` / 참고 ${suc.cumulative_alt.value}% (${suc.cumulative_alt.chunk_id})` : ""));
    console.log(`  기간       ${f1(dur.years_total)}년  [${r.duration.status}]`);
    console.log(`  런웨이     ${f1(run.runway_m)}개월  [${r.runway.status}]`);
    for (const t of rcr.targets ?? [])
      console.log(`  커버리지   ${t.label.padEnd(8)} ${t.RCR.toFixed(2)}  ${t.band}` +
        `  (필요 ${f1(t.months)}개월${t.raises_needed ? ` · 추가 조달 ${t.raises_needed}회` : ""})`);
    console.log(`  설계안 최소 ${usdM(need.need_current_phase_usd)}  [${r.need.status}]`);
    console.log(`  업계 평균  ${bench.total_usd_m !== null ? "$" + bench.total_usd_m.toFixed(1) + "M (" + bench.legs.map(l => `${l.phase} ${l.usd_m}`).join(" + ") + ")" : "근거 없음"}  [${r.bench.status}]`);
  }

  // ── 목표값 대조
  console.log("\n" + "━".repeat(64));
  console.log("━ 끝났다는 증거 ━");

  type Check = [string, string, string, boolean];
  const checks: Check[] = [];
  const near = (a: number | null, b: number, tol: number) => a !== null && Math.abs(a - b) < tol;

  {
    const { engines: r } = await runCase("A");
    const run = (r.runway.values as { runway_m: number | null }).runway_m;
    const t = (r.rcr.values as { targets: { RCR: number }[] }).targets[0];
    const need = (r.need.values as { need_current_phase_usd: number | null }).need_current_phase_usd;
    checks.push(["A 런웨이", "11.4개월", `${f1(run)}개월`, near(run, 11.4, 0.05)]);
    checks.push(["A 커버리지", "0.15", t ? t.RCR.toFixed(2) : "—", near(t?.RCR ?? null, 0.15, 0.005)]);
    checks.push(["A 설계안 최소", "$5.99M", usdM(need), near(need ? need / 1e6 : null, 5.99, 0.02)]);
  }
  {
    const { cond, engines: r } = await runCase("C");
    const run = (r.runway.values as { runway_m: number | null }).runway_m;
    const ts = (r.rcr.values as { targets: { label: string; RCR: number; raises_needed: number | null }[] }).targets;
    const ind = ts.find((t) => t.label === "IND 제출");
    const p1 = ts.find((t) => t.label === "P1 완료");
    const need = (r.need.values as { need_current_phase_usd: number | null }).need_current_phase_usd;
    const bench = (r.bench.values as { total_usd_m: number | null }).total_usd_m;
    const suc = r.success.values as { cumulative: { value: number } | null };

    checks.push(["C 재무 상태", "S2 (RCPS)", String(cond.fin_state), cond.fin_state === "S2"]);
    checks.push(["C 런웨이", "15.8개월", `${f1(run)}개월`, near(run, 15.8, 0.05)]);
    checks.push(["C IND까지", "1.98 양호", ind ? ind.RCR.toFixed(2) : "—", near(ind?.RCR ?? null, 1.98, 0.01)]);
    checks.push(["C P1 완료까지", "0.38 미달", p1 ? p1.RCR.toFixed(2) : "—", near(p1?.RCR ?? null, 0.38, 0.01)]);
    checks.push(["C 추가 조달", "2회", p1?.raises_needed != null ? `${p1.raises_needed}회` : "—", p1?.raises_needed === 2]);
    checks.push(["C 설계안 최소", "$3.72M", usdM(need), near(need ? need / 1e6 : null, 3.72, 0.02)]);
    checks.push(["C 업계 평균", "$30.3M (5.0+25.3)", bench !== null ? `$${bench.toFixed(1)}M` : "—", near(bench, 30.3, 0.05)]);
    checks.push(["C ADC 누적확률", "10.8%", suc.cumulative ? `${suc.cumulative.value}%` : "—", suc.cumulative?.value === 10.8]);
  }

  let ok = true;
  for (const [name, want, have, hit] of checks) {
    if (!hit) ok = false;
    console.log(`  ${hit ? "✅" : "❌"} ${name.padEnd(16)} 목표 ${want.padEnd(18)} 결과 ${have}`);
  }
  console.log("\n" + (ok ? "  ✅ 목표 전부 일치." : "  ⚠️ 위 ❌ 를 확인하세요."));
  console.log("━".repeat(64));
  if (!ok) process.exitCode = 1;
}

main().catch((e) => { console.error("\n❌ " + (e as Error).stack); process.exit(1); });
