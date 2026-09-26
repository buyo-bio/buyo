/** L1 랜딩 — 시안 B 그대로 */
import Link from "next/link";

const STEPS = [
  { n: "1", h: "약과 설계를 입력",
    p: "약물 종류·적응증·개발 단계를 고르고, 있으면 설계안과 재무를 채웁니다.",
    shot: ["입력 화면", "(약물 종류·적응증·단계 / 설계·재무 값을 적는 화면)"] },
  { n: "2", h: "조건에 맞는 근거를 찾음",
    p: "공개 임상·공시 자료에서 검증을 통과한 판단 기준 문장만 골라냅니다.",
    shot: ["검색 과정", "(조건 필터 → 등급 정렬)"] },
  { n: "3", h: "여섯 관점으로 확인",
    p: "임상·시장·규제·재무·특허·뉴스. 문장마다 출처와 신뢰 등급이 붙습니다.",
    shot: ["결과 화면", "(카드 6장과 근거 보기)"] },
];

export default function Landing() {
  return (
    <div className="land">
      <div className="land-top">
        <div className="brandmark">
          <span className="dot">BY</span>
          <b>BUYO</b>
          <span>임상 진입 전 사업성 진단</span>
        </div>
        <Link className="top-cta" href="/tool">진단 시작</Link>
      </div>

      <section className="hero">
        <span className="badge">근거가 없으면 없다고 씁니다</span>
        <h1>
          임상 진입 전에, 이 설계로 사업이 되는지<br />
          <b>근거와 함께 확인합니다</b>
        </h1>
        <p className="sub">
          시드~프리A 바이오텍이 설계안을 확정하기 전에 여섯 관점으로 점검하는 도구입니다.
        </p>
        <div className="act">
          <Link className="big" href="/tool">진단 시작</Link>
          <small>필수 입력 3항목 · 약 30초</small>
        </div>
      </section>

      <section className="how">
        <h2>작동 방식 3단계</h2>
        <div className="steps">
          {STEPS.map((s) => (
            <div className="step" key={s.n}>
              <div className="n">{s.n}</div>
              <h3>{s.h}</h3>
              <p>{s.p}</p>
              <div className="shot">{s.shot[0]}<br />{s.shot[1]}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="landfoot">
        <span>회원가입 없음</span>
        <span>결과 저장·공유 없음</span>
        <span>노트북 화면 기준</span>
        <span>표시되는 수치는 시안용 예시</span>
      </div>
    </div>
  );
}
