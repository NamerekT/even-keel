// Huly's editor schema lets a code mark stand alone only: inline code inside bold,
// italics, strikethrough or a link breaks the whole document in the editor.

const HOLE = "\u0000";

const MARKED = [
  /\*\*(?=\S)(?:(?!\*\*)[^])*?\u0000(?:(?!\*\*)[^])*?\*\*/g,
  /(?<![\w_])__(?=\S)(?:(?!__)[^])*?\u0000(?:(?!__)[^])*?__(?![\w_])/g,
  /(?<!\*)\*(?![\s*])[^*]*?\u0000[^*]*?(?<![\s*])\*(?!\*)/g,
  /(?<![\w_])_(?![\s_])[^_]*?\u0000[^_]*?(?<![\s_])_(?![\w_])/g,
  /~~[^~]*?\u0000[^~]*?~~/g,
  /\[[^\]]*?\u0000[^\]]*?\]\(/g,
];

/** Each fragment of `text` where inline code sits inside another mark, as written. */
export function codeInsideMarks(text) {
  const found = [];
  const prose = text.replace(/^ {0,3}(`{3,}|~{3,})[^]*?^ {0,3}\1[^\n]*$/gm, "");
  for (const paragraph of prose.split(/\n\s*\n/)) {
    const spans = [];
    const holed = paragraph.replace(/(`+)(?!`)[^]*?(?<!`)\1(?!`)/g, (span) => {
      spans.push(span);
      return HOLE;
    });
    for (const pattern of MARKED) {
      for (const match of holed.matchAll(pattern)) {
        let i = 0;
        const before = holed.slice(0, match.index).split(HOLE).length - 1;
        found.push(match[0].replace(/\u0000/g, () => spans[before + i++]));
      }
    }
  }
  return found;
}

/** Offending fragments across every string in a tool input. */
export function offendersIn(value) {
  if (typeof value === "string") return codeInsideMarks(value);
  if (value && typeof value === "object") return Object.values(value).flatMap(offendersIn);
  return [];
}
