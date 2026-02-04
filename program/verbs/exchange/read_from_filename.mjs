import fs from "node:fs/promises";
import { recordArtifact, recordExchange } from "../../bridge/exchange.mjs";
import { handleFileUnavailable } from "../../library/file_errors.mjs";

function sliceBuffer(buffer, { fromByte, atmostByte } = {}) {
  let start = Number.isFinite(fromByte) ? Math.max(0, Math.trunc(fromByte)) : 0;
  let end = buffer.length;
  if (Number.isFinite(atmostByte)) {
    const count = Math.max(0, Math.trunc(atmostByte));
    end = Math.min(buffer.length, start + count);
  }
  return buffer.slice(start, end);
}

function sliceTextLines(text, { fromLine, atmostLine } = {}) {
  const lines = text.split(/\r?\n/);
  const start = Number.isFinite(fromLine) ? Math.max(0, Math.trunc(fromLine)) : 0;
  const count = Number.isFinite(atmostLine) ? Math.max(0, Math.trunc(atmostLine)) : null;
  const slice = count == null ? lines.slice(start) : lines.slice(start, start + count);
  return slice.join("\n");
}

export default async function readFromFilename({ from, limit } = {}) {
  const filename = from?.filename;
  if (!filename) throw new Error("read_from_filename: filename is required");

  let buffer;
  try {
    buffer = await fs.readFile(filename);
  } catch (err) {
    handleFileUnavailable(err, { path: filename, from: "read" });
  }
  const fromByte = Number.isFinite(limit?.fromByte) ? limit.fromByte : null;
  const atmostByte = Number.isFinite(limit?.atmostByte) ? limit.atmostByte : null;
  const fromLine = Number.isFinite(limit?.fromLine) ? limit.fromLine : null;
  const atmostLine = Number.isFinite(limit?.atmostLine) ? limit.atmostLine : null;

  let resolvedBuffer = buffer;
  let text = buffer.toString("utf8");
  if (fromByte != null || atmostByte != null) {
    resolvedBuffer = sliceBuffer(buffer, { fromByte, atmostByte });
    text = resolvedBuffer.toString("utf8");
  } else if (fromLine != null || atmostLine != null) {
    text = sliceTextLines(text, { fromLine, atmostLine });
  }

  const artifact = recordArtifact({ locator: filename, producer: "exchange", bytes: buffer });
  if (artifact?.su?.name) {
    recordExchange({ artifactName: artifact.su.name, op: "read", producer: "exchange" });
  }
  return { ob: { filename, text }, value: { text } };
}
