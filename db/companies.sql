-- 기업 마스터 508사
--
-- 비교군 풀(F06-01)과 회사 조회(FE-C08)가 쓴다.
-- 종목코드·DART고유번호는 앞자리 0 이 뜻을 가진다("000100" 유한양행).
-- 숫자로 담으면 0 이 날아가므로 반드시 text 다 — 실제로 한 번 날아간 적이 있다.

create table companies (
    stock_code          text primary key,        -- "000100" (앞의 0 유지)
    isin                text,
    dart_code           text,                    -- "00145109" 꼴. 역시 text
    name                text not null,
    aliases             text,                    -- 이전 사명·별칭
    market              text,                    -- 코스닥 / 유가 / 코넥스
    listed_on           date,

    primary_bm          text,                    -- BM-01 … BM-99
    primary_bm_name     text,
    bm_detail           text,
    secondary_bm        text,
    peer_group          text,

    -- F06-01 비교군 풀: comps in ('Y','Y(주의 플래그)') and primary_bm in ('BM-01','BM-04')
    comps               text,                    -- Y / Y(주의 플래그) / N
    trade_flag          text,                    -- 관리종목 등. 투자 판단에 쓴다
    trade_memo          text,
    headline            text,                    -- 앱화면_우선노출문구

    pipeline_summary    text,
    clinical_status     text,
    biotech_class       text,
    homepage            text
);

create index companies_name_idx    on companies (name);
create index companies_comps_idx   on companies (comps, primary_bm);
create index companies_dart_idx    on companies (dart_code);
