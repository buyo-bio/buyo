"use client";
import { useState } from "react";
import type { Board, BoardCard, CardFlag, CardLine, CardTerm, Evidence } from "@/lib/assemble";

const TAG: Record<CardFlag, [string, string]> = {
  positive: ["t-ok", "양호"],
  caution: ["t-caution", "주의"],
  neutral: ["t-none", "중립"],
  no_evidence: ["t-none", "근거 없음"],
};

/**
 * 근거 원문 목록.
 *
 * 카드 ID(T06-0389 같은 것)는 우리 창고 번호다. 본문에 깔아 두면
 * 읽을 수 없는 회색 덩어리가 된다 — 펼쳤을 때만 원문과 함께 보여 준다.
 */
function Detail({ ids, evidence }: { ids: string[]; evidence: Record<string, Evidence> }) {
  return (
    <div className="detail">
      {ids.map((id) => {
        const e = evidence[id];
        return (
          <div className="ev" key={id}>
            <p className="src">
              {id}
              {e?.trust_tier ? ` · 등급 ${e.trust_tier}` : ""}
              {e?.source ? ` · ${e.source}` : ""}
            </p>
            <p className="txt sm">{e ? e.text : "이 카드를 찾지 못했습니다"}</p>
          </div>
        );
      })}
    </div>
  );
}

/**
 * 용어에 밑줄을 긋고 풀이를 달아 준다.
 *
 * 문장을 낱말 경계로 쪼개 그 자리에만 <abbr> 를 넣는다. 문장을 다시 쓰지 않는다 —
 * 글자는 청크가 들고 있는 그대로여야 한다.
 */
function withTerms(text: string, terms?: CardTerm[], used?: Set<string>) {
  if (!terms?.length) return text;
  // 긴 낱말부터 — "임상 1상" 이 "1상" 보다 먼저 잡혀야 한다
  const sorted = [...terms]
    .filter((t) => !used?.has(t.text))
    .sort((a, b) => b.text.length - a.text.length);
  if (!sorted.length) return text;
  let parts: (string | CardTerm)[] = [text];
  for (const t of sorted) {
    const next: (string | CardTerm)[] = [];
    for (const p of parts) {
      if (typeof p !== "string") { next.push(p); continue; }
      const i = p.indexOf(t.text);
      // 한 줄에 같은 낱말이 여러 번 나와도 첫 번째에만 — 밑줄이 도배되지 않게
      if (i < 0) { next.push(p); continue; }
      if (i > 0) next.push(p.slice(0, i));
      next.push(t);
      // 한 줄 안에서 같은 낱말에 두 번 밑줄을 긋지 않는다. 제목·본문·뜻에 거듭
      // 나오면 카드가 점선으로 뒤덮여 읽기 어려워진다 — 처음 한 번만 긋는다.
      used?.add(t.text);
      const tail = p.slice(i + t.text.length);
      if (tail) next.push(tail);
    }
    parts = next;
  }
  return parts.map((p, i) =>
    typeof p === "string" ? (
      <span key={i}>{p}</span>
    ) : (
      <abbr key={i} className="term" title={p.example ? `${p.explain}\n\n예: ${p.example}` : p.explain}>
        {p.text}
      </abbr>
    )
  );
}

/**
 * 문장 한 줄 + 그 줄만의 근거.
 *
 * 대표님 표시 규칙(20261008): 제목 굵게 · 본문 · 뜻은 회색 · action 은 "확인할 일:".
 * 출처는 chunk_id 가 아니라 source_label 로 띄운다 — 창고 번호는 고객 화면에
 * 쓰지 않는다. 번호는 '근거 보기' 를 펼쳤을 때 원문과 함께만 보인다.
 */
function Line({
  line, evidence, delay,
}: { line: CardLine; evidence: Record<string, Evidence>; delay: number }) {
  const [open, setOpen] = useState(false);
  const { basis, badges, terms } = line;
  // 제목·본문·뜻·확인할 일을 가로질러 낱말 하나에 밑줄 한 번
  const used = new Set<string>();
  // display 가 있으면 제목이 본문과 따로 온다. 없으면 title 에 한 줄이 다 들어 있다.
  const head = line.title ?? line.text;
  const layered = Boolean(line.body || line.meaning || line.action);

  return (
    <div className="ev" style={{ animationDelay: `${delay}ms` }}>
      <p className={layered ? "txt head" : "txt"}>{withTerms(head, terms, used)}</p>
      {line.body ? <p className="txt">{withTerms(line.body, terms, used)}</p> : null}
      {line.meaning ? <p className="txt sub">{withTerms(line.meaning, terms, used)}</p> : null}
      {line.action ? (
        <p className="txt todo">확인할 일: {withTerms(line.action, terms, used)}</p>
      ) : null}

      <span className="chips">
        {line.verdict ? <span className="chip-verdict">{line.verdict}</span> : null}
        {badges?.length ? <span className="chip-warn">{badges.join(" · ")}</span> : null}
        {line.source_label ? (
          <span className="src-label" title={line.source_note || undefined}>
            {line.source_label}
          </span>
        ) : null}
      </span>

      {basis.length ? (
        <>
          <button className="more sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? "근거 닫기" : `근거 ${basis.length}건`}
          </button>
          {open ? <Detail ids={basis} evidence={evidence} /> : null}
        </>
      ) : null}
    </div>
  );
}

function Card({
  card, delay, evidence,
}: { card: BoardCard; delay: number; evidence: Record<string, Evidence> }) {
  const [open, setOpen] = useState(false);
  const [cls, label] = TAG[card.flag];

  // 줄에 붙지 않은 근거만 카드 아래에 모은다.
  // 줄마다 버튼이 생겼으니 여기서 또 전부 세면 같은 걸 두 번 보여주는 셈이다.
  const onLines = new Set(card.lines.flatMap((l) => l.basis));
  const rest = card.basis_chunks.filter((id) => !onLines.has(id));

  return (
    <article
      id={`card-${card.key}`}
      className={`card${card.flag === "no_evidence" ? " none" : ""}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="card-top">
        <h4>{card.title}</h4>
        <span className={`tagf ${cls}`}>{label}</span>
      </div>

      {card.lines.map((l, i) => (
        <Line key={i} line={l} evidence={evidence} delay={delay + 140 + i * 55} />
      ))}

      {card.pending ? <p className="blankcard">{card.pending}</p> : null}

      {rest.length ? (
        <>
          <button className="more" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? "나머지 근거 닫기" : `나머지 근거 ${rest.length}건`}
          </button>
          {open ? <Detail ids={rest} evidence={evidence} /> : null}
        </>
      ) : null}
    </article>
  );
}

/**
 * 맨 윗줄 요약.
 *
 * 카드 다섯 장을 다 읽기 전에 '어디에 불이 켜졌는지'만 먼저 보여 준다.
 * 옆에 붙는 문장은 그 카드의 첫 줄을 그대로 옮긴 것이다 — 여기서 새로 쓰지 않는다.
 * 누르면 그 레인으로 밀어 준다.
 */
function Summary({ board }: { board: Board }) {
  const { counts, attention, rest } = board.summary;

  const tally = ([
    ["caution", "주의"], ["positive", "양호"],
    ["neutral", "중립"], ["no_evidence", "근거 없음"],
  ] as const).filter(([k]) => counts[k] > 0);

  function jump(key: string) {
    document.getElementById(`card-${key}`)?.scrollIntoView({
      behavior: "smooth", inline: "start", block: "nearest",
    });
  }

  return (
    <section className="summary">
      <div className="summary-tally">
        {tally.map(([k, label]) => (
          <span className={`tally t-${k}`} key={k}>
            <i />{label} {counts[k]}
          </span>
        ))}
      </div>

      {attention.length ? (
        <ul className="summary-list">
          {attention.map((a) => (
            <li key={a.key}>
              <button onClick={() => jump(a.key)}>
                <b>{a.title}</b>
                <span>{a.line}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="summary-none">주의로 켜진 칸이 없습니다.</p>
      )}

      {rest.length ? (
        <p className="summary-rest">
          {rest.map((r, i) => (
            <span key={r.key}>
              {i > 0 ? <em> · </em> : null}
              <button onClick={() => jump(r.key)}>
                {r.title}
                <i className={`dot d-${r.flag}`} />
              </button>
            </span>
          ))}
        </p>
      ) : null}
    </section>
  );
}

export default function ResultBoard({
  board, cachedAt,
}: {
  board: Board;
  /** 미리 굳혀 둔 결과를 보고 있으면 언제 굳힌 것인지 — 실시간인 척하지 않는다 */
  cachedAt?: string | null;
}) {
  const c = board.conditions;
  const crumb = [
    c.modality || "전체",
    c.disease_group ?? "질환군 미확정",
    c.phase,
    c.rare === "Y" ? "희귀" : null,
  ].filter(Boolean) as string[];

  return (
    <>
      <div className="main-head">
        <div className="crumb">
          {crumb.map((t) => <span className="pill" key={t}>{t}</span>)}
        </div>
        <span className="asof">데이터 기준 {board.as_of}</span>
      </div>

      {cachedAt ? (
        <p className="tip" style={{ marginBottom: 14 }}>
          저장된 결과입니다({cachedAt.slice(0, 10)} 기준) — 지금 조회한 값이 아닙니다.
        </p>
      ) : null}

      <Summary board={board} />

      {board.badges.length ? (
        <p className="tip" style={{ marginBottom: 14 }}>
          {board.badges.join(" / ")}
        </p>
      ) : null}

      <div className="grid">
        {board.cards.map((card, i) => (
          <Card card={card} key={card.key} delay={i * 90} evidence={board.evidence ?? {}} />
        ))}
      </div>
    </>
  );
}
