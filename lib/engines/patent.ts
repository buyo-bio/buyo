/**
 * T축 엔진 — 특허
 *
 *   TE-08  특허 포트폴리오 요약 (IPC 기반)
 *   TE-09  특허 기반 모달리티 힌트
 *   TE-03  특허 만료 vs 출시 정렬
 *
 * IPC 사전(T06 설명 · T07 모달리티)은 514개인데 실제 특허의 IPC 는 그보다 잘다.
 * 예) 실제 C07K16/28(항-CLDN18.2 항체) → 사전에는 C07K16/00(항체·면역글로불린) 까지만 있다.
 * 그래서 정확 → 메인그룹 → 서브클래스 순으로 올라가며 찾고, 올라갔으면 배지를 단다.
 */
import type { Chunk, Conditions } from "../types";
import { Ctx, chunkSource, field, type EngineResult } from "./base";
import type { PatentRecord } from "../collect/kipris";

// ─────────────────────────────────────────────
// IPC 사다리
// ─────────────────────────────────────────────
export type IpcLevel = "정확" | "메인그룹" | "서브클래스";

/** C07K16/28 → ["C07K16/28", "C07K16/00", "C07K"] */
export function ipcLadder(code: string): string[] {
  const c = code.replace(/\s+/g, "").toUpperCase();
  const out = [c];
  const m = c.match(/^([A-H]\d{2}[A-Z])(\d+)\/(\d+)$/);
  if (m) {
    const main = `${m[1]}${m[2]}/00`;
    if (main !== c) out.push(main);
    out.push(m[1]);
  }
  return out;
}

export type IpcInfo = {
  ipc: string;
  matched: string | null;
  level: IpcLevel | null;
  summary: string | null;
  investor_text: string | null;
  modality_hint: string | null;
  chunk_ids: string[];
};

/** T06(설명) · T07(모달리티) 사전을 한 번만 읽어 둔다 */
async function loadIpcRegistry() {
  const src = await chunkSource();
  const rows = await src.find({}, { domain: ["T06", "T07"], kind: "mapping" });
  const t6 = new Map<string, Chunk>();
  const t7 = new Map<string, Chunk>();
  for (const c of rows) {
    const code = field(c, "ipc_code") as string | undefined;
    if (!code) continue;
    (c.domain_id === "T06" ? t6 : t7).set(code.replace(/\s+/g, ""), c);
  }
  return { t6, t7 };
}

// ─────────────────────────────────────────────
// TE-08 특허 포트폴리오 요약
//
// 강도 점수를 내지 않는다. 목록과 설명만 낸다(등록부 지시).
// ─────────────────────────────────────────────
export type IpcGroup = IpcInfo & {
  count: number;
  latest_year: number | null;
  registered: number;
  /** 등록 특허만 — 출원일 + 20년 */
  earliest_expiry: number | null;
};

export type PortfolioValues = {
  n_patents: number;
  n_registered: number;
  groups: IpcGroup[];
  /** 물질특허 후보 — 추정이며 확정이 아니다 */
  substance_candidates: string[];
  earliest_expiry_year: number | null;
  unmatched_ipc: string[];
};

/** 물질특허 후보로 볼 IPC 앞자리 (등록부 TE-08 명시) */
const SUBSTANCE_PREFIXES = ["C07K16", "C07D", "C07C", "C07K14", "C12N15"];

/** 등록 특허의 존속기간 — 출원일 + 20년 */
const PATENT_TERM_YEARS = 20;

export async function TE_08(records: PatentRecord[]): Promise<EngineResult<PortfolioValues>> {
  const ctx = new Ctx("TE-08");
  const empty: PortfolioValues = {
    n_patents: 0, n_registered: 0, groups: [],
    substance_candidates: [], earliest_expiry_year: null, unmatched_ipc: [],
  };
  if (records.length === 0)
    return ctx.none(empty, "특허 기록이 없습니다 — KIPRIS 수집을 먼저 돌리세요");

  const { t6, t7 } = await loadIpcRegistry();

  // IPC 코드별로 묶는다
  const bucket = new Map<string, PatentRecord[]>();
  for (const r of records)
    for (const ipc of r.ipc) {
      const k = ipc.replace(/\s+/g, "");
      bucket.set(k, [...(bucket.get(k) ?? []), r]);
    }

  const groups: IpcGroup[] = [];
  const unmatched: string[] = [];

  for (const [ipc, rs] of bucket) {
    let info: IpcInfo = {
      ipc, matched: null, level: null, summary: null,
      investor_text: null, modality_hint: null, chunk_ids: [],
    };

    const levels: IpcLevel[] = ["정확", "메인그룹", "서브클래스"];
    ipcLadder(ipc).some((cand, i) => {
      const d = t6.get(cand);
      if (!d) return false;
      ctx.use(d);
      const h = t7.get(cand);
      if (h) ctx.use(h);
      info = {
        ipc,
        matched: cand,
        level: levels[i],
        summary: (field(d, "pharma_summary") as string) ?? null,
        investor_text: (field(d, "investor_text") as string) ?? null,
        modality_hint: h ? ((field(h, "modality_hint") as string) ?? null) : null,
        chunk_ids: [d.chunk_id, ...(h ? [h.chunk_id] : [])],
      };
      if (i > 0) ctx.badge(`${ipc} 는 사전에 없어 ${cand}(${levels[i]}) 설명으로 표시합니다`);
      return true;
    });

    if (!info.matched) { unmatched.push(ipc); continue; }

    const years = rs.map((r) => Number(r.application_date?.slice(0, 4))).filter(Boolean);
    const regs = rs.filter((r) => r.register_status === "등록");
    const expiries = regs
      .map((r) => Number(r.application_date?.slice(0, 4)))
      .filter(Boolean)
      .map((y) => y + PATENT_TERM_YEARS);

    groups.push({
      ...info,
      count: rs.length,
      latest_year: years.length ? Math.max(...years) : null,
      registered: regs.length,
      earliest_expiry: expiries.length ? Math.min(...expiries) : null,
    });
  }

  groups.sort((a, b) => b.count - a.count);

  const substance = groups
    .filter((g) => SUBSTANCE_PREFIXES.some((p) => g.ipc.startsWith(p)))
    .map((g) => g.ipc);
  if (substance.length) ctx.badge("물질특허 후보는 IPC 기준 추정이며 확정이 아닙니다");

  if (unmatched.length)
    ctx.note(`사전에 없는 IPC ${unmatched.length}종은 설명을 붙이지 못했습니다: ${unmatched.join(", ")}`);

  const allExp = groups.map((g) => g.earliest_expiry).filter((x): x is number => x !== null);
  const regCount = records.filter((r) => r.register_status === "등록").length;

  return ctx.done({
    n_patents: records.length,
    n_registered: regCount,
    groups,
    substance_candidates: substance,
    earliest_expiry_year: allExp.length ? Math.min(...allExp) : null,
    unmatched_ipc: unmatched,
  }, unmatched.length ? "partial" : "ok");
}

// ─────────────────────────────────────────────
// TE-09 특허 기반 모달리티 힌트
//
// 화면에 "특허상 {태그}로 보입니다 — 맞으면 선택" 으로만 쓴다.
// 사용자가 확정하기 전에는 저장하지 않는다(등록부 지시).
// ─────────────────────────────────────────────
export type HintValues = {
  modality_hint: string[];
  counts: Record<string, number>;
  /** A61P 코드 — 적응증 힌트로만 */
  indication_hints: string[];
};

export async function TE_09(portfolio: PortfolioValues): Promise<EngineResult<HintValues>> {
  const ctx = new Ctx("TE-09");

  const counts: Record<string, number> = {};
  for (const g of portfolio.groups) {
    if (!g.modality_hint) continue;
    counts[g.modality_hint] = (counts[g.modality_hint] ?? 0) + g.count;
    for (const id of g.chunk_ids) ctx.use({ chunk_id: id } as Chunk);
  }

  const top = Math.max(0, ...Object.values(counts));
  // 동률이면 둘 다 낸다
  const hint = Object.entries(counts).filter(([, n]) => n === top && top > 0).map(([k]) => k);

  const indications = portfolio.groups
    .filter((g) => g.ipc.startsWith("A61P"))
    .map((g) => `${g.ipc} ${g.summary ?? ""}`.trim());

  const values: HintValues = { modality_hint: hint, counts, indication_hints: indications };

  if (hint.length === 0)
    return ctx.none(values, "특허 분류로는 약 종류를 짐작할 수 없습니다");

  ctx.badge("특허 분류에서 짐작한 값입니다 — 사용자가 확정하기 전에는 저장하지 않습니다");
  return ctx.done(values);
}

// ─────────────────────────────────────────────
// TE-03 특허 만료 vs 출시 정렬
//
//   출시 추정 = 올해 + 승인까지 기간
//   출시 시점 잔여 = 만료 연도 − 출시 추정
// 밴드 규칙(T03) 카드가 아직 없다. 그래서 판정을 내리지 않고 값만 낸다.
// ─────────────────────────────────────────────
export type AlignValues = {
  launch_year_est: number | null;
  patent_expiry_year: number | null;
  patent_life_at_launch: number | null;
  flag: "caution" | null;
  note: string | null;
};

export async function TE_03(
  _cond: Conditions,
  opts: {
    patent_expiry_year?: number | null;
    years_to_approval?: number | null;
    /** 승인까지 기간을 어느 카드에서 읽었는지 */
    basis?: string[];
  }
): Promise<EngineResult<AlignValues>> {
  const ctx = new Ctx("TE-03");
  for (const id of opts.basis ?? []) if (!ctx.basis.includes(id)) ctx.basis.push(id);
  const empty: AlignValues = {
    launch_year_est: null, patent_expiry_year: opts.patent_expiry_year ?? null,
    patent_life_at_launch: null, flag: null, note: null,
  };

  if (opts.patent_expiry_year == null)
    return ctx.none(empty, "특허 만료 연도가 없습니다");
  if (opts.years_to_approval == null)
    return ctx.none(empty, "승인까지 기간이 없어 출시 시점을 잡을 수 없습니다");

  const launch = Math.round(new Date().getFullYear() + opts.years_to_approval);
  const life = opts.patent_expiry_year - launch;

  // 5년 미만이면 주의 — 밴드 규칙 카드(T03)가 오면 이 임계값도 카드에서 읽는다
  const short = life < 5;
  if (short)
    ctx.note("T03 밴드 규칙 카드가 아직 없어 임계값 5년을 코드에 두었습니다 — 카드가 오면 옮깁니다");

  return ctx.done({
    launch_year_est: launch,
    patent_expiry_year: opts.patent_expiry_year,
    patent_life_at_launch: life,
    flag: short ? "caution" : null,
    note: short ? "독점 기간 짧음 — 존속기간 연장·데이터 보호(RE-03) 확인 필요" : null,
  });
}
