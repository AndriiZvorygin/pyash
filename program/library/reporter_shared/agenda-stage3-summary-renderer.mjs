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

function stripLeadingAgendaNumber(text = "") {
  return normalizeText(String(text || "").replace(/^\d+(?:\.[a-z0-9]+)*\s*/iu, ""));
}

function countWords(text = "") {
  if (!String(text || "").trim()) return 0;
  return String(text || "")
    .trim()
    .split(/\s+/u)
    .filter(Boolean).length;
}

function splitSentences(text = "") {
  const clean = normalizeText(text);
  if (!clean) return [];
  const parts = clean
    .split(/(?<=[.!?])\s+/u)
    .map((x) => normalizeText(x))
    .filter(Boolean);
  if (parts.length) return parts;
  return [clean];
}

function seemsCompleteSentence(sentence = "") {
  const s = normalizeText(sentence);
  if (!s) return false;
  return /[.!?]["')\]]*$/u.test(s);
}

function isOutcomeSentence(sentence = "") {
  const s = String(sentence || "").toLowerCase();
  return /(approved|defeated|carried|voted|directed|passed|denied|adopted|rejected|motion|resolution)/u.test(s);
}

function chooseSentenceToDrop(sentences = []) {
  if (!sentences.length) return -1;
  if (sentences.length === 1) return 0;
  const outcomeIndexes = new Set();
  for (let i = 0; i < sentences.length; i += 1) {
    if (isOutcomeSentence(sentences[i])) outcomeIndexes.add(i);
  }
  // Prefer dropping the latest non-outcome sentence.
  for (let i = sentences.length - 1; i >= 0; i -= 1) {
    if (!outcomeIndexes.has(i)) return i;
  }
  // Fallback to dropping the last sentence.
  return sentences.length - 1;
}

function cleanupIncompleteTail(sentences = [], { allowOriginalEllipsis = false } = {}) {
  const out = sentences.slice();
  while (out.length) {
    const last = normalizeText(out[out.length - 1] || "");
    if (!last) {
      out.pop();
      continue;
    }
    if (last.endsWith("...") && !allowOriginalEllipsis) {
      out.pop();
      continue;
    }
    if (!seemsCompleteSentence(last)) {
      out.pop();
      continue;
    }
    break;
  }
  return out;
}

function summaryHasMinimalCompleteness(summary = "") {
  const s = normalizeText(summary);
  if (!s) return false;
  const words = s.split(/\s+/u).filter(Boolean);
  if (words.length < 5) return false;
  // Requires at least one action/description cue.
  if (!/(is|was|were|has|had|have|approved|defeated|carried|voted|directed|passed|considered|reported|discussed|adopted|denied|rejected)/iu.test(s)) {
    return false;
  }
  return true;
}

function looksProceduralLabel(label = "") {
  const lower = String(label || "").toLowerCase();
  return (
    lower.includes("call to order") ||
    lower.includes("adoption of agenda") ||
    lower.includes("declaration of interest") ||
    lower.includes("confirmation of minutes") ||
    lower.includes("minutes") ||
    lower.includes("correspondence") ||
    lower.includes("adjourn") ||
    lower.includes("public forum") ||
    lower.includes("opening remarks")
  );
}

function buildSummaryBudget(unit = {}) {
  const durationSeconds = Number(unit["duration seconds"] || 0);
  const sourceRows = Number(unit["source rows"] || 0);
  const excerpt = String(unit["source excerpt"] || "");
  const sourceChars = excerpt.length;
  const splitParts = Number(unit["part total"] || 1);
  const procedural = looksProceduralLabel(unit.label || unit["agenda item"] || "");

  const tiny = durationSeconds <= 75 || sourceRows <= 6 || sourceChars <= 350;
  const short = durationSeconds <= 180 && sourceRows <= 18 && sourceChars <= 1200;
  const medium = durationSeconds <= 780 && sourceRows <= 120;
  const long = durationSeconds <= 1800 && sourceRows <= 260;

  if (procedural && tiny) {
    return {
      tier: "tiny_procedural",
      maxSentences: 1,
      maxWords: 22,
      minSentences: 1,
      paragraphCap: 1,
      procedural,
      durationSeconds,
      sourceRows,
      sourceChars,
      splitParts,
    };
  }
  if (short || (procedural && durationSeconds <= 300 && sourceRows <= 30)) {
    return {
      tier: "short",
      maxSentences: procedural ? 1 : 2,
      maxWords: procedural ? 32 : 48,
      minSentences: 1,
      paragraphCap: 1,
      procedural,
      durationSeconds,
      sourceRows,
      sourceChars,
      splitParts,
    };
  }
  if (medium) {
    return {
      tier: "medium",
      maxSentences: 4,
      maxWords: 130,
      minSentences: 2,
      paragraphCap: 1,
      procedural,
      durationSeconds,
      sourceRows,
      sourceChars,
      splitParts,
    };
  }
  if (long) {
    return {
      tier: "long",
      maxSentences: 6,
      maxWords: 220,
      minSentences: 2,
      paragraphCap: 1,
      procedural,
      durationSeconds,
      sourceRows,
      sourceChars,
      splitParts,
    };
  }
  return {
    tier: "very_long",
    maxSentences: 8,
    maxWords: 320,
    minSentences: 2,
    paragraphCap: splitParts > 1 ? 1 : 2,
    procedural,
    durationSeconds,
    sourceRows,
    sourceChars,
    splitParts,
  };
}

function enforceSummaryBudget(rawSummary = "", budget = {}) {
  const before = normalizeText(rawSummary);
  if (!before) return "";
  const allowOriginalEllipsis = before.endsWith("...");
  const maxSentences = Number.isFinite(Number(budget.maxSentences)) ? Number(budget.maxSentences) : 0;
  const maxWords = Number.isFinite(Number(budget.maxWords)) ? Number(budget.maxWords) : 0;

  let sentences = splitSentences(before);
  sentences = cleanupIncompleteTail(sentences, { allowOriginalEllipsis });
  if (!sentences.length) return "";

  // 1) Sentence-first clamp
  if (budget.procedural) {
    sentences = sentences.slice(0, 1);
  } else if (maxSentences > 0 && sentences.length > maxSentences) {
    sentences = sentences.slice(0, maxSentences);
  }

  // 2) If still over word budget, drop whole sentences (never mid-sentence).
  if (maxWords > 0) {
    while (sentences.length > 1 && countWords(sentences.join(" ")) > maxWords) {
      const idx = chooseSentenceToDrop(sentences);
      if (idx < 0) break;
      sentences.splice(idx, 1);
    }
    // If one sentence is still over budget, keep it as-is to avoid fragmenting.
  }

  // 3) Completeness guard pass ("regenerate once" analog in post-gen enforcement):
  // do one stricter cleanup attempt, then drop incomplete tail.
  let summary = normalizeText(sentences.join(" "));
  if (!summaryHasMinimalCompleteness(summary)) {
    let strictSentences = splitSentences(summary);
    strictSentences = cleanupIncompleteTail(strictSentences, { allowOriginalEllipsis: false });
    if (strictSentences.length > 1 && !summaryHasMinimalCompleteness(strictSentences.join(" "))) {
      strictSentences = strictSentences.slice(0, strictSentences.length - 1);
    }
    summary = normalizeText(strictSentences.join(" "));
  }

  if ((budget.paragraphCap || 1) <= 1) {
    summary = normalizeText(summary.replace(/\n+/gu, " "));
  } else {
    summary = summary.replace(/\n{3,}/gu, "\n\n").trim();
  }

  // Never emit ellipsis artifacts unless present in original source summary.
  if (!allowOriginalEllipsis && summary.endsWith("...")) {
    const retry = cleanupIncompleteTail(splitSentences(summary), { allowOriginalEllipsis: false });
    summary = normalizeText(retry.join(" "));
  }
  return summary;
}

function wordsKey(text = "") {
  return normalizeText(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function isHeadingLikeChapterText(chapterText = "", heading = "") {
  const c = wordsKey(stripLeadingAgendaNumber(chapterText));
  const h = wordsKey(stripLeadingAgendaNumber(heading));
  if (!c || !h) return false;
  if (c === h) return true;
  if (c.length < 24 && (h.includes(c) || c.includes(h))) return true;
  if (h === "next meeting" && c === "next meeting") return true;
  return false;
}

function chapterFromSummary(summary = "") {
  const sentences = splitSentences(summary).filter(Boolean);
  const complete = sentences.find((s) => seemsCompleteSentence(s));
  const base = normalizeText(complete || sentences[0] || summary || "");
  if (!base) return "";
  let out = base.replace(/[.]+$/u, "").trim();
  let words = out.split(/\s+/u).filter(Boolean);
  if (words.length > 18) words = words.slice(0, 18);
  while (words.length > 3) {
    const tail = String(words[words.length - 1] || "").toLowerCase();
    if (!new Set(["a", "an", "the", "to", "of", "for", "and", "or", "with", "by", "on", "in", "at", "from"]).has(tail)) break;
    words = words.slice(0, words.length - 1);
  }
  out = words.join(" ");
  return normalizeText(out);
}

function nextDistinctChapterFromSummary(summary = "", previousChapter = "") {
  const prevKey = wordsKey(previousChapter);
  const sentences = splitSentences(summary).filter(Boolean);
  for (const s of sentences) {
    const candidate = chapterFromSummary(s);
    if (!candidate) continue;
    if (wordsKey(candidate) !== prevKey) return candidate;
  }
  return chapterFromSummary(summary);
}

function finalizeChapterText({ chapterText, heading, summary, splitPart = false, previousChapter = "" }) {
  const fromLlm = normalizeText(chapterText);
  const fromSummary = chapterFromSummary(summary);
  let out = fromLlm || fromSummary || stripLeadingAgendaNumber(heading);
  if (splitPart && isHeadingLikeChapterText(out, heading)) {
    out = fromSummary || out;
  }
  if (splitPart && previousChapter && wordsKey(out) === wordsKey(previousChapter)) {
    out = nextDistinctChapterFromSummary(summary, previousChapter) || out;
  }
  out = normalizeText(out).replace(/[.]+$/u, "");
  return out;
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
  const budget = buildSummaryBudget(unit);
  const longOrderLine =
    budget.tier === "long" || budget.tier === "very_long"
      ? "For long sections, prefer this order when applicable: item under discussion; main substance; decision/direction/outcome."
      : "";
  const prompt = [
    "You are stage3 of a strict agenda summary pipeline.",
    "Grounding is authoritative. Do not invent boundaries or facts.",
    "Return strict JSON with keys: summary, chapter text, confidence, notes.",
    "summary: factual, source-aligned, and proportional to section size.",
    "chapter text: short chapter-ready line. If not split, still provide a useful line.",
    `Summary budget tier: ${budget.tier}`,
    `Budget max sentences: ${budget.maxSentences}`,
    `Budget max words: ${budget.maxWords}`,
    `Procedural section: ${budget.procedural ? "yes" : "no"}`,
    longOrderLine,
    "Do not mention names, figures, or decisions not present in the grounded source excerpt.",
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

  const rawSummary = normalizeText(parsed?.summary || "");
  const summary = enforceSummaryBudget(rawSummary, budget);
  return {
    summary,
    chapterText: normalizeText(parsed?.["chapter text"] || ""),
    confidence: Number.isFinite(Number(parsed?.confidence)) ? Number(parsed.confidence) : 0,
    notes: normalizeText(parsed?.notes || ""),
    budget,
    clampChanged: summary !== rawSummary,
    rawSummary,
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
  const previousChapterByParent = new Map();
  for (let i = 0; i < units.length; i += 1) {
    const unit = units[i];
    const llm = await summarizeGroundedUnit({ unit, focus, llmModel, ollamaUrl });
    const unitId = String(unit["unit id"] || "");
    if (!llm.summary) throw new Error(`stage3 defective: empty summary for grounded unit ${unitId}`);
    if (Number(unit["part total"] || 1) > 1 && !llm.chapterText) {
      throw new Error(`stage3 defective: empty chapter text for split grounded unit ${unitId}`);
    }
    const heading = unit.label || `${unit["agenda item"] || ""}`;
    const splitPart = Number(unit["part total"] || 1) > 1;
    const parentKey = String(unit["parent unit id"] || unitId);
    const previousChapter = previousChapterByParent.get(parentKey) || "";
    const finalChapterText = finalizeChapterText({
      chapterText: llm.chapterText,
      heading,
      summary: llm.summary,
      splitPart,
      previousChapter,
    });
    if (splitPart && !finalChapterText) {
      throw new Error(`stage3 defective: empty chapter text after postprocess for split grounded unit ${unitId}`);
    }
    if (finalChapterText) previousChapterByParent.set(parentKey, finalChapterText);
    sections.push({
      index: i + 1,
      "unit id": unitId,
      "parent unit id": unit["parent unit id"] || "",
      "part index": Number(unit["part index"] || 0),
      "part total": Number(unit["part total"] || 1),
      heading,
      summary: llm.summary,
      "chapter text": finalChapterText,
      score: Number(llm.confidence || 0),
      mode: "llm-stage3",
      "source rows": Number(unit["source rows"] || 0),
      "start row": Number(unit["row start"] || 0),
      "end row": Number(unit["row end"] || 0),
      "max section seconds": Number(process.env.AGENDA_SECTION_SPLIT_SECONDS || 900),
      "grounding status": unit["grounding status"] || "",
      "budget tier": llm.budget?.tier || "",
      "budget max sentences": Number(llm.budget?.maxSentences || 0),
      "budget max words": Number(llm.budget?.maxWords || 0),
      "budget paragraph cap": Number(llm.budget?.paragraphCap || 1),
      "clamp changed": llm.clampChanged ? "yes" : "no",
      "summary pre clamp": llm.clampChanged ? llm.rawSummary : "",
    });
    if (llm.clampChanged) {
      log(
        `[agenda-stage3][clamp] unit=${unitId} tier=${llm.budget?.tier || "na"} before="${llm.rawSummary.slice(0, 160)}" after="${llm.summary.slice(0, 160)}"`,
      );
    }
    log(
      `[agenda-stage3] section ${i + 1}/${units.length} heading ${heading} budget=${llm.budget?.tier || "na"} max_words=${llm.budget?.maxWords || 0} max_sent=${llm.budget?.maxSentences || 0}`,
    );
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
