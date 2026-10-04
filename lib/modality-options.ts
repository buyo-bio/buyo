/**
 * 화면 모달리티 선택지 — T01 등록부에서 자동 생성
 *
 * 손으로 고치지 마세요. `npm run gen:modality` 로 다시 만듭니다.
 * 원본: data/chunks/T01_modality_registry.jsonl (27개)
 */
export type ModalityOption = {
  tag: string;
  parent: string | null;
  label: string;
  /** 전용 숫자가 있는 태그인가 — 없으면 화면에 '값 빌려 씀' 배지가 붙는다 */
  hasValue: boolean;
  status: string;
};

export const MODALITY_OPTIONS: ModalityOption[] = [
  {
    "tag": "small_molecule",
    "parent": null,
    "label": "저분자 화합물",
    "hasValue": true,
    "status": "값 있음(C01·C02·C03)"
  },
  {
    "tag": "antibody",
    "parent": null,
    "label": "항체(종류 미정)",
    "hasValue": false,
    "status": "값 없음 → 하위 태그 antibody_mAb 값 사용 + 배지"
  },
  {
    "tag": "antibody_mAb",
    "parent": "antibody",
    "label": "단클론항체",
    "hasValue": true,
    "status": "값 있음(BIO 2021 Monoclonal antibody)"
  },
  {
    "tag": "antibody_bispecific",
    "parent": "antibody",
    "label": "이중항체",
    "hasValue": false,
    "status": "값 미확보 → antibody_mAb 값 + 배지"
  },
  {
    "tag": "antibody_fragment",
    "parent": "antibody",
    "label": "항체 절편",
    "hasValue": false,
    "status": "값 미확보 → antibody_mAb 값 + 배지"
  },
  {
    "tag": "antibody_Fc_fusion",
    "parent": "antibody",
    "label": "Fc 융합단백질",
    "hasValue": false,
    "status": "값 미확보 → antibody_mAb 값 + 배지"
  },
  {
    "tag": "antibody_other",
    "parent": "antibody",
    "label": "기타 항체",
    "hasValue": false,
    "status": "값 미확보"
  },
  {
    "tag": "ADC",
    "parent": null,
    "label": "항체-약물 접합체(ADC)",
    "hasValue": true,
    "status": "값 있음(BIO 2021 ADC)"
  },
  {
    "tag": "cell_therapy",
    "parent": null,
    "label": "세포치료제(종류 미정)",
    "hasValue": false,
    "status": "값 없음 → 하위 태그 선택 요청"
  },
  {
    "tag": "cell_CART",
    "parent": "cell_therapy",
    "label": "CAR-T",
    "hasValue": true,
    "status": "값 있음(BIO 2021 CAR-T, 소표본 배지)"
  },
  {
    "tag": "cell_TCRT",
    "parent": "cell_therapy",
    "label": "TCR-T",
    "hasValue": false,
    "status": "값 미확보"
  },
  {
    "tag": "cell_NK",
    "parent": "cell_therapy",
    "label": "NK 세포치료(CAR-NK 포함)",
    "hasValue": false,
    "status": "값 미확보"
  },
  {
    "tag": "cell_MSC",
    "parent": "cell_therapy",
    "label": "중간엽 줄기세포",
    "hasValue": false,
    "status": "값 미확보"
  },
  {
    "tag": "cell_iPSC",
    "parent": "cell_therapy",
    "label": "iPSC 유래 세포",
    "hasValue": false,
    "status": "값 미확보"
  },
  {
    "tag": "cell_somatic",
    "parent": "cell_therapy",
    "label": "체세포 치료(연골·피부 등)",
    "hasValue": false,
    "status": "값 미확보"
  },
  {
    "tag": "cell_DC_CIK",
    "parent": "cell_therapy",
    "label": "면역세포(DC·CIK·TIL)",
    "hasValue": false,
    "status": "값 미확보"
  },
  {
    "tag": "cell_other",
    "parent": "cell_therapy",
    "label": "기타 세포치료",
    "hasValue": false,
    "status": "값 미확보"
  },
  {
    "tag": "gene_therapy",
    "parent": null,
    "label": "유전자치료제",
    "hasValue": true,
    "status": "값 있음(BIO 2021 Gene therapy)"
  },
  {
    "tag": "peptide",
    "parent": null,
    "label": "펩타이드",
    "hasValue": true,
    "status": "값 있음(BIO 2021 Peptide)"
  },
  {
    "tag": "vaccine",
    "parent": null,
    "label": "백신",
    "hasValue": true,
    "status": "값 있음(BIO 2021 Vaccine, Wong 참고)"
  },
  {
    "tag": "biosimilar",
    "parent": null,
    "label": "바이오시밀러",
    "hasValue": true,
    "status": "값 있음(교안 기반 illustrative)"
  },
  {
    "tag": "other",
    "parent": null,
    "label": "기타",
    "hasValue": true,
    "status": "값 있음(BIO Others, 제한적)"
  },
  {
    "tag": "protein",
    "parent": null,
    "label": "재조합 단백질·효소",
    "hasValue": true,
    "status": "값 있음(BIO 2021 Protein, 제한적 매핑)"
  },
  {
    "tag": "oligonucleotide",
    "parent": null,
    "label": "올리고뉴클레오타이드(RNA 치료제)",
    "hasValue": false,
    "status": "하위 태그 값 사용"
  },
  {
    "tag": "oligo_siRNA",
    "parent": "oligonucleotide",
    "label": "siRNA",
    "hasValue": true,
    "status": "값 있음(BIO 2021 siRNA/RNAi, 제한적 매핑)"
  },
  {
    "tag": "oligo_ASO",
    "parent": "oligonucleotide",
    "label": "안티센스(ASO)",
    "hasValue": true,
    "status": "값 있음(BIO 2021 Antisense, 제한적 매핑)"
  },
  {
    "tag": "generic",
    "parent": null,
    "label": "제네릭(복제약)",
    "hasValue": false,
    "status": "값 없음 — 성공확률·기간 표 적용 대상 아님"
  }
];
