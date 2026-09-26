#!/usr/bin/env python3
"""convert_C.py — 과업 A·B 마스터 표 → C01~C04 청크 JSONL (참조 구현, 2026-09-21)
mapping/C_table_to_chunk.yaml의 규칙을 그대로 코드로 옮긴 것이다. 값을 계산·파생·평균하지 않는다.
사용: python3 convert_C.py  →  out/C_chunks_v0.jsonl, out/convert_report.json
"""
import csv, json, math, re, collections, pathlib

ROOT = pathlib.Path(__file__).parent
DATA = ROOT / "data" / "C"
OUT = ROOT / "out"; OUT.mkdir(exist_ok=True)

SOURCE_META = {
    "BIO 2021":   {"title": "Clinical Development Success Rates and Contributing Factors 2011–2020", "publisher": "BIO·Informa Pharma Intelligence·QLS Advisors", "year": 2021},
    "Wong 2019":  {"title": "Estimation of clinical trial success rates and related parameters (Biostatistics 20(2), corrigendum 반영)", "publisher": "Biostatistics (Oxford)", "year": 2019},
    "DiMasi 2016":{"title": "Innovation in the pharmaceutical industry: New estimates of R&D costs (J Health Econ 47)", "publisher": "Journal of Health Economics", "year": 2016},
    "Paul 2010":  {"title": "How to improve R&D productivity (Nat Rev Drug Discov 9)", "publisher": "Nature Reviews Drug Discovery", "year": 2010},
}
PHASE = {"P1":"P1","P2":"P2","P3":"P3","NDA/BLA":"NDA","Approval":"approved","APP":"approved","Preclinical":"preclinical","Submission to launch":"NDA"}
MODALITY = {"전체":None, "":None, "vaccine 후보":"vaccine"}   # v0.5: antibody_mAb·cell_CART 등 태그는 그대로 통과
DISEASE = {
    "전체":None, "":None,
    "항암":{"text":"항암","code":"MeSH:D009369"},
    "감염":{"text":"감염","code":"MeSH:D003141"},
    "중추신경(신경)":{"text":"중추신경(신경)","code":"MeSH:D009422"},
    "중추신경(정신)":{"text":"중추신경(정신)","code":"MeSH:D001523"},
    "중추신경(신경)|중추신경(정신)":{"text":"중추신경(신경)|중추신경(정신)","code":"MeSH:D009422|MeSH:D001523","multi":True},
    "대사·내분비":{"text":"대사·내분비","code":"MeSH:D008659|MeSH:D004700"},
    "심혈관":{"text":"심혈관","code":"MeSH:D002318"},
    # v0.4 잔존 라벨(있으면 pending)
    "중추신경":{"text":"중추신경","code":"MeSH:D002493","pending":"disease_group_revision"},
    "대사·심혈관":{"text":"대사·심혈관","code":None,"pending":"disease_group_revision"},
    "희귀·유전":{"text":"희귀·유전","code":None,"pending":"disease_group_revision","rare":"Y"},
}
SUBGROUP_TO_DISEASE = {"Oncology":"항암","Infectious disease":"감염","Neurology":"중추신경(신경)","Psychiatry":"중추신경(정신)","Metabolic":"대사·내분비","Endocrine":"대사·내분비","Cardiovascular":"심혈관","CNS":"중추신경(신경)|중추신경(정신)","Metabolic/Endocrinology":"대사·내분비"}
BASIS_KO = {"conditional":"조건부","cumulative":"누적"}
COMMON = {"trust_tier":2,"tenant_id":"buyo_base","tenant_scope":"base","do_not_train_flag":False,"product_scope":"both","jurisdiction":"GLOBAL","override_capability":"threshold_only","node_kind":"parameter","flag_hint":None,"evidence_tier":None}

report = collections.defaultdict(lambda: collections.Counter())
counters = collections.Counter()
def cid(domain):
    counters[domain] += 1
    return f"{domain}-{counters[domain]:04d}"
def s(v): return "" if v is None or (isinstance(v,float) and math.isnan(v)) else str(v).strip()
def num(v):
    v = s(v)
    try: return float(v)
    except ValueError: return None
def validity(data_period):
    m = re.findall(r"(\d{4})-(\d{2})-\d{2}", s(data_period))
    if len(m) < 2: return None, None, "data_period_unreported"
    start = f"{m[0][0]}-{m[0][1]}"; end_year = int(m[1][0])
    return f"{m[1][0]}-{m[1][1]}", f"{start}/{end_year+15}-12", None
def source(row, page_col, fig_col):
    meta = SOURCE_META[s(row["source"])]
    return {"type":"report", **meta, "page": s(row.get(page_col)), "figure": s(row.get(fig_col)), "subgroup": s(row.get("source_subgroup")), "url": None}
def read(name): return list(csv.DictReader(open(DATA / f"{name}.csv", encoding="utf-8-sig")))

chunks = []

# ---- C01 성공확률 ------------------------------------------------------------
for r in read("success_master"):
    ms = s(r["mapping_status"])
    if ms == "hold": report["C01"]["skip_hold"] += 1; continue
    mod_raw = s(r["buyo_modality"]); modality = MODALITY.get(mod_raw, mod_raw)
    dis = DISEASE.get(s(r["buyo_disease_group"]), None)
    if s(r["buyo_disease_group"]) not in DISEASE: report["C01"]["unknown_disease_group"] += 1; continue
    as_of, tv, badge_tv = validity(r["data_period"])
    n = num(r["reported_n"]); badges = []
    if n is not None and n < 10: badges.append("small_sample")
    if ms == "limited": badges.append("limited_mapping")
    if mod_raw == "vaccine 후보": badges.append("limited_mapping")
    if badge_tv: badges.append(badge_tv)
    pending = (dis or {}).get("pending")
    if pending: report["C01"]["pending_disease_revision"] += 1
    rare = (s(r.get("rare_flag")) or (dis or {}).get("rare") or "N")
    if s(r.get("valid_until")): tv = f"{tv.split('/')[0] if tv else s(r['data_period'])[:7]}/{s(r['valid_until'])}"
    value = round(num(r["probability"]) * 100, 1)
    text = (f"{s(r['source'])} {s(r['source_subgroup'])} 기준 {PHASE[s(r['from_phase'])]}→{PHASE[s(r['to_phase'])]} "
            f"{BASIS_KO[s(r['probability_basis'])]} 성공확률 {value}% (n={int(n) if n else '미보고'}, {s(r['n_type'])}, 데이터 기간 {s(r['data_period'])}, "
            f"{s(r['source_page'])} {s(r['source_figure_table'])}). 산출 방식: {s(r['calculation_method'])}. "
            f"모집단: {s(r['source_scope_note'])} 해석: {s(r['interpretation_note'])}")
    chunks.append({"chunk_id": cid("C01"), "domain_id":"C01", "layer":"parameter", **COMMON,
        "illustrative": ms == "limited" or mod_raw == "vaccine 후보",
        "modality": modality, "indication": ({k:v for k,v in dis.items() if k in ("text","code")} if dis else None),
        "rare": rare, "rare_scope": s(r.get("oncology_scope")) or None, "indication_multi": bool((dis or {}).get("multi")), "display_role_draft": s(r.get("display_role_draft")) or None, "pending": pending,
        "phase": PHASE[s(r["from_phase"])], "phase_to": PHASE[s(r["to_phase"])],
        "value": value, "unit": "%", "probability_basis": s(r["probability_basis"]), "reported_n": n,
        "badges": badges, "as_of": as_of, "temporal_validity": tv,
        "source": source(r, "source_page", "source_figure_table"), "source_record_id": s(r["record_id"]),
        "dedup_key": f"C01|{s(r['source'])}|{s(r['source_subgroup'])}|{s(r['from_phase'])}|{s(r['to_phase'])}|{s(r['probability_basis'])}",
        "text": text, "note": s(r["discrepancy_note"]) or None})
    report["C01"]["exported"] += 1

# ---- C02 기간 ---------------------------------------------------------------
for r in read("duration_master"):
    ms = s(r["mapping_status"]); vt = s(r["duration_value_type"])
    if ms == "hold": report["C02"]["skip_hold"] += 1; continue
    if vt not in ("single", "sum_of_phase_means"): report["C02"][f"skip_{vt}"] += 1; continue
    if s(r["from_phase"]) and s(r["to_phase"]): fp, tp = s(r["from_phase"]), s(r["to_phase"])
    elif s(r["phase"]) in PHASE: fp, tp = s(r["phase"]), None            # Wong 개별 시험 기간: 해당 단계 내 시험 1건
    else: fp, tp = "P1", "Approval"                                        # BIO 총기간 지표 행
    dkey = SUBGROUP_TO_DISEASE.get(s(r["source_subgroup"]))
    dis = DISEASE.get(dkey) if dkey else None
    as_of, tv, badge_tv = validity(r["data_period"]); n = num(r["reported_n"])
    if s(r.get("valid_until")): tv = f"{tv.split('/')[0] if tv else s(r['data_period'])[:7]}/{s(r['valid_until'])}"
    badges = [b for b in ["limited_mapping" if ms=="limited" else None, badge_tv, "small_sample" if (n is not None and n < 10) else None, "sum_of_phase_means" if vt=="sum_of_phase_means" else None] if b]
    unit = {"년":"years","개월":"months"}[s(r["unit"])]
    text = (f"{s(r['source'])} {s(r['source_subgroup'])} 기준 {PHASE[fp]}{('→'+PHASE[tp]) if tp else ' 단계 시험 1건'} 소요 기간 {s(r['duration_value'])}{'년' if unit=='years' else '개월'} "
            f"({s(r['statistic'])}, n={int(n) if n else '미보고'}, 데이터 기간 {s(r['data_period'])}). 정의: {s(r['duration_definition'])} 모집단: {s(r['population'])}")
    chunks.append({"chunk_id": cid("C02"), "domain_id":"C02", "layer":"parameter", **COMMON, "illustrative": ms=="limited",
        "modality": None, "indication": ({k:v for k,v in dis.items() if k in ("text","code")} if dis else None), "pending": (dis or {}).get("pending"),
        "phase": PHASE[fp], "phase_to": PHASE[tp] if tp else None,
        "value": num(r["duration_value"]), "value_min": num(r["duration_min"]), "value_max": num(r["duration_max"]), "unit": unit,
        "statistic": s(r["statistic"]), "duration_kind": "program_phase_transition" if s(r["source"])=="BIO 2021" else "single_trial",
        "reported_n": n, "badges": badges, "as_of": as_of, "temporal_validity": tv,
        "source": source(r, "source_page", "source_figure_table"), "source_record_id": s(r["record_id"]),
        "dedup_key": f"C02|{s(r['source'])}|{s(r['source_subgroup'])}|{fp}|{tp}|{s(r['statistic'])}",
        "text": text, "note": s(r["note"]) or None})
    report["C02"]["exported"] += 1

# ---- C03 비용 ---------------------------------------------------------------
for r in read("cost_master"):
    bs = s(r["benchmark_status"])
    if bs == "reference_only": report["C03"]["skip_reference_only"] += 1; continue
    role = {"pending_policy": ("default" if s(r["statistic"])=="weighted_mean" else "secondary"), "no":"none"}.get(s(r["default_candidate"]), s(r["default_candidate"]))
    badges = ["industry_reference"] + (["base_year_unreported"] if s(r["base_year_status"])=="not_reported_in_original" else [])
    by = s(r["base_year"]); by_ko = f"{by[:4]}년 불변 달러" if by else "기준연도 미보고"
    text = (f"{s(r['source'])} 기준 {PHASE[s(r['phase'])]} 단계 비용 {s(r['cost_value'])} 백만 달러 ({s(r['statistic'])}, {by_ko}, n={s(r['n']) or '미보고'}). "
            f"정의: {s(r['cost_definition'])} 범위: {s(r['cost_scope'])} 해석: {s(r['interpretation_note'])}")
    chunks.append({"chunk_id": cid("C03"), "domain_id":"C03", "layer":"parameter", **COMMON, "illustrative": bs=="limited_benchmark",
        "modality": None, "indication": None, "phase": PHASE[s(r["phase"])], "phase_to": None,
        "value": num(r["cost_value"]), "unit": "USD_million", "base_year": int(float(by)) if by else None, "statistic": s(r["statistic"]),
        "default_role": role, "badges": badges, "as_of": (by[:4]+"-12") if by else None, "temporal_validity": "2013-01/계속",
        "conversion": {"cost_value_current": None, "conversion_index": "BRDPI", "conversion_base_date": None, "conversion_factor": None, "conversion_updated": None},
        "source": source(r, "source_page", "source_table_figure"), "source_record_id": s(r["record_id"]),
        "dedup_key": f"C03|{s(r['source'])}|{s(r['phase'])}|{s(r['statistic'])}", "text": text, "note": s(r["discrepancy_note"]) or None})
    report["C03"]["exported"] += 1

# ---- C04 규칙: F 주의목록 + E 대표 결정 ---------------------------------------
RULE_COMMON = {"tenant_id":"buyo_base","tenant_scope":"base","do_not_train_flag":False,"product_scope":"both","jurisdiction":"GLOBAL","node_kind":"handling_rule","flag_hint":"neutral","evidence_tier":None,"modality":None,"indication":None,"phase":None,"illustrative":False,"temporal_validity":"2026-09/계속"}
for r in read("cautions"):
    src = s(r["출처"]); meta = SOURCE_META.get(src)
    text = f"[{s(r['구분'])}] {src} — {s(r['대상'])}: {s(r['처리 원칙'])}" + (f" (채택값: {s(r['채택값'])})" if s(r['채택값']) not in ("", "—") else "") + (f" (다른 위치·값: {s(r['다른 원문 위치·값'])})" if s(r['다른 원문 위치·값']) not in ("", "—") else "")
    chunks.append({"chunk_id": cid("C04"), "domain_id":"C04", "layer":"rule", "trust_tier":2, "override_capability":"immutable", **RULE_COMMON,
        "source": ({"type":"report", **meta, "url":None} if meta else {"type":"internal_principle","title":"과업 A·B 통합본 F 시트(공통)","publisher":"BUYO","year":2026}),
        "source_record_id": f"F:{s(r['구분'])}|{s(r['대상'])}", "dedup_key": f"C04|F|{s(r['구분'])}|{s(r['대상'])}", "text": text, "note": None})
    report["C04"]["cautions_exported"] += 1
for r in read("decisions"):
    if not s(r["상태"]).startswith(("decided","founder_opinion")): report["C04"]["decision_skipped_undecided"] += 1; continue
    provisional = s(r["상태"]).startswith("founder_opinion") or "대기" in s(r["상태"]) or "보류" in s(r["상태"])
    text = f"[대표 결정 {s(r['번호'])}] {s(r['결정 사항'])}: {s(r['결정'])}"
    chunks.append({"chunk_id": cid("C04"), "domain_id":"C04", "layer":"rule", "trust_tier":3, "override_capability":"fully_overridable", **RULE_COMMON, "illustrative": provisional,
        "source": {"type":"internal_decision","title":f"과업 A·B 통합본 v0.4 E 시트 결정 {s(r['번호'])}","publisher":"BUYO","year":2026, "status": s(r["상태"])},
        "source_record_id": f"E:{s(r['번호'])}", "dedup_key": f"C04|E|{s(r['번호'])}", "text": text, "note": None})
    report["C04"]["decisions_exported"] += 1

# ---- 검증(간이 validate v2) --------------------------------------------------
LAYERS = {"screening","valuation","scoring","parameter","variable","method","source","mapping","rule","manifest"}
errors = []
seen = set()
for c in chunks:
    for k in ("domain_id","layer","trust_tier","temporal_validity","tenant_id","tenant_scope","do_not_train_flag"):
        if c.get(k) in (None, ""): errors.append((c["chunk_id"], f"missing_{k}"))
    if c["layer"] not in LAYERS: errors.append((c["chunk_id"], "bad_layer"))
    if c["layer"] == "parameter" and (c.get("value") is None or not c.get("unit") or not c.get("source_record_id")): errors.append((c["chunk_id"], "parameter_incomplete"))
    if c["layer"] == "parameter" and "%" in c["unit"] and not c.get("probability_basis"): errors.append((c["chunk_id"], "missing_probability_basis"))
    if c["dedup_key"] in seen: errors.append((c["chunk_id"], "duplicate"))
    seen.add(c["dedup_key"])
    if c["trust_tier"] == 1 and c["override_capability"] != "immutable": errors.append((c["chunk_id"], "tier1_not_immutable"))

with open(OUT / "C_chunks_v1.jsonl", "w", encoding="utf-8") as f:
    for c in chunks: f.write(json.dumps(c, ensure_ascii=False) + "\n")
rep = {"total_chunks": len(chunks), "by_domain": dict(counters), "detail": {k: dict(v) for k, v in report.items()},
       "validate_errors": errors, "mvp_index_eligible": sum(1 for c in chunks if not c.get("pending"))}
json.dump(rep, open(OUT / "convert_report.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print(json.dumps(rep, ensure_ascii=False, indent=1))
