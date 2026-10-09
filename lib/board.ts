/**
 * 엔진 결과 → 화면 카드. 파이프라인과 검사 스크립트가 **같은 함수**를 쓴다.
 *
 * 왜 따로 뒀나: 예전에는 파이프라인과 check-assemble 이 각자 규칙 엔진을 부르고
 * 각자 assemble 에 넘겼다. 그래서 한쪽에만 엔진을 더하면 다른 쪽은 모르는 채로
 * 지나갔다 — 실제로 시장 규칙(ME-17)을 파이프라인에만 넣었더니 검사 화면에는
 * 안 나왔다. 같은 사고가 요청 필드에서 세 번 났고(치료영역·특허기록·회사이름)
 * 이번이 네 번째였다. 고르는 자리를 하나로 줄인다.
 */
import { matchRules, type RunOutput } from "./engines";
import { reviewTimes } from "./engines/rules";
import { assemble, type Board } from "./assemble";
import { factsFromInput } from "./facts";
import { dealExitPhase, dealPoolPhase, phaseGapOf } from "./engines/market";
import type { Conditions } from "./types";

export async function buildBoard(
  cond: Conditions,
  badges: string[],
  engines: RunOutput,
  /** 진단 요청 한 덩어리 — 골라 넘기지 않는다 */
  input: Record<string, unknown>,
  extra: { corp_name?: string; patent_expiry_year?: number } = {}
): Promise<Board> {
  // 규칙의 applies_when 이 묻는 칸들을 모은다.
  // 화면에서 안 받은 칸은 넣지 않는다 — 추정해 채우면 거짓 판정이 된다.
  const rcrWorst = (engines.rcr.values as { targets?: { RCR: number }[] })
    .targets?.slice(-1)[0]?.RCR;

  // ME-17 단계 차이 — 비교로 쓴 딜이 우리가 팔려는 시점보다 이른가 늦은가.
  // 라벨만 내고 "보수적·낙관적" 이라는 말은 M03-1007·1008 청크가 들고 있다.
  const dealStages = (engines.deals.values as { deals?: { stage: string }[] })
    .deals?.map((d) => d.stage) ?? [];
  const phase_gap_label = phaseGapOf(
    dealPoolPhase(dealStages, cond.phase),
    dealExitPhase(cond.phase, input.exit_route as string, input.exit_point as string)
  );

  // 런웨이는 엔진이 이미 냈다. 안 넘기면 밴드 규칙(F01-0003~0005)이
  // "확인 필요" 로 내려앉는다 — 값이 있는데 없다고 말하는 셈이다.
  const runwayMonths = (engines.runway.values as { runway_m_committed?: number | null })
    .runway_m_committed ?? undefined;

  const facts = factsFromInput(cond, input, {
    runway_months: runwayMonths ?? undefined,
    rcr: rcrWorst,
    backup_n: ((input.backup_assets as string[]) ?? []).length,
    // 국내 희귀 판정은 M02 가 만든다 — 묻지 않는다
    rare_kr: (engines.patients.values as { rare_kr?: string }).rare_kr,
    phase_gap_label: phase_gap_label ?? undefined,
  });

  const design = await matchRules("CE-04", cond, { limit: 6, facts });
  // 관할을 한국·미국 둘 다 보면서 10~12건이 걸린다. 4건으로 자르면
  // 미국 제도가 통째로 밀려 안 보인다.
  const regulatory = await matchRules("RE-02", cond, { limit: 14, facts });
  const patentRules = await matchRules("TE-02", cond, { limit: 2, facts });
  // MKT-5 — 딜 비교 풀 규칙(M03-1001~1008)과 출구 시점 규칙(M05).
  // 딜 기록(M03-0001~0247)은 layer 가 parameter 라 여기 걸리지 않는다.
  const marketRules = await matchRules("ME-17", cond, { limit: 4, facts });
  // 재무 카드 규칙 — F01·F02·F06(대표님 20261007 에 F02 추가)
  // 재무는 14건까지 걸린다. 자르면 뒤쪽 규칙이 말없이 사라진다.
  const financeRules = await matchRules("FE-RULES", cond, { limit: 16, facts });
  // R07 심사 기간 — 규제 카드 상세의 참고 줄(대표님 결정 20261009). 숫자 카드라
  // 신호등은 켜지 않는다.
  const review = await reviewTimes(facts);

  return assemble(cond, badges, engines, {
    corp_name: extra.corp_name ?? (input.corp_name as string | undefined),
    ...(extra.patent_expiry_year !== undefined
      ? { patent_expiry_year: extra.patent_expiry_year }
      : {}),
    design: design.values,
    regulatory: regulatory.values,
    patentRules: patentRules.values,
    marketRules: marketRules.values,
    financeRules: financeRules.values,
    reviewTimes: review.values.rows,
    phase_gap_label,
  });
}
