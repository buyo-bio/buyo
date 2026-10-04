-- =====================================================================
-- db/ref_schema.sql — 적응증 자동완성용 표 4개 (Supabase / PostgreSQL)
--
-- 원본은 대표님 패키지의 load_kcd.sql 이다. 두 가지만 바꿨다.
--   ① COPY 문을 뺐다. Supabase 는 서버 파일시스템에 CSV 를 올릴 수 없다.
--      표 적재는 scripts/load-ref.ts 가 한다 → npm run ref:load
--   ② 적재 확인 쿼리는 파일 끝에 주석으로 옮겼다(적재 뒤에 따로 돌린다).
-- 테이블·제약·인덱스는 한 글자도 바꾸지 않았다.
--
-- 쓰는 법: Supabase → SQL Editor 에 이 파일을 통째로 붙여넣고 Run.
--
-- 층 구조
--   0층 therapeutic_area : 세부 치료영역 21개 (질환군 7개 아래 한 겹)
--   1층 indications      : 자주 쓰는 적응증 216행 — 먼저 찾는다
--   2층 kcd_master       : KCD-9 전체 14,590행 — 1층에 없으면 여기서 찾는다
--   표기 사전 kcd_term_map : 척주↔척추 같은 표기 차이 (검색어에만 적용)
--
-- 주의: pg_trgm 은 한글을 트라이그램으로 쪼갤 때 DB 로캘을 탄다.
--   lc_ctype 이 UTF-8 계열이어야 한다(Supabase 기본값은 해당된다).
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

DROP TABLE IF EXISTS indications;
DROP TABLE IF EXISTS kcd_master;
DROP TABLE IF EXISTS therapeutic_area CASCADE;
DROP TABLE IF EXISTS kcd_term_map;   -- 이전 버전 테이블(kcd 등)이 참조 중이어도 진행

-- ---------------------------------------------------------------------
-- 0층: therapeutic_area — 질환군 7개 아래의 세부 치료영역(등록부). 청크 태그·조회 우선순위의 기준값
-- ---------------------------------------------------------------------
CREATE TABLE therapeutic_area (
    ta_id                      text PRIMARY KEY,   -- 예: immunology_inflammation
    ta_ko                      text NOT NULL,
    default_buyo_disease_group text NOT NULL,      -- 2층 규칙의 기본 질환군. 1층은 사람이 정한 질환군을 유지
    subgroup_aliases           text,               -- 1층 subgroup 토큰('|' 구분)
    bio2021_subgroup           text,               -- C01·C02 source.subgroup → TA 크로스워크
    wong2019_subgroup          text,
    f04_source_ta_label        text,               -- F04 source_ta_label → TA 크로스워크
    note                       text
);
-- ---------------------------------------------------------------------
-- 1층: indications (자주 쓰는 적응증 213행)
-- ---------------------------------------------------------------------
CREATE TABLE indications (
    id                 serial PRIMARY KEY,
    name_ko            text NOT NULL,
    synonyms           text,          -- '|' 구분
    mesh_label_en      text,
    mesh_id            text,
    mesh_verified      text,
    icd10              text,          -- 코드 / 범위(C18-C20) / 목록(C22.1,C24)
    buyo_disease_group text NOT NULL
        CHECK (buyo_disease_group IN ('전체','항암','감염','대사·내분비','심혈관','중추신경(신경)','중추신경(정신)','기타')),
    subgroup           text,
    therapeutic_area   text NOT NULL REFERENCES therapeutic_area (ta_id),   -- 세부 치료영역
    ta_source          text,          -- subgroup / code_rule:TA-xx / group_canonical(alt=...)
    ta_alt             text,          -- 코드 규칙이 제안한 다른 TA(검토용). 조회에는 쓰지 않는다
    rare_hint          text,          -- Y / Y? / N
    note               text,
    -- 검색용 정규화 열: 소문자 + 공백 제거 ("임신성고혈압" ↔ "임신성 고혈압" 매칭용)
    name_norm          text GENERATED ALWAYS AS (regexp_replace(lower(name_ko), '\s', '', 'g')) STORED,
    syn_norm           text GENERATED ALWAYS AS (regexp_replace(lower(coalesce(synonyms, '')), '\s', '', 'g')) STORED
);

CREATE INDEX indications_name_ko_trgm   ON indications USING gin (name_ko   gin_trgm_ops);
CREATE INDEX indications_synonyms_trgm  ON indications USING gin (synonyms  gin_trgm_ops);
CREATE INDEX indications_name_norm_trgm ON indications USING gin (name_norm gin_trgm_ops);
CREATE INDEX indications_syn_norm_trgm  ON indications USING gin (syn_norm  gin_trgm_ops);

-- ---------------------------------------------------------------------
-- 2층: kcd_master (KCD-9 3·4단위)
-- ---------------------------------------------------------------------
CREATE TABLE kcd_master (
    kcd_code           text PRIMARY KEY,
    name_ko            text NOT NULL,      -- KCD 한글명(원문 보존)
    search_name        text NOT NULL,      -- 수식어 제거한 검색용 짧은 이름(R1 괄호·R2 수식어·R3 악성 신생물→암)
    name_en            text,               -- KCD 영문명(원문 보존)
    query_en           text,               -- CT.gov 조회용 (= name_en, 수정 없음)
    level              smallint NOT NULL CHECK (level IN (3, 4)),
    chapter            text NOT NULL,      -- 대분류 코드 범위 (예: A00-B99)
    buyo_disease_group text
        CHECK (buyo_disease_group IS NULL OR buyo_disease_group IN
               ('전체','항암','감염','대사·내분비','심혈관','중추신경(신경)','중추신경(정신)','기타')),
    therapeutic_area   text NOT NULL REFERENCES therapeutic_area (ta_id),   -- kcd_code_to_ta_v1.csv 규칙으로 부여
    ta_rule_id         text,               -- 적용된 규칙 id
    searchable         char(1) NOT NULL CHECK (searchable IN ('Y', 'N')),
    master_ref         text,               -- 같은 코드의 1층 name_ko ('|' 구분). 값이 있으면 자동완성에서 숨김
    needs_user_confirm char(1) CHECK (needs_user_confirm IN ('Y')),
    rare_user_confirm  char(1) CHECK (rare_user_confirm IN ('Y')),
    kcd_version        text NOT NULL,
    note               text,
    search_norm        text GENERATED ALWAYS AS (regexp_replace(lower(search_name), '\s', '', 'g')) STORED,
    name_norm          text GENERATED ALWAYS AS (regexp_replace(lower(name_ko), '\s', '', 'g')) STORED
);

-- 자동완성 대상 행만 색인(부분 인덱스): searchable='Y' AND master_ref 없음
CREATE INDEX kcd_master_search_name_trgm ON kcd_master USING gin (search_name gin_trgm_ops)
    WHERE searchable = 'Y' AND master_ref IS NULL;
CREATE INDEX kcd_master_name_ko_trgm     ON kcd_master USING gin (name_ko gin_trgm_ops)
    WHERE searchable = 'Y' AND master_ref IS NULL;
CREATE INDEX kcd_master_search_norm_trgm ON kcd_master USING gin (search_norm gin_trgm_ops)
    WHERE searchable = 'Y' AND master_ref IS NULL;
CREATE INDEX kcd_master_name_norm_trgm   ON kcd_master USING gin (name_norm gin_trgm_ops)
    WHERE searchable = 'Y' AND master_ref IS NULL;
CREATE INDEX kcd_master_group_idx ON kcd_master (buyo_disease_group);
CREATE INDEX kcd_master_ta_idx    ON kcd_master (therapeutic_area);

-- ---------------------------------------------------------------------
-- 표기 사전: KCD 표준 표기 ↔ 통용 표기. 동의어 표가 아니라 검색어 치환 규칙이며, 한 줄씩 사람이 승인해 넣는다.
-- 자동완성 함수가 입력어에 kcd_term 또는 common_term이 들어 있으면 반대쪽 표기로 바꾼 검색어를 하나 더 만든다.
-- ---------------------------------------------------------------------
CREATE TABLE kcd_term_map (
    kcd_term     text NOT NULL,
    common_term  text NOT NULL,
    scope        text,
    approved_on  date,
    note         text,
    PRIMARY KEY (kcd_term, common_term)
);
ANALYZE therapeutic_area;
ANALYZE kcd_term_map;
ANALYZE indications;
ANALYZE kcd_master;


-- ---------------------------------------------------------------------
-- 적재가 끝난 뒤(npm run ref:load) 아래를 SQL Editor 에서 돌려 수를 확인한다.
-- 기대값: therapeutic_area 21 · kcd_term_map 2 · indications 216
--         kcd_master 14,590 · searchable 8,124 · autocomplete pool 7,886
-- ---------------------------------------------------------------------
-- 적재 확인
-- SELECT 'therapeutic_area' AS t, count(*) FROM therapeutic_area
-- UNION ALL SELECT 'kcd_term_map', count(*) FROM kcd_term_map
-- UNION ALL SELECT 'indications', count(*) FROM indications
-- UNION ALL SELECT 'kcd_master', count(*) FROM kcd_master
-- UNION ALL SELECT 'kcd_master searchable', count(*) FROM kcd_master WHERE searchable = 'Y'
-- UNION ALL SELECT 'kcd_master autocomplete pool', count(*) FROM kcd_master WHERE searchable = 'Y' AND master_ref IS NULL;
