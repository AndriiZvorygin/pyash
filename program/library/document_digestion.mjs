import crypto from "node:crypto";
import fs from "node:fs/promises";
import { TextDecoder } from "node:util";
import { parse as parseCsv } from "csv-parse/sync";

import { sentenceToPyash } from "../beautiful.mjs";
import { emitExchangeSentence, recordArtifact, recordExchange } from "../bridge/exchange.mjs";

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function defect(message, details = undefined) {
  const error = new Error(`document digestion defective: ${message}`);
  if (details !== undefined) error.details = details;
  throw error;
}

function asBuffer(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string") return Buffer.from(value, "utf8");
  defect("input bytes are required");
}

function decodeUtf8(bytes) {
  let text;
  try {
    text = UTF8_DECODER.decode(bytes);
  } catch (error) {
    defect("invalid UTF-8", { cause: error?.message });
  }

  // TextDecoder is deliberately paired with this round trip. It protects the
  // offset contract if a runtime ever applies a decoding substitution that the
  // fatal option did not reject.
  if (!Buffer.from(text, "utf8").equals(bytes)) {
    defect("invalid UTF-8");
  }
  return text;
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export function sourceIdForBytes(bytesValue) {
  const bytes = asBuffer(bytesValue);
  if (bytes.length === 0) defect("empty input");
  return `src-${sha256(bytes)}`;
}

export function verifyArtifactHash(bytesValue, expectedHash) {
  const bytes = asBuffer(bytesValue);
  const actualHash = sha256(bytes);
  if (actualHash !== String(expectedHash ?? "")) {
    defect("artifact hash mismatch", { expected: expectedHash, actual: actualHash });
  }
  return { hash: actualHash, size: bytes.length };
}

function padOrdinal(value) {
  return String(value).padStart(4, "0");
}

function normalizeFormat(format, filename = "") {
  const requested = String(format ?? "").trim().toLowerCase();
  if (requested === "csv") return "csv";
  if (requested === "markdown" || requested === "md" || requested === "text" || requested === "plain") {
    return "markdown";
  }
  if (requested) defect(`unsupported format ${requested}`);

  const extension = String(filename).toLowerCase().match(/\.([a-z0-9]+)$/u)?.[1];
  return extension === "csv" ? "csv" : "markdown";
}

function byteOffset(text, characterIndex) {
  return Buffer.byteLength(text.slice(0, characterIndex), "utf8");
}

function isBlankLine(line) {
  return /^[ \t]*$/u.test(line.text);
}

function isFenceLine(line) {
  return /^ {0,3}(?:```|~~~)/u.test(line.text);
}

function isAtxHeading(line) {
  const text = line.number === 1 ? line.text.replace(/^\uFEFF/u, "") : line.text;
  return /^ {0,3}#{1,6}(?:[ \t]+|$)/u.test(text);
}

function physicalLines(text) {
  const lines = [];
  let start = 0;
  let lineNumber = 1;
  let index = 0;

  const push = (end, terminatorLength) => {
    lines.push({
      number: lineNumber,
      text: text.slice(start, end),
      characterStart: start,
      characterEnd: end,
      byteStart: byteOffset(text, start),
      byteEnd: byteOffset(text, end),
      terminatorLength
    });
    lineNumber += 1;
    start = end + terminatorLength;
  };

  while (index < text.length) {
    const character = text[index];
    if (character === "\r") {
      const length = text[index + 1] === "\n" ? 2 : 1;
      push(index, length);
      index += length;
      continue;
    }
    if (character === "\n") {
      push(index, 1);
      index += 1;
      continue;
    }
    index += 1;
  }

  if (start < text.length || lines.length === 0) {
    push(text.length, 0);
  }
  return lines;
}

function spanText(text, lines) {
  const first = lines[0];
  const last = lines.at(-1);
  return {
    text: text.slice(first.characterStart, last.characterEnd),
    lineStart: first.number,
    lineEnd: last.number,
    byteStart: first.byteStart,
    byteEnd: last.byteEnd
  };
}

function markdownSpans(text) {
  const lines = physicalLines(text);
  const spans = [];
  let current = [];
  let section = 0;
  let paragraph = 0;
  let fenced = false;

  const flush = () => {
    if (current.length === 0) return;
    if (section === 0) section = 1;
    paragraph += 1;
    spans.push({
      kind: "paragraph",
      section,
      paragraph,
      ...spanText(text, current)
    });
    current = [];
  };

  for (const line of lines) {
    const fence = isFenceLine(line);
    if (!fenced && isAtxHeading(line)) {
      flush();
      section = section === 0 ? 1 : section + 1;
      paragraph = 0;
      continue;
    }

    if (!fenced && isBlankLine(line)) {
      flush();
      continue;
    }

    if (section === 0) section = 1;
    current.push(line);
    if (fence) fenced = !fenced;
  }
  flush();
  return spans;
}

function csvRows(bytes) {
  const rows = [];
  let start = 0;
  let lineStart = 1;
  let line = 1;
  let quoted = false;
  let index = 0;

  const push = (end, terminatorLength) => {
    if (end === start) defect("CSV contains an empty row", { line });
    rows.push({
      byteStart: start,
      byteEnd: end,
      lineStart,
      lineEnd: line
    });
    start = end + terminatorLength;
    line += 1;
    lineStart = line;
  };

  while (index < bytes.length) {
    const byte = bytes[index];
    if (byte === 0x22) {
      if (quoted && bytes[index + 1] === 0x22) {
        index += 2;
        continue;
      }
      quoted = !quoted;
      index += 1;
      continue;
    }

    if (!quoted && (byte === 0x0a || byte === 0x0d)) {
      const length = byte === 0x0d && bytes[index + 1] === 0x0a ? 2 : 1;
      push(index, length);
      index += length;
      continue;
    }

    if (quoted && (byte === 0x0a || byte === 0x0d)) {
      const length = byte === 0x0d && bytes[index + 1] === 0x0a ? 2 : 1;
      line += 1;
      index += length;
      continue;
    }
    index += 1;
  }

  if (quoted) defect("CSV has an unterminated quoted field");
  if (start < bytes.length) push(bytes.length, 0);
  return rows;
}

function parseCsvStrict(text) {
  try {
    return parseCsv(text, {
      bom: true,
      relax_column_count: false,
      relax_quotes: false,
      skip_empty_lines: false,
      record_delimiter: ["\r\n", "\n", "\r"]
    });
  } catch (error) {
    defect("malformed CSV", { cause: error?.message });
  }
}

function csvSpans(bytes, text) {
  const records = parseCsvStrict(text);
  const rows = csvRows(bytes);
  if (records.length === 0 || rows.length !== records.length) {
    defect("malformed CSV", { records: records.length, rows: rows.length });
  }

  const width = records[0]?.length ?? 0;
  if (width === 0 || records[0].some(cell => String(cell ?? "").trim() === "")) {
    defect("CSV header is empty");
  }
  if (records.some(row => row.length !== width)) {
    defect("malformed CSV: inconsistent row width");
  }

  return rows.map((row, index) => ({
    kind: index === 0 ? "table-header" : "table-row",
    ordinal: index === 0 ? null : index,
    fields: records[index].map(value => String(value ?? "")),
    headers: records[0].map(value => String(value ?? "")),
    ...row,
    text: decodeUtf8(bytes.subarray(row.byteStart, row.byteEnd))
  }));
}

function csvNarrative(headers, fields) {
  return headers.map((header, index) => `${header}: ${fields[index] ?? ""}`).join("; ");
}

function validateIdentifier(value, label) {
  const text = String(value ?? "");
  if (!IDENTIFIER_PATTERN.test(text)) defect(`${label} is not an ASCII identifier`, { value });
  return text;
}

function spanBoundaryIsValid(bytes, offset) {
  if (offset <= 0 || offset >= bytes.length) return true;
  return (bytes[offset] & 0xc0) !== 0x80;
}

export function validateSourceSpan(bytesValue, span = {}) {
  const bytes = asBuffer(bytesValue);
  const byteStart = Number(span.byteStart);
  const byteEnd = Number(span.byteEnd);
  const lineStart = Number(span.lineStart);
  const lineEnd = Number(span.lineEnd);
  if (![byteStart, byteEnd, lineStart, lineEnd].every(Number.isInteger)) {
    defect("span coordinates must be integers");
  }
  if (byteStart < 0 || byteEnd < byteStart || byteEnd > bytes.length) {
    defect("span is outside source bytes", { byteStart, byteEnd, size: bytes.length });
  }
  if (lineStart < 1 || lineEnd < lineStart) {
    defect("span line range is invalid", { lineStart, lineEnd });
  }
  if (!spanBoundaryIsValid(bytes, byteStart) || !spanBoundaryIsValid(bytes, byteEnd)) {
    defect("span does not land on UTF-8 boundaries", { byteStart, byteEnd });
  }
  const text = decodeUtf8(bytes);
  const lines = physicalLines(text);
  const firstLine = lines[lineStart - 1];
  const lastLine = lines[lineEnd - 1];
  if (!firstLine || !lastLine || byteStart !== firstLine.byteStart || byteEnd !== lastLine.byteEnd) {
    defect("span line range does not map to source bytes", { byteStart, byteEnd, lineStart, lineEnd });
  }
  return true;
}

function makeAnchor(span, format) {
  const id = format === "csv"
    ? span.kind === "table-header"
      ? `table-header-lines-${span.lineStart}-${span.lineEnd}-bytes-${span.byteStart}-${span.byteEnd}`
      : `table-row-${padOrdinal(span.ordinal)}-lines-${span.lineStart}-${span.lineEnd}-bytes-${span.byteStart}-${span.byteEnd}`
    : `section-${padOrdinal(span.section)}-paragraph-${padOrdinal(span.paragraph)}-lines-${span.lineStart}-${span.lineEnd}-bytes-${span.byteStart}-${span.byteEnd}`;
  return validateIdentifier(id, "anchor");
}

function sourceAnchorClause(sourceId, anchorId) {
  return {
    la: {
      mood: "ya",
      su: { name: sourceId },
      ob: { text: anchorId },
      be: "text"
    }
  };
}

function sourceArtifactLocator(sourceId, format) {
  return `artifacts/document-digestion/${sourceId}.${format}.source`;
}

function sourceSentence(sourceId, text, hash, size, locator) {
  return {
    mood: "ya",
    exists: true,
    su: { name: sourceId },
    ob: { text },
    to: { filename: locator },
    accordingto: { name: "sha256" },
    fromtext: { text: hash },
    by: { num: size },
    as: { name: "source" },
    be: "artifact"
  };
}

function anchorSentence(sourceId, anchorId, text) {
  return {
    mood: "ya",
    su: { name: `${sourceId}:${anchorId}` },
    ob: { text },
    fromtext: sourceAnchorClause(sourceId, anchorId),
    be: "anchor"
  };
}

function candidateSentence(sourceId, anchorId, ordinal, text) {
  return {
    mood: "pi7",
    su: { name: `${sourceId}:candidate-${padOrdinal(ordinal)}` },
    ob: { text },
    fromtext: sourceAnchorClause(sourceId, anchorId),
    accordingto: { name: "reported-evidential" },
    by: { num: 1 },
    be: "text"
  };
}

export function canonicalDigestStream(records) {
  if (!Array.isArray(records) || records.length === 0) defect("canonical records are required");
  return `${records.map(sentenceToPyash).join("\n")}\n`;
}

function assertSpanRoundTrip(bytes, span) {
  validateSourceSpan(bytes, span);
  const exact = bytes.subarray(span.byteStart, span.byteEnd);
  const decoded = decodeUtf8(exact);
  if (decoded !== span.text || !Buffer.from(span.text, "utf8").equals(exact)) {
    defect("span does not map back to source bytes", span);
  }
}

function buildDigest({ bytes, text, format }) {
  const hash = sha256(bytes);
  const sourceId = validateIdentifier(`src-${hash}`, "source");
  const sourceLocator = sourceArtifactLocator(sourceId, format);
  const spans = format === "csv" ? csvSpans(bytes, text) : markdownSpans(text);
  if (spans.length === 0) defect("no anchored content");

  const source = sourceSentence(sourceId, text, hash, bytes.length, sourceLocator);
  const records = [source];
  const anchors = [];
  const candidates = [];

  spans.forEach((span, index) => {
    assertSpanRoundTrip(bytes, span);
    const id = makeAnchor(span, format);
    const marker = anchorSentence(sourceId, id, span.text);
    const candidate = span.kind === "table-header"
      ? null
      : candidateSentence(
        sourceId,
        id,
        candidates.length + 1,
        format === "csv" ? csvNarrative(span.headers, span.fields) : span.text
      );
    const anchor = {
      id,
      kind: span.kind,
      lineStart: span.lineStart,
      lineEnd: span.lineEnd,
      byteStart: span.byteStart,
      byteEnd: span.byteEnd,
      text: span.text,
      marker,
      candidate
    };
    anchors.push(anchor);
    if (candidate) candidates.push(candidate);
    records.push(marker);
    if (candidate) records.push(candidate);
  });

  const canonicalRecords = records.map(sentenceToPyash);
  const stream = canonicalDigestStream(records);
  return {
    format,
    sourceId,
    artifactHash: hash,
    sourceLocator,
    source,
    anchors,
    candidates,
    records,
    canonicalRecords,
    stream,
    streamHash: sha256(Buffer.from(stream, "utf8"))
  };
}

export function digestDocument({ bytes, text, format, filename = "" } = {}) {
  if (bytes === undefined && text === undefined) defect("input bytes are required");
  const sourceBytes = asBuffer(bytes === undefined ? text : bytes);
  if (sourceBytes.length === 0) defect("empty input");
  const sourceText = decodeUtf8(sourceBytes);
  if (sourceText.trim().length === 0) defect("empty input");
  return buildDigest({
    bytes: sourceBytes,
    text: sourceText,
    format: normalizeFormat(format, filename)
  });
}

export async function digestFilename(filename, { format } = {}) {
  const locator = String(filename ?? "");
  if (!locator) defect("filename is required");
  const bytes = await fs.readFile(locator);
  const result = digestDocument({ bytes, format, filename: locator });

  // The canonical digestion records are the replay projection. Emit them in
  // source order when a run newspaper is active; artifact/exchange events are
  // operational records and follow this projection.
  for (const record of result.records) emitExchangeSentence(record);

  const artifact = recordArtifact({
    locator: result.sourceLocator,
    producer: "document digest",
    bytes,
    kind: "source"
  });
  if (artifact?.su?.name) {
    recordExchange({
      artifactName: artifact.su.name,
      op: "read",
      producer: "document digest"
    });
  }
  const digestArtifact = recordArtifact({
    locator: `artifacts/document-digestion/${result.sourceId}.${result.format}.pya`,
    producer: "document digest",
    bytes: Buffer.from(result.stream, "utf8"),
    kind: "digest"
  });
  return { ...result, artifact, digestArtifact, series: {
    mood: "ya",
    su: { name: "document digestion" },
    be: "series",
    ob: { series: result.records }
  } };
}

export function replayDigest(first, second) {
  const left = first ?? {};
  const right = second ?? {};
  if (!SHA256_PATTERN.test(String(left.artifactHash ?? "")) || left.sourceId !== `src-${left.artifactHash}`) {
    defect("first replay record has an invalid artifact hash");
  }
  if (!SHA256_PATTERN.test(String(right.artifactHash ?? "")) || right.sourceId !== `src-${right.artifactHash}`) {
    defect("second replay record has an invalid artifact hash");
  }
  verifyArtifactHash(Buffer.from(String(left.stream ?? ""), "utf8"), left.streamHash);
  verifyArtifactHash(Buffer.from(String(right.stream ?? ""), "utf8"), right.streamHash);
  const identical = left.format === right.format
    && left.sourceId === right.sourceId
    && left.artifactHash === right.artifactHash
    && left.stream === right.stream;
  if (!identical) defect("replay records differ");
  return {
    identical: true,
    format: left.format,
    sourceId: left.sourceId,
    artifactHash: left.artifactHash,
    streamHash: left.streamHash
  };
}

export default digestDocument;
