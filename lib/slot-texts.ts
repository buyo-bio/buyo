/**
 * 화면 자리 문장 틀 — data/ref/slot_texts.json (37개)
 *
 * 계산값이 들어가는 문장은 우리가 짓지 않는다. 대표님이 적어 둔 틀의 빈칸에
 * 엔진이 낸 값을 끼운다. 틀이 바뀌면 코드는 안 고쳐도 된다.
 *
 * 작업대 build/conv_display.py 의 josa()·fill() 과 같게 움직인다.
 */
import slotTexts from "../data/ref/slot_texts.json";

export type SlotText = {
  slot: string;
  card: string;
  when: string;
  sentence: string;
  meaning: string;
  fill: string;
  note?: string;
};

const BY_SLOT = new Map<string, SlotText>(
  (slotTexts as SlotText[]).map((t) => [t.slot, t])
);

export function slotText(id: string): SlotText | undefined {
  return BY_SLOT.get(id);
}

/** 그 자리에 어떤 빈칸이 필요한지 — fill 칸을 쪼갠다 */
export function slotFields(id: string): string[] {
  const t = BY_SLOT.get(id);
  if (!t?.fill) return [];
  return t.fill.split(",").map((x) => x.trim()).filter(Boolean);
}

/**
 * 조사 — 값의 마지막 한글 글자 받침으로 고른다.
 *
 * 괄호·따옴표가 뒤에 붙어 있으면 건너뛴다. "시험 목적(…탐색)" 의 끝은
 * ')' 가 아니라 '색' 이다.
 *
 * "로" 만 규칙이 다르다 — 받침이 없거나 ㄹ 받침이면 "로", 그 밖에는 "으로".
 */
export function josa(value: string, kind: string): string {
  const m = /[가-힣](?=[^가-힣]*$)/.exec(value.trim());

  // 한글로 끝나지 않으면(숫자·영문) 받침 없는 것으로 본다 — 완벽하진 않다.
  // 숫자를 읽는 소리까지 따지려면 표가 필요하고, 대표님 틀에는 그런 자리가 없다.
  const jong = m ? (m[0].charCodeAt(0) - 0xac00) % 28 : 0;

  switch (kind) {
    case "을": return jong === 0 ? "를" : "을";
    case "를": return jong === 0 ? "를" : "을";
    case "이": return jong === 0 ? "가" : "이";
    case "가": return jong === 0 ? "가" : "이";
    case "은": return jong === 0 ? "는" : "은";
    case "는": return jong === 0 ? "는" : "은";
    case "과": return jong === 0 ? "와" : "과";
    case "와": return jong === 0 ? "와" : "과";
    // ㄹ 받침(8)은 "로" — "1상으로" 가 아니라 "1상으로", "서울로"
    case "로": return jong === 0 || jong === 8 ? "로" : "으로";
    case "으로": return jong === 0 || jong === 8 ? "로" : "으로";
    default: return kind;
  }
}

/**
 * 빈칸 채우기. 값이 없는 빈칸이 남으면 null 을 돌려준다.
 *
 * null 이면 그 문장을 띄우지 말고 같은 자리의 '-없음' 틀을 쓴다(대표님 3장).
 * 값을 비워 둔 채 "런웨이 개월입니다" 같은 문장을 내보내지 않기 위한 것이다.
 */
export function fill(
  sentence: string,
  values: Record<string, string | number | null | undefined>
): string | null {
  let missing = false;
  const out = sentence.replace(/\{([^}|]+)(?:\|([^}]+))?\}/g, (_, rawName, kind) => {
    const name = String(rawName).trim();
    const v = values[name];
    if (v === null || v === undefined || v === "") { missing = true; return ""; }
    const text = String(v);
    return kind ? text + josa(text, String(kind).trim()) : text;
  });
  return missing ? null : out;
}

/**
 * 자리 하나를 문장으로. 값이 모자라면 '-없음' 틀로 물러난다.
 * 둘 다 없으면 null — 부르는 쪽이 그 줄을 빼면 된다.
 */
export function renderSlot(
  id: string,
  values: Record<string, string | number | null | undefined> = {}
): { text: string; meaning?: string } | null {
  const t = BY_SLOT.get(id);
  if (t) {
    const text = fill(t.sentence, values);
    if (text !== null) {
      const meaning = t.meaning ? fill(t.meaning, values) ?? undefined : undefined;
      return { text, ...(meaning ? { meaning } : {}) };
    }
  }
  const alt = BY_SLOT.get(`${id}-없음`);
  if (alt) {
    const text = fill(alt.sentence, values);
    if (text !== null) return { text };
  }
  return null;
}
