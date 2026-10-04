/**
 * 적응증 마스터(CSV) → 코드 ↔ 이름 색인
 *
 * 실행:  npm run gen:ind
 *
 * 왜 필요한가
 *   M02(국내 환자 수)는 적응증 마스터의 name_ko 로 걸려 있다.
 *   화면이 자동완성에서 고른 값은 MeSH 코드(D013274)로 온다.
 *   둘을 잇는 것은 마스터 한 줄뿐이다 — DB 없이 돌리는 검사에서도
 *   같은 답이 나와야 하므로 파일로 뽑아 둔다.
 *
 * 손으로 고치지 마세요. 마스터가 바뀌면 이 명령만 다시 돌립니다.
 */
import fs from "node:fs";
import path from "node:path";

const SRC = path.join(process.cwd(), "data", "ref");
const OUT = path.join(process.cwd(), "data", "ref", "indication_index.json");

// 마스터 파일 이름에 판 번호가 붙는다(v0_4 → v0_5 …).
// 이름을 적어 두면 판이 바뀔 때 조용히 옛 파일을 읽는다.
const file = fs.readdirSync(SRC)
  .filter((f) => f.startsWith("indication_master") && f.endsWith(".csv"))
  .sort()
  .pop();
if (!file) throw new Error("data/ref 에 indication_master*.csv 가 없습니다");

/** 따옴표 안의 쉼표·줄바꿈을 살리는 CSV 읽기 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

const rows = parseCsv(fs.readFileSync(path.join(SRC, file), "utf8"));
const head = rows[0].map((h) => h.trim());
const col = (n: string) => head.indexOf(n);
for (const n of ["name_ko", "mesh_id", "icd10", "synonyms"])
  if (col(n) < 0) throw new Error(`마스터에 ${n} 칸이 없습니다 (${file})`);

/** 코드·별칭 → name_ko. 코드는 "MeSH:D013274" 와 "D013274" 둘 다 넣는다 */
const byKey: Record<string, string> = {};
const put = (k: string, v: string) => {
  const key = k.trim();
  if (!key) return;
  // 먼저 들어온 쪽을 둔다 — 마스터 위쪽이 대표 적응증이다
  if (!(key in byKey)) byKey[key] = v;
};

for (const r of rows.slice(1)) {
  const name = r[col("name_ko")]?.trim();
  if (!name) continue;
  put(name, name);
  const mesh = r[col("mesh_id")]?.trim();
  if (mesh) { put(mesh, name); put(`MeSH:${mesh}`, name); }
  const icd = r[col("icd10")]?.trim();
  if (icd) for (const c of icd.split("|")) { put(c, name); put(`KCD:${c.trim()}`, name); }
  for (const syn of (r[col("synonyms")] ?? "").split("|")) put(syn, name);
}

fs.writeFileSync(OUT, JSON.stringify({ source: file, map: byKey }, null, 0) + "\n");
console.log(`✅ ${OUT} — 열쇠 ${Object.keys(byKey).length}개 (원본 ${file}, ${rows.length - 1}행)`);
