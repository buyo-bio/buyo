"use client";
/**
 * 도구 화면 — 3단 (레일 / 입력 / 결과)
 *
 * 상태는 다섯 가지뿐이다.  빈 화면 → 진행 중 → 결과 / 조회 실패
 * 화면은 계산하지 않는다. /api/diagnose 가 준 cards 만 그린다.
 */
import { useState } from "react";
import Rail, { type ToolView } from "@/components/Rail";
import Progress from "@/components/Progress";
import StatusView from "@/components/StatusView";
import RecentView from "@/components/RecentView";
import InputPanel from "@/components/InputPanel";
import ResultBoard from "@/components/Board";
import {
  DEMO_CASES, EMPTY_FORM, toRequest, type DemoKey, type DiagnoseForm,
} from "@/lib/demo-cases";
import type { Board } from "@/lib/assemble";
import type { Step } from "@/lib/pipeline";

type Stage = "blank" | "loading" | "result" | "error";

export default function Tool() {
  const [view, setView] = useState<ToolView>("diagnose");
  const [form, setForm] = useState<DiagnoseForm>(EMPTY_FORM);
  const [demo, setDemo] = useState<DemoKey | null>(null);
  const [stage, setStage] = useState<Stage>("blank");
  const [board, setBoard] = useState<Board | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [err, setErr] = useState<string>("");

  function pickDemo(k: DemoKey) {
    setDemo(k);
    setForm(DEMO_CASES[k].form);
    setStage("blank");
  }

  /**
   * 스트리밍으로 받는다.
   *
   * 서버가 한 단계를 끝낼 때마다 한 줄(JSON)이 온다. 오는 즉시 화면에 올린다.
   * 마지막 줄이 결과다. 여기서 시간을 끌거나 진행률을 흉내 내지 않는다.
   */
  async function run() {
    setStage("loading");
    setSteps([]);
    setErr("");
    setBoard(null);

    try {
      const res = await fetch("/api/diagnose/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(toRequest(form, demo ? DEMO_CASES[demo].run_id : undefined)),
      });
      if (!res.ok || !res.body) throw new Error(`서버가 ${res.status} 로 답했습니다`);

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let got: Board | null = null;

      // 줄 단위로 끊어 읽는다. 마지막 조각은 다음 덩어리와 이어 붙인다.
      for (;;) {
        const { value, done } = await reader.read();
        if (value) buf += dec.decode(value, { stream: true });

        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;

          const ev = JSON.parse(line) as
            | ({ t: "step" } & Step)
            | { t: "done"; payload: { cards: Board } }
            | { t: "error"; error: string; issues?: string[] };

          if (ev.t === "step") setSteps((prev) => [...prev, ev as Step]);
          else if (ev.t === "done") got = ev.payload.cards;
          else throw new Error(ev.issues?.join(" / ") ?? ev.error);
        }
        if (done) break;
      }

      if (!got) throw new Error("결과가 오다 끊겼습니다");

      // 마지막 단계 ✓ 가 찍히는 걸 눈이 따라갈 틈만 준다
      setBoard(got);
      setTimeout(() => setStage("result"), 260);
    } catch (e) {
      setErr((e as Error).message);
      setStage("error");
    }
  }

  return (
    <div className={`app${view === "diagnose" ? "" : " solo"}`}>
      <Rail view={view} onView={setView} />

      {view === "diagnose" ? (
        <InputPanel
          form={form} onChange={setForm} onRun={run}
          busy={stage === "loading"} demo={demo} onDemo={pickDemo}
        />
      ) : null}

      <main className="main">
        {view === "diagnose" ? (
          <>
            {stage === "blank" ? (
              <div className="blank">
                <div>
                  <div className="art">
                    <svg viewBox="0 0 24 24"><path d="M4 14h4l2 5 4-14 2 7h4" /></svg>
                  </div>
                  <h3>왼쪽에 파이프라인을 입력해 주세요</h3>
                  <p>진단 시작을 누르면 조건에 맞는 판단 기준 문장을 찾아 여섯 관점으로 보여 드립니다.</p>
                </div>
              </div>
            ) : null}

            {stage === "loading" ? (
              <>
                <Progress done={steps} />
                <div className={`grid${board ? " fading" : ""}`}>
                  {[["w30", "w90", "w70"], ["w30", "w70", "w45"],
                    ["w30", "w90", "w45"], ["w30", "w70", "w90"]].map((ws, i) => (
                    <div className="sk-card" key={i} style={{ animationDelay: `${i * 120}ms` }}>
                      {ws.map((w, j) => <div className={`sk ${w}`} key={j} />)}
                    </div>
                  ))}
                </div>
              </>
            ) : null}

            {stage === "error" ? (
              <div className="blank">
                <div>
                  <div className="art err">
                    <svg viewBox="0 0 24 24">
                      <path d="M12 8v5" /><path d="M12 16.5v.01" /><circle cx="12" cy="12" r="9" />
                    </svg>
                  </div>
                  <h3>결과를 불러오지 못했습니다</h3>
                  <p>{err || "잠시 후 다시 시도해 주세요. 입력값은 그대로 남아 있습니다."}</p>
                  <div className="retry">
                    <button className="btn-sm" onClick={run}>다시 시도</button>
                    <button className="btn-sm ghost" onClick={() => setStage("blank")}>입력으로</button>
                  </div>
                </div>
              </div>
            ) : null}

            {stage === "result" && board ? <ResultBoard board={board} /> : null}
          </>
        ) : (
          <div className="side-page">
            <div className="page-head">
              <h2>{view === "recent" ? "최근 조회" : "자료 상태"}</h2>
              <p>
                {view === "recent"
                  ? "돌려 둔 진단입니다. 최근 것이 위로 옵니다."
                  : "이 도구가 무엇을 근거로 말하는지입니다. 전부 센 값입니다."}
              </p>
            </div>
            {view === "recent" ? <RecentView /> : <StatusView />}
          </div>
        )}
      </main>
    </div>
  );
}
