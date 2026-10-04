-- =====================================================================
-- db/autocomplete.sql — 적응증 자동완성 함수
--
-- 대표님 패키지의 autocomplete.sql 에서 두 군데만 바꿨다. 결과는 같다.
--   ① 함수의 SET pg_trgm.word_similarity_threshold = 0.3 을 뺐다.
--      이 설정은 슈퍼유저만 걸 수 있는데 Supabase 는 그 권한을 주지 않는다
--      (ERROR 42501: permission denied to set parameter).
--   ② 그 설정을 읽던 <% 연산자를 word_similarity(...) > 0.3 으로 바꿨다.
--      a <% b 는 "word_similarity(a,b) > 임계값" 과 같은 뜻이라 판정 결과가 같다.
--      인덱스를 덜 타지만 1층 216행 + 2층 7,886행이라 체감 차이가 없다.
--   순서·점수·반환 열은 손대지 않았다.
-- db/ref_schema.sql 을 먼저 돌리고, 표를 적재한 뒤(npm run ref:load) 이걸 돌린다.
--
-- 쓰는 법: Supabase → SQL Editor 에 붙여넣고 Run.
-- 확인:   SELECT * FROM autocomplete('당뇨');   → 8행, 1위 제2형 당뇨병
--
-- 앱에서는 app/api/autocomplete 가 rpc('autocomplete', {q, lim}) 로 부른다.
-- =====================================================================

-- =====================================================================
-- autocomplete.sql — 적응증 자동완성 (입력어 q → 상위 8개)
-- 순서: ① 1층 부분 일치(name_ko·synonyms: exact→prefix→contains) → ② 2층 부분 일치(search_name·name_ko;
--       searchable='Y', master_ref 없음) → ③ 부분 일치가 부족하면 1층·2층 트라이그램 유사어(층 무관, 점수순)
--       (예: "척추측만증" → KCD 표기 "척주측만증", "무릎 관절염" → "무릎관절증").
-- 매칭은 공백 무시(정규화 열) + 대소문자 무시. 동의어를 만들지 않고 트라이그램만 사용한다.
-- 표기 사전(kcd_term_map): 입력어에 사전의 표기가 들어 있으면 반대쪽 표기로 바꾼 검색어를 하나 더 만들어 같이 찾는다
--   (예: "척추측만증" → "척주측만증"도 검색). 같은 행이 두 검색어에 걸리면 더 좋은 매칭 하나만 남긴다.
-- 유사어 임계값 0.3(word_similarity): 낮추면 잡음이, 높이면 표기 차이(척추/척주) 누락이 늘어난다.
-- 반환: layer(1/2), code, name_ko, buyo_disease_group, therapeutic_area, rare_hint(1층만), flag(2층 확인 표시),
--       query_en, match_type, score
--   선택 시 앱 입력값: layer 1 → indication.code='MeSH:'+mesh_id / layer 2 → 'KCD:'+code(MeSH 없음),
--       disease_group=buyo_disease_group, therapeutic_area 그대로, rare 기본값=rare_hint(1층) 또는 사용자 선택(2층).
--       CT.gov query.cond 는 query_en (1층 mesh_label_en / 2층 KCD 영문명).
-- =====================================================================

DROP FUNCTION IF EXISTS autocomplete(text, int);
CREATE FUNCTION autocomplete(q text, lim int DEFAULT 8)
RETURNS TABLE (
    layer              int,
    code               text,
    name_ko            text,
    buyo_disease_group text,
    therapeutic_area   text,   -- 세부 치료영역(등록부 ta_id). 엔진 조회 필터에 질환군과 함께 넘긴다
    rare_hint          text,   -- 1층만. 2층은 NULL
    flag               text,   -- 2층: needs_user_confirm / rare_user_confirm 표시
    query_en           text,   -- CT.gov 조회어 (1층 mesh_label_en / 2층 KCD 영문명)
    match_type         text,   -- exact / prefix / contains / similar
    score              real
)
LANGUAGE sql STABLE
AS $$
WITH q0 AS (
    SELECT regexp_replace(lower(trim(q)), '\s', '', 'g') AS nq
),
qn AS (  -- 입력어 + 표기 사전 치환어
    SELECT nq FROM q0
    UNION
    SELECT replace(q0.nq, t.common_term, t.kcd_term) FROM q0 JOIN kcd_term_map t ON position(t.common_term IN q0.nq) > 0
    UNION
    SELECT replace(q0.nq, t.kcd_term, t.common_term) FROM q0 JOIN kcd_term_map t ON position(t.kcd_term IN q0.nq) > 0
),
l1 AS (  -- 1층
    SELECT 1 AS layer, i.icd10 AS code, i.name_ko, i.buyo_disease_group, i.therapeutic_area, i.rare_hint,
           NULL::text AS flag, i.mesh_label_en AS query_en,
           CASE WHEN i.name_norm = nq OR nq = ANY (string_to_array(i.syn_norm, '|'))  THEN 'exact'
                WHEN i.name_norm LIKE nq || '%'                                          THEN 'prefix'
                WHEN i.name_norm LIKE '%' || nq || '%' OR i.syn_norm LIKE '%' || nq || '%' THEN 'contains'
                ELSE 'similar' END AS match_type,
           -- 유사도는 공백이 있는 원문에 대해 계산(단어 경계 트라이그램 보존)
           greatest(word_similarity(nq, i.name_ko), word_similarity(nq, coalesce(i.synonyms, ''))) AS score,
           similarity(nq, i.name_ko) AS sim
    FROM indications i, qn
    WHERE nq <> ''
      AND (   i.name_norm LIKE '%' || nq || '%'
           OR i.syn_norm  LIKE '%' || nq || '%'
           OR (length(nq) >= 2 AND (word_similarity(nq, i.name_ko) > 0.3 OR word_similarity(nq, coalesce(i.synonyms, '')) > 0.3)))
),
l2 AS (  -- 2층
    SELECT 2 AS layer, k.kcd_code AS code, k.name_ko, k.buyo_disease_group, k.therapeutic_area, NULL::text AS rare_hint,
           concat_ws(',', CASE WHEN k.needs_user_confirm = 'Y' THEN 'needs_user_confirm' END,
                          CASE WHEN k.rare_user_confirm  = 'Y' THEN 'rare_user_confirm'  END) AS flag,
           k.query_en,
           CASE WHEN k.search_norm = nq                                                THEN 'exact'
                WHEN k.search_norm LIKE nq || '%'                                        THEN 'prefix'
                WHEN k.search_norm LIKE '%' || nq || '%' OR k.name_norm LIKE '%' || nq || '%' THEN 'contains'
                ELSE 'similar' END AS match_type,
           greatest(word_similarity(nq, k.search_name), word_similarity(nq, k.name_ko)) AS score,
           similarity(nq, k.search_name) AS sim
    FROM kcd_master k, qn
    WHERE k.searchable = 'Y' AND k.master_ref IS NULL
      AND nq <> ''
      AND (   k.search_norm LIKE '%' || nq || '%'
           OR k.name_norm   LIKE '%' || nq || '%'
           OR (length(nq) >= 2 AND (word_similarity(nq, k.search_name) > 0.3 OR word_similarity(nq, k.name_ko) > 0.3)))
),
ranked AS (
    SELECT u.*,
           CASE WHEN match_type <> 'similar' THEN layer ELSE 10 END AS r_layer,
           CASE match_type WHEN 'exact' THEN 0 WHEN 'prefix' THEN 1 WHEN 'contains' THEN 2 ELSE 3 END AS r_type
    FROM (SELECT * FROM l1 UNION ALL SELECT * FROM l2) u
),
dedup AS (  -- 같은 행이 검색어 여러 개에 걸리면 가장 좋은 매칭 하나만
    SELECT DISTINCT ON (layer, code, name_ko) *
    FROM ranked
    ORDER BY layer, code, name_ko, r_layer, r_type, score DESC, sim DESC
)
SELECT layer, code, name_ko, buyo_disease_group, therapeutic_area, rare_hint, nullif(flag, '') AS flag,
       query_en, match_type, score
FROM dedup
ORDER BY
    -- 1층 부분일치 → 2층 부분일치 → 유사어(층 무관, 점수순)
    r_layer, r_type,
    score DESC,
    sim DESC,          -- 전체 유사도(similarity)로 동점 정리
    layer,
    length(name_ko),   -- 같은 점수면 짧은(일반적인) 이름 먼저
    code
LIMIT lim;
$$;

-- 사용 예
-- SELECT * FROM autocomplete('당뇨');
-- SELECT * FROM autocomplete('무릎 관절염', 8);
