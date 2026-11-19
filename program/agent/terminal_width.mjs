const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const combiningOnly = /^[\p{Mark}\p{Format}]+$/u;

function isWideCodePoint(codePoint) {
  return codePoint >= 0x1100 && (
    codePoint <= 0x115f
    || codePoint === 0x2329
    || codePoint === 0x232a
    || (codePoint >= 0x2e80 && codePoint <= 0xa4cf)
    || (codePoint >= 0xac00 && codePoint <= 0xd7a3)
    || (codePoint >= 0xf900 && codePoint <= 0xfaff)
    || (codePoint >= 0xfe10 && codePoint <= 0xfe6f)
    || (codePoint >= 0xff00 && codePoint <= 0xff60)
    || (codePoint >= 0xffe0 && codePoint <= 0xffe6)
    || (codePoint >= 0x1f300 && codePoint <= 0x1faff)
    || (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  );
}

export function splitTerminalGraphemes(value = "") {
  const text = String(value ?? "");
  return [...segmenter.segment(text)].map(({ segment, index }) => ({ segment, index }));
}

function graphemeWidth(grapheme) {
  if (!grapheme || combiningOnly.test(grapheme)) return 0;
  if (grapheme.includes("\u200d") || grapheme.includes("\ufe0f") || /\p{Regional_Indicator}{2}/u.test(grapheme)) return 2;
  let width = 0;
  for (const character of grapheme) {
    const codePoint = character.codePointAt(0);
    if (/^[\p{Mark}\p{Format}]$/u.test(character)) continue;
    width = Math.max(width, isWideCodePoint(codePoint) ? 2 : 1);
  }
  return width;
}

export function terminalGraphemeWidth(grapheme = "") {
  return graphemeWidth(String(grapheme ?? ""));
}

export function terminalCellWidth(value = "") {
  return splitTerminalGraphemes(value)
    .reduce((width, { segment }) => width + graphemeWidth(segment), 0);
}

export function truncateTerminalText(value = "", maxWidth = 0, ellipsis = "…") {
  const text = String(value ?? "");
  const limit = Math.max(0, Number(maxWidth) || 0);
  if (terminalCellWidth(text) <= limit) return text;
  const markerWidth = terminalCellWidth(ellipsis);
  const contentLimit = Math.max(0, limit - markerWidth);
  let result = "";
  let width = 0;
  for (const { segment } of splitTerminalGraphemes(text)) {
    const segmentWidth = graphemeWidth(segment);
    if (width + segmentWidth > contentLimit) break;
    result += segment;
    width += segmentWidth;
  }
  return `${result}${terminalCellWidth(ellipsis) <= limit ? ellipsis : ""}`;
}
