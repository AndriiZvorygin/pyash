import { splitSentences } from "../../../library/sentenceSplitter.mjs";

const SOURCE_MAP_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function sentenceLineNumbersFromText(sourceText) {
  const sentences = splitSentences(sourceText);
  const lines = [];
  let searchIndex = 0;
  let fallbackLine = 1;
  for (const sentence of sentences) {
    const pos = sourceText.indexOf(sentence, searchIndex);
    if (pos === -1) {
      lines.push(fallbackLine);
      continue;
    }
    const line = sourceText.slice(0, pos).split("\n").length;
    lines.push(line);
    fallbackLine = line;
    searchIndex = pos + sentence.length;
  }
  return lines;
}

function encodeVlq(value) {
  let vlq = value < 0 ? ((-value) << 1) + 1 : (value << 1);
  let out = "";
  do {
    let digit = vlq & 31;
    vlq >>>= 5;
    if (vlq > 0) digit |= 32;
    out += SOURCE_MAP_CHARS[digit];
  } while (vlq > 0);
  return out;
}

function buildSourceMappings(lineMappings = []) {
  let prevSourceLine = 0;
  let mappings = "";
  for (let i = 0; i < lineMappings.length; i += 1) {
    if (i > 0) mappings += ";";
    const sourceLine = lineMappings[i];
    if (sourceLine == null) continue;
    const sourceLineZero = Math.max(0, Number(sourceLine) - 1);
    const seg = encodeVlq(0) + encodeVlq(0) + encodeVlq(sourceLineZero - prevSourceLine) + encodeVlq(0);
    mappings += seg;
    prevSourceLine = sourceLineZero;
  }
  return mappings;
}

function inlineSourceMap(code, { sourceName, sourceText } = {}) {
  const lines = String(code).split("\n");
  const output = [];
  const mappings = [];
  let currentSourceLine = null;
  for (const line of lines) {
    const match = line.match(/^\/\/ @pyash-line (\d+)\s*$/);
    if (match) {
      currentSourceLine = Number(match[1]) || null;
      continue;
    }
    output.push(line);
    mappings.push(currentSourceLine);
  }
  const map = {
    version: 3,
    file: sourceName ?? "",
    sources: [sourceName ?? "<pyash>"],
    sourcesContent: sourceText ? [sourceText] : [],
    names: [],
    mappings: buildSourceMappings(mappings)
  };
  const encoded = Buffer.from(JSON.stringify(map)).toString("base64");
  output.push(`//# sourceMappingURL=data:application/json;base64,${encoded}`);
  return output.join("\n");
}

export { sentenceLineNumbersFromText, inlineSourceMap };
