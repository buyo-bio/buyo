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
        if (e instanceof InputError) send({ t: "error", error: e.message, issues: e.issues });
        else {
          console.error(e);
          send({ t: "error", error: (e as Error).message });
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
