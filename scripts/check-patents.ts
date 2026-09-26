/**
 * 특허 엔진 검증 — 네트워크 없이 돈다.
 *
 * 실행:  npm run patents:check
 *
 * 수집 파일이 있으면 그걸 쓰고, 없으면 케이스 C(LMB-201)의 특허 4건으로 확인한다.
 * 케이스 C는 가상 회사라 KIPRIS 에 없으므로 입력값을 그대로 쓴다.
 */
import { useFileChunks } from "./_file-source";
import fs from "node:fs";
import path from "node:path";
import { TE_08, TE_09, TE_03, ipcLadder } from "../lib/engines";
import type { PatentRecord } from "../lib/collect/kipris";
import type { Chunk, Conditions } from "../lib/types";

const ALL = useFileChunks();

// ── 케이스 C 의 특허 4건 (reference/source-data/case_C_input_v2_LMB201.json)
const CASE_C: PatentRecord[] = [
  { applicant: "(주)루미어스바이오(가상)", application_number: "KR-2024-PCT",
    application_date: "2024-03-01", title: "항-CLDN18.2 항체 및 용도",
    ipc: ["C07K16/28"], register_status: "공개", register_date: null,
    register_number: null, abstract: "" },
  { applicant: "(주)루미어스바이오(가상)", application_number: "KR-2024-002",
    application_date: "2024-03-01", title: "항체-약물 접합체 조성물",
    ipc: ["A61K47/68"], register_status: "공개", register_date: null,
    register_number: null, abstract: "" },
  { applicant: "(주)루미어스바이오(가상)", application_number: "KR-2025-003",
    application_date: "2025-02-01", title: "캄토테신 유도체 링커-페이로드",
    ipc: ["C07D491/22"], register_status: "공개", register_date: null,
    register_number: null, abstract: "" },
  { applicant: "(주)루미어스바이오(가상)", application_number: "KR-2025-004",
    application_date: "2025-06-01", title: "CLDN18.2 면역조직화학 검출 방법",
    ipc: ["G01N33/574"], register_status: "공개", register_date: null,
    register_number: null, abstract: "" },
];

function loadCollected(): { name: string; records: PatentRecord[] }[] {
  const dir = path.join(process.cwd(), "data", "records", "patents");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    return { name: j.applicant_query as string, records: j.records as PatentRecord[] };
  });
}

async function report(name: string, records: PatentRecord[]) {
  console.log("\n" + "━".repeat(64));
  console.log(`[${name}]  특허 ${records.length}건`);

  const pf = await TE_08(records);
  const v = pf.values as {
    n_patents: number; n_registered: number;
    groups: { ipc: string; matched: string | null; level: string | null;
              count: number; summary: string | null; modality_hint: string | null }[];
    substance_candidates: string[]; earliest_expiry_year: number | null; unmatched_ipc: string[];
  };

  console.log(`  등록 ${v.n_registered}건 · IPC 묶음 ${v.groups.length}종  [${pf.status}]`);
  for (const g of v.groups.slice(0, 8)) {
    const lv = g.level === "정확" ? " " : `↑${g.level}`;
    console.log(`    ${g.ipc.padEnd(14)} ${String(g.count).padStart(3)}건 ${lv.padEnd(7)} ${(g.summary ?? "—").slice(0, 34)}`);
  }
  if (v.unmatched_ipc.length)
    console.log(`    ⚠️ 사전에 없음 ${v.unmatched_ipc.length}종: ${v.unmatched_ipc.slice(0, 6).join(", ")}`);
  if (v.substance_candidates.length)
    console.log(`    물질특허 후보  ${v.substance_candidates.slice(0, 5).join(", ")}`);
  if (v.earliest_expiry_year)
    console.log(`    가장 이른 만료 ${v.earliest_expiry_year}년`);

  const hint = await TE_09(pf.values as never);
  const h = hint.values as { modality_hint: string[]; counts: Record<string, number> };
  console.log(`  모달리티 힌트  ${h.modality_hint.length ? h.modality_hint.join(" / ") : "없음"}` +
    `  ${JSON.stringify(h.counts)}  [${hint.status}]`);

  // 케이스 C: 물질특허 2044년 만료, 승인까지 11.0년 → 잔여 약 7년 (보고서 10쪽)
  const al = await TE_03({} as Conditions, { patent_expiry_year: 2044, years_to_approval: 11.0 });
  const a = al.values as { launch_year_est: number | null; patent_life_at_launch: number | null };
  console.log(`  만료 정렬      출시 추정 ${a.launch_year_est}년 · 잔여 ${a.patent_life_at_launch}년  [${al.status}]`);
  return a.patent_life_at_launch;
}

async function main() {
  console.log(`청크 ${ALL.length}건 · IPC 사전 T06/T07`);

  console.log("\n━ IPC 사다리 확인 ━");
  for (const c of ["C07K 16/28", "A61K 47/68", "C07D 491/22", "G01N 33/574"])
    console.log(`  ${c.padEnd(14)} → ${ipcLadder(c).join("  →  ")}`);

  const collected = loadCollected();
  if (collected.length === 0)
    console.log("\n(수집 파일 없음 — npm run collect:kipris 를 돌리면 실제 회사로도 확인됩니다)");
  for (const c of collected) await report(c.name, c.records);

  const life = await report("C · LMB-201 (입력값)", CASE_C);

  console.log("\n" + "━".repeat(64));
  const ok = life === 7;
  console.log(`  ${ok ? "✅" : "❌"} 특허 잔여 기간   목표 7년   결과 ${life}년   (예시 보고서 10쪽)`);
  console.log("━".repeat(64));
  if (!ok) process.exitCode = 1;
}

main().catch((e) => { console.error("\n❌ " + (e as Error).stack); process.exit(1); });
