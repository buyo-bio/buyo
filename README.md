# BUYO MVP

임상 진입 전 사업성 진단. 2026년 10월 13일 발표용.

---

## 0. 이 폴더에 뭐가 들었나

```
buyo/
├─ db/schema.sql            테이블 3개 (chunks · records · runs)
├─ lib/
│   ├─ types.ts             청크 스키마 + 검사 규칙 V-00~V-10
│   ├─ store.ts             DB 접근은 전부 여기만 거침
│   ├─ normalize.ts         ② 입력 → 조건 5개 + 재무 상태 + 변곡점
│   ├─ engines/             ④ 엔진 (base·axes·clinical·finance·rules·index)
│   ├─ assemble.ts          ⑤ 엔진 결과 → 화면 칸 6개
│   ├─ demo-cases.ts        시연 3건 입력 프리셋
│   └─ modality-options.ts  화면 선택지 (T01 등록부에서 자동 생성)
├─ app/
│   ├─ globals.css          시안 B 의 <style> 그대로
│   ├─ page.tsx             L1 랜딩
│   ├─ tool/page.tsx        도구 화면 (레일 / 입력 / 결과)
│   └─ api/diagnose/        진단 API (POST 진단 · GET 저장된 결과)
├─ components/             Rail · InputPanel · Board
├─ scripts/
│   ├─ load.ts              청크 1,746개 적재
│   ├─ check-case-a.ts      첫날 목표 확인 (DB 필요)
│   ├─ check-chunks.ts      카드 검사      (DB 없이)
│   ├─ check-normalize.ts   ② 정규화 검증  (DB 없이)
│   ├─ check-engines.ts     ④ 엔진 검증    (DB 없이)
│   └─ check-assemble.ts    ⑤ 카드 문장 검증 (DB 없이)
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

## 2. 카드 먼저 점검 (Supabase 없이)

```bash
npm run chunks:check
```

DB 없이 카드 1,746개만 검사합니다. 이렇게 나오면 정상입니다.

```
총 1746건 · 고유 ID 1746개
  mapping 1050 · parameter 490 · rule 133 · method 73
검사 지적 0건
✅ 통과
```

---

## 3. 카드 적재

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

## 4. 첫날 목표 확인

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

## 3-2. DB 없이 돌리는 검사 셋

`.env.local` 이 없어도 돕니다. jsonl 을 직접 읽습니다.

```bash
npm run chunks:check    # 카드 1,746개 · 검사 지적 0건
npm run norm:check      # ② 모달리티 대체 · 적응증 · 재무 상태 · 변곡점
npm run engines:check   # ④ 엔진 — 시연 3건 숫자
npm run cards:check     # ⑤ 조립 — 화면 칸 6개 문장
```

목표값 출처는 두 곳입니다.

| 케이스 | 기준 문서 |
|---|---|
| A · ABL503 | 결과화면 명세 |
| C · LMB-201 | 예시 보고서 `BUYO-DX-S01` (2026-09-25, `reference/`) |

`npm run engines:check` 가 이렇게 끝나면 S2 완료입니다.

```
  ✅ 런웨이    목표 11.4개월        결과 11.4개월
  ✅ RCR      목표 0.15           결과 0.15
  ✅ 필요자금   목표 최소 600만 달러   결과 최소 $5.99M
```

### 엔진 한 개의 모양

네 칸입니다. 이 틀을 벗어나는 엔진은 없습니다.

```
① 입력      정규화가 만든 조건 5개 + 사용자가 적은 숫자
② 파라미터   청크에서 꺼낸다 — 코드에 숫자를 적지 않는다
③ 산식      위 둘만 쓴다
④ 출력      values + basis_chunks + status(ok / partial / no_evidence)
```

케이스 A 필요자금의 실제 근거는 이 두 장입니다.

| 카드 | 값 | 뜻 |
|---|---|---|
| `F04-0025` | 103,344 USD | 항암 P1 환자 1인당 비용 |
| `F04-0067` | 58명 | 항암 P1 시험 1건 환자 수 |

103,344 × 58 = **$5.99M**. 코드에는 이 숫자가 한 개도 없습니다.

---

## 3-3. 화면 칸 6개는 어떻게 만들어지나

`lib/assemble.ts` 하나가 만듭니다. 여기서 문장을 **지어내지 않습니다**.

```
화면에 나가는 글은 둘 중 하나뿐
  ① 청크 text 그대로            ← 규제·특허 칸
  ② 문장 틀 T 에 엔진 숫자를 끼움  ← 임상·재무 칸
```

문장을 고치려면 `assemble.ts` 위쪽 `T` 만 고칩니다. 엔진은 건드리지 않습니다.

### 신호등

```
rule 청크가 '주의'를 하나라도 내면  →  🟠 주의
전부 '양호'면                     →  🟢 양호
rule 청크가 없고 숫자만 있으면      →  ⚪ 중립
아무 카드도 못 꺼냈으면            →  ⚫ 근거 없음
```

`parameter` 카드는 신호등을 켜지 않습니다.

### 케이스 A 결과

```
임상  ⚪ 중립   누적 승인 확률 12.1%(단클론항체 기준), 항암 기준 5.3% — 두 값 사이에서…
시장  ⚫ 근거 없음
규제  ⚪ 중립   MFDS 우선심사 / 조건부 허가 / 희귀의약품 지정 / 첨단바이오
재무  🟠 주의   런웨이 11.4개월, 변곡점까지 6.4년 → 커버리지 0.15
특허  ⚫ 근거 없음  만료일 미입력
뉴스  ⚫ 근거 없음  정식판에서 수집
```

### API

```bash
curl -X POST localhost:3000/api/diagnose -H 'content-type: application/json' -d '{
  "modality":"antibody_bispecific","indication":"진행성·전이성 고형암",
  "phase":"P1","exit_route":"license_out",
  "cash":560,"monthly_burn":49,"listed":true,"run_id":"case-A"
}'

curl 'localhost:3000/api/diagnose?run_id=case-A'
```

`POST` 는 ①~⑤를 돌리고 `runs` 에 저장합니다. `GET` 은 저장된 것을 그대로 읽습니다.
**발표장 네트워크가 끊겨도 `GET` 은 돕니다.**

---

## 5. 다음 순서

| 스프린트 | 기간 | 만드는 것 | 끝났다는 증거 |
|---|---|---|---|
| ~~S0 적재~~ | 9/25~26 | ~~테이블 + 적재~~ | ~~1,746건~~ ✅ |
| ~~S1 조회·정규화~~ | 9/27~28 | ~~`lib/normalize.ts`~~ | ~~T01 대체 규칙 · FE-D01 · FE-D02~~ ✅ |
| ~~S2 계산 엔진~~ | 9/29~30 | ~~`lib/engines/`~~ | ~~런웨이 11.4 · RCR 0.15 · 최소 600만 달러~~ ✅ |
| ~~S4 조립·API~~ | 10/2~3 | ~~`lib/assemble.ts` · `app/api/diagnose`~~ | ~~명세 문장 4개 일치~~ ✅ |
| ~~S5 화면~~ | 10/5~8 | ~~시안 B를 컴포넌트로~~ | ~~`npm run build` 통과 · 랜딩·도구 화면 동작~~ ✅ |
| S3 수집 | 키 도착 후 | ctgov · dart · kipris | 임상 42건 이상 |

---

## 6. 꼭 지킬 규칙 다섯

1. **문장을 지어내지 않는다.** 화면에 나가는 글은 청크 `text` 그대로이거나, 미리 정한 문장 틀에 엔진 숫자를 끼운 것. 둘 중 하나뿐.
2. **엔진 코드에 숫자 상수를 쓰지 않는다.** 값은 전부 청크 ID로 꺼낸다. 꺼낸 ID는 `basis_chunks`에 남긴다.
3. **재료가 없으면 계산하지 않는다.** 0이나 평균으로 채우지 않고 `status=partial` 또는 `no_evidence`.
4. **DB 접근은 `lib/store.ts`만 거친다.** 화면에서 supabase를 직접 부르지 않는다.
5. **시연 3건은 파일로도 내장한다.** 발표장 네트워크가 끊겨도 돌아가야 한다.

---

## 7. 알려진 함정

### 인계 패키지 데이터 결함 2건 — 이미 고쳤습니다

**① T07 카드 83줄에 `NaN`이 들어 있었습니다.**

`NaN`은 JSON 문법에 없는 값이라 JavaScript가 못 읽습니다.
파이썬이 `json.dump`로 쓸 때 pandas 빈 값이 그대로 나간 것입니다.

```
"track": NaN            ← 읽다가 터짐
"track": null           ← 고친 것
```

`track`·`moat_applicability` 두 필드, 총 166곳을 `null`로 바꿨습니다.
**원본은 `data/_orig/T07_chunks_v0.jsonl.orig` 에 남겨 뒀습니다.**

> 📣 대표님·박지영님께 알려야 합니다. 다음 패키지에서도 같은 문제가 납니다.
> 파이썬에서 `json.dump(..., allow_nan=False)` 로 쓰거나 저장 전에 `None`으로 바꿔야 합니다.

**② F04 카드 4건의 값이 범위 문자열입니다.**

```
F04-0102  "120000-300000"  USD   (statistic: range)
F04-0144  "15-22"          %     (statistic: range_pct)
F04-0145  "11-29"          %
F04-0146  "9-14"           %
```

결함은 아니고 정상입니다. 범위는 숫자 하나가 아니니까요.
DB에 `value_text` 칸을 따로 두고, 숫자 칸(`value`)은 비웁니다.

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

### 화면 모달리티 목록 — 해결됨

시안 B는 12종, T01 등록부는 22종이라 카드가 안 걸리던 문제입니다.
이제 화면 목록을 **등록부에서 자동 생성**합니다.

```bash
npm run gen:modality      # T01 jsonl → lib/modality-options.ts
```

`lib/modality-options.ts` 를 손으로 고치지 마세요. 등록부가 바뀌면 위 명령만 다시 돌립니다.

- `antibody_bispecific` → 값 미확보. `antibody_mAb` 값 + 배지
- `cell_therapy` → 하위 태그 선택 요청
- TPD · RNA · 방사성 · 톡신 → `other`. 값 없음

### 비교군 CSV — DART 고유번호 두 가지 문제

`reference/source-data/ref/demo_comps_v1.csv` (케이스 A 3사 · B 3사)

1. **큐리언트(115180)의 DART 고유번호가 비어 있습니다.** 이 회사만 재무 스냅샷을 못 가져옵니다.
2. **앞자리 0이 또 날아갔습니다.** 기업 마스터와 같은 문제입니다.

```
앱클론   "991191"   ← 6자리 (잘못)
정답     "00991191" ← 8자리
```

읽을 때 반드시 8자리로 채우세요.

```ts
const corpCode = String(row.DART고유번호).padStart(8, "0");
```

3. **케이스 C(비상장)의 비교군은 아직 없습니다.** 예시 보고서 7쪽은 국내 상장사 5곳의
   비임상→IND 시점 분위값을 쓰는데, 그 5사 명단을 아직 못 받았습니다.

### 변곡점은 하나가 아닙니다

비임상 회사는 목표 시점이 두 개입니다. `FE-A05` 는 목표마다 비율을 따로 냅니다.

```
IND 제출까지   1.98  양호
P1 완료까지    0.38  미달 · 추가 조달 2회
```

"IND까지는 되는데 P1 완료는 안 된다"를 말하려면 두 값이 다 있어야 합니다.

### 필요 자금은 두 가지이고, 합치지 않습니다 (F01-11)

| 엔진 | 무엇 | 케이스 C |
|---|---|---|
| `FE-A02` | 업계 평균 단계 비용 (C03 카드) | 30.3M$ (비임상 5.0 + P1 25.3) |
| `FE-A03` | 설계안 기준 임상 직접비 (환자당 단가 × 인원) | 3.72M$ |

산정 방식이 달라서 어느 한쪽이 틀린 게 아닙니다. **나란히 놓습니다.**

### 지연 계수 해석이 엇갈립니다 — 대표 확인 필요

`F04-0097` 은 "실제 모집기간 ≈ 계획의 **2배**"(배수 2.0)라는 뜻입니다.
그런데 엔진 등록부의 FE-A05 산식은 `기간 × (1 + delay_factor)` 로 적혀 있어,
그대로 넣으면 3배가 됩니다.

결과화면 명세의 케이스 A **RCR 0.15** 는 지연을 넣지 않은 값과 맞습니다.
그래서 기본값은 지연 없이 내고, 지연 반영값은 `RCR_with_delay` 로만 병기합니다.
어느 쪽이 맞는지 대표 확인이 필요합니다.

### FE-A02 필요자금은 '현 단계 시험 1건' 기준입니다

`환자 1인당 비용 × 시험 1건 환자 수`. 모달리티 비용 계수·CMC 비용·국내 단가 카드가
아직 없어서 언제나 **최소**(`partial`)로 나갑니다 (F01-09).

### 재무 갭은 자동 계산하지 않습니다

`F01-10` 규칙: MVP는 자동 갭(원화) 계산 없음.
필요 자금은 원문 통화로 표시하고, 아래 문구를 답니다.

> "필요 자금은 원문 통화로 표시되며 원화 환산·갭 계산은 정식 버전에서 제공됩니다"

---

## 8. 아직 못 받은 것

전부 **10월 1일 수집일**에 필요합니다.

- [ ] Claude API 키 (9/26부터)
- [x] ~~DART 인증키~~ — 받아서 `.env.local` 에 넣음 (차단된 망이라 동작 확인은 못 함)
- [ ] KIPRIS 키 (특허청, 무료 발급)
- [x] ~~비교군 3사 종목코드~~ — 받음 (케이스 A·B). **큐리언트 DART 번호 1건 누락**
- [x] ~~케이스 C 수기 재무~~ — 받음 (LMB-201)
- [ ] 케이스 C 비교군 5사 명단 (비상장 ADC 비임상)
- [ ] M03 딜 카드 ↔ T01 태그 짝짓기 규칙

---

## 9. 기술 스택

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
