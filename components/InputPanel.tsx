"use client";
import { MODALITY_OPTIONS } from "@/lib/modality-options";
import IndicationPicker, { DISEASE_GROUPS } from "./IndicationPicker";
import { DEMO_CASES, missingRequired, type DemoKey, type DiagnoseForm } from "@/lib/demo-cases";
import { JUDGE_FIELDS, type JudgeField } from "@/lib/judge-fields";

const PHASES: [string, string][] = [
  ["preclinical", "비임상"], ["P1", "임상 1상"], ["P2", "임상 2상"],
  ["P3", "임상 3상"], ["NDA", "허가 신청"],
];

/** 등록부를 그대로 쓰되, 하위 태그는 부모 아래로 묶어 보여준다 */
function grouped() {
  const tops = MODALITY_OPTIONS.filter((o) => !o.parent);
  return tops.map((t) => ({
    top: t,
    kids: MODALITY_OPTIONS.filter((o) => o.parent === t.tag),
  }));
}

/**
 * 자기신고 칸 하나.
 *
 * 첫 선택지는 언제나 "고르지 않음"(빈 글자)이다.
 * 고르지 않으면 넘기지 않고, 화면에는 "적으면 판정할 수 있습니다" 로 나간다.
 * 안 고른 것을 "아니오" 로 보내면 제도가 해당 없다고 단정하게 된다.
 */
function JudgeSelect({
  f, value, onSet,
}: { f: JudgeField; value: string; onSet: (v: string) => void }) {
  return (
    <div className="field">
      <label htmlFor={`j-${f.key}`}>{f.label}</label>
      <select id={`j-${f.key}`} value={value ?? ""} onChange={(e) => onSet(e.target.value)}>
        <option value="">고르지 않음</option>
        {f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {f.hint ? <span className="hint">{f.hint}</span> : null}
    </div>
  );
}

export default function InputPanel({
  form, onChange, onRun, busy, demo, onDemo,
}: {
  form: DiagnoseForm;
  onChange: (f: DiagnoseForm) => void;
  onRun: () => void;
  busy: boolean;
  demo: DemoKey | null;
  onDemo: (k: DemoKey) => void;
}) {
  const set = <K extends keyof DiagnoseForm>(k: K, v: DiagnoseForm[K]) =>
    onChange({ ...form, [k]: v });

  const setJudge = (k: string, v: string) =>
    onChange({ ...form, judge: { ...form.judge, [k]: v } });

  const judgeOf = (g: JudgeField["group"]) => JUDGE_FIELDS.filter((f) => f.group === g);
  const judgeBlank = JUDGE_FIELDS.filter((f) => !form.judge?.[f.key]).length;

  const missing = missingRequired(form);
  const picked = MODALITY_OPTIONS.find((o) => o.tag === form.modality);

  return (
    <aside className="side">
      <div className="side-head">
        <h1>사업성 진단</h1>
        <p>필수 3항목만 채우면 시작할 수 있습니다</p>
      </div>

      <div className="side-body">
        <div className="demo">
          {(Object.keys(DEMO_CASES) as DemoKey[]).map((k) => (
            <button key={k} type="button" aria-pressed={demo === k} onClick={() => onDemo(k)}>
              {DEMO_CASES[k].label}
            </button>
          ))}
        </div>

        <div className="group">
          <h2>파이프라인</h2>
          <div className="g2">
            <div className={`field${!form.modality ? "" : ""}`} style={{ gridColumn: "1/-1" }}>
              <label htmlFor="modality"><span className="req">*</span> 모달리티</label>
              <select id="modality" value={form.modality}
                onChange={(e) => set("modality", e.target.value)}>
                <option value="">선택</option>
                {grouped().map(({ top, kids }) =>
                  kids.length === 0 ? (
                    <option key={top.tag} value={top.tag}>{top.label}</option>
                  ) : (
                    <optgroup key={top.tag} label={top.label}>
                      <option value={top.tag}>{top.label}</option>
                      {kids.map((k) => (
                        <option key={k.tag} value={k.tag}>{k.label}</option>
                      ))}
                    </optgroup>
                  )
                )}
              </select>
              <span className="hint">
                T01 등록부 {MODALITY_OPTIONS.length}종
                {picked && !picked.hasValue ? ` · ${picked.status}` : ""}
              </span>
            </div>

            <IndicationPicker
              value={form.indication}
              picked={form.picked}
              onPick={(text, p) => onChange({ ...form, indication: text, picked: p })}
            />

            {/* 목록에서 고르지 않았으면 질환군을 직접 받는다 — 막지 않는다(9/27 지시 4항) */}
            {form.indication.trim() && !form.picked ? (
              <div className="field" style={{ gridColumn: "1/-1" }}>
                <label htmlFor="dgroup">질환군</label>
                <select
                  id="dgroup"
                  value={form.picked ? "" : form.manual_group}
                  onChange={(e) =>
                    onChange({
                      ...form,
                      manual_group: e.target.value,
                      picked: e.target.value
                        ? { code: null, disease_group: e.target.value, therapeutic_area: null,
                            query_en: null, rare: form.manual_rare, layer: null }
                        : null,
                    })
                  }
                >
                  <option value="">고르지 않음 — 전체 기준으로 조회</option>
                  {DISEASE_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
                <span className="hint">목록에 없는 병이면 질환군만 골라도 카드가 돕니다</span>
              </div>
            ) : null}

            <div className="field">
              <label htmlFor="phase"><span className="req">*</span> 개발 단계</label>
              <select id="phase" value={form.phase} onChange={(e) => set("phase", e.target.value)}>
                <option value="">선택</option>
                {PHASES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>

            <div className="field">
              <label htmlFor="exit">출구 경로</label>
              <select id="exit" value={form.exit_route}
                onChange={(e) => set("exit_route", e.target.value as DiagnoseForm["exit_route"])}>
                <option value="license_out">기술이전</option>
                <option value="self_develop">자체 개발</option>
              </select>
            </div>
          </div>
        </div>

        <div className="group">
          <h2>설계안</h2>
          <div className="g2">
            <div className="field">
              <label htmlFor="ep">1차 평가변수</label>
              <input id="ep" value={form.endpoint} onChange={(e) => set("endpoint", e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="comp">대조군</label>
              <select id="comp" value={form.comparator} onChange={(e) => set("comparator", e.target.value)}>
                <option value="">고르지 않음</option>
                <option value="single_arm">단일군</option>
                <option value="placebo">위약 대조</option>
                <option value="active">실약 대조</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="n">목표 대상자 수</label>
              <input id="n" inputMode="numeric" value={form.n} onChange={(e) => set("n", e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="dur">예상 기간 (개월)</label>
              <input id="dur" inputMode="numeric" value={form.duration_m}
                onChange={(e) => set("duration_m", e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="pen">1차 평가변수 개수</label>
              <input id="pen" inputMode="numeric" value={form.primary_endpoints_n}
                onChange={(e) => set("primary_endpoints_n", e.target.value)} />
              <span className="hint">둘 이상이면 다중성 보정 계획을 함께 봅니다</span>
            </div>
            {judgeOf("design").map((f) => (
              <JudgeSelect key={f.key} f={f} value={form.judge?.[f.key] ?? ""}
                onSet={(v) => setJudge(f.key, v)} />
            ))}
          </div>
        </div>

        <div className="group">
          <h2>규제·판정</h2>
          <p className="tip" style={{ margin: "0 0 10px" }}>
            제도 해당 여부를 가르는 칸입니다. 고르지 않으면 그 제도는
            &ldquo;적으면 판정할 수 있습니다&rdquo;로 남습니다 — 해당 없음으로 단정하지 않습니다.
          </p>
          <div className="g2">
            {judgeOf("regulatory").map((f) => (
              <JudgeSelect key={f.key} f={f} value={form.judge?.[f.key] ?? ""}
                onSet={(v) => setJudge(f.key, v)} />
            ))}
          </div>
        </div>

        <div className="group">
          <h2>재무 (억 원)</h2>
          <div className="g2">
            <div className="field">
              <label htmlFor="cash">현금</label>
              <input id="cash" inputMode="numeric" value={form.cash}
                onChange={(e) => set("cash", e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="burn">월 소진액</label>
              <input id="burn" inputMode="numeric" value={form.monthly_burn}
                onChange={(e) => set("monthly_burn", e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="committed">확정 조달</label>
              <input id="committed" inputMode="numeric" value={form.committed_raise}
                onChange={(e) => set("committed_raise", e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="planned">예정 조달</label>
              <input id="planned" inputMode="numeric" value={form.planned_raise}
                onChange={(e) => set("planned_raise", e.target.value)} />
            </div>
          </div>
        </div>

        <p className="tip">
          런웨이는 현금과 확정 조달만 더해 계산합니다. 예정 조달은 넣지 않습니다.
          필요 자금은 원문 통화(달러)로 표시하며 원화 환산은 하지 않습니다.
        </p>
      </div>

      <div className="side-foot">
        <button className="go" onClick={onRun} disabled={busy || missing.length > 0}>
          {busy ? "진단 중…" : "진단 시작"}
        </button>
        <p className={`go-why${missing.length ? " warn" : ""}`}>
          {missing.length
            ? `${missing.join(" · ")} 를 채워 주세요`
            : judgeBlank > 0
              ? `지금도 진단할 수 있습니다 — 판정 칸 ${judgeBlank}개를 더 고르면 제도 판정이 늘어납니다`
              : "필수 3항목이 모두 채워졌습니다"}
        </p>
      </div>
    </aside>
  );
}
