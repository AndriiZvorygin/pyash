import fs from "node:fs";
import path from "node:path";

import { pyaFileToJson } from "../pya_to_json.mjs";

function normalizePyaName(value = "") {
  return String(value || "")
    .replace(/[^a-z0-9_ ]/giu, " ")
    .replace(/_/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

function safeJsonParse(text, fallback) {
  try {
    return JSON.parse(String(text || ""));
  } catch {
    return fallback;
  }
}

function hasSnakeCaseKeys(obj = {}) {
  return Object.keys(obj || {}).some((k) => /_/u.test(String(k || "")));
}

function assertNoSnakeCaseKeys(obj = {}, where = "artifact") {
  if (hasSnakeCaseKeys(obj)) {
    throw new Error(`${where} defective: snake_case keys are not allowed`);
  }
}

function assertExactKeys(obj = {}, allowed = [], where = "artifact") {
  const keys = Object.keys(obj || {});
  const allowedSet = new Set(allowed);
  for (const k of keys) {
    if (!allowedSet.has(k)) throw new Error(`${where} defective: unexpected field "${k}"`);
  }
  for (const k of allowed) {
    if (!Object.hasOwn(obj, k)) throw new Error(`${where} defective: missing required field "${k}"`);
  }
}

export function writePyaMapArtifact(filePath, rootName, payload = {}) {
  const root = normalizePyaName(rootName || "artifact");
  const lines = [`su name ${root} be map def`];
  const obj = payload && typeof payload === "object" ? payload : {};
  for (const [rawKey, rawValue] of Object.entries(obj)) {
    const key = normalizePyaName(rawKey);
    if (!key) continue;
    lines.push(`exists su name ${key} ob text ${JSON.stringify(JSON.stringify(rawValue ?? null))} ya`);
  }
  lines.push("prah", "");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
}

export async function readPyaMapArtifact(filePath, rootName) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) throw new Error(`file not found: ${resolved}`);
  const payload = await pyaFileToJson(resolved, { memoryOnly: false });
  const index = payload?.index && typeof payload.index === "object" ? payload.index : {};
  const root = String(rootName || "").trim().toLowerCase();
  const row = Object.entries(index).find(([k]) => String(k || "").trim().toLowerCase() === root)?.[1];
  if (!row) {
    throw new Error(`pya artifact root not found: ${rootName} in ${resolved}`);
  }
  const mapObj = (() => {
    if (row.ob && typeof row.ob === "object") return row.ob;
    const rawMap = row?.raw?.ob?.map;
    if (!rawMap || typeof rawMap !== "object") return null;
    const decoded = {};
    for (const [k, sentence] of Object.entries(rawMap)) {
      const text = sentence?.ob?.text;
      if (typeof text === "string") decoded[k] = text;
    }
    return decoded;
  })();
  if (!mapObj || typeof mapObj !== "object") {
    throw new Error(`pya artifact root has no map payload: ${rootName} in ${resolved}`);
  }
  const out = {};
  for (const [k, v] of Object.entries(mapObj)) {
    const spacedKey = String(k || "").trim().toLowerCase().replace(/\s+/gu, " ");
    out[spacedKey] = safeJsonParse(v, v);
  }
  return out;
}

export function validateGrossChunksStrict(gross = {}) {
  assertNoSnakeCaseKeys(gross, "stage1 gross");
  assertExactKeys(gross, ["schema version", "transcript rows total", "generated time", "chunks"], "stage1 gross");
  if (String(gross["schema version"] || "") !== "agenda_gross_chunks_v1") {
    throw new Error("stage1 defective: invalid schema version");
  }
  const chunks = Array.isArray(gross?.chunks) ? gross.chunks : [];
  if (!chunks.length) throw new Error("stage1 defective: no gross chunks");

  let expectedStart = 0;
  let emptyCount = 0;
  for (let i = 0; i < chunks.length; i += 1) {
    const c = chunks[i] || {};
    assertNoSnakeCaseKeys(c, `stage1 chunk ${i + 1}`);
    const start = Number(c["row start"]);
    const end = Number(c["row end"]);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
      throw new Error(`stage1 defective: invalid chunk row range at index=${i + 1}`);
    }
    if (start !== expectedStart) {
      throw new Error(`stage1 defective: discontinuous row coverage at chunk=${i + 1} expected_start=${expectedStart} got=${start}`);
    }
    expectedStart = end + 1;

    if (!String(c["semantic summary"] || "").trim()) emptyCount += 1;
    for (const required of ["likely agenda item", "signal flow", "topic transition"]) {
      if (!Object.hasOwn(c, required)) {
        throw new Error(`stage1 defective: missing cue field ${required} at chunk=${i + 1}`);
      }
    }
  }

  const toleratedEmpty = Math.max(1, Math.floor(chunks.length * 0.1));
  if (emptyCount > toleratedEmpty) {
    throw new Error(`stage1 defective: semantically empty chunks=${emptyCount} total=${chunks.length}`);
  }

  const totalRows = Number(gross?.["transcript rows total"] || 0);
  if (Number.isInteger(totalRows) && totalRows > 0 && expectedStart !== totalRows) {
    throw new Error(`stage1 defective: row coverage ended at ${expectedStart - 1} expected ${totalRows - 1}`);
  }
}

function isSubstantiveUnit(unit = {}) {
  if (unit?.substantive === false) return false;
  const heading = String(unit?.label || unit?.title || "").toLowerCase();
  if (!heading) return true;
  return !(
    heading.includes("call to order") ||
    heading.includes("declaration of interest") ||
    heading.includes("adjourn")
  );
}

function isProceduralOrEmptyUnit(unit = {}) {
  if (!isSubstantiveUnit(unit)) return true;
  const heading = String(unit?.label || unit?.title || "").toLowerCase();
  const excerpt = String(unit?.["source excerpt"] || "").toLowerCase();
  if (Number(unit?.["source rows"] || 0) <= 2 || Number(unit?.["duration seconds"] || 0) <= 75) return true;
  return (
    /\bthere\s+are\s+no\b/u.test(heading) ||
    /\bthere\s+are\s+no\b/u.test(excerpt) ||
    /\b(no\s+notices?\s+of\s+motion|no\s+correspondence\s+items|no\s+public\s+meetings)\b/u.test(excerpt) ||
    /\b(motion\s+that\s+committee\s+of\s+the\s+whole\s+rise\s+and\s+report|motion\s+to\s+adopt\s+proceedings)\b/u.test(heading)
  );
}

export function validateSectionGroundingStrict(grounding = {}, gross = {}) {
  assertNoSnakeCaseKeys(grounding, "stage2 grounding");
  assertExactKeys(grounding, ["schema version", "generated time", "transcript rows total", "grounded units"], "stage2 grounding");
  if (String(grounding["schema version"] || "") !== "agenda_section_grounding_v1") {
    throw new Error("stage2 defective: invalid schema version");
  }
  const units = Array.isArray(grounding?.["grounded units"]) ? grounding["grounded units"] : [];
  if (!units.length) throw new Error("stage2 defective: no grounded units");
  const grossChunks = Array.isArray(gross?.chunks) ? gross.chunks : [];
  const grossChunkIds = new Set(
    grossChunks.map((c) => String(c?.["chunk id"] || "")).filter(Boolean),
  );
  const maxChapterSourceChars = Math.max(2000, Number(process.env.AGENDA_CHAPTER_MAX_SOURCE_CHARS || 12000));
  const sectionSplitSeconds = Math.max(60, Number(process.env.AGENDA_SECTION_SPLIT_SECONDS || 900));

  for (let i = 0; i < units.length; i += 1) {
    const u = units[i] || {};
    assertNoSnakeCaseKeys(u, `stage2 grounded unit ${i + 1}`);
    const rowStart = Number(u["row start"]);
    const rowEnd = Number(u["row end"]);
    if (!Number.isInteger(rowStart) || !Number.isInteger(rowEnd) || rowStart < 0 || rowEnd < rowStart) {
      throw new Error(`stage2 defective: invalid row range at grounded unit=${i + 1}`);
    }
    const sourceRows = Number(u["source rows"]);
    if (!Number.isInteger(sourceRows) || sourceRows <= 0) {
      throw new Error(`stage2 defective: source rows invalid at grounded unit=${i + 1}`);
    }
    const chunkIds = Array.isArray(u["chunk ids"]) ? u["chunk ids"] : [];
    if (!chunkIds.length) {
      throw new Error(`stage2 defective: no chunk backing at grounded unit=${i + 1}`);
    }
    for (const cid of chunkIds) {
      if (!grossChunkIds.has(String(cid || ""))) {
        throw new Error(`stage2 defective: unknown chunk id "${cid}" at grounded unit=${i + 1}`);
      }
    }
    if (isSubstantiveUnit(u) && sourceRows <= 0) {
      throw new Error(`stage2 defective: substantive unit has zero rows at unit=${i + 1}`);
    }
    const parentRaw = u["parent unit id"];
    if (parentRaw != null && !String(parentRaw).trim()) {
      throw new Error(`stage2 defective: invalid split lineage parent at grounded unit=${i + 1}`);
    }
    const partTotal = Number(u["part total"] || 1);
    const partIndex = Number(u["part index"] || 0);
    if (!Number.isInteger(partTotal) || partTotal < 1) {
      throw new Error(`stage2 defective: invalid part total at grounded unit=${i + 1}`);
    }
    if (!Number.isInteger(partIndex) || partIndex < 0 || partIndex >= partTotal) {
      throw new Error(`stage2 defective: invalid part index at grounded unit=${i + 1}`);
    }
    if (partTotal > 1 && !String(parentRaw || "").trim()) {
      throw new Error(`stage2 defective: split unit missing parent unit id at grounded unit=${i + 1}`);
    }
    if (!Object.hasOwn(u, "trace chunk ids") || !Object.hasOwn(u, "trace row span") || !Object.hasOwn(u, "trace signals")) {
      throw new Error(`stage2 defective: missing trace fields at grounded unit=${i + 1}`);
    }
    const excerpt = String(u["source excerpt"] || "").trim();
    if (!excerpt) {
      throw new Error(`stage2 defective: empty source excerpt at grounded unit=${i + 1}`);
    }
    const expectedRows = (rowEnd - rowStart) + 1;
    if (sourceRows !== expectedRows) {
      throw new Error(`stage2 defective: source rows mismatch at grounded unit=${i + 1} expected=${expectedRows} actual=${sourceRows}`);
    }
    const spanText = String(u["trace row span"] || "");
    if (spanText !== `${rowStart}..${rowEnd}`) {
      throw new Error(`stage2 defective: trace row span mismatch at grounded unit=${i + 1}`);
    }
    const since = Number(u.since);
    const until = Number(u.until);
    const duration = Number(u["duration seconds"]);
    if (!Number.isFinite(since) || !Number.isFinite(until) || !Number.isFinite(duration) || until < since) {
      throw new Error(`stage2 defective: invalid timing fields at grounded unit=${i + 1}`);
    }
    const expectedDuration = Math.max(0, until - since);
    if (Math.abs(duration - expectedDuration) > 0.75) {
      throw new Error(`stage2 defective: duration mismatch at grounded unit=${i + 1} expected~=${expectedDuration.toFixed(3)} actual=${duration.toFixed(3)}`);
    }

    const chapters = Array.isArray(u["child chapters"]) ? u["child chapters"] : [];
    if (chapters.length === 1) {
      throw new Error(`stage2 defective: child chapters must be 0 or >=2 at grounded unit=${i + 1}`);
    }
    if (Number(u["duration seconds"] || 0) > sectionSplitSeconds && !isProceduralOrEmptyUnit(u) && chapters.length < 2) {
      throw new Error(`stage2 defective: long grounded unit missing child chapters at grounded unit=${i + 1} duration=${Number(u["duration seconds"] || 0).toFixed(1)} threshold=${sectionSplitSeconds}`);
    }
    let prevChapterEnd = null;
    let chapterCoveredRows = 0;
    for (let ci = 0; ci < chapters.length; ci += 1) {
      const ch = chapters[ci] || {};
      assertNoSnakeCaseKeys(ch, `stage2 chapter ${i + 1}.${ci + 1}`);
      const chParent = String(ch["parent unit id"] || "").trim();
      if (chParent !== String(u["unit id"] || "")) {
        throw new Error(`stage2 defective: child chapter parent mismatch at grounded unit=${i + 1} chapter=${ci + 1}`);
      }
      const chId = String(ch["chapter id"] || "").trim();
      if (!chId) {
        throw new Error(`stage2 defective: empty chapter id at grounded unit=${i + 1} chapter=${ci + 1}`);
      }
      const order = Number(ch["ordering index"]);
      if (!Number.isInteger(order) || order !== ci + 1) {
        throw new Error(`stage2 defective: invalid child chapter ordering at grounded unit=${i + 1} chapter=${ci + 1}`);
      }
      const chStart = Number(ch["row start"]);
      const chEnd = Number(ch["row end"]);
      if (!Number.isInteger(chStart) || !Number.isInteger(chEnd) || chStart < rowStart || chEnd > rowEnd || chEnd < chStart) {
        throw new Error(`stage2 defective: child chapter span out of parent bounds at grounded unit=${i + 1} chapter=${ci + 1}`);
      }
      if (prevChapterEnd != null && chStart <= prevChapterEnd) {
        throw new Error(`stage2 defective: child chapter overlap at grounded unit=${i + 1} chapter=${ci + 1}`);
      }
      if (ci === 0 && chStart !== rowStart) {
        throw new Error(`stage2 defective: child chapters do not start at parent row at grounded unit=${i + 1}`);
      }
      if (prevChapterEnd != null && chStart !== prevChapterEnd + 1) {
        throw new Error(`stage2 defective: child chapter row gap at grounded unit=${i + 1} chapter=${ci + 1}`);
      }
      prevChapterEnd = chEnd;
      const chRows = Number(ch["source rows"]);
      const chExpectedRows = (chEnd - chStart) + 1;
      chapterCoveredRows += chExpectedRows;
      if (!Number.isInteger(chRows) || chRows !== chExpectedRows) {
        throw new Error(`stage2 defective: child chapter source rows mismatch at grounded unit=${i + 1} chapter=${ci + 1}`);
      }
      const sourceChars = Number(ch["source chars"] || 0);
      if (Number.isFinite(sourceChars) && sourceChars > maxChapterSourceChars) {
        throw new Error(`stage2 defective: child chapter source chars too large at grounded unit=${i + 1} chapter=${ci + 1} source_chars=${sourceChars} max=${maxChapterSourceChars}`);
      }
      const chChunkIds = Array.isArray(ch["chunk ids"]) ? ch["chunk ids"] : [];
      if (!chChunkIds.length) {
        throw new Error(`stage2 defective: child chapter missing chunk backing at grounded unit=${i + 1} chapter=${ci + 1}`);
      }
      for (const cid of chChunkIds) {
        if (!grossChunkIds.has(String(cid || ""))) {
          throw new Error(`stage2 defective: unknown child chapter chunk id "${cid}" at grounded unit=${i + 1} chapter=${ci + 1}`);
        }
      }
      const chSince = Number(ch.since);
      const chUntil = Number(ch.until);
      const chDuration = Number(ch["duration seconds"]);
      if (!Number.isFinite(chSince) || !Number.isFinite(chUntil) || !Number.isFinite(chDuration) || chUntil < chSince) {
        throw new Error(`stage2 defective: invalid child chapter timing at grounded unit=${i + 1} chapter=${ci + 1}`);
      }
      const chExpectedDuration = Math.max(0, chUntil - chSince);
      if (Math.abs(chDuration - chExpectedDuration) > 0.75) {
        throw new Error(`stage2 defective: child chapter duration mismatch at grounded unit=${i + 1} chapter=${ci + 1}`);
      }
      const chSpanText = String(ch["trace row span"] || "");
      if (chSpanText !== `${chStart}..${chEnd}`) {
        throw new Error(`stage2 defective: child chapter trace row span mismatch at grounded unit=${i + 1} chapter=${ci + 1}`);
      }
      if (!String(ch["source excerpt"] || "").trim()) {
        throw new Error(`stage2 defective: empty child chapter source excerpt at grounded unit=${i + 1} chapter=${ci + 1}`);
      }
    }
    if (chapters.length >= 2) {
      if (prevChapterEnd !== rowEnd) {
        throw new Error(`stage2 defective: child chapters do not end at parent row at grounded unit=${i + 1}`);
      }
      const expectedRows = rowEnd - rowStart + 1;
      if (chapterCoveredRows !== expectedRows) {
        throw new Error(`stage2 defective: child chapter row coverage mismatch at grounded unit=${i + 1} expected=${expectedRows} actual=${chapterCoveredRows}`);
      }
    }
  }

  const sortedUnits = units
    .slice()
    .sort((a, b) => Number(a["row start"]) - Number(b["row start"]));
  const maxGapRows = Number(process.env.AGENDA_MAX_GAP_ROWS || 3);
  for (let i = 1; i < sortedUnits.length; i += 1) {
    const prev = sortedUnits[i - 1];
    const cur = sortedUnits[i];
    const prevEnd = Number(prev["row end"]);
    const curStart = Number(cur["row start"]);
    if (curStart <= prevEnd) {
      throw new Error(`stage2 defective: non-monotonic row ranges at grounded unit index=${i + 1}`);
    }
    const gap = curStart - prevEnd - 1;
    const gapAllowed = String(cur["gap status"] || "").toLowerCase() === "allowed";
    if (gap > maxGapRows && !gapAllowed) {
      throw new Error(`stage2 defective: gap too large (${gap} rows) at grounded unit index=${i + 1}`);
    }
  }

  const byAgenda = new Map();
  for (const u of units) {
    const key = String(u["agenda item"] || u["parent agenda item"] || "");
    if (!key) continue;
    const arr = byAgenda.get(key) || [];
    arr.push(u);
    byAgenda.set(key, arr);
  }
  for (const [item, arr] of byAgenda.entries()) {
    const sorted = arr.slice().sort(
      (a, b) => Number(a["row start"]) - Number(b["row start"])
    );
    for (let i = 1; i < sorted.length; i += 1) {
      const prevEnd = Number(sorted[i - 1]["row end"]);
      const curStart = Number(sorted[i]["row start"]);
      if (curStart <= prevEnd) {
        throw new Error(`stage2 defective: impossible overlap for agenda item ${item}`);
      }
    }
  }

  const byParent = new Map();
  for (const u of units) {
    const groupKey = String(u["parent unit id"] || u["unit id"] || "");
    if (!groupKey) continue;
    const arr = byParent.get(groupKey) || [];
    arr.push(u);
    byParent.set(groupKey, arr);
  }
  for (const [groupKey, arr] of byParent.entries()) {
    if (!arr.length) continue;
    const totals = new Set(arr.map((u) => Number(u["part total"] || 1)));
    if (totals.size !== 1) {
      throw new Error(`stage2 defective: inconsistent part total in group ${groupKey}`);
    }
    const total = Number(arr[0]["part total"] || 1);
    const indices = arr.map((u) => Number(u["part index"] || 0)).sort((a, b) => a - b);
    if (indices.length !== total) {
      throw new Error(`stage2 defective: sibling count mismatch in group ${groupKey}`);
    }
    if (total > 1) {
      const excerpts = arr.map((u) => String(u["source excerpt"] || "").trim());
      const distinct = new Set(excerpts);
      if (distinct.size !== excerpts.length) {
        throw new Error(`stage2 defective: duplicate source excerpts in split group ${groupKey}`);
      }
      const starts = arr.map((u) => Number(u.since));
      const ends = arr.map((u) => Number(u.until));
      const durations = arr.map((u) => Number(u["duration seconds"]));
      if (starts.some((n) => !Number.isFinite(n)) || ends.some((n) => !Number.isFinite(n)) || durations.some((n) => !Number.isFinite(n) || n <= 0)) {
        throw new Error(`stage2 defective: invalid split timing values in group ${groupKey}`);
      }
      const groupDuration = Math.max(...ends) - Math.min(...starts);
      for (const d of durations) {
        if (!(d < groupDuration)) {
          throw new Error(`stage2 defective: split duration not smaller than parent span in group ${groupKey}`);
        }
      }
    }
  }
}

export function validateAgendaSummaryStrict(sectionGrounding = {}, summary = {}) {
  assertNoSnakeCaseKeys(sectionGrounding, "stage3 grounding input");
  const units = Array.isArray(sectionGrounding?.["grounded units"]) ? sectionGrounding["grounded units"] : [];
  assertNoSnakeCaseKeys(summary, "stage3 summary");
  assertExactKeys(summary, ["schema version", "source section grounding", "transcript dir", "prefix", "focus", "generated time", "sections"], "stage3 summary");
  if (String(summary["schema version"] || "") !== "agenda_summary_v1") {
    throw new Error("stage3 defective: invalid summary schema version");
  }
  const sections = Array.isArray(summary?.sections) ? summary.sections : [];
  if (!units.length) throw new Error("stage3 defective: no grounding units");
  if (sections.length !== units.length) {
    throw new Error(`stage3 defective: summary unit count mismatch grounding=${units.length} summary=${sections.length}`);
  }

  const unitIds = new Set(units.map((u) => String(u["unit id"] || "")).filter(Boolean));
  for (let i = 0; i < sections.length; i += 1) {
    const s = sections[i] || {};
    assertNoSnakeCaseKeys(s, `stage3 section ${i + 1}`);
    const unitId = String(s["unit id"] || "");
    if (!unitId || !unitIds.has(unitId)) {
      throw new Error(`stage3 defective: unknown unit_id at section=${i + 1}`);
    }
    if (!String(s.summary || "").trim()) {
      throw new Error(`stage3 defective: empty summary at section=${i + 1}`);
    }
    const chapters = Array.isArray(s.chapters) ? s.chapters : [];
    const sourceUnit = units.find((u) => String(u["unit id"] || "") === unitId) || {};
    const expectedChapters = Array.isArray(sourceUnit["child chapters"]) ? sourceUnit["child chapters"] : [];
    if (chapters.length !== expectedChapters.length) {
      throw new Error(`stage3 defective: chapter count mismatch for section=${i + 1} expected=${expectedChapters.length} actual=${chapters.length}`);
    }
    for (let ci = 0; ci < chapters.length; ci += 1) {
      const ch = chapters[ci] || {};
      assertNoSnakeCaseKeys(ch, `stage3 chapter ${i + 1}.${ci + 1}`);
      const expected = expectedChapters[ci] || {};
      if (String(ch["parent unit id"] || "") !== unitId) {
        throw new Error(`stage3 defective: chapter parent mismatch at section=${i + 1} chapter=${ci + 1}`);
      }
      if (String(ch["chapter id"] || "") !== String(expected["chapter id"] || "")) {
        throw new Error(`stage3 defective: chapter id mismatch at section=${i + 1} chapter=${ci + 1}`);
      }
      if (!String(ch.title || "").trim()) {
        throw new Error(`stage3 defective: empty chapter title at section=${i + 1} chapter=${ci + 1}`);
      }
    }
  }
}

export function validateMeetingSummaryChunksStrict(chunksArtifact = {}) {
  assertNoSnakeCaseKeys(chunksArtifact, "meeting summary chunks");
  assertExactKeys(
    chunksArtifact,
    [
      "schema version",
      "source agenda summary",
      "transcript dir",
      "prefix",
      "focus",
      "generated time",
      "source sections total",
      "chunks",
    ],
    "meeting summary chunks",
  );
  if (String(chunksArtifact["schema version"] || "") !== "meeting_summary_chunks_v1") {
    throw new Error("meeting summary chunks defective: invalid schema version");
  }
  const sourceSectionsTotal = Number(chunksArtifact["source sections total"] || 0);
  if (!Number.isInteger(sourceSectionsTotal) || sourceSectionsTotal <= 0) {
    throw new Error("meeting summary chunks defective: invalid source sections total");
  }
  const chunks = Array.isArray(chunksArtifact?.chunks) ? chunksArtifact.chunks : [];
  if (!chunks.length) throw new Error("meeting summary chunks defective: no chunks");

  const seenChunkIds = new Set();
  let expectedSectionStart = 1;
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i] || {};
    assertNoSnakeCaseKeys(chunk, `meeting summary chunk ${i + 1}`);
    assertExactKeys(
      chunk,
      [
        "chunk id",
        "section start index",
        "section end index",
        "covered headings",
        "source section count",
        "source byte count",
        "chunk summary text",
      ],
      `meeting summary chunk ${i + 1}`,
    );
    const chunkId = String(chunk["chunk id"] || "").trim();
    if (!chunkId) throw new Error(`meeting summary chunks defective: empty chunk id at index=${i + 1}`);
    if (seenChunkIds.has(chunkId)) {
      throw new Error(`meeting summary chunks defective: duplicate chunk id "${chunkId}"`);
    }
    seenChunkIds.add(chunkId);

    const sectionStart = Number(chunk["section start index"]);
    const sectionEnd = Number(chunk["section end index"]);
    if (!Number.isInteger(sectionStart) || !Number.isInteger(sectionEnd) || sectionStart < 1 || sectionEnd < sectionStart) {
      throw new Error(`meeting summary chunks defective: invalid section range at chunk=${i + 1}`);
    }
    if (sectionStart !== expectedSectionStart) {
      throw new Error(
        `meeting summary chunks defective: discontinuous section coverage at chunk=${i + 1} expected_start=${expectedSectionStart} got=${sectionStart}`,
      );
    }
    const sectionCount = Number(chunk["source section count"]);
    if (!Number.isInteger(sectionCount) || sectionCount <= 0) {
      throw new Error(`meeting summary chunks defective: invalid source section count at chunk=${i + 1}`);
    }
    if (sectionCount !== (sectionEnd - sectionStart + 1)) {
      throw new Error(`meeting summary chunks defective: source section count mismatch at chunk=${i + 1}`);
    }
    const headings = Array.isArray(chunk["covered headings"]) ? chunk["covered headings"] : [];
    if (headings.length !== sectionCount) {
      throw new Error(`meeting summary chunks defective: covered headings count mismatch at chunk=${i + 1}`);
    }
    const sourceBytes = Number(chunk["source byte count"]);
    if (!Number.isFinite(sourceBytes) || sourceBytes <= 0) {
      throw new Error(`meeting summary chunks defective: invalid source byte count at chunk=${i + 1}`);
    }
    if (!String(chunk["chunk summary text"] || "").trim()) {
      throw new Error(`meeting summary chunks defective: empty chunk summary text at chunk=${i + 1}`);
    }
    expectedSectionStart = sectionEnd + 1;
  }

  if (expectedSectionStart !== sourceSectionsTotal + 1) {
    throw new Error(
      `meeting summary chunks defective: section coverage ended at ${expectedSectionStart - 1} expected ${sourceSectionsTotal}`,
    );
  }
}

export function validateMeetingSummaryArtifactStrict(summary = {}, chunksArtifact = {}) {
  assertNoSnakeCaseKeys(summary, "meeting summary artifact");
  assertExactKeys(
    summary,
    [
      "schema version",
      "source meeting summary chunks",
      "focus",
      "score",
      "generated time",
      "headings",
      "markdown",
      "verifier feedback",
      "chunk count",
    ],
    "meeting summary artifact",
  );
  if (String(summary["schema version"] || "") !== "meeting_summary_v1") {
    throw new Error("meeting summary artifact defective: invalid schema version");
  }
  const score = Number(summary.score);
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    throw new Error("meeting summary artifact defective: invalid score");
  }
  const chunkCount = Number(summary["chunk count"] || 0);
  if (!Number.isInteger(chunkCount) || chunkCount <= 0) {
    throw new Error("meeting summary artifact defective: invalid chunk count");
  }
  const chunks = Array.isArray(chunksArtifact?.chunks) ? chunksArtifact.chunks : [];
  if (chunks.length && chunkCount !== chunks.length) {
    throw new Error(`meeting summary artifact defective: chunk count mismatch artifact=${chunkCount} chunks=${chunks.length}`);
  }
  const markdown = String(summary.markdown || "");
  if (!markdown.trim()) {
    throw new Error("meeting summary artifact defective: empty markdown");
  }
  const requiredHeadings = [
    /^#\s+Whole Meeting Summary\b/mu,
    /^##\s+Top Newsworthy Developments\b/mu,
    /^##\s+Why It Matters\b/mu,
    /^##\s+Watch Next\b/mu,
  ];
  for (const pattern of requiredHeadings) {
    if (!pattern.test(markdown)) {
      throw new Error(`meeting summary artifact defective: missing required heading ${pattern}`);
    }
  }
}
