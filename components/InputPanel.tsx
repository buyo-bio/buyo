"use client";
import { MODALITY_OPTIONS } from "@/lib/modality-options";
import { DEMO_CASES, missingRequired, type DemoKey, type DiagnoseForm } from "@/lib/demo-cases";

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

            <div className="field" style={{ gridColumn: "1/-1" }}>
              <label htmlFor="indication"><span className="req">*</span> 적응증</label>
              <input id="indication" list="ind-list" autoComplete="off"
                placeholder="질환명을 입력하세요" value={form.indication}
                onChange={(e) => set("indication", e.target.value)} />
              <datalist id="ind-list">
                <option value="진행성·전이성 고형암" />
                <option value="비소세포폐암" />
                <option value="특발성 폐섬유증" />
                <option value="만성 이식편대숙주질환" />
              </datalist>
              <span className="hint">코드는 진단할 때 붙습니다</span>
            </div>

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
                <option>단일군</option><option>위약 대조</option><option>실약 대조</option>
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
            : "필수 3항목이 모두 채워졌습니다"}
        </p>
      </div>
    </aside>
  );
}
