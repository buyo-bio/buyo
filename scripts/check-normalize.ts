/**
 * DB 없이 정규화만 검증한다.
 * T01 등록부는 jsonl 에서 직접 읽어서 store.ts(=Supabase) 없이 돈다.
 *
 * 실행:  npm run norm:check
 */
import fs from "node:fs";
import path from "node:path";
import { financeState, nextInflection, resolveIndication, INFLECTION_KO } from "../lib/normalize";

// ── T01 등록부를 파일에서 읽어 대체 규칙을 재현한다
type Entry = { tag: string; parent: string | null; label: string; status: string; hasValue: boolean };
const reg = new Map<string, Entry>();
for (const l of fs.readFileSync(path.join("data", "chunks", "T01_chunks_v0.jsonl"), "utf8")
  .split("\n").filter(Boolean)) {
  const d = JSON.parse(l);
  if (!d.tag) continue;
  reg.set(d.tag, {
    tag: d.tag, parent: d.parent_tag ?? null, label: d.label_ko ?? d.tag,
    status: String(d.value_status ?? ""), hasValue: String(d.value_status ?? "").startsWith("값 있음"),
  });
}

function resolve(picked: string) {
  const e = reg.get(picked);
  if (!e) return { tag: picked, badge: "등록부에 없음" };
  if (e.hasValue) return { tag: e.tag, badge: undefined as string | undefined };
  const named = e.status.match(/→\s*([a-zA-Z_]+)\s*값/);
  if (named) {
    const alt = reg.get(named[1]);
    if (alt?.hasValue) return { tag: alt.tag, badge: `${e.label} 전용 값 없음 → ${alt.label} 값 사용` };
  }
  if (e.parent) for (const s of reg.values())
    if (s.parent === e.parent && s.hasValue)
      return { tag: s.tag, badge: `${e.label} 전용 값 없음 → ${s.label} 값 사용` };
  return { tag: "", badge: `${e.label} 값 없음 → 전체 기준` };
}

console.log("━ T01 등록부 " + reg.size + "개 · 값 있는 태그 " +
  [...reg.values()].filter(e => e.hasValue).length + "개\n");

console.log("━ 모달리티 대체 규칙 ━");
for (const t of ["small_molecule","antibody","antibody_mAb","antibody_bispecific",
                 "ADC","cell_therapy","cell_TCRT","gene_therapy","vaccine","other"]) {
  const r = resolve(t);
  console.log(`  ${t.padEnd(22)} → ${(r.tag || "(전체)").padEnd(16)} ${r.badge ?? ""}`);
}

console.log("\n━ 시연 3건 ━");
const CASES = [
  { n: "A · ABL503",  mod: "antibody_bispecific", ind: "진행성·전이성 고형암", ph: "P1", ex: "license_out" as const,
    fin: { cash: 560, monthly_burn: 49, listed: true, license_income_ttm: 1 } },
  { n: "B · SB17170", mod: "small_molecule", ind: "특발성 폐섬유증", ph: "P2", ex: "license_out" as const,
    fin: { cash: 120, monthly_burn: 8, listed: false } },
  { n: "C · 익명",     mod: "small_molecule", ind: "비소세포폐암", ph: "preclinical", ex: "self_develop" as const,
    fin: { cash: 7.2, monthly_burn: 1 } },
];
for (const c of CASES) {
  const m = resolve(c.mod);
  const i = resolveIndication(c.ind);
  const f = financeState(c.fin);
  const x = nextInflection(c.ph, c.ex);
  console.log(`\n  [${c.n}]`);
  console.log(`    모달리티  ${c.mod} → ${m.tag || "(전체)"}`);
  if (m.badge) console.log(`              배지: ${m.badge}`);
  console.log(`    적응증    ${i.code ?? "(코드 없음)"} · 질환군 ${i.group ?? "(전체)"} · rare=${i.rare}`);
  if (i.note) console.log(`              배지: ${i.note}`);
  console.log(`    단계      ${c.ph} · 출구 ${c.ex}`);
  console.log(`    재무      ${f.state} · 런웨이 ${f.runway_m?.toFixed(1) ?? "—"}개월`);
  console.log(`    변곡점    ${x.inflection} (${INFLECTION_KO[x.inflection]}) · 단계 [${x.stages.join(", ")}]`);
}
