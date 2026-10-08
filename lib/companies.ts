/**
 * 기업 마스터 읽기 + 비교군 풀
 *
 * 풀 정의는 규칙 카드 F06-01 이 정본이다.
 *   기업 마스터에서 신약개발_비교군 ∈ {Y, Y(주의 플래그)} ∧ Primary_BM ∈ {BM-01, BM-04}
 *   Y(주의 플래그)에는 comps_caution 배지를 붙인다.
 *
 * 숫자를 여기에 적지 않는다. 91이라는 결과는 세어 나온 것이지 적어 둔 것이 아니다.
 *
 * DB 없이 돌리는 검사도 같은 답을 내야 하므로 CSV 를 직접 읽는 길을 같이 둔다.
 */
import fs from "node:fs";
import path from "node:path";

export type Company = {
  /** "000100" — 앞자리 0 이 뜻을 가진다. 숫자로 바꾸지 않는다 */
  stock_code: string;
  isin: string | null;
  /** DART 고유번호. 역시 앞자리 0 이 있다 */
  dart_code: string | null;
  name: string;
  aliases: string | null;
  market: string | null;
  listed_on: string | null;
  primary_bm: string | null;
  primary_bm_name: string | null;
  bm_detail: string | null;
  secondary_bm: string | null;
  peer_group: string | null;
  /** Y / Y(주의 플래그) / N */
  comps: string | null;
  /** 관리종목·투자주의환기종목 등 */
  trade_flag: string | null;
  trade_memo: string | null;
  headline: string | null;
  pipeline_summary: string | null;
  clinical_status: string | null;
  biotech_class: string | null;
  homepage: string | null;
};

/** CSV 한 줄 읽기 — 따옴표 안의 쉼표·줄바꿈을 살린다 */
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

/** 파일 이름에 판 번호가 붙는다(v2_0 → v2_1). 이름을 적어 두지 않고 찾는다 */
function masterPath(): string {
  const dir = path.join(process.cwd(), "data", "ref");
  const f = fs.readdirSync(dir)
    .filter((x) => x.startsWith("companies") && x.endsWith(".csv"))
    .sort().pop();
  if (!f) throw new Error("data/ref 에 companies*.csv 가 없습니다");
  return path.join(dir, f);
}

/** 한글 열 이름 → DB 열 이름 */
const COL: Record<string, keyof Company> = {
  "종목코드": "stock_code", "ISIN": "isin", "DART고유번호": "dart_code",
  "표준기업명": "name", "이전사명_별칭": "aliases", "시장구분": "market",
  "상장일": "listed_on", "Primary_BM코드": "primary_bm", "Primary_BM명": "primary_bm_name",
  "BM세부분류": "bm_detail", "Secondary_BM코드": "secondary_bm", "Peer그룹": "peer_group",
  "신약개발_비교군": "comps", "거래상태_플래그": "trade_flag", "투자유의_메모": "trade_memo",
  "앱화면_우선노출문구": "headline", "파이프라인요약_원본1": "pipeline_summary",
  "임상단계및개발현황_원본1": "clinical_status", "생명공학기술분류코드_원본1": "biotech_class",
  "홈페이지": "homepage",
};

export function readCompanies(): Company[] {
  const rows = parseCsv(fs.readFileSync(masterPath(), "utf8"));
  const head = rows[0].map((h) => h.trim());
  const out: Company[] = [];

  for (const r of rows.slice(1)) {
    const c = {} as Record<string, string | null>;
    head.forEach((h, i) => {
      const key = COL[h];
      if (!key) return;
      const v = (r[i] ?? "").trim();
      c[key] = v === "" ? null : v;
    });
    // DART 고유번호는 언제나 여덟 자리다. 마스터에는 앞자리 0 이 날아간 채로
    // 들어 있다(508사 전부 — 여섯 자리 278사, 일곱 자리 230사).
    // 엑셀이 숫자로 읽으면서 깎인 것이고, 그대로 쓰면 DART 조회가 전부 빗나간다.
    // 0 을 채우는 것은 값을 지어내는 게 아니라 정해진 자릿수를 되돌리는 것이다.
    //   145109 → 00145109 (유한양행)
    if (c.dart_code && /^\d+$/.test(c.dart_code))
      c.dart_code = c.dart_code.padStart(8, "0");

    // 종목코드도 여섯 자리다. 마스터는 멀쩡하지만 같은 일이 생기면 되돌린다.
    if (c.stock_code && /^\d+$/.test(c.stock_code))
      c.stock_code = c.stock_code.padStart(6, "0");

    if (c.stock_code && c.name) out.push(c as unknown as Company);
  }
  return out;
}

/**
 * 비교군 풀 — F06-01 그대로.
 * 숫자(91)를 적어 두지 않는다. 마스터가 바뀌면 결과도 따라 바뀐다.
 */
export function poolOf(rows: Company[]): Company[] {
  return rows.filter(
    (c) =>
      (c.comps === "Y" || c.comps?.startsWith("Y(")) &&
      (c.primary_bm === "BM-01" || c.primary_bm === "BM-04")
  );
}

/** 주의 플래그가 붙은 회사인가 — 화면에 comps_caution 배지 */
export function isCaution(c: Company): boolean {
  return c.comps !== "Y" && !!c.comps?.startsWith("Y(");
}

/** 회사 이름으로 찾기. "에이비엘바이오 주식회사" 로 적어도 찾는다 */
export function findCompany(rows: Company[], name?: string | null): Company | null {
  if (!name?.trim()) return null;
  const clean = name.replace(/\((주|유|재)\)|주식회사|\(가상\)|\s+/g, "");
  if (!clean) return null;

  const hit = (c: Company) => {
    const names = [c.name, ...(c.aliases ?? "").split(/[|,]/)].map((x) => x.trim()).filter(Boolean);
    return names.some((n) => {
      const nn = n.replace(/\((주|유|재)\)|주식회사|\s+/g, "");
      return nn === clean || nn.includes(clean) || clean.includes(nn);
    });
  };
  // 이름이 정확히 같은 쪽을 먼저
  return rows.find((c) => c.name.replace(/\s+/g, "") === clean) ?? rows.find(hit) ?? null;
}
