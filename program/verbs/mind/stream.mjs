import fsSync from "node:fs";
import path from "node:path";

import { getExchangeSentenceId } from "../../bridge/exchange.mjs";
import { resolveConfigBool } from "../../configure/env.mjs";

function resolveStreamOutputPath(sentence, outputName) {
  const base = getExchangeSentenceId() || outputName || sentence?.su?.name || "mind-stream";
  const safeBase = String(base).replace(/[^A-Za-z0-9_.-]+/g, "-");
  return path.join("artifacts", "mind", `${safeBase}.stream.txt`);
}

function writeStreamChunk(filePath, chunk) {
  const text = String(chunk ?? "");
  if (!text) return;
  fsSync.appendFileSync(filePath, `${JSON.stringify(text)}\n`, "utf8");
}

function writeStreamEnd(filePath) {
  fsSync.appendFileSync(filePath, "[PYA_STREAM_END]\n", "utf8");
}

function startStreamFile(filePath) {
  fsSync.mkdirSync(path.dirname(filePath), { recursive: true });
  fsSync.writeFileSync(filePath, "", "utf8");
}

function startStreamTail({ filename, onLine, onEnd }) {
  let offset = 0;
  let pending = "";
  const interval = setInterval(() => {
    let stats;
    try {
      stats = fsSync.statSync(filename);
    } catch {
      return;
    }
    if (stats.size <= offset) return;
    const fd = fsSync.openSync(filename, "r");
    const buffer = Buffer.alloc(stats.size - offset);
    fsSync.readSync(fd, buffer, 0, buffer.length, offset);
    fsSync.closeSync(fd);
    offset = stats.size;
    const text = pending + buffer.toString("utf8");
    const lines = text.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.length) continue;
      if (line.trim() === "[PYA_STREAM_END]") {
        if (onEnd) onEnd();
        return;
      }
      if (onLine) onLine(line);
    }
  }, 50);
  return () => clearInterval(interval);
}

function resolveStreamStdoutEnabled({ rememberFn } = {}) {
  const configured = resolveConfigBool("stream stdout", { rememberFn });
  if (configured !== undefined) return configured;
  return process?.stdout?.isTTY === true;
}

export {
  resolveStreamOutputPath,
  writeStreamChunk,
  writeStreamEnd,
  startStreamFile,
  startStreamTail,
  resolveStreamStdoutEnabled
};
