import fs from "node:fs";

import {
  readPyaMapArtifact,
  writePyaMapArtifact,
  validateAgendaSummaryStrict,
} from "./agenda-stage-contracts.mjs";

const STAGE2_GROUNDING_ROOT = "agenda section grounding artifact";
const STAGE3_SUMMARY_ROOT = "agenda summary artifact";

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/gu, " ").trim();
}

function assertExactGroundingRoot(filePath) {
  const lines = String(fs.readFileSync(filePath, "utf8")).split(/\r?\n/u);
  const first = String(lines[0] || "").trim();
  const expected = "su name agenda section grounding artifact be map def";
  if (first !== expected) {
    throw new Error(`stage3 defective: grounding root mismatch at ${filePath}`);
  }
}

function assertExactGroundingSchema(grounding = {}) {
  const allowed = new Set(["schema version", "generated time", "transcript rows total", "grounded units"]);
  const keys = Object.keys(grounding || {});
  for (const k of keys) {
    if (!allowed.has(k)) throw new Error(`stage3 defective: unexpected grounding top-level field "${k}"`);
    if (/_/u.test(String(k || ""))) throw new Error(`stage3 defective: snake_case grounding field "${k}"`);
  }
  for (const req of allowed) {
    if (!Object.hasOwn(grounding, req)) {
      throw new Error(`stage3 defective: missing grounding field "${req}"`);
    }
  }
  if (String(grounding["schema version"] || "") !== "agenda_section_grounding_v1") {
    throw new Error("stage3 defective: invalid grounding schema version");
  }
}

async function callOllamaJson({ ollamaUrl, llmModel, system, prompt }) {
  const body = {
    model: llmModel,
    stream: false,
    think: false,
    options: { temperature: 0.12 },
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
  };
  const res = await fetch(ollamaUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`ollama status ${res.status}`);
  const payload = await res.json();
  const content = String(payload?.message?.content || "").trim();
  try { return JSON.parse(content); } catch {}
  const m = content.match(/\{[\s\S]*\}/u);
  if (!m) throw new Error("unparseable-json");
  return JSON.parse(m[0]);
}

async function summarizeGroundedUnit({ unit, focus, llmModel, ollamaUrl }) {
  const prompt = [
    "You are stage3 of a strict agenda summary pipeline.",
    "Grounding is authoritative. Do not invent boundaries or facts.",
    "Return strict JSON with keys: summary, chapter text, confidence, notes.",
    "summary: 2-5 sentences, factual and source-aligned.",
    "chapter text: short chapter-ready line. If not split, still provide a useful line.",
    "",
    `Focus: ${focus || "newsworthy factual civic reporting"}`,
    `Label: ${unit.label}`,
    `Agenda item: ${unit["agenda item"] || ""}`,
    `Rows: ${unit["row start"]}..${unit["row end"]}`,
    `Duration seconds: ${Number(unit["duration seconds"] || 0).toFixed(1)}`,
    "Grounded source excerpt:",
    String(unit["source excerpt"] || "").slice(0, 12000),
  ].join("\n");

  const parsed = await callOllamaJson({
    ollamaUrl,
    llmModel,
    system: "Produce strict JSON only for grounded section summaries.",
    prompt,
  });

  return {
    summary: normalizeText(parsed?.summary || ""),
    chapterText: normalizeText(parsed?.["chapter text"] || ""),
    confidence: Number.isFinite(Number(parsed?.confidence)) ? Number(parsed.confidence) : 0,
    notes: normalizeText(parsed?.notes || ""),
  };
}

function toMarkdown(summaryArtifact = {}) {
  const lines = [];
  lines.push(`# Agenda Section Summaries`);
  lines.push("");
  const sections = Array.isArray(summaryArtifact?.sections) ? summaryArtifact.sections : [];
  for (const s of sections) {
    lines.push(`## ${s.heading}`);
    lines.push("");
    lines.push(s.summary || "(no summary)");
    lines.push("");
    const chapterText = s["chapter text"] || "";
    if (chapterText) {
      lines.push(`Chapter: ${chapterText}`);
      lines.push("");
    }
  }
  return `${lines.join("\n")}\n`;
}

export async function runAgendaStage3SummaryRenderer({
  transcriptDir,
  prefix,
  sectionGroundingPyaPath,
  outSummaryPyaPath,
  outSummaryMdPath,
  focus = "",
  llmModel = "qwen3.5:9b",
  ollamaUrl = "http://localhost:11434/api/chat",
  log = () => {},
}) {
  assertExactGroundingRoot(sectionGroundingPyaPath);
  const grounding = await readPyaMapArtifact(sectionGroundingPyaPath, STAGE2_GROUNDING_ROOT);
  assertExactGroundingSchema(grounding);
  const units = Array.isArray(grounding?.["grounded units"]) ? grounding["grounded units"] : [];
  if (!units.length) throw new Error("stage3 defective: no grounded units in section-grounding artifact");

  const sections = [];
  for (let i = 0; i < units.length; i += 1) {
    const unit = units[i];
    const llm = await summarizeGroundedUnit({ unit, focus, llmModel, ollamaUrl });
    const unitId = String(unit["unit id"] || "");
    if (!llm.summary) throw new Error(`stage3 defective: empty summary for grounded unit ${unitId}`);
    if (Number(unit["part total"] || 1) > 1 && !llm.chapterText) {
      throw new Error(`stage3 defective: empty chapter text for split grounded unit ${unitId}`);
    }
    const heading = unit.label || `${unit["agenda item"] || ""}`;
    sections.push({
      index: i + 1,
      "unit id": unitId,
      "parent unit id": unit["parent unit id"] || "",
      "part index": Number(unit["part index"] || 0),
      "part total": Number(unit["part total"] || 1),
      heading,
      summary: llm.summary,
      "chapter text": llm.chapterText || heading,
      score: Number(llm.confidence || 0),
      mode: "llm-stage3",
      "source rows": Number(unit["source rows"] || 0),
      "start row": Number(unit["row start"] || 0),
      "end row": Number(unit["row end"] || 0),
      "max section seconds": Number(process.env.AGENDA_SECTION_SPLIT_SECONDS || 900),
      "grounding status": unit["grounding status"] || "",
    });
    log(`[agenda-stage3] section ${i + 1}/${units.length} heading ${heading}`);
  }

  const summaryArtifact = {
    "schema version": "agenda_summary_v1",
    "source section grounding": sectionGroundingPyaPath,
    "transcript dir": transcriptDir,
    prefix,
    focus,
    "generated time": new Date().toISOString(),
    sections,
  };

  validateAgendaSummaryStrict(grounding, summaryArtifact);
  writePyaMapArtifact(outSummaryPyaPath, STAGE3_SUMMARY_ROOT, summaryArtifact);
  fs.writeFileSync(outSummaryMdPath, toMarkdown(summaryArtifact), "utf8");

  log(`[agenda-stage3] sections: ${sections.length}`);
  log(`[agenda-stage3] wrote: ${outSummaryPyaPath}`);
  log(`[agenda-stage3] wrote: ${outSummaryMdPath}`);
  return summaryArtifact;
}
