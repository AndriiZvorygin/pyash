import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  readPyaMapArtifact,
  writePyaMapArtifact,
  validateMeetingSummaryChunksStrict,
  validateMeetingSummaryArtifactStrict,
} from "./agenda-stage-contracts.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const OLLAMA_URL = process.env.OLLAMA_HOST?.replace(/\/$/u, "")
  ? `${process.env.OLLAMA_HOST.replace(/\/$/u, "")}/api/chat`
  : "http://mriczo:11434/api/chat";
const RESOLVED_OLLAMA_HOST = OLLAMA_URL.replace(/\/api\/chat$/u, "");
const MODEL = process.env.MEETING_SUMMARY_MODEL
  || process.env.SUMMARY_MODEL
  || process.env.OWEN_MEETING_SUMMARY_MODEL
  || process.env.OWEN_SUMMARY_MODEL
  || "qwen3.5:9b";
const MAX_ATTEMPTS = 3;
const PASS_THRESHOLD = 0.8;
const SUMMARY_TIME_MODE = String(process.env.AGENDA_SUMMARY_TIME_MODE || "standard").trim().toLowerCase();

const STAGE_A_TARGET_BYTES = Number.parseInt(String(process.env.MEETING_SUMMARY_STAGE_A_TARGET_BYTES || "12000"), 10);
const STAGE_A_HARD_MAX_BYTES = Number.parseInt(String(process.env.MEETING_SUMMARY_STAGE_A_HARD_MAX_BYTES || "16000"), 10);

const AGENDA_SUMMARY_ROOT = "agenda summary artifact";
const MEETING_SUMMARY_CHUNKS_ROOT = "meeting summary chunks artifact";
const MEETING_SUMMARY_ROOT = "meeting summary artifact";
const BANNED_RECAP_PHRASES = [
  "distributive justice",
  "ring-fenced",
  "reclamation",
  "spirited debate",
  "stark reality check",
  "no unresolved issues",
  "complex landscape",
];

function usage() {
  return [
    "Usage: node command/summarize_whole_meeting_from_agenda_summary.mjs <transcript_dir> [prefix] [focus]",
    "Example: node command/summarize_whole_meeting_from_agenda_summary.mjs artifacts/.../transcript auto \"the newsworthy juicy bits and whats unusual\"",
  ].join("\n");
}

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(dirPath) {
  const st = fs.statSync(dirPath, { throwIfNoEntry: false });
  if (!st || !st.isDirectory()) throw new Error(`transcript directory not found: ${dirPath}`);
}

function resolvePathFromRoot(inputPath) {
  if (path.isAbsolute(inputPath)) return path.normalize(inputPath);
  const fromCwd = path.resolve(process.cwd(), inputPath);
  if (fs.existsSync(fromCwd)) return fromCwd;
  return path.resolve(ROOT, inputPath);
}

function readNormalizeCheckpoint(transcriptDir, prefix) {
  const metaPath = path.join(transcriptDir, `${prefix}.normalize.metadata.json`);
  if (!fs.existsSync(metaPath)) return { exists: false, complete: false };
  try {
    const obj = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    const total = Number(obj?.chunks_total);
    const done = Number(obj?.chunks_processed);
    const complete = Number.isFinite(total) && total > 0 && done === total;
    return { exists: true, complete };
  } catch {
    return { exists: true, complete: false };
  }
}

function pickAgendaSummaryArtifact(transcriptDir, prefix = "auto") {
  const wantsAuto = !prefix || /^auto$/iu.test(String(prefix));
  if (!wantsAuto) {
    const preferredPya = path.join(transcriptDir, `${prefix}.agenda-summary.pya`);
    if (fs.existsSync(preferredPya)) return { summaryPath: preferredPya, resolvedPrefix: prefix };
    throw new Error(`canonical agenda summary missing: ${preferredPya}`);
  }

  const pyaCandidates = fs.readdirSync(transcriptDir, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .filter((name) => name.endsWith(".agenda-summary.pya"));
  if (!pyaCandidates.length) {
    throw new Error(`no *.agenda-summary.pya found in ${transcriptDir}`);
  }
  const rankedPya = pyaCandidates.map((name) => {
    const full = path.join(transcriptDir, name);
    const st = fs.statSync(full);
    const pfx = name.replace(/\.agenda-summary\.pya$/u, "");
    const cp = readNormalizeCheckpoint(transcriptDir, pfx);
    let score = 0;
    if (cp.complete) score += 400;
    if (cp.exists && !cp.complete) score -= 300;
    if (/normalized/iu.test(pfx)) score += 150;
    if (/test|tmp|partial/iu.test(pfx)) score -= 250;
    return { full, pfx, score, mtimeMs: Number(st.mtimeMs || 0), size: Number(st.size || 0), name };
  }).sort((a, b) =>
    b.score - a.score
    || b.mtimeMs - a.mtimeMs
    || b.size - a.size
    || a.name.localeCompare(b.name),
  );
  const chosen = rankedPya[0];
  return { summaryPath: chosen.full, resolvedPrefix: chosen.pfx };
}

async function ask(messages, { numPredict = 520 } = {}) {
  const body = {
    model: MODEL,
    mode: "chat",
    keep_alive: 300,
    think: false,
    stream: false,
    options: { num_predict: numPredict },
    messages,
  };
  let res;
  try {
    res = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`Ollama fetch failed for whole-meeting-summary using OLLAMA_HOST=${RESOLVED_OLLAMA_HOST} endpoint=${OLLAMA_URL}; check reachability to mriczo:11434 (${String(err?.message || err)})`);
  }
  if (!res.ok) throw new Error(`ollama status ${res.status}`);
  const json = await res.json();
  return String(json?.message?.content || "").trim();
}

function sectionContent(mdText, heading) {
  const lines = String(mdText || "").split(/\r?\n/u);
  const target = String(heading || "").trim().toLowerCase();
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^##\s+(.+?)\s*$/u);
    if (!m) continue;
    if (m[1].trim().toLowerCase() === target) {
      start = i + 1;
      break;
    }
  }
  if (start < 0) return "";
  let end = lines.length;
  for (let i = start; i < lines.length; i += 1) {
    if (/^##\s+/u.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n").trim();
}

function hasCompleteRequiredSections(mdText) {
  const text = String(mdText || "");
  const hasH1 = /^#\s+Whole Meeting Summary\b/mu.test(text);
  const hasTop = /^##\s+Top Newsworthy Developments\b/mu.test(text);
  const hasWhy = /^##\s+Why It Matters\b/mu.test(text);
  const hasWatch = /^##\s+Watch Next\b/mu.test(text);
  if (!hasH1 || !hasTop || !hasWhy || !hasWatch) return false;
  const top = sectionContent(text, "Top Newsworthy Developments");
  const why = sectionContent(text, "Why It Matters");
  const watch = sectionContent(text, "Watch Next");
  return top.length >= 300 && why.length >= 80 && watch.length >= 80;
}

function matchesAnyPattern(text, patterns = []) {
  const value = String(text || "").toLowerCase();
  return patterns.some((p) => {
    if (!p) return false;
    if (p instanceof RegExp) return p.test(value);
    return value.includes(String(p).toLowerCase());
  });
}

function proceduralHeading(heading = "") {
  return matchesAnyPattern(heading, [
    /call to order/u,
    /additional business/u,
    /declarations of interest/u,
    /confirmation of .*minutes/u,
    /move .*committee of the whole/u,
    /adjournment/u,
    /correspondence received/u,
  ]);
}

function scoreNewsCandidate(section = {}) {
  const heading = String(section?.heading || "");
  const summary = String(section?.summary || "");
  const hay = `${heading} ${summary}`.toLowerCase();
  let score = 0;
  if (proceduralHeading(heading)) score -= 12;
  if (/\bby-?laws?\b/u.test(hay)) score += 9;
  if (/\bfirefighters?\b/u.test(hay)) score += 7;
  if (/\bpublic forum\b/u.test(hay)) score += 8;
  if (/\bfourth avenue|roadway|one-way|infrastructure\b/u.test(hay)) score += 8;
  if (/\bdefer|deferred|defeated|carried|approved|passed|rejected\b/u.test(hay)) score += 5;
  if (/\bstaff report|report\b/u.test(hay)) score += 3;
  if (/\bcost|budget|funding|tax|surplus\b/u.test(hay)) score += 4;
  if (/\bdiscussed|considered|presented\b/u.test(hay)) score += 2;
  const words = summary.split(/\s+/u).filter(Boolean).length;
  if (words >= 22) score += 2;
  if (words < 8) score -= 3;
  return score;
}

function buildNewsPriorityItems(sections = [], topN = 8) {
  return (Array.isArray(sections) ? sections : [])
    .map((section, i) => {
      const heading = String(section?.heading || "").trim();
      const summary = String(section?.summary || "").trim();
      return {
        index: Number(section?.index || i + 1),
        heading,
        summary,
        score: scoreNewsCandidate(section),
      };
    })
    .filter((row) => row.heading && row.summary && !proceduralHeading(row.heading))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, topN);
}

function synthesisPenalty(mdText = "") {
  const text = String(mdText || "");
  const lower = text.toLowerCase();
  let penalty = 0;
  for (const phrase of BANNED_RECAP_PHRASES) {
    if (lower.includes(phrase.toLowerCase())) penalty += 0.14;
  }
  const opener = text.split(/\n\n/u).find((x) => x.trim() && !x.trim().startsWith("#")) || "";
  if (/\bmove into committee of the whole\b/iu.test(opener)) penalty += 0.22;
  return Math.min(0.7, penalty);
}

function extractHeadings(mdText) {
  return String(mdText || "").split(/\r?\n/u)
    .filter((line) => /^#{1,2}\s+/u.test(line))
    .map((line) => line.trim());
}

function deriveMeetingDateFromTranscriptDir(transcriptDir) {
  const meetingDir = path.basename(path.dirname(String(transcriptDir || "")));
  const m = meetingDir.match(/^(\d{4})-(\d{2})-(\d{2})/u);
  if (!m) return { iso: "", long: "" };
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  const dt = new Date(`${iso}T12:00:00Z`);
  const long = dt.toLocaleDateString("en-CA", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
  return { iso, long };
}

function deriveMeetingContext(transcriptDir) {
  const meetingDir = path.dirname(String(transcriptDir || ""));
  const meetingJsonPath = path.join(meetingDir, "meeting.json");
  let bodyLabel = "";
  let jurisdiction = "";
  const normalizeBodyLabel = (label) => {
    let out = String(label || "").trim().replace(/\s+/gu, " ");
    out = out.replace(/^((?:Council Meeting|Committee|Board))\s*-\s*\1\s*-\s*/iu, "$1 - ");
    out = out.replace(/^Committee\s*-\s*Committee of\s+/iu, "Committee of ");
    out = out.replace(/^Board\s*-\s*Board of\s+/iu, "Board of ");
    out = out.replace(/\s*-\s*/gu, " - ");
    return out.trim();
  };
  const envJurisdiction = String(process.env.MEETING_JURISDICTION || process.env.JURISDICTION || "").trim();
  if (envJurisdiction) jurisdiction = envJurisdiction;
  try {
    const meeting = JSON.parse(fs.readFileSync(meetingJsonPath, "utf8"));
    const payload = meeting?.payload || {};
    bodyLabel = normalizeBodyLabel(String(payload?.meeting_name || payload?.meeting_type || "").trim());
    if (!jurisdiction) {
      jurisdiction = String(payload?.jurisdiction || payload?.municipality || payload?.county || "").trim();
    }
  } catch {}

  if (!jurisdiction) {
    const slug = String(path.basename(path.dirname(path.dirname(meetingDir))) || "").trim();
    jurisdiction = slug
      ? slug.split("-").map((part) => part ? (part[0].toUpperCase() + part.slice(1)) : "").join(" ")
      : "Local Municipality";
  }

  if (!bodyLabel) {
    const dirName = path.basename(meetingDir);
    if (/committee-corporate-services/iu.test(dirName)) bodyLabel = "Committee - Corporate Services";
    else if (/committee-operations/iu.test(dirName)) bodyLabel = "Committee - Operations";
    else if (/committee-community-services/iu.test(dirName)) bodyLabel = "Committee - Community Services";
    else if (/council/iu.test(dirName)) bodyLabel = "Council Meeting - Regular";
    else bodyLabel = "Council";
  }
  bodyLabel = normalizeBodyLabel(bodyLabel);
  return { bodyLabel, jurisdiction };
}

function asPositiveInt(value, fallback) {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function byteLengthUtf8(text) {
  return Buffer.byteLength(String(text || ""), "utf8");
}

function toSectionSourceBlock(section = {}, sectionIndex = 1) {
  const heading = String(section.heading || `Section ${sectionIndex}`).trim();
  const summary = String(section.summary || "").trim();
  const chapterText = String(section["chapter text"] || "").trim();
  const partIndex = Number(section["part index"] || 0);
  const partTotal = Number(section["part total"] || 1);
  const lines = [
    `Section ${sectionIndex}: ${heading}`,
    `Part: ${partIndex > 0 ? partIndex : 1}/${partTotal > 0 ? partTotal : 1}`,
    `Summary: ${summary || "(none)"}`,
  ];
  if (chapterText) lines.push(`Chapter text: ${chapterText}`);
  return lines.join("\n");
}

function buildChunkUnitsFromSections(sections = [], {
  targetBytes = STAGE_A_TARGET_BYTES,
  hardMaxBytes = STAGE_A_HARD_MAX_BYTES,
} = {}) {
  if (!Array.isArray(sections) || !sections.length) {
    throw new Error("meeting summary stage A defective: no sections available");
  }
  const safeTarget = asPositiveInt(targetBytes, 12000);
  const safeHardMax = Math.max(asPositiveInt(hardMaxBytes, 16000), safeTarget);

  const units = [];
  let current = null;

  function pushCurrent() {
    if (!current) return;
    current["source section count"] = current.sections.length;
    current["source byte count"] = current["source text bytes"];
    current["covered headings"] = current.sections.map((s) => s.heading);
    current["section start index"] = current.sections[0].index;
    current["section end index"] = current.sections[current.sections.length - 1].index;
    units.push(current);
    current = null;
  }

  for (let i = 0; i < sections.length; i += 1) {
    const sec = sections[i] || {};
    const index = i + 1;
    const heading = String(sec.heading || `Section ${index}`).trim();
    const textBlock = toSectionSourceBlock(sec, index);
    const blockBytes = byteLengthUtf8(textBlock);
    const entry = { index, heading, text: textBlock, bytes: blockBytes };

    if (!current) {
      current = {
        sections: [entry],
        source: textBlock,
        "source text bytes": blockBytes,
      };
      continue;
    }

    const joiner = "\n\n---\n\n";
    const projectedSource = `${current.source}${joiner}${textBlock}`;
    const projectedBytes = byteLengthUtf8(projectedSource);
    const exceedsTarget = projectedBytes > safeTarget;
    const currentAtLeastOne = current.sections.length >= 1;
    if (exceedsTarget && currentAtLeastOne) {
      pushCurrent();
      current = {
        sections: [entry],
        source: textBlock,
        "source text bytes": blockBytes,
      };
      continue;
    }
    current.sections.push(entry);
    current.source = projectedSource;
    current["source text bytes"] = projectedBytes;
  }
  pushCurrent();

  for (let i = 0; i < units.length; i += 1) {
    const chunkId = `chunk_${String(i + 1).padStart(3, "0")}`;
    units[i]["chunk id"] = chunkId;
    units[i]["source byte count"] = Number(units[i]["source byte count"] || 0);
    units[i]["over hard max"] = units[i]["source byte count"] > safeHardMax;
  }

  return { units, safeTarget, safeHardMax };
}

function validateChunkCoverage(units = [], sectionTotal = 0) {
  let expectedStart = 1;
  for (let i = 0; i < units.length; i += 1) {
    const unit = units[i] || {};
    const start = Number(unit["section start index"]);
    const end = Number(unit["section end index"]);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
      throw new Error(`meeting summary stage A defective: invalid chunk range at chunk=${i + 1}`);
    }
    if (start !== expectedStart) {
      throw new Error(`meeting summary stage A defective: section omission/overlap at chunk=${i + 1} expected=${expectedStart} got=${start}`);
    }
    expectedStart = end + 1;
  }
  if (expectedStart !== sectionTotal + 1) {
    throw new Error(`meeting summary stage A defective: section coverage ended at ${expectedStart - 1} expected ${sectionTotal}`);
  }
}

function buildChunkSummaryPrompt({
  chunkId,
  sectionStartIndex,
  sectionEndIndex,
  coveredHeadings,
  chunkSource,
  focus,
  meetingDateIso,
  meetingDateLong,
  bodyLabel,
  jurisdiction,
}) {
  const focusLine = String(focus || "").trim() || "factual civic reporting";
  const headings = (Array.isArray(coveredHeadings) ? coveredHeadings : []).map((h) => `- ${h}`).join("\n");
  return [
    "Create a grounded, readable local-news chunk summary for whole-meeting synthesis.",
    "",
    `Chunk id: ${chunkId}`,
    `Covered sections: ${sectionStartIndex} to ${sectionEndIndex}`,
    `Meeting date: ${meetingDateLong || meetingDateIso || "unknown"}`,
    `Governing body: ${bodyLabel || "unknown"}`,
    `Jurisdiction: ${jurisdiction || "unknown"}`,
    `Focus: ${focusLine}`,
    "",
    "Covered headings:",
    headings || "- (none)",
    "",
    "Required coverage:",
    "- Major topics discussed in this range.",
    "- Important decisions / vote outcomes, and clearly state when no decision was taken.",
    "- Unresolved issues / follow-up requested by council/staff.",
    "- Notable events that matter to readers.",
    "",
    "Style constraints:",
    "- Readable local-news style: clear, specific, and human.",
    "- Keep tone grounded; avoid ideological framing or invented drama.",
    "- Do not use: distributive justice, ring-fenced, reclamation, spirited debate, stark reality check, no unresolved issues.",
    "",
    "Output constraints:",
    "- 2 to 6 sentences.",
    "- Source-faithful and concrete.",
    "- No invented facts.",
    "",
    "SOURCE_SECTION_SUMMARIES:",
    chunkSource,
  ].join("\n");
}

function buildFinalSummaryPrompt({
  chunkSource,
  focus,
  meetingDateIso,
  meetingDateLong,
  bodyLabel,
  jurisdiction,
  feedback,
  priorityItems,
}) {
  const focusLine = String(focus || "").trim() || "factual civic reporting";
  const rankedItemsText = (Array.isArray(priorityItems) ? priorityItems : [])
    .map((it, idx) => `${idx + 1}. [${it.index}] ${it.heading} -- ${it.summary}`)
    .join("\n");
  return [
    "Create a readable, grounded whole-meeting local-news recap from chunk summaries.",
    "",
    `Meeting date (authoritative): ${meetingDateLong || meetingDateIso || "unknown"}`,
    `Governing body (authoritative): ${bodyLabel || "unknown"}`,
    `Jurisdiction (authoritative): ${jurisdiction || "unknown"}`,
    `Focus: ${focusLine}`,
    "",
    "Return markdown with exactly these sections and titles:",
    "1) # Whole Meeting Summary",
    "2) ## Top Newsworthy Developments",
    "3) ## Why It Matters",
    "4) ## Watch Next",
    "",
    "Rules:",
    "- Use only facts present in CHUNK_SUMMARIES.",
    "- Lead with the most consequential substantive item from RANKED_NEWS_CANDIDATES, not procedural openers.",
    "- Write like strong local journalism, not dry minutes: concise, concrete, and engaging.",
    "- Use concrete local stakes (costs, votes, projects, bylaws, speakers, service impacts).",
    "- Preserve coverage from early, middle, and late meeting phases.",
    "- Do not overweight opening procedural sections.",
    "- Include key decisions and outcomes where present.",
    "- If a point is proposal-only or uncertain, say it was discussed/considered rather than adopted.",
    "- For vote language (carried, defeated, approved, deferred, unanimous, split), use only when explicitly supported in CHUNK_SUMMARIES.",
    "- Keep tone grounded and specific; avoid generic civic filler or abstract framing.",
    "- Avoid opening with call-to-order, committee-of-the-whole motions, minutes confirmation, or adjournment.",
    "- Do not use these phrases unless directly quoted from source: distributive justice; ring-fenced; reclamation; spirited debate; stark reality check; no unresolved issues; complex landscape.",
    "- Keep total length under 900 words.",
    ...(SUMMARY_TIME_MODE === "upcoming"
      ? [
        "- This is an upcoming agenda preview before the meeting occurs.",
        "- Write primarily in present/future tense.",
      ]
      : []),
    "",
    "RETRY_FEEDBACK:",
    feedback || "",
    "",
    "RANKED_NEWS_CANDIDATES:",
    rankedItemsText || "(none)",
    "",
    "CHUNK_SUMMARIES:",
    chunkSource,
  ].join("\n");
}

function buildFinalScorePrompt({
  chunkSource,
  summaryMd,
  bodyLabel,
  jurisdiction,
  meetingDateIso,
  meetingDateLong,
  priorityItems,
}) {
  const rankedItemsText = (Array.isArray(priorityItems) ? priorityItems : [])
    .map((it, idx) => `${idx + 1}. [${it.index}] ${it.heading} -- ${it.summary}`)
    .join("\n");
  return [
    "Score WHOLE_MEETING_SUMMARY for semantic faithfulness to CHUNK_SUMMARIES.",
    "",
    "Scoring:",
    "- 1.0 = fully faithful and well-prioritized",
    "- 0.8 = mostly faithful with minor drift",
    "- 0.5 = mixed",
    "- 0.0 = unusable",
    "",
    "Rules:",
    "- Penalize invented claims, wrong attributions, or nonexistent outcomes.",
    `- Penalize incorrect governing body label; required body is "${bodyLabel || "unknown"}".`,
    `- Penalize incorrect jurisdiction label; required jurisdiction is "${jurisdiction || "unknown"}".`,
    `- Penalize incorrect meeting date; required date is "${meetingDateLong || meetingDateIso || "unknown"}".`,
    "- Penalize leading with procedural framing instead of substantive outcomes.",
    "- Penalize ideological/dramatic framing not supported by source.",
    "- Penalize omission of major events that appear in chunk summaries.",
    "",
    "Output:",
    "- First line: FEEDBACK: <one short sentence>.",
    "- Final line: FINAL_SCORE: <number from 0.00 to 1.00>.",
    "",
    "CHUNK_SUMMARIES:",
    chunkSource,
    "",
    "RANKED_NEWS_CANDIDATES:",
    rankedItemsText || "(none)",
    "",
    "WHOLE_MEETING_SUMMARY:",
    summaryMd,
  ].join("\n");
}

function parseScore(review) {
  const lines = String(review || "").split(/\r?\n/u).map((x) => x.trim()).filter(Boolean);
  const joined = lines.join("\n");
  const labeled = joined.match(/FINAL_SCORE\s*:\s*([01](?:\.\d+)?)/iu);
  if (labeled) {
    const n = Number(labeled[1]);
    if (Number.isFinite(n) && n >= 0 && n <= 1) return n;
  }
  return 0;
}

async function synthesizeChunkSummaries({
  units,
  focus,
  meetingDateIso,
  meetingDateLong,
  bodyLabel,
  jurisdiction,
  log,
}) {
  const chunks = [];
  for (let i = 0; i < units.length; i += 1) {
    const u = units[i] || {};
    log(
      `[meeting-summary][chunk] ${i + 1}/${units.length} sections ${u["section start index"]}-${u["section end index"]} bytes=${u["source byte count"]}`,
    );
    const summaryText = await ask(
      [
        { role: "system", content: "You are a strict local-news summarizer. Stay source-faithful." },
        {
          role: "user",
          content: buildChunkSummaryPrompt({
            chunkId: u["chunk id"],
            sectionStartIndex: u["section start index"],
            sectionEndIndex: u["section end index"],
            coveredHeadings: u["covered headings"],
            chunkSource: u.source,
            focus,
            meetingDateIso,
            meetingDateLong,
            bodyLabel,
            jurisdiction,
          }),
        },
      ],
      { numPredict: 460 },
    );
    const cleaned = String(summaryText || "").trim();
    if (!cleaned) {
      throw new Error(`meeting summary stage A defective: empty chunk summary for ${u["chunk id"]}`);
    }
    chunks.push({
      "chunk id": u["chunk id"],
      "section start index": u["section start index"],
      "section end index": u["section end index"],
      "covered headings": u["covered headings"],
      "source section count": u["source section count"],
      "source byte count": u["source byte count"],
      "chunk summary text": cleaned,
    });
  }
  return chunks;
}

function buildChunkSourceForStageB(chunks = []) {
  return chunks.map((chunk) => {
    const headings = (Array.isArray(chunk["covered headings"]) ? chunk["covered headings"] : []).join(" | ");
    return [
      `${chunk["chunk id"]} [sections ${chunk["section start index"]}-${chunk["section end index"]}]`,
      `Headings: ${headings || "(none)"}`,
      `Summary: ${String(chunk["chunk summary text"] || "").trim() || "(none)"}`,
    ].join("\n");
  }).join("\n\n---\n\n");
}

async function synthesizeFinalMeetingSummary({
  chunksArtifact,
  focus,
  meetingDateIso,
  meetingDateLong,
  bodyLabel,
  jurisdiction,
  priorityItems,
}) {
  const chunkSource = buildChunkSourceForStageB(chunksArtifact?.chunks || []);
  let feedback = "";
  let bestText = "";
  let bestScore = -1;
  let bestReview = "";

  for (let i = 1; i <= MAX_ATTEMPTS; i += 1) {
    const draft = await ask(
      [
        { role: "system", content: "You are a strict local-news meeting brief writer." },
        {
          role: "user",
          content: buildFinalSummaryPrompt({
            chunkSource,
            focus,
            meetingDateIso,
            meetingDateLong,
            bodyLabel,
            jurisdiction,
            feedback,
            priorityItems,
          }),
        },
      ],
      { numPredict: 1200 },
    );

    const review = await ask(
      [
        { role: "system", content: "You are a strict semantic verifier for civic summaries." },
        {
          role: "user",
          content: buildFinalScorePrompt({
            chunkSource,
            summaryMd: draft,
            bodyLabel,
            jurisdiction,
            meetingDateIso,
            meetingDateLong,
            priorityItems,
          }),
        },
      ],
      { numPredict: 220 },
    );

    const completenessPenalty = hasCompleteRequiredSections(draft) ? 0 : 0.4;
    const stylePenalty = synthesisPenalty(draft);
    const score = Math.max(0, parseScore(review) - completenessPenalty - stylePenalty);
    if (bestText === "" || score > bestScore) {
      bestText = draft;
      bestScore = score;
      bestReview = review;
    }
    feedback = review;
    if (score >= PASS_THRESHOLD) break;
  }

  return {
    markdown: bestText,
    score: Number(bestScore.toFixed(3)),
    verifierFeedback: bestReview,
  };
}

export async function summarizeWholeMeetingArtifacts({
  transcriptDirArg,
  prefixArg = "auto",
  focusArg = "",
  log = (line) => process.stdout.write(`${line}\n`),
}) {
  const focusText = String(focusArg || "").trim();
  if (!transcriptDirArg) {
    throw new Error(usage());
  }

  const transcriptDir = resolvePathFromRoot(transcriptDirArg);
  ensureDir(transcriptDir);

  const { summaryPath, resolvedPrefix } = pickAgendaSummaryArtifact(transcriptDir, prefixArg);
  const outChunksPya = path.join(transcriptDir, `${resolvedPrefix}.meeting-summary.chunks.pya`);
  const outMd = path.join(transcriptDir, `${resolvedPrefix}.meeting-summary.md`);
  const outSummaryPya = path.join(transcriptDir, `${resolvedPrefix}.meeting-summary.pya`);
  const meetingDate = deriveMeetingDateFromTranscriptDir(transcriptDir);
  const meetingContext = deriveMeetingContext(transcriptDir);

  log(`[meeting-summary] source agenda summary: ${summaryPath}`);
  log(`[llm] ollama host: ${RESOLVED_OLLAMA_HOST}`);
  log(`[meeting-summary] output chunks: ${outChunksPya}`);
  log(`[meeting-summary] output md: ${outMd}`);
  log(`[meeting-summary] output pya: ${outSummaryPya}`);

  const sourceObj = await readPyaMapArtifact(summaryPath, AGENDA_SUMMARY_ROOT);
  if (String(sourceObj?.["schema version"] || "") !== "agenda_summary_v1") {
    throw new Error(`invalid canonical agenda summary schema: ${summaryPath}`);
  }
  const sections = Array.isArray(sourceObj?.sections) ? sourceObj.sections : [];
  if (!sections.length) {
    throw new Error(`invalid canonical agenda summary (missing sections): ${summaryPath}`);
  }

  const stageABuilt = buildChunkUnitsFromSections(sections);
  const priorityItems = buildNewsPriorityItems(sections, 8);
  validateChunkCoverage(stageABuilt.units, sections.length);
  const chunkSummaries = await synthesizeChunkSummaries({
    units: stageABuilt.units,
    focus: focusText,
    meetingDateIso: meetingDate.iso,
    meetingDateLong: meetingDate.long,
    bodyLabel: meetingContext.bodyLabel,
    jurisdiction: meetingContext.jurisdiction,
    log,
  });
  const chunksArtifact = {
    "schema version": "meeting_summary_chunks_v1",
    "source agenda summary": summaryPath,
    "transcript dir": transcriptDir,
    prefix: resolvedPrefix,
    focus: focusText,
    "generated time": nowIso(),
    "source sections total": sections.length,
    chunks: chunkSummaries,
  };
  validateMeetingSummaryChunksStrict(chunksArtifact);
  writePyaMapArtifact(outChunksPya, MEETING_SUMMARY_CHUNKS_ROOT, chunksArtifact);

  const stageB = await synthesizeFinalMeetingSummary({
    chunksArtifact,
    focus: focusText,
    meetingDateIso: meetingDate.iso,
    meetingDateLong: meetingDate.long,
    bodyLabel: meetingContext.bodyLabel,
    jurisdiction: meetingContext.jurisdiction,
    priorityItems,
  });
  fs.writeFileSync(outMd, `${String(stageB.markdown || "").trim()}\n`, "utf8");

  const meetingSummaryArtifact = {
    "schema version": "meeting_summary_v1",
    "source meeting summary chunks": outChunksPya,
    focus: focusText,
    score: stageB.score,
    "generated time": nowIso(),
    headings: extractHeadings(stageB.markdown),
    markdown: String(stageB.markdown || "").trim(),
    "verifier feedback": stageB.verifierFeedback,
    "chunk count": chunkSummaries.length,
  };
  validateMeetingSummaryArtifactStrict(meetingSummaryArtifact, chunksArtifact);
  writePyaMapArtifact(outSummaryPya, MEETING_SUMMARY_ROOT, meetingSummaryArtifact);

  log(`[meeting-summary] stage-a chunks: ${chunkSummaries.length}`);
  log(`[meeting-summary] stage-a target bytes: ${stageABuilt.safeTarget}`);
  log(`[meeting-summary] stage-a hard max bytes: ${stageABuilt.safeHardMax}`);
  for (const chunk of chunkSummaries) {
    log(
      `[meeting-summary] chunk ${chunk["chunk id"]}: sections=${chunk["section start index"]}-${chunk["section end index"]} count=${chunk["source section count"]} bytes=${chunk["source byte count"]}`,
    );
  }
  log(`[meeting-summary] score: ${stageB.score.toFixed(3)}`);
  log(`[meeting-summary] wrote: ${outChunksPya}`);
  log(`[meeting-summary] wrote: ${outMd}`);
  log(`[meeting-summary] wrote: ${outSummaryPya}`);
  return { outChunksPya, outMd, outSummaryPya, score: stageB.score, chunkCount: chunkSummaries.length };
}

