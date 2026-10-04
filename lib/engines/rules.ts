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
  /** 자리 정의로 찾은 엔진만 — 어느 사다리 칸에서 찾았나 */
  level?: number;
  /**
   * applies_when 이 "확인 필요" 로 나온 규칙 — 아직 묻지 않은 칸이 있다.
   *
   * 걸린 것으로도, 안 걸린 것으로도 세지 않는다. 화면에는
   * "○○를 적으면 이 제도를 판정할 수 있습니다" 로 따로 보여 준다.
   * 묻지 않은 조건을 충족한 것처럼 적으면 거짓 판정이 된다.
   */
  need_input?: { chunk_id: string; text: string; missing: string[] }[];
};

/** 규칙 엔진 등록부 — 어느 엔진이 어느 도메인을 보는가 */
export const MATCH_ENGINES: Record<
  string,
  {
    domain: string; name: string; ignore?: string[]; slot?: string;
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
  "RE-02": { domain: "R02", name: "희귀 지정·독점권 제도", ignore: ["jurisdiction"] },
  "RE-04": { domain: "R02", name: "신속 프로그램 적격", ignore: ["jurisdiction"] },
  // 자리 정의가 있는 엔진은 사다리로 고른다.
  // T02 는 모달리티 전용 로스터와 모든 약에 걸리는 공통 규칙(F1~F4 앵커)이 섞여 있다.
  // 예전처럼 둘을 한 통에 넣고 앞에서 2건만 자르면 공통 규칙이 영영 안 보였다.
  // PAT-2 자리는 "모달리티 전용이 있으면 그것, 없으면 공통"으로 정해 둔다.
  "TE-02": { domain: "T02", name: "FTO 게이트키퍼 존재", slot: "PAT-2" },
  "TE-05": { domain: "T04", name: "evidence_tier 부여" },
  "CE-04": { domain: "C04", name: "설계안 플래그", require_when: true },
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
  opts: { limit?: number; facts?: Facts } = {}
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

  // ── applies_when — "이 규칙이 언제 걸리는가" 가 청크에 글자로 적혀 있다.
  //
  // 사실(facts)을 안 넘기면 걸러내지 않는다. 묻지도 않고 떨어뜨리면
  // 화면이 영문도 모르게 비기 때문이다. 넘기면 세 갈래로 나뉜다.
  //   참    → 보여 준다
  //   거짓  → 안 보여 준다 (이 회사에 해당이 없는 제도다)
  //   모름  → need_input 으로 따로 — 어느 칸을 안 받았는지 같이 적는다
  const need: NonNullable<MatchValues["need_input"]> = [];
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
        need.push({ chunk_id: c.chunk_id, text: c.text, missing: r.missing });
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
    };
  });

  const flag = mergeFlags(rules.map((r) => r.flag));

  if (rules.length === 0)
    return ctx.none(
      { rules, flag, level, need_input: need },
      need.length
        ? `${spec.domain} 에서 ${need.length}건은 입력이 더 필요해 판정하지 않았습니다`
        : `${spec.domain} 에 이 조건으로 걸리는 규칙 카드가 없습니다`
    );

  return ctx.done({ rules, flag, level, need_input: need });
}
