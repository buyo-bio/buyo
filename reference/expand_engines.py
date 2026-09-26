#!/usr/bin/env python3
"""expand_engines.py — engines_registry.yaml → (1) F07 method 청크, (2) 엔진×모달리티×단계 커버리지 표, (3) 파라미터 갭 보고
파라미터 확보 상태(PARAM_STATUS)는 오늘 기준 손으로 적은 것이며, 도메인별 청크가 export되면 자동으로 읽도록 바꾼다."""
import yaml, json, csv, re, pathlib, collections
R = yaml.safe_load(open("engines_registry.yaml", encoding="utf-8"))
OUT = pathlib.Path("out"); OUT.mkdir(exist_ok=True)
# 파라미터 도메인별 확보 상태 (2026-09-22)
PARAM_STATUS = {
 "C01":"ready(v0.5, 질환군 개정 반영, pending 0)", "C02":"ready(v0.4)", "C03":"ready(v0.5, default 확정, BRDPI 값 대기)", "C05":"formal(설계 modifier 미작성)",
 "F01":"pending(대표 작성 9/23)", "F02":"retag(구 F-D14·F-D05 워터폴·전환 규칙)", "F03":"retag(구 F-VAL-004 할인율, 113 침식, 114 마진, 117 로열티, 124·125 하방·플랫폼)",
 "F04":"ready(v0.2 241행 청크화, 국내 단가·모달리티 계수·CMC는 미확보)", "F05":"retag(구 F-D10 관리종목·기술특례 규칙)", "F06":"missing(비교군 선정·EV 브리지·공시 파싱 규칙 — 대표 작성)",
 "M01":"partial(M-D01 약가·급여 완료분 재태깅, 일회성·입찰·희귀 프리미엄 없음)", "M02":"missing(역학 표, 승현 9/26)", "M03":"partial(T-SD5 20청크 재태깅, DART 딜 파싱은 정식)", "M04":"missing(점유·램프·침식·경쟁 프리셋)",
 "R01":"pending(마스터 md 생성 9/25)", "R02":"pending(교안 기반 illustrative, 법령 확인 후 tier1)", "R03":"missing(심사 기간 표)", "R04":"formal(대리 평가변수 전례 표)", "R05":"formal", "T01":"pending(대표 9/23)", "T02":"pending(마스터 md 생성 9/25)", "T03":"formal(특허 만료 입력값만)", "T04":"pending(대표 9/23)", "T05":"formal(구 T-SD6 재태깅)", "N01":"formal", "C04":"ready(v0.4, 설계 플래그 규칙 3개는 9/25 추가)"}
def dom(p): return p.split(":")[0].strip()
chunks=[]; cov=[]; gaps=collections.defaultdict(set); n=0; cnt={}
def status_of(e):
    blocked=[]
    for p in e.get("params",[]):
        st=PARAM_STATUS.get(dom(p),"unknown")
        if not st.startswith("ready"): blocked.append(f"{dom(p)}[{st.split('(')[0]}]")
    return blocked
for e in R["engines"]:
    n+=1; blocked=status_of(e)
    for p in e.get("params",[]):
        if not PARAM_STATUS.get(dom(p),"").startswith("ready"): gaps[dom(p)].add(e["id"])
    text=(f"[{e['id']} {e['name']}] 질문: {e['question']} 입력: {', '.join(e['inputs'])}. 산식: {e['formula'].strip()} "
          f"출력: {', '.join(e['outputs'])}. 파라미터 출처: {', '.join(e.get('params',[])) or '없음'}. "
          f"적용 조건: {json.dumps(e.get('applies_when',{}),ensure_ascii=False) or '전체'}. 미확보 시: 해당 항을 '미확보'로 표시하고 부분 결과만 낸다.")
    DOM={"FE":"F07","CE":"C06","ME":"M06","RE":"R06","TE":"T05","NE":"N02"}; d=DOM[e["id"][:2]]; cnt[d]=cnt.get(d,0)+1
    chunks.append({"chunk_id":f"{d}-{cnt[d]:04d}","domain_id":d,"layer":"method","trust_tier":3,"evidence_tier":None,"temporal_validity":"2026-09/계속",
        "tenant_id":"buyo_base","tenant_scope":"base","do_not_train_flag":False,"override_capability":"fully_overridable","node_kind":"engine_definition",
        "illustrative":e["status"]!="ready","product_scope":"early_biotech","jurisdiction":"GLOBAL","modality":None,"indication":None,"phase":None,
        "flag_hint":None,"probability_basis":None,"engine_id":e["id"],"engine_group":e["group"],"mvp":e["mvp"],"engine_status":e["status"],
        "blocked_by":blocked,"source":{"type":"internal_spec","title":"engines_registry.yaml v1.0","publisher":"BUYO","year":2026},
        "source_record_id":f"ENG:{e['id']}","dedup_key":f"F07|{e['id']}","text":text})
    for ov in e.get("overrides",[]):
        n+=1
        cnt[d]+=1; chunks.append({**chunks[-1],"chunk_id":f"{d}-{cnt[d]:04d}","engine_id":ov["id"],"node_kind":"engine_override","source_record_id":f"ENG:{ov['id']}","dedup_key":f"F07|{ov['id']}",
            "text":f"[{ov['id']} {ov.get('name',e['name']+' 변형')}] {e['id']}의 변형. 적용 조건: {json.dumps(ov.get('applies_when'),ensure_ascii=False)}. 산식: {ov['formula'].strip()} 파라미터 출처: {', '.join(ov.get('params',[])) or e.get('params',[])}"})
    # coverage: engine × modality × phase
    aw=e.get("applies_when",{})
    for m in R["dimensions"]["modality"]:
        for ph in R["dimensions"]["phase"]:
            if aw.get("modality") and m not in aw["modality"]: continue
            ov=[o["id"] for o in e.get("overrides",[]) if m in (o.get("applies_when",{}).get("modality") or [m])] if e.get("overrides") else []
            cov.append({"engine":e["id"],"group":e["group"],"modality":m,"phase":ph,"variant":(ov[0] if ov else e["id"]),
                        "mvp":e["mvp"],"status":e["status"],"blocked_by":";".join(blocked)})
with open(OUT/"F07_method_chunks_v0.jsonl","w",encoding="utf-8") as f:
    for c in chunks: f.write(json.dumps(c,ensure_ascii=False)+"\n")
with open(OUT/"engine_coverage.csv","w",encoding="utf-8-sig",newline="") as f:
    w=csv.DictWriter(f,fieldnames=list(cov[0].keys())); w.writeheader(); w.writerows(cov)
with open(OUT/"param_gaps.md","w",encoding="utf-8") as f:
    f.write("# 파라미터 갭 보고 (engines_registry v1.0, 2026-09-22)\n\n| 파라미터 도메인 | 상태 | 의존 엔진 |\n|---|---|---|\n")
    for d,es in sorted(gaps.items()): f.write(f"| {d} | {PARAM_STATUS.get(d,'unknown')} | {', '.join(sorted(es))} |\n")
    ready=[e["id"] for e in R["engines"] if e["status"]=="ready"]; mvp=[e["id"] for e in R["engines"] if e["mvp"]]
    f.write(f"\n- 엔진 {len(R['engines'])}개 + 변형 {sum(len(e.get('overrides',[])) for e in R['engines'])}개, method 청크 {len(chunks)}개\n- 오늘 실행 가능(ready): {', '.join(ready)}\n- MVP 지정: {', '.join(mvp)}\n- MVP인데 blocked: {', '.join(e['id'] for e in R['engines'] if e['mvp'] and e['status']!='ready')}\n")
print(json.dumps({"engines":len(R["engines"]),"chunks":len(chunks),"coverage_rows":len(cov),"ready":[e["id"] for e in R["engines"] if e["status"]=="ready"],"mvp_blocked":[e["id"] for e in R["engines"] if e["mvp"] and e["status"]!="ready"]},ensure_ascii=False,indent=1))
