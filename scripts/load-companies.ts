/**
 * 기업 마스터 508사 → DB
 *
 * 실행:  npm run companies:load
 *        (먼저 Supabase SQL Editor 에서 db/companies.sql 을 돌려 주세요)
 *
 * 이 표가 있어야 회사 이름으로 종목코드·DART번호를 찾고,
 * 비교군 풀 91사(F06-01)를 추릴 수 있습니다.
 *
 * 종목코드·DART고유번호는 앞자리 0 이 뜻을 가집니다("000100" 유한양행).
 * 숫자로 바꾸면 날아갑니다 — 글자 그대로 넣습니다.
 */
import fs from "node:fs";
import path from "node:path";
import "../lib/env";
import { getDb } from "../lib/store";
import { readCompanies, poolOf } from "../lib/companies";

const BATCH = 200;

async function main() {
  console.log("\n━━ 기업 마스터 적재 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const rows = readCompanies();
  const pool = poolOf(rows);
  console.log(`  읽음        ${rows.length}사`);
  console.log(`  비교군 풀    ${pool.length}사  (F06-01: 신약개발_비교군 Y ∧ BM-01·BM-04)`);
  console.log(`  주의 플래그  ${pool.filter((r) => r.comps !== "Y").length}사`);

  const db = getDb();

  // 번호가 아니라 종목코드가 열쇠라 덮어쓸 수 있다
  for (let i = 0; i < rows.length; i += BATCH) {
    const part = rows.slice(i, i + BATCH);
    const { error } = await db.from("companies").upsert(part);
    if (error) throw new Error(`companies ${i}~${i + part.length} 실패: ${error.message}`);
    process.stdout.write(`\r  적재        ${Math.min(i + BATCH, rows.length)}/${rows.length}`);
  }
  process.stdout.write("\n");

  const { count, error } = await db
    .from("companies").select("*", { count: "exact", head: true });
  if (error) throw new Error(`개수 확인 실패: ${error.message}`);

  console.log(`\n✅ 적재 완료 — companies ${count}사`);
  if (count !== rows.length)
    console.log(`⚠️ 파일은 ${rows.length}사인데 표에는 ${count}사입니다`);

  // 앞자리 0 이 살아 있는지 — 한 번 날아간 적이 있다
  const { data: yh } = await db
    .from("companies").select("stock_code, dart_code, name").eq("name", "유한양행").maybeSingle();
  if (yh) console.log(`   앞자리 0 확인: 유한양행 종목 ${yh.stock_code} · DART ${yh.dart_code}`);

  console.log(`\n다음       npm run companies:check`);
  void path; void fs;
}

main().catch((e) => { console.error("\n❌ " + (e as Error).message); process.exit(1); });
