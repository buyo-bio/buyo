import type { NextConfig } from "next";

/**
 * 배포 설정
 *
 * 두 가지만 한다.
 *   ① 받아 둔 특허 JSON 을 서버 번들에 같이 실어 보낸다.
 *      Next 는 import 한 파일만 따라가는데, patents-cache.ts 는
 *      fs.readFileSync 로 읽으므로 그냥 두면 배포본에서 파일이 사라진다.
 *      (로컬에서는 멀쩡하고 배포에서만 특허 칸이 비는 사고가 여기서 난다)
 *   ② data/chunks 는 싣지 않는다 — 이미 DB 에 올렸고 2.5MB 라 짐만 된다.
 */
const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/diagnose": ["./data/records/patents/**"],
    "/api/diagnose/stream": ["./data/records/patents/**"],
    "/api/status": ["./data/records/patents/**"],
  },
};

export default nextConfig;
