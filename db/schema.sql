-- ════════════════════════════════════════════════════════════════
-- BUYO MVP — 테이블 3개
-- 설계서 v4 1장 그대로. Supabase SQL 편집기에 통째로 붙여넣으세요.
-- ════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- 1. chunks — 판단 문장 카드 1,746개
--    핵심 컬럼 10개 + 필터 5개 + meta(나머지 전부)
-- ─────────────────────────────────────────────
drop table if exists chunks cascade;

create table chunks (
  -- 신원
  chunk_id        text primary key,              -- C01-0092
  domain_id       text not null,                 -- C01, F01, T06 …
  kind            text not null,                 -- parameter | rule | method | mapping

  -- 내용
  text            text not null,                 -- 화면에 그대로 나가는 문장
  value           double precision,              -- parameter만. 54.7
  value_text      text,                          -- 범위값. "15-22"
  statistic       text,                          -- mean | median | range | range_pct …
  unit            text,                          -- %, years, USD_million
  flag_hint       text,                          -- rule만. positive | caution | neutral

  -- 필터 5개  (null = 모든 경우에 해당)
  modality        text,
  indication_code text,
  phase           text,
  rare            text,
  jurisdiction    text,

  -- 신뢰·유효기간
  trust_tier      int,                           -- 1 법령 | 2 표준문헌 | 3 경험칙
  valid_until     text,                          -- "2035-12" 또는 "계속"
  badges          jsonb default '[]'::jsonb,
  source          jsonb,

  -- 나머지 필드 전부
  meta            jsonb default '{}'::jsonb,

  loaded_at       timestamptz default now()
);

-- 필터 5개를 한 번에 거는 복합 인덱스
create index chunks_filter_idx
  on chunks (domain_id, kind, modality, indication_code, phase);
create index chunks_domain_idx on chunks (domain_id);
create index chunks_kind_idx   on chunks (kind);


-- ─────────────────────────────────────────────
-- 2. records — 밖에서 가져온 사실
--    판단하지 않고 그대로 저장한다
-- ─────────────────────────────────────────────
drop table if exists records cascade;

create table records (
  record_id    text primary key,                 -- ctgov:NCT04762641
  source       text not null,                    -- ctgov | dart | company | kipris | user
  source_key   text not null,                    -- NCT04762641 / 298380
  as_of        text,                             -- 이 사실의 기준 시점
  provenance   text not null,                    -- disclosed | extracted | self_reported
  payload      jsonb not null,                   -- 정규화한 값
  raw          jsonb,                            -- 원문 그대로 보존
  fetched_at   timestamptz default now()
);

create index records_source_idx on records (source, source_key);


-- ─────────────────────────────────────────────
-- 3. runs — 진단 결과
--    시연 3건은 여기에 미리 넣어 두고 화면이 읽는다
-- ─────────────────────────────────────────────
drop table if exists runs cascade;

create table runs (
  run_id        text primary key,                -- case-A / uuid
  input         jsonb not null,                  -- ① 사용자 입력
  normalized    jsonb not null,                  -- ② 조건 5개
  cards         jsonb not null,                  -- ⑤ 카드 6개
  basis_chunks  jsonb default '[]'::jsonb,       -- 읽은 카드 ID 전부
  records_used  jsonb default '[]'::jsonb,
  as_of         text,
  created_at    timestamptz default now()
);


-- ─────────────────────────────────────────────
-- 확인용
-- ─────────────────────────────────────────────
-- select count(*) from chunks;            -- 1746 이어야 함
-- select kind, count(*) from chunks group by kind order by 2 desc;
--   mapping 1050 / parameter 490 / rule 133 / method 73
