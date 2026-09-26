/**
 * GET /api/status — 자료 상태
 *
 * "판단 기준 문장이 몇 장 있고, 밖에서 받아 온 사실은 어디까지 왔나."
 * 세어서 그대로 내보낸다. 여기서 판단하지 않는다.
 */
import { NextResponse } from "next/server";
import { countChunks, countByKind, countByAxis } from "@/lib/store";
import { listPatentCaches } from "@/lib/collect/patents-cache";
import { BLOCKED_ENGINES } from "@/lib/engines";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Supabase 가 뭄바이에 있다. 진단 한 번에 DB 를 열몇 번 오가므로
// 서버 함수도 같은 동네에 두는 편이 사용자가 기다리는 시간이 짧다.
export const preferredRegion = "bom1";
// 기본 10초로는 조건에 따라 모자란다
export const maxDuration = 60;

export async function GET() {
  try {
    const [total, byKind, byAxis] = await Promise.all([
      countChunks(), countByKind(), countByAxis(),
    ]);
    return NextResponse.json({
      total, byKind, byAxis,
      patents: listPatentCaches(),
      blocked: BLOCKED_ENGINES,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
