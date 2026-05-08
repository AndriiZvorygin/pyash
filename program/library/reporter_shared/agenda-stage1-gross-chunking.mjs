import fs from "node:fs";

import {
  writePyaMapArtifact,
  validateGrossChunksStrict,
} from "./agenda-stage-contracts.mjs";

const STAGE1_ROOT = "agenda gross chunks artifact";

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
      item,
      title: title || `Agenda item ${item}`,
      level: item.includes(".") ? 2 : 1,
    });
  }
  if (!sections.length) throw new Error(`stage1 defective: no agenda hierarchy parsed from ${agendaPath}`);
  return sections;
}

function buildRowWindows(rows, maxWords = 1600) {
  const windows = [];
  let cursor = 0;
  while (cursor < rows.length) {
    let wordCount = 0;
    let end = cursor;
    while (end < rows.length) {
      const rowWords = String(rows[end].text || "").split(/\s+/u).filter(Boolean).length;
      if (end > cursor && wordCount + rowWords > maxWords) break;
      wordCount += rowWords;
      end += 1;
    }
    const rowStart = cursor;
    const rowEnd = Math.max(rowStart, end - 1);
    const snippetRows = rows.slice(rowStart, Math.min(rows.length, rowStart + 20));
    const snippet = snippetRows.map((r) => `${r.speaker}: ${r.text}`).join("\n").slice(0, 4000);
    windows.push({
      chunkId: `gross_${String(windows.length + 1).padStart(3, "0")}`,
      rowStart,
      rowEnd,
      rowCount: (rowEnd - rowStart) + 1,
      since: Number(rows[rowStart]?.since || 0),
      until: Number(rows[rowEnd]?.until || rows[rowStart]?.until || 0),
      sourceWords: wordCount,
      snippet,
    });
    cursor = rowEnd + 1;
  }
  return windows;
}

async function callOllamaJson({ ollamaUrl, llmModel, system, prompt }) {
  const body = {
    model: llmModel,
    stream: false,
    think: false,
    options: { temperature: 0.1 },
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
  };

  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const res = await fetch(ollamaUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`ollama status ${res.status}`);
      const payload = await res.json();
      const content = String(payload?.message?.content || "").trim();
      const direct = (() => {
        try { return JSON.parse(content); } catch { return null; }
      })();
      if (direct) return direct;
      const match = content.match(/\{[\s\S]*\}/u);
      if (match) return JSON.parse(match[0]);
      throw new Error("unparseable-json");
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("ollama failed");
}

function agendaGuidanceText(sections) {
  return sections.slice(0, 120).map((s) => `- ${s.item} ${s.title}`).join("\n");
}

async function summarizeGrossWindow({ window, sections, llmModel, ollamaUrl }) {
  const prompt = [
    "You are stage1 of a strict agenda transcript pipeline.",
    "Return strict JSON only with keys:",
    "semantic summary, likely agenda item, signal flow, topic transition, cue confidence, notes",
    "signal flow must be one of: start, continue, end, unknown",
    "topic transition must be one of: major, minor, none, unknown",
    "likely agenda item should be agenda item like 6, 6.a, 10; else unknown",
    "Do not leave keys out.",
    "",
    "Agenda hierarchy:",
    agendaGuidanceText(sections),
    "",
    `Window row range: ${window.rowStart}..${window.rowEnd}`,
    `Window duration seconds: ${Math.max(0, window.until - window.since).toFixed(2)}`,
    "Transcript window excerpt:",
    window.snippet,
  ].join("\n");

  const parsed = await callOllamaJson({
    ollamaUrl,
    llmModel,
    system: "You produce strict JSON only for stage1 gross chunk summaries.",
    prompt,
  });

  return {
    semanticSummary: normalizeText(parsed?.["semantic summary"] || ""),
    likelyAgendaItem: normalizeText(parsed?.["likely agenda item"] || "unknown").toLowerCase(),
    signalFlow: normalizeText(parsed?.["signal flow"] || "unknown").toLowerCase(),
    topicTransition: normalizeText(parsed?.["topic transition"] || "unknown").toLowerCase(),
    cueConfidence: Number.isFinite(Number(parsed?.["cue confidence"])) ? Number(parsed["cue confidence"]) : 0,
    notes: normalizeText(parsed?.notes || ""),
  };
}

export async function runAgendaStage1GrossChunking({
  rowsJsonPath,
  agendaPath,
  grossChunksPyaPath,
  llmModel = "qwen3.5:9b",
  ollamaUrl = "http://mriczo:11434/api/chat",
  log = () => {},
}) {
  const rows = parseSpeakerRows(rowsJsonPath);
  if (!rows.length) throw new Error("stage1 defective: no transcript speaker rows");
  const sections = parseAgendaHierarchy(agendaPath);
  const windows = buildRowWindows(rows, Number(process.env.AGENDA_GROSS_WINDOW_WORDS || 1600));
  if (!windows.length) throw new Error("stage1 defective: no gross windows built");

  const chunks = [];
  for (let i = 0; i < windows.length; i += 1) {
    const window = windows[i];
    const llm = await summarizeGrossWindow({ window, sections, llmModel, ollamaUrl });
    const chunk = {
      "chunk id": window.chunkId,
      "row start": window.rowStart,
      "row end": window.rowEnd,
      "row count": window.rowCount,
      since: window.since,
      until: window.until,
      "source words": window.sourceWords,
      "semantic summary": llm.semanticSummary,
      "likely agenda item": llm.likelyAgendaItem || "unknown",
      "signal flow": llm.signalFlow || "unknown",
      "topic transition": llm.topicTransition || "unknown",
      "cue confidence": llm.cueConfidence,
      notes: llm.notes,
    };
    chunks.push(chunk);
    log(`[agenda-stage1] gross ${i + 1}/${windows.length} rows ${window.rowStart}..${window.rowEnd} cue=${chunk["likely agenda item"]} flow=${chunk["signal flow"]} transition=${chunk["topic transition"]}`);
  }

  const artifact = {
    "schema version": "agenda_gross_chunks_v1",
    "transcript rows total": rows.length,
    "generated time": new Date().toISOString(),
    chunks,
  };
  validateGrossChunksStrict(artifact);
  writePyaMapArtifact(grossChunksPyaPath, STAGE1_ROOT, artifact);
  log(`[agenda-stage1] wrote: ${grossChunksPyaPath}`);
  return artifact;
}
