function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Pure reference rewrite kept separate from Obsidian so it is portable and unit-testable. */
export function rewriteImportedImageReference(
  markdown: string,
  originalFilename: string,
  obsidianEmbed: string
): { markdown: string; replacements: number } {
  const candidates = new Set([
    originalFilename,
    originalFilename.replace(/\\/g, "/"),
    `./${originalFilename.replace(/\\/g, "/")}`,
    encodeURI(originalFilename.replace(/\\/g, "/"))
  ]);
  let output = markdown;
  let replacements = 0;

  for (const candidate of candidates) {
    const escaped = escapeRegExp(candidate);
    const markdownImage = new RegExp(
      `!\\[[^\\]]*\\]\\(<?${escaped}>?(?:\\s+["'][^"']*["'])?\\)`,
      "g"
    );
    output = output.replace(markdownImage, () => {
      replacements++;
      return obsidianEmbed;
    });

    const htmlImage = new RegExp(`<img\\b[^>]*\\bsrc=["']${escaped}["'][^>]*>`, "gi");
    output = output.replace(htmlImage, () => {
      replacements++;
      return obsidianEmbed;
    });
  }

  return { markdown: output, replacements };
}

