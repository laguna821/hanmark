# Third-Party Notices

## English

### Kami

HanMark's **Achmage Editorial** HTML theme adapts selected document-design principles from [Kami](https://github.com/tw93/kami).

- Upstream project: Kami
- Upstream author and copyright: Copyright (c) 2026 Tw93
- Upstream license: [MIT License](https://github.com/tw93/kami/blob/main/LICENSE)
- HanMark use: a small, static, dependency-free adaptation of selected editorial layout and styling ideas

HanMark does not redistribute the Kami package, its template collection, Python or WeasyPrint build tools, example documents, Source Han font files, or commercial TsangerJinKai font files. Generated Achmage Editorial HTML includes a concise attribution comment and contains no external font, CDN, or script dependency.

The Kami project and its authors are not responsible for HanMark or for HanMark-generated documents.

#### MIT License text

Copyright (c) 2026 Tw93

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

### Pretendard

HanMark embeds Pretendard weights 400 and 600 in `styles.css` for the built-in
Editorial PDF layout.

- Upstream project: [Pretendard](https://github.com/orioncactus/pretendard)
- Upstream author and copyright: Copyright (c) 2021 Kil Hyung-Jin
- Distribution source: `@fontsource/pretendard` 5.3.0
- License: SIL Open Font License 1.1
- CSS family alias: `HanMark Pretendard`
- Weight 400 WOFF2 SHA-256: `fad853f7f47c6c8b103171e7193fa095708cdcd70850a71d93aa5379e8a61d63`
- Weight 600 WOFF2 SHA-256: `c863f76a7de5c1ddc1ed8b2fa794964530774592c4f31407a84e2a2ae93f17f0`

`scripts/gen-font-css.mjs` verifies the exact Fontsource package version,
license identifier, and both hashes before regenerating the stylesheet. The
font bytes are embedded unchanged. The complete SIL Open Font License 1.1 text
is copied into the generated Pretendard block in `styles.css`, immediately
before the two `@font-face` declarations.

---

## 한국어

### Kami

HanMark의 **Achmage Editorial** HTML 테마는 [Kami](https://github.com/tw93/kami)의 문서 디자인 원칙 일부를 응용했습니다.

- 원 프로젝트: Kami
- 원 저작자와 저작권: Copyright (c) 2026 Tw93
- 원 라이선스: [MIT License](https://github.com/tw93/kami/blob/main/LICENSE)
- HanMark의 사용 범위: 편집 레이아웃과 스타일 아이디어 일부를 작고 정적인 무의존성 테마로 재구성

HanMark는 Kami 패키지, 템플릿 모음, Python·WeasyPrint 빌드 도구, 예제 문서, Source Han 글꼴 파일 또는 상업용 TsangerJinKai 글꼴 파일을 재배포하지 않습니다. 생성된 Achmage Editorial HTML에는 간단한 저작자 표시 주석이 들어가며 외부 글꼴·CDN·스크립트 의존성이 없습니다.

Kami 프로젝트와 원 저작자는 HanMark 또는 HanMark가 생성한 문서에 책임을 지지 않습니다.

### Pretendard

HanMark는 내장 Editorial PDF 레이아웃을 위해 Pretendard 400·600 굵기를
`styles.css`에 포함합니다.

- 원 프로젝트: [Pretendard](https://github.com/orioncactus/pretendard)
- 원 저작자와 저작권: Copyright (c) 2021 Kil Hyung-Jin
- 배포 출처: `@fontsource/pretendard` 5.3.0
- 라이선스: SIL Open Font License 1.1
- CSS 글꼴 별칭: `HanMark Pretendard`
- 400 WOFF2 SHA-256: `fad853f7f47c6c8b103171e7193fa095708cdcd70850a71d93aa5379e8a61d63`
- 600 WOFF2 SHA-256: `c863f76a7de5c1ddc1ed8b2fa794964530774592c4f31407a84e2a2ae93f17f0`

`scripts/gen-font-css.mjs`는 스타일시트를 다시 만들기 전에 정확한 Fontsource
패키지 버전·라이선스 식별자·두 해시를 검증합니다. 글꼴 바이트는 변경하지
않고 포함하며, SIL Open Font License 1.1 전문은 두 `@font-face` 선언 바로
앞의 `styles.css` 생성 블록 안에 함께 기록합니다.
