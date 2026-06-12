import type { HwpSourceContract } from "./frontmatter";

export const HWP_CALLOUT_TAG = "hwp-source";

/**
 * A visible breadcrumb inserted at the top of an imported note. Stripped again
 * before patch/generate by extractEditableBody().
 */
export function renderSourceCallout(c: HwpSourceContract): string {
  const p = c["hwp-source"].replace(/\\/g, "/");
  return [
    `> [!${HWP_CALLOUT_TAG}] 원본: ${p}`,
    `> 한글 문서에서 불러온 노트입니다. **저장** 시 원본 서식 그대로 패치되거나(분기 A), 새 한글 파일이 생성됩니다(분기 B/C).`,
    "",
    ""
  ].join("\n");
}
