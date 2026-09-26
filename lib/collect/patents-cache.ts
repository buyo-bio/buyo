/**
 * 수집해 둔 특허를 읽는다.
 *
 * npm run collect:kipris 가 data/records/patents/<출원인>.json 에 저장해 둔 것을
 * 진단할 때 꺼내 쓴다. 진단 도중에 KIPRIS 를 부르지 않는다.
 *   · 발표장에서 네트워크가 끊겨도 돌아야 한다
 *   · 무료 한도가 월 1,000회다
 */
import fs from "node:fs";
import path from "node:path";
import type { PatentRecord } from "./kipris";

const DIR = path.join(process.cwd(), "data", "records", "patents");

/** 회사 이름으로 찾는다. "에이비엘바이오 주식회사" 로 적어도 "에이비엘바이오" 파일을 찾는다 */
export function loadPatents(corpName?: string | null): {
  records: PatentRecord[];
  matched_file: string | null;
} {
  if (!corpName || !fs.existsSync(DIR)) return { records: [], matched_file: null };

  const clean = corpName.replace(/\((주|유|재)\)|주식회사|\(가상\)|\s+/g, "");
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".json"));

  const hit = files.find((f) => {
    const name = f.replace(/\.json$/, "");
    return clean.includes(name) || name.includes(clean);
  });
  if (!hit) return { records: [], matched_file: null };

  try {
    const j = JSON.parse(fs.readFileSync(path.join(DIR, hit), "utf8"));
    return { records: (j.records ?? []) as PatentRecord[], matched_file: hit };
  } catch {
    return { records: [], matched_file: null };
  }
}

/** 받아 둔 특허 파일 목록 — '자료 상태' 화면이 쓴다 */
export function listPatentCaches(): {
  applicant: string; total: number; fetched: number; saved_at: string | null;
}[] {
  if (!fs.existsSync(DIR)) return [];
  return fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const full = path.join(DIR, f);
      try {
        const j = JSON.parse(fs.readFileSync(full, "utf8"));
        return {
          applicant: (j.applicant_query as string) ?? f.replace(/\.json$/, ""),
          total: (j.total as number) ?? 0,
          fetched: (j.fetched as number) ?? (j.records?.length ?? 0),
          saved_at: fs.statSync(full).mtime.toISOString().slice(0, 10),
        };
      } catch {
        return { applicant: f.replace(/\.json$/, ""), total: 0, fetched: 0, saved_at: null };
      }
    })
    .sort((a, b) => b.fetched - a.fetched);
}
