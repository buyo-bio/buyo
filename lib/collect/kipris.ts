/**
 * KIPRIS 특허 수집기
 *
 *   getAdvancedSearch + applicant  → 출원인 이름으로 그 회사 특허 전부
 *
 * 확인된 사실(2026-09-26 실측)
 *   · 오퍼레이션      getAdvancedSearch      (getWordSearch 는 폐기예정)
 *   · 출원인 파라미터  applicant
 *   · 날짜 형식       20120329  ← 8자리. 공식 문서 예시(1985/12/30 00:00:00)와 다르다
 *   · IPC            "C07K 16/28|A61P 25/00"  파이프 구분, 공백 있음
 *   · 인증키          ServiceKey (Encoding/Decoding 구분 없이 한 개)
 *
 * 응답은 XML 이다. 구조가 평평해서(item 안에 한 겹) 정규식으로 충분하다.
 * 라이브러리를 더 넣지 않는다.
 */
const BASE = "https://plus.kipris.or.kr/kipo-api/kipi/patUtiModInfoSearchSevice";

export type PatentRecord = {
  applicant: string;
  application_number: string;
  /** YYYY-MM-DD */
  application_date: string | null;
  title: string;
  /** 공백 없는 코드 목록 — ["C07K16/28", "A61P25/00"] */
  ipc: string[];
  register_status: string;
  register_date: string | null;
  register_number: string | null;
  abstract: string;
};

export type FetchResult = {
  applicant_query: string;
  total: number;
  fetched: number;
  records: PatentRecord[];
  as_of: string;
};

/** <tag>값</tag> 하나 꺼내기 */
function tag(xml: string, name: string): string {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? m[1].trim() : "";
}

/** 20120329 → 2012-03-29. 빈 값이면 null */
function date8(s: string): string | null {
  const d = s.replace(/\D/g, "");
  return /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : null;
}

function parse(xml: string): { total: number; records: PatentRecord[] } {
  const code = tag(xml, "resultCode");
  if (code && code !== "00")
    throw new Error(`KIPRIS 오류 ${code}: ${tag(xml, "resultMsg")}`);

  const records: PatentRecord[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const it = m[1];
    records.push({
      applicant: tag(it, "applicantName"),
      application_number: tag(it, "applicationNumber"),
      application_date: date8(tag(it, "applicationDate")),
      title: tag(it, "inventionTitle"),
      ipc: tag(it, "ipcNumber").split("|").map((x) => x.replace(/\s+/g, "")).filter(Boolean),
      register_status: tag(it, "registerStatus"),
      register_date: date8(tag(it, "registerDate")),
      register_number: tag(it, "registerNumber") || null,
      abstract: tag(it, "astrtCont"),
    });
  }
  return { total: Number(tag(xml, "totalCount") || records.length), records };
}

/**
 * 출원인 이름으로 특허를 전부 가져온다.
 *
 * 한 번에 최대 500건까지 되지만, 월 1,000회 무료라 호출 수를 아낀다.
 * maxPages 로 상한을 둔다 — 한 회사가 특허 수천 건이면 다 받을 이유가 없다.
 */
export async function fetchByApplicant(
  applicant: string,
  opts: { serviceKey?: string; rows?: number; maxPages?: number } = {}
): Promise<FetchResult> {
  const key = opts.serviceKey ?? process.env.KIPRIS_API_KEY;
  if (!key) throw new Error("KIPRIS_API_KEY 가 없습니다. .env.local 을 확인하세요.");

  const rows = opts.rows ?? 100;
  const maxPages = opts.maxPages ?? 3;

  const all: PatentRecord[] = [];
  let total = 0;

  for (let page = 1; page <= maxPages; page++) {
    const q = new URLSearchParams({
      applicant,
      patent: "true",
      utility: "false",
      numOfRows: String(rows),
      pageNo: String(page),
      ServiceKey: key,          // URLSearchParams 가 =, / 를 알아서 인코딩한다
    });

    const res = await fetch(`${BASE}/getAdvancedSearch?${q}`);
    if (!res.ok) throw new Error(`KIPRIS HTTP ${res.status}`);
    const { total: t, records } = parse(await res.text());

    total = t;
    all.push(...records);
    if (all.length >= total || records.length === 0) break;
  }

  return {
    applicant_query: applicant,
    total,
    fetched: all.length,
    records: all,
    as_of: new Date().toISOString().slice(0, 10),
  };
}
