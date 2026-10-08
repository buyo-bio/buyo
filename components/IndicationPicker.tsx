"use client";
/**
 * 적응증 자동완성
 *
 * 왜 필요한가
 *   예전에는 화면에 적응증 4개만 떴다. 자동완성 목록을 "청크에 있는 적응증"에서
 *   뽑았는데 청크에는 질환군 7개만 있었기 때문이다("당뇨 → 질환군 미상"도 같은 이유).
 *   이제 적응증 마스터에서 뽑는다 — 1층 216개 → 2층 KCD 14,590개 순으로 찾는다.
 *
 * 고르면 따라오는 것: 질환군 · 세부 치료영역 · 희귀 힌트 · CT.gov 조회어
 * 안 고르고 그냥 적어도 막지 않는다. 질환군만 직접 고르면 된다.
 */
import { useEffect, useRef, useState } from "react";
import type { PickedIndication } from "@/lib/demo-cases";
import { DISEASE_GROUPS as ENUM_GROUPS } from "@/lib/enums";

type Item = {
  layer: 1 | 2;
  code: string | null;
  name_ko: string;
  buyo_disease_group: string | null;
  therapeutic_area: string | null;
  rare_hint: string | null;
  flag: string | null;
  query_en: string | null;
  match_type: string;
};

/** 질환군 — enums_v1.json 이 정본. "전체"는 사용자가 고를 값이 아니라 빼 둔다 */
export const DISEASE_GROUPS = ENUM_GROUPS.filter((g) => g !== "전체");

/** 1층은 MeSH, 2층은 KCD 코드를 쓴다 */
function codeOf(it: Item): string | null {
  if (it.layer === 2) return it.code ? `KCD:${it.code}` : null;
  // 1층 code 칸은 icd10 이다. MeSH 는 query_en 과 함께 서버가 보내지 않으므로
  // 여기서는 icd10 을 그대로 쓴다(진단 조회는 질환군·치료영역으로 돈다).
  return it.code ? `ICD10:${it.code}` : null;
}

export default function IndicationPicker({
  value, picked, onPick,
}: {
  value: string;
  picked: PickedIndication | null;
  onPick: (text: string, p: PickedIndication | null) => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const box = useRef<HTMLDivElement>(null);

  // 글자를 칠 때마다 부르면 요청이 쏟아진다. 200ms 쉬었을 때만 부른다.
  useEffect(() => {
    const q = value.trim();
    if (picked || q.length < 2) { setItems([]); return; }

    let dead = false;
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/autocomplete?q=${encodeURIComponent(q)}`);
        const j = await r.json();
        if (!dead) { setItems(j.items ?? []); setOpen(true); setCursor(-1); }
      } catch {
        if (!dead) setItems([]);
      } finally {
        if (!dead) setBusy(false);
      }
    }, 200);

    return () => { dead = true; clearTimeout(t); setBusy(false); };
  }, [value, picked]);

  // 바깥을 누르면 닫는다
  useEffect(() => {
    function away(e: MouseEvent) {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);

  function choose(it: Item) {
    onPick(it.name_ko, {
      code: codeOf(it),
      disease_group: it.buyo_disease_group,
      therapeutic_area: it.therapeutic_area,
      query_en: it.query_en,
      // 1층은 힌트가 있고(Y/Y?/N), 2층은 사용자가 고른다. Y? 는 아직 N 으로 두고 배지로 알린다.
      rare: it.rare_hint === "Y" ? "Y" : "N",
      layer: it.layer,
    });
    setOpen(false);
  }

  function keys(e: React.KeyboardEvent) {
    if (!open || items.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => (c + 1) % items.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => (c - 1 + items.length) % items.length); }
    else if (e.key === "Enter" && cursor >= 0) { e.preventDefault(); choose(items[cursor]); }
    else if (e.key === "Escape") setOpen(false);
  }

  return (
    <div className="field ind" ref={box} style={{ gridColumn: "1/-1" }}>
      <label htmlFor="indication">
        적응증
        <span className={`tag-req${value.trim() ? " done" : ""}`}>
          {value.trim() ? "필수 ✓" : "필수"}
        </span>
      </label>

      <div className="ind-input">
        <input
          id="indication" autoComplete="off" placeholder="질환명을 입력하세요"
          value={value}
          onChange={(e) => onPick(e.target.value, null)}
          onFocus={() => items.length && setOpen(true)}
          onKeyDown={keys}
          aria-expanded={open} aria-autocomplete="list"
        />
        {busy ? <span className="spin ind-spin" /> : null}
      </div>

      {open && items.length > 0 ? (
        <ul className="ind-list" role="listbox">
          {items.map((it, i) => (
            <li key={`${it.layer}-${it.code}-${it.name_ko}`}>
              <button
                type="button" role="option" aria-selected={i === cursor}
                className={i === cursor ? "on" : ""}
                onMouseEnter={() => setCursor(i)}
                onClick={() => choose(it)}
              >
                <span className="ind-name">{it.name_ko}</span>
                <span className="ind-meta">
                  {it.buyo_disease_group ?? "질환군 미정"}
                  {it.layer === 2 ? ` · KCD ${it.code}` : ""}
                  {it.rare_hint === "Y" ? " · 희귀" : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {/* 고른 뒤 — 무엇이 붙었는지 보여 준다 */}
      {picked ? (
        <div className="ind-picked">
          <span className="pill sm">{picked.disease_group ?? "질환군 미정"}</span>
          {picked.therapeutic_area ? <span className="pill sm">{picked.therapeutic_area}</span> : null}
          {picked.rare === "Y" ? <span className="pill sm warn">희귀</span> : null}
          <button type="button" className="ind-clear" onClick={() => onPick(value, null)}>
            다시 고르기
          </button>
        </div>
      ) : value.trim().length >= 2 ? (
        <span className="hint">목록에서 고르면 질환군·치료영역이 자동으로 붙습니다</span>
      ) : (
        <span className="hint">두 글자부터 찾습니다</span>
      )}
    </div>
  );
}
