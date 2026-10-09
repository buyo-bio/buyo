/**
 * 규칙(MATCH) 엔진 — 18개를 함수 하나로
 *
 * 규칙 엔진이 하는 일은 어느 것이나 같다.
 *   조건 5개에 걸리는 rule 청크를 꺼내 → 그 문장을 그대로 화면에 낸다.
 *
 * 그래서 엔진마다 코드를 따로 쓰지 않는다.
 * 어느 도메인을 보는지만 다르고, 문장은 청크가 들고 있다.
 *
 * 화면에 나가는 글은 청크 text 그대로다. 여기서 문장을 지어내지 않는다.
 */
import type { Chunk, Conditions } from "../types";
import { Ctx, chunkSource, field, modalityMatches, type EngineResult } from "./base";
import { modalityFamily } from "../normalize";
import { resolveSlotFrom, type ResolveInput } from "../resolve";
import { slot } from "../slots";
import { evalAppliesWhen, AppliesWhenError } from "../applies-when";
import type { Facts } from "../applies-when";

export type Flag = "positive" | "caution" | "neutral";

/**
 * 고객 화면용 문장 묶음 — 청크의 display 객체.
 *
 * 대표님이 20261008 묶음에서 모든 청크에 붙여 주셨다. 화면에는 text 가 아니라
 * 이것을 띄운다. text 는 조건식·근거 메모가 붙은 내부용 문장이라, 그대로 내면
 * "[설계 플래그 C04-D01] 조건: endpoint_type == 'surrogate' …" 가 고객에게 보인다.
 */
export type Display = {
  title: string;
  body: string;
  meaning: string;
  action: string;
  /** internal 이면 화면에 띄우지 않는다 */
  audience: string;
  /** 화면 꼬리표 — "운영 기준" 등 */
  badges_ko: string[];
  /** 출처 이름 — 화면에는 chunk_id 대신 이것을 띄운다 */
  source_label: string;
  /** 출처 한 줄 설명 — 툴팁 */
  source_note: string;
  /** 용어 풀이를 달 낱말 — glossary 와 짝짓는다 */
  terms: { text: string; term: string }[];
};

export type MatchedRule = {
  chunk_id: string;
  text: string;
  flag: Flag | null;
  jurisdiction: string | null;
  /** 없거나 internal 이면 undefined — 그때는 화면이 text 로 돌아간다 */
  display?: Display;
};

export type MatchValues = {
  rules: MatchedRule[];
  /** 걸린 규칙들의 신호등을 합친 값 */
  flag: Flag | "no_evidence";
  /** 자리 정의로 찾은 엔진만 — 어느 사다리 칸에서 찾았나 */
  level?: number;
  /**
   * applies_when 이 "확인 필요" 로 나온 규칙 — 아직 묻지 않은 칸이 있다.
   *
   * 걸린 것으로도, 안 걸린 것으로도 세지 않는다. 화면에는
   * "○○를 적으면 이 제도를 판정할 수 있습니다" 로 따로 보여 준다.
   * 묻지 않은 조건을 충족한 것처럼 적으면 거짓 판정이 된다.
   */
  need_input?: {
    chunk_id: string;
    text: string;
    /**
     * 고객 화면용 제목 — 청크의 display.title.
     *
     * 이게 없으면 화면이 text 를 앞에서 30자 잘라 쓰는데, 그러면
     * "목표 차이의 검정력이 power_band.good_mi" 처럼 내부 변수 이름이
     * 그대로 새고, 조건만 다른 규칙 두 장이 같은 줄로 보인다(실제로 그랬다).
     */
    title?: string;
    missing: string[];
  }[];
  /**
   * applies_when 이 거짓으로 나온 규칙 — 이 회사에는 해당이 없다.
   *
   * 화면에 문장으로 띄우지는 않지만 개수는 센다. "몇 개를 보고
   * 몇 개가 걸렸는가" 를 말하려면 안 걸린 것도 세야 한다(C04-0105).
   * 세지 않으면 "지적 사항 없음" 과 "볼 것이 없었음" 이 구별되지 않는다.
   */
  not_applicable?: string[];
};

/** 규칙 엔진 등록부 — 어느 엔진이 어느 도메인을 보는가 */
export const MATCH_ENGINES: Record<
  string,
  {
    domain: string | string[]; name: string; ignore?: string[]; slot?: string;
    /**
     * applies_when 이 적힌 청크만 쓴다.
     *
     * C04 가 그렇다 — 46장은 자료 해석 메모(어느 표 값을 채택했나)이고,
     * 설계 플래그는 applies_when 이 붙은 11장뿐이다. 메모까지 카드에 올리면
     * 화면이 출처 각주로 덮인다. 메모는 '근거 보기' 에서 본다.
     */
    require_when?: boolean;
  }
> = {
  // 규제 카드는 세 묶음을 함께 본다 (대표님 20261004_1709).
  //   R01   허가 경로·자료요건·급여 절차
  //   R02   제도(우선심사·조건부·희귀지정 등)
  //   R02X  독점권·자료 보호
  //   R03   모달리티별 제조·품질(CMC) — 전부 GLOBAL 이라 관할과 무관
  // 전에는 R02 만 보고 있어서 R01·R02X·R03 42건이 화면에 아예 안 나왔다.
  //
  // 관할(jurisdiction)은 무시하지 않는다 — 국내 진단에 미국 제도를 섞으면 안 된다.
  // 조회 쪽에서 "KR|US" 같은 묶음 칸도 KR 로 걸리게 고쳐 두었다.
  "RE-02": { domain: ["R01", "R02", "R02X", "R03"], name: "규제 경로·제도·독점권·품질" },
  "RE-04": { domain: "R02", name: "신속 프로그램 적격" },
  // 자리 정의가 있는 엔진은 사다리로 고른다.
  // T02 는 모달리티 전용 로스터와 모든 약에 걸리는 공통 규칙(F1~F4 앵커)이 섞여 있다.
  // 예전처럼 둘을 한 통에 넣고 앞에서 2건만 자르면 공통 규칙이 영영 안 보였다.
  // PAT-2 자리는 "모달리티 전용이 있으면 그것, 없으면 공통"으로 정해 둔다.
  "TE-02": { domain: "T02", name: "FTO 게이트키퍼 존재", slot: "PAT-2" },
  "TE-05": { domain: "T04", name: "evidence_tier 부여" },
  "CE-04": { domain: "C04", name: "설계안 플래그", require_when: true },
  "ME-03": { domain: "M01", name: "급여 채널 판정" },
  // MKT-5 — 딜 비교 풀 규칙(M03-1001~1008). 딜 기록(M03-0001~0247)은 layer 가
  // parameter 라 여기 걸리지 않는다. M05 는 출구 시점 규칙.
  "ME-17": { domain: ["M03", "M05"], name: "딜 비교 풀·단계 차이", require_when: true },
  "FE-C0x": { domain: "F06", name: "비교군 규칙" },
  // 재무 카드 규칙 — F01(런웨이·조달) · F02(희석·상환) · F06(비교군).
  // F02 는 대표님이 20261007 에 더하라고 하신 도메인이다.
  "FE-RULES": { domain: ["F01", "F02", "F06"], name: "재무 규칙", require_when: true },
};

/**
 * 여러 규칙의 신호등을 하나로 합친다 — 대표님 기준(trace_case.py 315~335줄).
 *
 *   주의가 하나라도 있으면        → 주의
 *   없고 양호가 하나라도 있으면    → 양호
 *   그 밖에 걸린 규칙이 있으면     → 중립
 *   걸린 규칙이 0개면            → 근거 없음
 *
 * 2026-10-09 고침: 전에는 "**전부** 양호여야 양호" 였다. 규칙 253장 중 양호가
 * 9장뿐이라, 양호 한 장과 중립 여러 장이 함께 걸리면 늘 중립으로 내려앉았다.
 * 대표님이 "양호가 한 번도 안 뜬다" 고 지적하신 까닭의 절반이 이것이다.
 *
 * ⚠️ 아직 못 한 것: 대표님은 "판정색은 mvp=Y 규칙만으로" 라고 하셨는데,
 * 20261008_0336 묶음의 **규칙 청크에는 mvp 칸이 없다**(method 청크 77장에만 있다).
 * 그래서 지금은 걸린 규칙을 전부 센다. 규칙에 mvp 가 실려 오면 바로 거른다.
 *
 * 숫자 카드는 신호등을 켜지 않는다(여기 들어오지도 않는다).
 */
export function mergeFlags(flags: (Flag | null)[]): Flag | "no_evidence" {
  const real = flags.filter((f): f is Flag => f !== null);
  if (real.length === 0) return "no_evidence";
  if (real.includes("caution")) return "caution";
  if (real.includes("positive")) return "positive";
  return "neutral";
}

/**
 * 청크의 고객용 문장 묶음. 없거나 audience 가 internal 이면 undefined.
 *
 * 빈 글자는 없는 것으로 본다 — 초안 청크는 title 만 있고 body 가 "" 인 것이 많다.
 */
export function displayOf(c: Chunk): Display | undefined {
  const d = field(c, "display") as Record<string, unknown> | undefined;
  if (!d || typeof d !== "object") return undefined;
  if (d.audience === "internal") return undefined;
  const str = (k: string) => (typeof d[k] === "string" ? (d[k] as string).trim() : "");
  const title = str("title");
  const body = str("body");
  // 제목도 본문도 없으면 띄울 것이 없다
  if (!title && !body) return undefined;
  return {
    title, body,
    meaning: str("meaning"),
    action: str("action"),
    audience: str("audience") || "customer",
    source_label: str("source_label"),
    source_note: str("source_note"),
    badges_ko: Array.isArray(d.badges_ko) ? (d.badges_ko as string[]).filter(Boolean) : [],
    terms: Array.isArray(d.terms)
      ? (d.terms as { text?: string; term?: string }[])
          .filter((t) => t?.text && t?.term)
          .map((t) => ({ text: t.text as string, term: t.term as string }))
      : [],
  };
}

/** 청크의 고객용 제목만 — '확인 필요' 줄에 쓴다 */
function displayTitle(c: Chunk): string | undefined {
  return displayOf(c)?.title || undefined;
}

export async function matchRules(
  engineId: string,
  cond: Conditions,
  opts: { limit?: number; facts?: Facts } = {}
): Promise<EngineResult<MatchValues>> {
  const ctx = new Ctx(engineId);
  const spec = MATCH_ENGINES[engineId];
  if (!spec) return ctx.none({ rules: [], flag: "no_evidence" }, `등록부에 없는 규칙 엔진: ${engineId}`);

  const src = await chunkSource();

  // 무시하라고 한 조건은 빼고 건다.
  // 모달리티는 여기서 걸지 않는다 — 상위 태그도 허용해야 해서 아래에서 따로 거른다.
  // 관할로 거르지 않는다 — 대표님 결정 20261009.
  // 규칙표의 jurisdiction 열이 아니라 applies_when 결과로 고른다. 열로 거르면
  // "KR|US" 처럼 쌍으로 적힌 행이 빠지고, 미국 제도가 통째로 사라진다.
  const q: Partial<Conditions> = {
    indication_code: cond.indication_code ?? undefined,
    phase: cond.phase,
    rare: cond.rare,
  };
  for (const k of spec.ignore ?? []) delete (q as Record<string, unknown>)[k];

  let rows: Chunk[];
  let level: number | undefined;

  if (spec.slot) {
    const inp: ResolveInput = {
      modality: cond.modality,
      phase: cond.phase,
      therapeutic_area: cond.therapeutic_area ?? null,
      disease_group: cond.disease_group,
      rare: cond.rare,
    };
    const r = await resolveSlotFrom(src, slot(spec.slot), inp);
    rows = r.chunks.filter((c) => c.layer === "rule");
    level = r.level;
  } else {
    rows = await src.find(q, { domain: spec.domain, kind: "rule" });

    // 상위 태그 허용 — antibody_mAb 로 찾을 때 antibody 규칙도 걸려야 한다.
    // 이게 없으면 "이중항체 포맷 IP" 같은 정작 맞는 규칙이 빠지고 일반 규칙만 남는다.
    const family = cond.modality ? await modalityFamily(cond.modality) : [];
    if (family.length) rows = rows.filter((c) => modalityMatches(c, family));
  }

  // 줄 세우기 — 구체적인 것부터
  //   ① 이 약 종류를 콕 집은 규칙   ② 국내(관할 일치)   ③ 신뢰 등급   ④ ID
  const modRank = (c: Chunk) => (field(c, "modality") == null ? 1 : 0);
  const jurRank = (c: Chunk) => {
    const j = field(c, "jurisdiction") as string | null;
    if (!cond.jurisdiction) return 0;
    return j === cond.jurisdiction ? 0 : j == null || j === "GLOBAL" ? 1 : 2;
  };
  // 자리 정의로 고른 엔진은 사다리가 이미 "어느 묶음인지"를 정했다.
  // 그 안에서 신뢰 등급으로 다시 줄을 세우면 등록부 순서가 뒤집혀
  // F1~F4 앵커 대신 뒤쪽 보충 규칙이 앞으로 올라온다(실제로 그랬다).
  // 묶음 안에서는 대표님이 적어 둔 순서(=ID 순)를 그대로 쓴다.
  rows = spec.slot
    ? [...rows].sort((a, b) => a.chunk_id.localeCompare(b.chunk_id))
    : [...rows].sort(
        (a, b) =>
          modRank(a) - modRank(b) ||
          jurRank(a) - jurRank(b) ||
          (a.trust_tier ?? 9) - (b.trust_tier ?? 9) ||
          a.chunk_id.localeCompare(b.chunk_id)
      );

  // ── 내부용 규칙은 고객 화면에서 뺀다 (대표님 표시 규칙 20261008 · 2장)
  //
  // display.audience 가 internal 인 규칙 79장이 있다. 대부분 본문이 비어 있는
  // 메모다 — 예: T02-0010 "[M6 ADC F3 모달리티 기본가정]" 은 제목뿐이고 문장이 없다.
  // 화면에 띄울 글이 없으므로 띄우지 않는다.
  //
  // 신호등에서도 뺀다. 그중 7장이 caution 이라 특허 카드를 주의로 켜고 있었는데,
  // 정작 왜 주의인지 보여 줄 문장이 없어 "까닭 없이 주황" 이 됐다. 보이지 않는
  // 근거로 색을 켜지 않는다 — 빠진 판단이 있으면 대표님이 문장을 붙여 주시면 된다.
  const hidden: string[] = [];
  rows = rows.filter((c) => {
    const a = (field(c, "display") as { audience?: string } | undefined)?.audience;
    if (a !== "internal") return true;
    hidden.push(c.chunk_id);
    return false;
  });
  if (hidden.length)
    ctx.note(`내부용 규칙 ${hidden.length}건은 화면에 띄우지 않았습니다 (${hidden.slice(0, 4).join(", ")}${hidden.length > 4 ? " 외" : ""})`);

  // ── applies_when — "이 규칙이 언제 걸리는가" 가 청크에 글자로 적혀 있다.
  //
  // 사실(facts)을 안 넘기면 걸러내지 않는다. 묻지도 않고 떨어뜨리면
  // 화면이 영문도 모르게 비기 때문이다. 넘기면 세 갈래로 나뉜다.
  //   참    → 보여 준다
  //   거짓  → 안 보여 준다 (이 회사에 해당이 없는 제도다)
  //   모름  → need_input 으로 따로 — 어느 칸을 안 받았는지 같이 적는다
  const need: NonNullable<MatchValues["need_input"]> = [];
  /** 조건이 거짓이어서 뺀 규칙 — 개수만 쓴다(C04-0105 요약) */
  const notApplicable: string[] = [];
  if (spec.require_when)
    rows = rows.filter((c) => {
      const aw = field(c, "applies_when");
      return typeof aw === "string" && aw.trim() !== "";
    });

  if (opts.facts) {
    const pass: Chunk[] = [];
    for (const c of rows) {
      const aw = field(c, "applies_when");
      if (typeof aw !== "string" || !aw.trim()) { pass.push(c); continue; }
      let r: { value: boolean | null; missing: string[] };
      try {
        r = evalAppliesWhen(aw, opts.facts);
      } catch (e) {
        // 식을 못 읽으면 규칙을 떨어뜨리지 않는다 — 식이 틀린 것은 자료 문제다.
        // npm run aw:check 가 미리 잡는다. 여기서는 그냥 통과시키고 적어 둔다.
        ctx.note(
          `${c.chunk_id} 의 조건식을 읽지 못해 걸러내지 않았습니다` +
          (e instanceof AppliesWhenError ? ` (${e.message})` : "")
        );
        pass.push(c);
        continue;
      }
      if (r.value === true) pass.push(c);
      else if (r.value === null)
        need.push({
          chunk_id: c.chunk_id,
          text: c.text,
          title: displayTitle(c),
          missing: r.missing,
        });
      else notApplicable.push(c.chunk_id);
    }
    rows = pass;
  }

  if (opts.limit) rows = rows.slice(0, opts.limit);

  const rules: MatchedRule[] = rows.map((c: Chunk) => {
    ctx.use(c);
    return {
      chunk_id: c.chunk_id,
      text: c.text,
      flag: (field(c, "flag_hint") as Flag) ?? null,
      jurisdiction: (field(c, "jurisdiction") as string) ?? null,
      display: displayOf(c),
    };
  });

  const flag = mergeFlags(rules.map((r) => r.flag));

  if (rules.length === 0)
    return ctx.none(
      { rules, flag, level, need_input: need, not_applicable: notApplicable },
      need.length
        ? `${spec.domain} 에서 ${need.length}건은 입력이 더 필요해 판정하지 않았습니다`
        : `${spec.domain} 에 이 조건으로 걸리는 규칙 카드가 없습니다`
    );

  return ctx.done({ rules, flag, level, need_input: need, not_applicable: notApplicable });
}

/**
 * R07 심사 기간 — 규제 카드 상세의 참고 줄 (대표님 결정 20261009)
 *
 * 규칙(rule)이 아니라 숫자 카드(parameter)라 신호등을 켜지 않는다.
 * "미국 표준 심사 10개월" 처럼 값과 단위를 들고 있고, 어느 제도가 우리에게
 * 해당하는지는 applies_when 이 정한다.
 *
 * 조건을 못 읽거나 "확인 필요" 로 나오면 띄우지 않는다 — 심사 기간은 숫자라,
 * 해당하는지 모르는 채로 보여 주면 그 기간이 우리 것인 줄 읽힌다.
 */
export type ReviewTime = {
  chunk_id: string;
  title: string;
  body: string;
  value: string;
  unit: string;
  jurisdiction: string | null;
  source_label: string;
};

export async function reviewTimes(facts: Facts): Promise<EngineResult<{ rows: ReviewTime[] }>> {
  const ctx = new Ctx("RE-07");
  const src = await chunkSource();
  const rows: ReviewTime[] = [];

  for (const c of await src.find({}, { domain: "R07", kind: "parameter" })) {
    const d = displayOf(c);
    if (!d) continue;                       // 내부용이거나 띄울 문장이 없다
    const aw = field(c, "applies_when");
    if (typeof aw !== "string" || !aw.trim()) continue;
    try {
      if (evalAppliesWhen(aw, facts).value !== true) continue;
    } catch {
      continue;                             // 식을 못 읽으면 숫자를 띄우지 않는다
    }
    ctx.use(c);
    rows.push({
      chunk_id: c.chunk_id,
      title: d.title,
      body: d.body,
      value: String(field(c, "value") ?? ""),
      unit: String(field(c, "unit") ?? ""),
      jurisdiction: (field(c, "jurisdiction") as string) ?? null,
      source_label: d.source_label,
    });
  }

  rows.sort((a, b) => a.chunk_id.localeCompare(b.chunk_id));
  return rows.length
    ? ctx.done({ rows })
    : ctx.none({ rows }, "이 조건에 해당하는 심사 기간 카드가 없습니다");
}
