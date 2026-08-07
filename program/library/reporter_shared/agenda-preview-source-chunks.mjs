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

export function chunkAgendaPreviewSource(source = "", {
  maxChars = 9000,
  targetChars = 8000,
} = {}) {
  const maximum = Math.max(2000, Number(maxChars || 9000));
  const target = Math.min(maximum, Math.max(1000, Number(targetChars || 8000)));
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
  maxChars = 9000,
  targetChars = 8000,
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
