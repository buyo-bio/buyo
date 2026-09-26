/**
 * T01 모달리티 등록부 → 화면 선택지
 *
 * 실행:  npm run gen:modality
 *
 * 화면 목록을 손으로 적으면 등록부와 어긋난다(실제로 어긋나 있었다).
 * 등록부에서 뽑아 쓴다. 등록부가 바뀌면 이 명령만 다시 돌린다.
 */
import fs from "node:fs";
import path from "node:path";

const SRC = path.join(process.cwd(), "data", "chunks", "T01_chunks_v0.jsonl");
const OUT = path.join(process.cwd(), "lib", "modality-options.ts");

type Row = {
  tag?: string; parent_tag?: string | null;
  label_ko?: string; input_label?: string; value_status?: string;
};

const rows: Row[] = fs.readFileSync(SRC, "utf8").split("\n")
  .filter(Boolean).map((l) => JSON.parse(l));

const opts = rows.filter((r) => r.tag).map((r) => ({
  tag: r.tag!,
  parent: r.parent_tag ?? null,
  label: r.input_label ?? r.label_ko ?? r.tag!,
  hasValue: String(r.value_status ?? "").startsWith("값 있음"),
  status: String(r.value_status ?? ""),
}));

const body = `/**
 * 화면 모달리티 선택지 — T01 등록부에서 자동 생성
 *
 * 손으로 고치지 마세요. \`npm run gen:modality\` 로 다시 만듭니다.
 * 원본: data/chunks/T01_chunks_v0.jsonl (${opts.length}개)
 */
export type ModalityOption = {
  tag: string;
  parent: string | null;
  label: string;
  /** 전용 숫자가 있는 태그인가 — 없으면 화면에 '값 빌려 씀' 배지가 붙는다 */
  hasValue: boolean;
  status: string;
};

export const MODALITY_OPTIONS: ModalityOption[] = ${JSON.stringify(opts, null, 2)};
`;

fs.writeFileSync(OUT, body);
console.log(`✅ ${OUT} — 선택지 ${opts.length}개 (값 있음 ${opts.filter((o) => o.hasValue).length}개)`);
