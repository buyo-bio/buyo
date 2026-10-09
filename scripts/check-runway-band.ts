/**
 * 커버리지 밴드가 청크 조건식대로 갈리는지 — 경계값 시험
 *
 * 실행:  npm run band:check
 *
 * 대표님이 20261007 에 재무 판정을 "변곡점 대비 비율"에서 "런웨이 개월 수"로
 * 바꾸기로 했다. 임계값(18·12)은 코드가 아니라 F01-0003~0005 의 조건식에 있다.
 *
 * 이 검사는 두 가지를 본다.
 *   ① 지금 청크(비율 기준)로 밴드가 제대로 갈리나
 *   ② 새 청크(런웨이 개월 기준)가 오면 대표님 경계값 표대로 갈리나
 *
 * ②는 아직 릴리스가 안 와서 조건식을 여기에 적어 두고 평가기만 돌린다.
 * 릴리스가 오면 이 표의 기대값이 그대로 실제 청크로 확인된다.
 */
import { useFileChunks } from "./_file-source";
import { evalAppliesWhen } from "../lib/applies-when";
import type { Chunk } from "../lib/types";

const ALL = useFileChunks();
const f = (c: Chunk, k: string) => (c as unknown as Record<string, unknown>)[k];

/** 조건이 참인 밴드 한 장 고르기 — 엔진과 같은 방식 */
function pick(
  bands: { id: string; when: string; flag: string }[],
  facts: Record<string, unknown>
): { id: string; flag: string } | null {
  for (const b of bands) {
    if (evalAppliesWhen(b.when, facts).value === true) return { id: b.id, flag: b.flag };
  }
  return null;
}

let bad = 0;
const show = (x: { id: string } | null) => x?.id ?? "(없음)";

// ── 지금 자료의 밴드 청크 — 무엇을 보고 판정하는지 그대로 찍는다
const bands = ["F01-0003", "F01-0004", "F01-0005"].map((id) => {
  const c = ALL.find((x) => x.chunk_id === id);
  if (!c) throw new Error(`${id} 가 자료에 없습니다 — 밴드 규칙이 빠졌습니다`);
  return { id, when: String(f(c, "applies_when")), flag: String(f(c, "flag_hint")) };
});
console.log("━ 밴드 규칙 ━");
for (const b of bands) console.log(`  ${b.id}  ${b.flag.padEnd(8)} ${b.when}`);

// 조건식이 어느 칸을 보는지에 따라 시험값이 달라진다.
// 기준이 바뀌어도(비율 → 런웨이 개월) 이 검사가 따라가게 한다.
const usesRunway = bands.some((b) => /runway_months/.test(b.when));
console.log(`\n━ 기준: ${usesRunway ? "런웨이 개월" : "변곡점 대비 비율"} ━`);

// 대표님 문서 6절 경계값 표 (런웨이 기준일 때)
const edgeRunway: [number | null, string][] = [
  [11.9, "F01-0005"],
  [12.0, "F01-0004"],
  [17.9, "F01-0004"],
  [18.0, "F01-0003"],
  [null, "(없음)"],
  [11.4, "F01-0005"],   // 시연 A
  [15.0, "F01-0004"],   // 시연 B
  [15.8, "F01-0004"],   // 시연 C
];
const edgeRcr: [number | null, string][] = [
  [1.98, "F01-0003"], [1.5, "F01-0003"], [1.2, "F01-0004"],
  [0.38, "F01-0005"], [null, "(없음)"],
];

const key = usesRunway ? "runway_months" : "rcr";
for (const [v, want] of usesRunway ? edgeRunway : edgeRcr) {
  const facts = v === null ? {} : { [key]: v };
  const got = show(pick(bands, facts));
  const ok = got === want;
  if (!ok) bad++;
  console.log(`  ${ok ? "✅" : "❌"} ${key}=${String(v ?? "값 없음").padEnd(8)} → ${got}${ok ? "" : `  (기대 ${want})`}`);
}

// 참고 정보 두 줄 — 색에 쓰지 않는다
console.log("\n━ 참고 정보(색 판정 제외) ━");
for (const id of ["F01-0034", "F01-0035"]) {
  const c = ALL.find((x) => x.chunk_id === id);
  if (!c) { console.log(`  · ${id} 없음 — 아직 릴리스에 안 들어왔습니다`); continue; }
  const flag = String(f(c, "flag_hint"));
  const ok = flag === "neutral";
  if (!ok) bad++;
  console.log(`  ${ok ? "✅" : "❌"} ${id} ${flag} ${f(c, "applies_when")}`);
}

// 기준값은 청크에 — 코드에 박지 않는다
console.log("\n━ 기준값 청크 ━");
for (const id of ["F01-0036", "F01-0037"]) {
  const c = ALL.find((x) => x.chunk_id === id);
  if (!c) { console.log(`  · ${id} 없음`); continue; }
  console.log(`  ✅ ${id} ${f(c, "value")}${f(c, "unit")} — ${String(f(c, "text")).slice(0, 34)}…`);
}
console.log();

// 어느 값에서도 정확히 하나만 걸려야 한다
console.log("\n━ 겹침 확인 — 어느 값에서도 밴드는 하나만 ━");
let overlap = 0;
for (let m = 0; m <= 360; m++) {
  const hit = bands.filter((b) => evalAppliesWhen(b.when, { [key]: m / 10 }).value === true);
  if (hit.length !== 1) { overlap++; if (overlap <= 3) console.log(`  ❌ 런웨이 ${m / 10} → ${hit.length}개`); }
}
if (overlap) bad++;
console.log(`  ${overlap ? "❌" : "✅"} ${key} 0.0~36.0 구간 361개 지점 — 겹치거나 빈 곳 ${overlap}개`);

// ─────────────────────────────────────────────
// 희석률 밴드 (F02-0004~0006) — 대표님 20261007 에 20/30 에서 25/30 으로 바뀜
//
// 런웨이 밴드와 같은 종류라 같은 자리에서 본다. 기준값을 코드에 적지 않고
// 청크의 applies_when 을 그대로 평가한다.
// ─────────────────────────────────────────────
console.log("\n━ 희석률 밴드 (F02-0004~0006) ━");
{
  const ids: string[] = ["F02-0004", "F02-0005", "F02-0006"];
  const rules: { id: string; when: string }[] = [];
  for (const id of ids) {
    const c = ALL.find((x) => x.chunk_id === id);
    if (!c) continue;
    const when = String(f(c, "applies_when") ?? "");
    if (when) rules.push({ id, when });
  }

  if (rules.length !== 3) {
    console.log(`  ❌ 희석률 밴드 청크가 ${rules.length}개입니다(기대 3개)`);
    bad++;
  } else {
    // 대표님 경계표: 통상 범위 ≤25 · 상단 25~30 · 초과 >30
    const edges: [number, string][] = [
      [10, "F02-0004"], [25, "F02-0004"],
      [25.1, "F02-0005"], [28, "F02-0005"], [30, "F02-0005"],
      [30.1, "F02-0006"], [45, "F02-0006"],
    ];
    for (const [pct, want] of edges) {
      const hit = rules.filter(
        (r) => evalAppliesWhen(r.when, { dilution_min_pct: pct, dilution_max_pct: pct }).value === true
      );
      const got = hit.length === 1 ? hit[0].id : `${hit.length}개`;
      const ok = got === want;
      if (!ok) bad++;
      console.log(`  ${ok ? "✅" : "❌"} 희석률 ${pct}% → ${got}${ok ? "" : ` (기대 ${want})`}`);
    }

    // 값이 없으면 셋 다 '확인 필요' — 임의로 통상 범위라고 하지 않는다
    const none = rules.map((r) => evalAppliesWhen(r.when, {}).value);
    const allNull = none.every((v) => v === null);
    if (!allNull) bad++;
    console.log(`  ${allNull ? "✅" : "❌"} 희석률을 안 받으면 셋 다 확인 필요`);
  }
}

console.log("\n" + (bad ? "⚠️ 위 ❌ 를 확인하세요." : "✅ 통과"));
if (bad) process.exitCode = 1;
