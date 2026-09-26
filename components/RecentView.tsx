"use client";
/**
 * 최근 조회
 *
 * runs 에 쌓인 진단 머리말만 보여 준다. 카드 전체는 무거워서 안 받는다.
 */
import { useEffect, useState } from "react";

type Row = {
  run_id: string;
  input: { corp_name?: string; asset_name?: string; modality?: string; phase?: string } | null;
  normalized: { cond?: { disease_group?: string | null; phase?: string } } | null;
  as_of: string | null;
  created_at: string | null;
};

function when(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "방금";
  if (mins < 60) return `${mins}분 전`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}시간 전`;
  return d.toISOString().slice(0, 10);
}

export default function RecentView() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/api/runs")
      .then((r) => r.json())
      .then((j) => (j.error ? setErr(j.error) : setRows(j.runs)))
      .catch((e) => setErr((e as Error).message));
  }, []);

  if (err) return <p className="tip">목록을 불러오지 못했습니다 — {err}</p>;
  if (!rows) return <p className="tip"><span className="spin" /> 불러오는 중입니다</p>;
  if (!rows.length)
    return <p className="tip">아직 없습니다. 진단을 한 번 돌리면 여기에 쌓입니다.</p>;

  return (
    <ul className="run-list">
      {rows.map((r) => {
        const i = r.input ?? {};
        const c = r.normalized?.cond ?? {};
        const bits = [i.modality, c.disease_group, i.phase ?? c.phase].filter(Boolean);
        return (
          <li key={r.run_id}>
            <div className="run-main">
              <b>{i.asset_name || i.corp_name || r.run_id}</b>
              {bits.length ? <span>{bits.join(" · ")}</span> : null}
            </div>
            <div className="run-meta">
              <em>{r.run_id}</em>
              <span>{when(r.created_at)}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
