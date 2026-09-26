"use client";
/**
 * 진행 표시 — 진단이 실제로 무엇을 하고 있는지 중계한다
 *
 * 가짜 진행률이 아니다. 서버가 한 단계를 진짜로 끝낼 때마다
 * /api/diagnose/stream 이 한 줄을 보내고, 그 줄이 여기 한 칸을 채운다.
 * 그래서 초 수도 실제 걸린 시간이다.
 *
 * 글자가 한 자씩 찍히는 연출은 일부러 넣지 않았다.
 * 부요는 문장을 지어내지 않는다 — 지어내는 것처럼 보이면 안 된다.
 */
import type { Step, StepId } from "@/lib/pipeline";

/** 아직 안 온 단계도 미리 보여 준다. 몇 개 남았는지 알아야 기다릴 수 있다 */
export const PLAN: { id: StepId; label: string; hint: string }[] = [
  { id: "normalize", label: "조건 정규화", hint: "입력을 조건 다섯 개로 줄입니다" },
  { id: "retrieve", label: "판단 기준 카드 조회", hint: "조건에 맞는 카드를 꺼냅니다" },
  { id: "engines", label: "계산기 실행", hint: "꺼낸 값으로만 계산합니다" },
  { id: "assemble", label: "여섯 관점 카드 조립", hint: "문장 틀에 값을 끼웁니다" },
];

function secs(ms: number) {
  return ms < 950 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}초`;
}

export default function Progress({ done }: { done: Step[] }) {
  const at = done.length;

  return (
    <div className="prog" role="status" aria-live="polite">
      <ol className="prog-list">
        {PLAN.map((p, i) => {
          const hit = done.find((d) => d.id === p.id);
          const state = hit ? "done" : i === at ? "run" : "wait";
          return (
            <li className={`prog-row ${state}`} key={p.id}>
              <span className="prog-dot">
                {state === "done" ? (
                  <svg viewBox="0 0 24 24" aria-hidden><path d="M4 12.5l5 5L20 6.5" /></svg>
                ) : state === "run" ? (
                  <span className="spin" />
                ) : null}
              </span>
              <span className="prog-body">
                <span className="prog-label">
                  {p.label}
                  {hit ? <em className="prog-ms">{secs(hit.ms)}</em> : null}
                </span>
                <span className="prog-detail">{hit ? hit.detail : p.hint}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
