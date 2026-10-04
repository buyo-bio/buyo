/**
 * POST /api/diagnose/stream — 진단 한 번을, 단계가 끝나는 대로 흘려보낸다
 *
 * 줄 하나에 JSON 하나(NDJSON). 이벤트 네 가지.
 *   {"t":"step",  ...Step}      한 단계가 실제로 끝났다
 *   {"t":"done",  payload}      다 끝났다. 화면은 이 cards 를 그린다
 *   {"t":"error", error, issues}
 *
 * 가짜 지연은 넣지 않는다. 각 줄이 나가는 시각 = 그 일이 진짜 끝난 시각이다.
 */
import { runDiagnose, InputError, type Step } from "@/lib/pipeline";
import { cachedRun } from "@/lib/demo-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Supabase 가 뭄바이에 있다. 진단 한 번에 DB 를 열몇 번 오가므로
// 서버 함수도 같은 동네에 두는 편이 사용자가 기다리는 시간이 짧다.
export const preferredRegion = "bom1";
// 기본 10초로는 조건에 따라 모자란다
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "JSON 이 아닙니다" }), { status: 400 });
  }

  const enc = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(c) {
      const send = (o: unknown) => c.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      try {
        const payload = await runDiagnose(body, (s: Step) => send({ t: "step", ...s }));
        send({ t: "done", payload });
      } catch (e) {
        // 입력이 틀린 것은 고쳐야 할 일이다. 굳힌 결과로 덮지 않는다.
        if (e instanceof InputError) {
          send({ t: "error", error: e.message, issues: e.issues });
        } else {
          console.error(e);

          // DB 가 안 되거나 네트워크가 끊긴 경우 — 시연이라면 굳혀 둔 결과를 내보낸다.
          // 발표장에서 빈 화면을 띄우는 것보다 낫다. 실시간인 척하지는 않는다.
          const run_id = (body as { run_id?: unknown } | null)?.run_id;
          const baked = cachedRun(run_id);
          if (baked) {
            for (const s of baked.steps ?? [])
              send({ t: "step", ...s, detail: `${s.detail} (저장된 결과)` });
            send({ t: "done", payload: baked });
          } else {
            send({ t: "error", error: (e as Error).message });
          }
        }
      } finally {
        c.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      // 프록시가 모아 뒀다가 한꺼번에 보내면 중계가 의미 없다
      "x-accel-buffering": "no",
    },
  });
}
