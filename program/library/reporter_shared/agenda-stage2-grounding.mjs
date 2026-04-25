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
  let pendingTopLevelIndex = -1;

  const looksItemOnly = (value = "") => /^\d{1,2}(?:\.[a-z])?\.?$/iu.test(String(value || "").trim());
  const looksHeading = (value = "") => {
    const v = normalizeText(value);
    if (!v) return false;
    if (/^there are no\b/iu.test(v)) return false;
    if (/^agenda item\s+\d+/iu.test(v)) return false;
    return /[a-z]/iu.test(v);
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const m = line.match(/^(\d{1,2}(?:\.[a-z])?)\.?(?:\s+(.+))?$/iu);
    if (!m) {
      if (pendingTopLevelIndex >= 0 && looksHeading(line)) {
        sections[pendingTopLevelIndex].title = normalizeText(line);
        pendingTopLevelIndex = -1;
      }
      continue;
    }

    const item = String(m[1] || "").toLowerCase();
    const mainNum = Number(item.split(".")[0] || 0);
    if (!Number.isFinite(mainNum) || mainNum < 1 || mainNum > 30) continue;

    let title = normalizeText(m[2] || "");
    if (!title && i + 1 < lines.length) {
      const next = lines[i + 1];
      if (!looksItemOnly(next) && looksHeading(next)) title = normalizeText(next);
    }

    const isTopLevel = !item.includes(".");
    sections.push({
      sectionId: `section_${String(sections.length + 1).padStart(3, "0")}`,
      agendaItem: item,
      title: title || `Agenda item ${item}`,
    });

    if (isTopLevel && !title) pendingTopLevelIndex = sections.length - 1;
    else pendingTopLevelIndex = -1;
  }

  const cleaned = [];
  for (let i = 0; i < sections.length; i += 1) {
    const cur = sections[i];
    const next = i + 1 < sections.length ? sections[i + 1] : null;
    const title = String(cur.title || "");
    const isPlaceholder = /^agenda item\s+\d+/iu.test(title);
    const curMain = String(cur.agendaItem || "").split(".")[0];
    const nextMain = String(next?.agendaItem || "").split(".")[0];
    const nextIsSub = Boolean(next && String(next.agendaItem || "").includes("."));

    if (isPlaceholder && next && nextIsSub && curMain !== nextMain) continue;
    cleaned.push({ ...cur, sectionId: `section_${String(cleaned.length + 1).padStart(3, "0")}` });
  }

  if (!cleaned.length) throw new Error(`stage2 defective: no agenda hierarchy parsed from ${agendaPath}`);
  return cleaned;
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

  // Prevent cue-driven jumps from skipping entire agenda blocks in one chunk.
  const maxStep = Number(process.env.AGENDA_MAX_SECTION_STEP_PER_CHUNK || 2);
  if (Number.isFinite(maxStep) && maxStep > 0) {
    for (let i = 1; i < assigned.length; i += 1) {
      const prev = Number(assigned[i - 1]["section index"] || 0);
      const cur = Number(assigned[i]["section index"] || 0);
      if (cur > prev + maxStep) {
        assigned[i]["section index"] = prev + maxStep;
        assigned[i].reason = "step-clamp";
      }
    }
  }

  return assigned;
}

function headingCuePhrase(title = "") {
  const v = normalizeText(title).toLowerCase();
  if (!v) return "";
  const explicit = [
    "public forum",
    "correspondence received for which direction is required",
    "reports of city staff",
    "matters postponed",
    "motions for which notice was previously given",
    "correspondence provided for information",
    "discussion of additional business",
    "notices of motion",
    "adjournment",
  ];
  for (const p of explicit) if (v.includes(p)) return p;
  const parts = v.split(/\s+/u).filter((w) => w.length >= 4).slice(0, 4);
  return parts.join(" ");
}

function findExplicitTopLevelCueStart(section = {}, rows = [], maxRow = 0) {
  const item = String(section?.agendaItem || "").toLowerCase();
  if (!item || item.includes(".")) return -1;
  const words = {
    "1": "one", "2": "two", "3": "three", "4": "four", "5": "five",
    "6": "six", "7": "seven", "8": "eight", "9": "nine", "10": "ten",
    "11": "eleven", "12": "twelve", "13": "thirteen", "14": "fourteen",
  };
  const numberWord = words[item] || "";
  const cuePhrase = headingCuePhrase(section?.title || "");
  const limit = Math.max(0, Number(maxRow || 0));
  for (let i = 0; i <= limit && i < rows.length; i += 1) {
    const text = normalizeText(rows[i]?.text || "").toLowerCase();
    if (!text) continue;
    const numberHit = numberWord ? text.includes("number " + numberWord) : false;
    if (!numberHit && !cuePhrase) continue;
    if (cuePhrase && text.includes(cuePhrase)) return i;
    if (numberHit && cuePhrase && text.includes(cuePhrase.split(/\s+/u)[0])) return i;
  }
  return -1;
}
function findEarlyProceduralStart(section = {}, rows = [], maxRow = 0) {
  const item = String(section?.agendaItem || "").toLowerCase();
  if (!["1", "2", "3", "4", "4.a", "4.b"].includes(item)) return -1;
  const limit = Math.max(0, Number(maxRow || 0));
  for (let i = 0; i <= limit && i < rows.length; i += 1) {
    const text = normalizeText(rows[i]?.text || "").toLowerCase();
    if (!text) continue;
    if (item === "1" && /(call\s+.*order|five\s+thirty\s+p\.m\.|it\s+is\s+five\s+thirty)/u.test(text)) return i;
    if (item === "2" && /additional\s+business/u.test(text)) return i;
    if (item === "3" && /(declarations?\s+of\s+interest|anything\s+to\s+declare)/u.test(text)) return i;
    if (item === "4" && /(confirmation\s+of\s+minutes|number\s+four)/u.test(text)) return i;
    if (item === "4.a" && /(four\s+a|4\s*a)/u.test(text)) return i;
    if (item === "4.b" && /(four\s+b|4\s*b)/u.test(text)) return i;
  }
  return -1;
}

function interpolateSectionStarts(sections, chunks, assignments, rows, totalRows) {
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

  const anchorStarts = assignments
    .map((a) => Number(chunks[a["chunk index"]]?.["row start"]))
    .filter((n) => Number.isInteger(n) && n >= 0);
  const firstAnchor = anchorStarts.length ? Math.min(...anchorStarts) : 0;
  const earlyScanLimit = Math.min(totalRows - 1, firstAnchor + 40);
  for (let i = 0; i < sections.length; i += 1) {
    const cueStart = findEarlyProceduralStart(sections[i], rows, earlyScanLimit);
    if (cueStart < 0) continue;
    starts[i] = cueStart;
  }

  for (let i = 0; i < sections.length; i += 1) {
    const cueStart = findExplicitTopLevelCueStart(sections[i], rows, totalRows - 1);
    if (cueStart < 0) continue;
    starts[i] = cueStart;
  }

  for (let k = 1; k < starts.length; k += 1) {
    if (starts[k] <= starts[k - 1]) starts[k] = Math.min(totalRows - 1, starts[k - 1] + 1);
  }

  return starts;
}

function buildGroundedUnits({ sections, chunks, assignments, rows }) {
  const starts = interpolateSectionStarts(sections, chunks, assignments, rows, rows.length);
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
      "part index": 0,
      "part total": 1,
      "child chapters": [],
    });
  }

  return units;
}

function deriveUnitFieldsFromSpan({ unit, rowStart, rowEnd, rows, chunks }) {
  const safeStart = Math.max(0, Number(rowStart || 0));
  const safeEnd = Math.max(safeStart, Number(rowEnd || safeStart));
  const slice = rows.slice(safeStart, safeEnd + 1);
  const excerpt = slice.slice(0, 160).map((r) => `${r.speaker}: ${r.text}`).join("\n");
  const since = Number(slice[0]?.since || 0);
  const until = Number(slice[slice.length - 1]?.until || since);
  const chunkIds = chunks
    .filter((c) => Number(c["row end"]) >= safeStart && Number(c["row start"]) <= safeEnd)
    .map((c) => String(c["chunk id"]));
  const unitChunks = chunks.filter((c) => chunkIds.includes(String(c["chunk id"])));
  const traceSignals = {
    "likely agenda items": [...new Set(unitChunks.map((c) => String(c["likely agenda item"] || "").trim()).filter(Boolean))],
    "signal flow": [...new Set(unitChunks.map((c) => String(c["signal flow"] || "").trim()).filter(Boolean))],
    "topic transition": [...new Set(unitChunks.map((c) => String(c["topic transition"] || "").trim()).filter(Boolean))],
  };
  return {
    ...unit,
    "row start": safeStart,
    "row end": safeEnd,
    "source rows": slice.length,
    since,
    until,
    "duration seconds": Math.max(0, until - since),
    "chunk ids": chunkIds,
    "chunk span": chunkIds.length ? { first: chunkIds[0], last: chunkIds[chunkIds.length - 1] } : null,
    "grounding confidence": Number((chunkIds.length ? 0.78 : 0.35).toFixed(2)),
    "grounding status": chunkIds.length ? "grounded" : "review-needed",
    "source excerpt": excerpt,
    "source words": excerpt.split(/\s+/u).filter(Boolean).length,
    "trace chunk ids": chunkIds,
    "trace row span": `${safeStart}..${safeEnd}`,
    "trace signals": traceSignals,
  };
}

function deriveChapterFieldsFromSpan({ parentUnit, chapterId, orderingIndex, rowStart, rowEnd, rows, chunks }) {
  const safeStart = Math.max(0, Number(rowStart || 0));
  const safeEnd = Math.max(safeStart, Number(rowEnd || safeStart));
  const slice = rows.slice(safeStart, safeEnd + 1);
  const excerpt = slice.slice(0, 160).map((r) => `${r.speaker}: ${r.text}`).join("\n");
  const since = Number(slice[0]?.since || 0);
  const until = Number(slice[slice.length - 1]?.until || since);
  const chunkIds = chunks
    .filter((c) => Number(c["row end"]) >= safeStart && Number(c["row start"]) <= safeEnd)
    .map((c) => String(c["chunk id"]));
  const unitChunks = chunks.filter((c) => chunkIds.includes(String(c["chunk id"])));
  const traceSignals = {
    "likely agenda items": [...new Set(unitChunks.map((c) => String(c["likely agenda item"] || "").trim()).filter(Boolean))],
    "signal flow": [...new Set(unitChunks.map((c) => String(c["signal flow"] || "").trim()).filter(Boolean))],
    "topic transition": [...new Set(unitChunks.map((c) => String(c["topic transition"] || "").trim()).filter(Boolean))],
  };
  return {
    "parent unit id": String(parentUnit?.["unit id"] || ""),
    "chapter id": chapterId,
    "ordering index": orderingIndex,
    "row start": safeStart,
    "row end": safeEnd,
    "source rows": slice.length,
    since,
    until,
    "duration seconds": Math.max(0, until - since),
    "chunk ids": chunkIds,
    "source excerpt": excerpt,
    "source words": excerpt.split(/\s+/u).filter(Boolean).length,
    "chapter title": "",
    "chapter text": "",
    "trace chunk ids": chunkIds,
    "trace row span": `${safeStart}..${safeEnd}`,
    "trace signals": traceSignals,
  };
}

function attachChildChaptersByTransition({ units, chunks, rows, thresholdSeconds = 900 }) {
  const out = [];

  const minChapterSeconds = 600;
  const maxSegmentFor = (durationSeconds) => {
    if (durationSeconds > 2400) return 600;
    if (durationSeconds > 1200) return 720;
    if (durationSeconds > 900) return 780;
    return 900;
  };

  const rowDuration = (rowStart, rowEnd) => {
    const rs = Math.max(0, Number(rowStart || 0));
    const re = Math.max(rs, Number(rowEnd || rs));
    const since = Number(rows[rs]?.since || 0);
    const until = Number(rows[re]?.until || since);
    return Math.max(0, until - since);
  };

  for (const unit of units) {
    const parentUnit = {
      ...unit,
      "parent unit id": null,
      "part index": 0,
      "part total": 1,
      "child chapters": [],
    };

    const duration = Number(unit["duration seconds"] || 0);
    if (duration <= minChapterSeconds) {
      out.push(parentUnit);
      continue;
    }

    const unitStart = Number(unit["row start"] || 0);
    const unitEnd = Number(unit["row end"] || unitStart);

    const candidateChunks = chunks
      .filter((c) => Number(c["row end"]) >= unitStart && Number(c["row start"]) <= unitEnd)
      .sort((a, b) => Number(a["row start"]) - Number(b["row start"]));

    const boundaryStarts = candidateChunks
      .map((c) => Number(c["row start"]))
      .filter((n) => Number.isInteger(n) && n > unitStart && n < unitEnd);

    const scored = new Map();
    for (let idx = 0; idx < candidateChunks.length; idx += 1) {
      const c = candidateChunks[idx];
      const row = Number(c["row start"]);
      if (!(row > unitStart && row < unitEnd)) continue;
      let score = 0;
      const transition = String(c["topic transition"] || "").trim().toLowerCase();
      if (transition === "major") score += 3;
      else if (transition === "minor") score += 2;
      else if (transition && transition !== "none") score += 1;

      const flow = String(c["signal flow"] || "").trim().toLowerCase();
      if (flow === "start" || flow === "end") score += 1;

      const prev = idx > 0 ? candidateChunks[idx - 1] : null;
      const prevCue = String(prev?.["likely agenda item"] || "").trim().toLowerCase();
      const cue = String(c["likely agenda item"] || "").trim().toLowerCase();
      if (prev && cue && prevCue && cue !== prevCue) score += 1;

      if (score > 0) scored.set(row, score);
    }

    const strong = [...scored.entries()].filter(([, sc]) => sc >= 2).map(([row]) => row).sort((a, b) => a - b);
    const reasonable = [...scored.keys()].sort((a, b) => a - b);

    let transitionRows = [];
    if (duration > 1200) {
      transitionRows = reasonable.length ? reasonable : boundaryStarts;
    } else if (duration > thresholdSeconds) {
      transitionRows = strong.length ? strong : (reasonable.length ? reasonable : boundaryStarts);
    } else {
      transitionRows = reasonable;
    }

    const targetMax = maxSegmentFor(duration);

    const pickMidBoundary = (segStart, segEnd, usedSet) => {
      const candidates = boundaryStarts.filter((r) => r > segStart && r < segEnd && !usedSet.has(r));
      if (!candidates.length) return null;
      const mid = Math.floor((segStart + segEnd) / 2);
      let best = candidates[0];
      let bestDist = Math.abs(best - mid);
      for (const c of candidates.slice(1)) {
        const d = Math.abs(c - mid);
        if (d < bestDist) {
          best = c;
          bestDist = d;
        }
      }
      return best;
    };

    const used = new Set(transitionRows);
    const maxAugment = 24;
    let loops = 0;
    while (loops < maxAugment) {
      loops += 1;
      const ordered = [...used].sort((a, b) => a - b);
      const boundaries = [unitStart, ...ordered, unitEnd + 1];
      let inserted = false;
      for (let bi = 0; bi < boundaries.length - 1; bi += 1) {
        const segStart = boundaries[bi];
        const segEnd = Math.max(segStart, boundaries[bi + 1] - 1);
        const segDuration = rowDuration(segStart, segEnd);
        if (segDuration <= targetMax) continue;
        const b = pickMidBoundary(segStart, segEnd, used);
        if (b != null) {
          used.add(b);
          inserted = true;
          break;
        }
      }
      if (!inserted) break;
    }

    transitionRows = [...used].sort((a, b) => a - b);

    if (!transitionRows.length) {
      out.push(parentUnit);
      continue;
    }

    const boundaries = [unitStart, ...transitionRows, unitEnd + 1];
    const chapters = [];
    let part = 0;
    for (let bi = 0; bi < boundaries.length - 1; bi += 1) {
      const startRow = boundaries[bi];
      const endRow = Math.max(startRow, boundaries[bi + 1] - 1);
      if (endRow - startRow < 8) continue;
      part += 1;
      chapters.push(
        deriveChapterFieldsFromSpan({
          parentUnit,
          chapterId: `${parentUnit["unit id"]}_chapter_${String(part).padStart(2, "0")}`,
          orderingIndex: part,
          rowStart: startRow,
          rowEnd: endRow,
          rows,
          chunks,
        }),
      );
    }

    if (chapters.length < 2) {
      parentUnit["child chapters"] = [];
      out.push(parentUnit);
      continue;
    }

    parentUnit["child chapters"] = chapters;
    out.push(parentUnit);
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
  const groundedUnits = attachChildChaptersByTransition({
    units: baseUnits,
    chunks,
    rows,
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
