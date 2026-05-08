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

  // Targeted recovery for known procedural placeholder:
  // item 5 should use the motion heading when present in source.
  const motionToCommitteeTitle = lines.find((l) =>
    /motion\s+to\s+move\s+council\s+into\s+committee\s+of\s+the\s+whole/iu.test(String(l || "")));
  if (motionToCommitteeTitle) {
    const idx5 = sections.findIndex((s) => String(s?.agendaItem || "") === "5");
    if (idx5 >= 0 && /^agenda item\s+5$/iu.test(String(sections[idx5]?.title || "").trim())) {
      sections[idx5].title = normalizeText(motionToCommitteeTitle);
    }
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

    if (isPlaceholder && next && nextIsSub && Number(nextMain) > Number(curMain)) continue;
    cleaned.push({ ...cur, sectionId: `section_${String(cleaned.length + 1).padStart(3, "0")}` });
  }

  if (!cleaned.length) throw new Error(`stage2 defective: no agenda hierarchy parsed from ${agendaPath}`);

  const ordered = cleaned
    .map((s, idx) => ({ ...s, __idx: idx, __num: parseItemIndex(s.agendaItem) }))
    .sort((a, b) => {
      const an = Number.isFinite(a.__num) ? a.__num : Number.MAX_SAFE_INTEGER;
      const bn = Number.isFinite(b.__num) ? b.__num : Number.MAX_SAFE_INTEGER;
      if (an !== bn) return an - bn;
      return a.__idx - b.__idx;
    });

  const deduped = [];
  const seenItems = new Set();
  for (const s of ordered) {
    const key = String(s.agendaItem || "");
    if (!key || seenItems.has(key)) continue;
    seenItems.add(key);
    deduped.push({
      sectionId: `section_${String(deduped.length + 1).padStart(3, "0")}`,
      agendaItem: s.agendaItem,
      title: s.title,
    });
  }

  // Sub-items under broad parent procedural/by-law sections should not become standalone
  // grounded peers when transcript evidence is sparse; keep parent as top-level section.
  const collapseSubItemMains = new Set(
    deduped
      .filter((s) => !String(s.agendaItem || "").includes("."))
      .filter((s) => {
        const t = String(s.title || "");
        return /\bby-?laws?\b/iu.test(t) || /confirmation\s+of\s+.*minutes/iu.test(t) || /deputations?\s+and\s+presentations?/iu.test(t);
      })
      .map((s) => String(s.agendaItem || "").split(".")[0]),
  );
  const collapsed = deduped.filter((s) => {
    const item = String(s.agendaItem || "");
    if (!item.includes(".")) return true;
    const main = item.split(".")[0];
    return !collapseSubItemMains.has(main);
  });

  return collapsed.map((s, i) => ({
    ...s,
    sectionId: `section_${String(i + 1).padStart(3, "0")}`,
  }));
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
    const cueIdx = chooseSectionIndexFromCue(chunk?.["likely agenda item"], sections);
    const hasCue = Number.isInteger(cueIdx) && cueIdx >= 0;
    let idx = hasCue ? cueIdx : (assigned.length ? assigned[assigned.length - 1]["section index"] : 0);
    if (!Number.isInteger(idx) || idx < 0) idx = 0;
    assigned.push({
      "chunk id": chunk["chunk id"],
      "chunk index": i,
      "section index": idx,
      reason: hasCue ? "chunk_cue" : (assigned.length ? "chunk_carry" : "fallback"),
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
    "deputations and presentations",
    "deputation or presentation",
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
    if (cuePhrase && text.includes(cuePhrase)) {
      if (["6", "8"].includes(item) && !numberHit) continue;
      return i;
    }
    if (numberHit && cuePhrase && text.includes(cuePhrase.split(/\s+/u)[0])) return i;
  }
  return -1;
}
function findEarlyProceduralStart(section = {}, rows = [], maxRow = 0) {
  const item = String(section?.agendaItem || "").toLowerCase();
  if (!["1", "2", "3", "4", "4.a", "4.b", "5", "6", "7", "8", "9", "10"].includes(item)) return -1;
  const limit = Math.max(0, Number(maxRow || 0));
  for (let i = 0; i <= limit && i < rows.length; i += 1) {
    const text = normalizeText(rows[i]?.text || "").toLowerCase();
    if (!text) continue;
    if (item === "1" && /(call\s+.*order|five\s+thirty\s+p\.m\.|it\s+is\s+five\s+thirty)/u.test(text)) return i;
    if (item === "2" && /additional\s+business/u.test(text)) return i;
    if (item === "3" && /(declarations?\s+of\s+interest|anything\s+to\s+declare)/u.test(text)) return i;
    if (item === "4" && /(confirmation\s+of\s+(council\s+meeting\s+)?minutes|minutes?\s+of\s+the\s+following\s+meetings\s+be\s+adopted|minutes?.*be\s+adopted\s+as\s+printed|number\s+four)/u.test(text)) return i;
    if (item === "5" && /(number\s+five\s+is\s+motion\s+to\s+move\s+council\s+into\s+committee\s+of\s+the\s+whole|motion\s+to\s+move\s+council\s+into\s+committee\s+of\s+the\s+whole|city\s+council\s+now\s+move\s+into\s+committee\s+of\s+the\s+whole|move\s+into\s+committee\s+of\s+the\s+whole\s+to\s+consider)/u.test(text)) return i;
    if (item === "6" && /(at\s+number\s+six|number\s+six).*(public\s+meetings)/u.test(text)) return i;
    if (item === "7" && /(at\s+number\s+seven|number\s+seven|deputation\s+or\s+presentation|deputations?\s+and\s+presentations?|acting\s+city\s+manager\s+presenting\s+the\s+city\s+manager'?s\s+update)/u.test(text)) return i;
    if (item === "8" && /(at\s+number\s+eight\s+in\s+our\s+agenda|number\s+eight\s+on\s+our\s+agenda\s+is\s+public\s+forum|number\s+eight.*public\s+forum|no\s+comments\s+for\s+public\s+forum\s+have\s+been\s+submitted|if\s+anyone\s+present\s+wishes\s+to\s+speak|each\s+speaker\s+is\s+limited\s+to|total\s+time\s+allotted\s+for\s+public\s+forum)/u.test(text)) return i;
    if (item === "9" && /(no\s+correspondence\s+items\s+being\s+presented\s+for\s+consideration|correspondence\s+received\s+for\s+which\s+direction\s+of\s+council\s+is\s+required|at\s+number\s+nine|number\s+nine)/u.test(text)) return i;
    if (item === "10" && /(reports\s+of\s+city\s+staff|at\s+number\s+ten|number\s+ten|report\s+cs-\d{2}-\d{3})/u.test(text)) return i;
    if (item === "4.a" && /(four\s+a|4\s*a)/u.test(text)) return i;
    if (item === "4.b" && /(four\s+b|4\s*b)/u.test(text)) return i;
  }
  return -1;
}


function normalizeStrictlyMonotonicStarts(starts = [], totalRows = 0) {
  const maxRow = Math.max(0, Number(totalRows || 0) - 1);
  if (!Array.isArray(starts) || !starts.length) return starts;

  for (let i = 0; i < starts.length; i += 1) {
    if (!Number.isFinite(Number(starts[i]))) starts[i] = 0;
    starts[i] = Math.max(0, Math.min(maxRow, Number(starts[i])));
  }

  for (let i = 1; i < starts.length; i += 1) {
    if (starts[i] <= starts[i - 1]) {
      starts[i] = Math.min(maxRow, starts[i - 1] + 1);
    }
  }

  for (let i = starts.length - 2; i >= 0; i -= 1) {
    if (starts[i] >= starts[i + 1]) {
      starts[i] = Math.max(0, starts[i + 1] - 1);
    }
  }

  for (let i = 1; i < starts.length; i += 1) {
    if (starts[i] <= starts[i - 1]) {
      starts[i] = starts[i - 1] + 1;
    }
  }

  return starts;
}

function interpolateSectionStarts(sections, chunks, assignments, rows, totalRows) {
  const starts = new Array(sections.length).fill(null);
  const sources = new Array(sections.length).fill("fallback");
  for (let i = 0; i < assignments.length; i += 1) {
    const a = assignments[i];
    const chunk = chunks[a["chunk index"]];
    if (starts[a["section index"]] == null) {
      starts[a["section index"]] = Number(chunk["row start"]);
      sources[a["section index"]] = String(a.reason || "chunk_carry");
    }
  }
  if (starts.length && starts[0] == null) {
    starts[0] = 0;
    sources[0] = "fallback";
  }

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
      sources[gapStart + g] = "interpolated";
    }
  }

  normalizeStrictlyMonotonicStarts(starts, totalRows);

  const anchorStarts = assignments
    .map((a) => Number(chunks[a["chunk index"]]?.["row start"]))
    .filter((n) => Number.isInteger(n) && n >= 0);
  const firstAnchor = anchorStarts.length ? Math.min(...anchorStarts) : 0;
  const earlyScanLimit = Math.min(totalRows - 1, firstAnchor + 220);
  for (let i = 0; i < sections.length; i += 1) {
    const cueStart = findEarlyProceduralStart(sections[i], rows, earlyScanLimit);
    if (cueStart < 0) continue;
    starts[i] = cueStart;
    sources[i] = "explicit_transcript_cue";
  }

  for (let i = 0; i < sections.length; i += 1) {
    const cueStart = findExplicitTopLevelCueStart(sections[i], rows, totalRows - 1);
    if (cueStart < 0) continue;
    starts[i] = cueStart;
    sources[i] = "explicit_transcript_cue";
  }

  normalizeStrictlyMonotonicStarts(starts, totalRows);

  return { starts, sources };
}

function buildGroundedUnits({ sections, chunks, assignments, rows }) {
  const { starts, sources } = interpolateSectionStarts(sections, chunks, assignments, rows, rows.length);
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
      "boundary source": String(sources[i] || "fallback"),
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
    "boundary source": String(unit?.["boundary source"] || "fallback"),
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

function pruneLateTinyWeakUnits(units = [], rowsTotal = 0, rows = [], chunks = []) {
  const weakSources = new Set(["interpolated", "fallback", "chunk_carry", "step-clamp", "parent_grouped"]);
  const minRowForLate = Math.floor(Math.max(0, Number(rowsTotal || 0)) * 0.7);
  const demoted = [];
  const kept = [];

  const mainItemNum = (item = "") => Number(String(item || "").split(".")[0] || 0);
  const labelHeading = (u = {}) => {
    const item = String(u["agenda item"] || "").trim();
    const label = String(u.label || "").trim();
    if (!label) return "";
    if (item && label.toLowerCase().startsWith((item + " ").toLowerCase())) {
      return label.slice(item.length).trim();
    }
    return label;
  };
  const cueWords = (u = {}) => {
    const heading = normalizeText(labelHeading(u)).toLowerCase();
    if (!heading) return [];
    const raw = heading.split(/\s+/u).filter((w) => w.length >= 4);
    const skip = new Set(["agenda", "item", "minutes", "meeting", "council", "committee"]);
    return raw.filter((w) => !skip.has(w)).slice(0, 4);
  };
  const hasExplicitCueInRowText = (u = {}) => {
    const text = normalizeText(String(u["source excerpt"] || "").split(/\n/u)[0] || "").toLowerCase();
    if (!text) return false;
    const words = cueWords(u);
    if (!words.length) return false;
    let hits = 0;
    for (const w of words) if (text.includes(w)) hits += 1;
    return hits >= 2;
  };

  const headingExcerptCompatibility = (u = {}) => {
    const heading = normalizeText(labelHeading(u)).toLowerCase();
    const excerpt = normalizeText(String(u["source excerpt"] || "")).toLowerCase();
    if (!heading || !excerpt) return { ok: false, reason: "empty_heading_or_excerpt" };
    if (/^agenda item\s+\d+/u.test(heading)) return { ok: false, reason: "placeholder_heading" };
    const itemNum = String(u["agenda item"] || "").split(".")[0];
    const itemWord = ({
      "1": "one", "2": "two", "3": "three", "4": "four", "5": "five",
      "6": "six", "7": "seven", "8": "eight", "9": "nine", "10": "ten",
      "11": "eleven", "12": "twelve", "13": "thirteen",
    })[itemNum] || "";
    if ((itemWord && excerpt.includes(`number ${itemWord}`)) || excerpt.includes(`number ${itemNum}`)) {
      return { ok: true, reason: "numbered_cue_match" };
    }
    const keywordSets = [
      { label: "patio_permit", heading: /(patio|permit|street furniture|sidewalk)/u, mustAny: ["patio", "permit", "street furniture"] },
      { label: "business_licence", heading: /(business licences?|glowup|good neighbour|resale|licen[cs]e)/u, mustAny: ["business", "licence", "license", "glowup", "good neighbour", "resale"] },
      { label: "doctors_day", heading: /(ontario medical association|doctors day|oma|medical association)/u, mustAny: ["doctor", "medical", "association", "doctors day", "oma"] },
      { label: "fourth_avenue", heading: /(fourth avenue|one-way|one way|road|street)/u, mustAny: ["fourth avenue", "one-way", "one way", "road", "street"] },
    ];
    for (const set of keywordSets) {
      if (!set.heading.test(heading)) continue;
      const hit = set.mustAny.some((w) => excerpt.includes(w));
      return hit ? { ok: true, reason: `${set.label}_keyword_match` } : { ok: false, reason: `${set.label}_keyword_missing` };
    }
    const rawTokens = heading.split(/\s+/u).filter((w) => w.length >= 4);
    const skip = new Set(["agenda", "item", "minutes", "meeting", "council", "committee", "report", "reports", "city", "provided", "information"]);
    const tokens = rawTokens.filter((w) => !skip.has(w)).slice(0, 5);
    if (!tokens.length) return { ok: false, reason: "no_heading_tokens" };
    const hits = tokens.filter((w) => excerpt.includes(w)).length;
    if (hits >= Math.min(2, tokens.length)) return { ok: true, reason: "token_overlap" };
    return { ok: false, reason: "low_heading_excerpt_overlap" };
  };
  const cueRowForNumberSix = (() => {
    for (let i = 0; i < rows.length; i += 1) {
      const text = normalizeText(rows[i]?.text || "").toLowerCase();
      if (/(at\s+number\s+six|number\s+six).*(public\s+meetings)/u.test(text)) return i;
    }
    return -1;
  })();
  for (const u of units) {
    const item = String(u["agenda item"] || "").toLowerCase();
    const main = mainItemNum(item);
    const rowStart = Number(u["row start"] || 0);
    const sourceRows = Number(u["source rows"] || 0);
    const src = String(u["boundary source"] || "").toLowerCase();
    const weak = weakSources.has(src);
    const tiny = sourceRows > 0 && sourceRows <= 2;
    const late = rowStart >= minRowForLate;
    const explicitCue = hasExplicitCueInRowText(u);
    const isBylawParentOrAdjourn = main >= 21;
    const compat = headingExcerptCompatibility(u);

    const shouldDemote = late && tiny && weak && !explicitCue && !isBylawParentOrAdjourn;
    const shouldDemoteHeadingMismatch = !compat.ok && !isBylawParentOrAdjourn && !["neutral_heading","reports_neutral"].includes(String(compat.reason||""));
    if (shouldDemote) {
      demoted.push({
        "agenda item": u["agenda item"],
        label: u.label,
        reason: "late_weak_tiny_no_cue",
        "row start": u["row start"],
        "row end": u["row end"],
        "boundary source": u["boundary source"],
      });
      continue;
    }
    if (shouldDemoteHeadingMismatch) {
      demoted.push({
        "agenda item": u["agenda item"],
        label: u.label,
        reason: `weak_heading_excerpt_mismatch:${compat.reason}`,
        "row start": u["row start"],
        "row end": u["row end"],
        "boundary source": u["boundary source"],
      });
      continue;
    }
    kept.push({
      ...u,
      "boundary evidence strength": explicitCue ? "explicit_cue_match" : (weak ? "weak" : "normal"),
      "heading excerpt status": compat.ok ? "compatible" : "mismatch",
      "heading excerpt reason": compat.reason,
    });
  }

  // Early procedural correction: ensure item 5 covers the committee-of-the-whole motion rows
  // and item 6 starts at the first explicit "number six/public meetings" cue.
  const cueRowForNumberNine = (() => {
    for (let i = 0; i < rows.length; i += 1) {
      const text = normalizeText(rows[i]?.text || "").toLowerCase();
      if (/(no\s+correspondence\s+items\s+being\s+presented\s+for\s+consideration|number\s+nine\s+correspondence|at\s+number\s+nine)/u.test(text)) return i;
    }
    return -1;
  })();
  const cueRowForNumberTen = (() => {
    const start = Math.max(0, cueRowForNumberNine);
    for (let i = start; i < rows.length; i += 1) {
      const text = normalizeText(rows[i]?.text || "").toLowerCase();
      if (/no\s+correspondence\s+items/u.test(text)) continue;
      if (/(at\s+number\s+ten|number\s+ten|reports\s+of\s+city\s+staff|report\s+cs-\d{2}-\d{3})/u.test(text)) return i;
    }
    return -1;
  })();
  // Early procedural correction: ensure item 9 owns correspondence rows and
  // item 10 starts at first real staff-report cue.
  if (cueRowForNumberNine >= 0) {
    const idx9 = kept.findIndex((u) => String(u["agenda item"] || "") === "9");
    const idx10 = kept.findIndex((u) => String(u["agenda item"] || "") === "10");
    let start10Candidate = cueRowForNumberNine + 1;
    if (idx9 >= 0) {
      const u9 = kept[idx9];
      const immediateNextText = normalizeText(rows[cueRowForNumberNine + 1]?.text || "").toLowerCase();
      const minStart10 = /no\s+correspondence\s+items/u.test(immediateNextText) ? (cueRowForNumberNine + 2) : (cueRowForNumberNine + 1);
      start10Candidate = (cueRowForNumberTen > cueRowForNumberNine && cueRowForNumberTen <= (cueRowForNumberNine + 60)) ? Math.max(cueRowForNumberTen, minStart10) : minStart10;
      const end9 = start10Candidate - 1;
      kept[idx9] = deriveUnitFieldsFromSpan({
        unit: { ...u9, "boundary source": "explicit_transcript_cue", "boundary evidence strength": "explicit_cue_match", "child chapters": [] },
        rowStart: Number(u9["row start"] || cueRowForNumberNine),
        rowEnd: Math.max(Number(u9["row start"] || cueRowForNumberNine), end9),
        rows,
        chunks,
      });
    }
    if (idx10 >= 0) {
      const u10 = kept[idx10];
      kept[idx10] = deriveUnitFieldsFromSpan({
        unit: { ...u10, "boundary source": "explicit_transcript_cue", "boundary evidence strength": "explicit_cue_match", "child chapters": [] },
        rowStart: start10Candidate,
        rowEnd: Math.max(start10Candidate, Number(u10["row end"] || start10Candidate)),
        rows,
        chunks,
      });
    }
  }

  // Deterministic handoff fix: if item 10 still starts on a
  // "no correspondence items" row, move that row back to item 9.
  {
    const idx9 = kept.findIndex((u) => String(u["agenda item"] || "") === "9");
    const idx10 = kept.findIndex((u) => String(u["agenda item"] || "") === "10");
    if (idx9 >= 0 && idx10 >= 0) {
      const u9 = kept[idx9];
      const u10 = kept[idx10];
      const start10 = Number(u10["row start"] || 0);
      const first10 = normalizeText(rows[start10]?.text || "").toLowerCase();
      if (/no\s+correspondence\s+items/u.test(first10) && start10 > Number(u9["row start"] || 0)) {
        kept[idx9] = deriveUnitFieldsFromSpan({
          unit: { ...u9, "boundary source": "explicit_transcript_cue", "boundary evidence strength": "explicit_cue_match", "child chapters": [] },
          rowStart: Number(u9["row start"] || 0),
          rowEnd: start10,
          rows,
          chunks,
        });
        kept[idx10] = deriveUnitFieldsFromSpan({
          unit: { ...u10, "boundary source": "explicit_transcript_cue", "boundary evidence strength": "explicit_cue_match", "child chapters": [] },
          rowStart: start10 + 1,
          rowEnd: Math.max(start10 + 1, Number(u10["row end"] || start10 + 1)),
          rows,
          chunks,
        });
      }
    }
  }

  if (cueRowForNumberSix >= 0) {
    const idx5 = kept.findIndex((u) => String(u["agenda item"] || "") === "5");
    const idx6 = kept.findIndex((u) => String(u["agenda item"] || "") === "6");
    if (idx6 >= 0) {
      const u6 = kept[idx6];
      if (Number(u6["row start"] || 0) !== cueRowForNumberSix) {
        kept[idx6] = deriveUnitFieldsFromSpan({
          unit: { ...u6, "boundary source": "explicit_transcript_cue", "boundary evidence strength": "explicit_cue_match" },
          rowStart: cueRowForNumberSix,
          rowEnd: Number(u6["row end"] || cueRowForNumberSix),
          rows,
          chunks,
        });
      }
    }
    if (idx5 >= 0 && idx6 >= 0) {
      const u5 = kept[idx5];
      const end5 = Math.max(Number(u5["row start"] || 0), cueRowForNumberSix - 1);
      kept[idx5] = deriveUnitFieldsFromSpan({
        unit: { ...u5, "boundary source": "explicit_transcript_cue", "boundary evidence strength": "explicit_cue_match" },
        rowStart: Number(u5["row start"] || 0),
        rowEnd: end5,
        rows,
        chunks,
      });
    }
  }

  if (demoted.length && kept.length) {
    const metadataRowsByHost = new Map();
    for (const d of demoted) {
      const dStart = Number(d["row start"] || 0);
      let hostIdx = -1;
      for (let i = 0; i < kept.length; i += 1) {
        const kStart = Number(kept[i]["row start"] || 0);
        if (kStart <= dStart) hostIdx = i;
      }
      if (hostIdx < 0) hostIdx = 0;
      const list = metadataRowsByHost.get(hostIdx) || [];
      list.push(d);
      metadataRowsByHost.set(hostIdx, list);
    }

    for (const [hostIdx, list] of metadataRowsByHost.entries()) {
      const host = { ...kept[hostIdx] };
      host["grouped agenda metadata"] = [
        ...(Array.isArray(host["grouped agenda metadata"]) ? host["grouped agenda metadata"] : []),
        ...list.map((d, i) => ({
          "metadata id": `meta_${String(i + 1).padStart(3, "0")}`,
          "group status": "metadata_only",
          ...d,
        })),
      ];
      const minRow = Math.min(Number(host["row start"] || 0), ...list.map((d) => Number(d["row start"] || 0)));
      const maxRow = Math.max(Number(host["row end"] || 0), ...list.map((d) => Number(d["row end"] || 0)));
      const merged = deriveUnitFieldsFromSpan({ unit: host, rowStart: minRow, rowEnd: maxRow, rows, chunks });
      merged["boundary source"] = "parent_grouped";
      merged["boundary evidence strength"] = "parent_grouped";
      kept[hostIdx] = merged;
    }
  }

  // Grouped 12.* cleanup: if parent-grouped minute labels are holding
  // broader service-review/tourism/parking discussion, relabel as grouped consent.
  for (let i = 0; i < kept.length; i += 1) {
    const u = kept[i];
    const item = String(u["agenda item"] || "").toLowerCase();
    const src = String(u["boundary source"] || "").toLowerCase();
    if (!item.startsWith("12.")) continue;
    if (src !== "parent_grouped") continue;
    const heading = String(u.label || "").toLowerCase();
    const excerpt = String(u["source excerpt"] || "").toLowerCase();
    const looksMinutes = /minutes\s+of|minutes\b/u.test(heading);
    const looksBroader = /(services+review|tourism|toms+thomson|parking|playground|parkss+ands+opens+space|staffs+haves+continued)/u.test(excerpt);
    if (looksMinutes && looksBroader) {
      kept[i] = {
        ...u,
        "parent agenda item": "12",
        label: "12 CONSENT AGENDA (GROUPED)",
      };
    }
  }

  const sorted = kept.slice().sort((a, b) => Number(a["row start"] || 0) - Number(b["row start"] || 0));
  const monotonic = [];
  for (const u of sorted) {
    if (!monotonic.length) {
      monotonic.push(u);
      continue;
    }
    const prev = monotonic[monotonic.length - 1];
    const prevEnd = Number(prev["row end"] || 0);
    const curStart = Number(u["row start"] || 0);
    if (curStart > prevEnd) {
      monotonic.push(u);
      continue;
    }
    const main = Number(String(u["agenda item"] || "").split(".")[0] || 0);
    const weak = weakSources.has(String(u["boundary source"] || "").toLowerCase()) || Number(u["source rows"] || 0) <= 2;
    if (main < 21 || weak) {
      continue;
    }
    const shifted = deriveUnitFieldsFromSpan({ unit: u, rowStart: prevEnd + 1, rowEnd: Number(u["row end"] || prevEnd + 1), rows, chunks });
    if (Number(shifted["row start"] || 0) <= prevEnd) continue;
    monotonic.push(shifted);
  }
  return monotonic.map((u, i) => ({ ...u, "unit id": `ground_${String(i + 1).padStart(3, "0")}` }));
}

function rebindChildChapterParents(units = []) {
  return units.map((u, idx) => {
    const finalUnitId = `ground_${String(idx + 1).padStart(3, "0")}`;
    const chapters = Array.isArray(u["child chapters"]) ? u["child chapters"] : [];
    const reboundChapters = chapters.map((ch, ci) => ({
      ...ch,
      "parent unit id": finalUnitId,
      "ordering index": ci + 1,
      "chapter id": `${finalUnitId}_chapter_${String(ci + 1).padStart(2, "0")}`,
    }));
    return {
      ...u,
      "unit id": finalUnitId,
      "child chapters": reboundChapters,
    };
  });
}

function findFirstChapterParentMismatch(units = []) {
  for (let ui = 0; ui < units.length; ui += 1) {
    const u = units[ui] || {};
    const uid = String(u["unit id"] || "").trim();
    const chapters = Array.isArray(u["child chapters"]) ? u["child chapters"] : [];
    for (let ci = 0; ci < chapters.length; ci += 1) {
      const ch = chapters[ci] || {};
      const chParent = String(ch["parent unit id"] || "").trim();
      if (chParent !== uid) {
        return {
          unitIndex: ui,
          chapterIndex: ci,
          expectedParentUnitId: uid,
          actualParentUnitId: chParent,
          unit: u,
          chapter: ch,
        };
      }
    }
  }
  return null;
}

function assertLocalParentChapterInvariant(units = []) {
  for (let ui = 0; ui < units.length; ui += 1) {
    const u = units[ui] || {};
    const uid = String(u["unit id"] || "").trim();
    const uStart = Number(u["row start"]);
    const uEnd = Number(u["row end"]);
    const uSince = Number(u.since);
    const uUntil = Number(u.until);
    const chapters = Array.isArray(u["child chapters"]) ? u["child chapters"] : [];
    for (let ci = 0; ci < chapters.length; ci += 1) {
      const ch = chapters[ci] || {};
      const chParent = String(ch["parent unit id"] || "").trim();
      if (chParent !== uid) {
        throw new Error(`stage2 local invariant failed: chapter parent mismatch at unit=${ui + 1} unitId=${uid} chapter=${ci + 1} expected=${uid} actual=${chParent || "(empty)"}`);
      }
      const cStart = Number(ch["row start"]);
      const cEnd = Number(ch["row end"]);
      if (!Number.isInteger(cStart) || !Number.isInteger(cEnd) || cStart < uStart || cEnd > uEnd || cEnd < cStart) {
        throw new Error(`stage2 local invariant failed: chapter row span out of parent bounds at unit=${ui + 1} chapter=${ci + 1} parent=${uStart}..${uEnd} chapter=${cStart}..${cEnd}`);
      }
      const cSince = Number(ch.since);
      const cUntil = Number(ch.until);
      if (!Number.isFinite(cSince) || !Number.isFinite(cUntil) || cSince < uSince || cUntil > uUntil || cUntil < cSince) {
        throw new Error(`stage2 local invariant failed: chapter timing out of parent bounds at unit=${ui + 1} chapter=${ci + 1} parent=${uSince}..${uUntil} chapter=${cSince}..${cUntil}`);
      }
    }
  }
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
  const groundedUnitsRaw = attachChildChaptersByTransition({
    units: baseUnits,
    chunks,
    rows,
    thresholdSeconds: Number(process.env.AGENDA_SECTION_SPLIT_SECONDS || 900),
  });
  const groundedUnitsPruned = pruneLateTinyWeakUnits(groundedUnitsRaw, rows.length, rows, chunks);
  const preRebindMismatch = findFirstChapterParentMismatch(groundedUnitsPruned);
  if (preRebindMismatch) {
    const u = preRebindMismatch.unit || {};
    const ch = preRebindMismatch.chapter || {};
    log(`[agenda-stage2][pre-rebind-mismatch] unit=${preRebindMismatch.unitIndex + 1} heading=${String(u.label || "")} chapter=${preRebindMismatch.chapterIndex + 1} expected_parent=${preRebindMismatch.expectedParentUnitId || "(empty)"} actual_parent=${preRebindMismatch.actualParentUnitId || "(empty)"} chapter_id=${String(ch["chapter id"] || "")} row_span=${Number(ch["row start"])}..${Number(ch["row end"])}`);
  }
  const groundedUnits = rebindChildChapterParents(groundedUnitsPruned);
  assertLocalParentChapterInvariant(groundedUnits);

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
