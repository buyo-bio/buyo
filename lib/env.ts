/**
 * .env.local 을 읽는다.
 *
 * dotenv 는 기본으로 .env 만 본다. Next.js 는 .env.local 을 알아서 읽지만
 * 스크립트(tsx)는 아니다. 그래서 스크립트 맨 위에서 이 파일을 먼저 부른다.
 *
 *   import "../lib/env";
 */
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

for (const name of [".env.local", ".env"]) {
  const p = path.join(process.cwd(), name);
  if (fs.existsSync(p)) dotenv.config({ path: p });
}
