import { deflateSync } from "node:zlib";

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const body = new Uint8Array(4 + data.length);
  body.set([...type].map((character) => character.charCodeAt(0)), 0);
  body.set(data, 4);
  const output = new Uint8Array(12 + data.length);
  const view = new DataView(output.buffer);
  view.setUint32(0, data.length);
  output.set(body, 4);
  view.setUint32(8 + data.length, crc32(body));
  return output;
}

/** A solid-colour RGB PNG, built here so the repository holds no binary fixture. */
export function makePng(width: number, height: number, rgb: [number, number, number]): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 2, 0, 0, 0], 8);
  const row = new Uint8Array(1 + width * 3);
  for (let x = 0; x < width; x += 1) row.set(rgb, 1 + x * 3);
  const raw = new Uint8Array(row.length * height);
  for (let y = 0; y < height; y += 1) raw.set(row, y * row.length);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", new Uint8Array(deflateSync(raw, { level: 9 }))),
    chunk("IEND", new Uint8Array(0))
  ];
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

export function pngDataUri(width: number, height: number, rgb: [number, number, number]): string {
  return `data:image/png;base64,${Buffer.from(makePng(width, height, rgb)).toString("base64")}`;
}

const WIDE = pngDataUri(1600, 400, [0, 107, 115]);
const SMALL = pngDataUri(240, 120, [200, 60, 60]);

/** A long Korean report: nested lists, table, footnotes, images, callout, code, links. */
export const KOREAN_REPORT_NOTE = [
  "# 2027학년도 AI 미디어 교육과정 개편 보고",
  "",
  "생성형 AI 확산에 따라 제작 실습 교과의 평가 기준을 다시 설계한다.[^1] 이 문서는 **교과과정위원회** 보고용이며, *초안*이다.",
  "",
  "둘째 문단은 ~~삭제된 표현~~과 ==강조 표시==, <u>밑줄</u>, H<sub>2</sub>O, x<sup>2</sup>, `inline code`를 담는다.",
  "",
  "## 1. 추진 배경",
  "",
  "- 평가 기준 재설계 필요",
  "  - 2026학년도 2학기 실습과목 12개 중 9개가 AI 도구 사용",
  "  - 학생 설문 응답자 184명 중 71%가 기준 불명확 응답",
  "    1. 설문 기간: 2026. 10. 5. ~ 10. 16.",
  "    2. 응답률 62%",
  "- 앵커 사업 성과지표와 연계[^2]",
  "",
  "## 2. 추진 내용",
  "",
  "### 2.1 공통과목 개편",
  "",
  "1. 미디어커뮤니케이션 입문을 4개 영역으로 재구성",
  "2. AX 융합브릿지 5과목 운영",
  "   - 과목당 AI 크레딧 30만 원",
  "3. 장비 대여는 학과 사무실에서 일괄 관리",
  "",
  "목록 사이의 문단이다.",
  "",
  "5. 다섯 번부터 시작하는 목록",
  "6. 여섯 번",
  "",
  "- [ ] 교과과정위원회 심의",
  "- [x] 교수회의 보고",
  "",
  "| 구분 | 2026학년도 | 2027학년도 | 비고 |",
  "|:---|:---:|---:|---|",
  "| 공통과목 | 7개 | 5개 | **통합** 2건 |",
  "| 실습과목 | 12개 | 14개 | [안내](https://www.hallym.ac.kr/) |",
  "| AI 크레딧 | 없음 | 과목당 30만 원 | 앵커 예산 |",
  "",
  `![넓은 그림](${WIDE})`,
  "",
  `본문 속 작은 그림 ![작은 그림](${SMALL}) 뒤의 글.`,
  "",
  "> 인용문 첫 문단이다.",
  ">",
  "> 인용문 둘째 문단이다.",
  "",
  "> [!NOTE] 참고",
  "> 콜아웃 본문 첫 줄이다.",
  ">",
  "> - 콜아웃 안 목록",
  "",
  "```python",
  "def credit(course):",
  "    return 300_000  # 원",
  "```",
  "",
  "자세한 내용은 [한림대학교](https://www.hallym.ac.kr/)와 [[다른 노트|연결 노트]]를 본다.  ",
  "강제 줄바꿈 뒤의 줄이다.",
  "",
  "---",
  "",
  "## 3. 향후 일정",
  "",
  "수식 $E = mc^2$ 는 글자로 남는다.",
  "",
  "[^1]: 첫째 각주는 [근거 자료](https://example.com/source)를 가리킨다.",
  "[^2]: 둘째 각주다.",
  ""
].join("\n");

/** An English paper section. */
export const ENGLISH_PAPER_NOTE = [
  "# Knowledge Journalism in the Zero-Click Era",
  "",
  "## Abstract",
  "",
  "Search engines now answer questions directly.[^a] This paper asks how *journalism education* should respond.",
  "",
  "## Method",
  "",
  "1. Sample: 24 newsrooms",
  "2. Period: 2025–2026",
  "",
  "| Variable | Mean | SD |",
  "|---|---:|---:|",
  "| Dwell time | 41.2 | 9.8 |",
  "| Click-through | 0.12 | 0.04 |",
  "",
  "> Readers do not arrive; answers leave.",
  "",
  "[^a]: See the 2025 industry report.",
  ""
].join("\n");

/** A short memo with only plain structures. */
export const PLAIN_MEMO_NOTE = [
  "첫 제목 없이 시작하는 메모다.",
  "",
  "## 할 일",
  "",
  "- 하나",
  "- 둘",
  "",
  "끝.",
  ""
].join("\n");
