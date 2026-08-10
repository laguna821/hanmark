# R-007 — 현재 Editorial PDF 팔레트 WCAG 대비 감사

- 상태: CONFIRMED
- 작성일: 2026-08-10
- 최종 갱신: 2026-08-10
- 기준: R-001 첨부 PDF, 2.5.5 commit 728b2b3, WCAG 2.2
- 관련 문서: R-001, R-004, R-006

## 1. 조사 질문

현재 #002E6E, #00B5AD, #182433, #31537D 중심 PDF 디자인은 실제 사용 조합에서 WCAG 대비 기준을 어느 정도 만족하는가? 사용자에게 제공된 외부 답변의 수치와 해석은 정확한가?

## 2. 짧은 결론

색 대비 관점에서는 매우 안정적인 팔레트다.

- 표지 네이비/흰 글자, 본문 잉크/흰 종이, 보조 잉크/흰 종이는 모두 일반 텍스트 AAA 7:1을 넘는다.
- 실제 어두운 면의 보조 label에 쓰는 #7FE2DC/#002E6E도 AAA를 넘는다.
- #00B5AD/흰 종이는 2.56:1이므로 텍스트에는 실패하고, 의미를 전달하는 필수 선의 3:1에도 미달한다.
- 현재 PDF에서 #00B5AD는 거의 전적으로 장식 rule로 쓰이므로 곧바로 전체 실패라고 단정할 수는 없다.
- 색 대비가 좋다는 사실과 “첨부 PDF 전체가 WCAG 접근성을 충족한다”는 평가는 전혀 다르다. 이 출력물은 텍스트가 벡터 윤곽선이고 구조 태그·언어 메타가 없어 비색상 접근성에 큰 한계가 있다.

따라서 “대부분 시각적으로 잘 나왔다”는 평가는 맞지만 “WCAG를 완벽하게 관통한 PDF”라는 평가는 과장이다.

## 3. 계산 방법

WCAG 2.2의 현행 sRGB 상대 휘도와 대비 공식을 사용했다.

    c_linear = c / 12.92                    if c <= 0.04045
    c_linear = ((c + 0.055) / 1.055)^2.4   otherwise

    L = 0.2126 R + 0.7152 G + 0.0722 B
    ratio = (max(L1,L2) + 0.05) / (min(L1,L2) + 0.05)

판정 전 수치는 반올림하지 않고, 표시에만 소수 둘째 자리로 반올림했다.

사용자 제공 코드의 0.03928 breakpoint는 과거 문서에 널리 쓰인 값이다. 현행 WCAG 2.2 정의는 0.04045다. 이번 주요 팔레트의 8-bit channel에서는 최종 표기 수치에 영향을 주지 않지만, HanMark 구현은 현행 0.04045를 사용해야 한다.

## 4. 핵심 조합 감사

| 실제 또는 가정 사용처 | 조합 | 정확한 대비 | 텍스트 판정 | 해석 |
|---|---|---:|---|---|
| 표지 상단과 reverse text | #002E6E / #FFFFFF | 12.99540457:1 | 일반 AAA | 실제 핵심 조합, 매우 안전 |
| 본문 | #182433 / #FFFFFF | 15.68344162:1 | 일반 AAA | 실제 핵심 조합, 매우 안전 |
| 표지 detail·보조 텍스트 | #31537D / #FFFFFF | 7.88279451:1 | 일반 AAA | 실제 조합, AAA threshold 초과 |
| 상·하단 청록 rule | #00B5AD / #FFFFFF | 2.55692960:1 | 텍스트 실패 | 필수 non-text라면 3:1도 실패, 장식이면 예외 가능 |
| 가정: 청록 text on navy | #00B5AD / #002E6E | 5.08242565:1 | 일반 AA, AAA 실패 | 수치는 맞지만 현재 주된 text 조합은 아님 |
| 가정: dark text on teal | #182433 / #00B5AD | 6.13370100:1 | 일반 AA, AAA 실패 | 청록 surface에 text가 필요할 때 가능한 안전 조합 |
| 실제 callout 보조 label | #7FE2DC / #002E6E | 8.54875406:1 | 일반 AAA | 외부 답변이 놓친 실제 밝은 accent 조합 |
| 실제 highlight | #182433 / #C7F1EE | 12.8792:1 | 일반 AAA | mark text 대비 안전 |

## 5. 외부 답변 항목별 검증

### 정확한 부분

- 13.00, 15.68, 7.88, 2.56, 5.08이라는 주요 계산값은 맞다.
- 청록 위 흰 글자를 피해야 한다는 결론은 맞다.
- 밝은 surface에는 #182433 같은 어두운 글자가 안전하다는 방향도 맞다.
- 핵심 text palette가 우연히가 아니라 높은 상대 휘도 차이 때문에 안정적이라는 설명은 타당하다.

### 과장 또는 수정이 필요한 부분

#### “완벽하게 WCAG를 관통”

WCAG는 색 대비 하나만 평가하지 않는다. 첨부 PDF는 text extraction 0자, font resource 0, /Lang·StructTreeRoot·bookmark가 없고 글자가 vector path다. 검색·선택·복사·screen reader 접근이 불가능하다. 색 대비가 AAA인 조합이 많아도 PDF 전체 접근성 준수를 주장할 수 없다.

이 현상은 Microsoft Print to PDF를 거친 이 출력물의 관찰이며, 모든 HanMark 출력 환경으로 일반화하지 않는다.

#### “청록 선이 3:1에 근접하여 훌륭”

WCAG threshold는 근접 여부가 아니라 통과 여부다. 2.5569는 3:1 미만이며 반올림해 통과시킬 수 없다.

다만 SC 1.4.11은 의미 있는 시각 정보에 적용된다. 현재 rule이 순수 장식이면 대비 요구가 없을 수 있다. 페이지 영역을 식별하는 필수 구조선으로 제품이 정의한다면 custom profile뿐 아니라 default rule도 3:1 미달이라는 별도 디자인 결정을 해야 한다.

#### “딥네이비/청록 text를 실제로 쓴다”

5.08 계산은 맞지만 첨부 PDF에서 #00B5AD는 주로 흰 종이 위 rule이다. 네이비 위 보조 label에는 더 밝은 #7FE2DC가 쓰이고, 실제 대비는 8.55:1이다. 가정 조합과 실제 조합을 구분해야 한다.

#### “검정보다 어두운 네이비가 눈 피로를 줄인다”

WCAG contrast 공식은 눈 피로를 측정하지 않는다. 개인의 시각 조건, 광량, 글꼴, 화면/종이, 주변 환경에 따라 달라지므로 이 문장을 확인된 사실로 사용할 수 없다. #182433이 15.68:1로 읽기 안전하고 순검정보다 시각적으로 덜 강한 색이라는 관찰까지만 말할 수 있다.

#### “대비 계단이 정보 hierarchy를 완벽하게 만든다”

15.68과 7.88의 차이가 시각적 hierarchy에 기여할 수는 있다. 그러나 WCAG 등급은 정보 중요도를 평가하는 규칙이 아니다. font size, weight, 위치, spacing도 hierarchy를 만든다.

## 6. 현재 팔레트 역할별 판정

### 안전하게 유지할 역할

- #002E6E: 큰 key surface와 흰 종이 위 key ink
- #FFFFFF: #002E6E 위 reverse text
- #182433: 흰 종이 body ink
- #31537D: 흰 종이 muted ink
- #7FE2DC: #002E6E 위 밝은 label
- #C7F1EE: #182433 아래 highlight

### 사용을 제한할 역할

- #00B5AD는 흰 종이 위 일반 text에 사용하지 않는다.
- #00B5AD background 위 white text를 사용하지 않는다.
- #00B5AD background에 작은 text가 필요하면 #182433은 6.13:1로 AA이지만 AAA는 아니다.
- #00B5AD rule을 “항상 인식해야 하는 구조”로 정의하면 더 어두운 accentLine을 파생해야 한다.

### 별도 검토가 필요한 neutral

- #D9E0E6 border와 흰 종이는 약 1.33:1이다.
- #FAFAFA stripe와 흰 종이는 거의 구분되지 않는다.
- 이 값들은 text background로는 #182433과 충분한 대비를 갖는다.
- border나 stripe 자체가 반드시 구조를 전달해야 하는지에 따라 non-text 3:1 적용 여부가 달라진다. 표 cell 정렬, text 위치, 다른 border가 구조를 제공하는지 실제 component 단위로 평가한다.

## 7. 2.5.6에 주는 결정

1. built-in default profile은 현재 palette를 exact 보존한다.
2. default teal rule 2.56:1은 “기존 호환”과 “의미 선 3:1” 사이의 알려진 예외로 표시한다.
3. custom profile의 accentLine은 흰 종이와 3:1 이상으로 자동 보정한다.
4. #00B5AD를 text token으로 재사용하지 않는다.
5. keySurface, onKey, keyInk, accentLine, accentOnKey를 분리한다.
6. palette 미리보기에는 line뿐 아니라 작은 text on surface를 반드시 보여준다.
7. 제품 문구는 “WCAG 대비 공식을 사용한 읽기 안전 보정”으로 제한하고 “WCAG 준수 PDF”라고 광고하지 않는다.

## 8. 검증 fixture

R-006에 다음 exact fixture를 고정한다.

- contrast(#002E6E, #FFFFFF) = 12.99540457...
- contrast(#182433, #FFFFFF) = 15.68344162...
- contrast(#31537D, #FFFFFF) = 7.88279451...
- contrast(#00B5AD, #FFFFFF) = 2.55692960...
- contrast(#002E6E, #00B5AD) = 5.08242565...
- contrast(#182433, #00B5AD) = 6.13370100...
- contrast(#7FE2DC, #002E6E) = 8.54875406...

test assertion은 수치 tolerance를 사용하되 판정은 unrounded ratio로 한다.

## 9. 출처

- WCAG 2.2 Contrast Minimum과 Enhanced: https://www.w3.org/TR/WCAG22/#contrast-minimum
- WCAG 2.2 contrast ratio 정의: https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio
- W3C Non-text Contrast: https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast
- W3C WCAG2ICT: https://www.w3.org/TR/wcag2ict-22/
- 소스 팔레트: src/io/editorialPdf.ts:795-1608
- 출력 포렌식: R-001

## 10. 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-08-10 | 사용자 제공 팔레트 평가를 현행 WCAG 공식, 실제 사용처, PDF 비색상 접근성으로 재검증 |
