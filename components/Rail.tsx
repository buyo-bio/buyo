"use client";
import Link from "next/link";

export type ToolView = "diagnose" | "recent" | "data";

const ICONS: Record<ToolView, React.ReactNode> = {
  diagnose: <path d="M4 14h4l2 5 4-14 2 7h4" />,
  recent: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.5 2" /></>,
  data: (
    <>
      <path d="M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z" />
      <path d="M4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7" />
      <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </>
  ),
};

const TITLE: Record<ToolView, string> = {
  diagnose: "진단", recent: "최근 조회", data: "자료 상태",
};

export default function Rail({
  view, onView,
}: { view: ToolView; onView: (v: ToolView) => void }) {
  return (
    <nav className="rail">
      <Link className="mark" href="/" title="처음 화면으로">BY</Link>
      {(Object.keys(ICONS) as ToolView[]).map((k) => (
        <button
          key={k}
          className="ricon"
          aria-current={view === k}
          title={TITLE[k]}
          onClick={() => onView(k)}
        >
          <svg viewBox="0 0 24 24">{ICONS[k]}</svg>
        </button>
      ))}
      <div className="spacer" />
    </nav>
  );
}
