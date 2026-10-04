/**
 * data/ref/*.csv  →  Supabase 참조 표 4개
 *
 * 실행:  npm run ref:load
 *
 * 왜 따로 있나
 *   대표님 패키지의 load_kcd.sql 은 COPY 로 적재하는데,
 *   Supabase 는 서버 파일시스템에 CSV 를 둘 수 없어서 COPY 를 쓸 수 없다.
 *   그래서 그릇(테이블·인덱스)은 db/ref_schema.sql 로 만들고,
 *   내용은 이 스크립트가 넣는다. 표 내용은 CSV 그대로이고 손대지 않는다.
 *
 * 순서
 *   ① Supabase SQL Editor 에서 db/ref_schema.sql 실행   (표 만들기)
 *   ② npm run ref:load                                   (이 파일 — 표 채우기)
 *   ③ Supabase SQL Editor 에서 db/autocomplete.sql 실행  (함수 만들기)
 */
import fs from "node:fs";
import path from "node:path";
import "../lib/env";
import { db } from "../lib/store";

const DIR = path.join(process.cwd(), "data", "ref");
const BATCH = 500;

/**
 * CSV 한 줄 쪼개기.
 *
 * 따옴표 안의 쉼표와 "" (이스케이프된 따옴표)를 지킨다.
 * note 열에 쉼표가 들어 있어서 단순 split(",") 으로는 깨진다.
 */
function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** CSV 파일 → 객체 배열. 빈 칸은 null 로 둔다(숫자 0 과 섞이면 안 된다) */
function readCsv(file: string): Record<string, string | null>[] {
  // BOM 제거. 엑셀에서 저장한 CSV 는 맨 앞에 보이지 않는 글자가 하나 붙는다.
  const raw = fs.readFileSync(path.join(DIR, file), "utf8").replace(/^﻿/, "");

  // 따옴표 안의 줄바꿈까지 고려해 레코드 단위로 자른다
  const records: string[] = [];
  let cur = "";
  let q = false;
  for (const ch of raw) {
    if (ch === '"') q = !q;
    if (ch === "\n" && !q) { records.push(cur.replace(/\r$/, "")); cur = ""; }
    else cur += ch;
  }
  if (cur.trim()) records.push(cur.replace(/\r$/, ""));

  const head = splitLine(records[0]).map((h) => h.trim());
  return records.slice(1).filter((l) => l.trim() !== "").map((line) => {
    const cells = splitLine(line);
    const row: Record<string, string | null> = {};
    head.forEach((h, i) => {
      const v = (cells[i] ?? "").trim();
      row[h] = v === "" ? null : v;
    });
    return row;
  });
}

/** 숫자 열만 숫자로 바꾼다 */
function toInt(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function insert(table: string, rows: Record<string, unknown>[]) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const part = rows.slice(i, i + BATCH);
    const { error } = await db.from(table).insert(part);
    if (error) throw new Error(`${table} ${i}~${i + part.length} 실패: ${error.message}`);
    process.stdout.write(`\r  ${table}  ${Math.min(i + BATCH, rows.length)}/${rows.length}`);
  }
  process.stdout.write("\n");
}

async function main() {
  console.log("\n━━ 참조 표 적재 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // 0층 — 세부 치료영역 등록부. 1·2층이 이걸 참조하므로 먼저 넣는다
  const ta = readCsv("therapeutic_area_registry_v1.csv");
  await insert("therapeutic_area", ta);

  // 표기 사전
  const term = readCsv("kcd_term_map_v1.csv");
  await insert("kcd_term_map", term);

  // 1층 — 자주 쓰는 적응증. id 는 serial 이므로 넣지 않는다
  const ind = readCsv("indication_master_v0_4.csv").map((r) => ({
    name_ko: r.name_ko, synonyms: r.synonyms,
    mesh_label_en: r.mesh_label_en, mesh_id: r.mesh_id, mesh_verified: r.mesh_verified,
    icd10: r.icd10, buyo_disease_group: r.buyo_disease_group, subgroup: r.subgroup,
    therapeutic_area: r.therapeutic_area, ta_source: r.ta_source, ta_alt: r.ta_alt,
    rare_hint: r.rare_hint, note: r.note,
  }));
  await insert("indications", ind);

  // 2층 — KCD 전체
  const kcd = readCsv("kcd_master_v3.csv").map((r) => ({
    kcd_code: r.kcd_code, name_ko: r.name_ko, search_name: r.search_name,
    name_en: r.name_en, query_en: r.query_en,
    level: toInt(r.level), chapter: r.chapter,
    buyo_disease_group: r.buyo_disease_group, therapeutic_area: r.therapeutic_area,
    ta_rule_id: r.ta_rule_id, searchable: r.searchable, master_ref: r.master_ref,
    needs_user_confirm: r.needs_user_confirm, rare_user_confirm: r.rare_user_confirm,
    kcd_version: r.kcd_version, note: r.note,
  }));
  await insert("kcd_master", kcd);

  // 센 수를 그대로 보여 준다. 기대값과 다르면 여기서 바로 보인다.
  const pool = kcd.filter((k) => k.searchable === "Y" && k.master_ref == null).length;
  const searchable = kcd.filter((k) => k.searchable === "Y").length;

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  therapeutic_area       ${ta.length}건   (기대 21)
  kcd_term_map           ${term.length}건   (기대 2)
  indications            ${ind.length}건  (기대 216)
  kcd_master             ${kcd.length.toLocaleString()}건  (기대 14,590)
    searchable=Y         ${searchable.toLocaleString()}건  (기대 8,124)
    자동완성 대상         ${pool.toLocaleString()}건  (기대 7,886)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

다음: Supabase SQL Editor 에서 db/autocomplete.sql 을 돌리세요.
      확인 쿼리 →  SELECT * FROM autocomplete('당뇨');
`);
}

main().catch((e) => {
  console.error("\n실패:", (e as Error).message);
  process.exit(1);
});
