/** GET /api/runs — 최근 진단 목록 */
import { NextResponse } from "next/server";
import { listRuns } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Supabase 가 뭄바이에 있다. 진단 한 번에 DB 를 열몇 번 오가므로
// 서버 함수도 같은 동네에 두는 편이 사용자가 기다리는 시간이 짧다.
export const preferredRegion = "bom1";
// 기본 10초로는 조건에 따라 모자란다
export const maxDuration = 60;

export async function GET() {
  try {
    return NextResponse.json({ runs: await listRuns(30) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
