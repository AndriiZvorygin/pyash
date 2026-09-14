import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  readPyaMapArtifact,
  writePyaMapArtifact,
  validateMeetingSummaryChunksStrict,
  validateMeetingSummaryArtifactStrict,
} from "./agenda-stage-contracts.mjs";
import { unsupportedNumericTokens } from "./grounded-numeric-fidelity.mjs";
import { agendaPreviewPriorityAdjustment } from "./agenda-preview-priority.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const OLLAMA_URL = process.env.OLLAMA_HOST?.replace(/\/$/u, "")
  ? `${process.env.OLLAMA_HOST.replace(/\/$/u, "")}/api/chat`
  : "http://mriczo:11434/api/chat";
const RESOLVED_OLLAMA_HOST = OLLAMA_URL.replace(/\/api\/chat$/u, "");
const MODEL = "qwen3.5:9b";
const MAX_ATTEMPTS = Math.max(
  1,
  Number.parseInt(String(process.env.MEETING_SUMMARY_OLLAMA_ATTEMPTS || "4"), 10) || 4,
);
const OLLAMA_TIMEOUT_MS = Math.max(
  5000,
  Number.parseInt(String(process.env.MEETING_SUMMARY_OLLAMA_TIMEOUT_MS || "90000"), 10) || 90000,
);
const PASS_THRESHOLD = 0.8;
const SUMMARY_TIME_MODE = String(process.env.AGENDA_SUMMARY_TIME_MODE || "standard").trim().toLowerCase();

const STAGE_A_TARGET_BYTES = Number.parseInt(String(process.env.MEETING_SUMMARY_STAGE_A_TARGET_BYTES || "2500"), 10);
const STAGE_A_HARD_MAX_BYTES = Number.parseInt(String(process.env.MEETING_SUMMARY_STAGE_A_HARD_MAX_BYTES || "4500"), 10);

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
      signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
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
  return top.length >= 180 && why.length >= 30 && watch.length >= 20;
}

function normalizeRequiredSummaryHeadings(mdText = "") {
  let out = String(mdText || "");
  out = out.replace(/^##\s+Top\s+Newsworthy\s+Developements\b/gimu, "## Top Newsworthy Developments");
  out = out.replace(/^##\s+Most\s+Newsworthy\s+Items\b/gimu, "## Top Newsworthy Developments");
  out = out.replace(/^##\s+Why\s+it\s+Matters\b/gimu, "## Why It Matters");
  out = out.replace(/^##\s+Watch\s+next\b/gimu, "## Watch Next");
  return out;
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

function lowSignalSummary(summary = "") {
  const s = String(summary || "").toLowerCase().replace(/\s+/gu, " ").trim();
  if (!s) return true;
  return /\b(no submissions?|none submitted|no deputations?|none scheduled|no scheduled sessions?|for information only|no correspondence(?:\s+items?)?\s+(?:were\s+presented|for\s+consideration)|meeting then proceeded)\b/u.test(s);
}

function scoreNewsCandidate(section = {}) {
  const heading = String(section?.heading || "");
  const summary = String(section?.summary || "");
  const hay = `${heading} ${summary}`.toLowerCase();
  let score = 0;
  if (proceduralHeading(heading)) score -= 12;
  if (lowSignalSummary(summary)) score -= 20;
  if (/\bby-?laws?\b/u.test(hay)) score += 5;
  if (/\bfirefighters?\b/u.test(hay)) score += 7;
  if (/\bpublic forum\b/u.test(hay)) score += 6;
  if (/\bfourth avenue|roadway|one-way|infrastructure\b/u.test(hay)) score += 8;
  if (/\bdefer|deferred|defeated|carried|approved|passed|rejected\b/u.test(hay)) score += 5;
  if (/\bstaff report|report\b/u.test(hay)) score += 3;
  if (/\bcost|budget|funding|tax|surplus\b/u.test(hay)) score += 4;
  if (/\b(food|hunger|food insecurity|wheelchair|accessibility|hospital|taxi|housing|rent|safety|health|poverty)\b/u.test(hay)) score += 14;
  if (/\bconsent agenda|administrative|for information only|correspondence\b/u.test(hay)) score -= 8;
  if (/\bdiscussed|considered|presented\b/u.test(hay)) score += 2;
  const words = summary.split(/\s+/u).filter(Boolean).length;
  if (words >= 22) score += 2;
  if (words < 8) score -= 3;
  return score + agendaPreviewPriorityAdjustment({ title: heading, summary });
}

function humanImpactPriority(section = {}) {
  const heading = String(section?.heading || "");
  const summary = String(section?.summary || "");
  const hay = `${heading} ${summary}`.toLowerCase();
  let p = 0;
  if (/\b(wheelchair|accessibility|hospital|taxi|mobility)\b/u.test(hay)) p += 10;
  if (/\b(food insecurity|food security|hunger|poverty|housing|rent|cost of living)\b/u.test(hay)) p += 9;
  if (/\b(health|safety)\b/u.test(hay)) p += 5;
  if (/\b(consent agenda|administrative|lease assignment|business license|for information only)\b/u.test(hay)) p -= 8;
  return p;
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
    .filter((row) => row.heading && row.summary && !proceduralHeading(row.heading) && !lowSignalSummary(row.summary))
    .sort((a, b) => humanImpactPriority(b) - humanImpactPriority(a) || b.score - a.score || a.index - b.index)
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

export function governingBodyDefects(mdText = "", bodyLabel = "", authoritativeSource = "") {
  const text = String(mdText || "");
  const source = String(authoritativeSource || "").toLowerCase();
  const body = String(bodyLabel || "").toLowerCase();
  const action = String.raw`(?:members?\s+)?(?:convened|met|heard|reviewed|considered|approved|adopted|voted|directed|received|discussed|deliberated|authorized|awarded|supported|expressed\s+support)`;
  const defects = [];
  const collectUnsupported = (pattern) => Array.from(text.matchAll(pattern), (match) => match[0])
    .filter((match) => !source.includes(match.toLowerCase()));
  if (!body.includes("council")) {
    defects.push(...collectUnsupported(new RegExp(String.raw`\bcouncil\s+${action}\b`, "giu")));
  }
  if (!body.includes("committee")) {
    defects.push(...collectUnsupported(new RegExp(String.raw`\bcommittee\s+${action}\b`, "giu")));
  }
  if (!body.includes("board")) {
    defects.push(...collectUnsupported(new RegExp(String.raw`\bboard\s+${action}\b`, "giu")));
  }
  return [...new Set(defects)];
}

export function previewTemporalDefects(mdText = "") {
  const text = String(mdText || "");
  const patterns = [
    /\b(?:council|committee|board)(?: members)?\s+(?:convened|met|heard|reviewed|considered|approved|adopted|voted|directed|received|transitioned|discussed)\b/giu,
    /\b(?:the )?(?:meeting|session)\s+(?:convened|met|opened|prioritized|focused|heard|reviewed|considered|approved|adopted|transitioned|discussed)\b/giu,
    /\b(?:the )?(?:morning|afternoon|evening)\s+(?:also\s+)?saw\b/giu,
    /\bofficials\s+moved\s+forward\b/giu,
  ];
  return [...new Set(patterns.flatMap((pattern) => Array.from(text.matchAll(pattern), (match) => match[0])))];
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
  const chapters = Array.isArray(section.chapters) ? section.chapters : [];
  for (const chapter of chapters) {
    const title = String(chapter?.title || "").trim();
    const text = String(chapter?.text || "").trim();
    if (!title && !text) continue;
    lines.push(`Child topic: ${title || "(untitled)"}`);
    if (text) lines.push(`Child summary: ${text}`);
  }
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
    ...(SUMMARY_TIME_MODE === "upcoming"
      ? [
        "- Major topics scheduled or proposed for consideration in this range.",
        "- Decisions requested in the agenda package; do not claim Council has voted or acted.",
      ]
      : [
        "- Major topics discussed in this range.",
        "- Important decisions / vote outcomes, and clearly state when no decision was taken.",
      ]),
    "- Unresolved issues / follow-up requested by council/staff.",
    "- Notable events that matter to readers.",
    "",
    "Style constraints:",
    "- Readable local-news style: clear, specific, and human.",
    "- Keep tone grounded; avoid ideological framing or invented drama.",
    "- Do not use: distributive justice, ring-fenced, reclamation, spirited debate, stark reality check, no unresolved issues.",
    "",
    "Output constraints:",
    "- Output one labeled bullet for every covered heading, in the same order.",
    "- Begin each bullet with the exact covered heading, followed by a colon.",
    "- Give each substantive bullet 1 to 2 sentences. Keep procedural bullets to one short clause.",
    "- Never combine two covered headings in one bullet.",
    "- Source-faithful and concrete.",
    "- No invented facts.",
    `- Refer to the meeting's governing body as "${bodyLabel || "the governing body"}"; do not substitute Council, county council, or another body label.`,
    "- Preserve an action by a subordinate committee or board only when that acting body and action are explicit in the source.",
    "- Do not name individual councillors, motion movers, or seconders. Describe the committee, staff, presenter, report, or correspondence instead.",
    "- Do not add a person's name merely to make a sentence sound specific. A presenter or correspondence author's name is allowed only when it appears verbatim in the source and is essential to understanding the topic.",
    "- Do not turn reviewed, discussed, proposed, considered, or received items into approved, adopted, awarded, authorized, or funded outcomes.",
    "- Preserve status and tense exactly: do not change cleared/completed/authorized into targeting/planned/pending, or change a proposal into a completed outcome.",
    "- If a person's name in a heading differs from a person's name in its summary, omit both names rather than merging or choosing between them.",
    "- Canonical covered headings are authoritative for agenda item names, report codes, projects, and locations. If body text conflicts with a heading on one of those identifiers, use the heading value and omit the conflicting value.",
    "- Do not combine separate agenda items into one motion, outcome, cause, or attribution.",
    ...(SUMMARY_TIME_MODE === "upcoming"
      ? [
        "- This is an upcoming agenda preview before the meeting occurs.",
        "- Use present/future framing such as is scheduled, will consider, or the agenda proposes.",
        "- Never say the meeting convened, Council heard/reviewed/approved/directed, the session prioritized, or the afternoon saw an event.",
        "- Past actions described inside supporting reports must be clearly attributed to those reports or earlier dated meetings.",
      ]
      : []),
    "",
    "SOURCE_SECTION_SUMMARIES:",
    chunkSource,
  ].join("\n");
}

function buildChunkScorePrompt({ chunkSource = "", chunkSummary = "", bodyLabel = "" }) {
  return [
    "Score CHUNK_SUMMARY for strict semantic faithfulness to CHUNK_SOURCE.",
    "",
    "Rules:",
    "- Penalize inverted amounts, terms, dates, directions, approvals, or outcomes.",
    "- Penalize invented causality, funding links, motives, constraints, and vote results.",
    "- Penalize facts moved between separate agenda topics.",
    "- Penalize named councillors, motion movers, or seconders.",
    `- Penalize unsupported substitution of the meeting body "${bodyLabel || "the supplied governing body"}".`,
    "- Do not penalize a subordinate committee or board action explicitly stated in CHUNK_SOURCE.",
    "- Do not penalize concise omission; this is a bounded intermediate summary.",
    "",
    "Output:",
    "- Return exactly two lines and no analysis.",
    "- First line: FINAL_SCORE: <number from 0.00 to 1.00>.",
    "- Second line: FEEDBACK: <one short correction sentence>.",
    "",
    "CHUNK_SOURCE:",
    chunkSource,
    "",
    "CHUNK_SUMMARY:",
    chunkSummary,
  ].join("\n");
}

function buildChunkReviewAdjudicationPrompt({
  chunkSource = "",
  chunkSummary = "",
  bodyLabel = "",
  priorReview = "",
}) {
  return [
    "Adjudicate a prior semantic review of CHUNK_SUMMARY against CHUNK_SOURCE.",
    "The prior review is only a claim and may be wrong. Recheck every alleged defect against literal source evidence.",
    "",
    "Rules:",
    "- Do not infer approval, rejection, or a final outcome from an agenda heading, project purpose, by-law title, chapter title, or proposed use.",
    "- Treat a conservative omission of an unclear outcome as faithful unless the source explicitly states the outcome.",
    "- Penalize an outcome claim in the summary only when it contradicts an explicit source statement.",
    "- Penalize invented amounts, dates, causality, funding links, motives, or facts moved between topics.",
    "- Penalize named councillors, movers, seconders, or unsupported substitution of the supplied meeting body.",
    "- Do not penalize a subordinate committee or board action explicitly stated in CHUNK_SOURCE.",
    `- The supplied governing body is "${bodyLabel || "the supplied governing body"}".`,
    "",
    "Output exactly two lines and no analysis:",
    "FINAL_SCORE: <number from 0.00 to 1.00>",
    "FEEDBACK: <one short evidence-based correction sentence>",
    "",
    "CHUNK_SOURCE:",
    chunkSource,
    "",
    "CHUNK_SUMMARY:",
    chunkSummary,
    "",
    "PRIOR_REVIEW_TO_ADJUDICATE:",
    priorReview,
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
    // Stage B receives ranking identity only. Re-supplying the raw section
    // summaries here bypasses Stage A's bounded normalization and can
    // reintroduce conflicting attributions or outcomes.
    .map((it, idx) => `${idx + 1}. [${it.index}] ${it.heading}`)
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
    "- Under the H1, write one paragraph of 2 to 3 sentences.",
    "- Under Top Newsworthy Developments, write 6 to 12 bullets. Each bullet must cover exactly one substantive agenda topic and one source-supported status or outcome.",
    "- Under Why It Matters, write 2 to 4 bullets. Each bullet must cover exactly one agenda topic and only impacts explicitly supplied in the chunks.",
    "- Under Watch Next, write bullets only for explicit unresolved decisions, applications, or staff follow-ups. If none are explicit, write one plain sentence saying so.",
    "",
    "Rules:",
    "- Use only facts present in CHUNK_SUMMARIES or RANKED_NEWS_CANDIDATES.",
    "- Lead with the most consequential substantive item from RANKED_NEWS_CANDIDATES, not procedural openers.",
    "- Write in plain local-news language: concise, concrete, and restrained.",
    "- Use only stakes and impacts explicitly stated in the supplied chunks. Do not infer who relies on a service, what a proposal threatens, or why an outcome occurred.",
    "- Preserve coverage from early, middle, and late meeting phases. Include at least one substantive topic from every supplied chunk, including the final chunk.",
    "- Keep facts from separate agenda sections separate. Never invent a causal relationship, funding relationship, or common decision between sections.",
    "- Preserve organization, program, place, report, and speaker names exactly as supplied; do not invent abbreviations or rename entities.",
    "- RANKED_NEWS_CANDIDATES and covered headings are authoritative for agenda item names, report codes, projects, and locations when a chunk sentence conflicts with them.",
    "- Never name individual councillors, motion movers, or seconders in the whole-meeting recap. Describe the committee, staff, presenter, report, or correspondence instead.",
    "- A presenter or correspondence author's name may appear only when copied verbatim from a supplied chunk and essential to the story.",
    `- Refer to the meeting's governing body as "${bodyLabel || "the governing body"}"; never substitute Council, county council, or another body label.`,
    "- Preserve an action by a subordinate committee or board only when that acting body and action are explicit in the supplied chunks.",
    "- Do not overweight opening procedural sections.",
    "- Include key decisions and outcomes where present.",
    "- If a point is proposal-only or uncertain, say it was discussed/considered rather than adopted.",
    "- When source summaries disagree about whether a motion or approval occurred, omit the outcome claim and describe the proposal, report, or discussion conservatively.",
    "- Preserve status and tense exactly: do not change cleared/completed/authorized into targeting/planned/pending, or change a proposal into a completed outcome.",
    "- When motion wording or its outcome is unclear, do not say an item was moved, seconded, carried, or defeated; report only the underlying topic.",
    "- Never add unanimous, approved, adopted, awarded, or authorized when the supplied sources do not agree on that exact outcome.",
    "- For vote language (carried, defeated, approved, deferred, unanimous, split), use only when explicitly supported in CHUNK_SUMMARIES.",
    "- Keep tone grounded and specific; avoid generic civic filler or abstract framing.",
    "- Avoid promotional or interpretive modifiers such as critical, major, substantial, high-stakes, successful, positive momentum, or lack of effort unless the supplied chunk uses that characterization.",
    "- Do not recast waitlist attachment as administrative backlog clearing or access to specialized care unless the supplied chunk says so.",
    "- Do not describe Healthcare Connect attachment as specialized care; use primary-care attachment or waitlist clearance only when supplied.",
    "- In Why It Matters, restate only direct service, financial, regulatory, land-use, or safety effects found in the chunks; do not predict broader consequences.",
    "- In Watch Next, include only an explicit unresolved question, staff follow-up, future report, application, or decision found in a supplied chunk. Do not invent monitoring tasks, grant applications, capital plans, audits, recruitment effects, or development impacts.",
    "- If no explicit follow-up is supplied, write one plain sentence saying no explicit follow-up was recorded; do not turn discussed items into future tasks.",
    "- Avoid opening with call-to-order, committee-of-the-whole motions, minutes confirmation, or adjournment.",
    "- Do not mention the weekday, time of day, today, tonight, this evening, or repeat the meeting date unless a source event specifically depends on that timing.",
    "- Do not add motives or loaded characterizations such as corporate offloads, volatile funding, deep-seated deficits, or historical neglect unless those exact claims are supported.",
    "- Do not use these phrases unless directly quoted from source: distributive justice; ring-fenced; reclamation; spirited debate; stark reality check; no unresolved issues; complex landscape.",
    "- Keep total length under 500 words.",
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
    .map((it, idx) => `${idx + 1}. [${it.index}] ${it.heading}`)
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
    "- Penalize any named councillor, motion mover, or seconder in the recap. A presenter or correspondence author's verbatim name is allowed when essential.",
    "- Penalize omission of every substantive topic from an entire supplied chunk, especially the final chunk.",
    "- Do not penalize omission of secondary details when at least one substantive topic from that chunk is accurately covered.",
    "- When supplied sources conflict on vote or approval status, reward conservative proposal/discussion wording and penalize a definite outcome claim.",
    "- When a chunk reports debate or consideration without an explicit outcome, reward conservative wording such as debated, considered, unresolved, or under consideration.",
    "- Watch Next may mention an unresolved decision only when a supplied chunk explicitly describes the terms as debated or under consideration.",
    "- Penalize invented causal or funding links between separate agenda sections.",
    "- Do not penalize a causal or funding relationship copied from within the same supplied chunk.",
    "- Judge only against CHUNK_SUMMARIES and RANKED_NEWS_CANDIDATES; do not infer missing events or outcomes from outside knowledge.",
    "- Penalize renamed organizations, invented abbreviations, loaded motives, and unsupported characterizations.",
    "- Penalize weekday/time-of-day/today/tonight framing that is not explicitly supported and necessary.",
    `- Penalize incorrect governing body label; required body is "${bodyLabel || "unknown"}".`,
    `- Penalize incorrect jurisdiction label; required jurisdiction is "${jurisdiction || "unknown"}".`,
    `- Penalize incorrect meeting date; required date is "${meetingDateLong || meetingDateIso || "unknown"}".`,
    "- Penalize leading with procedural framing instead of substantive outcomes.",
    "- Penalize ideological/dramatic framing not supported by source.",
    "- Penalize omission of major events that appear in chunk summaries.",
    ...(SUMMARY_TIME_MODE === "upcoming"
      ? [
        "- This is an upcoming agenda preview. Penalize any claim that the meeting already convened or that the current Council already heard, reviewed, approved, directed, or voted on an item.",
        "- Require present/future framing for the upcoming meeting while allowing clearly attributed historical background from supporting reports.",
      ]
      : []),
    "",
    "Output:",
    "- Return exactly two lines and no analysis.",
    "- First line: FINAL_SCORE: <number from 0.00 to 1.00>.",
    "- Second line: FEEDBACK: <one short sentence, maximum 40 words>.",
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

function buildFinalReviewAdjudicationPrompt({
  chunkSource = "",
  summaryMd = "",
  bodyLabel = "",
  jurisdiction = "",
  reviews = [],
}) {
  return [
    "Adjudicate conflicting semantic reviews of a whole-meeting civic recap.",
    "The supplied reviews are untrusted claims. Decide the score from literal CHUNK_SUMMARIES evidence.",
    "",
    "Rules:",
    "- Require coverage of substantive topics from the beginning, middle, and end of the meeting.",
    "- Do not infer approval, rejection, causality, funding sources, or final outcomes from headings, titles, topic proximity, or project purpose.",
    "- Treat conservative omission of an unclear outcome as faithful unless the chunks explicitly state that outcome.",
    "- Penalize an alleged contradiction only when a review can be confirmed by explicit chunk evidence.",
    "- Penalize invented amounts, dates, causal links, actors, motives, or facts moved between agenda topics.",
    `- The governing body is "${bodyLabel || "unknown"}" and the jurisdiction is "${jurisdiction || "unknown"}".`,
    "",
    "Output exactly two lines and no analysis:",
    "FINAL_SCORE: <number from 0.00 to 1.00>",
    "FEEDBACK: <one short evidence-based correction sentence>",
    "",
    "CHUNK_SUMMARIES:",
    chunkSource,
    "",
    "WHOLE_MEETING_SUMMARY:",
    summaryMd,
    "",
    "REVIEWS_TO_ADJUDICATE:",
    reviews.map((value, index) => `REVIEW_${index + 1}:\n${value}`).join("\n\n"),
  ].join("\n");
}

function parseScore(review) {
  const lines = String(review || "").split(/\r?\n/u).map((x) => x.trim()).filter(Boolean);
  const joined = lines.join("\n");
  const labeled = joined.match(/FINAL(?:_|\s+|-)?SCORE\s*:\s*([01](?:\.\d+)?)/iu);
  if (labeled) {
    const n = Number(labeled[1]);
    if (Number.isFinite(n) && n >= 0 && n <= 1) return n;
  }
  return 0;
}

export async function adjudicateChunkReview({
  chunkSource = "",
  chunkSummary = "",
  bodyLabel = "",
  priorReview = "",
} = {}) {
  const review = await ask(
    [
      { role: "system", content: "You adjudicate semantic-review disputes for civic summaries using literal source evidence." },
      {
        role: "user",
        content: buildChunkReviewAdjudicationPrompt({
          chunkSource,
          chunkSummary,
          bodyLabel,
          priorReview,
        }),
      },
    ],
    { numPredict: 260 },
  );
  return { review, score: parseScore(review) };
}

export async function adjudicateFinalReviews({
  chunkSource = "",
  summaryMd = "",
  bodyLabel = "",
  jurisdiction = "",
  reviews = [],
} = {}) {
  const review = await ask(
    [
      { role: "system", content: "You adjudicate disputed whole-meeting civic-summary reviews using literal source evidence." },
      {
        role: "user",
        content: buildFinalReviewAdjudicationPrompt({
          chunkSource,
          summaryMd,
          bodyLabel,
          jurisdiction,
          reviews,
        }),
      },
    ],
    { numPredict: 420 },
  );
  return { review, score: parseScore(review) };
}

function parseJsonObject(text = "") {
  const value = String(text || "").replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "").trim();
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(value.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function auditFinalChunkCoverage({ chunks = [], summaryMd = "" }) {
  const missing = [];
  const rawRows = [];
  const adjudicationRows = [];
  for (const chunk of chunks) {
    const chunkId = String(chunk?.["chunk id"] || "").trim();
    if (!chunkId) continue;
    const chunkSummary = String(chunk?.["chunk summary text"] || "").trim();
    const buildPrompt = ({ priorAudit = "" } = {}) => [
      priorAudit
        ? "Adjudicate a disputed semantic coverage result for one chronology chunk."
        : "Decide semantic topic coverage for one chronology chunk.",
      priorAudit ? "The prior audit is an untrusted claim; recheck against literal evidence." : "",
      "covered is true only when FINAL_SUMMARY contains at least one identifiable substantive presentation, service, report, public input, decision, or outcome from CHUNK_SUMMARY.",
      "A procedural mention alone is insufficient when CHUNK_SUMMARY contains substantive material.",
      "Coverage may be concise and paraphrased; do not require exact wording.",
      "Return exactly: {\"covered\":true,\"evidence\":\"short phrase identifying the covered topic\"}",
      "",
      `CHUNK_ID: ${chunkId}`,
      `CHUNK_SUMMARY: ${chunkSummary}`,
      "",
      "FINAL_SUMMARY:",
      summaryMd,
      priorAudit ? `\nPRIOR_AUDIT:\n${priorAudit}` : "",
    ].filter(Boolean).join("\n");
    const raw = await ask(
      [
        {
          role: "system",
          content: "You audit one chronology chunk for semantic topic coverage in a civic recap. Return strict JSON only.",
        },
        {
          role: "user",
          content: buildPrompt(),
        },
      ],
      { numPredict: 180 },
    );
    rawRows.push({ "chunk id": chunkId, raw });
    let parsed = parseJsonObject(raw);
    if (parsed?.covered !== true) {
      const adjudication = await ask(
        [
          {
            role: "system",
            content: "You adjudicate one disputed chronology-chunk coverage result. Return strict JSON only.",
          },
          {
            role: "user",
            content: buildPrompt({ priorAudit: raw }),
          },
        ],
        { numPredict: 220 },
      );
      adjudicationRows.push({ "chunk id": chunkId, raw: adjudication });
      parsed = parseJsonObject(adjudication);
    }
    if (parsed?.covered !== true) missing.push(chunkId);
  }
  return {
    missing,
    raw: JSON.stringify(rawRows),
    adjudication: JSON.stringify(adjudicationRows),
  };
}

export function namedCouncilActorDefects(text = "", authoritativeHeadings = []) {
  let candidate = String(text || "");
  for (const heading of (Array.isArray(authoritativeHeadings) ? authoritativeHeadings : [])) {
    const exact = String(heading || "").trim();
    if (!exact) continue;
    const escaped = exact.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    candidate = candidate.replace(
      new RegExp(`(^|\\n)\\s*[-*]?\\s*${escaped}(?=\\s*:)`, "giu"),
      "$1",
    );
  }
  return [
    ...Array.from(
      candidate.matchAll(/\b(?:Chair|chair|Councillor|councillor|Councilor|councilor)\s+\p{Lu}[\p{L}'’-]*/gu),
      (match) => match[0],
    ),
    ...Array.from(
      candidate.matchAll(/\b\p{Lu}[\p{L}'’-]+\s+\p{Lu}[\p{L}'’-]+\s+(?:moved|seconded)\b/gu),
      (match) => match[0],
    ),
  ];
}

export function buildChunkRetryGuidance({
  candidate = "",
  forbiddenNames = [],
  wrongBody = [],
  bodyLabel = "",
  semanticReview = "",
  attempt = 1,
} = {}) {
  const rejectedDraft = String(candidate || "").trim().slice(0, 6000);
  const freshActorRepair = Number(attempt) >= 3 && forbiddenNames.length;
  const repeatedActorRepair = Number(attempt) >= 2 && forbiddenNames.length
    ? [
      "Use a third-pass repair strategy for the repeated actor defect.",
      "Delete every listed named-actor occurrence, then rewrite only the affected clause with a generic body, staff, presenter, or report attribution supported by the source.",
      "Scan the full corrected draft before returning it and ensure none of the listed occurrences remain outside an exact required heading.",
      freshActorRepair
        ? "Do not edit the rejected sentences in place. Write a fresh summary from the grounded source using no personal names anywhere in prose."
        : "",
    ].join(" ")
    : "";
  return [
    freshActorRepair
      ? "Write a fresh source-grounded replacement that preserves the required headings and topic coverage while fixing every listed defect."
      : "Revise the rejected draft below instead of generating an unrelated replacement. Preserve every correct heading and grounded fact while fixing every listed defect.",
    repeatedActorRepair,
    forbiddenNames.length ? `Remove named councillors/movers: ${forbiddenNames.join(", ")}.` : "",
    wrongBody.length ? `Use only "${bodyLabel}" as the acting body: ${wrongBody.join(", ")}.` : "",
    semanticReview ? `SEMANTIC_RETRY:\n${semanticReview}` : "",
    rejectedDraft ? `REJECTED_DRAFT:\n${rejectedDraft}` : "",
  ].filter(Boolean).join("\n\n");
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
    let cleaned = "";
    let chunkFeedback = "";
    const accumulatedForbiddenNames = new Set();
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const summaryText = await ask(
        [
          { role: "system", content: "You are a strict local-news summarizer. Stay source-faithful." },
          {
            role: "user",
            content: [
              buildChunkSummaryPrompt({
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
              chunkFeedback ? `\nRETRY_FEEDBACK:\n${chunkFeedback}` : "",
            ].join("\n"),
          },
        ],
        { numPredict: 700 },
      );
      const candidate = String(summaryText || "").trim();
      const forbiddenNames = namedCouncilActorDefects(candidate, u["covered headings"]);
      for (const name of forbiddenNames) accumulatedForbiddenNames.add(name);
      const wrongBody = governingBodyDefects(candidate, bodyLabel, u.source);
      let semanticReview = "";
      let semanticScore = 0;
      if (candidate && forbiddenNames.length === 0 && wrongBody.length === 0) {
        semanticReview = await ask(
          [
            { role: "system", content: "You are a strict semantic verifier for civic source summaries." },
            {
              role: "user",
              content: buildChunkScorePrompt({
                chunkSource: u.source,
                chunkSummary: candidate,
                bodyLabel,
              }),
            },
          ],
          { numPredict: 260 },
        );
        semanticScore = parseScore(semanticReview);
        if (semanticScore < PASS_THRESHOLD) {
          const adjudication = await adjudicateChunkReview({
            chunkSource: u.source,
            chunkSummary: candidate,
            bodyLabel,
            priorReview: semanticReview,
          });
          semanticReview = adjudication.review;
          semanticScore = adjudication.score;
        }
        if (semanticScore >= PASS_THRESHOLD) {
          cleaned = candidate;
          break;
        }
      }
      chunkFeedback = buildChunkRetryGuidance({
        candidate,
        forbiddenNames: [...accumulatedForbiddenNames],
        wrongBody,
        bodyLabel,
        semanticReview,
        attempt,
      });
      log(
        `[meeting-summary][chunk] rejected ${u["chunk id"]} attempt=${attempt} `
        + `empty=${candidate ? "no" : "yes"} actor_defects=${forbiddenNames.length} `
        + `body_defects=${wrongBody.length} semantic_score=${semanticScore.toFixed(3)} `
        + `actor_feedback=${forbiddenNames.join(" | ") || "(none)"} `
        + `body_feedback=${wrongBody.join(" | ") || "(none)"} `
        + `feedback=${String(semanticReview || "").replace(/\s+/gu, " ").trim().slice(0, 500) || "(none)"}`,
      );
    }
    if (!cleaned) {
      throw new Error(`meeting summary stage A defective: no constraint-safe chunk summary for ${u["chunk id"]}`);
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

export function buildFinalNumericGroundingSource(chunkSource = "", priorityItems = [], authoritativeContext = []) {
  const rankedSource = (Array.isArray(priorityItems) ? priorityItems : [])
    .map((item) => [
      String(item?.heading || "").trim(),
      String(item?.summary || "").trim(),
    ].filter(Boolean).join("\n"))
    .filter(Boolean)
    .join("\n\n");
  const contextSource = (Array.isArray(authoritativeContext) ? authoritativeContext : [authoritativeContext])
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join("\n");
  return [String(chunkSource || "").trim(), rankedSource, contextSource]
    .filter(Boolean)
    .join("\n\n---\n\n");
}

async function synthesizeFinalMeetingSummary({
  chunksArtifact,
  focus,
  meetingDateIso,
  meetingDateLong,
  bodyLabel,
  jurisdiction,
  priorityItems,
  log = () => {},
}) {
  const chunkSource = buildChunkSourceForStageB(chunksArtifact?.chunks || []);
  const numericGroundingSource = buildFinalNumericGroundingSource(
    chunkSource,
    priorityItems,
    [meetingDateIso, meetingDateLong],
  );
  let feedback = "";
  let bestText = "";
  let bestScore = -1;
  let bestReview = "";
  let bestDiagnostics = "";

  for (let i = 1; i <= MAX_ATTEMPTS; i += 1) {
    const draftRaw = await ask(
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
    const draft = normalizeRequiredSummaryHeadings(String(draftRaw || "").trim());
    const coverageAudit = await auditFinalChunkCoverage({
      chunks: chunksArtifact?.chunks || [],
      summaryMd: draft,
    });

    const reviews = [];
    for (let reviewIndex = 0; reviewIndex < 3; reviewIndex += 1) {
      reviews.push(await ask(
        [
          { role: "system", content: "You are a strict semantic verifier for civic summaries. Judge only against the supplied sources." },
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
        // Leave enough room for the mandatory trailing score. Truncating a
        // detailed critique before FINAL_SCORE silently parses as zero.
        { numPredict: 360 },
      ));
    }
    const reviewScores = reviews.map(parseScore).sort((a, b) => a - b);
    let verifierScore = reviewScores[Math.floor(reviewScores.length / 2)] || 0;
    let review = reviews.map((value, index) => `REVIEW_${index + 1}:\n${value}`).join("\n\n");
    if (verifierScore < PASS_THRESHOLD
      || (reviewScores.at(-1) || 0) - (reviewScores[0] || 0) >= 0.2) {
      const adjudication = await adjudicateFinalReviews({
        chunkSource,
        summaryMd: draft,
        bodyLabel,
        jurisdiction,
        reviews,
      });
      verifierScore = adjudication.score;
      review = [
        review,
        `ADJUDICATION:\n${adjudication.review}`,
      ].join("\n\n");
    }

    const completenessPenalty = hasCompleteRequiredSections(draft) ? 0 : 0.4;
    const stylePenalty = synthesisPenalty(draft);
    const temporalDefects = SUMMARY_TIME_MODE === "upcoming" ? previewTemporalDefects(draft) : [];
    const temporalPenalty = temporalDefects.length ? 0.6 : 0;
    const bodyDefects = governingBodyDefects(draft, bodyLabel, chunkSource);
    const bodyPenalty = bodyDefects.length ? 0.6 : 0;
    const numericDefects = unsupportedNumericTokens(draft, numericGroundingSource);
    const numericPenalty = numericDefects.length ? 0.6 : 0;
    const coveragePenalty = coverageAudit.missing.length ? 1 : 0;
    const score = Math.max(0, verifierScore - completenessPenalty - stylePenalty - temporalPenalty - bodyPenalty - numericPenalty - coveragePenalty);
    const diagnostics = [
      `attempt=${i}`,
      `verifier=${verifierScore.toFixed(3)}`,
      `completeness_penalty=${completenessPenalty.toFixed(3)}`,
      `style_penalty=${stylePenalty.toFixed(3)}`,
      `temporal_penalty=${temporalPenalty.toFixed(3)}`,
      `body_penalty=${bodyPenalty.toFixed(3)}`,
      `numeric_penalty=${numericPenalty.toFixed(3)}`,
      `coverage_penalty=${coveragePenalty.toFixed(3)}`,
      `missing_chunks=${coverageAudit.missing.join(",") || "(none)"}`,
      `score=${score.toFixed(3)}`,
    ].join(" ");
    log(`[meeting-summary][final] ${diagnostics}`);
    if (bestText === "" || score > bestScore) {
      bestText = draft;
      bestScore = score;
      bestReview = review;
      bestDiagnostics = diagnostics;
    }
    feedback = [
      review,
      temporalDefects.length ? `UPCOMING_TENSE_RETRY: Rewrite without completed-meeting claims: ${temporalDefects.join(", ")}.` : "",
      bodyDefects.length ? `GOVERNING_BODY_RETRY: Use only "${bodyLabel}" as the acting body; remove: ${bodyDefects.join(", ")}.` : "",
      numericDefects.length ? `NUMERIC_GROUNDING_RETRY: Remove or correct numeric tokens absent from source: ${numericDefects.join(", ")}.` : "",
      coverageAudit.missing.length ? `CHUNK_COVERAGE_RETRY: Cover a substantive topic from each missing chunk: ${coverageAudit.missing.join(", ")}.` : "",
    ].filter(Boolean).join("\n");
    if (score >= PASS_THRESHOLD) break;
  }

  if (SUMMARY_TIME_MODE === "upcoming") {
    const defects = previewTemporalDefects(bestText);
    if (defects.length) {
      throw new Error(`meeting summary retryable: upcoming preview contains completed-meeting claims: ${defects.join(", ")}`);
    }
  }
  const unsupported = unsupportedNumericTokens(bestText, numericGroundingSource);
  if (unsupported.length) {
    throw new Error(`meeting summary retryable: unsupported numeric claims: ${unsupported.join(", ")}`);
  }
  const bodyDefects = governingBodyDefects(bestText, bodyLabel, chunkSource);
  if (bodyDefects.length) {
    throw new Error(`meeting summary retryable: incorrect governing body attribution for "${bodyLabel}": ${bodyDefects.join(", ")}`);
  }
  if (!bestText || bestScore < PASS_THRESHOLD) {
    throw new Error(`meeting summary retryable: Qwen synthesis score ${Number(bestScore || 0).toFixed(3)} below publish threshold ${PASS_THRESHOLD.toFixed(2)} diagnostics=${bestDiagnostics} feedback=${String(bestReview || "").replace(/\s+/gu, " ").trim()}`);
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
  const sections = (() => {
    if (Array.isArray(sourceObj?.sections)) return sourceObj.sections;
    const raw = String(sourceObj?.sections || "").trim();
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
      if (typeof parsed === "string") {
        const reparsed = JSON.parse(parsed);
        return Array.isArray(reparsed) ? reparsed : [];
      }
    } catch {
      return [];
    }
    return [];
  })();
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
    log,
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
