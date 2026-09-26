/**
 * 엔진 모아 돌리기
 *
 * ②정규화가 만든 조건 + 사용자가 적은 숫자를 받아
 * MVP 엔진을 순서대로 돌리고 결과를 한 덩어리로 돌려준다.
 *
 * ⑤카드 조립(lib/assemble.ts)은 이 결과만 보고 문장을 만든다.
 * 조립 단계는 DB를 다시 보지 않는다.
 */
import type { Conditions } from "../types";
import type { EngineResult } from "./base";
import { CE_01, CE_02, CE_06, durationToApproval } from "./clinical";
import { ME_08 } from "./market";
import { TE_03, TE_08, TE_09 } from "./patent";
import type { PatentRecord } from "../collect/kipris";
import { FE_A01, FE_A02, FE_A03, FE_A04, FE_A05, FE_B10, type RunwayInput, type Target } from "./finance";

export * from "./base";
export * from "./axes";
export * from "./clinical";
export * from "./finance";
export * from "./rules";
export * from "./market";
export * from "./patent";

/**
 * MVP에서 아직 못 도는 엔진과 그 이유.
 * 조용히 빠지면 나중에 '왜 이 카드가 없지?' 가 된다. 표로 남긴다.
 */
export const BLOCKED_ENGINES: { id: string; name: string; waiting_for: string }[] = [
  { id: "CE-03", name: "대상자 수 벤치마크", waiting_for: "CT.gov 수집(S3)" },
  { id: "CE-07", name: "경쟁 임상 밀도", waiting_for: "CT.gov 수집(S3)" },
  { id: "FE-C08", name: "회사 조회·비교군 풀", waiting_for: "기업 마스터 적재 + DART 인증키" },
  { id: "FE-C01", name: "비교군 선정", waiting_for: "FE-C08" },
  { id: "FE-C02", name: "비교군 재무 스냅샷", waiting_for: "DART 인증키" },
  { id: "FE-C05", name: "시장이 지불한 단계 가치", waiting_for: "DART 인증키 + 비교군 3사 종목코드" },
  { id: "ME-01", name: "유병·발생 조회", waiting_for: "M02 역학 표 청크" },
  { id: "ME-03", name: "급여 채널 판정", waiting_for: "M01 급여 규칙 청크" },
  { id: "ME-09", name: "출구 시점 기본값", waiting_for: "M03 출구 시점 규칙 청크(M-D05-004)" },
  { id: "TE-03", name: "특허 만료 밴드 판정", waiting_for: "T03 밴드 규칙 청크 (값은 나오고 판정만 코드에 있음)" },
];

export type RunInput = RunwayInput & {
  /** 변곡점까지 거치는 단계 목록 (FE-D02 결과) */
  stages: string[];
  /** 사용자가 적은 계획 대상자 수 — 없으면 업계 벤치마크로 대신하고 배지 */
  planned_n?: number;
  /** 백업 자산 이름 */
  backup_assets?: string[];
  planned_raise_date?: string;
  /**
   * 돈이 버텨야 하는 시점들. 안 주면 변곡점 하나만 본다.
   * 비임상 회사는 보통 두 개다 — IND 제출(1차), P1 완료(2차).
   */
  targets?: Target[];
  /** KIPRIS 수집 결과. 없으면 특허 칸은 '근거 없음' */
  patent_records?: PatentRecord[];
  /** 사용자가 적은 물질특허 만료 연도 */
  patent_expiry_year?: number;
};

export type RunOutput = {
  success: EngineResult;
  duration: EngineResult;
  runway: EngineResult;
  /** 업계 평균 단계 비용 (C03) */
  bench: EngineResult;
  /** 설계안 기준 임상 직접비 (환자당 단가 × 인원) */
  need: EngineResult;
  gap: EngineResult;
  /** 기술이전 딜 컴프 */
  deals: EngineResult;
  /** 특허 포트폴리오 · 모달리티 힌트 · 만료 정렬 */
  portfolio: EngineResult;
  patentHint: EngineResult;
  patentAlign: EngineResult;
  rcr: EngineResult;
  downside: EngineResult;
  gate: EngineResult;
  blocked: typeof BLOCKED_ENGINES;
};

export async function runEngines(cond: Conditions, inp: RunInput): Promise<RunOutput> {
  // ── C축: 확률과 기간
  const success = await CE_01(cond);
  const duration = await CE_02(cond, inp.stages);

  // ── F축: 돈
  const runway = await FE_A01(inp);
  const bench = await FE_A02(cond, inp.stages);
  const need = await FE_A03(cond, inp.stages, inp.planned_n);
  const gap = await FE_A04(runway.values as never, cond.fin_state, {
    planned_raise_date: inp.planned_raise_date,
  });

  // 목표 시점을 안 주면 변곡점 하나만 본다
  const months = (duration.values as { months_total: number | null }).months_total;
  const targets: Target[] = inp.targets?.length
    ? inp.targets
    : months
      ? [{ label: "변곡점", months, basis: duration.basis_chunks }]
      : [];
  const rcr = await FE_A05(runway.values as never, targets);
  const downside = await FE_B10(inp.backup_assets ?? []);

  // ── M축: 같은 조건의 기술이전은 얼마였나
  const deals = await ME_08(cond);

  // ── T축: 특허
  const portfolio = await TE_08(inp.patent_records ?? []);
  const patentHint = await TE_09(portfolio.values as never);
  // 출시 시점은 '변곡점까지' 가 아니라 '승인까지' 로 잡아야 한다
  const toApproval = await durationToApproval(cond);
  const patentAlign = await TE_03(cond, {
    // 사용자가 적은 만료 연도가 없으면 등록 특허에서 추정한 값을 쓴다
    patent_expiry_year:
      inp.patent_expiry_year ??
      (portfolio.values as { earliest_expiry_year: number | null }).earliest_expiry_year,
    years_to_approval: toApproval.years,
    basis: toApproval.chunk_id ? [toApproval.chunk_id] : [],
  });

  // ── 이 값을 화면 첫 줄에 써도 되는가
  const gate = await CE_06([...success.basis_chunks, ...duration.basis_chunks]);

  return {
    success, duration, runway, bench, need, gap, deals,
    portfolio, patentHint, patentAlign,
    rcr, downside, gate, blocked: BLOCKED_ENGINES,
  };
}
