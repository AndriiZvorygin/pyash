export function fixPunctuationSpacing(text) {
  if (!text) return text;
  return text
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,.;:!?])(?=\S)/g, "$1 ");
}

export function normalizeSpeechText(text) {
  if (!text) return text;
  const collapsed = text.replace(/\s+/g, " ").trim();
  return fixPunctuationSpacing(collapsed);
}

export function appendSpeechText(buffer, chunk) {
  const text = normalizeSpeechText(String(chunk ?? ""));
  if (!text) return buffer;
  if (!buffer) return text;
  if (/[A-Za-z0-9]$/.test(buffer) && /^[A-Za-z0-9]/.test(text)) {
    return normalizeSpeechText(`${buffer} ${text}`);
  }
  return normalizeSpeechText(buffer + text);
}

export function splitAtWordBoundary(text) {
  const match = text.match(/[\s,.;:!?]+(?=[^\s,.;:!?]*$)/);
  if (!match) return { speak: "", rest: text };
  const idx = match.index + match[0].length;
  return { speak: text.slice(0, idx), rest: text.slice(idx) };
}

export function ensureWholeWordSplit({ speak, rest }) {
  if (!speak || !rest) return { speak, rest };
  if (!/[A-Za-z0-9]$/.test(speak) || !/^[A-Za-z0-9]/.test(rest)) {
    return { speak, rest };
  }
  const match = speak.match(/^(.*?)([A-Za-z0-9]+)$/);
  if (!match) return { speak: "", rest: speak + rest };
  return { speak: match[1], rest: match[2] + rest };
}

export function appendChunkText(buffer, chunk) {
  const text = String(chunk ?? "");
  if (!text) return buffer;
  if (!buffer) return text;
  if (/^\s/.test(text)) return buffer + text;
  return buffer + text;
}

export function appendWordChunkText(buffer, chunk) {
  const text = String(chunk ?? "");
  if (!text) return buffer;
  if (!buffer) return text;
  if (/^\s/.test(text)) return buffer + text;
  if (/[A-Za-z0-9]$/.test(buffer) && /^[A-Za-z0-9]/.test(text)) {
    return `${buffer} ${text}`;
  }
  return buffer + text;
}

export function shouldFlushChunk(buffer) {
  const trimmed = buffer.trimEnd();
  if (!trimmed) return false;
  if (!/[A-Za-z0-9]/.test(trimmed)) return false;
  if (/[.?!,;:]$/.test(trimmed)) return true;
  if (/\S\s$/.test(buffer)) return true;
  return trimmed.length >= 180;
}
