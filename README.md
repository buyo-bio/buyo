# BUYO MVP

임상 진입 전 사업성 진단. 2026년 10월 13일 발표용.

---

## 0. 이 폴더에 뭐가 들었나

```
buyo/
├─ db/schema.sql            테이블 3개 (chunks · records · runs)
├─ lib/
│   ├─ types.ts             청크 스키마 + 검사 규칙 V-00~V-10
│   └─ store.ts             DB 접근은 전부 여기만 거침
├─ scripts/
│   ├─ load.ts              청크 1,746개 적재
│   └─ check-case-a.ts      첫날 목표 확인
├─ data/chunks/*.jsonl      카드 1,746개  ← 이미 들어 있음
├─ design/시안-B.html        화면 시안 (그대로 열어 보면 됨)
└─ reference/               파이썬 원본·규칙 yaml·원본 CSV (읽기용, 실행 안 함)
```

---

## 1. 처음 한 번만

### ① 패키지 설치

```bash
cd buyo
npm install
```

### ② Supabase 프로젝트 만들기

1. [supabase.com](https://supabase.com) 가입 → New project
2. 만들어지면 **SQL Editor** 열기
3. `db/schema.sql` 내용을 통째로 붙여넣고 Run

### ③ 접속 정보 넣기

`.env.example`을 복사해 `.env.local`로 만들고 채웁니다.

```bash
cp .env.example .env.local
```

Supabase 대시보드 → **Project Settings → API** 에서 두 개를 복사합니다.

```
SUPABASE_URL=https://xxxx.supabase.co       ← Project URL
SUPABASE_SERVICE_KEY=eyJhbGci...             ← service_role key (secret)
```

> ⚠️ `service_role` 키는 절대 화면 코드에 넣지 마세요. 서버에서만 씁니다.

---

## 2. 카드 적재

```bash
npm run db:load
```

이렇게 나오면 성공입니다.

```
  읽음  C_chunks_v1.jsonl                   285건
  읽음  F04_chunks_v0.jsonl                 241건
  ...
총 1746건 · 검사 지적 0건

적재 중…
  500 / 1746
  1000 / 1746
  1500 / 1746
  1746 / 1746

✅ 적재 완료 — chunks 1746건
```

---

## 3. 첫날 목표 확인

```bash
npm run db:check
```

케이스 A(에이비엘바이오 ABL503) 조건으로 카드를 꺼내서,
**C01 세 행이 나오는지** 확인합니다.

```
카드 총 1746건  ✅
  mapping 1050 · parameter 490 · rule 133 · method 73

━ 목표 카드 3개 ━
  ✅ C01-0092  54.7%  P1→P2        modality=antibody_mAb
  ✅ C01-0096  12.1%  P1→approved  modality=antibody_mAb
  ✅ C01-0012   5.3%  P1→approved  ind=항암

━ 판정 ━
  ✅ 목표 카드 3개가 모두 조회됩니다. 첫날 목표 달성.
```

**여기까지 되면 나머지는 같은 패턴의 반복입니다.**

---

## 4. 다음 순서

| 스프린트 | 기간 | 만드는 것 | 끝났다는 증거 |
|---|---|---|---|
| ~~S0 적재~~ | 9/25~26 | ~~테이블 + 적재~~ | ~~1,746건~~ ✅ |
| **S1 조회·정규화** | 9/27~28 | `lib/normalize.ts` · 우선순위 정렬 | 케이스 A → 54.7 / 12.1 / 5.3 순서대로 |
| S2 계산 엔진 | 9/29~30 | `lib/engines/` 12개 | 런웨이 11.4개월 · RCR 0.15 · 최소 600만 달러 |
| S3 수집 | 10/1 | ctgov · dart · kipris | 임상 42건 이상 |
| S4 조립·API | 10/2~3 | `lib/assemble.ts` · `app/api/diagnose` | 명세 문장과 일치 |
| S5 화면·마감 | 10/5~8 | 시안 B를 컴포넌트로 | 새 환경에서 README만으로 실행 |

---

## 5. 꼭 지킬 규칙 다섯

1. **문장을 지어내지 않는다.** 화면에 나가는 글은 청크 `text` 그대로이거나, 미리 정한 문장 틀에 엔진 숫자를 끼운 것. 둘 중 하나뿐.
2. **엔진 코드에 숫자 상수를 쓰지 않는다.** 값은 전부 청크 ID로 꺼낸다. 꺼낸 ID는 `basis_chunks`에 남긴다.
3. **재료가 없으면 계산하지 않는다.** 0이나 평균으로 채우지 않고 `status=partial` 또는 `no_evidence`.
4. **DB 접근은 `lib/store.ts`만 거친다.** 화면에서 supabase를 직접 부르지 않는다.
5. **시연 3건은 파일로도 내장한다.** 발표장 네트워크가 끊겨도 돌아가야 한다.

---

## 6. 알려진 함정

### DART 고유번호 앞의 0이 날아가 있습니다

`reference/source-data/ref/companies_v2_0.csv`의 `DART고유번호`가
엑셀을 거치며 앞자리 0을 잃었습니다. 508사 전부입니다.

```
에이비엘바이오  "1256864"   ← 7자리 (잘못)
정답           "01256864"   ← 8자리
```

읽을 때 반드시 8자리로 채우세요.

```ts
const corpCode = String(row.DART고유번호).padStart(8, "0");
```

### 화면 모달리티 목록을 T01 등록부에 맞추세요

`lib/types.ts`의 `MODALITIES`가 T01 등록부 22개 기준입니다.
시안 B의 12종 목록과 다릅니다. 화면을 만들 때 이쪽으로 맞춰야 합니다.

- `antibody_bispecific` → 값 미확보. `antibody_mAb` 값 + 배지
- `cell_therapy` → 하위 태그 선택 요청
- TPD · RNA · 방사성 · 톡신 → `other`. 값 없음

### 재무 갭은 자동 계산하지 않습니다

`F01-10` 규칙: MVP는 자동 갭(원화) 계산 없음.
필요 자금은 원문 통화로 표시하고, 아래 문구를 답니다.

> "필요 자금은 원문 통화로 표시되며 원화 환산·갭 계산은 정식 버전에서 제공됩니다"

---

## 7. 아직 못 받은 것

전부 **10월 1일 수집일**에 필요합니다.

- [ ] Claude API 키 (9/26부터)
- [ ] DART 인증키
- [ ] KIPRIS 키 (특허청, 무료 발급)
- [ ] 비교군 3사 종목코드
- [ ] 케이스 C 수기 재무 4값

---

## 8. 기술 스택

```
화면 + API + 엔진   Next.js (TypeScript)
DB                 Supabase (Postgres)
시연 3건 백업       앱에 JSON 파일 내장
파이썬             reference/ 에 읽기용으로만. 실행하지 않음
도커               사용 안 함
```

설계서 v4는 파이썬 파일명으로 적혀 있습니다. **하는 일과 순서는 같고 확장자만 다릅니다.**

| 설계서 | 이 프로젝트 |
|---|---|
| `db/load.py` | `scripts/load.ts` |
| `db/query.py` | `lib/store.ts` |
| `engines/*.py` | `lib/engines/*.ts` |
| `api/main.py` | `app/api/diagnose/route.ts` |
| Streamlit 화면 | `app/` (시안 B) |
