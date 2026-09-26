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

export type Flag = "positive" | "caution" | "neutral";

export type MatchedRule = {
  chunk_id: string;
  text: string;
  flag: Flag | null;
  jurisdiction: string | null;
};

export type MatchValues = {
  rules: MatchedRule[];
  /** 걸린 규칙들의 신호등을 합친 값 */
  flag: Flag | "no_evidence";
};

/** 규칙 엔진 등록부 — 어느 엔진이 어느 도메인을 보는가 */
export const MATCH_ENGINES: Record<string, { domain: string; name: string; ignore?: string[] }> = {
  "RE-02": { domain: "R02", name: "희귀 지정·독점권 제도", ignore: ["jurisdiction"] },
  "RE-04": { domain: "R02", name: "신속 프로그램 적격", ignore: ["jurisdiction"] },
  "TE-02": { domain: "T02", name: "FTO 게이트키퍼 존재" },
  "TE-05": { domain: "T04", name: "evidence_tier 부여" },
  "CE-04": { domain: "C04", name: "설계안 플래그" },
  "ME-03": { domain: "M01", name: "급여 채널 판정" },
  "FE-C0x": { domain: "F06", name: "비교군 규칙" },
};

/**
 * 여러 규칙의 신호등을 하나로 합친다.
 *   주의가 하나라도 있으면 → 주의
 *   전부 양호면            → 양호
 *   걸린 규칙이 없으면      → 근거 없음
 * 숫자 카드는 신호등을 켜지 않는다(여기 들어오지도 않는다).
 */
export function mergeFlags(flags: (Flag | null)[]): Flag | "no_evidence" {
  const real = flags.filter((f): f is Flag => f !== null);
  if (real.length === 0) return "no_evidence";
  if (real.includes("caution")) return "caution";
  if (real.every((f) => f === "positive")) return "positive";
  return "neutral";
}

export async function matchRules(
  engineId: string,
  cond: Conditions,
  opts: { limit?: number } = {}
): Promise<EngineResult<MatchValues>> {
  const ctx = new Ctx(engineId);
  const spec = MATCH_ENGINES[engineId];
  if (!spec) return ctx.none({ rules: [], flag: "no_evidence" }, `등록부에 없는 규칙 엔진: ${engineId}`);

  const src = await chunkSource();

  // 무시하라고 한 조건은 빼고 건다.
  // 모달리티는 여기서 걸지 않는다 — 상위 태그도 허용해야 해서 아래에서 따로 거른다.
  const q: Partial<Conditions> = {
    indication_code: cond.indication_code ?? undefined,
    phase: cond.phase,
    rare: cond.rare,
    jurisdiction: cond.jurisdiction,
  };
  for (const k of spec.ignore ?? []) delete (q as Record<string, unknown>)[k];

  let rows = await src.find(q, { domain: spec.domain, kind: "rule" });

  // 상위 태그 허용 — antibody_mAb 로 찾을 때 antibody 규칙도 걸려야 한다.
  // 이게 없으면 "이중항체 포맷 IP" 같은 정작 맞는 규칙이 빠지고 일반 규칙만 남는다.
  const family = cond.modality ? await modalityFamily(cond.modality) : [];
  if (family.length) rows = rows.filter((c) => modalityMatches(c, family));

  // 줄 세우기 — 구체적인 것부터
  //   ① 이 약 종류를 콕 집은 규칙   ② 국내(관할 일치)   ③ 신뢰 등급   ④ ID
  const modRank = (c: Chunk) => (field(c, "modality") == null ? 1 : 0);
  const jurRank = (c: Chunk) => {
    const j = field(c, "jurisdiction") as string | null;
    if (!cond.jurisdiction) return 0;
    return j === cond.jurisdiction ? 0 : j == null || j === "GLOBAL" ? 1 : 2;
  };
  rows = [...rows].sort(
    (a, b) =>
      modRank(a) - modRank(b) ||
      jurRank(a) - jurRank(b) ||
      (a.trust_tier ?? 9) - (b.trust_tier ?? 9) ||
      a.chunk_id.localeCompare(b.chunk_id)
  );

  if (opts.limit) rows = rows.slice(0, opts.limit);

  const rules: MatchedRule[] = rows.map((c: Chunk) => {
    ctx.use(c);
    return {
      chunk_id: c.chunk_id,
      text: c.text,
      flag: (field(c, "flag_hint") as Flag) ?? null,
      jurisdiction: (field(c, "jurisdiction") as string) ?? null,
    };
  });

  const flag = mergeFlags(rules.map((r) => r.flag));

  if (rules.length === 0)
    return ctx.none({ rules, flag }, `${spec.domain} 에 이 조건으로 걸리는 규칙 카드가 없습니다`);

  return ctx.done({ rules, flag });
}
