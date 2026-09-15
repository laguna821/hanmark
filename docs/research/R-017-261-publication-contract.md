# R-017 — HanMark 2.6.1 정식 배포 계약

- 상태: REQUIRED (배포 절차), 후보 검증은 CONFIRMED
- 작성일: 2026-09-15
- 기준: 공개 2.5.6 `11649b84ef5983f78ec3a4cc1ed69ab7bd86e651`, 2.6.1 후보 `3d16b001ee7a8a316efc48f88b6d03634fd03375`
- 관련 연구: R-009, R-014, R-015, R-016

## 1. 질문과 범위

사용자가 승인한 2.6.1을 버전별 개발 이력과 Community 업데이트 계약을 보존하면서 정식 게시한다. 사용자의 후속 요청은 후보 커밋·push만 허용했던 R-016 범위를 태그·Release·기본 브랜치 전환까지 확장한다. 과거 브랜치/태그 수정, 별도 홍보 메시지, macOS 실기 검증은 포함하지 않는다.

## 2. 확인된 증거

| 증거 | 관찰 | 한계 |
|---|---|---|
| Git 원격·GitHub Releases API | 기본 브랜치와 최신 공개 Release는 2.5.6. 개발 브랜치 2.6.1은 후보 SHA와 일치하며 태그는 아직 없다. | 게시 전 관찰 |
| 후보 CI | [34949231662](https://github.com/laguna821/hanmark/actions/runs/34949231662)에서 Windows/macOS/Ubuntu 모두 성공 | 최종 문서 커밋 후 같은 SHA 검사를 다시 실행 |
| Community Review branch | 후보 SHA의 Preview Completed, Dependencies Pass, No vulnerable dependencies found | 현재 preview는 공개 Review 점수나 전체 release 검사 수치를 표시하지 않음. 보이지 않는 점수는 추정하지 않음 |
| 공식 obsidian-releases | 기본 브랜치 manifest로 최신 버전을 찾고 동일 버전 tag의 Release에서 세 파일 다운로드 | 존재하지 않는 Release를 가리키는 manifest를 먼저 노출하면 안 됨 |
| 공식 Community 관리 문서 | Review branch는 SHA를 허용. More actions의 Check for new releases로 새 버전 탐색, Request review로 재검사 | release 결과는 게시 후 확인해야 함 |

## 3. 배포 결정과 검증 순서

1. 기존 2.6.1 개발 브랜치에 정식 릴리스 문서만 추가 커밋하고 push한다. 버전 번호는 2.6.1로 유지한다.
2. 최종 SHA에서 3 OS CI와 Community Review branch를 완료한다. CI는 단위·타입·빌드·Community guard·전체/배포 의존성 감사·PDF 렌더링·저장 UI를 검사한다. 신규 오류/경고가 있으면 태그 전에 수정한다.
3. 통과한 동일 SHA에 annotated tag `2.6.1`을 만들고 해당 태그만 push한다. Actions는 태그를 checkout하여 3 OS 검증을 반복하고 Linux에서 자산을 빌드·증명·게시한다.
4. 정식 Release의 tag SHA, 버전, 정확히 세 첨부 파일 `main.js`, `manifest.json`, `styles.css`, SHA-256과 attestation을 확인한다. 로컬 ZIP·개인 시험 PDF는 GitHub Release에 첨부하지 않는다.
5. Community의 새 Release 확인을 요청한다. 검사 대상 탐색에 새 기본 manifest가 필요하면 자산 검증 완료 후 GitHub 기본 브랜치를 2.5.6에서 2.6.1로 전환한다. 과거 브랜치의 커밋은 변경하지 않는다.
6. 공개 Community 버전과 release scan을 확인한다. 보이는 검사 결과에 오류 또는 기존 Shell Execution 이외 신규 경고가 있거나 공개 Review가 Satisfactory 아래로 내려가면 완료로 보고하지 않는다. 필요한 경우 기본 브랜치를 2.5.6으로 복원한다.

R-009의 2.5.6 게시 당시 순서 중 "release scan 후 default branch"는 현재 서비스가 기본 manifest를 먼저 요구하는 경우 위 5번으로 조정한다. Release 자산 준비가 기본 브랜치 변경에 선행한다는 원칙은 유지한다. Preview에 표시되지 않는 점수를 임의로 통과 처리하지 않는다.

## 4. 한계와 복구

- macOS 실기 미검증은 사용자 결정에 따른 공개 제한 사항이다. macOS CI는 생략하지 않는다.
- Obsidian 앱의 실제 업데이트 클릭과 Community/Release 다운로드 경로 검증은 구분한다. 앱에서 실행하지 않은 검증은 주장하지 않는다.
- 태그 후 일시적인 Actions 장애는 같은 workflow를 재실행할 수 있다. 코드 결함은 태그/자산을 교체하지 않고 다음 버전 브랜치에서 수정한다.
- 기존 공개 버전과 개인 원고는 보존한다. 개인 경로·본문·인증 정보는 공개 기록에 포함하지 않는다.
- 최종 SHA를 포함한 게시 결과·Actions URL·자산 해시·Community 결과는 Git에서 제외한 `dist-plugin/publication-verification-2.6.1.json`과 사용자 완료 보고에 남긴다. 태그가 가리키는 릴리스 커밋을 사후 검증 기록 때문에 변경하지 않는다.

## 5. 출처

- https://github.com/obsidianmd/obsidian-releases#how-community-plugins-are-pulled
- https://github.com/obsidianmd/obsidian-sample-plugin/blob/master/README.md
- https://docs.obsidian.md/community-directory/manage-entry
- https://docs.obsidian.md/community-directory/submission-requirements-for-plugins
- CONTRIBUTING.md, .github/workflows/ci.yml, .github/workflows/release.yml
- 사용자 정식 브랜치·Release 게시 요청 (2026-09-15)

## 6. 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-09-15 | 후보 검증 결과, 정식 배포 승인, 현행 Community 탐색 절차와 배포·복구 계약 기록 |
