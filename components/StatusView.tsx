"use client";
/**
 * 자료 상태
 *
 * "이 도구는 무엇을 근거로 말하는가" 에 답하는 화면이다.
 * 숫자는 전부 DB 를 센 값이거나 받아 둔 파일에서 읽은 값이다.
 */
import { useEffect, useState } from "react";

type Status = {
  total: number;
  byKind: Record<string, number>;
  byAxis: Record<string, number>;
  patents: { applicant: string; total: number; fetched: number; saved_at: string | null }[];
  blocked: { id: string; name: string; waiting_for: string }[];
};

const AXIS: [string, string, string][] = [
  ["C", "임상", "성공확률 · 단계 기간 · 설계 기준"],
  ["F", "재무", "런웨이 · 단계 비용 · 비교군"],
  ["M", "시장", "기술이전 딜 · 급여 · 역학"],
  ["R", "규제", "허가 경로 · 지정 제도"],
  ["T", "특허", "게이트키퍼 IP · 만료 · IPC"],
  ["N", "뉴스", "수집기가 붙으면 채워집니다"],
];

const KIND: [string, string][] = [
  ["parameter", "숫자"], ["rule", "규칙"], ["method", "방법"], ["mapping", "짝표"],
];

export default function StatusView() {
  const [s, setS] = useState<Status | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then((j) => (j.error ? setErr(j.error) : setS(j)))
      .catch((e) => setErr((e as Error).message));
  }, []);

  if (err) return <p className="tip">자료 상태를 불러오지 못했습니다 — {err}</p>;
  if (!s) return <p className="tip"><span className="spin" /> 세는 중입니다</p>;

  const max = Math.max(...Object.values(s.byAxis), 1);

  return (
    <div className="status">
      <div className="stat-hero">
        <b>{s.total.toLocaleString()}</b>
        <span>판단 기준 카드</span>
        <p>
          {KIND.filter(([k]) => s.byKind[k]).map(([k, label], i) => (
            <span key={k}>{i > 0 ? " · " : ""}{label} {s.byKind[k].toLocaleString()}</span>
          ))}
        </p>
      </div>

      <h3 className="stat-h">축별</h3>
      <ul className="axis-list">
        {AXIS.map(([k, name, desc]) => {
          const n = s.byAxis[k] ?? 0;
          return (
            <li key={k} className={n ? "" : "empty"}>
              <span className="axis-name">{name}</span>
              <span className="axis-bar"><i style={{ width: `${(n / max) * 100}%` }} /></span>
              <span className="axis-n">{n ? n.toLocaleString() : "—"}</span>
              <span className="axis-desc">{desc}</span>
            </li>
          );
        })}
      </ul>

      <h3 className="stat-h">받아 둔 특허 (KIPRIS)</h3>
      {s.patents.length ? (
        <ul className="rec-list">
          {s.patents.map((p) => (
            <li key={p.applicant}>
              <b>{p.applicant}</b>
              <span>
                {p.fetched.toLocaleString()}건
                {p.total > p.fetched ? ` · 전체 ${p.total.toLocaleString()}건 중` : ""}
              </span>
              {p.saved_at ? <em>{p.saved_at}</em> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="tip">아직 없습니다. <code>npm run collect:kipris</code> 로 받습니다.</p>
      )}

      <h3 className="stat-h">아직 못 도는 계산기 {s.blocked.length}개</h3>
      <ul className="rec-list">
        {s.blocked.map((b) => (
          <li key={b.id}>
            <b>{b.name}</b>
            <span>{b.waiting_for}</span>
            <em>{b.id}</em>
          </li>
        ))}
      </ul>
    </div>
  );
}
