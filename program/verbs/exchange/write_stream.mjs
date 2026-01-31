import fsSync from "node:fs";

function startFileTail({ filename, onLine }) {
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
      if (line.length) onLine(line);
    }
  }, 200);
  return () => clearInterval(interval);
}

function normalizeStreamLine(line) {
  return String(line ?? "").trim().toLowerCase();
}

function normalizeStreamPrefix(line) {
  const normalized = normalizeStreamLine(line);
  return normalized.replace(/[.]+$/u, "");
}

function makeStreamIncrementalWriter(onAppend) {
  let lastLine = "";
  let lineOpen = false;
  const needsSpaceAfterPunct = (prev, next) => /[.!?]$/.test(prev) && next && !/^\s/.test(next);
  return {
    write(line) {
      const trimmed = String(line ?? "").trim();
      if (!trimmed) return;
      if (!lastLine) {
        onAppend(trimmed);
        lastLine = trimmed;
        lineOpen = true;
        return;
      }
      const normLast = normalizeStreamLine(lastLine);
      const normNext = normalizeStreamLine(trimmed);
      const normLastPrefix = normalizeStreamPrefix(lastLine);
      if (normNext === normLast) return;
      if (normNext.startsWith(normLast) || (normLastPrefix && normNext.startsWith(normLastPrefix))) {
        const baseLen = normNext.startsWith(normLast) ? lastLine.length : lastLine.replace(/[.]+$/u, "").length;
        let suffix = trimmed.slice(baseLen);
        if (needsSpaceAfterPunct(lastLine, suffix)) {
          suffix = ` ${suffix}`;
        }
        if (suffix) {
          onAppend(suffix);
          lastLine = trimmed;
          lineOpen = true;
        }
        return;
      }
      if (lineOpen) onAppend("\n");
      onAppend(trimmed);
      lastLine = trimmed;
      lineOpen = true;
    },
    finish() {
      if (lineOpen) onAppend("\n");
      lineOpen = false;
    }
  };
}

export { startFileTail, makeStreamIncrementalWriter };
