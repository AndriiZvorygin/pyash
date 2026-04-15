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
    for (let i = 0; i < indices.length; i += 1) {
      if (indices[i] !== i) {
        throw new Error(`stage2 defective: non-contiguous part indices in group ${groupKey}`);
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
    const partTotal = Number(s["part total"] || 1);
    const chapterText = String(s["chapter text"] || "");
    if (partTotal > 1 && !chapterText.trim()) {
      throw new Error(`stage3 defective: empty chapter text for split unit at section=${i + 1}`);
    }
  }
}
