function quoteText(value) {
  return JSON.stringify(String(value ?? ""));
}

function parsePyaTextLiteral(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`invalid pya text literal: ${raw}`);
  }
}

function parseSrtTimeToSeconds(raw) {
  const text = String(raw ?? "").trim();
  const m = /^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/.exec(text);
  if (!m) throw new Error(`invalid srt time: ${text}`);
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = Number(m[3]);
  const ms = Number(m[4]);
  return hh * 3600 + mm * 60 + ss + (ms / 1000);
}

function parseSrtToCuts(text) {
  const blocks = String(text ?? "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  const rows = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2) continue;
    const idx = Number(lines[0]);
    if (!Number.isFinite(idx)) continue;
    const timing = lines[1];
    const match = timing.match(/^(.+?)\s+-->\s+(.+)$/);
    if (!match) continue;
    const startRaw = String(match[1] ?? "").trim();
    const endRaw = String(match[2] ?? "").trim();
    const textLine = lines.slice(2).join(" ").replace(/\s+/g, " ").trim();
    if (!textLine) continue;
    const since = parseSrtTimeToSeconds(startRaw);
    const until = parseSrtTimeToSeconds(endRaw);
    rows.push({
      index: idx,
      name: `cut ${String(idx).padStart(3, "0")}`,
      since,
      until,
      obText: textLine
    });
  }
  return rows;
}

function renderItineraryPya({ itineraryName, cuts }) {
  const safeName = String(itineraryName || "teaching cuts").trim() || "teaching cuts";
  const lines = [`su name ${safeName} be series def`];
  for (const cut of cuts) {
    const name = String(cut?.name || `cut ${String(cut?.index ?? "").padStart(3, "0")}`).trim();
    const since = Number(cut?.since ?? 0);
    const until = Number(cut?.until ?? 0);
    const text = quoteText(String(cut?.obText ?? ""));
    lines.push(`su name ${name} since num ${since.toFixed(3)} until num ${until.toFixed(3)} ob text ${text} ya`);
  }
  return `${lines.join("\n")}\n`;
}

function parseItineraryPya(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  let itineraryName = "";
  const cuts = [];
  let ordinal = 0;
  const headPattern = /^su name (.+?) be series def$/u;
  const cutPattern = /^su name (.+?) since num ([+-]?\d+(?:\.\d+)?) until num ([+-]?\d+(?:\.\d+)?) ob text ("(?:\\.|[^"\\])*") ya$/u;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!itineraryName) {
      const head = headPattern.exec(line);
      if (head) {
        itineraryName = String(head[1] ?? "").trim();
        continue;
      }
    }
    const m = cutPattern.exec(line);
    if (!m) continue;
    ordinal += 1;
    const name = String(m[1] ?? "").trim();
    const since = Number(m[2] ?? "0");
    const until = Number(m[3] ?? "0");
    const obText = parsePyaTextLiteral(String(m[4] ?? "\"\""));
    const parsedIndex = Number((/(\d+)/.exec(name)?.[1]) ?? "");
    const index = Number.isFinite(parsedIndex) ? parsedIndex : ordinal;
    cuts.push({ index, name, since, until, obText });
  }
  if (!itineraryName) throw new Error("itinerary defective: missing series header");
  if (!cuts.length) throw new Error("itinerary defective: missing cuts");
  return { itineraryName, cuts };
}

function encodeSecondsForFilename(seconds) {
  const ms = Math.max(0, Math.round(Number(seconds ?? 0) * 1000));
  return String(ms).padStart(9, "0");
}

export {
  parseSrtToCuts,
  renderItineraryPya,
  parseItineraryPya,
  parseSrtTimeToSeconds,
  encodeSecondsForFilename
};
