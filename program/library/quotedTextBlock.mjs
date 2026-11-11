function jsonBlockEnd(text, contentStart, kind) {
  let index = contentStart;
  while (/\s/u.test(text[index] ?? "")) index += 1;
  const first = text[index];
  if (first !== "{" && first !== "[") return null;

  const stack = [first === "{" ? "}" : "]"];
  let inString = false;
  let escaped = false;
  for (let cursor = index + 1; cursor < text.length; cursor += 1) {
    const character = text[cursor];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") stack.push("}");
    else if (character === "[") stack.push("]");
    else if (character === "}" || character === "]") {
      if (stack.pop() !== character) return null;
      if (stack.length === 0) {
        let suffixStart = cursor + 1;
        while (/\s/u.test(text[suffixStart] ?? "")) suffixStart += 1;
        const suffix = `.${kind}.quoted`;
        if (!text.startsWith(suffix, suffixStart)) return null;
        return { contentEnd: cursor + 1, end: suffixStart + suffix.length };
      }
    }
  }
  return null;
}

export function findQuotedTextBlock(text, fromIndex = 0) {
  const source = String(text ?? "");
  let cursor = Math.max(0, fromIndex);
  while (cursor < source.length) {
    const quoteIndex = source.indexOf('"', cursor);
    const markerIndex = source.indexOf("quoted.", cursor);
    if (markerIndex < 0) return null;
    if (quoteIndex >= 0 && quoteIndex < markerIndex) {
      cursor = skipQuotedString(source, quoteIndex);
      continue;
    }

    const match = /^quoted\.([^.]+)\.(?:contents\s*)?/u.exec(source.slice(markerIndex));
    if (!match) {
      cursor = markerIndex + 1;
      continue;
    }

    const contentStart = markerIndex + match[0].length;
    const kind = match[1];
    const jsonEnd = jsonBlockEnd(source, contentStart, kind);
    if (jsonEnd) {
      return { start: markerIndex, contentStart, contentEnd: jsonEnd.contentEnd, end: jsonEnd.end, kind };
    }

    const suffix = `.${kind}.quoted`;
    const close = source.indexOf(suffix, contentStart);
    if (close < 0) return null;
    return { start: markerIndex, contentStart, contentEnd: close, end: close + suffix.length, kind };
  }
  return null;
}

function skipQuotedString(source, start) {
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] === "\\") {
      index += 1;
    } else if (source[index] === '"') {
      return index + 1;
    }
  }
  return source.length;
}

export function replaceQuotedTextBlocks(text) {
  const source = String(text ?? "");
  const replacements = [];
  let working = "";
  let cursor = 0;
  while (cursor < source.length) {
    const block = findQuotedTextBlock(source, cursor);
    if (!block) break;
    const placeholder = `__QUOTED_BLOCK_${replacements.length}__`;
    working += source.slice(cursor, block.start) + placeholder;
    replacements.push({ placeholder, block: source.slice(block.start, block.end) });
    cursor = block.end;
  }
  working += source.slice(cursor);
  return { working, replacements };
}
