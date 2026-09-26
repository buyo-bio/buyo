/**
 * KIPRIS 특허 수집 — 출원인 이름으로 받아서 파일로 저장한다.
 *
 * 실행:  npm run collect:kipris -- "에이비엘바이오" "리가켐바이오"
 *        npm run collect:kipris            (인자 없으면 시연 3건 기본 목록)
 *
 * 결과는 data/records/patents/<출원인>.json 에 남는다.
 * 한 번 받아 두면 발표장에서 네트워크가 끊겨도 특허 칸이 돈다.
 */
import fs from "node:fs";
import path from "node:path";
import "../lib/env";
import { fetchByApplicant } from "../lib/collect/kipris";

const OUT = path.join(process.cwd(), "data", "records", "patents");

// 인자를 안 주면 이 목록. 케이스 C(루미어스바이오)는 가상 회사라 조회되지 않는다.
const DEFAULTS = ["에이비엘바이오", "리가켐바이오", "유한양행"];

async function main() {
  const names = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const targets = names.length ? names : DEFAULTS;

  fs.mkdirSync(OUT, { recursive: true });
  console.log(`출원인 ${targets.length}곳 조회\n`);

  for (const name of targets) {
    process.stdout.write(`  ${name.padEnd(16)} `);
    try {
      const r = await fetchByApplicant(name, { rows: 100, maxPages: 3 });
      const file = path.join(OUT, `${name}.json`);
      fs.writeFileSync(file, JSON.stringify(r, null, 2));

      const reg = r.records.filter((x) => x.register_status === "등록").length;
      const ipc = new Set(r.records.flatMap((x) => x.ipc)).size;
      console.log(`총 ${String(r.total).padStart(4)}건 · 받음 ${String(r.fetched).padStart(4)} · 등록 ${String(reg).padStart(3)} · IPC ${ipc}종`);
    } catch (e) {
      console.log(`❌ ${(e as Error).message}`);
    }
    // 무료 한도가 월 1,000회다. 급하게 두드리지 않는다.
    await new Promise((ok) => setTimeout(ok, 400));
  }

  console.log(`\n저장 위치  ${OUT}`);
  console.log(`다음       npm run patents:check`);
}

main().catch((e) => { console.error("\n❌ " + (e as Error).message); process.exit(1); });
