/** The note behind tests/fixtures/gongmunFormBaseline.json (R-030). */
export const BASELINE_DAY = "2026-11-18T03:00:00.000Z";

/** The ten forms of 2.7.x by the ids 2.7.x stored. */
export const BASELINE_FORMS = [
  "preset:official",
  "preset:report",
  "preset:plan",
  "preset:notice",
  "preset:minutes",
  "preset:gaejosik",
  "preset:press",
  "preset:ministry",
  "builtin:hallym-ilsong",
  "builtin:hallym-aicr"
] as const;

export const BASELINE_FRONTMATTER: Record<string, unknown> = {
  title: "교육과정 개편 계획",
  공문_기관: "한림대학교",
  공문_수신: "각 학과장"
};

export const BASELINE_NOTE = [
  "# 2027학년도 AI 미디어 교육과정 개편 계획",
  "",
  "> 공통과목 5개를 AX 융합브릿지 과목으로 재편하고, 실습과목의 AI 크레딧 운영 기준을 마련한다.",
  "",
  "## 추진 배경",
  "",
  "- 생성형 AI 확산으로 제작 실습 교과의 평가 기준 재설계 필요",
  "  - 2026학년도 2학기 실습과목 12개 중 9개가 AI 도구 사용",
  "  - 학생 설문 응답자 184명 중 71%가 평가 기준 불명확 응답",
  "- 앵커 사업 성과지표와 교과과정 연계 요구",
  "",
  "## 추진 내용",
  "",
  "### 공통과목 개편",
  "",
  "- 미디어커뮤니케이션 입문을 4개 영역으로 재구성",
  "- 디지털미디어콘텐츠 AX 융합브릿지 5과목 운영",
  "",
  "### 실습 운영 기준",
  "",
  "1. AI 크레딧은 과목당 학기 30만 원 한도",
  "2. 장비 대여는 학과 사무실에서 일괄 관리",
  "",
  "| 구분 | 2026학년도 | 2027학년도 | 비고 |",
  "|---|---|---|---|",
  "| 공통과목 | 7개 | 5개 | 통합 2건 |",
  "| 실습과목 | 12개 | 14개 | 신설 2건 |",
  "| 합계 | 19개 | 19개 | |",
  "",
  "## 향후 일정",
  "",
  "- 2026. 12. 교과과정위원회 심의",
  "- 2027. 1. 동계 교수 워크숍에서 확정",
  "- 2027. 3. 시행"
].join("\n");
