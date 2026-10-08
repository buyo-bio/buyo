/**
 * 회사 축 엔진
 *
 *   FE-C08  회사 조회 · 비교군 풀
 *
 * 규칙(F06-01)
 *   비교군 풀 = 기업 마스터에서 신약개발_비교군 ∈ {Y, Y(주의 플래그)}
 *               ∧ Primary_BM ∈ {BM-01, BM-04}
 *   Y(주의 플래그)에는 comps_caution 배지.
 *
 * 여기서 하는 일은 "찾기" 와 "세기" 뿐이다.
 * 비교군을 좁히는 일(F06-02)과 재무 스냅샷(F06-04)은 아직 못 한다 —
 * 좁히기에 필요한 모달리티·질환군 칸이 기업 마스터에 없고,
 * 재무는 DART 인증키가 필요하다. 못 하는 것을 추정으로 메우지 않는다.
 */
import type { Conditions } from "../types";
import { Ctx, chunkSource, type EngineResult } from "./base";
import { readCompanies, poolOf, findCompany, isCaution, type Company } from "../companies";

export type CompanyRow = {
  stock_code: string;
  dart_code: string | null;
  name: string;
  market: string | null;
  /** 관리종목·투자주의환기종목 등 — 투자 판단에 그대로 쓴다 */
  trade_flag: string | null;
  headline: string | null;
  in_pool: boolean;
  caution: boolean;
};

export type CompanyValues = {
  /** 입력한 회사 — 마스터에서 찾은 것 */
  self: CompanyRow | null;
  /** 비교군 풀 크기 (F06-01) */
  pool_n: number;
  pool_caution_n: number;
  /** 좁힌 비교군 — 아직 못 한다. 왜 못 하는지는 notes 에 남긴다 */
  peers: CompanyRow[];
  /** 마스터 전체 회사 수 */
  master_n: number;
};

function toRow(c: Company, pool: Set<string>): CompanyRow {
  return {
    stock_code: c.stock_code,
    dart_code: c.dart_code,
    name: c.name,
    market: c.market,
    trade_flag: c.trade_flag,
    headline: c.headline,
    in_pool: pool.has(c.stock_code),
    caution: isCaution(c),
  };
}

export async function FE_C08(
  cond: Conditions,
  corpName?: string | null
): Promise<EngineResult<CompanyValues>> {
  const ctx = new Ctx("FE-C08");

  // 풀 정의는 규칙 카드가 정한다 — 근거로 달아 둔다
  const src = await chunkSource();
  const f06 = await src.find({}, { domain: "F06", kind: "rule" });
  const r01 = f06.find((c) => c.text.startsWith("[F06-01")) ?? null;
  const r02 = f06.find((c) => c.text.startsWith("[F06-02")) ?? null;
  if (r01) ctx.use(r01);

  let rows: Company[];
  try {
    rows = readCompanies();
  } catch (e) {
    return ctx.none(
      { self: null, pool_n: 0, pool_caution_n: 0, peers: [], master_n: 0 },
      `기업 마스터를 읽지 못했습니다 — ${(e as Error).message}`
    );
  }

  const pool = poolOf(rows);
  const poolIds = new Set(pool.map((c) => c.stock_code));

  const me = findCompany(rows, corpName);
  const self = me ? toRow(me, poolIds) : null;

  if (corpName && !self)
    ctx.note(`${corpName} 은 기업 마스터 ${rows.length}사에 없습니다 — 비상장이거나 등재 전입니다`);
  if (self?.caution) ctx.badge("comps_caution");
  if (self?.trade_flag && self.trade_flag !== "특이사항 없음(확인 범위 내)")
    ctx.badge(self.trade_flag);

  // 비교군 좁히기(F06-02)는 모달리티·질환군으로 거른다.
  // 기업 마스터에 그 칸이 없어서 지금은 풀까지만 셀 수 있다.
  // 풀 91사를 그대로 비교군이라고 내놓으면 비교가 아니라 착각이 된다.
  if (r02) ctx.use(r02);
  ctx.lack(
    `비교군 좁히기 — 기업 마스터에 모달리티·질환군 칸이 없어 ` +
    `${cond.modality || "이 약 종류"}·${cond.disease_group ?? "이 질환군"} 으로 추리지 못합니다`
  );

  return ctx.done(
    {
      self,
      pool_n: pool.length,
      pool_caution_n: pool.filter(isCaution).length,
      peers: [],
      master_n: rows.length,
    },
    "partial"
  );
}
