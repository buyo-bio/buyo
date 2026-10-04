/**
 * POST /api/diagnose            진단 한 번 (한 방에 응답)
 * GET  /api/diagnose?run_id=…   저장된 결과 다시 보기
 *
 * 계산은 lib/pipeline.ts 가 한다. 여기는 껍데기다.
 * 화면이 쓰는 건 스트리밍 쪽(/api/diagnose/stream)이고,
 * 이 길은 검증 스크립트와 외부 호출용으로 남겨 둔다.
 */
import { NextResponse } from "next/server";
import { runDiagnose, InputError } from "@/lib/pipeline";
import { getRun } from "@/lib/store";
import { cachedRun } from "@/lib/demo-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Supabase 가 뭄바이에 있다. 진단 한 번에 DB 를 열몇 번 오가므로
// 서버 함수도 같은 동네에 두는 편이 사용자가 기다리는 시간이 짧다.
export const preferredRegion = "bom1";
// 기본 10초로는 조건에 따라 모자란다
export const maxDuration = 60;

/** 시연 3건은 미리 저장해 둔 결과를 그대로 읽는다(발표장 네트워크 대비) */
export async function GET(req: Request) {
  const runId = new URL(req.url).searchParams.get("run_id");
  if (!runId) return NextResponse.json({ error: "run_id 가 필요합니다" }, { status: 400 });

  // DB 가 안 되면 굳혀 둔 시연 결과로 — 발표장 네트워크 대비
  let run: unknown = null;
  try {
    run = await getRun(runId);
  } catch (e) {
    console.error("getRun 실패:", (e as Error).message);
  }
  if (!run) run = cachedRun(runId);
  if (!run) return NextResponse.json({ error: `${runId} 결과가 없습니다` }, { status: 404 });
  return NextResponse.json(run);
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON 이 아닙니다" }, { status: 400 });
  }

  try {
    return NextResponse.json(await runDiagnose(body));
  } catch (e) {
    if (e instanceof InputError)
      return NextResponse.json({ error: e.message, issues: e.issues }, { status: 422 });
    console.error(e);
    const baked = cachedRun((body as { run_id?: unknown } | null)?.run_id);
    if (baked) return NextResponse.json(baked);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
