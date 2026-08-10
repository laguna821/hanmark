# R-004 — WCAG 기반 안전한 의미 색상 시스템

- 상태: PROPOSED
- 작성일: 2026-08-10
- 최종 갱신: 2026-08-10
- 기준: WCAG 2.2, WCAG2ICT, CSS Color 4, WHATWG HTML, 사용자 제공 대비 자료
- 관련 문서: R-001, R-003, R-005, R-006

## 1. 조사 질문

사용자가 키 컬러 하나만 골라도 HanMark가 모든 텍스트·배경·선 조합을 결정적으로 보정해 읽을 수 있게 만들 수 있는가? WCAG AA와 AAA 중 무엇을 제품이 실제로 보장할 수 있는가?

## 2. 검증 결론

가능하다. 단, “선택한 키 컬러를 한 비트도 바꾸지 않으면서 모든 색에서 AAA 7:1을 보장”하는 것은 수학적으로 불가능하다.

권장 제품 계약:

1. 사용자가 고른 opaque key surface는 기본적으로 그대로 보존한다.
2. 모든 일반 텍스트는 자동 전경색 선택으로 최소 AA 4.5:1을 보장한다.
3. 7:1이 가능한 조합에는 자동으로 AAA 수준을 사용한다.
4. exact key에서 AAA가 불가능하면 조용히 거짓 통과를 표시하지 않는다.
5. “매우 선명”이 꼭 필요할 때만 key surface를 가장 가까운 안전 명도로 조정하는 선택지를 제시한다.
6. 흰 종이 위 제목·링크용 key-ink는 원래 hue를 최대한 유지하며 7:1 목표로 파생할 수 있다.
7. 의미 있는 선·경계는 3:1을 목표로 한다.

이 설계는 초보자에게 전경색 선택을 맡기지 않으면서도 exact brand color와 접근성 목표의 충돌을 정직하게 처리한다.

## 3. W3C 원문으로 확인한 기준

WCAG 2.2:

- 일반 텍스트의 Level AA minimum은 4.5:1이다.
- large-scale text의 Level AA minimum은 3:1이다.
- 일반 텍스트의 Level AAA enhanced는 7:1이다.
- large-scale text의 Level AAA는 4.5:1이다.
- 장식, 비활성 UI, 로고에는 예외가 있다.
- 대비 공식은 (L1 + 0.05) / (L2 + 0.05)이고 범위는 1:1~21:1이다.
- 계산값을 threshold 비교 전에 반올림하면 안 된다.

W3C WCAG2ICT는 WCAG를 PDF 같은 non-web document와 software에 적용하는 informative guidance다. 법적·형식적 WCAG conformance를 이 색상 기능 하나로 주장할 수는 없지만, contrast 기준을 PDF 출력의 결정적 엔지니어링 목표로 사용하는 근거는 충분하다.

2.5.6 문서와 UI에서는 “WCAG 완전 준수 PDF”라고 표현하지 않는다. PDF 구조 태그, 텍스트 추출, 언어, 메타데이터 등 색상 외 접근성 요소가 별도로 있기 때문이다.

## 4. 사용자 제공 답변과 그래프 검증

사용자 제공 그래프:

- 855×570 PNG, 45,009 bytes
- SHA-256 5ADF379AF23D0E912185DB7706920BD522A68BBDAA7C6CD1CD891EBEBDDD23DE
- 저장소에는 포함하지 않음

### 맞는 내용

| 주장 | 검증 |
|---|---|
| #FFFF00 / #FFFFFF은 약 1.07:1 | 정확한 계산 1.073839:1 |
| #FFFF00 / #000000은 약 19.56:1 | 정확한 계산 19.556000:1 |
| 일반 텍스트 AA 4.5:1 | W3C 원문과 일치 |
| 큰 텍스트 AA 3:1 | W3C 원문과 일치 |
| 일반 텍스트 AAA 7:1 | W3C 원문과 일치 |
| 큰 텍스트 AAA 4.5:1 | W3C 원문과 일치 |

### 수정하거나 제한해야 할 내용

1. 그래프의 “WCAG Large Min 3:1, Pass”는 모든 텍스트에 대한 pass가 아니다. large-scale text 또는 적용되는 의미 있는 non-text 요소에만 해당한다.
2. “Yellow/Black Perfect”는 WCAG의 공식 등급명이 아니다. 19.56:1로 AAA를 크게 넘는다는 뜻의 설명일 뿐이다.
3. “Apple이 WCAG AA를 필수로 지정”했다는 표현은 과하다. Apple 공식 HIG는 WCAG와 APCA를 popular measures로 소개하고 Accessibility Inspector가 WCAG AA 값 4.5:1과 3:1을 guidance로 사용한다고 설명한다.
4. “Google은 톤 번호가 600단계 이상 차이나면 무조건 4.5:1”이라는 고정 규칙은 공식 Material 자료에서 확인되지 않았다. Material은 primary와 그 위 on-primary처럼 의미 역할을 분리하고 light/dark variants 및 대비 검사를 사용한다. HanMark도 숫자 단계 차이가 아니라 실제 WCAG 공식을 계산해야 한다.
5. 외부 블로그와 임의 contrast checker를 acceptance source로 삼지 않는다. W3C 공식 공식과 코드 테스트가 기준이다.

## 5. 왜 AAA를 항상 보장할 수 없는가

배경 상대 휘도를 L이라고 할 때:

- 검정과의 대비 = (L + 0.05) / 0.05
- 흰색과의 대비 = 1.05 / (L + 0.05)

AAA 7:1:

- 검정이 7:1 이상이려면 L ≥ 0.30
- 흰색이 7:1 이상이려면 L ≤ 0.10
- 0.10 < L < 0.30이면 검정도 흰색도 7:1이 아니다.
- 검정과 흰색은 가능한 전경 휘도의 양 끝이므로 이 구간에서는 다른 단색 전경도 7:1을 만들 수 없다.

예: #808080

- 흰색과 3.949440:1
- 검정과 5.317210:1
- 어느 쪽도 7:1이 아니다.

반면 AA 4.5:1:

- 흰색 통과 범위 L ≤ 0.183333
- 검정 통과 범위 L ≥ 0.175000
- 두 범위가 겹치므로 모든 opaque sRGB 배경에는 흰색 또는 검정 중 적어도 하나가 4.5:1 이상이다.

따라서 exact key surface 보존과 자동 AA는 동시에 보장할 수 있다. exact key surface 보존과 자동 AAA는 일부 색에서 동시에 보장할 수 없다.

## 6. 제품 정책 제안

### 기본 정책 — 자동 가독성

- 사용자에게 표준 선택을 묻지 않는다.
- exact key surface를 보존한다.
- on-key는 흰색과 near-black 후보 중 대비가 더 높은 쪽을 선택한다.
- 필요하면 near-black보다 검정을 선택해 4.5:1을 확실히 넘긴다.
- 작은 텍스트가 7:1 이상이면 “매우 선명”.
- 4.5:1 이상 7:1 미만이면 “읽기 안전”.
- 4.5:1 미만 결과는 저장·인쇄 불가.

### 선택 정책 — 매우 선명 우선

고급 화면에 기본 off인 한 개의 선택만 둘 수 있다.

- 명칭: “매우 선명하게 자동 조정”
- 설명: “일부 중간 밝기 색은 선택한 색을 조금 밝거나 어둡게 조정할 수 있어요.”
- 동작: key seed의 hue를 유지하며 가장 가까운 AAA 가능 key surface를 찾는다.
- 결과: 선택한 seed와 실제 적용 surface를 나란히 표시한다.

이 옵션 없이 AAA를 몰래 달성하려고 key를 바꾸면 사용자가 입력한 HEX가 무시됐다고 느낀다. 반대로 AAA 경고만 띄우고 사용자가 전경색을 직접 고르게 하면 초보자 목표가 깨진다.

## 7. 의미 토큰

사용자 입력은 1~2개지만 renderer는 다음 역할을 분리한다.

| 토큰 | 생성 규칙 | 사용처 | 목표 |
|---|---|---|---|
| paper | 2.5.6에서 #FFFFFF 고정 | 종이, 표지 하단 | 기준면 |
| bodyInk | 어두운 neutral | 본문 | paper와 최소 7:1 |
| keySurface | 기본은 exact key | 표지 상단, code/callout/table/tag 배경 | onKey와 최소 4.5:1, 가능하면 7:1 |
| onKey | white/near-black/black 중 최대 대비 | keySurface 위 모든 작은 글자 | 최소 4.5:1 |
| keyInk | key hue를 유지하며 어둡거나 밝게 조정 | 흰 종이 위 제목·링크·header/footer | paper와 목표 7:1 |
| keyMutedInk | keyInk보다 약한 보조값 | 보조 제목·marker | 실제 사용 크기에 따라 최소 4.5:1 |
| accentLine | auto 또는 검증된 override | header/footer rule, hr | paper와 3:1 |
| accentOnKey | keySurface 위 보조 글자 | callout label 등 | 최소 4.5:1, 목표 7:1 |
| softTint | key의 연한 tint | mark 등 | bodyInk와 최소 7:1 |
| border | neutral | table/code 경계 | 의미 있는 경우 paper와 3:1 |
| alternate | neutral | 줄무늬 | bodyInk와 최소 7:1 |

기본 프로필은 algorithm으로 재생성하지 않고 기존 9색 상수로 반환한다. 그렇지 않으면 #31537D, #7FE2DC, #C7F1EE 같은 값이 미세하게 바뀌어 2.5.5 기본 출력 호환성이 깨질 수 있다.

## 8. 결정적 팔레트 알고리즘

### 8.1 입력

- canonical opaque limited-sRGB #RRGGBB
- key
- accentMode: auto 또는 custom
- custom accent가 있으면 동일한 정규화

### 8.2 상대 휘도와 대비

각 8-bit sRGB channel을 0~1로 바꾼 뒤:

    c_linear = c / 12.92                    if c <= 0.04045
    c_linear = ((c + 0.055) / 1.055)^2.4   otherwise

    L = 0.2126 R + 0.7152 G + 0.0722 B
    ratio = (max(L1,L2) + 0.05) / (min(L1,L2) + 0.05)

비교할 때 ratio를 반올림하지 않는다. UI 표시에만 소수 둘째 자리로 반올림한다.

### 8.3 on-key

1. white, bodyInk, black의 실제 대비를 계산한다.
2. 7:1 이상인 후보 중 design preference가 높은 것을 선택한다.
3. 없다면 4.5:1 이상인 후보 중 최대 대비를 선택한다.
4. 수학상 opaque sRGB key에는 반드시 최소 하나가 존재한다.
5. 결과와 ratio, AA/AAA 수준을 resolved palette에 기록한다.

### 8.4 key-ink와 accent-line

색이 사용자 seed와 같은 계열로 느껴지게 OKLCH에서 hue를 유지하고 lightness를 조정한다.

1. seed를 sRGB에서 OKLCH로 변환한다.
2. paper 대비 목표를 만족하는 가장 가까운 lightness를 binary search한다.
3. sRGB gamut 밖이면 hue와 lightness를 유지하고 chroma를 줄인다.
4. 최종 8-bit #RRGGBB로 quantize한 뒤 WCAG ratio를 다시 계산한다.
5. quantize 후 threshold 미만이면 한 step 더 안전한 방향으로 이동한다.
6. key-ink 목표는 7:1, accent-line은 3:1이다.

CSS Color 4는 Oklab을 perceptually uniform한 공간으로 설명하고, gamut mapping에서 hue를 유지하며 chroma를 줄이는 방법과 binary search를 다룬다. 최종 CSS에 oklch 값을 그대로 넣기보다 TypeScript에서 canonical #RRGGBB를 계산해 인쇄 환경별 차이를 줄인다.

### 8.5 soft tint와 neutral

- softTint는 bodyInk와 7:1을 먼저 만족시킨다.
- border가 layout 이해에 필요하면 paper와 3:1을 만족시킨다.
- 단순 표 줄무늬는 3:1을 강제하면 지나치게 강해질 수 있으므로 텍스트 대비와 표 구조의 다른 경계를 함께 평가한다.

## 9. 노랑 예시

### 순수 노랑 #FFFF00

- white: 1.073839:1, 실패
- black: 19.556000:1, AAA
- 결과: keySurface는 #FFFF00, onKey는 black 계열
- keyInk: 흰 종이용으로 더 어두운 같은 hue 계열을 계산

### 예시 노랑 #FFD400

- white: 1.431552:1, 실패
- 기존 bodyInk #182433: 10.955551:1, AAA
- 결과: keySurface #FFD400, onKey #182433 사용 가능
- 표지 상단, code, table header는 노랑 배경과 짙은 글자
- 종이 위 heading은 raw #FFD400이 아니라 자동 keyInk

## 10. UI 경고와 추천

위저드는 사용자가 대비쌍을 직접 편집하게 하지 않는다.

| 상황 | 동작 | 메시지 |
|---|---|---|
| raw key + white가 낮지만 dark가 AA/AAA | dark 자동 선택 | 밝은 배경에 맞춰 글자를 어둡게 바꿨어요 |
| exact key에서 AAA 불가, AA 가능 | AA 자동 적용 | 읽기 안전. 매우 선명 모드에서는 배경색이 조금 조정될 수 있어요 |
| custom accent가 paper와 3:1 미만 | accent-line 자동 보정 | 선이 보이도록 같은 계열의 진한 색을 사용해요 |
| 무효 HEX | 이전 유효 preview 유지, Apply 차단 | 6자리 색상값을 확인해 주세요 |

경고는 사용자를 막기보다 HanMark가 무엇을 바꿨는지 설명한다. 자동 보정 전·후 swatch와 실제 ratio는 펼침형 상세에서 확인할 수 있다.

## 11. color picker 구현 근거

WHATWG HTML의 color control은 현재 엔진에서 color picker를 제공하며 기본 colorspace는 8-bit limited-sRGB다. Obsidian의 ColorComponent도 현재 6자리 #RRGGBB를 사용하는 기존 코드 선례가 있다.

HanMark 2.5.6은:

- alpha와 Display-P3를 노출하지 않는다.
- picker와 text field를 같은 canonical sRGB 값에 연결한다.
- picker에는 항상 유효한 색이 있어야 하므로 문구의 빈칸 의미와 색 입력을 섞지 않는다.
- 브라우저 picker UI는 OS별로 다를 수 있음을 허용하되 HEX field 동작은 동일하게 만든다.

## 12. 테스트 가능한 불변식

- normalizeHex 결과는 항상 /^#[0-9A-F]{6}$/.
- 모든 24-bit key 표본에 대해 contrast(keySurface, onKey) ≥ 4.5.
- AAA exact-preserve가 가능하다고 표시하면 ratio ≥ 7.
- keyInk와 paper ≥ 7.
- 의미 있는 accentLine과 paper ≥ 3.
- softTint와 bodyInk ≥ 7.
- threshold 비교에는 rounded value를 쓰지 않음.
- 같은 입력은 항상 같은 token과 ratio를 반환.
- 최종 quantized #RRGGBB를 다시 검사.
- 기본 프로필은 기존 9색 exact match.

전 16,777,216색 exhaustive test는 단위 테스트에서 시간 비용이 클 수 있다. 경계 휘도, 대표 hue, 무작위 seeded sample, property-based test를 조합하고 별도 개발 검증 script에서 exhaustive 검사를 실행할 수 있다.

## 13. 외부 출처

- W3C WCAG 2 Overview: https://www.w3.org/WAI/standards-guidelines/wcag/
- WCAG 2.2 Contrast Minimum과 Enhanced: https://www.w3.org/TR/WCAG22/#contrast-minimum
- WCAG 2.2 contrast ratio 정의: https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio
- W3C Non-text Contrast 이해 문서: https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast
- W3C WCAG2ICT 2.2: https://www.w3.org/TR/wcag2ict-22/
- W3C CSS Color 4: https://www.w3.org/TR/css-color-4/
- WHATWG HTML color state: https://html.spec.whatwg.org/multipage/input.html#color-state-(type=color)
- Apple HIG Accessibility: https://developer.apple.com/design/human-interface-guidelines/accessibility/
- Material Design color system: https://m2.material.io/guidelines/style/color.html
- Material semantic on-color 개요: https://m2.material.io/design/introduction/

## 14. 결정 전 남은 질문

- 기본 자동 모드에서 AAA 불가능한 exact key를 단순히 AA로 허용할지, 자동으로 surface까지 조정할지 최종 제품 결정을 내려야 한다. 이 문서는 exact key + AA, 가능하면 AAA를 권장한다.
- “매우 선명” 옵션이 초보자에게 필요 이상으로 복잡한지는 prototype test로 확인한다.
- 인쇄물의 종이·프린터·컬러 프로필 차이 때문에 화면의 수학적 ratio와 물리 인쇄 가독성이 완전히 같다고 보장할 수 없다.
- APCA는 Apple이 다른 지표로 소개하지만 WCAG 3 관련 알고리즘과 제품 목표가 안정될 때까지 2.5.6 acceptance gate로 사용하지 않는다.

## 15. 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-08-10 | WCAG 원문, 사용자 그래프 수치, AA/AAA 가능 범위, semantic token과 결정적 알고리즘을 최초 기록 |
