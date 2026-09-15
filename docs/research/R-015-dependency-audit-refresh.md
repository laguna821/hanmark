# R-015 — 2.6.0 개발 중 발견한 의존성 감사 갱신

- 상태: REQUIRED
- 작성일: 2026-09-15
- 관련 연구: R-009, R-014
- 기준: 2.5.6 잠금 파일에서 시작한 2.6.0 개발 브랜치

## 질문·증거

필수 `npm audit --omit=dev --omit=optional` 실행에서 기존 의존성의 7개 직접·전이 취약점 보고가 확인되었다. 기존 R-009의 과거 감사 통과는 현재 통과를 뜻하지 않는다. npm 감사와 패키지 레지스트리, 아래 공식 공지를 대조했다.

## 수정 결정

Kordoc 4.2.5와 Markdown-it 14.3.0을 유지한다. xmldom은 같은 0.8 계열의 0.8.15로, fast-uri override는 같은 3.x 계열의 3.1.7로, hono는 4.13.7로 갱신한다. qs 6.16.0을 고정해 전이 경로를 함께 정리한다. PDF 동작 변경과 독립된 감사 수정이다.

## 검증·한계

잠금 파일 재설치 후 배포 의존성 감사, 전체 단위 테스트, 타입·번들·Community·릴리스 검사를 다시 실행한다. 엔진의 새로운 API나 네이티브 선택 모듈은 도입하지 않는다. npm 감사 통과가 모든 보안 위험의 부재를 보장하지는 않는다.

## 출처

- https://github.com/xmldom/xmldom/releases/tag/0.8.15
- https://github.com/advisories/GHSA-5jgf-p345-68v8
- https://github.com/advisories/GHSA-gqvv-2mrq-wpjv
- https://github.com/advisories/GHSA-x5fp-wj9c-mxmx

## 변경 이력

2026-09-15: 새 감사 결과와 호환 계열 내 갱신 범위 기록.

검증 결과: 직접 xmldom 0.8.15, Kordoc 내부 xmldom 0.9.12(기존 0.9 계열 유지). 배포 의존성 감사 0건.


## 2.6.1 Community preview 후속 점검

2026-09-15의 첫 preview가 잠금 파일의 선택 의존성 sharp 0.35.3과 adm-zip 0.6.0에 추가 advisory를 보고했다. 배포 경로 감사 0건과 별개로 스캐너는 설치에서 제외된 선택 의존성도 읽는다. 같은 호환 계열의 sharp 0.35.4와 adm-zip 0.6.1을 override하고 check-release 기준도 일치시켰다. 이 모듈의 네이티브 실행 경로는 계속 번들에서 제거한다.

개발 의존성 감사에서 나온 brace-expansion과 js-yaml도 각 부모가 허용하는 버전 범위 안에서 잠금 파일을 갱신했다. Kordoc 4.2.5, Markdown-it 14.3.0과 직접 개발 도구 버전은 유지한다.

- https://github.com/advisories/GHSA-rgj7-g3m4-5g8c
- https://github.com/advisories/GHSA-vwc7-r8mq-g2x9
- https://github.com/advisories/GHSA-rgw5-rvv9-x895
- https://github.com/advisories/GHSA-2883-xcg3-v3hh

배포 감사와 개발 의존성 포함 npm audit 모두 0건으로 확인했다. 최종 잠금 파일의 Community preview는 같은 최종 커밋으로 다시 실행한다.
