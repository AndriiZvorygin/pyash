import fs from "node:fs";

import {
  readPyaMapArtifact,
  writePyaMapArtifact,
  validateSectionGroundingStrict,
} from "./agenda-stage-contracts.mjs";

const STAGE1_ROOT = "agenda gross chunks artifact";
const STAGE2_MATCHES_ROOT = "agenda matches artifact";
const STAGE2_GROUNDING_ROOT = "agenda section grounding artifact";

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/gu, " ").trim();
}

function parseSpeakerRows(rowsJsonPath) {
  const raw = JSON.parse(fs.readFileSync(rowsJsonPath, "utf8"));
  const rows = Array.isArray(raw?.rows) ? raw.rows : [];
  return rows
    .map((r, idx) => ({
      row_index: idx,
      since: Number(r?.since || 0),
      until: Number(r?.until || 0),
      speaker: normalizeText(r?.display || r?.speaker || r?.speaker_key || "UNKNOWN"),
      text: normalizeText(r?.text || r?.raw || ""),
    }))
    .filter((r) => r.text);
}

function parseAgendaHierarchy(agendaPath) {
  const lines = String(fs.readFileSync(agendaPath, "utf8"))
    .split(/\r?\n/u)
    .map((l) => l.trim())
    .filter(Boolean);
  const sections = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const m = line.match(/^(\d{1,2}(?:\.[a-z])?)\.?(?:\s+(.+))?$/iu);
    if (!m) continue;
    const item = String(m[1] || "").toLowerCase();
    let title = normalizeText(m[2] || "");
    if (!title && i + 1 < lines.length) {
      const next = lines[i + 1];
      if (!next.match(/^\d{1,2}(?:\.[a-z])?\.?$/iu)) title = normalizeText(next);
    }
    sections.push({
      sectionId: `section_${String(sections.length + 1).padStart(3, "0")}`,
      agendaItem: item,
      title: title || `Agenda item ${item}`,
    });
  }
  if (!sections.length) throw new Error(`stage2 defective: no agenda hierarchy parsed from ${agendaPath}`);
  return sections;
}

function parseItemIndex(item = "") {
  const m = String(item || "").trim().toLowerCase().match(/^(\d+)(?:\.([a-z]))?$/u);
  if (!m) return null;
  const main = Number(m[1]);
  const sub = m[2] ? (m[2].charCodeAt(0) - 96) / 100 : 0;
  if (!Number.isFinite(main)) return null;
  return main + sub;
}

function chooseSectionIndexFromCue(cueItem, sections) {
  const cue = String(cueItem || "").trim().toLowerCase();
  if (!cue || cue === "unknown" || cue === "none") return -1;
  const exact = sections.findIndex((s) => s.agendaItem === cue);
  if (exact >= 0) return exact;
  const cueMain = cue.split(".")[0];
  const byMain = sections.findIndex((s) => String(s.agendaItem || "").split(".")[0] === cueMain);
  return byMain;
}

function assignChunksToAgendaSections(chunks, sections) {
  const assigned = [];
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    let idx = chooseSectionIndexFromCue(chunk?.["likely agenda item"], sections);
    if (idx < 0) idx = assigned.length ? assigned[assigned.length - 1]["section index"] : 0;
    if (!Number.isInteger(idx) || idx < 0) idx = 0;
    assigned.push({
      "chunk id": chunk["chunk id"],
      "chunk index": i,
      "section index": idx,
      reason: idx >= 0 ? "cue-or-carry" : "fallback",
    });
  }

  // enforce monotonic flow
  for (let i = 1; i < assigned.length; i += 1) {
    if (assigned[i]["section index"] < assigned[i - 1]["section index"]) {
      assigned[i]["section index"] = assigned[i - 1]["section index"];
      assigned[i].reason = "monotonic-clamp";
    }
  }

  return assigned;
}

function interpolateSectionStarts(sections, chunks, assignments, totalRows) {
  const starts = new Array(sections.length).fill(null);
  for (let i = 0; i < assignments.length; i += 1) {
    const a = assignments[i];
    const chunk = chunks[a["chunk index"]];
    if (starts[a["section index"]] == null) starts[a["section index"]] = Number(chunk["row start"]);
  }
  if (starts.length && starts[0] == null) starts[0] = 0;

  let i = 0;
  while (i < starts.length) {
    if (starts[i] != null) { i += 1; continue; }
    const gapStart = i;
    while (i < starts.length && starts[i] == null) i += 1;
    const gapEnd = i - 1;
    const prevIndex = gapStart - 1;
    const nextIndex = i < starts.length ? i : -1;
    const prevStart = prevIndex >= 0 && starts[prevIndex] != null ? starts[prevIndex] : 0;
    const nextStart = nextIndex >= 0 && starts[nextIndex] != null ? starts[nextIndex] : Math.max(prevStart + 1, totalRows - 1);
    const span = Math.max(1, nextStart - prevStart);
    const count = (gapEnd - gapStart) + 1;
    for (let g = 0; g < count; g += 1) {
      const pos = Math.floor(((g + 1) * span) / (count + 1));
      starts[gapStart + g] = Math.min(totalRows - 1, prevStart + pos);
    }
  }

  for (let k = 1; k < starts.length; k += 1) {
    if (starts[k] <= starts[k - 1]) starts[k] = Math.min(totalRows - 1, starts[k - 1] + 1);
  }

  return starts;
}

function buildGroundedUnits({ sections, chunks, assignments, rows }) {
  const starts = interpolateSectionStarts(sections, chunks, assignments, rows.length);
  const units = [];

  for (let i = 0; i < sections.length; i += 1) {
    const rowStart = starts[i];
    const rowEnd = i + 1 < starts.length ? Math.max(rowStart, starts[i + 1] - 1) : rows.length - 1;
    const chunkIds = chunks
      .filter((c) => Number(c["row end"]) >= rowStart && Number(c["row start"]) <= rowEnd)
      .map((c) => String(c["chunk id"]));
    const slice = rows.slice(rowStart, rowEnd + 1);
    const excerpt = slice.slice(0, 160).map((r) => `${r.speaker}: ${r.text}`).join("\n");
    const since = Number(slice[0]?.since || 0);
    const until = Number(slice[slice.length - 1]?.until || since);
    const unitChunks = chunks.filter((c) => chunkIds.includes(String(c["chunk id"])));
    const traceSignals = {
      "likely agenda items": [...new Set(unitChunks.map((c) => String(c["likely agenda item"] || "").trim()).filter(Boolean))],
      "signal flow": [...new Set(unitChunks.map((c) => String(c["signal flow"] || "").trim()).filter(Boolean))],
      "topic transition": [...new Set(unitChunks.map((c) => String(c["topic transition"] || "").trim()).filter(Boolean))],
    };
    units.push({
      "unit id": `ground_${String(i + 1).padStart(3, "0")}`,
      "agenda item": sections[i].agendaItem,
      "parent agenda item": sections[i].agendaItem,
      label: `${sections[i].agendaItem} ${sections[i].title}`.trim(),
      "row start": rowStart,
      "row end": rowEnd,
      "source rows": slice.length,
      since,
      until,
      "duration seconds": Math.max(0, until - since),
      "chunk ids": chunkIds,
      "chunk span": chunkIds.length ? { first: chunkIds[0], last: chunkIds[chunkIds.length - 1] } : null,
      "parent unit id": null,
      "split depth": 0,
      "grounding confidence": Number((chunkIds.length ? 0.78 : 0.35).toFixed(2)),
      "grounding status": chunkIds.length ? "grounded" : "review-needed",
      "source excerpt": excerpt,
      "source words": excerpt.split(/\s+/u).filter(Boolean).length,
      "trace chunk ids": chunkIds,
      "trace row span": `${rowStart}..${rowEnd}`,
      "trace signals": traceSignals,
    });
  }

  return units;
}

function splitLongUnitsByTransition({ units, chunks, thresholdSeconds = 900 }) {
  const out = [];
  for (const unit of units) {
    const duration = Number(unit["duration seconds"] || 0);
    if (duration <= thresholdSeconds) {
      out.push(unit);
      continue;
    }

    const candidateChunks = chunks.filter((c) =>
      Number(c["row end"]) >= Number(unit["row start"]) &&
      Number(c["row start"]) <= Number(unit["row end"])
    );
    const transitionRows = candidateChunks
      .filter((c) => String(c["topic transition"] || "") === "major")
      .map((c) => Number(c["row start"]))
      .filter((n) => Number.isInteger(n) && n > unit["row start"] && n < unit["row end"])
      .sort((a, b) => a - b);

    if (!transitionRows.length) {
      out.push(unit);
      continue;
    }

    const boundaries = [unit["row start"], ...transitionRows, unit["row end"] + 1];
    let part = 0;
    for (let i = 0; i < boundaries.length - 1; i += 1) {
      const start = boundaries[i];
      const end = Math.max(start, boundaries[i + 1] - 1);
      if (end - start < 8) continue;
      part += 1;
      out.push({
        ...unit,
        "unit id": `${unit["unit id"]}_part_${String(part).padStart(2, "0")}`,
        "parent unit id": unit["unit id"],
        "split depth": 1,
        "row start": start,
        "row end": end,
        "source rows": (end - start) + 1,
        "grounding status": "grounded-split",
        "trace row span": `${start}..${end}`,
      });
    }
    if (part === 0) out.push(unit);
  }

  for (const u of out) {
    const group = out.filter((x) => (x["parent unit id"] || x["unit id"]) === (u["parent unit id"] || u["unit id"]));
    u["part index"] = Math.max(0, group.findIndex((g) => g["unit id"] === u["unit id"]));
    u["part total"] = group.length;
  }

  return out;
}

function toWiseSeriesText(units, rows) {
  const lines = ["su name wise chips be series def"];
  for (let i = 0; i < units.length; i += 1) {
    const unit = units[i];
    const textRows = rows.slice(Number(unit["row start"]), Number(unit["row end"]) + 1);
    const body = textRows.map((r) => `${r.speaker}: ${r.text}`).join("\n\n");
    const header = `[Agenda Start] ${unit.label} | method stage2-grounding`;
    const txt = `${header}\n\n${body}`.trim();
    lines.push(
      `su name wise chip ${String(i + 1).padStart(3, "0")} since num ${Number(unit["row start"])} until num ${Number(unit["row end"])} ob text ${JSON.stringify(txt)} ya`
    );
  }
  lines.push("prah", "");
  return lines.join("\n");
}

export async function runAgendaStage2Grounding({
  rowsJsonPath,
  agendaPath,
  grossChunksPyaPath,
  matchesPyaPath,
  wiseSeriesPyaPath,
  sectionGroundingPyaPath,
  log = () => {},
}) {
  const rows = parseSpeakerRows(rowsJsonPath);
  if (!rows.length) throw new Error("stage2 defective: no transcript rows");
  const sections = parseAgendaHierarchy(agendaPath);
  const stage1 = await readPyaMapArtifact(grossChunksPyaPath, STAGE1_ROOT);
  const chunks = Array.isArray(stage1?.chunks) ? stage1.chunks : [];
  if (!chunks.length) throw new Error("stage2 defective: stage1 chunks missing");

  const assignments = assignChunksToAgendaSections(chunks, sections);
  const baseUnits = buildGroundedUnits({ sections, chunks, assignments, rows });
  const groundedUnits = splitLongUnitsByTransition({
    units: baseUnits,
    chunks,
    thresholdSeconds: Number(process.env.AGENDA_SECTION_SPLIT_SECONDS || 900),
  });

  const grounding = {
    "schema version": "agenda_section_grounding_v1",
    "generated time": new Date().toISOString(),
    "transcript rows total": rows.length,
    "grounded units": groundedUnits,
  };
  validateSectionGroundingStrict(grounding, stage1);

  const matches = {
    "schema version": "agenda_matches_v1",
    "generated time": grounding["generated time"],
    "sections total": sections.length,
    "chunks total": chunks.length,
    assignments,
  };

  writePyaMapArtifact(matchesPyaPath, STAGE2_MATCHES_ROOT, matches);
  writePyaMapArtifact(sectionGroundingPyaPath, STAGE2_GROUNDING_ROOT, grounding);
  fs.writeFileSync(wiseSeriesPyaPath, toWiseSeriesText(groundedUnits, rows), "utf8");

  log(`[agenda-stage2] wrote matches: ${matchesPyaPath}`);
  log(`[agenda-stage2] wrote wise series: ${wiseSeriesPyaPath}`);
  log(`[agenda-stage2] wrote section grounding: ${sectionGroundingPyaPath}`);
  return { matches, grounding };
}
