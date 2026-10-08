/**
 * 진단 한 번 — 다섯 단계
 *
 * POST /api/diagnose 와 POST /api/diagnose/stream 이 똑같이 이걸 부른다.
 * 두 군데에 같은 순서를 적어 두면 반드시 어긋난다(이번 프로젝트에서 세 번 겪었다).
 *
 * onStep 은 '진짜로 그 단계가 끝난 순간' 불린다.
 * 화면 진행 표시는 이 시각만 보고 그린다 — 가짜 지연을 넣지 않는다.
 */
import { DiagnoseInput } from "./types";
import { normalize, nextInflection } from "./normalize";
import { factsFromInput } from "./facts";
import { runEngines, matchRules, resetReads, readStats } from "./engines";
import { assemble, type Board } from "./assemble";
import { loadPatents } from "./collect/patents-cache";
import { countChunks, saveRun } from "./store";

export type StepId = "normalize" | "retrieve" | "engines" | "assemble";

export type Step = {
  id: StepId;
  /** 화면에 그대로 나가는 줄 */
  label: string;
  /** 그 아래 작은 글씨 — 이 단계가 실제로 무엇을 했는지 */
  detail: string;
  /** 이 단계에 걸린 시간(ms) */
  ms: number;
};

export type Payload = {
  run_id: string;
  input: unknown;
  normalized: unknown;
  cards: Board;
  basis_chunks: string[];
  as_of: string;
  engines_blocked: { id: string; name: string; waiting_for: string }[];
};

export class InputError extends Error {
  constructor(public issues: string[]) {
    super("입력이 올바르지 않습니다");
  }
}

const LABEL: Record<StepId, string> = {
  normalize: "조건 정규화",
  retrieve: "판단 기준 카드 조회",
  engines: "계산기 실행",
  assemble: "여섯 관점 카드 조립",
};

export async function runDiagnose(
  body: unknown,
  onStep: (s: Step) => void | Promise<void> = () => {}
): Promise<Payload> {
  // ① 입력 검사 — 여기서 걸러야 아래가 깨끗하다
  const parsed = DiagnoseInput.safeParse(body);
  if (!parsed.success) {
    throw new InputError(
      parsed.error.issues.map((i: { path: (string | number)[]; message: string }) =>
        `${i.path.join(".")}: ${i.message}`)
    );
  }
  const input = parsed.data;
  const opts = (body ?? {}) as Record<string, unknown>;

  resetReads();
  let t = Date.now();
  const lap = () => { const d = Date.now() - t; t = Date.now(); return d; };
  const step = async (id: StepId, detail: string) =>
    onStep({ id, label: LABEL[id], detail, ms: lap() });

  // ② 정규화 — 입력 열몇 칸을 조건 다섯 개로 줄인다
  const { cond, badges } = await normalize({
    ...input,
    listed: opts.listed as boolean | undefined,
    convertible: opts.convertible as boolean | undefined,
    grant_committed: opts.grant_committed as number | undefined,
    license_income_ttm: opts.license_income_ttm as number | undefined,
    accelerated_oncology: opts.accelerated_oncology as boolean | undefined,
    exit_point: input.exit_point,
  });

  const stages = nextInflection(input.phase, input.exit_route, {
    exit_point: input.exit_point,
    accelerated_oncology: opts.accelerated_oncology as boolean | undefined,
  }).stages;

  await step(
    "normalize",
    [
      cond.modality ?? "모달리티 미상",
      cond.disease_group ?? "질환군 미상",
      cond.phase,
      `희귀 ${cond.rare ?? "N"}`,
      cond.jurisdiction ?? "GLOBAL",
    ].join(" · ")
  );

  // ③ 꺼내기 + ④ 엔진 — 엔진이 돌면서 카드를 꺼낸다. 둘을 나눠 세지 못하므로
  //    '전체 몇 장 중 몇 장을 꺼냈는가' 를 엔진이 끝난 뒤 한 번에 보고한다.
  const patents = loadPatents(input.corp_name);

  const engines = await runEngines(cond, {
    cash: input.cash,
    monthly_burn: input.monthly_burn,
    committed_raise: input.committed_raise,
    restricted_cash: opts.restricted_cash as number | undefined,
    burn_single_month: opts.burn_single_month as boolean | undefined,
    stages,
    planned_n: (opts.planned_n as number | undefined) ?? input.n,
    backup_assets: (opts.backup_assets as string[]) ?? [],
    targets: opts.targets as never,
    corp_name: input.corp_name,
    patent_records: patents.records,
    patent_expiry_year: opts.patent_expiry_year as number | undefined,
    planned_raise_date: opts.planned_raise_date as string | undefined,
  });

  // 규칙의 applies_when 이 묻는 칸들을 모은다.
  // 화면에서 안 받은 칸은 넣지 않는다 — 추정해 채우면 거짓 판정이 된다.
  const rcrWorst = (engines.rcr.values as {
    targets?: { RCR: number }[];
  }).targets?.slice(-1)[0]?.RCR;
  const facts = factsFromInput(cond, { ...input, ...opts }, {
    rcr: rcrWorst,
    backup_n: ((opts.backup_assets as string[]) ?? []).length,
    // 국내 희귀 판정은 M02 가 만든다 — 묻지 않는다
    rare_kr: (engines.patients.values as { rare_kr?: string }).rare_kr,
  });

  const design = await matchRules("CE-04", cond, { limit: 6, facts });
  const regulatory = await matchRules("RE-02", cond, { limit: 4, facts });
  const patentRules = await matchRules("TE-02", cond, { limit: 2, facts });

  const seen = readStats().unique;
  let total: number | null = null;
  try { total = await countChunks(); } catch { /* 셀 수 없으면 분모는 생략 */ }

  await step(
    "retrieve",
    total ? `전체 ${total.toLocaleString()}장 중 조건에 맞는 ${seen.toLocaleString()}장`
          : `조건에 맞는 ${seen.toLocaleString()}장`
  );
  await step("engines", "런웨이 · 성공확률 · 기간 · 갭 · 딜 컴프 · 특허 정렬");

  // ⑤ 조립 — 문장 틀에 위 결과만 끼운다. 여기서 DB를 다시 보지 않는다.
  const board = await assemble(cond, badges, engines, {
    corp_name: input.corp_name,
    design: design.values,
    regulatory: regulatory.values,
    patentRules: patentRules.values,
  });

  const basis = [...new Set(board.cards.flatMap((c) => c.basis_chunks))];
  await step("assemble", `카드 ${board.cards.length}장 · 근거 ${basis.length}건 연결`);

  const payload: Payload = {
    run_id: (opts.run_id as string) ?? `run-${Date.now()}`,
    input: input as unknown,
    normalized: { cond, badges, stages } as unknown,
    cards: board,
    basis_chunks: basis,
    as_of: board.as_of,
    engines_blocked: engines.blocked,
  };

  // 저장이 실패해도 결과는 돌려준다 — 진단 자체가 막히면 안 된다
  try {
    await saveRun({
      run_id: payload.run_id,
      input: payload.input,
      normalized: payload.normalized,
      cards: payload.cards as unknown,
      basis_chunks: payload.basis_chunks,
      as_of: payload.as_of,
    });
  } catch (e) {
    console.error("saveRun 실패:", (e as Error).message);
  }

  return payload;
}
