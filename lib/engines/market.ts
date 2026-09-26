/**
 * M축 엔진 — 기술이전 딜 컴프
 *
 *   FE-B07 / ME-08  같은 조건의 기술이전은 얼마에 이루어졌나
 *
 * 규칙 F06-09 그대로.
 *   M03 에서 모달리티(상위 태그 허용) ∧ 단계 일치.
 *   N ≥ 5 면 사분위, 아니면 목록.
 *   비공개 계약금은 금액에서 빼고 건수만 센다.
 *
 * 통화를 섞지 않는다. 달러는 달러대로, 원화는 원화대로 센다.
 */
import type { Chunk, Conditions } from "../types";
import { Ctx, chunkSource, field, modalityMatches, phaseMatches, type EngineResult } from "./base";
import { modalityFamily } from "../normalize";

type Deal = {
  licensor?: string; counterparty?: string; partner_tier?: string;
  asset?: string; signed?: string; deal_stage?: string;
  upfront?: string; tdv_total?: string; territory?: string;
};

export type DealComp = {
  chunk_id: string;
  licensor: string;
  counterparty: string;
  signed: string;
  stage: string;
  /** 원문 그대로 — "＄130.4M(1304억)" */
  upfront_text: string;
  /** 공개된 경우에만 */
  upfront_krw_억: number | null;
  upfront_usd_m: number | null;
  disclosed: boolean;
};

export type DealValues = {
  deals: DealComp[];
  n_total: number;
  n_disclosed: number;
  /** N ≥ 5 이고 같은 통화가 5건 이상일 때만 */
  quartiles_krw_억: { q1: number; med: number; q3: number } | null;
};

/** "$130.4M(1304억)" → { usd_m: 130.4, krw: 1304 } */
function parseUpfront(t: string | undefined): { usd_m: number | null; krw: number | null; disclosed: boolean } {
  if (!t || /base_required|비공개|미보고/.test(t))
    return { usd_m: null, krw: null, disclosed: false };
  const krw = t.match(/([\d,.]+)\s*억/);
  const usd = t.match(/[$＄]\s*([\d,.]+)\s*M/i);
  return {
    usd_m: usd ? Number(usd[1].replace(/,/g, "")) : null,
    krw: krw ? Number(krw[1].replace(/,/g, "")) : null,
    disclosed: true,
  };
}

function quartiles(xs: number[]) {
  const a = [...xs].sort((p, q) => p - q);
  const at = (f: number) => {
    const i = (a.length - 1) * f;
    const lo = Math.floor(i), hi = Math.ceil(i);
    return lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (i - lo);
  };
  return { q1: at(0.25), med: at(0.5), q3: at(0.75) };
}

export async function ME_08(cond: Conditions): Promise<EngineResult<DealValues>> {
  const ctx = new Ctx("ME-08");
  const src = await chunkSource();

  // 규칙 카드를 먼저 읽는다 — 이 엔진이 무엇을 하는지는 카드가 정한다
  const rules = await src.find({}, { domain: "F06", kind: "rule" });
  const r09 = rules.find((c) => c.text.startsWith("[F06-09")) ?? null;
  if (r09) ctx.use(r09);

  const family = cond.modality ? await modalityFamily(cond.modality) : [];

  // 딜 컴프는 '지금 이 회사가 서 있는 단계' 로 본다.
  // 비임상 회사는 비임상 딜이 궁금한 것이지, 1상 딜이 궁금한 게 아니다.
  const phase = cond.phase;

  const rows = await src.find({}, { domain: "M03", kind: "parameter" });
  const hits = rows.filter((c: Chunk) => {
    // 약 종류 칸이 비어 있는 딜은 "같은 약 종류" 가 아니다.
    // 다른 조회와 달리, 여기서는 빈 칸을 '모든 경우 해당' 으로 치지 않는다.
    if (field(c, "modality") == null) return false;
    return modalityMatches(c, family) && phaseMatches(c, phase);
  });

  const deals: DealComp[] = hits.map((c) => {
    ctx.use(c);
    const d = (field(c, "deal") ?? {}) as Deal;
    const u = parseUpfront(d.upfront);
    return {
      chunk_id: c.chunk_id,
      licensor: d.licensor ?? "—",
      counterparty: d.counterparty ?? "—",
      signed: d.signed ?? "—",
      stage: d.deal_stage ?? "—",
      upfront_text: u.disclosed ? (d.upfront ?? "미보고") : "비공개",
      upfront_krw_억: u.krw,
      upfront_usd_m: u.usd_m,
      disclosed: u.disclosed,
    };
  });

  deals.sort((a, b) => b.signed.localeCompare(a.signed));

  const krw = deals.map((d) => d.upfront_krw_억).filter((x): x is number => x !== null);
  const values: DealValues = {
    deals,
    n_total: deals.length,
    n_disclosed: deals.filter((d) => d.disclosed).length,
    // 같은 통화가 5건 이상일 때만 사분위. 통화를 섞지 않는다.
    quartiles_krw_억: krw.length >= 5 ? quartiles(krw) : null,
  };

  if (deals.length === 0)
    return ctx.none(values, "이 약 종류·단계에 맞는 기술이전 사례가 없습니다");

  if (values.n_disclosed < deals.length)
    ctx.badge(`계약금 비공개 ${deals.length - values.n_disclosed}건은 건수로만 셌습니다`);
  if (!values.quartiles_krw_억 && deals.length >= 5)
    ctx.note("원화로 공개된 건이 5건 미만이라 사분위 대신 목록으로 표시합니다");

  return ctx.done(values);
}
