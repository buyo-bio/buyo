#!/usr/bin/env python3
"""convert_F04.py — data/F/cost_factors_master_v0_2.csv → F04 parameter 청크 (참조 구현). 값 계산·환산 없음."""
import csv, json, pathlib, re
ROOT=pathlib.Path(__file__).parent; OUT=ROOT/"out"; OUT.mkdir(exist_ok=True)
def s(v): return "" if v is None else str(v).strip()
def num(v):
    try: return float(s(v).replace(",",""))
    except: return None
DG={"전체":None,"항암":{"text":"항암","code":"MeSH:D009369"},"감염":{"text":"감염","code":"MeSH:D003141"},"중추신경(신경)":{"text":"중추신경(신경)","code":"MeSH:D009422"},"중추신경(정신)":{"text":"중추신경(정신)","code":"MeSH:D001523"},"대사·내분비":{"text":"대사·내분비","code":"MeSH:D008659|MeSH:D004700"},"심혈관":{"text":"심혈관","code":"MeSH:D002318"},"기타":{"text":"기타","code":None}}
PH={"P1":"P1","P2":"P2","P3":"P3","P3(pivotal)":"P3","P1-P3":"P1|P2|P3","all":None,"commercial":"approved","P1 진입 전":"preclinical","P2-P3":"P2|P3","NDA":"NDA"}
chunks=[]; rep={"exported":0,"skip_no_value":0,"skip_status":0}; i=0
rows=sorted(csv.DictReader(open(ROOT/"data/F/cost_factors_master_v0_2.csv",encoding="utf-8-sig")), key=lambda r: r["record_id"])
for r in rows:
    if s(r["mapping_status"]) not in ("direct","limited"): rep["skip_status"]+=1; continue
    if s(r["value"])=="": rep["skip_no_value"]+=1; continue
    i+=1; v=num(r["value"]); tier=int(float(r["trust_tier"] or 3))
    ph=PH.get(s(r["phase"]), s(r["phase"]) or None)
    text=(f"{s(r['source'])} 기준 {s(r['phase'])} {s(r['cost_kind'])} = {s(r['value'])} {s(r['unit'])} ({s(r['statistic'])}, 조건: {s(r['design_condition'])}, 치료영역: {s(r['source_ta_label'])}, 지역: {s(r['region'])}, 통화기준 {s(r['currency_year'])}, n={s(r['n']) or '미보고'}; 출처 위치 {s(r['source_page_fig'])}; 데이터 기간 {s(r['data_period'])}). {s(r['note'])}")
    chunks.append({"chunk_id":f"F04-{i:04d}","domain_id":"F04","layer":"parameter","trust_tier":tier,"evidence_tier":None,
        "temporal_validity":f"{s(r['data_period'])[:4] or '2014'}-01/{s(r['valid_until']) or '계속'}","tenant_id":"buyo_base","tenant_scope":"base","do_not_train_flag":False,
        "override_capability":"threshold_only" if tier<=2 else "fully_overridable","node_kind":"parameter","illustrative":(s(r["mapping_status"])=="limited" or s(r["source_verified"])!="primary_confirmed"),
        "product_scope":"early_biotech","jurisdiction":"KR" if s(r["region"]).startswith("KR") else "US" if s(r["region"]).startswith("US") else "GLOBAL",
        "modality":None,"indication":DG.get(s(r["buyo_disease_group"])),"phase":ph,"flag_hint":None,"probability_basis":None,
        "cost_kind":s(r["cost_kind"]),"design_condition":s(r["design_condition"]),"source_ta_label":s(r["source_ta_label"]),"statistic":s(r["statistic"]),
        "value":v if v is not None else s(r["value"]),"unit":s(r["unit"]),"currency_year":s(r["currency_year"]),"as_of":s(r["data_period"]) or s(r["currency_year"]),
        "badges":[b for b in ["industry_reference", "currency_year_mixed" if "-" in s(r["currency_year"]) else None, "secondary_summary" if s(r["source_verified"])!="primary_confirmed" else None] if b],
        "source":{"type":"report","title":s(r["source"]),"page":s(r["source_page_fig"]),"url":None},"source_record_id":s(r["record_id"]),
        "dedup_key":f"F04|{s(r['record_id'])}","text":text,"note":None})
    rep["exported"]+=1
with open(OUT/"F04_chunks_v0.jsonl","w",encoding="utf-8") as f:
    for c in chunks: f.write(json.dumps(c,ensure_ascii=False)+"\n")
print(rep)
