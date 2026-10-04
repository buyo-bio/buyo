/**
 * applies_when 식 전부를 읽어 보고, 쓰인 칸 이름이 등록부에 있는지 검사한다.
 *
 * 실행:  npm run aw:check
 *
 * 왜 따로 검사하나
 *   식은 청크 안에 글자로 들어 있다. 오타가 있어도 조용히 "확인 필요" 가 되고,
 *   화면에서는 "자료가 없다" 처럼 보인다. 그래서 식을 미리 다 읽어 둔다.
 *   칸 이름은 enums_v1.json 의 applies_when_fields 가 정본이다.
 */
import { useFileChunks } from "./_file-source";
import { parseAppliesWhen, fieldsUsed, evalAppliesWhen, AppliesWhenError } from "../lib/applies-when";
import enums from "../data/ref/enums.json";

const KNOWN = new Set((enums as { applies_when_fields: string[] }).applies_when_fields);
const ALL = useFileChunks();

type Bad = { chunk_id: string; src: string; why: string };
const broken: Bad[] = [];
const unknown = new Map<string, string[]>();

const exprs: { chunk_id: string; src: string }[] = [];
for (const c of ALL) {
  const aw = (c as unknown as Record<string, unknown>).applies_when;
  if (typeof aw === "string" && aw.trim()) exprs.push({ chunk_id: c.chunk_id, src: aw });
}

for (const { chunk_id, src } of exprs) {
  try {
    parseAppliesWhen(src);
    for (const f of fieldsUsed(src)) {
      if (KNOWN.has(f)) continue;
      if (!unknown.has(f)) unknown.set(f, []);
      unknown.get(f)!.push(chunk_id);
    }
  } catch (e) {
    broken.push({
      chunk_id, src,
      why: e instanceof AppliesWhenError ? e.message : String(e),
    });
  }
}

console.log(`청크 ${ALL.length}건 중 applies_when 있는 것 ${exprs.length}건 (고유 식 ${new Set(exprs.map((x) => x.src)).size}개)`);
console.log(`등록부 칸 ${KNOWN.size}개`);

// ── 세 값 논리가 제대로 도는지 — 안 적은 칸이 거짓이 되면 안 된다
console.log("\n━ 세 값 논리 ━");
const cases: [string, Record<string, unknown>, boolean | null][] = [
  ["always", {}, true],
  ["rcr < 1.0", { rcr: 0.38 }, true],
  ["rcr < 1.0", { rcr: 1.98 }, false],
  ["rcr < 1.0", {}, null],                                   // 안 적었으면 확인 필요
  ["backup_n == 0", { backup_n: 0 }, true],
  ["financial_state in ['S1','S2','S3','S4']", { financial_state: "S2" }, true],
  ["financial_state in ['S1','S2','S3','S4']", { financial_state: "S5" }, false],
  ["'KR' in jurisdictions", { jurisdictions: ["KR", "US"] }, true],
  ["'KR' in jurisdictions", { jurisdictions: "US" }, false],
  ["'KR' in jurisdictions", {}, null],
  // 확실히 안 걸리는 쪽은 칸이 비어도 거짓이어야 한다 — 물음표로 덮이면 안 된다
  ["'US' in jurisdictions and serious_unmet == 'Y'", { jurisdictions: ["KR"] }, false],
  // 반대로 앞이 참이면 뒤를 물어봐야 한다
  ["'US' in jurisdictions and serious_unmet == 'Y'", { jurisdictions: ["US"] }, null],
  ["'KR' in jurisdictions and (disease_group == '항암' or rare == 'Y')",
    { jurisdictions: ["KR"], disease_group: "항암" }, true],
  ["'KR' in jurisdictions and (disease_group == '항암' or rare == 'Y')",
    { jurisdictions: ["KR"], disease_group: "기타", rare: "N" }, false],
  // or 한쪽이 참이면 다른 쪽을 안 물어본다
  ["'KR' in jurisdictions and (disease_group == '항암' or rare == 'Y')",
    { jurisdictions: ["KR"], disease_group: "항암" }, true],
  ["modality not in ['ADC','protein']", { modality: "antibody_mAb" }, true],
  ["modality not in ['ADC','protein']", { modality: "ADC" }, false],
  ["planned_n < ctgov_n_q1", { planned_n: 30, ctgov_n_q1: 58 }, true],
  ["planned_n < ctgov_n_q1", { planned_n: 30 }, null],        // 비교 상대가 없으면 확인 필요
  ["primary_endpoints_n >= 2 and multiplicity_plan == 'N'",
    { primary_endpoints_n: 1 }, false],
];
let triOk = true;
for (const [src, facts, want] of cases) {
  const r = evalAppliesWhen(src, facts);
  const hit = r.value === want;
  if (!hit) triOk = false;
  const show = (v: boolean | null) => (v === null ? "확인 필요" : v ? "걸림" : "안 걸림");
  console.log(`  ${hit ? "✅" : "❌"} ${show(r.value).padEnd(6)} ${src.slice(0, 62)}`);
  if (!hit) console.log(`       기대 ${show(want)} · 못 본 칸 ${r.missing.join(", ") || "없음"}`);
}

// ── 결과
let ok = triOk;
if (broken.length) {
  ok = false;
  console.log(`\n❌ 읽을 수 없는 식 ${broken.length}건`);
  for (const b of broken.slice(0, 10)) console.log(`  ${b.chunk_id}  ${b.why}`);
} else console.log("\n✅ 식 전부 읽힙니다.");

if (unknown.size) {
  ok = false;
  console.log(`\n❌ 등록부에 없는 칸 ${unknown.size}개`);
  for (const [f, ids] of unknown)
    console.log(`  ${f}  (${ids.length}건, 예: ${ids.slice(0, 3).join(", ")})`);
} else console.log("✅ 쓰인 칸 전부 등록부에 있습니다.");

console.log("\n" + (ok ? "✅ 통과" : "⚠️ 위 ❌ 를 확인하세요."));
if (!ok) process.exitCode = 1;
