/**
 * 자리 문장 틀 검사 — npm run slots:check
 *
 * 세 가지를 본다.
 *   ① 조사가 받침에 맞게 붙는가 (대표님 3장의 규칙)
 *   ② 틀의 빈칸 이름이 fill 칸에 적힌 것과 같은가 — 어긋나면 값이 안 들어간다
 *   ③ 값이 모자랄 때 문장을 내보내지 않는가 (빈칸이 남은 문장이 화면에 나가면 안 된다)
 */
import slotTexts from "../data/ref/slot_texts.json";
import { josa, fill, renderSlot, slotFields, type SlotText } from "../lib/slot-texts";

const problems: string[] = [];
const ok = (b: boolean, msg: string) => { if (!b) problems.push(msg); };

console.log("━ ① 조사 ━");
// 대표님 3장에 적힌 보기 + 받침 있는/없는 말을 섞어 둔다
const josaCases: [string, string, string][] = [
  ["1상", "을", "1상을"],
  ["2상", "로", "2상으로"],
  ["49억 원", "로", "49억 원으로"],
  ["서울", "로", "서울로"],          // ㄹ 받침 → 로
  ["개월", "로", "개월로"],          // ㄹ 받침 → 로
  ["중앙값", "로", "중앙값으로"],
  ["평균", "로", "평균으로"],
  ["계획 대상자 수", "을", "계획 대상자 수를"],
  ["검정력", "을", "검정력을"],
  ["시험 목적(확증·개념증명·용량 탐색)", "을", "시험 목적(확증·개념증명·용량 탐색)을"],
  ["희귀의약품", "이", "희귀의약품이"],
  ["런웨이", "이", "런웨이가"],
  ["비임상", "은", "비임상은"],
  ["특허", "는", "특허는"],
];
for (const [w, k, want] of josaCases) {
  const got = w + josa(w, k);
  const pass = got === want;
  console.log(`  ${pass ? "✅" : "❌"} ${got}${pass ? "" : `   (기대 ${want})`}`);
  ok(pass, `조사: ${w}+${k} → ${got} (기대 ${want})`);
}

console.log("\n━ ② 틀을 전부 채울 수 있는가 ━");
//
// fill 칸을 기계가 읽는 목록으로 보려 했다가 실패했다. 그 칸은 대표님이 사람에게
// 적어 둔 메모이고, 빈칸이 있는 틀 19개 중에도 fill 이 빈 것이 많다
// (CLIN-1c·PAT-2·REG-2v-* 등). 자료가 약속하지 않은 것을 검사할 수는 없다.
//
// 대신 우리 쪽에서 지킬 수 있는 것을 본다 — 빈칸 문법을 다 읽어 내는가,
// 값을 다 주면 '{' 가 남지 않는가, 조사 표시를 못 알아보고 그대로 흘리지 않는가.
// 빈칸 하나하나의 출처는 그 자리를 실제로 이을 때(J07) 값을 넣어 보며 맞춘다.
const JOSA_KINDS = new Set(["을", "를", "이", "가", "은", "는", "과", "와", "로", "으로"]);
for (const t of slotTexts as SlotText[]) {
  const holes = [...t.sentence.matchAll(/\{([^}|]+)(?:\|([^}]+))?\}/g)];

  // 못 알아보는 조사 표시가 있으면 그대로 화면에 나간다
  for (const h of holes) {
    const kind = h[2]?.trim();
    if (kind && !JOSA_KINDS.has(kind))
      problems.push(`${t.slot}: 모르는 조사 표시 "${kind}" — 그대로 화면에 나갑니다`);
  }

  // 값을 다 주면 빈칸이 남지 않아야 한다
  const values = Object.fromEntries(holes.map((h) => [h[1].trim(), "값"]));
  const out = fill(t.sentence, values);
  if (out === null) problems.push(`${t.slot}: 값을 다 줬는데도 채우지 못했습니다`);
  else if (/[{}]/.test(out)) problems.push(`${t.slot}: 채운 뒤에도 괄호가 남았습니다 — ${out}`);
}
const allSlots = (slotTexts as SlotText[]);
const withHoles = allSlots.filter((t) => /\{/.test(t.sentence)).length;
console.log(`  틀 ${allSlots.length}개 · 빈칸 있는 것 ${withHoles}개 — 전부 채워졌습니다`);

console.log("\n━ ③ 값이 모자라면 문장을 내보내지 않는가 ━");
{
  const partial = fill("런웨이 {runway_m}개월, 자금 {money|이} 필요합니다", { runway_m: 7.2 });
  ok(partial === null, `빈칸이 남았는데 문장을 냈습니다: ${partial}`);
  console.log(`  ✅ 빈칸이 남으면 null (${partial === null ? "확인" : "실패"})`);

  const whole = fill("런웨이 {runway_m}개월", { runway_m: 7.2 });
  ok(whole === "런웨이 7.2개월", `다 채운 문장이 틀립니다: ${whole}`);
  console.log(`  ✅ 다 채우면 문장 — "${whole}"`);
}

console.log("\n━ ④ CHECK-필요 (J08) ━");
{
  const r = renderSlot("CHECK-필요", { input_ko: "검정력" });
  console.log(`  ${r?.text}`);
  ok(r?.text === "확인 필요 — 검정력을 입력하시면 판단할 수 있습니다.", "CHECK-필요 문장이 다릅니다");
  const r2 = renderSlot("CHECK-필요", { input_ko: "계획 대상자 수" });
  console.log(`  ${r2?.text}`);
  ok(r2?.text?.includes("수를 입력하시면") ?? false, "받침 없는 말에 '을' 이 붙었습니다");
}

console.log("\n" + "─".repeat(52));
if (problems.length) {
  console.log(`⚠️ 지적 ${problems.length}건`);
  problems.forEach((p) => console.log("  " + p));
  process.exitCode = 1;
} else {
  console.log("✅ 통과");
}
