/**
 * GET /api/autocomplete?q=당뇨  —  적응증 자동완성
 *
 * 판정은 전부 DB 함수 autocomplete(q, lim) 가 한다(db/autocomplete.sql).
 * 여기서는 부르고 그대로 넘긴다 — 순서를 다시 매기거나 걸러내지 않는다.
 *
 * 찾는 순서(함수 안)
 *   ① 1층 indications 216행      자주 쓰는 적응증
 *   ② 2층 kcd_master 7,886행     KCD 전체
 *   ③ 둘 다 모자라면 닮은 글자    "척추측만증" → "척주측만증"
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type Suggestion = {
  layer: 1 | 2;
  code: string | null;
  name_ko: string;
  buyo_disease_group: string | null;
  therapeutic_area: string | null;
  rare_hint: string | null;
  flag: string | null;
  query_en: string | null;
  match_type: string;
  score: number;
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const lim = Number(url.searchParams.get("lim") ?? 8);

  // 한 글자로는 너무 많이 걸린다. 두 글자부터 찾는다.
  if (q.length < 2) return NextResponse.json({ items: [] });

  try {
    const { data, error } = await getDb().rpc("autocomplete", { q, lim });
    if (error) throw new Error(error.message);
    return NextResponse.json({ items: (data ?? []) as Suggestion[] });
  } catch (e) {
    // 자동완성이 죽어도 입력은 막지 않는다. 사용자는 그냥 손으로 적으면 된다.
    console.error("autocomplete 실패:", (e as Error).message);
    return NextResponse.json({ items: [], error: (e as Error).message });
  }
}
