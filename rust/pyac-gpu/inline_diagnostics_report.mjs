function decodeHex(hex) {
  return Buffer.from(hex, "hex").toString("utf8");
}

export function createInlineMetricCollector() {
  const functions = [];
  const edges = new Map();
  const abortOrigins = new Set();
  let activeFunction = null;
  let activeEdge = null;
  let edgeEvents = 0;
  return {
    ingest(line) {
      if (!line.startsWith("PYASH_INLINE_")) return;
      const fields = line.split("\t");
      if (fields[0] === "PYASH_INLINE_ABORT" && fields.length === 2) {
        abortOrigins.add(decodeHex(fields[1]));
      } else if (fields[0] === "PYASH_INLINE_START") {
        activeFunction = decodeHex(fields[1] || "");
        activeEdge = null;
      } else if (fields[0] === "PYASH_INLINE_EDGE_START" && fields.length === 4) {
        activeEdge = {
          caller: decodeHex(fields[1]),
          callee: decodeHex(fields[2]),
          reason: decodeHex(fields[3]),
        };
      } else if (fields[0] === "PYASH_INLINE_FN" && fields.length === 11) {
        const [, name, micros, scans, inlines, blocksBefore, blocksAfter, instructionsBefore, instructionsAfter, callsBefore, callsAfter] = fields;
        functions.push({
          name: decodeHex(name),
          durationMs: Number(micros) / 1000,
          blockScans: Number(scans),
          successfulInlines: Number(inlines),
          blocksBefore: Number(blocksBefore),
          blocksAfter: Number(blocksAfter),
          instructionsBefore: Number(instructionsBefore),
          instructionsAfter: Number(instructionsAfter),
          callsBefore: Number(callsBefore),
          callsAfter: Number(callsAfter),
        });
        activeFunction = null;
        activeEdge = null;
      } else if (fields[0] === "PYASH_INLINE_EDGE" && fields.length === 5) {
        const [, callerHex, calleeHex, reasonHex, micros] = fields;
        const caller = decodeHex(callerHex);
        const callee = decodeHex(calleeHex);
        const reason = decodeHex(reasonHex);
        const key = `${caller}\0${callee}\0${reason}`;
        const edge = edges.get(key) || { caller, callee, reason, count: 0, durationMs: 0 };
        edge.count += 1;
        edge.durationMs += Number(micros) / 1000;
        edges.set(key, edge);
        edgeEvents += 1;
        activeEdge = null;
      }
    },
    snapshot() {
      return {
        functions: [...functions],
        edges: [...edges.values()].sort((a, b) => b.durationMs - a.durationMs),
        abortOrigins: [...abortOrigins].sort(),
        activeFunction,
        activeEdge,
        edgeEvents,
      };
    },
  };
}

export function parseInlineMetrics(log) {
  const collector = createInlineMetricCollector();
  for (const line of log.split(/\r?\n/)) collector.ingest(line);
  return collector.snapshot();
}

export function resolveInlineTimeoutSeconds(value) {
  const seconds = value === undefined ? 120 : Number(value);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 900) {
    throw new Error("PYAC_RUSTGPU_INLINE_TIMEOUT_SEC must be an integer from 1 to 900");
  }
  return seconds;
}

export function parseSpirtLocations(spirt) {
  const locations = new Map();
  let current = null;
  for (const line of spirt.split(/\r?\n/)) {
    const functionMatch = line.match(/^func F`(.+)`\(/);
    if (functionMatch) {
      current = functionMatch[1];
      continue;
    }
    if (!current || locations.has(current)) continue;
    const locationMatch = line.match(/SetDebugSrcLoc\(File: "([^"]+)", LineStart: (\d+)/);
    if (locationMatch) locations.set(current, `${locationMatch[1]}:${locationMatch[2]}`);
  }
  return locations;
}

export function renderInlineReport({ metrics, sourceLocations, build, peakRssBytes, stopReason }) {
  const topFunctions = [...metrics.functions].sort((a, b) => b.durationMs - a.durationMs).slice(0, 12);
  const topEdges = metrics.edges.slice(0, 15);
  const totalMs = metrics.functions.reduce((sum, entry) => sum + entry.durationMs, 0);
  const lines = [
    "# Rust-GPU Inline Diagnostic",
    "",
    `- Build result: ${build}`,
    `- Stop reason: ${stopReason || "completed"}`,
    `- Inliner-recorded function time: ${(totalMs / 1000).toFixed(2)} s across ${metrics.functions.length} completed functions`,
    `- Inline edges recorded: ${metrics.edgeEvents ?? metrics.edges.length}`,
    `- Peak compiler process-tree RSS: ${(peakRssBytes / 1024 ** 3).toFixed(2)} GiB`,
    `- Function active at stop: ${metrics.activeFunction || "none"}`,
    `- Inline edge active at stop: ${metrics.activeEdge ? `${metrics.activeEdge.caller} -> ${metrics.activeEdge.callee} (${metrics.activeEdge.reason})` : "none"}`,
    "",
    "## Functions Containing Rust-GPU Abort Markers",
    "",
    ...(metrics.abortOrigins?.length
      ? metrics.abortOrigins.map((name) => `- \`${name}\` — ${sourceLocations.get(name) || "source location unavailable"}`)
      : ["- None reported"]),
    "",
    "## Slowest Functions",
    "",
    "| Function | Source | Time | Scans | Inlines | Instruction growth |",
    "| --- | --- | ---: | ---: | ---: | ---: |",
  ];
  for (const fn of topFunctions) {
    lines.push(`| \`${fn.name}\` | ${sourceLocations.get(fn.name) || "unknown"} | ${fn.durationMs.toFixed(1)} ms | ${fn.blockScans} | ${fn.successfulInlines} | ${fn.instructionsAfter - fn.instructionsBefore} |`);
  }
  lines.push("", "## Slowest Caller/Callee Edges", "", "| Caller | Callee | Reason | Calls | Time |", "| --- | --- | --- | ---: | ---: |");
  for (const edge of topEdges) {
    lines.push(`| \`${edge.caller}\` | \`${edge.callee}\` | ${edge.reason} | ${edge.count} | ${edge.durationMs.toFixed(1)} ms |`);
  }
  lines.push("", "The timing ranks are diagnostic evidence, not proof that the top-ranked function alone causes the build regression.", "");
  return lines.join("\n");
}
