function splitOversizedBlock(block = "", targetChars = 8000) {
  const pieces = [];
  let remaining = String(block || "").trim();
  const target = Math.max(1000, Number(targetChars || 8000));
  while (remaining.length > target) {
    const searchFloor = Math.floor(target * 0.6);
    const candidate = remaining.slice(0, target + 1);
    const whitespaceAt = Math.max(
      candidate.lastIndexOf("\n"),
      candidate.lastIndexOf(" "),
      candidate.lastIndexOf("\t"),
    );
    const splitAt = whitespaceAt >= searchFloor ? whitespaceAt : target;
    pieces.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining) pieces.push(remaining);
  return pieces.filter(Boolean);
}

// PDF-to-text extraction can turn a drawing, survey plan, or scanned table
// into hundreds of thousands of whitespace-padded coordinate fragments. Such
// OCR is retained in the original attachment and remains linkable, but it is
// not useful prose context and causes character-window summaries to repeat
// the same administrative claim. Keep the attachment heading plus a short
// provenance note in the LLM source bundle while retaining ordinary narrative
// and table text unchanged.
export function prepareAgendaPreviewSource(source = "") {
  const value = String(source || "").trim();
  if (!value) return "";
  const blocks = value.split(/(?=---\n\nAttachment:\s*)/u);
  return blocks.map((block) => {
    const text = String(block || "").trim();
    if (!/^---\n\nAttachment:/u.test(text) || text.length < 20000) return text;
    const alphanumeric = (text.match(/[A-Za-z0-9]/gu) || []).length;
    const density = alphanumeric / Math.max(1, text.length);
    if (density >= 0.08) return text;
    const headerEnd = text.indexOf("\n\n", 16);
    const header = headerEnd > 0 ? text.slice(0, headerEnd).trim() : text.slice(0, 1000).trim();
    return `${header}\n\n[Attachment text omitted from the prose window because PDF extraction is dominated by image/map OCR; the original attachment remains available.]`;
  }).filter(Boolean).join("\n\n");
}

export function chunkAgendaPreviewSource(source = "", {
  maxChars = 16000,
  targetChars = 14000,
} = {}) {
  const maximum = Math.max(2000, Number(maxChars || 16000));
  const target = Math.min(maximum, Math.max(1000, Number(targetChars || 14000)));
  const blocks = String(source || "")
    .split(/\n{2,}/u)
    .map((value) => value.trim())
    .filter(Boolean)
    .flatMap((block) => splitOversizedBlock(block, target));

  const chunks = [];
  let chunk = "";
  for (const block of blocks) {
    const combined = chunk ? `${chunk}\n\n${block}` : block;
    if (chunk && combined.length > maximum) {
      chunks.push(chunk);
      chunk = block;
    } else {
      chunk = combined;
    }
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

export function buildAgendaPreviewChunkSpans(source = "", {
  rowStart = 0,
  sourceRows = 1,
  since = 0,
  durationSeconds = 0,
  maxChars = 16000,
  targetChars = 14000,
} = {}) {
  const chunks = chunkAgendaPreviewSource(source, { maxChars, targetChars });
  if (!chunks.length) return [];

  const firstRow = Math.max(0, Math.trunc(Number(rowStart) || 0));
  const totalRows = Math.max(chunks.length, Math.trunc(Number(sourceRows) || 1));
  const firstSince = Number.isFinite(Number(since)) ? Number(since) : 0;
  const totalDuration = Math.max(0, Number(durationSeconds) || 0);
  const totalWeight = Math.max(1, chunks.reduce((sum, text) => sum + text.length, 0));
  let remainingRows = totalRows;
  let remainingWeight = totalWeight;
  let nextRow = firstRow;
  let nextSince = firstSince;

  return chunks.map((text, index) => {
    const remainingChunks = chunks.length - index;
    const rows = remainingChunks === 1
      ? remainingRows
      : Math.max(
        1,
        Math.min(
          remainingRows - (remainingChunks - 1),
          Math.round((remainingRows * text.length) / Math.max(1, remainingWeight)),
        ),
      );
    const rowEnd = nextRow + rows - 1;
    const isLast = index === chunks.length - 1;
    const until = isLast
      ? firstSince + totalDuration
      : nextSince + ((totalDuration * text.length) / totalWeight);
    const span = {
      text,
      rowStart: nextRow,
      rowEnd,
      sourceRows: rows,
      since: nextSince,
      until,
      durationSeconds: Math.max(0, until - nextSince),
    };
    remainingRows -= rows;
    remainingWeight -= text.length;
    nextRow = rowEnd + 1;
    nextSince = until;
    return span;
  });
}
