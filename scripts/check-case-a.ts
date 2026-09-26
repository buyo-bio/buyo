/**
 * 첫날 목표 — 케이스 A(에이비엘바이오 ABL503) 조건으로 카드를 꺼내
 * C01 세 행이 우선순위대로 나오는지 확인한다.
 *
 *   C01-0092  1상→2상      54.7%   (단클론항체)
 *   C01-0096  1상→승인     12.1%   (단클론항체, 누적)
 *   C01-0012  1상→승인      5.3%   (항암, 누적)
 *
 * 실행:  npx tsx scripts/check-case-a.ts
 */
import "../lib/env";
import { countChunks, countByKind, findChunks, getChunks } from "../lib/store";
import type { Conditions } from "../lib/types";

// ② 정규화가 내놓을 조건 (아직 정규화 코드가 없으니 손으로 적음)
const COND: Conditions = {
  modality: "antibody_mAb",     // 입력은 이중항체 → T01 등록부에 따라 mAb 값 사용 + 배지
  modality_badge: "이중항체 전용 값 미확보 → 단클론항체 값 사용",
  indication_code: "MeSH:D009369",   // 고형암(항암)
  disease_group: "항암",
  phase: "P1",
  rare: "N",
  jurisdiction: "KR",
};

const TARGET = ["C01-0092", "C01-0096", "C01-0012"];

async function main() {
  // ── 1. 적재 확인
  const total = await countChunks();
  const byKind = await countByKind();
  console.log("━".repeat(58));
  console.log(`카드 총 ${total}건  ${total === 1746 ? "✅" : "⚠️ 기대값 1746"}`);
  console.log("  " + Object.entries(byKind)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`).join(" · "));

  // ── 2. 목표 카드가 실제로 있나
  console.log("\n━ 목표 카드 3개 ━");
  const got = await getChunks(TARGET);
  for (const id of TARGET) {
    const c = got[id] as any;
    if (!c) { console.log(`  ❌ ${id} 없음`); continue; }
    console.log(`  ✅ ${id}  ${c.value}${c.unit ?? ""}  ` +
      `${c.phase ?? "-"}→${(c.meta?.phase_to) ?? "-"}  ` +
      `modality=${c.modality ?? "전체"}  ind=${c.indication_code ?? "전체"}`);
  }

  // ── 3. 조건으로 꺼냈을 때 C01이 어떻게 나오나
  console.log("\n━ 케이스 A 조건으로 C01 조회 ━");
  console.log(`  modality=${COND.modality} · ${COND.disease_group} · ${COND.phase} · rare=${COND.rare}`);
  const c01 = await findChunks(COND, { domain: "C01", kind: "parameter", limit: 20 });
  console.log(`  걸린 카드 ${c01.length}건 (상위 8개)`);
  c01.slice(0, 8).forEach((c: any, i) => {
    const hit = TARGET.includes(c.chunk_id) ? " ★" : "";
    console.log(`   ${String(i + 1).padStart(2)}. ${c.chunk_id}  ${c.value}${c.unit ?? ""}  ` +
      `tier${c.trust_tier}  ${c.modality ?? "전체"}/${c.indication_code ?? "전체"}${hit}`);
  });

  // ── 4. 판정
  const ids = c01.map((c: any) => c.chunk_id);
  const found = TARGET.filter(t => ids.includes(t));
  console.log("\n━".repeat(1) + " 판정 ━");
  if (found.length === 3) {
    console.log("  ✅ 목표 카드 3개가 모두 조회됩니다. 첫날 목표 달성.");
  } else {
    console.log(`  ⚠️ ${found.length}/3 — 빠진 것: ${TARGET.filter(t => !ids.includes(t)).join(", ")}`);
    console.log("     필터 조건이나 우선순위 정렬을 확인하세요.");
  }
  console.log("━".repeat(58));
}

main().catch(e => { console.error("\n❌ " + e.message); process.exit(1); });
