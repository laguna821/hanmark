# R-012 — 지각 신호를 고려한 결정적 `onKey` 자동 추천 계약

- 상태: CONFIRMED
- 작성일: 2026-08-10
- 최종 갱신: 2026-08-10
- 기준 버전/커밋: HanMark 2.5.6 후보 / `5da40010e17775e3dcc058c9cd1038af3714409d`
- 관련 문서: R-004, R-006, R-008, R-009, R-010, R-011
- 담당 범위: 사용자 PDF 테마의 자동 `onKey`, 글자가 놓이는 키 면, 대비 진단과 2.5.6 릴리스 재검증

## 1. 조사 질문

WCAG 2.2 최소 대비를 하드 게이트로 유지하면서도 `#D709D1`처럼 exact 키 면에서 WCAG 수치와 실제 화면의 밝은 획 현저성이 엇갈리는 경우, 사용자가 고른 키 컬러를 저장값으로 보존하고 옵션을 늘리지 않은 채 흰 글자를 안전하게 사용할 수 있는 결정적 자동 보정 규칙은 무엇인가?

## 2. 범위

### 포함

- 수동 override가 없는 사용자 테마의 단일 `onKey` 자동 추천
- exact 키 면에서 기존 WCAG 안전 후보와 흰색의 국소 휘도 edge 비교
- 글자가 놓이는 파생 면 `keyTextSurface`의 제한적 OKLCH 명도 보정
- 최종 8-bit sRGB 양자화 뒤 WCAG 대비와 OKLab 색차 재검사
- 미리보기·실제 PDF·진단에서 같은 resolved palette를 사용하는 계약
- 변경된 2.5.6 후보의 전체 팔레트·Community Review 재검증

### 제외

- `onKeySmall`과 `onKeyDisplay`처럼 글자 크기별 토큰 또는 사용자 옵션 추가
- 저장된 키 컬러, JSON 교환 형식 또는 settings schema 변경
- 수동 `onKey` override의 자동 교정
- APCA runtime 구현, dependency, UI 점수 또는 릴리스 판정 도입
- 내장 `Achmage HanMark 기본` 테마의 색·DOM·CSS 변경
- WCAG 색 대비를 넘어선 PDF 전체 접근성 준수 주장

## 3. 조사 방법과 증거

| 증거 | 유형 | 재현 또는 위치 | 신뢰도/한계 |
|---|---|---|---|
| `#D709D1` 선언색·glyph 측정 | 재현 연구 | R-011 3~7절 | 흰색 edge의 강한 화면 신호를 한 조건에서 확인했으며 모든 사용자·출력 매체로 일반화하지 않음 |
| 현재 자동 selector | 소스 | `src/io/editorialPdfTheme.ts`의 `automaticOnKey()`와 `resolveEditorialPdfTheme()` | exact 키 면의 WCAG 7:1/4.5:1 후보 선택과 fallback 기준선 |
| 현재 미리보기·진단 계약 | 소스/사용자 테스트 | R-010 | production 의미 구조와 실제 적용 비율을 함께 보여줘야 함 |
| 수동 override와 내장 테마 계약 | 사용자 결정 | R-008 | 저대비 수동값 허용과 2.5.5 내장 출력 불변은 변경 불가 |
| 자동 보정 제품 결정 | 사용자 승인 | 2026-08-10 계획 승인 | 아래 트리거·허용 색차·fallback을 제품 계약으로 확정 |
| WCAG 2.2 대비 공식 | 공식 표준 | W3C SC 1.4.3과 contrast ratio 정의 | 규범적 최소 대비 판정에 사용하며 지각 현저성 순위로 과장하지 않음 |

## 4. 확인된 사실

1. R-011에서 `#D709D1` 위 검정은 WCAG `4.849179:1`, 흰색은 `4.330630:1`이다. exact 면의 일반 글자 기준에서는 검정만 통과한다.
2. 같은 조합에서 `edgeSignal(fg, surface) = abs(relativeLuminance(fg) - relativeLuminance(surface))`를 계산하면 흰색은 `0.807541`, 검정은 `0.192459`다. 실제 12px 캡처에서도 흰 glyph의 휘도 edge 신호가 더 컸다.
3. WCAG 대비는 계속 일반 글자 `4.5:1` 하드 게이트여야 한다. `edgeSignal`은 자동 보정을 시도할지 정하는 보조 조건일 뿐 통과 기준이나 접근성 등급이 아니다.
4. 사용자가 고른 키 컬러를 저장값과 picker 값에서 바꾸지 않으면서, 글자가 놓이는 렌더링 면만 가까운 파생색으로 만드는 것은 데이터 계약을 깨지 않는다.
5. 수동 `onKey`는 사용자가 exact 면과 글자 조합을 직접 확정한 값이다. 이 경우 자동으로 배경까지 바꾸면 R-008의 사용자 통제권과 실제 대비 경고 의미가 깨진다.
6. R-011에서 사용한 APCA는 현상의 방향을 설명하는 연구 증거지만 W3C 규범이 아니며, 이번 동작은 기존 상대 휘도 계산만으로 결정적으로 구현할 수 있다.

## 5. 확정 제품 계약

### 5.1 변하지 않는 우선순위

1. 내장 테마는 resolver를 우회하고 2.5.5의 exact palette를 반환한다.
2. 사용자 테마의 저장 `colors.key`와 resolved `keySurface`는 입력한 canonical `#RRGGBB` 그대로다.
3. 수동 `colors.overrides.onKey`가 있으면 `keyTextSurface = keySurface`로 두고 수동 글자색과 raw exact 면의 실제 대비를 진단한다. 낮은 대비도 경고 후 저장·출력한다.
4. 수동값이 `null`일 때만 아래 자동 결정을 실행한다.
5. 자동 결과는 최종 양자화된 실제 렌더링 조합에서 항상 WCAG `4.5:1` 이상이어야 한다. 만족하지 못하면 내부 오류가 아니라 검증된 기존 selector 결과로 fallback한다.

### 5.2 1단계 — exact 면의 기존 안전 후보

1. `keySurface`에서 현재 `automaticOnKey()`와 동일한 후보·선호 순서로 `exactCandidate`를 구한다.
2. 기존 7:1 후보 우선과, 7:1 후보가 없을 때 4.5:1 이상 후보 중 최대 대비를 고르는 동작을 보존한다.
3. `contrastRatio(exactCandidate, keySurface) >= 4.5`를 반올림 전 값으로 확인한다.

이 결과는 지각 보정의 비교 대상이자 모든 실패 경로의 fallback이다. 기존 24-bit 자동 안전 불변식은 이 단계로 보존한다.

### 5.3 2단계 — 흰 글자용 파생 면 시도 조건

다음 조건을 모두 만족할 때만 흰 글자용 `keyTextSurface` 보정을 시도한다.

```text
manualOnKey == null
contrastRatio(#FFFFFF, keySurface) >= 3
edgeSignal(#FFFFFF, keySurface) > edgeSignal(exactCandidate, keySurface)
```

- 비교는 반올림 전 상대 휘도로 수행하고 `>`를 사용한다. 동률은 기존 selector를 유지한다.
- raw 흰색의 3:1 조건은 보정 대상을 큰 글자 최소 대비에도 미달하는 조합까지 넓히지 않기 위한 진입 제한이다. 최종 채택 기준은 여전히 4.5:1이다.
- 조건이 하나라도 거짓이면 `keyTextSurface = keySurface`, `onKey = exactCandidate`다.

### 5.4 3단계 — 결정적 `keyTextSurface` 탐색

1. canonical `keySurface`를 OKLCH로 변환한다.
2. 원본 hue와 chroma를 유지하고 lightness만 아래 방향으로 탐색한다. sRGB gamut 밖에서는 기존 hue 보존 gamut mapping 규칙으로 필요한 만큼만 chroma를 줄인다.
3. `L = 0`과 원본 L 사이에서 **36회** 이분탐색해, 8-bit sRGB `#RRGGBB`로 양자화한 뒤 흰색과 `4.5:1` 이상인 범위 중 원본에 가장 가까운 가장 높은 L을 찾는다.
4. 이분탐색 결과를 양자화한 실제 HEX가 `4.5:1`에 미달하면 L을 한 번에 `0.0005`씩 최대 **100회** 낮추며 다시 양자화한다.
5. 최종 HEX에서 다음 두 조건을 반올림 전에 다시 검사한다.

```text
contrastRatio(#FFFFFF, keyTextSurface) >= 4.5
deltaEOK(keySurface, keyTextSurface) <= 0.02
```

`deltaEOK`는 두 canonical HEX를 OKLab으로 변환한 뒤 계산한 유클리드 거리 `sqrt(ΔL² + Δa² + Δb²)`다. 표시용 반올림값으로 채택 여부를 바꾸지 않는다.

6. 두 조건을 모두 만족하면 `onKey = #FFFFFF`와 파생 `keyTextSurface`를 채택한다.
7. 탐색·gamut mapping·양자화·재검사 중 하나라도 유효한 결과를 만들지 못하거나 색차가 `0.02`를 넘으면 `keyTextSurface = keySurface`, `onKey = exactCandidate`로 fallback한다.

같은 canonical 입력은 iteration 수, step, 후보 순서와 최종 재검사가 고정되어 항상 같은 HEX와 결정 상태를 반환해야 한다.

### 5.5 렌더링과 설명

- `keyTextSurface`는 persisted theme이나 JSON에 넣지 않는 resolved-only 의미 토큰이다.
- 표지 상단, 태그, 코드 블록 등 `onKey` 글자가 실제로 놓이는 key 면은 미리보기와 PDF renderer에서 같은 `keyTextSurface`를 사용한다.
- `keySurface`는 사용자가 고른 seed와 다른 파생 토큰 계산의 기준으로 남는다. picker와 저장 JSON은 계속 이 exact 값을 보여준다.
- 자동 보정이 적용됐을 때는 초보자용 진단에 “글자가 있는 면만 가까운 색으로 자동 조정”했다는 사실과 seed/applied HEX, 최종 WCAG 비율을 표시한다. 이를 “WCAG 준수 PDF” 또는 “모든 사람에게 가장 잘 보이는 색”이라고 표현하지 않는다.
- 자동 보정이 적용되지 않았거나 fallback한 경우 기존 exact 면 진단을 유지한다.
- `onKey` 사용자 옵션, 글자 크기별 토큰과 APCA 점수는 추가하지 않는다.

## 6. 대안과 기각 사유

| 대안 | 장점 | 위험/기각 사유 | 재검토 조건 |
|---|---|---|---|
| WCAG 수치가 가장 높은 exact 전경만 계속 사용 | 구현과 설명이 가장 단순 | R-011에서 확인한 경계 지각 역전을 자동 추천에 전혀 반영하지 못함 | 파생 면이 실제 출력에서 브랜드 불일치를 만든다는 반복 증거가 나올 때 |
| `#D709D1` 같은 특정 HEX 예외표 | 결과를 쉽게 고정 | 일반화되지 않고 유지보수·설명 가능성이 나쁨 | 기각 |
| WCAG 3:1이면 raw 흰색을 그대로 자동 사용 | seed 불변, 흰 글자 현저성 보존 | 작은 kicker·tag의 4.5:1 하드 게이트 위반 | 해당 면에서 일반 크기 글자를 완전히 제거할 때 |
| `onKeySmall`/`onKeyDisplay` 분리 | 크기별 임계값을 직접 반영 | 같은 면의 글자색 불일치와 UI·renderer 복잡도 증가 | 사용자 테스트에서 단일 토큰이 반복적으로 실패할 때 |
| APCA를 두 번째 runtime 점수로 도입 | 대비 극성을 직접 모델링 | 비규범 public beta, dependency·버전·설명·Review 표면 증가 | 표준화 상태와 제품 요구가 별도 R 문서로 확정될 때 |
| key seed 자체를 저장 시 어둡게 변경 | renderer 구조가 단순 | picker/JSON의 사용자 입력을 몰래 바꾸고 R-008 계약 위반 | 사용자가 명시적으로 surface 변경을 저장하는 별도 기능을 요구할 때 |
| 수동 override에도 면 보정 적용 | 일부 저대비 조합 자동 개선 | 사용자의 확정 조합과 경고 수치를 바꿈 | 법적 강제 프로필을 별도 설계할 때 |

## 7. 한계와 미해결 질문

- `edgeSignal`은 화면 지각 보정의 제한적 trigger이며 읽기 속도·오독률·장문 피로를 직접 예측하지 않는다.
- `deltaEOK <= 0.02`는 seed와 파생 면의 차이를 제한하는 제품 경계다. 모든 브랜드의 공식 색상 허용 오차를 대신하지 않는다.
- 실제 인쇄는 프린터, 종이, 색 관리와 주변광의 영향을 받는다. 화면 sRGB 계산과 같은 체감을 보장하지 않는다.
- Windows/macOS와 서로 다른 패널에서 결과 방향은 같아야 하지만 안티앨리어싱된 획의 현저성 크기는 달라질 수 있다.
- 실제 사용에서 보정 면이 지나치게 달라 보이거나 fallback이 잦다는 반복 증거가 나오면 threshold를 조용히 바꾸지 않고 새 R 문서로 재검토한다.

## 8. 구현 영향

- `ResolvedEditorialPdfPalette`에 persisted되지 않는 `keyTextSurface`를 추가하고, custom renderer·미리보기·진단이 같은 resolved snapshot을 사용한다.
- settings version, `EditorialPdfThemeV1`, JSON exchange schema와 사용자 ID에는 변경이 없다.
- 자동 불변식의 key 면은 `contrastRatio(onKey, keyTextSurface) >= 4.5`로 검사한다. 수동 진단은 exact `keySurface`를 사용한다.
- `accentOnKey`처럼 같은 text-bearing key 면에 놓이는 자동 글자도 최종 적용 배경에 대한 기존 대비 불변식을 잃지 않아야 한다.
- 내장 palette에는 기존 key surface와 같은 resolved 값을 제공하되 renderer 결과는 2.5.5와 exact match해야 한다.
- APCA package, 새 runtime dependency, network, clipboard, filesystem 또는 process 권한을 추가하지 않는다.
- R-010 5절의 “`#D709D1`에는 검정을 최종 자동 추천하고 key 면을 바꾸지 않는다”는 결정을 이 문서의 제한적 파생 면 계약으로 대체한다. R-011의 측정 사실과 R-008의 수동 override 계약은 유지한다.
- resolver 변경 뒤 기존 `35bce95` Preview 결과는 최종 후보 근거로 재사용하지 않는다. R-009에 따라 새 2.5.6 SHA를 Windows/macOS CI와 Community Preview로 다시 검사한다.

## 9. 검증 조건

### 자동 테스트

- `#D709D1`: 진입 조건이 참이고, 저장 seed는 exact이며, 최종 흰색/`keyTextSurface`가 `4.5:1` 이상·`deltaEOK <= 0.02`를 만족한다.
- raw 흰색이 3:1 미만인 밝은 노랑: 보정을 시도하지 않고 기존 어두운 안전 후보와 exact 면을 유지한다.
- 흰색 edge가 기존 후보보다 크지 않은 색과 strict 동률: 기존 exact selector 결과를 유지한다.
- 유효 후보가 색차 `0.02`를 넘거나 36회 탐색과 100회 보정 뒤에도 최종 양자화 대비가 미달하면 exact fallback한다.
- 수동 `onKey`: `keyTextSurface === keySurface`, 수동 HEX 보존, raw exact 면 비율·경고와 저장/출력 허용을 확인한다.
- 내장 테마: key 면·9색·CSS·DOM exact regression을 확인한다.
- 최종 양자화 HEX로 ratio와 `deltaEOK`를 계산하며 threshold 비교 전에 반올림하지 않는다.
- 같은 입력과 override 상태를 반복해 byte-identical palette와 진단을 얻는다.
- seeded 색 matrix와 전체 24-bit release script에서 모든 자동 결과의 `contrast(onKey, keyTextSurface) >= 4.5` 및 fallback 완전성을 확인한다.
- preview와 renderer가 같은 `keyTextSurface/onKey` 조합을 사용하며 기존 PDF 인쇄 생명주기 회귀가 없음을 확인한다.

### 수동·릴리스 테스트

- `#D709D1`, 딥네이비, 노랑, 중간 회색, 흰색·검정·원색과 수동 저대비 override를 실제 크기의 표지·태그·코드 블록으로 비교한다.
- Windows/macOS, Obsidian light/dark UI, 인쇄 미리보기와 저장 PDF에서 seed와 파생 면 안내 및 실제 출력이 일치하는지 확인한다.
- 전체 로컬 게이트와 두 OS CI를 통과한 새 SHA만 Community Preview에 제출한다.
- Errors 0, Warnings 1 이하, 기존 `Shell Execution / child_process` 외 신규 Warning 0, Review 3/4 이상을 확인한 같은 SHA만 `2.5.6` tag 후보로 삼는다.

### 완료 기준

- WCAG 4.5:1 하드 게이트, 지각 보정 trigger, 색차 제한과 fallback이 한 순수 resolver에서 결정적으로 재현된다.
- 사용자 seed·수동 override·내장 2.5.5 출력은 변하지 않는다.
- 보정 사실과 실제 적용 대비를 미리보기·Export에서 숨기지 않는다.
- R-006, R-009, R-010의 적용 가능한 검증 게이트를 다시 통과한다.

## 10. 출처

- 저장소 소스: `src/io/editorialPdfTheme.ts`, `src/ui/EditorialPdfThemeManagerModal.ts`, `src/io/editorialPdf.ts`
- 연구 근거: R-004, R-008, R-010, R-011
- 사용자 결정: 2026-08-10 결정적 지각 보정 계획 승인
- W3C WCAG 2.2 Contrast Minimum: https://www.w3.org/TR/WCAG22/#contrast-minimum
- W3C Understanding SC 1.4.3: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- CSS Color 4 Oklab/OKLCH: https://www.w3.org/TR/css-color-4/#ok-lab

## 11. 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-08-10 | WCAG hard gate, edgeSignal trigger, 제한적 `keyTextSurface` 보정, 수동·내장 bypass와 exact fallback을 최종 제품 계약으로 등록 |
