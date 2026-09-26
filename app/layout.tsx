import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BUYO — 임상 진입 전 사업성 진단",
  description: "시드~프리A 바이오텍이 설계안을 확정하기 전에 여섯 관점으로 점검하는 도구",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&family=IBM+Plex+Mono:wght@400;500&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
