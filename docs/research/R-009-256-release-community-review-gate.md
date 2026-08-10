# R-009 — HanMark 2.5.6 릴리스와 Community Review 게이트

- 상태: REQUIRED
- 작성일: 2026-08-10
- 최종 갱신: 2026-08-10
- 기준 버전/커밋: HanMark 2.5.5 / 728b2b3495822a667417561ba0d55f9ee3cf7733
- 관련 문서: R-006, R-008, R-012
- 담당 범위: GitHub branch/tag/Release, Obsidian Community 자동 검사

## 1. 조사 질문

2.5.6을 배포하면서 현재 Review 3/4칸과 Warning 1개를 악화시키지 않고, 사용자에게 존재하지 않는 Release 자산을 노출하는 시간대도 만들지 않으려면 어떤 순서와 중단 조건이 필요한가?

## 2. 범위

### 포함

- `2.5.6` 원격 브랜치, annotated tag와 GitHub Release
- Community Dashboard branch preview와 release scan
- GitHub 기본 브랜치 `2.5.5`에서 `2.5.6`으로 전환
- 실패 시 중단·복구 정책

### 제외

- 과거 `main`, 기존 버전 브랜치와 기존 태그 변경
- Scorecard 비공개 산식 추정
- 사용자 인증 없이 Community Dashboard 조작

## 3. 조사 방법과 증거

| 증거 | 유형 | 재현 또는 위치 | 신뢰도/한계 |
|---|---|---|---|
| 원격 기본 브랜치 | Git | `git ls-remote --symref origin HEAD` | 2026-08-10 실시간 확인 |
| 공개 HanMark Scorecard | 외부 서비스 | `https://community.obsidian.md/plugins/hanmark` | 공개 latest release 결과 |
| Community account URL | 외부 서비스 | 비로그인 요청 시 307 login redirect | 상세 preview는 사용자 로그인 필요 |
| 자동 검사 정책 | 공식 문서 | Obsidian “The future of plugins” | 산식은 공개되지 않음 |
| 플러그인 배포 규칙 | 공식 저장소 | `obsidianmd/obsidian-releases` | manifest/tag/assets 계약 |
| 이전 2.5.6 Preview | 사용자 Dashboard 확인 | commit `35bce95b5d7112f2b9d3d923a008c563db7ffa01` | Preview 통과는 확인했으나 Errors·Warnings·Review 세부 수치는 기록되지 않음. 후속 R-012 resolver 변경 전 결과임 |

## 4. 확인된 현재 기준선

- 원격 기본 브랜치: `2.5.5`
- 원격 기본 SHA: `728b2b3495822a667417561ba0d55f9ee3cf7733`
- literal `main`: 1.1.0 계열의 과거 ref이며 변경 대상이 아니다.
- 최신 Release/tag: `2.5.5`
- Release 자산: `main.js`, `manifest.json`, `styles.css`
- 공개 Review: `Satisfactory`, 4칸 중 3칸
- 공개 자동 검사 이슈: Warning 1개
- 유일한 Warning: `Shell Execution` — `child_process`
- account dashboard는 로그인하지 않으면 `/auth/login`으로 307 redirect된다.
- 원격에 먼저 올린 2.5.6 후보 `35bce95b5d7112f2b9d3d923a008c563db7ffa01`은 사용자 Dashboard에서 Preview 통과를 확인했다. 다만 세부 Errors·Warnings·Warning rule·Review·막대 값은 이 기록에서 확인하지 못했으므로 추정하지 않는다.
- 그 뒤 R-012의 자동 `keyTextSurface` resolver와 renderer·UI가 변경됐다. 따라서 `35bce95` Preview는 이전 후보의 이력일 뿐 최종 2.5.6 release evidence로 재사용할 수 없다.

## 5. 필수 배포 순서

1. 로컬과 Windows/macOS CI를 모두 통과한 `2.5.6` 브랜치만 먼저 push한다.
2. 같은 날 `2.5.5`와 최종 `2.5.6` SHA를 Dashboard preview scan한다.
3. Errors 0, Warnings 1 이하, 기존 Shell Execution 외 신규 Warning 0, Review 3/4 이상을 모두 확인한다.
4. 통과한 동일 SHA에 annotated tag `2.5.6`을 만들고 tag workflow로 Release를 생성한다.
5. 정확히 세 자산과 attestation, manifest/version을 확인한다.
6. 자동 2.5.6 release scan 통과 후 GitHub 기본 브랜치를 `2.5.6`으로 바꾼다.
7. 공개 페이지와 Obsidian 앱에서 2.5.6 설치·업데이트와 Scorecard를 다시 확인한다.

Release를 기본 브랜치 변경보다 먼저 생성한다. Obsidian이 기본 브랜치의 manifest version을 읽고 같은 이름의 tag Release 자산을 받으므로, 이 순서가 자산이 없는 최신 버전 노출을 막는다.

`35bce95`의 이전 Preview 통과는 후속 resolver 변경으로 대체됐다. 최종 후보는 모든 문서·코드·bundle 변경을 포함한 새 SHA에서 CI와 Dashboard Preview를 처음부터 다시 통과해야 한다.

## 6. 릴리스 중단 조건

- Dashboard preview 또는 자동 release scan 결과가 아직 없음
- Errors가 하나라도 존재
- Warning이 2개 이상이거나 기존 Shell Execution 이외의 rule이 추가됨
- Review가 2/4 이하 또는 `Satisfactory` 미만
- 2.5.5와 같은 날 비교했을 때 기존 pass rule이 사라짐
- Release 세 자산·attestation·version 중 하나라도 불일치

## 7. 실패와 복구

- tag 전 실패는 `2.5.6` additive commit으로 수정한다. force-push/rebase하지 않는다.
- tag 후 일시적 Actions 장애만 동일 workflow를 재실행한다.
- tag 후 코드·검사 결함은 tag나 자산을 교체하지 않고 기본 브랜치를 2.5.5로 유지·복원한 뒤 2.5.7로 수정한다.
- Scorecard 오탐은 SHA와 rule을 기록하고 공식 `#plugin-dev` 채널에 보고한다.

## 8. Community scan 기록

| 시각(KST) | 대상 | SHA | Errors | Warnings | Warning rule | Review | 막대 | 결과 |
|---|---|---|---:|---:|---|---|---:|---|
| 2026-08-10 공개 기준 | 2.5.5 release | 728b2b3495822a667417561ba0d55f9ee3cf7733 | 0 | 1 | Shell Execution / child_process | Satisfactory | 3/4 | 기준선 |
| 2026-08-10 | 2.5.6 preview (대체됨) | 35bce95b5d7112f2b9d3d923a008c563db7ffa01 | 미확인 | 미확인 | 미확인 | 미확인 | 미확인 | Preview 통과 확인. R-012 후속 변경으로 릴리스 근거 재사용 금지 |
| PENDING | 2.5.5 preview | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | 태그 전 필요 |
| PENDING | 2.5.6 preview | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | 태그 전 필요 |
| PENDING | 2.5.6 release | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | 기본 브랜치 전 필요 |

## 9. 구현 영향

- CI branch, release tag/title/notes와 version files를 2.5.6으로 함께 고정한다.
- release checker가 CI branch pin도 검사하게 한다.
- 새 테마 기능은 runtime dependency, network, clipboard, direct filesystem, process boundary를 추가하지 않는다.
- ESLint warning 0과 Community Warning 1은 별도 지표로 기록한다.
- R-012 resolver 변경은 새 runtime dependency나 권한을 추가하지 않지만 최종 bundle과 렌더링 동작이 달라지므로, 이전 SHA의 Preview 통과를 승계하지 않고 새 SHA를 다시 검사한다.

## 10. 출처

- https://obsidian.md/blog/future-of-plugins/
- https://github.com/obsidianmd/obsidian-releases#how-community-plugins-are-pulled
- https://help.obsidian.md/Extending+Obsidian/Plugin+security
- https://community.obsidian.md/plugins/hanmark
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-branches-in-your-repository/changing-the-default-branch

## 11. 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-08-10 | 2.5.5 공개 기준선과 2.5.6 preview/release/default-branch 필수 게이트 등록 |
| 2026-08-10 | `35bce95` Preview 통과 이력과 세부 수치 미확인을 기록하고, R-012 후속 resolver 변경 때문에 최종 릴리스 근거로 재사용하지 않도록 명시 |
