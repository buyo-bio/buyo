/**
 * ⑤ 카드 조립 — 엔진 결과를 화면 칸 6개로 만든다
 *
 * 이 파일의 규칙 하나:
 *   화면에 나가는 글은 둘 중 하나뿐이다.
 *     ① 청크 text 그대로
 *     ② 아래 T(문장 틀)에 엔진 숫자를 끼운 것
 *   여기서 문장을 새로 지어내지 않는다. LLM 을 부르지 않는다.
 *
 * 그리고 DB를 다시 보지 않는다. 엔진이 남긴 basis_chunks 로 신호등만 읽는다.
 */
import type { Chunk, Conditions } from "./types";
import { chunkSource, field, kindOf } from "./engines/base";
import { mergeFlags, type Flag } from "./engines/rules";
import type { RunOutput } from "./engines";
import { INFLECTION_KO } from "./normalize";

/** 단계 한글 이름 — 화면 문장에 "preclinical" 이 그대로 나가면 안 된다 */
const PHASE_KO: Record<string, string> = {
  preclinical: "비임상", P1: "임상 1상", P2: "임상 2상",
  P3: "임상 3상", NDA: "허가 신청", approved: "승인",
};
import { slot } from "./slots";
import { factLabels, allEngineSide, userSide } from "./fact-labels";
import type { Display } from "./engines/rules";
import labelsJson from "../data/ref/labels.json";
import { renderSlot } from "./slot-texts";
import glossaryJson from "../data/ref/glossary.json";

/**
 * 꼬리표 이름표 — 청크의 badges(영문) → 화면 글자.
 * 정본은 대표님 labels.json 의 "표시 꼬리표" 다(19개).
 */
const BADGE_KO: Record<string, string> =
  (labelsJson as Record<string, Record<string, string>>)["표시 꼬리표"] ?? {};

/** 규칙 판정 이름 — flag_hint → 화면 글자. 정본은 labels.json "판정 표시". */
const VERDICT_KO: Record<string, string> =
  (labelsJson as Record<string, Record<string, string>>)["판정 표시"] ?? {};

/** 단계 차이 꼬리표 — 정본은 labels.json "단계 차이" */
const GAP_KO: Record<string, string> =
  (labelsJson as Record<string, Record<string, string>>)["단계 차이"] ?? {};

/** 권리 범위 — 표의 all/limited 를 화면 글자로 */
const RIGHTS_KO: Record<string, string> = { all: "전체 적응증", limited: "일부 적응증" };

/** 지역 이름 — "KR" 을 화면에 그대로 내지 않는다 */
const REGION_KO: Record<string, string> =
  (labelsJson as Record<string, Record<string, string>>)["지역"] ?? {};

/** 용어 사전 — 낱말 하나에 풀이와 보기. 406개. */
type GlossEntry = { term: string; aliases?: string[]; explain?: string; example?: string };
const GLOSSARY: Map<string, GlossEntry> = (() => {
  const m = new Map<string, GlossEntry>();
  for (const e of glossaryJson as GlossEntry[]) {
    if (!e?.term) continue;
    m.set(e.term, e);
    for (const a of e.aliases ?? []) if (!m.has(a)) m.set(a, e);
  }
  return m;
})();

/**
 * 화면에 띄울 용어 풀이 — display.terms 에 적힌 낱말 중 사전에 있는 것만.
 *
 * 사전 406개를 화면으로 다 내보내지 않는다. 그 줄에 실제로 쓰인 낱말만
 * 골라 붙인다(한 줄에 많아도 네 개 안쪽이다).
 */
function termsOf(d: Display | undefined, sentence: string): CardTerm[] | undefined {
  if (!d?.terms.length) return undefined;
  const out: CardTerm[] = [];
  const seen = new Set<string>();
  for (const t of d.terms) {
    // 문장에 그 낱말이 실제로 보여야 밑줄을 그을 수 있다
    if (!sentence.includes(t.text) || seen.has(t.text)) continue;
    const g = GLOSSARY.get(t.term) ?? GLOSSARY.get(t.text);
    const explain = g?.explain?.trim();
    if (!explain) continue;
    seen.add(t.text);
    out.push({ text: t.text, explain, example: g?.example?.trim() || undefined });
  }
  return out.length ? out : undefined;
}

/** 청크 badges(영문) → 화면 글자. 이름표가 없는 꼬리표는 띄우지 않는다. */
function badgesKo(d: Display | undefined, raw: unknown): string[] {
  // display 가 들고 있는 한글 꼬리표가 먼저다 — 대표님이 직접 적어 두신 것이다.
  if (d?.badges_ko.length) return d.badges_ko;
  if (!Array.isArray(raw)) return [];
  return raw.map((b) => BADGE_KO[String(b)]).filter((x): x is string => Boolean(x));
}

/**
 * 규칙 한 줄의 화면 문장 — display 가 있으면 그것, 없으면 text 를 다듬어서.
 *
 * display.title 과 body 를 잇는다. 초안 청크는 body 가 비어 있어 제목만 나간다.
 * meaning·action 은 줄을 길게 만들어 카드가 읽히지 않으므로 여기서는 쓰지 않고,
 * 화면이 '자세히' 로 펼칠 수 있게 따로 넘긴다.
 */
/**
 * 규칙 한 장 → 카드 한 줄.
 *
 * display 가 있으면 층을 나눠 담고, 없으면 예전처럼 text 를 다듬어 title 에만 넣는다.
 * 어느 쪽이든 chunk_id 는 문장에 넣지 않는다 — 출처는 source_label 로 띄운다.
 */
function ruleLine(
  x: {
    chunk_id: string; text: string; flag?: Flag | null;
    display?: Display; badges?: unknown;
  },
  extraBadges: string[] = []
): CardLine {
  const d = x.display;
  const text = ruleLineText(d, x.text);
  const badges = [...badgesKo(d, x.badges), ...extraBadges];
  const terms = termsOf(d, [d?.title, d?.body, d?.meaning, d?.action].join(" ") || text);
  return {
    text,
    basis: [x.chunk_id],
    title: d?.title || text,
    ...(d?.body ? { body: d.body } : {}),
    ...(d?.meaning ? { meaning: d.meaning } : {}),
    ...(d?.action ? { action: d.action } : {}),
    ...(d?.source_label ? { source_label: d.source_label } : {}),
    ...(d?.source_note ? { source_note: d.source_note } : {}),
    ...(x.flag ? { verdict: VERDICT_KO[x.flag] ?? undefined } : {}),
    ...(badges.length ? { badges } : {}),
    ...(terms ? { terms } : {}),
  };
}

/**
 * 한 줄로 읽을 때의 문장.
 *
 * title 과 body 를 이어 붙이면 한 줄이 200자를 넘어 카드가 읽히지 않는다.
 * 화면은 층을 나눠 그리므로(제목·본문·뜻) 여기서는 제목만 쓴다.
 * display 가 없으면 예전처럼 text 를 다듬는다.
 */
function ruleLineText(d: Display | undefined, text: string): string {
  if (!d) return ruleSentence(text);
  return d.title || d.body;
}

/**
 * 판정 못 한 규칙 한 줄 — 왜 못 했는지에 따라 문구가 다르다.
 *
 * 사용자가 적을 수 있는 칸이 빈 것이면 대표님 CHECK-필요 틀을 쓴다(표시 규칙 3장).
 * 우리 자료가 없어서 못 한 것이면 "적으면" 이라고 하지 않는다 — 적을 수 없는
 * 숫자를 적으라고 하면 안내가 아니라 핀잔이 된다. 그 문구는 틀에 없어서 우리 것을 쓴다.
 */
function needLine(x: { text: string; missing: string[]; title?: string }): CardLine {
  // 청크가 고객용 제목을 들고 있으면 그것을 쓴다. text 를 자르면 내부 변수
  // 이름이 새고(power_band.good_min) 조건만 다른 규칙이 같은 줄로 보인다.
  const title = x.title ?? ruleTitle(x.text);
  const mine = userSide(x.missing);

  if (allEngineSide(x.missing))
    return { text: T.rule_pending(title, factLabels(x.missing)), basis: [], title };

  const asked = renderSlot("CHECK-필요", { input_ko: factLabels(mine) });
  // 화면은 제목과 본문을 층으로 나눠 그리므로 본문에 틀을 그대로 둔다.
  // 한 줄로 읽는 text 에서는 "확인 필요 —" 를 뺀다 — 안 빼면 줄표가 두 번 나온다
  // ("제목 — 확인 필요 — …을 입력하시면"). 검사와 굳힌 결과가 이 text 를 본다.
  return {
    text: asked
      ? `${title} — ${asked.text.replace(/^확인 필요\s*—\s*/, "")}`
      : T.rule_need(title, factLabels(mine)),
    basis: [],
    title,
    ...(asked ? { body: asked.text } : {}),
  };
}

/**
 * 규칙 문장에서 제도 이름만 — "[MFDS 희귀의약품 지정] 국내 희귀…" → "MFDS 희귀의약품 지정"
 * 판정하지 못한 제도는 본문을 길게 늘어놓지 않고 이름만 적는다.
 */
/**
 * 규칙 카드에서 화면에 낼 부분만 고른다.
 *
 * 규칙 청크 text 는 사람이 읽을 문장 하나가 아니라 여러 토막이 붙어 있다.
 *   C04  "[설계 플래그 C04-D01] 조건: … 문장: … 근거: …"
 *   R02  "MFDS 우선심사: … 작용 레버 … 단서: …. 규칙: …"
 * 조건식은 화면이 이미 판정했으니 또 보여 줄 필요가 없고,
 * R02 의 "규칙:" 꼬리는 13장이 글자까지 똑같아서 카드 넷이 같은 말을 반복한다
 * (규제 카드 점검 7번). 둘을 잘라 낸다.
 *
 * 글자를 새로 짓지 않는다 — 청크가 붙여 둔 토막 중 하나를 고르는 것뿐이고,
 * 자른 부분은 '근거 보기' 에서 원문 그대로 볼 수 있다.
 */
/**
 * 1~5 점수 눈금표 카드인가.
 *
 * T02 의 F1~F4 앵커는 본문이 {'5': '...', '4': '...'} 사전 모양이다.
 * 사람이 읽을 문장이 아니라 채점 기준이므로 화면에 펼치지 않는다.
 */
function isAnchorCard(text: string): boolean {
  return /\{\s*['"]5['"]\s*:/.test(text);
}

export function ruleSentence(text: string): string {
  let t = text.trim();

  // R02·R01 의 산정 메모 꼬리 — 모든 카드가 같은 문장을 달고 있다
  t = t.replace(/\s*규칙:\s*[^]*$/, "").trim();

  // C04 설계 플래그 — 조건식은 빼고 사람이 읽을 문장만
  const m = /^(\[[^\]]+\])?\s*조건:\s*[^]*?문장:\s*([^]*?)(?:\s*근거:\s*[^]*)?$/.exec(t);
  // 대괄호 머리([설계 플래그 C04-D01])는 떼고 문장만 — 규칙 번호는 '근거' 의 카드 번호로 본다
  if (m) return m[2].trim();

  return t;
}

function ruleTitle(text: string): string {
  const m = /^\s*\[([^\]]+)\]/.exec(text) ?? /^([^:：]{2,40})[:：]/.exec(text);
  return (m?.[1] ?? text.slice(0, 30)).trim();
}

export type CardFlag = Flag | "no_evidence";

/** 밑줄 그어 풀이를 보여 줄 낱말 하나 */
export type CardTerm = { text: string; explain: string; example?: string };

/**
 * 카드 한 줄.
 *
 * `text` 는 한 줄로 읽을 때의 문장이다(검사 스크립트와 굳힌 결과가 이걸 본다).
 * 아래 title·body·meaning·action 은 대표님 display 규칙대로 화면이 층을 나눠
 * 그리기 위한 것이다 — 제목은 굵게, 본문, 뜻은 회색, action 은 "확인할 일:".
 * display 없는 청크(옛 묶음 잔여)는 title 만 채워진다.
 */
export type CardLine = {
  text: string;
  basis: string[];
  badges?: string[];
  /** 용어 풀이 — 화면이 밑줄과 설명으로 그린다 */
  terms?: CardTerm[];
  title?: string;
  body?: string;
  meaning?: string;
  action?: string;
  /** 출처 이름 — 화면에는 chunk_id 대신 이것을 띄운다 */
  source_label?: string;
  /** 출처 한 줄 설명(툴팁) */
  source_note?: string;
  /** 규칙 줄의 판정 이름 — 긍정 요인 · 주의 · 참고 */
  verdict?: string;
};

export type BoardCard = {
  key: "clinical" | "design" | "market" | "regulatory" | "finance" | "patent" | "news";
  title: string;
  flag: CardFlag;
  lines: CardLine[];
  /** 아직 못 채운 칸이면 왜 못 채웠는지 */
  pending?: string;
  basis_chunks: string[];
};

/** '근거 보기' 에서 펼칠 카드 한 장 */
export type Evidence = {
  chunk_id: string;
  text: string;
  kind: string | null;
  trust_tier: number | null;
  source: string | null;
};

/**
 * 맨 윗줄 요약.
 *
 * 여기서 새 문장을 짓지 않는다. 신호등 개수는 세기만 한 것이고,
 * 주의 칸 옆 한 줄은 그 카드의 첫 줄을 그대로 끌어올린 것이다.
 * "무엇이 제일 급한가" 같은 판단은 넣지 않는다 — 근거가 없다.
 */
export type Summary = {
  counts: { positive: number; caution: number; neutral: number; no_evidence: number };
  /** 🟠 주의가 켜진 칸. 카드 순서 그대로다(중요도 순이 아니다) */
  attention: { key: BoardCard["key"]; title: string; line: string }[];
  /**
   * 주의가 아닌 칸은 이름만. 문장까지 올리면 다섯 칸을 다 적는 셈이라
   * 요약이 목록이 되어 버린다 — 어디에 불이 안 켜졌는지만 알려 준다.
   */
  rest: { key: BoardCard["key"]; title: string; flag: CardFlag }[];
};

export type Board = {
  as_of: string;
  conditions: Conditions;
  badges: string[];
  summary: Summary;
  cards: BoardCard[];
  /** 화면이 근거를 펼칠 때 쓴다. 화면은 DB를 다시 보지 않는다 */
  evidence: Record<string, Evidence>;
};

// ─────────────────────────────────────────────
// 문장 틀
//
// 전부 미리 써 둔 문장이다. { } 안에만 엔진 숫자가 들어간다.
// 문장을 고치려면 여기만 고치면 된다. 엔진 코드는 건드리지 않는다.
// ─────────────────────────────────────────────
const T = {
  // 비임상 칸 — 1상에 들어갈 확률과 그 다음 확률은 다른 집계다. 곱하지 않는다.
  prob_entry: (p: string) =>
    `비임상 후보물질이 1상에 진입하는 비율은 ${p} 입니다.`,
  prob_from_p1: () =>
    `아래 승인 확률은 1상 진입 이후부터 적용되는 값입니다 — 위 진입 비율과 곱하지 않습니다.`,
  prob_two: (cum: string, modLabel: string, alt: string, altLabel: string) =>
    `누적 승인 확률 ${cum}(${modLabel} 기준), ${altLabel} 기준 ${alt} — 두 값 사이에서 읽어야 합니다.`,
  prob_one: (cum: string, label: string) =>
    `누적 승인 확률 ${cum}(${label} 기준).`,
  prob_next: (p: string, from: string, to: string) =>
    `다음 단계 전환 확률 ${p} (${from}→${to}, 조건부).`,
  prob_rare: (p: string) =>
    `희귀 기준 값은 ${p} 입니다. 위 값과 곱하거나 평균내지 않습니다.`,
  duration: (years: string, inflection: string) =>
    `${inflection}까지 ${years}년으로 잡힙니다(프로그램 기준).`,

  // 회사 조회 — 기업 마스터에서 찾은 것 그대로. 판단하지 않는다.
  company: (name: string, market: string, code: string) =>
    `${name} · ${market} ${code}`,
  company_flag: (flag: string) => `거래 상태: ${flag}`,
  company_pool: (n: string, caution: string) =>
    `국내 상장 신약개발 비교군 풀은 ${n}사입니다(그중 주의 플래그 ${caution}사).`,
  company_none: (name: string, n: string) =>
    `${name}${josa(name, "은", "는")} 기업 마스터 ${n}사에 없습니다 — ` +
    `비상장이거나 아직 등재 전입니다.`,

  runway: (m: string) => `가용 현금으로 ${m}개월 버팁니다.`,
  cover_one: (label: string, rcr: string, months: string, band: string) =>
    `${label}까지 자금 충족 비율 ${rcr} — ${band} (필요 기간 ${months}개월)`,
  // 밴드 규칙이 안 걸리면 숫자만 적고 양호·주의를 말하지 않는다.
  // 임계값을 코드에서 지어내 메우지 않는다.
  cover_plain: (label: string, rcr: string, months: string) =>
    `${label}까지 자금 충족 비율 ${rcr} (필요 기간 ${months}개월)`,
  cover_raises: (n: string) => `변곡점 전에 추가 조달이 ${n}회 필요합니다.`,
  need: (usd: string) => `설계안 기준 임상 직접비는 최소 ${usd}입니다.`,
  // 비임상·허가 단계에는 환자가 없다. 자료가 빠진 것이 아니라 해당이 없는 것이다.
  // 빈 칸으로 두면 '못 찾았다' 로 읽히므로 그렇지 않다고 적어 둔다.
  need_na: (phase: string) =>
    `${phase} 단계에는 환자당 단가·대상자 수가 없어 설계안 기준 임상 직접비는 해당 없음입니다 — 1상부터 계산합니다.`,
  need_missing: (items: string) =>
    `여기에는 ${items}${josa(items, "이", "가")} 빠져 있어 '최소'입니다.`,
  bench: (usd: string, legs: string) =>
    `업계 평균으로는 ${usd}입니다(${legs}). 산정 방식이 달라 위 금액과 합치지 않습니다.`,
  deadline: (date: string, lead: string) =>
    `조달은 ${date}까지 착수해야 합니다(조달 소요 ${lead}개월 기준).`,

  deal_head: (n: string) => `같은 약 종류·단계의 기술이전 사례가 ${n}건 있습니다.`,
  deal_row: (licensor: string, cp: string, signed: string, upfront: string) =>
    `${licensor} → ${cp} (${signed}) 계약금 ${upfront}`,
  // 딜 상세 꼬리 — 값이 있는 것만 이어 붙인다(대표님 20261007 새 열)
  deal_more: (bits: string) => bits,
  deal_quart: (q1: string, med: string, q3: string) =>
    `계약금 사분위 ${q1}억 · 중앙 ${med}억 · ${q3}억`,
  market_rest: () => `급여 경로는 M01 카드가 들어오면 채워집니다.`,
  deal_excluded: (n: string, list: string) =>
    `비교군 제외 ${n}건 — ${list}`,
  pat_head: (n: string, reg: string) => `특허 ${n}건이 조회됩니다(등록 ${reg}건).`,
  pat_group: (ipc: string, n: string, desc: string) => `${ipc} ${n}건 — ${desc}`,
  pat_substance: (list: string) => `물질특허 후보: ${list} (IPC 기준 추정이며 확정이 아닙니다)`,
  pat_align: (life: string, launch: string, expiry: string) =>
    `출시 추정 ${launch}년 시점에 물질특허가 ${life}년 남습니다(만료 ${expiry}년).`,
  // 만료가 출시보다 빠르면 "남는" 것이 아니다. "-2년 남습니다" 는 틀린 문장이다.
  pat_align_gone: (gap: string, launch: string, expiry: string) =>
    `물질특허가 출시 추정 시점(${launch}년)보다 ${gap}년 먼저 만료됩니다(만료 ${expiry}년).`,
  // 1~5 점수 앵커 카드 — 눈금표를 화면에 펼치지 않는다. 근거 보기에서 원문을 본다.
  pat_anchor: (title: string) =>
    // 제목에 이미 "1~5 앵커" 가 붙어 있으면 떼고 쓴다 — 같은 말을 두 번 하지 않는다
    `${title.replace(/\s*[—-]\s*1~5\s*앵커\s*$/, "").trim()} — ` +
    `1~5 점수 기준표입니다. 근거 보기에서 각 점수의 조건을 확인하세요.`,
  patent_none: () => `만료일 미입력`,
  news_pending: () => `정식판에서 수집`,
  // applies_when 이 "확인 필요" 로 나온 규칙 — 묻지 않은 조건을 충족한 것처럼 적지 않는다
  rule_need: (title: string, fields: string) =>
    `${title} — ${fields}${josa(fields, "을", "를")} 적으면 판정할 수 있습니다.`,
  // 사용자가 적을 수 없는 칸이면 "적으면" 이라고 하지 않는다 — 우리 자료가 없는 것이다
  rule_pending: (title: string, fields: string) =>
    `${title} — ${fields} 자료를 아직 수집하지 않아 판정하지 않았습니다.`,
  // ── 설계 검토 요약(C04-0105)
  //
  // 대표님 지시: 상태별 개수로 요약하고, 판정 보류나 입력 없음이 하나라도
  // 있으면 "지적 사항 없음" 이라고 쓰지 않는다. 그래서 문장 틀을 둘로 나눈다.
  // 개수만 끼우고 평가하는 말은 보태지 않는다.
  design_sum: (parts: string) => `설계 검토 — ${parts}`,
  design_clean: (checked: string) =>
    `설계 검토 — ${checked}개 항목을 모두 확인했고 지적 사항이 없습니다.`,
  design_more: (n: string) =>
    `아래로 ${n}건 더 — '근거 보기'에서 전부 확인할 수 있습니다.`,
  no_card: (why: string) => why,
} as const;

// ─────────────────────────────────────────────
// 신호등
//
// rule 청크만 신호등을 켠다. parameter·method·mapping 은 켜지 않는다.
// ─────────────────────────────────────────────
async function flagOf(basis: string[]): Promise<CardFlag> {
  // 아무 카드도 못 꺼냈으면 근거 없음(회색)
  if (basis.length === 0) return "no_evidence";

  const src = await chunkSource();
  const got = await src.get(basis);
  const flags: (Flag | null)[] = [];
  for (const id of basis) {
    const c: Chunk | undefined = got[id];
    if (!c || kindOf(c) !== "rule") continue; // 숫자 카드는 신호등을 안 켠다
    flags.push((field(c, "flag_hint") as Flag) ?? null);
  }

  // 숫자는 꺼냈는데 신호등을 켜는 규칙 카드가 없으면 중립(흰색).
  // 보여줄 게 있는데 회색으로 두면 '자료가 없다'는 뜻으로 잘못 읽힌다.
  return mergeFlags(flags) === "no_evidence" ? "neutral" : mergeFlags(flags);
}

/** 받침이 있으면 앞엣것, 없으면 뒤엣것 — "비용이" / "계수가" */
function josa(word: string, withFinal: string, without: string): string {
  // 끝의 한글 한 자를 본다. 괄호·따옴표가 붙어 있으면 건너뛴다 —
  // "시험 목적(확증·개념증명·용량 탐색)" 은 ')' 가 아니라 '색' 으로 판단해야
  // "…탐색)을" 이 된다. 괄호를 그대로 읽어 "탐색)를" 로 나가고 있었다.
  const m = /[가-힣](?=[^가-힣]*$)/.exec(word.trim());
  if (!m) return without;
  return (m[0].charCodeAt(0) - 0xac00) % 28 === 0 ? without : withFinal;
}

const pct = (v: number) => `${v}%`;
const f1 = (v: number) => v.toFixed(1);
/**
 * 달러 표기 — 보고서와 같은 모양으로 맞춘다. 5,993,952 → "5.99M$"
 * 원화로 바꾸지 않는다 (F01-10).
 */
function usdKo(v: number): string {
  return `${(v / 1e6).toFixed(2)}M$`;
}

// ─────────────────────────────────────────────
// 조립
// ─────────────────────────────────────────────
export async function assemble(
  cond: Conditions,
  badges: string[],
  r: RunOutput,
  extra: {
    /** 규제 칸 — matchRules("RE-02") 결과 */
    regulatory?: {
      rules: { chunk_id: string; text: string; jurisdiction: string | null;
               display?: Display; badges?: unknown }[];
      need_input?: { chunk_id: string; text: string; title?: string; missing: string[] }[];
    } | null;
    /** 설계안 칸 — matchRules("CE-04") 결과 */
    design?: {
      rules: { chunk_id: string; text: string; flag?: Flag | null;
               display?: Display; badges?: unknown }[];
      need_input?: { chunk_id: string; text: string; title?: string; missing: string[] }[];
      /** 조건이 거짓이어서 뺀 규칙 — 요약에서 '해당 없음' 으로 센다(C04-0105) */
      not_applicable?: string[];
    } | null;
    /** 특허 칸 — matchRules("TE-02") 결과 */
    patentRules?: {
      rules: { chunk_id: string; text: string; display?: Display; badges?: unknown }[];
    } | null;
    /** 시장 칸 MKT-5 — matchRules("ME-17") 결과 */
    marketRules?: {
      rules: { chunk_id: string; text: string; flag?: Flag | null;
               display?: Display; badges?: unknown }[];
      need_input?: { chunk_id: string; text: string; title?: string; missing: string[] }[];
    } | null;
    /** 재무 칸 — matchRules("FE-RULES") 결과 */
    financeRules?: {
      rules: { chunk_id: string; text: string; flag?: Flag | null;
               display?: Display; badges?: unknown }[];
      need_input?: { chunk_id: string; text: string; title?: string; missing: string[] }[];
    } | null;
    /** ME-17 단계 차이 — 헤드라인에 분위값을 쓸지 정한다 */
    phase_gap_label?: "earlier" | "same" | "later" | null;
    patent_expiry_year?: number;
    /** 회사 이름 — 기업 마스터에서 못 찾았을 때 문장에 쓴다 */
    corp_name?: string;
  } = {}
): Promise<Board> {
  const cards: BoardCard[] = [];
  const corpName = extra.corp_name ?? null;

  // ── 임상
  {
    const s = r.success.values as {
      conditional: { value: number; chunk_id: string; phase_to: string | null } | null;
      cumulative: { value: number; chunk_id: string } | null;
      cumulative_alt: { value: number; chunk_id: string; basis_label: string } | null;
      rare_row: { value: number; chunk_id: string } | null;
      entry: { value: number; chunk_id: string } | null;
      from_p1: boolean;
    };
    const d = r.duration.values as { years_total: number | null };
    const lines: CardLine[] = [];
    const modLabel = cond.modality_badge ? "단클론항체" : cond.modality || "전체";

    // 비임상 칸은 '1상에 들어가는가' 를 먼저 말하고,
    // 그 다음 값들이 '1상 진입 이후' 기준이라는 것을 밝힌다.
    if (s.entry)
      lines.push({ text: T.prob_entry(pct(s.entry.value)), basis: [s.entry.chunk_id] });
    if (s.from_p1 && (s.cumulative || s.conditional))
      lines.push({ text: T.prob_from_p1(), basis: [] });

    if (s.cumulative && s.cumulative_alt)
      lines.push({
        text: T.prob_two(pct(s.cumulative.value), modLabel, pct(s.cumulative_alt.value), s.cumulative_alt.basis_label),
        basis: [s.cumulative.chunk_id, s.cumulative_alt.chunk_id],
        badges: cond.modality_badge ? [cond.modality_badge] : [],
      });
    else if (s.cumulative)
      lines.push({
        text: T.prob_one(pct(s.cumulative.value), modLabel),
        basis: [s.cumulative.chunk_id],
        badges: cond.modality_badge ? [cond.modality_badge] : [],
      });

    if (s.conditional)
      lines.push({
        text: T.prob_next(
          pct(s.conditional.value),
          cond.clinical_phase ?? cond.phase,
          s.conditional.phase_to ?? "다음 단계"
        ),
        basis: [s.conditional.chunk_id],
      });

    if (s.rare_row)
      lines.push({ text: T.prob_rare(pct(s.rare_row.value)), basis: [s.rare_row.chunk_id] });

    if (d.years_total !== null)
      lines.push({
        text: T.duration(f1(d.years_total), INFLECTION_KO[cond.next_inflection ?? "unknown"] ?? "변곡점"),
        basis: r.duration.basis_chunks,
      });

    const basis = [...r.success.basis_chunks, ...r.duration.basis_chunks];
    cards.push({
      key: "clinical", title: "임상",
      flag: lines.length === 0 ? "no_evidence" : await flagOf(basis),
      lines: lines.length ? lines : [{ text: T.no_card("이 조건에 맞는 임상 카드가 없습니다"), basis: [] }],
      pending: lines.length ? undefined : r.success.notes[0],
      basis_chunks: basis,
    });
  }

  // ── 설계안
  //
  // C04 설계 플래그다. 숫자를 내지 않고 "이 설계에 이런 점이 걸린다" 만 말한다.
  // 문장은 청크 text 그대로다 — 여기서 설계를 평가하지 않는다.
  {
    const rules = extra.design?.rules ?? [];
    const need = extra.design?.need_input ?? [];
    const naN = (extra.design?.not_applicable ?? []).length;
    const basis = rules.map((x) => x.chunk_id);

    // 못 판정한 까닭을 둘로 나눈다 — 사용자가 손쓸 수 있는 쪽과 그렇지 않은 쪽.
    //   입력 없음  … 설계안 칸을 적으면 판정된다
    //   판정 보류  … 우리 자료가 아직 없다. 적으라고 하면 핀잔이 된다
    const blank = need.filter((x) => !allEngineSide(x.missing));
    const held = need.filter((x) => allEngineSide(x.missing));

    // 상태별 개수 — 값이 0인 상태는 적지 않는다(없는 것을 세어 보여 줄 이유가 없다)
    //
    // 대표님이 적어 둔 상태는 넷(지적·해당 없음·판정 보류·입력 없음)인데
    // 걸린 규칙에는 양호·참고도 있다. 그 둘을 '해당 없음' 에 넣으면 거짓말이 된다
    // — 조건이 참이어서 화면에 문장까지 나간 규칙이기 때문이다. 따로 센다.
    // '해당 없음' 은 조건이 거짓이어서 뺀 것만 가리킨다.
    const n = (f: string) => rules.filter((x) => x.flag === f).length;
    const counts: string[] = [];
    const flagged = n("caution");
    if (flagged) counts.push(`지적 ${flagged}건`);
    if (n("positive")) counts.push(`양호 ${n("positive")}건`);
    if (n("neutral")) counts.push(`참고 ${n("neutral")}건`);
    if (naN) counts.push(`해당 없음 ${naN}건`);
    if (held.length) counts.push(`판정 보류 ${held.length}건`);
    if (blank.length) counts.push(`입력 없음 ${blank.length}건`);

    const lines: CardLine[] = [];

    // 요약을 맨 위에 둔다.
    // "지적 사항 없음" 은 지적도 없고 보류·입력 없음도 없을 때만 쓸 수 있다.
    const nothingPending = held.length === 0 && blank.length === 0;
    const checked = rules.length + naN;
    if (checked || need.length)
      lines.push({
        text: flagged === 0 && nothingPending && checked
          ? T.design_clean(String(checked))
          : T.design_sum(counts.join(" · ")),
        basis: [],
      });

    for (const x of rules) lines.push(ruleLine(x));

    // 적으면 판정되는 것을 먼저, 우리가 못 하는 것을 뒤에.
    // 잘라낸 나머지는 개수로 밝힌다 — 예전에는 11건이 말없이 사라졌다.
    const SHOW = 4;
    const queue = [...blank, ...held];
    for (const x of queue.slice(0, SHOW)) lines.push(needLine(x));
    if (queue.length > SHOW)
      lines.push({ text: T.design_more(String(queue.length - SHOW)), basis: [] });

    cards.push({
      key: "design", title: "설계안",
      flag: rules.length ? await flagOf(basis) : "no_evidence",
      lines: lines.length
        ? lines
        : [{ text: T.no_card("이 설계안에 걸리는 플래그가 없습니다"), basis: [] }],
      pending: rules.length || need.length ? undefined : "설계안 칸을 채우면 플래그를 판정합니다",
      basis_chunks: basis,
    });
  }

  // ── 시장
  {
    const d = r.deals.values as {
      deals: {
        licensor: string; counterparty: string; signed: string; stage: string;
        upfront_text: string; chunk_id: string;
        stage_in_territory: string | null; royalty: string | null;
        rights_scope: string | null; exclusivity: string | null; territory: string | null;
      }[];
      n_total: number; n_disclosed: number;
      quartiles_krw_억: { q1: number; med: number; q3: number } | null;
      excluded: { chunk_id: string; licensor: string; reason: string }[];
    };
    const pt = r.patients.values as {
      rows: { chunk_id: string; code: string; value: number; text: string;
              role: "default" | "detail"; notes: string[] }[];
      first_line: boolean;
      held_sentence: string | null;
    };
    const lines: CardLine[] = [];

    // ── 국내 환자 수 — 숫자를 쓸 수 있는 값이 있을 때만 첫 줄에 올린다.
    // 코드가 적응증보다 넓은 값(display_role=detail)은 첫 줄에 쓰지 않는다.
    // 그 숫자로 "2만 명 미만/초과" 를 읽으면 적응증 단위 판정이 아니기 때문이다.
    if (pt.held_sentence)
      lines.push({ text: pt.held_sentence, basis: r.patients.basis_chunks });
    for (const x of pt.rows) {
      if (!pt.first_line && x.role === "default") continue;
      if (pt.first_line && x.role === "detail") continue;
      lines.push({ text: x.text, basis: [x.chunk_id], badges: x.notes });
    }

    if (d.n_total > 0) {
      lines.push({ text: T.deal_head(String(d.n_total)), basis: r.deals.basis_chunks });
      // 딜은 카드에 적힌 그대로 옮긴다. 금액을 환산하거나 평균내지 않는다.
      for (const x of d.deals.slice(0, 5)) {
        // 늘어난 열은 값이 있을 때만 적는다. 비어 있는 열을 "—" 로 채우면
        // 247건 중 3건만 값이 있는 '계약 지역 기준 단계' 가 온통 줄표로 나간다.
        const bits = [
          // 표는 여러 단계를 "preclinical|P1" 로 적는다. 세로줄은 자료 표기라
          // 화면에 그대로 내지 않는다.
          x.stage !== "—" && `단계 ${x.stage.replace(/\|/g, "·")}`,
          x.stage_in_territory &&
            `계약 지역 기준 단계 ${x.stage_in_territory.replace(/\|/g, "·")}`,
          x.royalty && `로열티 ${x.royalty}`,
          x.rights_scope && `권리 범위 ${RIGHTS_KO[x.rights_scope] ?? x.rights_scope}`,
          x.exclusivity && `독점 ${x.exclusivity}`,
          x.territory && `지역 ${x.territory}`,
        ].filter((b): b is string => Boolean(b));
        lines.push({
          text: T.deal_row(x.licensor, x.counterparty, x.signed, x.upfront_text),
          basis: [x.chunk_id],
          ...(bits.length ? { body: T.deal_more(bits.join(" · ")) } : {}),
        });
      }
      // 분위값은 비교 딜이 우리와 같은 단계일 때만 헤드라인으로 쓴다(M03-1007·1008).
      // 이른 단계 딜이면 하한, 늦은 단계면 상한이라 그대로 견주면 틀린 기대를 준다.
      // 숫자를 지우지는 않는다 — 꼬리표를 달아 어느 쪽으로 치우쳤는지 밝힌다.
      const gap = extra.phase_gap_label ?? null;
      if (d.quartiles_krw_억)
        lines.push({
          text: T.deal_quart(
            String(Math.round(d.quartiles_krw_억.q1)),
            String(Math.round(d.quartiles_krw_억.med)),
            String(Math.round(d.quartiles_krw_억.q3))
          ),
          basis: r.deals.basis_chunks,
          ...(gap && gap !== "same" ? { badges: [GAP_KO[gap]] } : {}),
        });
    }

    // MKT-5 — 딜 비교 풀 규칙. 단계 차이 설명(M03-1007·1008)이 여기서 나온다.
    for (const x of extra.marketRules?.rules ?? []) lines.push(ruleLine(x));

    // 기술도입·제네릭·계열사 딜은 셈에서 뺐다. 왜 뺐는지는 적는다.
    if (d.excluded?.length)
      lines.push({
        text: T.deal_excluded(
          String(d.excluded.length),
          [...new Set(d.excluded.map((x) => x.reason))].join(" · ")
        ),
        basis: d.excluded.slice(0, 5).map((x) => x.chunk_id),
      });

    lines.push({ text: T.market_rest(), basis: [] });

    cards.push({
      key: "market", title: "시장",
      flag: d.n_total > 0 || pt.rows.length > 0
        ? await flagOf([...r.deals.basis_chunks, ...r.patients.basis_chunks])
        : "no_evidence",
      lines,
      pending: d.n_total > 0 ? undefined : r.deals.notes[0],
      basis_chunks: [...r.deals.basis_chunks, ...r.patients.basis_chunks],
    });
  }

  // ── 규제
  {
    const rules = extra.regulatory?.rules ?? [];
    const need = extra.regulatory?.need_input ?? [];
    const basis = rules.map((x) => x.chunk_id);

    // 걸린 규칙은 display 문장으로 낸다. 관할(KR·US)은 꼬리표로 덧붙인다.
    const lines: CardLine[] = rules.map((x) =>
      ruleLine(x, x.jurisdiction ? [REGION_KO[x.jurisdiction] ?? x.jurisdiction] : [])
    );

    // 아직 묻지 않은 칸이 있어 판정하지 못한 제도 — 걸린 것으로 세지 않는다.
    // 신호등도 켜지 않는다(basis 에 넣지 않는다). "적으면 판정합니다" 로만 적는다.
    for (const x of need.slice(0, 4)) lines.push(needLine(x));

    cards.push({
      key: "regulatory", title: "규제",
      flag: rules.length ? await flagOf(basis) : "no_evidence",
      lines: lines.length
        ? lines
        : [{ text: T.no_card("이 조건에 걸리는 규제 규칙 카드가 없습니다"), basis: [] }],
      basis_chunks: basis,
    });
  }

  // ── 재무
  {
    const run = r.runway.values as { runway_m: number | null; cash_available: number | null };
    const rcr = r.rcr.values as {
      targets: { label: string; months: number; RCR: number; band: string | null;
                 band_text: string | null; raises_needed: number | null }[];
      worst_band: string | null;
      rcr_note?: string | null;
    };
    const need = r.need.values as {
      need_current_phase_usd: number | null; missing_items: string[];
    };
    const bench = r.bench.values as {
      total_usd_m: number | null; legs: { phase: string; usd_m: number }[];
    };
    const gap = r.gap.values as {
      raise_deadline: string | null; fundraising_lead_m: number | null; gap_currency_note: string | null;
    };
    const down = r.downside.values as { sentence: string | null };

    const co = r.company.values as {
      self: { name: string; market: string | null; stock_code: string;
              trade_flag: string | null; in_pool: boolean; caution: boolean } | null;
      pool_n: number; pool_caution_n: number; master_n: number;
    };

    const lines: CardLine[] = [];

    // ── 회사 — 기업 마스터에서 찾은 것. 못 찾으면 못 찾았다고 쓴다.
    if (co.self) {
      lines.push({
        text: T.company(co.self.name, co.self.market ?? "—", co.self.stock_code),
        basis: [],
        badges: [
          co.self.in_pool ? "비교군 풀" : "풀 밖",
          ...(co.self.caution ? ["주의 플래그"] : []),
        ],
      });
      // 관리종목·투자주의환기종목은 그대로 올린다 — 투자 판단에 직접 쓰인다
      if (co.self.trade_flag && co.self.trade_flag !== "특이사항 없음(확인 범위 내)")
        lines.push({ text: T.company_flag(co.self.trade_flag), basis: [], badges: ["주의"] });
    } else if (corpName) {
      lines.push({ text: T.company_none(corpName, String(co.master_n)), basis: [] });
    }
    if (co.pool_n > 0)
      lines.push({
        text: T.company_pool(String(co.pool_n), String(co.pool_caution_n)),
        basis: r.company.basis_chunks,
      });

    if (run.runway_m !== null)
      lines.push({ text: T.runway(f1(run.runway_m)), basis: r.runway.basis_chunks });

    // 목표 시점마다 한 줄씩 — "IND까지는 되는데 P1 완료는 안 된다" 를 말할 수 있어야 한다
    for (const t of rcr.targets ?? []) {
      lines.push({
        text: t.band
          ? T.cover_one(t.label, t.RCR.toFixed(2), f1(t.months), t.band)
          : T.cover_plain(t.label, t.RCR.toFixed(2), f1(t.months)),
        basis: r.rcr.basis_chunks,
        badges: t.band ? [t.band] : [],
      });
      if (t.raises_needed !== null && t.raises_needed > 0)
        lines.push({ text: T.cover_raises(String(t.raises_needed)), basis: [] });
    }

    // 비임상·NDA 는 FIN-2a·CLIN-3a 자리가 '해당 없음' 이다(자리 정의의 na_phases)
    const needNa = (slot("FIN-2a").na_phases ?? []).includes(cond.phase);
    // 변곡점 대비 비율을 읽는 법 — 색에 쓰지 않는 설명
    if (rcr.rcr_note) lines.push({ text: rcr.rcr_note, basis: r.rcr.basis_chunks });

    if (need.need_current_phase_usd === null && needNa)
      lines.push({ text: T.need_na(PHASE_KO[cond.phase] ?? cond.phase), basis: [] });

    if (need.need_current_phase_usd !== null) {
      lines.push({
        text: T.need(usdKo(need.need_current_phase_usd)),
        basis: r.need.basis_chunks, badges: ["최소"],
      });
      lines.push({ text: T.need_missing(need.missing_items.join("·")), basis: [] });
    }

    if (bench.total_usd_m !== null)
      lines.push({
        text: T.bench(
          `${bench.total_usd_m.toFixed(1)}M$`,
          bench.legs.map((l) => `${l.phase} ${l.usd_m}M$`).join(" + ")
        ),
        basis: r.bench.basis_chunks,
      });

    if (gap.raise_deadline && gap.fundraising_lead_m !== null)
      lines.push({
        text: T.deadline(gap.raise_deadline, String(gap.fundraising_lead_m)),
        basis: r.gap.basis_chunks,
      });

    if (gap.gap_currency_note) lines.push({ text: gap.gap_currency_note, basis: r.gap.basis_chunks });
    if (down.sentence) lines.push({ text: down.sentence, basis: r.downside.basis_chunks });

    const basis = [
      ...r.company.basis_chunks,
      ...r.runway.basis_chunks, ...r.rcr.basis_chunks, ...r.need.basis_chunks,
      ...r.bench.basis_chunks, ...r.gap.basis_chunks, ...r.downside.basis_chunks,
    ];

    // 재무 규칙(F01·F02·F06) — 위 숫자 줄이 이미 쓴 청크는 빼고 넣는다.
    // 런웨이 밴드(F01-0003~0005)는 FE-A05 가 색으로 이미 말했으므로 같은 문장을
    // 또 쓰면 카드가 같은 말을 두 번 한다.
    const used = new Set([...basis, ...lines.flatMap((l) => l.basis)]);
    for (const x of extra.financeRules?.rules ?? []) {
      if (used.has(x.chunk_id)) continue;
      used.add(x.chunk_id);
      lines.push(ruleLine(x));
      basis.push(x.chunk_id);
    }

    cards.push({
      key: "finance", title: "재무",
      flag: lines.length ? await flagOf(basis) : "no_evidence",
      lines: lines.length ? lines : [{ text: T.no_card("재무 입력이 없습니다"), basis: [] }],
      basis_chunks: basis,
    });
  }

  // ── 특허
  {
    const pf = r.portfolio.values as {
      n_patents: number; n_registered: number;
      groups: { ipc: string; count: number; summary: string | null; chunk_ids: string[] }[];
      substance_candidates: string[]; earliest_expiry_year: number | null;
    };
    const al = r.patentAlign.values as {
      launch_year_est: number | null; patent_expiry_year: number | null;
      patent_life_at_launch: number | null; flag: string | null; note: string | null;
    };
    const rules = extra.patentRules?.rules ?? [];
    const lines: CardLine[] = [];

    if (pf.n_patents > 0) {
      lines.push({
        text: T.pat_head(String(pf.n_patents), String(pf.n_registered)),
        basis: r.portfolio.basis_chunks,
      });
      // 건수 많은 순으로 위에서 다섯 묶음만
      for (const g of pf.groups.slice(0, 5))
        lines.push({
          text: T.pat_group(g.ipc, String(g.count), g.summary ?? "설명 없음"),
          basis: g.chunk_ids,
        });
      if (pf.substance_candidates.length)
        lines.push({
          text: T.pat_substance(pf.substance_candidates.join(", ")),
          basis: [], badges: ["추정"],
        });
    }

    if (al.patent_life_at_launch !== null) {
      const life = al.patent_life_at_launch;
      lines.push({
        text: life >= 0
          ? T.pat_align(String(life), String(al.launch_year_est), String(al.patent_expiry_year))
          : T.pat_align_gone(String(-life), String(al.launch_year_est), String(al.patent_expiry_year)),
        basis: r.patentAlign.basis_chunks,
      });
    }
    if (al.note) lines.push({ text: al.note, basis: [] });

    // FTO 게이트키퍼 규칙은 청크 문장 그대로.
    // 다만 1~5 점수 앵커 카드는 눈금표가 사전 모양으로 들어 있어
    // 그대로 펼치면 화면이 {'5': '...', '4': '...'} 로 덮인다. 제목만 낸다.
    for (const x of rules)
      lines.push({
        // 1~5 눈금표 카드는 본문이 사전 모양이라 펼치지 않고 제목만
        text: isAnchorCard(x.text)
          ? T.pat_anchor(x.display?.title || ruleTitle(x.text))
          : ruleLineText(x.display, x.text),
        basis: [x.chunk_id],
      });

    if (lines.length === 0) lines.push({ text: T.patent_none(), basis: [] });

    // 화면에 보이는 다섯 묶음의 근거만 남긴다.
    // 전부 넣으면 IPC 31종 × 2장 = 62개가 '근거 보기' 에 쏟아진다.
    const basis = [...new Set([
      ...pf.groups.slice(0, 5).flatMap((g) => g.chunk_ids),
      ...r.patentAlign.basis_chunks,
      ...rules.map((x) => x.chunk_id),
    ])];
    cards.push({
      key: "patent", title: "특허",
      flag: pf.n_patents > 0 || rules.length ? await flagOf(basis) : "no_evidence",
      lines,
      pending: pf.n_patents > 0 ? undefined : "KIPRIS 수집을 돌리면 채워집니다",
      basis_chunks: basis,
    });
  }

  // ── 뉴스(N축)는 카드를 만들지 않는다
  //
  // 나머지 다섯 축은 '변하지 않는 판단 기준 문장'이라 청크로 적재해 두었지만,
  // 뉴스는 매일 바뀌는 사건이라 청크가 아니라 수집기가 있어야 한다.
  // 지금 N축 청크는 0장이다 — 그래서 빈 카드를 그리는 대신 아예 빼 둔다.
  // 수집기가 붙으면 여기에 cards.push({ key: "news", ... }) 를 되살린다.
  // key 타입과 문장 틀(T.news_pending)은 그때 쓰려고 남겨 두었다.

  // ── 근거 원문을 함께 실어 보낸다
  //
  // 화면에서 "이 숫자 어디서 나왔어요?" 에 답하는 부분이다.
  // 카드 ID만 보내면 화면이 DB를 다시 봐야 하므로, 여기서 문장까지 붙인다.
  const allIds = [...new Set(cards.flatMap((c) => c.basis_chunks))];
  const evidence: Record<string, Evidence> = {};
  if (allIds.length) {
    const src = await chunkSource();
    const got = await src.get(allIds);
    for (const id of allIds) {
      const c = got[id];
      if (!c) continue;
      const so = field(c, "source") as { title?: string; publisher?: string } | null;
      evidence[id] = {
        chunk_id: id,
        text: c.text,
        kind: kindOf(c),
        trust_tier: (field(c, "trust_tier") as number) ?? null,
        source: so?.title ? [so.title, so.publisher].filter(Boolean).join(" · ") : null,
      };
    }
  }

  // ── 맨 윗줄 요약 — 세기와 옮겨 적기만 한다
  const counts = { positive: 0, caution: 0, neutral: 0, no_evidence: 0 };
  for (const c of cards) counts[c.flag] += 1;

  const summary: Summary = {
    counts,
    attention: cards
      .filter((c) => c.flag === "caution")
      .map((c) => ({ key: c.key, title: c.title, line: c.lines[0]?.text ?? "" }))
      .filter((a) => a.line !== ""),
    rest: cards
      .filter((c) => c.flag !== "caution")
      .map((c) => ({ key: c.key, title: c.title, flag: c.flag })),
  };

  return {
    as_of: new Date().toISOString().slice(0, 10),
    conditions: cond,
    badges,
    summary,
    cards,
    evidence,
  };
}
