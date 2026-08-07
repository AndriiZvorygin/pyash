import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { readPyaMapArtifact, writePyaMapArtifact } from "./agenda-stage-contracts.mjs";

const CANDIDATES_ROOT = "agenda gross chunks artifact";
const MATCHES_ROOT = "agenda matches artifact";
const GROUNDING_ROOT = "agenda section grounding artifact";
const ROLES = new Set([
  "procedural",
  "minutes",
  "public_meeting",
  "deputation",
  "public_forum",
  "correspondence",
  "staff_report",
  "committee_report",
  "council_decision",
  "closed_session",
  "bylaw",
  "other",
]);
const STATUSES = new Set(["executed", "empty", "skipped", "container"]);

function clean(value = "") {
  return String(value || "").replace(/\s+/gu, " ").trim();
}

function evidenceKey(value = "") {
  return clean(value).normalize("NFKD").replace(/[\u0300-\u036f]/gu, "").replace(/[^a-z0-9]+/giu, " ").trim().toLowerCase();
}

function itemKey(value = "") {
  return clean(value).toLowerCase().replace(/^item\s+/u, "").replace(/\.$/u, "");
}

const SPOKEN_AGENDA_NUMBERS = new Map([
  ["zero", 0], ["one", 1], ["two", 2], ["three", 3], ["four", 4],
  ["five", 5], ["six", 6], ["seven", 7], ["eight", 8], ["nine", 9],
  ["ten", 10], ["eleven", 11], ["twelve", 12], ["thirteen", 13],
  ["fourteen", 14], ["fifteen", 15], ["sixteen", 16], ["seventeen", 17],
  ["eighteen", 18], ["nineteen", 19], ["twenty", 20], ["thirty", 30],
  ["forty", 40], ["fifty", 50], ["sixty", 60], ["seventy", 70],
  ["eighty", 80], ["ninety", 90],
]);

function readSpokenAgendaNumber(tokens, start) {
  const token = tokens[start] || "";
  if (/^\d+$/u.test(token)) return { value: Number(token), next: start + 1 };
  const direct = SPOKEN_AGENDA_NUMBERS.get(token);
  if (direct === undefined) return null;
  const nextToken = tokens[start + 1] || "";
  const tens = direct >= 20 && direct % 10 === 0;
  const ones = SPOKEN_AGENDA_NUMBERS.get(nextToken);
  if (tens && Number.isInteger(ones) && ones >= 1 && ones <= 9) {
    return { value: direct + ones, next: start + 2 };
  }
  return { value: direct, next: start + 1 };
}

function spokenAgendaItemKey(value = "") {
  const tokens = evidenceKey(value)
    .split(" ")
    .filter((token) => token && !["item", "number", "agenda"].includes(token));
  if (!tokens.length) return "";
  const compact = tokens[0];
  const compactMatch = compact.match(/^(\d+)([a-z])(?:(\d+)|([a-z]))?$/u);
  if (compactMatch && tokens.length === 1) {
    return [compactMatch[1], compactMatch[2], compactMatch[3] || compactMatch[4]].join(".");
  }
  const first = readSpokenAgendaNumber(tokens, 0);
  if (!first) return "";
  const parts = [String(first.value)];
  let cursor = first.next;
  while (cursor < tokens.length) {
    const token = tokens[cursor];
    if (/^[a-z]$/u.test(token)) {
      parts.push(token);
      cursor += 1;
      continue;
    }
    const number = readSpokenAgendaNumber(tokens, cursor);
    if (!number) return "";
    parts.push(String(number.value));
    cursor = number.next;
  }
  return parts.length > 1 || first.value > 0 ? parts.join(".") : "";
}

function roleKey(value = "") {
  const role = clean(value).toLowerCase().replace(/[\s-]+/gu, "_");
  const aliases = new Map([
    ["delegation", "deputation"],
    ["presentation", "deputation"],
    ["consent", "procedural"],
    ["consent_agenda", "procedural"],
    ["determination", "procedural"],
    ["adjournment", "procedural"],
    ["report", "staff_report"],
    ["financial_report", "staff_report"],
    ["audit", "staff_report"],
    ["motion", "council_decision"],
    ["vote", "council_decision"],
    ["discussion", "other"],
  ]);
  const normalized = aliases.get(role) || role;
  // Role is descriptive metadata, not boundary identity. Preserve the strict
  // vocabulary without discarding an otherwise grounded item when Qwen uses
  // a reasonable unlisted label such as "consent_block".
  return normalized && !ROLES.has(normalized) ? "other" : normalized;
}

function itemParts(value = "") {
  const key = itemKey(value);
  if (!/^\d+(?:\.[a-z0-9]+)*$/u.test(key)) return null;
  return key.split(".").map((part, index) => {
    if (/^\d+$/u.test(part)) return Number(part);
    let value = 0;
    for (const char of part) value = (value * 27) + (char.charCodeAt(0) - 96);
    return index === 0 ? Number.NaN : value;
  });
}

function compareItemCodes(left, right) {
  const a = itemParts(left);
  const b = itemParts(right);
  if (!a || !b) return Number.NaN;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (i >= a.length) return -1;
    if (i >= b.length) return 1;
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function canonicalIdentityOwnsTarget(classifiedItem, targetItem, canonical) {
  if (classifiedItem === targetItem) return true;
  let cursor = classifiedItem;
  while (targetItem.startsWith(`${cursor}.`)) {
    const parent = canonical.items.find((entry) => entry.item === cursor);
    if (!parent) return false;
    const children = canonical.items.filter((entry) => entry.level === parent.level + 1
      && entry.item.startsWith(`${cursor}.`));
    if (children.length !== 1) return false;
    cursor = children[0].item;
    if (cursor === targetItem) return true;
  }
  return false;
}

function sha256(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

export function loadCanonicalAgenda(indexPath) {
  const raw = fs.readFileSync(indexPath, "utf8");
  const parsed = JSON.parse(raw);
  const sourceItems = Array.isArray(parsed?.items) ? parsed.items : [];
  const seen = new Set();
  const items = [];
  for (const source of sourceItems) {
    const item = itemKey(source?.item);
    const title = clean(source?.title);
    if (!item || !title || !itemParts(item) || seen.has(item)) continue;
    seen.add(item);
    items.push({
      item,
      title,
      level: item.split(".").length,
      substantive: Boolean(Array.isArray(source?.attachments) && source.attachments.length),
    });
  }
  if (!items.length) throw new Error(`agenda segmentation retryable: canonical agenda has no items: ${indexPath}`);
  for (let i = 1; i < items.length; i += 1) {
    if (compareItemCodes(items[i].item, items[i - 1].item) < 0) {
      throw new Error(`agenda segmentation retryable: canonical agenda is not ordered at ${items[i].item}`);
    }
  }
  return {
    sourcePath: path.resolve(indexPath),
    sourceType: "structured_escribe_index",
    fingerprint: sha256(raw),
    items,
  };
}

export function parseCanonicalAgendaMarkdown(markdown, sourcePath = "") {
  const lines = String(markdown || "").split(/\r?\n/u).map(clean).filter(Boolean);
  const items = [];
  const seen = new Set();
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^(\d{1,2}(?:\.[a-z0-9]+)*)\.?\s*(.*)$/iu);
    if (!m) continue;
    const item = itemKey(m[1]);
    const next = clean(m[2] || (!/^\d{1,2}(?:\.[a-z0-9]+)*\.?\s*$/iu.test(lines[i + 1] || "") ? lines[i + 1] : ""));
    if (!next || seen.has(item)) continue;
    seen.add(item);
    items.push({ item, title: next, level: item.split(".").length });
  }
  if (!items.length) throw new Error("agenda segmentation retryable: fallback agenda extraction returned no items");
  const canonicalText = JSON.stringify(items);
  return { sourcePath: path.resolve(sourcePath || "."), sourceType: "llm_agenda_extraction", fingerprint: sha256(canonicalText), items };
}

function sentenceSegments(text) {
  const source = clean(text);
  if (!source) return [];
  if (typeof Intl?.Segmenter === "function") {
    return [...new Intl.Segmenter("en", { granularity: "sentence" }).segment(source)]
      .map((part) => clean(part.segment))
      .filter(Boolean);
  }
  return source.match(/[^.!?]+(?:[.!?]+|$)/gu)?.map(clean).filter(Boolean) || [source];
}

export function buildAtomicTranscriptUnits(rawRows) {
  const sourceRows = Array.isArray(rawRows?.rows) ? rawRows.rows : (Array.isArray(rawRows) ? rawRows : []);
  const units = [];
  for (let rowIndex = 0; rowIndex < sourceRows.length; rowIndex += 1) {
    const row = sourceRows[rowIndex] || {};
    const speaker = clean(row.display || row.speaker || row.speaker_key || "UNKNOWN");
    const sentences = sentenceSegments(row.text || row.raw || "");
    for (let sentenceIndex = 0; sentenceIndex < sentences.length; sentenceIndex += 1) {
      units.push({
        "atomic unit id": `atomic_${String(units.length + 1).padStart(6, "0")}`,
        "atomic index": units.length,
        "source row": rowIndex,
        "sentence index": sentenceIndex,
        since: Number(row.since || 0),
        until: Number(row.until || row.since || 0),
        speaker,
        text: sentences[sentenceIndex],
      });
    }
  }
  if (!units.length) throw new Error("agenda segmentation retryable: transcript has no atomic units");
  return units;
}

export function buildOverlappingWindows(units, options = {}) {
  const maxWords = Math.max(250, Number(options.maxWords || 600));
  const overlapWords = Math.max(60, Math.min(maxWords / 2, Number(options.overlapWords || 120)));
  const windows = [];
  let start = 0;
  while (start < units.length) {
    let words = 0;
    let end = start;
    while (end < units.length) {
      const count = clean(units[end]?.text).split(/\s+/u).filter(Boolean).length;
      if (end > start && words + count > maxWords) break;
      words += count;
      end += 1;
    }
    const endExclusive = Math.max(start + 1, end);
    const slice = units.slice(start, endExclusive);
    windows.push({
      "window id": `window_${String(windows.length + 1).padStart(4, "0")}`,
      "atomic start": start,
      "atomic end": endExclusive - 1,
      "source words": words,
      text: slice.map((u) => `[${u["atomic unit id"]}] ${u.speaker}: ${u.text}`).join("\n"),
    });
    if (endExclusive >= units.length) break;
    let overlap = 0;
    let next = endExclusive;
    while (next > start + 1 && overlap < overlapWords) {
      next -= 1;
      overlap += clean(units[next]?.text).split(/\s+/u).filter(Boolean).length;
    }
    start = Math.max(start + 1, next);
  }
  return windows;
}

export async function callOllamaJson({
  ollamaUrl,
  llmModel,
  system,
  prompt,
  attempts = 3,
  maxOutputTokens = Number(process.env.AGENDA_BOUNDARY_MAX_OUTPUT_TOKENS || 5000),
  fetchImpl = fetch,
}) {
  let lastError = null;
  const initialOutputTokens = Math.max(256, Number(maxOutputTokens) || 5000);
  const maximumOutputTokens = Math.max(
    initialOutputTokens,
    Number(process.env.AGENDA_BOUNDARY_MAX_RETRY_OUTPUT_TOKENS || 16000),
  );
  let outputTokens = initialOutputTokens;
  let retryInstruction = "";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetchImpl(ollamaUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: llmModel,
          stream: false,
          think: false,
          format: "json",
          options: { temperature: 0, num_predict: outputTokens },
          messages: [
            { role: "system", content: system },
            { role: "user", content: retryInstruction ? `${prompt}\n\n${retryInstruction}` : prompt },
          ],
        }),
        signal: AbortSignal.timeout(Math.max(10_000, Number(process.env.AGENDA_BOUNDARY_LLM_TIMEOUT_MS || 180_000))),
      });
      if (!res.ok) throw new Error(`ollama status ${res.status}`);
      const payload = await res.json();
      const content = clean(payload?.message?.content);
      try {
        return JSON.parse(content);
      } catch (parseError) {
        const object = content.match(/\{[\s\S]*\}/u)?.[0];
        if (object) {
          try {
            return JSON.parse(object);
          } catch {}
        }
        const truncated = payload?.done_reason === "length"
          || /unexpected end|unterminated/iu.test(String(parseError?.message || parseError));
        if (truncated && outputTokens < maximumOutputTokens) {
          outputTokens = Math.min(maximumOutputTokens, outputTokens * 2);
          retryInstruction = [
            "The previous response was truncated.",
            "Return the complete strict JSON object within the available output budget, with no commentary.",
            "Include at most one transition per canonical agenda identity and omit duplicate candidates.",
          ].join(" ");
        }
        throw new Error(truncated ? "truncated JSON response" : "unparseable JSON");
      }
    } catch (error) {
      lastError = error;
      if (attempt < attempts && /fetch failed|timeout|socket|status 5\d\d/iu.test(String(error?.message || error))) {
        await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
      }
    }
  }
  throw new Error(`agenda segmentation retryable: LLM failed: ${String(lastError?.message || lastError)}`);
}

export async function splitOversizedTranscriptUnits(units, {
  maxWords = 120,
  segmentProvider = null,
  llmModel = "qwen3.5:9b",
  ollamaUrl = "http://mriczo:11434/api/chat",
} = {}) {
  const expanded = [];
  for (const unit of units) {
    const source = clean(unit.text);
    const words = source.split(/\s+/u).filter(Boolean).length;
    if (words <= maxWords) {
      expanded.push({ ...unit });
      continue;
    }
    const parsed = segmentProvider
      ? await segmentProvider({ unit, source })
      : await callOllamaJson({
        ollamaUrl,
        llmModel,
        system: "You split one verbatim municipal transcript row at chronology transitions. Return strict JSON only.",
        prompt: [
          "Split this oversized ASR row into ordered verbatim segments at sentence, speaker-turn, topic, or agenda transitions.",
          "Copy every word exactly once and in the original order. Do not summarize, correct, add, or omit text.",
          "Return only {\"segments\":[\"first exact span\",\"second exact span\"]}. At least two segments are required.",
          source,
        ].join("\n\n"),
        attempts: 3,
      });
    const segments = (Array.isArray(parsed?.segments) ? parsed.segments : []).map(clean).filter(Boolean);
    if (segments.length < 2 || clean(segments.join(" ")) !== source) {
      throw new Error(`agenda segmentation retryable: LLM did not split oversized atomic unit ${unit["atomic unit id"]} verbatim`);
    }
    let charsBefore = 0;
    const duration = Math.max(0, Number(unit.until || unit.since || 0) - Number(unit.since || 0));
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const startRatio = charsBefore / Math.max(1, source.length);
      charsBefore += segment.length + (index + 1 < segments.length ? 1 : 0);
      const endRatio = Math.min(1, charsBefore / Math.max(1, source.length));
      expanded.push({
        ...unit,
        since: Number(unit.since || 0) + (duration * startRatio),
        until: Number(unit.since || 0) + (duration * endRatio),
        text: segment,
        "llm split source atomic unit": unit["atomic unit id"],
      });
    }
  }
  return expanded.map((unit, index) => ({ ...unit, "atomic unit id": `atomic_${String(index + 1).padStart(6, "0")}`, "atomic index": index }));
}

function agendaText(items) {
  return items.map((entry) => `${entry.item}\t${entry.title}${entry.substantive ? "\t[substantive source material]" : ""}`).join("\n");
}

function structuredTitleHasLiteralSupport(title, transcriptSpan) {
  const ignored = new Set(["agenda", "business", "committee", "correspondence", "discussion", "item", "meeting", "minutes", "presentation", "report", "reports", "staff"]);
  const titleTerms = evidenceKey(title).split(" ").filter((term) => term.length >= 4 && !ignored.has(term));
  if (!titleTerms.length) return true;
  const spanTerms = new Set(evidenceKey(transcriptSpan).split(" "));
  return titleTerms.some((term) => spanTerms.has(term));
}

function focusedRecoveryBoundaryHasDirectSupport(entry, unit) {
  if (!entry || !unit) return false;
  if (structuredTitleHasLiteralSupport(entry.title, unit.text)) return true;
  const parts = itemKey(entry.item).split(".");
  if (!parts.length) return false;
  const numberWords = [...SPOKEN_AGENDA_NUMBERS.entries()]
    .filter(([, value]) => value === Number(parts[0]))
    .map(([word]) => word);
  const topLevelForms = [parts[0], ...numberWords];
  const terms = evidenceKey(unit.text).split(" ").filter(Boolean);
  const compactForms = [parts.join(""), `${parts[0]}${parts.slice(1).join("")}`];
  if (terms.some((term) => compactForms.includes(term))) return true;
  for (const top of topLevelForms) {
    const topIndex = terms.indexOf(top);
    if (topIndex < 0) continue;
    let cursor = topIndex + 1;
    let matched = true;
    for (const part of parts.slice(1)) {
      if (terms[cursor] !== part) {
        matched = false;
        break;
      }
      cursor += 1;
    }
    if (matched) return true;
  }
  return false;
}

export function competingCanonicalIdentityHasDirectSupport({ target, competing, transcriptSpan } = {}) {
  if (!target || !competing || target.item === competing.item) return false;
  const ignored = new Set([
    "agenda", "business", "city", "committee", "correspondence", "council", "county", "discussion",
    "item", "meeting", "minutes", "operations", "presentation", "regular", "report", "reports", "staff", "whole",
  ]);
  const meaningfulTerms = (title) => evidenceKey(title).split(" ").filter((term) => term.length >= 4 && !ignored.has(term));
  const competingTerms = meaningfulTerms(competing.title);
  if (!competingTerms.length) return false;
  const spanTerms = new Set(evidenceKey(transcriptSpan).split(" "));
  const competingDirect = competingTerms.some((term) => spanTerms.has(term));
  const targetTerms = meaningfulTerms(target.title);
  const targetDirect = targetTerms.some((term) => spanTerms.has(term));
  return competingDirect && !targetDirect;
}

export function directlySupportedCompetingIdentity({ target, canonical, transcriptSpan } = {}) {
  if (!target || !Array.isArray(canonical?.items)) return null;
  const spanTerms = new Set(evidenceKey(transcriptSpan).split(" ").filter(Boolean));
  const ignored = new Set([
    "agenda", "business", "city", "committee", "correspondence", "council", "county", "discussion",
    "item", "meeting", "minutes", "operations", "presentation", "regular", "report", "reports", "staff", "whole",
  ]);
  const scored = canonical.items
    .filter((entry) => competingCanonicalIdentityHasDirectSupport({ target, competing: entry, transcriptSpan }))
    .map((entry) => ({
      entry,
      overlap: evidenceKey(entry.title).split(" ")
        .filter((term) => term.length >= 4 && !ignored.has(term) && spanTerms.has(term)).length,
    }))
    .sort((left, right) =>
      Number(right.entry.substantive) - Number(left.entry.substantive)
      || Number(right.entry.level || 0) - Number(left.entry.level || 0)
      || right.overlap - left.overlap
    );
  return scored[0]?.entry || null;
}

function candidatePrompt(targetItems, window, found = [], retryReason = "") {
  return [
    "Locate the listed canonical agenda items in this municipal meeting transcript window.",
    "The recording may contain a preceding or following separate meeting. Never force discussion from another meeting into these canonical agenda items.",
    "Scan every atomic unit. Return EVERY listed item whose start is directly evidenced in the window, not merely the first or most important one.",
    "A chair announcing a new item, heading, named report, deputation, public forum, consent block, committee report, bylaw block, closed session, or adjournment is direct transition evidence.",
    "Consecutive canonical sibling items remain separate when the same presenter continues. Treat an explicit next item code, second part, next matter, or changed named subject as a new boundary.",
    "A spoken numeric agenda code may be rendered as words or compact letters by ASR (for example, 'Eleven A', '11 A', or '8C1'); map that spoken code to the matching canonical item when the subject agrees.",
    "Return a transition to a named substantive report even when it follows an empty procedural heading in the same window. Empty public forum or correspondence does not erase the following report boundary.",
    "A speaker beginning a presentation whose subject semantically matches a listed report title is also direct evidence, even when the chair omits or misstates the item code or paraphrases the title.",
    "If any such announcement appears, transitions must not be empty. Copy a short exact substring from the announced unit as evidence.",
    "Do not infer a transition merely because an item is next. Do not assign unlisted items.",
    "Return JSON: {\"transitions\":[{\"agenda item\":\"7.a\",\"announced topic\":\"Glassworks Village deputation\",\"atomic unit id\":\"atomic_000123\",\"role\":\"deputation\",\"evidence quote\":\"literal words from that unit\",\"confidence\":0.95}]}.",
    `role must be one of: ${[...ROLES].join(", ")}.`,
    "An evidence quote must occur literally in the named unit. Return an empty transitions array when there is no supported transition.",
    found.length ? `Already accepted; do not repeat: ${found.map((entry) => `${entry["agenda item"]}@${entry["atomic unit id"]}`).join(", ")}.` : "No transitions have been accepted from this window yet.",
    retryReason ? `Previous pass issue: ${retryReason}` : "",
    "Canonical items to locate:",
    agendaText(targetItems),
    `Transcript ${window["window id"]}:`,
    window.text,
  ].join("\n\n");
}

function wholeChronologyPrompt(canonical, units) {
  return [
    "Segment the complete municipal meeting chronology into the canonical agenda items that were actually executed.",
    "The recording may contain a preceding or following separate meeting whose agenda is not listed here.",
    "Never force out-of-scope discussion into a canonical item. Omit transitions belonging to another meeting.",
    "The first returned boundary must be the earliest exact atomic unit where this canonical meeting begins, not the start of the recording.",
    "Return every major transition in order, including public forum, deputations, staff reports, additional business, notices, and adjournment.",
    "Keep consecutive canonical sibling items separate even when the same presenter continues. An explicit next item code, second part, next matter, or changed named subject begins the sibling at that transition.",
    "Ignore headings explicitly empty or skipped. Parent category headings do not own discussion when a named child item does.",
    "Each boundary must be the earliest exact atomic unit where the item starts, including the chair's transition.",
    "Use only canonical agenda identities. Copy the complete literal text of the named atomic unit as evidence.",
    "Return JSON {\"transitions\":[{\"agenda item\":\"5.a\",\"atomic unit id\":\"atomic_000017\",\"evidence quote\":\"literal complete unit text\",\"role\":\"deputation\",\"confidence\":0.95}]}",
    "Canonical agenda:",
    agendaText(canonical.items),
    "Complete transcript:",
    units.map((unit) => `[${unit["atomic unit id"]}] ${unit.speaker}: ${unit.text}`).join("\n"),
  ].join("\n\n");
}

export function buildMeetingScopeStartPrompt({
  canonical,
  meetingLabel = "",
  window,
  retryReason = "",
} = {}) {
  const label = clean(meetingLabel);
  const transcriptWindowText = retryReason
    ? String(window?.text || "").split(/\r?\n/u).slice(0, 32).join("\n")
    : window?.text || "";
  return [
    `Locate where the ${label} meeting begins in this transcript window.`,
    "The recording may begin with a different council or committee meeting. Do not treat shared agenda vocabulary as proof that the target meeting has begun.",
    "Use direct meeting-identity evidence: its named call to order, an explicit handoff from the preceding meeting, or a sequence of the target canonical opening items beginning at an unnamed call to order.",
    "The recording may also start directly with the target meeting and contain no preceding or following meeting.",
    "When the recording starts with an unnamed opening followed by several target opening items in canonical order, target-specific named minutes or reports can corroborate the meeting identity even when the chair never says the formal meeting name or the exact words 'call to order'.",
    "In that case, choose the earliest welcome, time announcement, quorum statement, or other opening unit that begins the corroborated target sequence.",
    "When that unnamed canonical opening later explicitly hands off to a different named meeting, the target still starts at the earliest opening unit.",
    "Opening-sequence evidence must include multiple distinct canonical items such as attendance, land acknowledgement, declarations, minutes, bylaws, or news; one generic phrase is insufficient.",
    "Choose the exact call-to-order atomic unit when it is present. Copy a literal substring from that same unit.",
    "Return only {\"found\":true,\"atomic unit id\":\"atomic_000123\",\"evidence quote\":\"call to order this committee\",\"reason\":\"named target meeting begins\",\"confidence\":0.95}.",
    "Return {\"found\":false,\"atomic unit id\":\"\",\"evidence quote\":\"\",\"reason\":\"\",\"confidence\":0} when this window does not contain the target meeting start.",
    retryReason ? [
      "This is a bounded retry with a different adjudication instruction.",
      "If the first window begins with an unnamed welcome, time announcement, quorum/opening remark, or call-to-order phrase and the next distinct units match the target's canonical opening items, accept the earliest unit of that corroborated sequence.",
      "Do not require the formal meeting name to be spoken. Do not return found=false merely because the call-to-order phrase is split across adjacent atomic units; quote the literal text from the proposed anchor unit.",
      `The first opening units that must be adjudicated before any later declaration or agenda transition are:\n${String(window?.text || "").split(/\r?\n/u).slice(0, 8).join("\n")}`,
      "A later declaration, report introduction, or presenter handoff cannot be the meeting start when an earlier opening sequence is present.",
      `Previous rejection reason: ${retryReason}`,
    ].join("\n") : "",
    "Target canonical agenda:",
    agendaText(canonical?.items?.slice(0, 8) || []),
    `Transcript ${window?.["window id"] || ""}:`,
    transcriptWindowText,
  ].join("\n\n");
}

export async function locateCanonicalMeetingScopeStart({
  canonical,
  units,
  meetingLabel = "",
  llmModel = "qwen3.5:9b",
  ollamaUrl = "http://mriczo:11434/api/chat",
  log = () => {},
  scopeStartProvider = null,
  scopeStartIdentityProvider = null,
}) {
  const label = clean(meetingLabel);
  if (!label || !units.length) {
    return {
      "scope atomic start": units[0]?.["atomic unit id"] || "",
      "prefix atomic units": 0,
      "out of scope": false,
      reason: label ? "empty transcript" : "meeting identity unavailable",
      confidence: label ? 0 : 1,
    };
  }
  const windows = buildOverlappingWindows(units, {
    maxWords: Number(process.env.AGENDA_SCOPE_WINDOW_WORDS || 2800),
    overlapWords: Number(process.env.AGENDA_SCOPE_WINDOW_OVERLAP_WORDS || 500),
  });
  const unitIndex = new Map(units.map((unit, index) => [unit["atomic unit id"], index]));
  const canonicalAtomicId = (candidateId) => {
    const exact = clean(candidateId);
    if (unitIndex.has(exact)) return exact;
    const match = exact.match(/^atomic_0*(\d+)$/u);
    if (!match) return exact;
    const normalized = `atomic_${String(Number(match[1])).padStart(6, "0")}`;
    return unitIndex.has(normalized) ? normalized : exact;
  };
  for (const window of windows) {
    let retryReason = "";
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const parsed = scopeStartProvider
        ? await scopeStartProvider({ canonical, units, meetingLabel: label, window, attempt, retryReason })
        : await callOllamaJson({
          ollamaUrl,
          llmModel,
          system: attempt === 1
            ? "You locate the exact start of one municipal meeting inside a possibly combined recording. Return strict JSON only."
            : "You adjudicate a rejected municipal meeting-start decision against the complete chronology and authoritative canonical agenda. Return strict JSON only.",
          prompt: buildMeetingScopeStartPrompt({ canonical, meetingLabel: label, window, retryReason }),
          attempts: 3,
        });
      if (/^(1|true|yes)$/iu.test(String(process.env.AGENDA_BOUNDARY_DEBUG || ""))) {
        log(`[agenda-boundaries][debug] meeting scope ${window["window id"]} attempt=${attempt} response=${JSON.stringify(parsed).slice(0, 4000)}`);
      }
      if (parsed?.found !== true) {
        retryReason = clean(parsed?.reason) || "the previous pass returned found=false without adjudicating the complete opening sequence";
        continue;
      }
      let atomicId = canonicalAtomicId(parsed?.["atomic unit id"]);
      let index = unitIndex.get(atomicId);
      const evidenceQuote = clean(parsed?.["evidence quote"]);
      const confidence = Number(parsed?.confidence || 0);
      const reason = clean(parsed?.reason);
      let literal = Number.isInteger(index)
        && evidenceKey(evidenceQuote).length >= 8
        && evidenceKey(units[index].text).includes(evidenceKey(evidenceQuote));
      if (!literal && Number.isInteger(index) && evidenceKey(evidenceQuote).length >= 8) {
        const nearby = [];
        for (let candidateIndex = Math.max(0, index - 3); candidateIndex <= Math.min(units.length - 1, index + 3); candidateIndex += 1) {
          for (let spanLength = 1; spanLength <= 6 && candidateIndex + spanLength <= units.length; spanLength += 1) {
            const text = units.slice(candidateIndex, candidateIndex + spanLength).map((unit) => unit.text).join(" ");
            if (evidenceKey(text).includes(evidenceKey(evidenceQuote))) {
              nearby.push({ unit: units[candidateIndex], candidateIndex, spanLength });
            }
          }
        }
        nearby.sort((left, right) =>
          Math.abs(left.candidateIndex - index) - Math.abs(right.candidateIndex - index)
          || left.spanLength - right.spanLength
        );
        if (nearby.length) {
          atomicId = nearby[0].unit["atomic unit id"];
          index = nearby[0].candidateIndex;
          literal = true;
        }
      }
      if (!literal || confidence < Number(process.env.AGENDA_SCOPE_START_MIN_CONFIDENCE || 0.8) || confidence > 1 || !reason) {
        retryReason = `candidate ${atomicId || "(missing id)"} failed literal evidence, confidence, or reason validation`;
        log(`[agenda-boundaries] rejected ungrounded ${label} scope candidate ${atomicId || "(missing id)"}`);
        continue;
      }
      // Keep the independent identity audit anchored to the opening and its
      // immediate canonical sequence. A broad chronology window can contain
      // later mentions of another body and make Qwen mistake those references
      // for the meeting being opened.
      const identityContext = units.slice(Math.max(0, index - 5), Math.min(units.length, index + 24))
        .map((unit) => `[${unit["atomic unit id"]}] ${unit.speaker}: ${unit.text}`)
        .join("\n");
      const identityAudit = scopeStartIdentityProvider
        ? await scopeStartIdentityProvider({ canonical, units, meetingLabel: label, atomicId, index, identityContext })
        : scopeStartProvider
          ? { accepted: true, confidence: 1, reason: "injected scope provider" }
          : await callOllamaJson({
            ollamaUrl,
            llmModel,
            system: "You independently verify the named identity of a municipal meeting opening. Return strict JSON only.",
            prompt: [
              `Target meeting: ${label}`,
              `Proposed opening: ${atomicId}`,
              "Accept only if this unit begins the target meeting. Reject when the opening explicitly names a different live council or committee meeting, even if that other meeting uses overlapping item numbers or civic vocabulary.",
              "The target need not be named aloud: accept an unnamed opening when the immediate following units corroborate the target's canonical opening sequence. Do not reject a direct recording start merely because the formal meeting name is absent.",
              "A later reference to, report from, or minutes of the target body does not make an earlier different meeting the target meeting.",
              `Target opening agenda items: ${agendaText(canonical?.items?.slice(0, 8) || [])}`,
              "Return only {\"accepted\":true,\"confidence\":0.95,\"reason\":\"target identity is direct or corroborated by the opening sequence\"} or {\"accepted\":false,\"confidence\":0.95,\"reason\":\"different named meeting begins here\"}.",
              identityContext,
            ].join("\n\n"),
            attempts: 2,
          });
      if (identityAudit?.accepted !== true || Number(identityAudit?.confidence || 0) < 0.8) {
        retryReason = `candidate ${atomicId} failed independent meeting-identity audit: ${clean(identityAudit?.reason) || "target identity not established"}`;
        log(`[agenda-boundaries] rejected wrong-meeting ${label} scope candidate ${atomicId}`);
        continue;
      }
      log(`[agenda-boundaries] Qwen located ${label} scope at ${atomicId}; excluded ${index} preceding units`);
      return {
        "scope atomic start": atomicId,
        "prefix atomic units": index,
        "prefix atomic start": index ? units[0]["atomic unit id"] : "",
        "prefix atomic end": index ? units[index - 1]["atomic unit id"] : "",
        "out of scope": index > 0,
        reason,
        "evidence quote": evidenceQuote,
        confidence,
        "verification method": "qwen3.5:9b named-meeting scope discovery with literal evidence",
      };
    }
  }
  throw new Error(`agenda segmentation retryable: Qwen could not locate the start of ${label} in the combined recording`);
}

export function buildMeetingScopeEndPrompt({
  canonical,
  meetingLabel = "",
  window,
} = {}) {
  const label = clean(meetingLabel);
  return [
    `Locate the first atomic unit where the recording leaves the ${label} meeting and begins or hands off to a separate named meeting.`,
    "A combined municipal recording may continue immediately with another council or committee meeting.",
    "Require direct transition evidence: an explicit handoff to another named meeting, or that other meeting's own named call to order after the target meeting ends.",
    "Do not treat a canonical agenda heading, committee report, committee appointment, closed-session item, or minutes from another body as a separate live meeting.",
    "Return the first atomic unit belonging to the handoff or following meeting, not the last unit of the target meeting. Copy a literal substring from that same unit.",
    "Return only {\"found\":true,\"atomic unit id\":\"atomic_000123\",\"evidence quote\":\"we will now begin Committee of the Whole\",\"following meeting\":\"Committee of the Whole\",\"reason\":\"explicit handoff after target meeting\",\"confidence\":0.95}.",
    "Return {\"found\":false,\"atomic unit id\":\"\",\"evidence quote\":\"\",\"following meeting\":\"\",\"reason\":\"no separate following meeting in this window\",\"confidence\":0} when the window has no direct transition evidence.",
    "Target canonical agenda:",
    agendaText(canonical?.items || []),
    `Transcript ${window?.["window id"] || ""}:`,
    window?.text || "",
  ].join("\n\n");
}

export async function locateCanonicalMeetingScopeEnd({
  canonical,
  units,
  meetingLabel = "",
  llmModel = "qwen3.5:9b",
  ollamaUrl = "http://mriczo:11434/api/chat",
  log = () => {},
  scopeEndProvider = null,
}) {
  const label = clean(meetingLabel);
  if (!label || units.length < 2) {
    return {
      "scope atomic end": units.at(-1)?.["atomic unit id"] || "",
      "suffix atomic units": 0,
      "out of scope suffix": false,
      reason: label ? "target meeting occupies complete transcript" : "meeting identity unavailable",
      confidence: label ? 0 : 1,
    };
  }
  const windows = buildOverlappingWindows(units, {
    maxWords: Number(process.env.AGENDA_SCOPE_WINDOW_WORDS || 2800),
    overlapWords: Number(process.env.AGENDA_SCOPE_WINDOW_OVERLAP_WORDS || 500),
  });
  const unitIndex = new Map(units.map((unit, index) => [unit["atomic unit id"], index]));
  const canonicalAtomicId = (candidateId) => {
    const exact = clean(candidateId);
    if (unitIndex.has(exact)) return exact;
    const match = exact.match(/^atomic_0*(\d+)$/u);
    if (!match) return exact;
    const normalized = `atomic_${String(Number(match[1])).padStart(6, "0")}`;
    return unitIndex.has(normalized) ? normalized : exact;
  };
  for (const window of windows) {
    const parsed = scopeEndProvider
      ? await scopeEndProvider({ canonical, units, meetingLabel: label, window })
      : await callOllamaJson({
        ollamaUrl,
        llmModel,
        system: "You locate the exact end of one municipal meeting inside a possibly combined recording. Return strict JSON only.",
        prompt: buildMeetingScopeEndPrompt({ canonical, meetingLabel: label, window }),
        attempts: 3,
      });
    if (/^(1|true|yes)$/iu.test(String(process.env.AGENDA_BOUNDARY_DEBUG || ""))) {
      log(`[agenda-boundaries][debug] meeting scope end ${window["window id"]} response=${JSON.stringify(parsed).slice(0, 4000)}`);
    }
    if (parsed?.found !== true) continue;
    let atomicId = canonicalAtomicId(parsed?.["atomic unit id"]);
    let index = unitIndex.get(atomicId);
    const evidenceQuote = clean(parsed?.["evidence quote"]);
    const followingMeeting = clean(parsed?.["following meeting"]);
    const confidence = Number(parsed?.confidence || 0);
    const reason = clean(parsed?.reason);
    let literal = Number.isInteger(index)
      && evidenceKey(evidenceQuote).length >= 8
      && evidenceKey(units[index].text).includes(evidenceKey(evidenceQuote));
    if (!literal && Number.isInteger(index) && evidenceKey(evidenceQuote).length >= 8) {
      const nearby = [];
      for (let candidateIndex = Math.max(0, index - 3); candidateIndex <= Math.min(units.length - 1, index + 3); candidateIndex += 1) {
        for (let spanLength = 1; spanLength <= 6 && candidateIndex + spanLength <= units.length; spanLength += 1) {
          const text = units.slice(candidateIndex, candidateIndex + spanLength).map((unit) => unit.text).join(" ");
          if (evidenceKey(text).includes(evidenceKey(evidenceQuote))) {
            nearby.push({ unit: units[candidateIndex], candidateIndex, spanLength });
          }
        }
      }
      nearby.sort((left, right) =>
        Math.abs(left.candidateIndex - index) - Math.abs(right.candidateIndex - index)
        || left.spanLength - right.spanLength
      );
      if (nearby.length) {
        atomicId = nearby[0].unit["atomic unit id"];
        index = nearby[0].candidateIndex;
        literal = true;
      }
    }
    if (!literal
      || !Number.isInteger(index)
      || index < 1
      || confidence < Number(process.env.AGENDA_SCOPE_END_MIN_CONFIDENCE || 0.8)
      || confidence > 1
      || !followingMeeting
      || evidenceKey(followingMeeting) === evidenceKey(label)
      || !reason) {
      log(`[agenda-boundaries] rejected ungrounded ${label} scope-end candidate ${atomicId || "(missing id)"}`);
      continue;
    }
    log(`[agenda-boundaries] Qwen located the end of ${label} before ${atomicId}; excluded ${units.length - index} following units`);
    return {
      "scope atomic end": units[index - 1]["atomic unit id"],
      "following meeting atomic start": atomicId,
      "following meeting": followingMeeting,
      "suffix atomic units": units.length - index,
      "suffix atomic start": atomicId,
      "suffix atomic end": units.at(-1)["atomic unit id"],
      "out of scope suffix": true,
      reason,
      "evidence quote": evidenceQuote,
      confidence,
      "verification method": "qwen3.5:9b following-meeting scope discovery with literal evidence",
    };
  }
  log(`[agenda-boundaries] Qwen found no separate meeting after ${label} across the complete recording`);
  return {
    "scope atomic end": units.at(-1)["atomic unit id"],
    "suffix atomic units": 0,
    "out of scope suffix": false,
    reason: "no separate following meeting located across complete recording",
    confidence: 1,
    "verification method": "qwen3.5:9b complete-window following-meeting scope audit",
  };
}

async function collectWholeChronologyCandidates({ canonical, units, llmModel, ollamaUrl, log }) {
  let accepted = [];
  const seen = new Set();
  const chronologyWindows = buildOverlappingWindows(units, {
    maxWords: Number(process.env.AGENDA_CHRONOLOGY_WINDOW_WORDS || 2500),
    overlapWords: Number(process.env.AGENDA_CHRONOLOGY_WINDOW_OVERLAP_WORDS || 400),
  });
  let tailStart = units.length;
  let tailWords = 0;
  while (tailStart > 0 && tailWords < Number(process.env.AGENDA_CHRONOLOGY_TRAILING_WORDS || 1200)) {
    tailStart -= 1;
    tailWords += clean(units[tailStart]?.text).split(/\s+/u).filter(Boolean).length;
  }
  if (tailStart > (chronologyWindows.at(-1)?.["atomic start"] || 0)) {
    chronologyWindows.push({
      "window id": `window_${String(chronologyWindows.length + 1).padStart(4, "0")}`,
      "atomic start": tailStart,
      "atomic end": units.length - 1,
      "source words": tailWords,
      text: units.slice(tailStart).map((unit) => `[${unit["atomic unit id"]}] ${unit.speaker}: ${unit.text}`).join("\n"),
    });
  }
  for (let windowIndex = 0; windowIndex < chronologyWindows.length; windowIndex += 1) {
    const window = chronologyWindows[windowIndex];
    const windowUnits = units.slice(window["atomic start"], window["atomic end"] + 1);
    // A second independent pass over every window catches short transitions
    // (especially pulled consent items) that can be overshadowed by the longer
    // discussion on either side. Both passes remain Qwen/literal-evidence
    // grounded; this is not a text-pattern fallback.
    const passLimit = 2;
    for (let pass = 1; pass <= passLimit; pass += 1) {
      const acceptedBefore = accepted.length;
      const audit = pass === 1 ? "" : [
        "Audit this same chronology window for omitted executed transitions. Return only additional boundaries.",
        "Pay particular attention after each substantive report, after an empty procedural heading, and before notices or adjournment.",
        `Already accepted anywhere in the meeting: ${accepted.map((candidate) => `${candidate["agenda item"]}@${candidate["atomic unit id"]}`).join(", ")}`,
      ].join("\n");
      const parsed = await callOllamaJson({
        ollamaUrl,
        llmModel,
        system: "You segment municipal meeting chronology. Return only the required strict JSON transitions object, never a prose summary.",
        prompt: `${wholeChronologyPrompt(canonical, windowUnits)}\n\nThis is chronology window ${windowIndex + 1} of ${chronologyWindows.length}; locate every boundary inside it.${audit ? `\n\n${audit}` : ""}\n\nReturn only {"transitions":[...]}.`,
        attempts: 3,
      });
      if (/^(1|true|yes)$/iu.test(String(process.env.AGENDA_BOUNDARY_DEBUG || ""))) {
        log(`[agenda-boundaries][debug] chronology window ${windowIndex + 1} pass ${pass} response=${JSON.stringify(parsed).slice(0, 12000)}`);
      }
      for (const raw of Array.isArray(parsed?.transitions) ? parsed.transitions : []) {
        const candidate = alignEvidenceToAtomicUnit(
          resolveCandidateAgendaIdentity(normalizeCandidate(raw, `whole_chronology_${windowIndex + 1}_${pass}`), canonical),
          units,
        );
        const key = `${candidate["agenda item"]}|${candidate["atomic unit id"]}`;
        if (seen.has(key) || validateBoundaryCandidate(candidate, canonical, units) || candidate.confidence < 0.55) continue;
        seen.add(key);
        candidate["semantic verification"] = "qwen3.5:9b complete-chronology segmentation with literal evidence";
        if (windowIndex + 1 === chronologyWindows.length) candidate["trailing chronology audit"] = true;
        accepted.push(candidate);
      }
      if (pass > 1 && accepted.length === acceptedBefore) break;
    }
    log(`[agenda-boundaries] chronology window ${windowIndex + 1}/${chronologyWindows.length}: accepted=${accepted.length}`);
  }
  accepted.sort((a, b) => Number(a["atomic unit id"].slice(7)) - Number(b["atomic unit id"].slice(7)));
  log(`[agenda-boundaries] complete chronology accepted ${accepted.length} boundaries`);
  return accepted;
}

function normalizeCandidate(raw, windowId) {
  const rawAtomicId = clean(raw?.["atomic unit id"]);
  const atomicNumber = rawAtomicId.match(/^atomic_(\d+)$/u)?.[1];
  return {
    "agenda item": itemKey(raw?.["agenda item"]),
    "announced topic": clean(raw?.["announced topic"] || raw?.topic || raw?.description),
    "atomic unit id": atomicNumber ? `atomic_${String(Number(atomicNumber)).padStart(6, "0")}` : rawAtomicId,
    role: roleKey(raw?.role),
    "evidence quote": clean(raw?.["evidence quote"]),
    confidence: Number.isFinite(Number(raw?.confidence)) ? Number(raw.confidence) : 0.75,
    "agenda item raw": clean(raw?.["agenda item"]),
    "window id": windowId,
  };
}

export function validateBoundaryCandidate(candidate, canonical, units) {
  const canonicalSet = new Set(canonical.items.map((entry) => entry.item));
  if (!canonicalSet.has(candidate["agenda item"])) return "unknown agenda item";
  if (!ROLES.has(candidate.role)) return "unknown role";
  const index = units.findIndex((unit) => unit["atomic unit id"] === candidate["atomic unit id"]);
  if (index < 0) return "unknown atomic unit";
  if (!(candidate.confidence >= 0 && candidate.confidence <= 1)) return "invalid confidence";
  const quote = evidenceKey(candidate["evidence quote"]);
  if (quote.length < 8 || !evidenceKey(units[index].text).includes(quote)) return "evidence quote is not literal in atomic unit";
  return "";
}

export function resolveCandidateAgendaIdentity(candidate, canonical) {
  const canonicalSet = new Set(canonical.items.map((entry) => entry.item));
  if (canonicalSet.has(candidate["agenda item"])) return candidate;
  const raw = evidenceKey(candidate["agenda item raw"] || candidate["agenda item"]);
  const rawTokens = raw.split(" ").filter(Boolean);
  for (let end = Math.min(6, rawTokens.length); end >= 1; end -= 1) {
    const prefixCode = spokenAgendaItemKey(rawTokens.slice(0, end).join(" "));
    if (canonicalSet.has(prefixCode)) return { ...candidate, "agenda item": prefixCode };
  }
  const spokenCode = spokenAgendaItemKey(raw);
  const spokenMatch = canonical.items.find((entry) => entry.item === spokenCode);
  if (spokenMatch) return { ...candidate, "agenda item": spokenMatch.item };
  const match = canonical.items.find((entry) => {
    const title = evidenceKey(entry.title);
    return raw === title
      || raw === evidenceKey(`${entry.item} ${entry.title}`)
      || (raw.length >= 4 && title.split(" ").includes(raw))
      || (raw.length >= 6 && title.includes(raw));
  });
  return match ? { ...candidate, "agenda item": match.item } : candidate;
}

export function alignEvidenceToAtomicUnit(candidate, units) {
  const unitIndex = units.findIndex((entry) => entry["atomic unit id"] === candidate?.["atomic unit id"]);
  const unit = unitIndex >= 0 ? units[unitIndex] : null;
  if (!unit) return candidate;
  const unitText = clean(unit.text);
  const supplied = clean(candidate?.["evidence quote"]);
  const unitKey = evidenceKey(unitText);
  const suppliedKey = evidenceKey(supplied);
  // A transition phrase can be split into tiny ASR atomic units. Qwen often
  // names the final one (for example just "A.") while copying the complete
  // literal phrase across the preceding units. Rebind such evidence to the
  // first unit of the exact contiguous span.
  if (suppliedKey.length >= 8 && unitKey.length < 8 && !unitKey.includes(suppliedKey)) {
    const spans = [];
    for (let start = Math.max(0, unitIndex - 5); start <= unitIndex; start += 1) {
      for (let end = unitIndex + 1; end <= Math.min(units.length, start + 7); end += 1) {
        const spanText = units.slice(start, end).map((entry) => entry.text).join(" ");
        if (evidenceKey(spanText).includes(suppliedKey)) spans.push({ start, length: end - start });
      }
    }
    spans.sort((left, right) => left.start - right.start || left.length - right.length);
    if (spans.length && spans[0].start < unitIndex) {
      const first = units[spans[0].start];
      return { ...candidate, "atomic unit id": first["atomic unit id"], "evidence quote": first.text };
    }
  }
  // Qwen sometimes copies a literal phrase that continues across adjacent ASR
  // rows even though it correctly identifies the first atomic unit. Preserve
  // its chosen boundary but bind the audit quote to that exact named unit.
  if (unitKey.length >= 8 && suppliedKey.includes(unitKey)) {
    return { ...candidate, "evidence quote": unitText };
  }
  const unitTerms = unitKey.split(" ").filter(Boolean);
  const suppliedTerms = new Set(suppliedKey.split(" ").filter(Boolean));
  const sharedTerms = unitTerms.filter((term) => suppliedTerms.has(term)).length;
  if (unitTerms.length >= 3 && sharedTerms / unitTerms.length >= 0.7) {
    return { ...candidate, "evidence quote": unitText };
  }
  return candidate;
}

export async function verifyCandidateSemantics({
  proposed,
  canonical,
  units,
  llmModel,
  ollamaUrl,
  log,
  competingSelections = [],
}) {
  if (!proposed.length) return [];
  const indexById = new Map(units.map((unit, index) => [unit["atomic unit id"], index]));
  const accepted = [];
  for (const candidate of proposed) {
    const index = indexById.get(candidate["atomic unit id"]);
    // Agenda introductions often span several short ASR rows: the chair names
    // the item type first, then the presenter or report title. Keep the exact
    // proposed atomic unit as the boundary while giving the semantic verifier
    // enough adjacent chronology to identify the structured agenda owner.
    const context = units.slice(Math.max(0, index - 4), Math.min(units.length, index + 9));
    const testCase = {
      "atomic unit id": candidate["atomic unit id"],
      "proposed role": candidate.role,
      "evidence quote": candidate["evidence quote"],
      "canonical agenda": canonical.items.map((entry) => `${entry.item} ${entry.title}`),
      context: context.map((unit) => `[${unit["atomic unit id"]}] ${unit.speaker}: ${unit.text}`).join("\n"),
    };
    const parsed = await callOllamaJson({
      ollamaUrl,
      llmModel,
      system: "You classify one exact meeting agenda boundary. Return strict JSON only.",
      prompt: [
        `The proposed boundary is ${candidate["atomic unit id"]}. Classify the agenda item that begins exactly at that unit. The surrounding units are context only.`,
        "If the proposed unit is already inside an item, you may return that item's earlier true start. Never select an item that begins later than the proposed unit.",
        candidate["explicit revisit candidate"] === true
          ? `This is a possible explicit revisit after the earlier occurrence at ${candidate["prior occurrence atomic unit id"]}. If the chair returns to that item here, keep this later occurrence and do not collapse it to the first occurrence.`
          : "",
        "Choose from every canonical item supplied, or NONE. Do not answer a yes/no question and do not merely agree with the proposal.",
        "Use a chair announcement or the beginning of a presentation whose subject semantically matches the title, even if its code is omitted or misstated.",
        "A spoken report number or named subject may identify a child item more precisely than its parent category heading.",
        "Choose a different item when the context begins one with a similar title, such as a call versus its later discussion or motions previously given versus notices of motion.",
        "An explicit spoken item code for a different canonical item is decisive rejection evidence unless the chair explicitly says the printed code is wrong.",
        "Select the earliest atomic unit where the chosen item begins, including its chair transition. Reject a mere mention inside another item or a later detail after the item already began.",
        "Return only {\"agenda item\":\"8.a.1\",\"atomic unit id\":\"atomic_000123\",\"evidence quote\":\"complete literal text of that unit\",\"confidence\":0.95}. Use agenda item NONE and empty boundary fields when no canonical item begins here.",
        JSON.stringify(testCase),
      ].join("\n\n"),
      attempts: 2,
    });
    if (/^(1|true|yes)$/iu.test(String(process.env.AGENDA_BOUNDARY_DEBUG || ""))) {
      log(`[agenda-boundaries][debug] semantic ${candidate["agenda item"]}@${candidate["atomic unit id"]}=${JSON.stringify(parsed)}`);
    }
    const classified = alignEvidenceToAtomicUnit(resolveCandidateAgendaIdentity({
      ...candidate,
      "agenda item": itemKey(parsed?.["agenda item"]),
      "agenda item raw": clean(parsed?.["agenda item"]),
      "atomic unit id": clean(parsed?.["atomic unit id"]),
      "evidence quote": clean(parsed?.["evidence quote"]),
      confidence: Math.min(Number(candidate.confidence || 1), Number(parsed?.confidence || 0)),
    }, canonical), units);
    const classifiedIndex = indexById.get(classified["atomic unit id"]);
    const priorOccurrenceIndex = indexById.get(candidate["prior occurrence atomic unit id"]);
    const targetEntry = canonical.items.find((entry) => entry.item === candidate["agenda item"]);
    const movedEarlierWithoutDirectSupport = candidate["focused recovery candidate"] === true
      && targetEntry?.substantive === true
      && Number.isInteger(classifiedIndex)
      && classifiedIndex < index
      && !focusedRecoveryBoundaryHasDirectSupport(targetEntry, units[classifiedIndex]);
    const revisitPositionValid = candidate["explicit revisit candidate"] !== true
      || (Number.isInteger(priorOccurrenceIndex) && Number.isInteger(classifiedIndex) && classifiedIndex > priorOccurrenceIndex);
    if (!movedEarlierWithoutDirectSupport
      && canonicalIdentityOwnsTarget(classified["agenda item"], candidate["agenda item"], canonical)
      && Number.isInteger(classifiedIndex) && classifiedIndex <= index
      && revisitPositionValid
      && Number(classified.confidence || 0) >= 0.55
      && !validateBoundaryCandidate(classified, canonical, units)) {
      classified["agenda item"] = candidate["agenda item"];
      const entry = targetEntry;
      if (entry && await verifyTargetedRecovery({ candidate: classified, entry, units, llmModel, ollamaUrl })) {
        classified["semantic verification"] = "qwen3.5:9b independently classified and audited exact agenda identity and boundary";
        if (candidate["explicit revisit candidate"] === true) {
          classified["explicit revisit"] = true;
          classified["prior occurrence atomic unit id"] = candidate["prior occurrence atomic unit id"];
        }
        accepted.push(classified);
      }
    } else if (Number.isInteger(classifiedIndex)
      && classifiedIndex <= index
      && Number(classified.confidence || 0) >= 0.55
      && !validateBoundaryCandidate(classified, canonical, units)) {
      const target = canonical.items.find((entry) => entry.item === candidate["agenda item"]);
      const competing = canonical.items.find((entry) => entry.item === classified["agenda item"]);
      const transcriptSpan = context.map((unit) => unit.text).join(" ");
      if (target && competing
        && competingCanonicalIdentityHasDirectSupport({ target, competing, transcriptSpan })) {
        classified["semantic verification"] = "qwen3.5:9b blind classification selected a different canonical identity with direct title support";
        competingSelections.push({ originalCandidate: candidate, classified });
      }
    }
  }
  return accepted;
}

export async function auditWholeChronologyCandidates({
  candidates,
  canonical,
  units,
  llmModel,
  ollamaUrl,
  log = () => {},
}) {
  const source = Array.isArray(candidates) ? candidates : [];
  const chronologyCandidates = source.filter((candidate) =>
    /complete-chronology segmentation/u.test(candidate?.["semantic verification"] || "")
  );
  if (!chronologyCandidates.length) return source;
  const firstOccurrenceByItem = new Map();
  for (const candidate of chronologyCandidates) {
    const prior = firstOccurrenceByItem.get(candidate["agenda item"]);
    if (prior) {
      candidate["explicit revisit candidate"] = true;
      candidate["prior occurrence atomic unit id"] = prior["atomic unit id"];
    } else {
      firstOccurrenceByItem.set(candidate["agenda item"], candidate);
    }
  }
  const audited = await verifyCandidateSemantics({
    proposed: chronologyCandidates,
    canonical,
    units,
    llmModel,
    ollamaUrl,
    log,
  });
  const chronologySet = new Set(chronologyCandidates);
  const retained = source.filter((candidate) => !chronologySet.has(candidate));
  log(`[agenda-boundaries] independent blind audit retained ${audited.length}/${chronologyCandidates.length} complete-chronology candidates`);
  return [...retained, ...audited]
    .sort((a, b) => Number(a["atomic unit id"]?.slice(7) || 0) - Number(b["atomic unit id"]?.slice(7) || 0));
}

async function verifyTargetedRecovery({ candidate, entry, units, llmModel, ollamaUrl }) {
  const index = units.findIndex((unit) => unit["atomic unit id"] === candidate["atomic unit id"]);
  const context = units.slice(Math.max(0, index - 5), Math.min(units.length, index + 6));
  const parsed = await callOllamaJson({
    ollamaUrl,
    llmModel,
    system: "You audit one proposed municipal meeting transition. Return strict JSON only.",
    prompt: [
      `Canonical item ${entry.item}: ${entry.title}`,
      `Proposed boundary: ${candidate["atomic unit id"]} evidence=${JSON.stringify(candidate["evidence quote"])}`,
      "Does the proposed atomic unit, read with the immediately following ASR fragments, begin this exact agenda item?",
      "ASR can split one chair transition across several very short units. Accept when the proposed unit and the next few fragments collectively announce the item now, even if the proposed fragment alone is grammatically incomplete.",
      "Accept only a chair/new presenter introduction that starts the item now, or an explicit statement that this exact item is empty. Reject previews saying an item will happen later or in a minute, discussion inside the previous item, an ending/thank-you, a passing mention, or language merely related to the title.",
      "Reject a different explicitly spoken report code or title even when its subject is related to the canonical item.",
      "Return only {\"accepted\":true,\"confidence\":0.95} or {\"accepted\":false,\"confidence\":0.95}.",
      context.map((unit) => `[${unit["atomic unit id"]}] ${unit.speaker}: ${unit.text}`).join("\n"),
    ].join("\n\n"),
    attempts: 2,
  });
  return parsed?.accepted === true && Number(parsed?.confidence || 0) >= 0.7;
}

export async function refineFocusedRecoveryEarliest({
  candidate,
  entry,
  canonical = { items: [entry] },
  units,
  llmModel,
  ollamaUrl,
  boundaryVerifier = null,
}) {
  const indexById = new Map(units.map((unit, index) => [unit["atomic unit id"], index]));
  const proposedIndex = indexById.get(candidate?.["atomic unit id"]);
  if (!Number.isInteger(proposedIndex)) return candidate;
  let contextStart = proposedIndex;
  let words = 0;
  while (contextStart > 0 && words < 6000) {
    contextStart -= 1;
    words += clean(units[contextStart]?.text).split(/\s+/u).filter(Boolean).length;
  }
  const context = units.slice(contextStart, Math.min(units.length, proposedIndex + 9));
  const initialCompeting = directlySupportedCompetingIdentity({
    target: entry,
    canonical,
    transcriptSpan: units[proposedIndex]?.text || "",
  });
  let priorRejected = initialCompeting
    ? `${candidate["atomic unit id"]} directly names competing canonical item ${initialCompeting.item}: ${initialCompeting.title}; do not repeat it, and inspect the immediately following units for the target start`
    : "";
  let best = candidate;
  let bestValidatedIndex = null;
  let repeatedBest = 0;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const parsed = await callOllamaJson({
      ollamaUrl,
      llmModel,
      system: attempt === 1
        ? "You independently locate the earliest exact start of one municipal agenda item. Return strict JSON only."
        : "You correct a repeated late municipal agenda boundary using the complete preceding chronology. Return strict JSON only.",
      prompt: [
        `Canonical item ${entry.item}: ${entry.title}`,
        `Rejected or provisional boundary: ${candidate["atomic unit id"]}`,
        "Search the entire chronology below from the beginning. Return the earliest chair introduction, explicit item/report announcement, or first presenter sentence that starts this exact item.",
        "The chronology can contain several earlier named reports. Do not return the start of a different report merely because it is the first report in the supplied text.",
        "A chair saying next, another, one further report, or equivalent handoff together with the target subject is stronger start evidence than the later formal recommendation.",
        "The provisional boundary may be a later recommendation, statistic, question, answer, or detail inside the item. Do not repeat it when an earlier introduction exists.",
        attempt > 1
          ? "Exclude the recommendation wording and scan earlier for the chair's handoff to the next/further report or the presenter's first background sentence. The boundary must precede substantive background and recommendation details."
          : "",
        "Return only {\"agenda item\":\"ITEM\",\"atomic unit id\":\"atomic_000123\",\"evidence quote\":\"complete literal text of that unit\",\"confidence\":0.95}.",
        priorRejected ? `Previous audit repeated or failed validation: ${priorRejected}. Start the scan again from the first supplied unit.` : "",
        context.map((unit) => `[${unit["atomic unit id"]}] ${unit.speaker}: ${unit.text}`).join("\n"),
      ].filter(Boolean).join("\n\n"),
      attempts: 2,
    });
    const parsedAtomicRaw = clean(parsed?.["atomic unit id"]);
    const parsedAtomicNumber = parsedAtomicRaw.match(/^atomic_0*(\d+)$/u)?.[1];
    const parsedAtomicId = parsedAtomicNumber
      ? `atomic_${String(Number(parsedAtomicNumber)).padStart(6, "0")}`
      : parsedAtomicRaw;
    let refined = alignEvidenceToAtomicUnit(resolveCandidateAgendaIdentity({
      ...candidate,
      // This is a single-target boundary audit. Bind the identity from the
      // structured canonical agenda; the model is responsible only for finding
      // the boundary and may copy the JSON schema's ITEM placeholder literally.
      "agenda item": entry.item,
      "agenda item raw": clean(parsed?.["agenda item"]),
      "atomic unit id": parsedAtomicId,
      "evidence quote": clean(parsed?.["evidence quote"]),
      confidence: Math.min(Number(candidate.confidence || 1), Number(parsed?.confidence || 0)),
    }, { items: [entry] }), units);
    let refinedIndex = indexById.get(refined["atomic unit id"]);
    let semanticallyValid = false;
    if (refined["agenda item"] === entry.item) {
      if (boundaryVerifier) {
        semanticallyValid = await boundaryVerifier({ candidate: refined, entry, units });
      } else if (Number.isInteger(refinedIndex)
        && (refinedIndex < proposedIndex || initialCompeting)
        && (refinedIndex >= proposedIndex || focusedRecoveryBoundaryHasDirectSupport(entry, units[refinedIndex]))) {
        // The boundary itself still comes from Qwen. This literal structured-
        // title check only validates that an earlier proposed transition leads
        // directly into the target, avoiding a proposal-biased verifier that
        // can prefer a later interior fragment.
        semanticallyValid = true;
      } else {
        const blindVerified = await verifyCandidateSemantics({
          proposed: [refined],
          canonical,
          units,
          llmModel,
          ollamaUrl,
          log: () => {},
        });
        const audited = blindVerified.find((value) => value["agenda item"] === entry.item);
        if (audited) {
          refined = audited;
          refinedIndex = indexById.get(refined["atomic unit id"]);
          semanticallyValid = true;
        }
      }
    }
    if (semanticallyValid
      && Number.isInteger(refinedIndex)
      && refinedIndex <= proposedIndex + 8
      && Number(refined.confidence || 0) >= 0.55
      && !validateBoundaryCandidate(refined, { items: [entry] }, units)) {
      // Ownership belongs to the proposed atomic boundary itself. A broad
      // neighbourhood can contain the real target transition immediately after
      // an unrelated item and incorrectly neutralize that competing identity.
      const refinedContext = units[refinedIndex]?.text || "";
      const competing = directlySupportedCompetingIdentity({ target: entry, canonical, transcriptSpan: refinedContext });
      if (competing) {
        priorRejected = `${refined["atomic unit id"]} directly supports competing canonical item ${competing.item}: ${competing.title}`;
        continue;
      }
      if (refinedIndex < proposedIndex
        || (initialCompeting && refinedIndex > proposedIndex && refinedIndex <= proposedIndex + 8)) {
        if (!Number.isInteger(bestValidatedIndex) || refinedIndex < bestValidatedIndex) {
          best = refined;
          bestValidatedIndex = refinedIndex;
          repeatedBest = 0;
        } else if (refinedIndex === bestValidatedIndex) {
          repeatedBest += 1;
          if (repeatedBest >= 1) break;
        }
        priorRejected = `${refined["atomic unit id"]} is a valid provisional start; independently check whether the chair's lead-in begins this same item earlier`;
        continue;
      }
      priorRejected = `${refined["atomic unit id"]} did not move earlier than the provisional boundary`;
      continue;
    }
    priorRejected = JSON.stringify(parsed).slice(0, 1200);
  }
  return best;
}

async function promoteSingleChildCandidates({ candidates, canonical, units, llmModel, ollamaUrl, log }) {
  const out = [];
  for (const candidate of candidates) {
    const parent = canonical.items.find((entry) => entry.item === candidate["agenda item"]);
    const children = parent
      ? canonical.items.filter((entry) => entry.level === parent.level + 1 && entry.item.startsWith(`${parent.item}.`))
      : [];
    if (!parent || children.length !== 1) {
      out.push(candidate);
      continue;
    }
    const child = children[0];
    out.push({
      ...candidate,
      "agenda item": child.item,
      "announced topic": child.title,
      "sole child promotion": true,
      "semantic verification": `${candidate["semantic verification"] || "LLM chronology boundary"}; structured agenda sole-child ownership`,
    });
    log(`[agenda-boundaries] promoted parent ${parent.item} boundary to sole child ${child.item}`);
  }
  return out;
}

async function refineCandidateStarts({ candidates, canonical, units, llmModel, ollamaUrl, log }) {
  const indexById = new Map(units.map((unit, index) => [unit["atomic unit id"], index]));
  const refined = [];
  for (const candidate of candidates) {
    if (candidate["focused recovery refined"] === true) {
      refined.push(candidate);
      continue;
    }
    const candidateIndex = indexById.get(candidate["atomic unit id"]);
    const candidateUnit = Number.isInteger(candidateIndex) ? units[candidateIndex] : null;
    if (candidate["sole child promotion"] === true && Number.isInteger(candidateIndex)) {
      let contextStart = candidateIndex;
      let contextWords = 0;
      const maxWords = Number(process.env.AGENDA_SOLE_CHILD_REFINEMENT_WORDS || 3800);
      while (contextStart > 0 && contextWords < maxWords) {
        contextStart -= 1;
        contextWords += clean(units[contextStart]?.text).split(/\s+/u).filter(Boolean).length;
      }
      const target = canonical.items.find((entry) => entry.item === candidate["agenda item"]);
      const context = units.slice(contextStart, Math.min(units.length, candidateIndex + 6));
      const parsed = await callOllamaJson({
        ollamaUrl,
        llmModel,
        system: "You locate the earliest exact start of a named municipal agenda item. Return strict JSON only.",
        prompt: [
          `Locate the earliest start of ${target.item}: ${target.title}.`,
          "This child is the only item under its parent heading. Its true start may be the chair's earlier generic parent transition (for example, announcing the delegation) immediately before the named presenter or subject.",
          "Do not select a later detail, statistic, answer, or repetition from inside the presentation.",
          "Return only {\"agenda item\":\"ITEM\",\"atomic unit id\":\"atomic_000123\",\"evidence quote\":\"complete literal text of that exact unit\",\"confidence\":0.95}.",
          context.map((unit) => `[${unit["atomic unit id"]}] ${unit.speaker}: ${unit.text}`).join("\n"),
        ].join("\n\n"),
        attempts: 3,
      });
      const proposal = alignEvidenceToAtomicUnit(resolveCandidateAgendaIdentity({
        ...candidate,
        "agenda item": itemKey(parsed?.["agenda item"]),
        "agenda item raw": clean(parsed?.["agenda item"]),
        "atomic unit id": clean(parsed?.["atomic unit id"]),
        "evidence quote": clean(parsed?.["evidence quote"]),
        confidence: Math.min(Number(candidate.confidence || 1), Number(parsed?.confidence || 0)),
      }, canonical), units);
      const proposalIndex = indexById.get(proposal["atomic unit id"]);
      if (Number.isInteger(proposalIndex)
        && proposalIndex <= candidateIndex
        && canonicalIdentityOwnsTarget(proposal["agenda item"], candidate["agenda item"], canonical)
        && !validateBoundaryCandidate(proposal, canonical, units)) {
        proposal["agenda item"] = candidate["agenda item"];
        proposal["semantic verification"] = `${candidate["semantic verification"]}; Qwen earliest sole-child transition refinement`;
        if (proposal["atomic unit id"] !== candidate["atomic unit id"]) {
          log(`[agenda-boundaries] refined sole-child ${candidate["agenda item"]} start ${candidate["atomic unit id"]} -> ${proposal["atomic unit id"]}`);
        }
        refined.push(proposal);
        continue;
      }
    }
    if (/complete-chronology segmentation/u.test(candidate["semantic verification"] || "")
      && !candidateUnit?.["llm split source atomic unit"]
      && candidate["trailing chronology audit"] !== true) {
      const target = canonical.items.find((entry) => entry.item === candidate["agenda item"]);
      const parentPrefix = target?.item.includes(".") ? target.item.replace(/\.[^.]+$/u, "") : "";
      const hasCanonicalSibling = Boolean(parentPrefix) && canonical.items.some(
        (entry) => entry.item !== target.item && entry.item.replace(/\.[^.]+$/u, "") === parentPrefix,
      );
      if (target && hasCanonicalSibling && Number.isInteger(candidateIndex)) {
        const contextWordLimit = Math.max(800, Number(process.env.AGENDA_SIBLING_REFINEMENT_WORDS || 2600));
        let contextStart = candidateIndex;
        let contextEnd = candidateIndex + 1;
        let beforeWords = 0;
        let afterWords = 0;
        while (contextStart > 0 && beforeWords < contextWordLimit / 2) {
          contextStart -= 1;
          beforeWords += clean(units[contextStart]?.text).split(/\s+/u).filter(Boolean).length;
        }
        while (contextEnd < units.length && afterWords < contextWordLimit / 2) {
          afterWords += clean(units[contextEnd]?.text).split(/\s+/u).filter(Boolean).length;
          contextEnd += 1;
        }
        const parsed = await callOllamaJson({
          ollamaUrl,
          llmModel,
          system: "You refine the exact start of one canonical municipal agenda sibling. Return strict JSON only.",
          prompt: [
            `Locate the earliest exact start of ${target.item}: ${target.title}.`,
            "Consecutive sibling items remain separate even when the same presenter continues.",
            "Choose the chair's explicit item code, second-part/next-matter transition, or first sentence that changes to the named subject.",
            "Reject facts, questions, statistics, or funding details from inside the item, even when they match its subject.",
            "Return only {\"agenda item\":\"ITEM\",\"atomic unit id\":\"atomic_000123\",\"evidence quote\":\"complete literal text of that exact unit\",\"confidence\":0.95}.",
            units.slice(contextStart, contextEnd)
              .map((unit) => `[${unit["atomic unit id"]}] ${unit.speaker}: ${unit.text}`)
              .join("\n"),
          ].join("\n\n"),
          attempts: 3,
        });
        const proposal = alignEvidenceToAtomicUnit(resolveCandidateAgendaIdentity({
          ...candidate,
          "agenda item": itemKey(parsed?.["agenda item"]),
          "agenda item raw": clean(parsed?.["agenda item"]),
          "atomic unit id": clean(parsed?.["atomic unit id"]),
          "evidence quote": clean(parsed?.["evidence quote"]),
          confidence: Math.min(Number(candidate.confidence || 1), Number(parsed?.confidence || 0)),
        }, canonical), units);
        if (proposal["agenda item"] === target.item
          && !validateBoundaryCandidate(proposal, canonical, units)
          && await verifyTargetedRecovery({ candidate: proposal, entry: target, units, llmModel, ollamaUrl })) {
          proposal["semantic verification"] = `${candidate["semantic verification"]}; Qwen consecutive-sibling start refinement`;
          if (proposal["atomic unit id"] !== candidate["atomic unit id"]) {
            log(`[agenda-boundaries] refined sibling ${target.item} start ${candidate["atomic unit id"]} -> ${proposal["atomic unit id"]}`);
          }
          refined.push(proposal);
          continue;
        }
      }
      refined.push(candidate);
      continue;
    }
    if (candidateUnit?.["llm split source atomic unit"] || candidate["trailing chronology audit"] === true) {
      const parsed = await callOllamaJson({
        ollamaUrl,
        llmModel,
        system: "You classify one verbatim municipal transcript span against a structured agenda. Return strict JSON only.",
        prompt: [
          "Choose the one canonical agenda item whose executed discussion begins in this exact span, or NONE.",
          "Ignore headings explicitly described as having no matters, no motions, or no correspondence. Prefer the named substantive report or later executed business that actually follows.",
          "A revisited earlier item is allowed only when the span explicitly returns to it.",
          "Return only {\"agenda item\":\"11.a\",\"confidence\":0.95}.",
          "Canonical agenda:",
          agendaText(canonical.items),
          "Exact verbatim span:",
          candidateUnit.text,
        ].join("\n\n"),
        attempts: 3,
      });
      const classified = resolveCandidateAgendaIdentity({
        ...candidate,
        "agenda item": itemKey(parsed?.["agenda item"]),
        "agenda item raw": clean(parsed?.["agenda item"]),
      }, canonical);
      const classifiedIsCanonical = canonical.items.some((entry) => entry.item === classified["agenda item"]);
      const selectedItem = classifiedIsCanonical ? classified["agenda item"] : candidate["agenda item"];
      if (canonical.items.some((entry) => entry.item === selectedItem)
        && Number(classifiedIsCanonical ? parsed?.confidence : candidate.confidence || 0) >= 0.55) {
        const reclassified = {
          ...candidate,
          "agenda item": selectedItem,
          confidence: Math.min(Number(candidate.confidence || 1), Number(classifiedIsCanonical ? parsed.confidence : candidate.confidence || 1)),
          "semantic verification": "qwen3.5:9b classified verbatim oversized-row span",
        };
        const entry = canonical.items.find((item) => item.item === reclassified["agenda item"]);
        const ownershipAudit = entry ? await callOllamaJson({
          ollamaUrl,
          llmModel,
          system: "You adversarially validate structured agenda ownership of one transcript span. Return strict JSON only.",
          prompt: [
            `Claimed item ${entry.item}: ${entry.title}`,
            "Does this exact span directly announce or discuss that named subject? Reject generic transitions, unrelated reports, skipped headings, and merely adjacent business.",
            "Return only {\"supported\":true,\"confidence\":0.95} or {\"supported\":false,\"confidence\":0.95}.",
            candidateUnit.text,
          ].join("\n\n"),
          attempts: 3,
        }) : null;
        if (entry
          && structuredTitleHasLiteralSupport(entry.title, candidateUnit.text)
          && ownershipAudit?.supported === true
          && Number(ownershipAudit?.confidence || 0) >= 0.7
          && await verifyTargetedRecovery({ candidate: reclassified, entry, units, llmModel, ollamaUrl })) {
          refined.push(reclassified);
        }
      }
      continue;
    }
    const index = indexById.get(candidate["atomic unit id"]);
    if (!Number.isInteger(index)) {
      refined.push(candidate);
      continue;
    }
    let contextStart = index;
    let contextWords = 0;
    const refinementWordLimit = Math.max(400, Number(process.env.AGENDA_BOUNDARY_REFINEMENT_WORDS || 1400));
    while (contextStart > 0 && contextWords < refinementWordLimit) {
      contextStart -= 1;
      contextWords += clean(units[contextStart]?.text).split(/\s+/u).filter(Boolean).length;
    }
    const context = units.slice(contextStart, Math.min(units.length, index + 9));
    const allowFocusedForwardCorrection = candidate["focused recovery candidate"] === true;
    const parsed = await callOllamaJson({
      ollamaUrl,
      llmModel,
      system: "You refine one municipal agenda boundary to the earliest exact transcript unit. Return strict JSON only.",
      prompt: [
        `Boundary to classify: ${candidate["atomic unit id"]}`,
        `All canonical choices: ${canonical.items.map((entry) => `${entry.item} ${entry.title}`).join(" | ")}`,
        "Classify the boundary from the transcript and canonical choices alone. No proposed agenda identity is supplied because agreement bias would invalidate the audit.",
        allowFocusedForwardCorrection
          ? "The proposed recovery may land on the final unit of the previous item. You may move forward by at most 8 atomic units when the exact target introduction begins immediately after it."
          : "The surrounding units are context only. Never select an agenda item that begins later than the boundary being classified.",
        "Return the earliest atomic unit where the classified item begins, including the chair's introduction or transition. Do not choose a later detail, recommendation, answer, or discussion sentence.",
        "Do not choose the prior item's announcement. When one unit closes the prior item and announces this target, that combined unit begins the target.",
        "Return only {\"agenda item\":\"8.a.1\",\"atomic unit id\":\"atomic_000123\",\"evidence quote\":\"complete literal text of that exact unit\",\"confidence\":0.95}. Use agenda item NONE and empty boundary fields when no canonical item begins here.",
        context.map((unit) => `[${unit["atomic unit id"]}] ${unit.speaker}: ${unit.text}`).join("\n"),
      ].join("\n\n"),
      attempts: 2,
    });
    const proposal = alignEvidenceToAtomicUnit(resolveCandidateAgendaIdentity({
      ...candidate,
      "agenda item": itemKey(parsed?.["agenda item"]),
      "agenda item raw": clean(parsed?.["agenda item"]),
      "atomic unit id": clean(parsed?.["atomic unit id"]),
      "evidence quote": clean(parsed?.["evidence quote"]),
      confidence: Math.min(Number(candidate.confidence || 1), Number(parsed?.confidence || 0)),
    }, canonical), units);
    const proposalIndex = indexById.get(proposal["atomic unit id"]);
    const latestAllowedIndex = allowFocusedForwardCorrection ? Math.min(units.length - 1, index + 8) : index;
    if (!Number.isInteger(proposalIndex) || proposalIndex > latestAllowedIndex) {
      refined.push(candidate);
      continue;
    }
    if (!canonicalIdentityOwnsTarget(proposal["agenda item"], candidate["agenda item"], canonical)) {
      if (canonical.items.some((entry) => entry.item === proposal["agenda item"])) {
        const target = canonical.items.find((entry) => entry.item === candidate["agenda item"]);
        const competing = canonical.items.find((entry) => entry.item === proposal["agenda item"]);
        const identitySpan = [
          candidate["evidence quote"],
          proposal["evidence quote"],
          ...context.map((unit) => unit.text),
        ].filter(Boolean).join(" ");
        if (target && competing && competingCanonicalIdentityHasDirectSupport({ target, competing, transcriptSpan: identitySpan })) {
          proposal["semantic verification"] = "qwen3.5:9b blind classification selected a different canonical identity with direct title support";
          log(`[agenda-boundaries] reclassified ${candidate["agenda item"]} boundary as directly announced ${proposal["agenda item"]}`);
          refined.push(proposal);
          continue;
        }
        if (target && await verifyTargetedRecovery({ candidate, entry: target, units, llmModel, ollamaUrl })) {
          candidate["semantic verification"] = `${candidate["semantic verification"] || "qwen3.5:9b candidate"}; targeted audit resolved competing refinement`;
          refined.push(candidate);
          continue;
        }
        log(`[agenda-boundaries] rejected ${candidate["agenda item"]} boundary because qwen3.5:9b classified ${proposal["agenda item"]}`);
        continue;
      }
      refined.push(candidate);
      continue;
    }
    proposal["agenda item"] = candidate["agenda item"];
    const focusedTarget = canonical.items.find((entry) => entry.item === candidate["agenda item"]);
    if (allowFocusedForwardCorrection
      && focusedTarget?.substantive
      && !focusedRecoveryBoundaryHasDirectSupport(focusedTarget, units[proposalIndex])) {
      refined.push(candidate);
      continue;
    }
    if (!validateBoundaryCandidate(proposal, canonical, units)) {
      if (proposal["atomic unit id"] !== candidate["atomic unit id"]) {
        log(`[agenda-boundaries] refined ${candidate["agenda item"]} start ${candidate["atomic unit id"]} -> ${proposal["atomic unit id"]}`);
      }
      refined.push(proposal);
    } else {
      refined.push(candidate);
    }
  }
  return refined;
}

export function dedupeCandidatesByAgendaItem(candidates, canonical) {
  const selected = new Map();
  const explicitRevisits = [];
  const canonicalByItem = new Map(canonical.items.map((entry) => [entry.item, entry]));
  const score = (candidate) => (candidate["meeting scope boundary"] === true ? 300 : 0)
    + (candidate["sole child promotion"] === true ? 200 : 0)
    + (candidate["focused recovery refined"] === true ? 200 : 0)
    + (/complete-chronology segmentation/u.test(candidate["semantic verification"] || "") ? 100 : 0)
    + (structuredTitleHasLiteralSupport(
      canonicalByItem.get(candidate["agenda item"])?.title || "",
      candidate["evidence quote"] || "",
    ) ? 50 : 0)
    + (Number(candidate.confidence || 0) * 10)
    - (Number(candidate["atomic unit id"]?.slice(7) || 0) / 1_000_000);
  for (const candidate of candidates) {
    if (candidate["explicit revisit"] === true) {
      explicitRevisits.push(candidate);
      continue;
    }
    const current = selected.get(candidate["agenda item"]);
    if (!current || score(candidate) > score(current)) selected.set(candidate["agenda item"], candidate);
  }
  const seenBoundaries = new Set([...selected.values()].map((candidate) => `${candidate["agenda item"]}|${candidate["atomic unit id"]}`));
  return [...selected.values(), ...explicitRevisits.filter((candidate) => {
    const key = `${candidate["agenda item"]}|${candidate["atomic unit id"]}`;
    if (seenBoundaries.has(key)) return false;
    seenBoundaries.add(key);
    return true;
  })].sort((a, b) => Number(a["atomic unit id"].slice(7)) - Number(b["atomic unit id"].slice(7)));
}

export function pruneConflictingBoundaryCandidates(candidates, canonical) {
  const canonicalByItem = new Map(canonical.items.map((entry) => [entry.item, entry]));
  const byBoundary = new Map();
  for (const candidate of candidates) {
    const boundary = candidate["atomic unit id"];
    if (!byBoundary.has(boundary)) byBoundary.set(boundary, []);
    byBoundary.get(boundary).push(candidate);
  }
  const rejected = new Set();
  for (const group of byBoundary.values()) {
    if (group.length < 2) continue;
    const deepest = Math.max(...group.map((entry) => canonicalByItem.get(entry["agenda item"])?.level || 0));
    let owners = group.filter((entry) => (canonicalByItem.get(entry["agenda item"])?.level || 0) === deepest);
    const substantive = owners.filter((entry) => canonicalByItem.get(entry["agenda item"])?.substantive);
    if (substantive.length === 1) owners = substantive;
    if (owners.length > 1) {
      const ranked = owners.slice().sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0));
      if (Number(ranked[0].confidence || 0) - Number(ranked[1].confidence || 0) >= 0.1) owners = [ranked[0]];
    }
    if (owners.length > 1 && owners.every((entry) => !canonicalByItem.get(entry["agenda item"])?.substantive)) {
      for (const candidate of group) rejected.add(candidate);
      continue;
    }
    if (owners.length !== 1) continue;
    for (const candidate of group) if (candidate !== owners[0]) rejected.add(candidate);
  }
  return candidates.filter((candidate) => !rejected.has(candidate));
}

async function resolveCandidateBoundaryConflicts({ candidates, canonical, units, llmModel, ollamaUrl, log }) {
  const byBoundary = new Map();
  for (const candidate of candidates) {
    const boundary = candidate["atomic unit id"];
    if (!byBoundary.has(boundary)) byBoundary.set(boundary, []);
    byBoundary.get(boundary).push(candidate);
  }
  const indexById = new Map(units.map((unit, index) => [unit["atomic unit id"], index]));
  const output = [];
  for (const [boundary, group] of byBoundary) {
    const identities = [...new Set(group.map((entry) => entry["agenda item"]))];
    if (identities.length < 2) {
      output.push(...group);
      continue;
    }
    const index = indexById.get(boundary);
    const choices = canonical.items.filter((entry) => identities.includes(entry.item));
    const context = units.slice(Math.max(0, index - 5), Math.min(units.length, index + 8));
    const parsed = await callOllamaJson({
      ollamaUrl,
      llmModel,
      system: "You resolve competing municipal agenda ownership. Return strict JSON only.",
      prompt: [
        `Which one canonical item, if any, actually begins at ${boundary}?`,
        "Choose only from the listed candidates or NONE. The literal transcript decides ownership; attachment status and candidate confidence do not.",
        `Candidates: ${agendaText(choices)}`,
        "Return only {\"agenda item\":\"12\",\"confidence\":0.95}.",
        context.map((unit) => `[${unit["atomic unit id"]}] ${unit.speaker}: ${unit.text}`).join("\n"),
      ].join("\n\n"),
      attempts: 2,
    });
    const selected = resolveCandidateAgendaIdentity({
      "agenda item": itemKey(parsed?.["agenda item"]),
      "agenda item raw": clean(parsed?.["agenda item"]),
    }, canonical)["agenda item"];
    const owners = group.filter((entry) => entry["agenda item"] === selected);
    if (owners.length && Number(parsed?.confidence || 0) >= 0.55) {
      output.push(...owners);
      log(`[agenda-boundaries] qwen3.5:9b assigned shared ${boundary} boundary to ${selected}`);
    } else {
      log(`[agenda-boundaries] qwen3.5:9b rejected ambiguous shared ${boundary} boundary`);
    }
  }
  return output;
}

async function recoverMissingCanonicalCandidates({ candidates, canonical, units, windows, llmModel, ollamaUrl, log }) {
  const out = candidates.slice();
  // Focused recovery is a publish gate for attachment-backed substantive
  // items. Procedural/category headings may legitimately be silent, empty, or
  // containers; repeatedly asking the model to manufacture a boundary for
  // each missing heading creates agreement bias and false ownership.
  const hasOwnedCandidate = (entry) => out.some((candidate) => candidate["agenda item"] === entry.item
    || candidate["agenda item"].startsWith(`${entry.item}.`)
    || canonicalIdentityOwnsTarget(candidate["agenda item"], entry.item, canonical));
  const requiredChronologyHeading = (entry) => entry.level === 1 && (
    /^(?:public forum|by-?laws?|adjournment)$/iu.test(clean(entry.title))
  );
  const requiredHeadingEvidenceIsLiteral = (entry, candidate) => {
    const index = units.findIndex((unit) => unit["atomic unit id"] === candidate["atomic unit id"]);
    const context = units.slice(Math.max(0, index - 1), Math.min(units.length, index + 3))
      .map((unit) => clean(unit.text))
      .join(" ");
    if (/^public forum$/iu.test(clean(entry.title))) return /\bpublic forum\b/iu.test(context);
    if (/^by-?laws?$/iu.test(clean(entry.title))) return /\bby-?laws\b/iu.test(context);
    if (/^adjournment$/iu.test(clean(entry.title))) return /\badjourn(?:ed|ment|ing)?\b/iu.test(context);
    return true;
  };
  for (let index = out.length - 1; index >= 0; index -= 1) {
    const entry = canonical.items.find((item) => item.item === out[index]["agenda item"]);
    if (entry && requiredChronologyHeading(entry) && !requiredHeadingEvidenceIsLiteral(entry, out[index])) {
      out.splice(index, 1);
    }
  }
  const missing = canonical.items.filter(
    (entry) => (entry.substantive || requiredChronologyHeading(entry)) && !hasOwnedCandidate(entry),
  );
  if (/^(1|true|yes)$/iu.test(String(process.env.AGENDA_BOUNDARY_DEBUG || ""))) {
    log(`[agenda-boundaries][debug] focused missing items: ${missing.map((entry) => entry.item).join(", ")}`);
  }
  // Focused recovery needs enough surrounding chronology to connect a generic
  // chair introduction ("we have a deputation") with a presenter or report
  // title spoken a few rows later. The ordinary discovery windows remain
  // compact; recovery uses wider overlapping windows without omitting any part
  // of the meeting.
  const recoveryWindows = buildOverlappingWindows(units, {
    maxWords: Number(process.env.AGENDA_BOUNDARY_RECOVERY_WINDOW_WORDS || 1200),
    overlapWords: Number(process.env.AGENDA_BOUNDARY_RECOVERY_WINDOW_OVERLAP_WORDS || 200),
  });
  for (const entry of missing) {
    const entryIndex = canonical.items.findIndex((candidate) => candidate.item === entry.item);
    const entryTitleKey = evidenceKey(entry.title);
    const pairedCall = canonical.items.slice(0, entryIndex).find((candidate) => {
      const candidateTitle = evidenceKey(candidate.title);
      if (!candidateTitle.startsWith("call for ") || !entryTitleKey.startsWith("discussion of ")) return false;
      return candidateTitle.slice("call for ".length) === entryTitleKey.slice("discussion of ".length);
    });
    const indexByAtomic = new Map(units.map((unit, index) => [unit["atomic unit id"], index]));
    const candidatesByCanonicalDistance = (direction) => candidates
      .map((candidate) => ({ candidate, index: canonical.items.findIndex((item) => item.item === candidate["agenda item"]) }))
      .filter((value) => direction < 0 ? value.index < entryIndex : value.index > entryIndex)
      .sort((a, b) => direction < 0 ? b.index - a.index : a.index - b.index);
    const priorOptions = candidatesByCanonicalDistance(-1).map((value) => value.candidate);
    const nextOptions = candidatesByCanonicalDistance(1).map((value) => value.candidate);
    let priorAtomic;
    let nextAtomic;
    outer: for (const nextCandidate of nextOptions) {
      const candidateNextAtomic = indexByAtomic.get(nextCandidate?.["atomic unit id"]);
      if (!Number.isInteger(candidateNextAtomic)) continue;
      for (const priorCandidate of priorOptions) {
        const candidatePriorAtomic = indexByAtomic.get(priorCandidate?.["atomic unit id"]);
        if (Number.isInteger(candidatePriorAtomic) && candidateNextAtomic > candidatePriorAtomic) {
          priorAtomic = candidatePriorAtomic;
          nextAtomic = candidateNextAtomic;
          break outer;
        }
      }
    }
    const boundedWindows = Number.isInteger(priorAtomic) && Number.isInteger(nextAtomic) && nextAtomic > priorAtomic
      ? buildOverlappingWindows(units.slice(priorAtomic, nextAtomic + 1), { maxWords: 1200, overlapWords: 200 })
      : [];
    const windowsToSearch = boundedWindows.length
      ? [...boundedWindows, ...recoveryWindows]
      : recoveryWindows;
    for (const window of windowsToSearch.length ? windowsToSearch : windows) {
      const parsed = await callOllamaJson({
        ollamaUrl,
        llmModel,
        system: "You recover one exact substantive municipal agenda boundary. Return strict JSON only.",
        prompt: [
          `Locate the exact start of canonical agenda item ${entry.item}: ${entry.title} in this transcript window.`,
          "The item may be revisited out of canonical order. Accept a chair explicitly returning to the item or introducing its recommendation/report.",
          "A consecutive sibling item presented by the same person still begins at its explicit item code, second-part transition, next matter, or changed named subject; do not select a later detail from inside that item.",
          "A spoken numeric agenda code may be rendered as words or compact letters by ASR (for example, 'Eleven A', '11 A', or '8C1'); map that spoken code to the matching canonical item when the subject agrees.",
          "For a substantive child item, a generic parent/category heading is not its executable boundary; choose the unit that directly names the child code or a distinctive title term.",
          "When a generic parent heading is followed by a distinct child code, keep the heading as parent context and start the child at the later explicit code or title unit.",
          pairedCall ? `Do not select the earlier ${pairedCall.item}: ${pairedCall.title}. This target is the later discussion/execution after intervening agenda business.` : "",
          "Choose the earliest atomic unit in the transition, including a lead-in such as 'that allows us to move to', when the item name follows in the next few units.",
          "The evidence quote must be the complete literal text of the chosen atomic unit and contain at least three words.",
          "Return strict JSON {\"transitions\":[{\"agenda item\":\"ITEM CODE\",\"announced topic\":\"short topic\",\"atomic unit id\":\"atomic_000123\",\"role\":\"staff_report\",\"evidence quote\":\"short literal substring entirely within that exact atomic unit\",\"confidence\":0.95}]}. Return an empty array only if this exact item does not begin here.",
          `Allowed roles: ${[...ROLES].join(", ")}.`,
          window.text,
        ].join("\n\n"),
        attempts: 3,
      });
    const proposed = [];
    for (const raw of Array.isArray(parsed?.transitions) ? parsed.transitions : []) {
      const candidate = alignEvidenceToAtomicUnit(
        resolveCandidateAgendaIdentity(normalizeCandidate(raw, `substantive_${window["window id"]}`), canonical),
        units,
      );
      const validationError = validateBoundaryCandidate(candidate, canonical, units);
      const candidateIndex = units.findIndex((unit) => unit["atomic unit id"] === candidate["atomic unit id"]);
      let selectedCandidate = candidate;
      let directSupport = !entry.substantive || (Number.isInteger(candidateIndex)
        && focusedRecoveryBoundaryHasDirectSupport(entry, units[candidateIndex]));
      if (!validationError && candidate["agenda item"] === entry.item && !directSupport) {
        const repaired = await callOllamaJson({
          ollamaUrl,
          llmModel,
          system: "You repair one ambiguous substantive municipal agenda boundary. Return strict JSON only.",
          prompt: [
            `Canonical target agenda item: ${entry.item} — ${entry.title}.`,
            `Previous proposal: ${candidate["atomic unit id"]}, ${JSON.stringify(candidate["evidence quote"])}. This unit lacks direct support for the substantive child.`,
            "Inspect the adjacent transcript units and return the earliest unit that directly starts the target child.",
            "When a generic parent heading is followed by an explicit spoken child code or distinctive child title, keep the parent heading as context and choose the later child unit.",
            "Treat spoken numeric agenda codes such as Eleven A as the corresponding canonical code. Do not return the generic heading, a later discussion detail, or an unrelated sibling.",
            "Return only {\"agenda item\":\"ITEM\",\"atomic unit id\":\"atomic_000123\",\"evidence quote\":\"complete literal text of that unit\",\"confidence\":0.95}.",
            window.text,
          ].join("\n\n"),
          attempts: 3,
        });
        if (/^(1|true|yes)$/iu.test(String(process.env.AGENDA_BOUNDARY_DEBUG || ""))) {
          log(`[agenda-boundaries][debug] focused repair ${entry.item} proposal=${JSON.stringify(candidate)} response=${JSON.stringify(repaired)}`);
        }
        const repairedCandidate = alignEvidenceToAtomicUnit(
          resolveCandidateAgendaIdentity(normalizeCandidate({ ...candidate, ...repaired }, `focused_repair_${window["window id"]}`), canonical),
          units,
        );
        const repairedError = validateBoundaryCandidate(repairedCandidate, canonical, units);
        const repairedIndex = units.findIndex((unit) => unit["atomic unit id"] === repairedCandidate["atomic unit id"]);
        if (!repairedError
          && repairedCandidate["agenda item"] === entry.item
          && Number.isInteger(repairedIndex)
          && (!entry.substantive || focusedRecoveryBoundaryHasDirectSupport(entry, units[repairedIndex]))) {
          selectedCandidate = repairedCandidate;
          directSupport = true;
          log(`[agenda-boundaries] focused recovery repaired generic heading for ${entry.item}: ${candidate["atomic unit id"]} -> ${repairedCandidate["atomic unit id"]}`);
        }
      }
      if (!validationError && selectedCandidate["agenda item"] === entry.item && directSupport) {
        proposed.push({ ...selectedCandidate, "focused recovery candidate": true });
      }
      else if (/^(1|true|yes)$/iu.test(String(process.env.AGENDA_BOUNDARY_DEBUG || ""))) {
          log(`[agenda-boundaries][debug] focused ${entry.item} rejected ${JSON.stringify(selectedCandidate)}: ${validationError || (selectedCandidate["agenda item"] !== entry.item ? "wrong agenda identity" : "boundary lacks direct child support")}`);
      }
      }
      const competingSelections = [];
      let verified = await verifyCandidateSemantics({
        proposed,
        canonical,
        units,
        llmModel,
        ollamaUrl,
        log,
        competingSelections,
      });
      for (const selection of competingSelections) {
        const competing = selection.classified;
        if (!out.some((candidate) => candidate["agenda item"] === competing["agenda item"]
          && candidate["atomic unit id"] === competing["atomic unit id"])) {
          out.push(competing);
        }
      }
      if (!verified.length && proposed.length) {
        const independentlyAccepted = [];
        for (const candidate of proposed) {
          if (competingSelections.some((selection) => selection.originalCandidate === candidate)) continue;
          if (await verifyTargetedRecovery({ candidate, entry, units, llmModel, ollamaUrl })) {
            independentlyAccepted.push({
              ...candidate,
              "semantic verification": "qwen3.5:9b focused recovery with independent literal-boundary audit",
            });
          }
        }
        verified = independentlyAccepted;
      }
      if (requiredChronologyHeading(entry)) {
        verified = verified.filter((candidate) => requiredHeadingEvidenceIsLiteral(entry, candidate));
      }
      if (proposed.length && !verified.length && /^(1|true|yes)$/iu.test(String(process.env.AGENDA_BOUNDARY_DEBUG || ""))) {
        log(`[agenda-boundaries][debug] focused ${entry.item} semantic verifier rejected ${proposed.map((candidate) => candidate["atomic unit id"]).join(",")}`);
      }
      if (verified.length) {
        const refinedRecovery = await refineCandidateStarts({
          candidates: [{ ...verified[0], "focused recovery candidate": true }],
          canonical,
          units,
          llmModel,
          ollamaUrl,
          log,
        });
        let recovered = refinedRecovery.find((candidate) => candidate["agenda item"] === entry.item);
        for (const competing of refinedRecovery.filter((candidate) => candidate["agenda item"] !== entry.item)) {
          if (!out.some((candidate) => candidate["agenda item"] === competing["agenda item"]
            && candidate["atomic unit id"] === competing["atomic unit id"])) {
            out.push(competing);
          }
        }
        if (recovered) {
          recovered = await refineFocusedRecoveryEarliest({
            candidate: recovered,
            entry,
            canonical,
            units,
            llmModel,
            ollamaUrl,
          });
          if (entry.substantive) {
            const recoveredIndex = units.findIndex((unit) => unit["atomic unit id"] === recovered["atomic unit id"]);
            if (!focusedRecoveryBoundaryHasDirectSupport(entry, units[recoveredIndex])) {
              const directFallback = [...verified, ...proposed].find((candidate) => {
                const index = units.findIndex((unit) => unit["atomic unit id"] === candidate["atomic unit id"]);
                return focusedRecoveryBoundaryHasDirectSupport(entry, units[index]);
              });
              if (directFallback) {
                recovered = directFallback;
                log(`[agenda-boundaries] focused recovery restored direct child boundary for ${entry.item}: ${recovered["atomic unit id"]}`);
              } else {
                log(`[agenda-boundaries] focused recovery rejected generic boundary for ${entry.item}: ${recovered["atomic unit id"]}`);
                continue;
              }
            }
          }
          const recoveredIndex = units.findIndex((unit) => unit["atomic unit id"] === recovered["atomic unit id"]);
          const recoveredContext = Number.isInteger(recoveredIndex) && recoveredIndex >= 0
            ? units[recoveredIndex]?.text || ""
            : "";
          const directCompeting = directlySupportedCompetingIdentity({
            target: entry,
            canonical,
            transcriptSpan: recoveredContext,
          });
          if (directCompeting) {
            const reclassified = {
              ...recovered,
              "agenda item": directCompeting.item,
              "announced topic": directCompeting.title,
              "semantic verification": "structured title directly supports a competing blind identity",
            };
            if (!out.some((candidate) => candidate["agenda item"] === reclassified["agenda item"]
              && candidate["atomic unit id"] === reclassified["atomic unit id"])) {
              out.push(reclassified);
            }
            log(`[agenda-boundaries] focused recovery preserved direct competing identity: ${entry.item}->${directCompeting.item}@${recovered["atomic unit id"]}`);
            continue;
          }
          const competingOwner = out.find((candidate) =>
            candidate["atomic unit id"] === recovered["atomic unit id"]
            && candidate["agenda item"] !== recovered["agenda item"]
          );
          if (competingOwner) {
            log(
              `[agenda-boundaries] focused recovery rejected shared boundary: ${entry.item}@${recovered["atomic unit id"]} already belongs to ${competingOwner["agenda item"]}`,
            );
            continue;
          }
          out.push({ ...recovered, "focused recovery refined": true });
          log(`[agenda-boundaries] focused recovery found: ${entry.item}@${recovered["atomic unit id"]}`);
          break;
        }
        log(`[agenda-boundaries] focused recovery rejected after blind start refinement: ${entry.item}@${verified[0]["atomic unit id"]}`);
      }
    }
  }
  return out;
}

async function collectCandidates({ canonical, units, windows, llmModel, ollamaUrl, log }) {
  const candidates = await collectWholeChronologyCandidates({ canonical, units, llmModel, ollamaUrl, log });
  const rejected = [];
  const canonicalIndex = new Map(canonical.items.map((entry, index) => [entry.item, index]));
  const atomicIndex = new Map(units.map((unit, index) => [unit["atomic unit id"], index]));
  let agendaCursor = 0;
  // The overlapping chronology pass audits the complete meeting twice and
  // gap-checks its accepted boundaries. Canonical agenda items may be skipped
  // or silent even when they have attachments, so their absence must be
  // resolved by reconciliation rather than manufactured by focused recovery.
  if (candidates.length >= 2) return { candidates, rejected };
  const advanceContiguousCursor = (pool) => {
    const foundItems = new Set(pool.map((candidate) => candidate["agenda item"]));
    while (agendaCursor < canonical.items.length) {
      const current = canonical.items[agendaCursor].item;
      const hasExact = foundItems.has(current);
      const hasChild = canonical.items[agendaCursor].level === 1
        && [...foundItems].some((item) => item.startsWith(`${current}.`));
      if (!hasExact && !hasChild) break;
      agendaCursor += 1;
    }
  };
  for (let i = 0; i < windows.length; i += 1) {
    const window = windows[i];
    const windowAccepted = [];
    const seen = new Set();
    let retryReason = "";
    let emptyPasses = 0;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      // Meetings and recordings may begin after several procedural items, so
      // never restrict a window to the next contiguous agenda code. Give Qwen
      // every still-unmatched canonical identity and let transcript evidence
      // determine which item, if any, actually begins here.
      const targetItems = canonical.items
        .filter((entry) => !candidates.some((candidate) => candidate["agenda item"] === entry.item))
        .filter((entry) => !windowAccepted.some((candidate) => candidate["agenda item"] === entry.item));
      if (!targetItems.length) break;
      const parsed = await callOllamaJson({
        ollamaUrl,
        llmModel,
        system: "You ground meeting transcript boundaries. Return strict JSON only.",
        prompt: candidatePrompt(targetItems, window, windowAccepted, retryReason),
      });
      const transitions = Array.isArray(parsed?.transitions) ? parsed.transitions : [];
      if (/^(1|true|yes)$/iu.test(String(process.env.AGENDA_BOUNDARY_DEBUG || ""))) {
        log(`[agenda-boundaries][debug] ${window["window id"]} response=${JSON.stringify(parsed).slice(0, 4000)}`);
      }
      if (!Object.hasOwn(parsed || {}, "transitions")) {
        retryReason = `response omitted the required transitions array (returned keys: ${Object.keys(parsed || {}).join(", ") || "none"})`;
        if (attempt === 3) rejected.push({ "window id": window["window id"], reason: retryReason });
        continue;
      }
      const windowRejected = [];
      const proposed = [];
      for (const raw of transitions) {
        const candidate = alignEvidenceToAtomicUnit(
          resolveCandidateAgendaIdentity(normalizeCandidate(raw, window["window id"]), canonical),
          units,
        );
        const error = validateBoundaryCandidate(candidate, canonical, units);
        if (error) windowRejected.push({ ...candidate, reason: error });
        else if (candidate.confidence < 0.45) windowRejected.push({ ...candidate, reason: "candidate confidence below 0.45" });
        else proposed.push(candidate);
      }
      const semanticallyVerified = await verifyCandidateSemantics({ proposed, canonical, units, llmModel, ollamaUrl, log });
      let added = 0;
      for (const candidate of semanticallyVerified) {
          const key = `${candidate["agenda item"]}|${candidate["atomic unit id"]}`;
          if (!seen.has(key)) {
            seen.add(key);
            windowAccepted.push(candidate);
            added += 1;
          }
      }
      for (const candidate of proposed) {
        if (!semanticallyVerified.includes(candidate)) windowRejected.push({ ...candidate, reason: "semantic verifier rejected agenda identity or boundary" });
      }
      advanceContiguousCursor([...candidates, ...windowAccepted]);
      if (windowRejected.length && attempt === 3) rejected.push(...windowRejected);
      retryReason = windowRejected.length
        ? `${[...new Set(windowRejected.map((entry) => entry.reason))].join(", ")}. Re-scan and copy exact evidence.`
        : (added ? "Find any remaining transitions; do not repeat accepted ones." : "An empty pass may have missed a brief transition. Re-scan once more.");
      if (added || windowRejected.length) emptyPasses = 0;
      else emptyPasses += 1;
      if (emptyPasses >= 2) break;
    }
    candidates.push(...windowAccepted);
    const highestInWindow = windowAccepted.reduce((highest, candidate) => Math.max(highest, Number(canonicalIndex.get(candidate["agenda item"]) ?? -1) + 1), agendaCursor);
    agendaCursor = Math.max(agendaCursor, highestInWindow);
    log(`[agenda-boundaries] candidate window ${i + 1}/${windows.length}: accepted=${candidates.length} items=${[...new Set(candidates.map((entry) => entry["agenda item"]))].join(",")} rejected=${rejected.length}`);
  }

  const foundItems = new Set(candidates.map((candidate) => candidate["agenda item"]));
  const candidateAtomicIndex = (candidate) => atomicIndex.get(candidate["atomic unit id"]);
  for (let missingIndex = 0; missingIndex < canonical.items.length; missingIndex += 1) {
    const entry = canonical.items[missingIndex];
    if (foundItems.has(entry.item)) continue;
    const parent = entry.item.includes(".") ? entry.item.split(".").slice(0, -1).join(".") : "";
    const siblingCount = parent ? canonical.items.filter((other) => other.item.startsWith(`${parent}.`) && other.level === entry.level).length : 0;
    if (parent && foundItems.has(parent) && siblingCount > 1) continue;
    const prior = candidates
      .filter((candidate) => Number(canonicalIndex.get(candidate["agenda item"])) < missingIndex)
      .sort((a, b) => candidateAtomicIndex(b) - candidateAtomicIndex(a))[0];
    const next = candidates
      .filter((candidate) => Number(canonicalIndex.get(candidate["agenda item"])) > missingIndex)
      .sort((a, b) => candidateAtomicIndex(a) - candidateAtomicIndex(b))[0];
    // Without candidates on both sides there is no bounded recovery range;
    // reconciliation can correctly classify leading/trailing items as
    // skipped, empty, or containers without forcing a boundary.
    if (!prior || !next) continue;
    const startAtomic = prior ? candidateAtomicIndex(prior) : 0;
    const endAtomic = next ? candidateAtomicIndex(next) : units.length - 1;
    if (!(endAtomic > startAtomic)) continue;
    // Recovery is already bounded by verified neighbouring agenda items. Use
    // a wider Qwen context so a brief transition is found in a handful of
    // semantic passes instead of hundreds of tiny sequential requests.
    const recoveryWindows = buildOverlappingWindows(units.slice(startAtomic, endAtomic + 1), { maxWords: 1200, overlapWords: 200 });
    let recovered = null;
    for (const recoveryWindow of recoveryWindows) {
      const parsed = await callOllamaJson({
        ollamaUrl,
        llmModel,
        system: "You locate one exact municipal agenda boundary. Return strict JSON only.",
        prompt: [
          `Locate canonical agenda item ${entry.item}: ${entry.title} in this transcript window.`,
          "The title may be paraphrased or its spoken item code may be misrecognized by ASR.",
          "Return strict JSON {\"transitions\":[{\"agenda item\":\"ITEM CODE\",\"announced topic\":\"short topic\",\"atomic unit id\":\"atomic_000123\",\"role\":\"staff_report\",\"evidence quote\":\"short literal substring from that exact unit\",\"confidence\":0.95}]}. Return an empty array only if this exact item does not begin here.",
          `Allowed roles: ${[...ROLES].join(", ")}.`,
          recoveryWindow.text,
        ].join("\n\n"),
        attempts: 2,
      });
      const proposed = [];
      for (const raw of Array.isArray(parsed?.transitions) ? parsed.transitions : []) {
        const candidate = alignEvidenceToAtomicUnit(
          resolveCandidateAgendaIdentity(normalizeCandidate(raw, `recovery_${entry.item}`), canonical),
          units,
        );
        if (!validateBoundaryCandidate(candidate, canonical, units) && candidate["agenda item"] === entry.item) proposed.push(candidate);
      }
      recovered = null;
      for (const candidate of proposed) {
        if (await verifyTargetedRecovery({ candidate, entry, units, llmModel, ollamaUrl })) {
          recovered = candidate;
          break;
        }
      }
      if (recovered) recovered["semantic verification"] = "qwen3.5:9b targeted exact-item recovery; pending reconciliation";
      if (recovered) break;
    }
    if (recovered) {
      candidates.push(recovered);
      foundItems.add(entry.item);
      log(`[agenda-boundaries] recovered missing item ${entry.item} at ${recovered["atomic unit id"]}`);
    }
  }
  candidates.sort((a, b) => candidateAtomicIndex(a) - candidateAtomicIndex(b));
  return { candidates, rejected };
}

function compactCandidateText(candidates) {
  return candidates.map((c) => JSON.stringify(c)).join("\n");
}

function reconciliationPrompt(canonical, candidates, units) {
  const candidateIds = new Set(candidates.map((c) => c["atomic unit id"]));
  const candidateIndexes = new Set(units.map((unit, index) => candidateIds.has(unit["atomic unit id"]) ? index : -1).filter((index) => index >= 0));
  const evidenceUnits = units.filter((u, index) => [...candidateIndexes].some((candidateIndex) => Math.abs(candidateIndex - index) <= 3));
  return [
    "Reconcile boundary candidates into the complete canonical meeting timeline.",
    "Return exactly one disposition for every canonical agenda item, in canonical order.",
    "Statuses: executed or empty require a supported atomic unit, role, literal evidence quote, and confidence; skipped and container must use empty strings and confidence 0.",
    "Use container for a parent heading when a child owns the actual discussion. Use skipped only when the meeting did not reach an item. Use empty when the chair explicitly says the item has no business.",
    "Do not invent missing boundaries, increment item numbers, interpolate positions, or absorb one item into an adjacent item.",
    "For every executed or empty disposition, copy the atomic unit id, role, evidence quote, and confidence from one validated candidate for that same item exactly. The validated candidate record is authoritative for the boundary.",
    "Named evidence units are context only. They cannot replace a validated candidate, provide a different boundary, or supply a different evidence quote.",
    candidates.length
      ? "Executed/empty dispositions may use only the validated candidates listed below."
      : "There are no validated candidates for this item. You MUST return status skipped or container with empty atomic unit id, role, evidence quote, and confidence 0; never invent a boundary.",
    "Return JSON: {\"items\":[{\"agenda item\":\"7.a\",\"status\":\"executed\",\"atomic unit id\":\"atomic_000123\",\"role\":\"deputation\",\"evidence quote\":\"literal quote\",\"confidence\":0.95}]}",
    "Canonical agenda:",
    agendaText(canonical.items),
    "Validated candidate records (the only allowed executable boundaries):",
    compactCandidateText(candidates),
    "Named evidence units:",
    evidenceUnits.map((u) => `[${u["atomic unit id"]}] ${u.speaker}: ${u.text}`).join("\n"),
  ].join("\n\n");
}

export function normalizeDisposition(raw) {
  const status = clean(raw?.status).toLowerCase();
  const role = roleKey(raw?.role) || ((status === "executed" || status === "empty") ? "other" : "");
  const rawAtomicId = clean(raw?.["atomic unit id"]);
  const atomicNumber = rawAtomicId.match(/^atomic_0*(\d+)$/u)?.[1];
  const disposition = {
    "agenda item": itemKey(raw?.["agenda item"]),
    status,
    "atomic unit id": atomicNumber ? `atomic_${String(Number(atomicNumber)).padStart(6, "0")}` : rawAtomicId,
    role,
    "evidence quote": clean(raw?.["evidence quote"]),
    confidence: Number(raw?.confidence || 0),
  };
  if (status === "skipped" || status === "container") {
    disposition["atomic unit id"] = "";
    disposition.role = "";
    disposition["evidence quote"] = "";
    disposition.confidence = 0;
  }
  return disposition;
}

function validateDispositionBatch(dispositions, expectedItems, units, validatedCandidates = []) {
  if (dispositions.length !== expectedItems.length) return `returned ${dispositions.length} items; expected ${expectedItems.length}`;
  const unitById = new Map(units.map((unit) => [unit["atomic unit id"], unit]));
  const candidatesByItem = new Map();
  for (const candidate of validatedCandidates) {
    const item = candidate?.["agenda item"];
    if (!item) continue;
    const list = candidatesByItem.get(item) || [];
    list.push(candidate);
    candidatesByItem.set(item, list);
  }
  for (let i = 0; i < expectedItems.length; i += 1) {
    const disposition = dispositions[i];
    if (disposition["agenda item"] !== expectedItems[i].item) return `identity mismatch at ${i}: expected ${expectedItems[i].item}`;
    if (!STATUSES.has(disposition.status)) return `invalid status for ${expectedItems[i].item}`;
    const hasBoundary = disposition.status === "executed" || disposition.status === "empty";
    if (!hasBoundary) continue;
    if (!disposition["atomic unit id"]) {
      return `${disposition.status} status for ${expectedItems[i].item} omitted required boundary data`;
    }
    const allowedCandidates = candidatesByItem.get(expectedItems[i].item) || [];
    if (!allowedCandidates.length) return `executable status for ${expectedItems[i].item} has no validated candidate`;
    if (!allowedCandidates.some((candidate) => candidate["atomic unit id"] === disposition["atomic unit id"])) {
      return `boundary for ${expectedItems[i].item} is not in the validated candidate set`;
    }
    if (!ROLES.has(disposition.role)) return `invalid role for ${expectedItems[i].item}`;
    const unit = unitById.get(disposition["atomic unit id"]);
    if (!unit) return `unknown atomic unit for ${expectedItems[i].item}`;
    Object.assign(disposition, alignEvidenceToAtomicUnit(disposition, units));
    const quote = evidenceKey(disposition["evidence quote"]);
    if (quote.length < 8 || !evidenceKey(unit.text).includes(quote)) return `non-literal evidence for ${expectedItems[i].item}`;
    if (!(disposition.confidence >= 0.55 && disposition.confidence <= 1)) return `low confidence for ${expectedItems[i].item}`;
  }
  return "";
}

export async function reconcileTimelineInBatches({ canonical, candidates, units, llmModel, ollamaUrl, log }) {
  const output = [];
  const batchSize = 1;
  for (let start = 0; start < canonical.items.length; start += batchSize) {
    const items = canonical.items.slice(start, start + batchSize);
    const itemSet = new Set(items.map((item) => item.item));
    const relevant = candidates.filter((candidate) => itemSet.has(candidate["agenda item"]));
    let lastError = "";
    let rejectedResponse = "";
    let accepted = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const retryInstruction = lastError ? [
        `Previous response failed validation: ${lastError}.`,
        `Rejected response: ${rejectedResponse}`,
        "Empty is boundary-bearing: status empty means the chair explicitly said the item had no business, and it still requires an exact validated candidate atomic unit id, role, literal evidence quote, and confidence.",
        "Only skipped or container may have blank boundary fields. If the item was discussed or received, use executed with an exact validated candidate.",
        `Return all ${items.length} items in exact order and do not repeat the rejected shape.`,
      ].join("\n") : "";
      const parsed = await callOllamaJson({
        ollamaUrl,
        llmModel,
        system: attempt === 1
          ? "You reconcile an evidence-grounded meeting timeline. Return strict JSON only."
          : "You repair a rejected evidence-grounded meeting disposition against the complete output contract. Return strict JSON only.",
        prompt: `${reconciliationPrompt({ items }, relevant, units)}${retryInstruction ? `\n\n${retryInstruction}` : ""}`,
        attempts: 2,
      });
      if (/^(1|true|yes)$/iu.test(String(process.env.AGENDA_BOUNDARY_DEBUG || ""))) {
        log(`[agenda-boundaries][debug] reconciliation batch ${Math.floor(start / batchSize) + 1} attempt ${attempt} response=${JSON.stringify(parsed).slice(0, 4000)}`);
      }
      const dispositions = (Array.isArray(parsed?.items) ? parsed.items : []).map(normalizeDisposition);
      if (items.length === 1 && dispositions.length === 1) dispositions[0]["agenda item"] = items[0].item;
      lastError = validateDispositionBatch(dispositions, items, units, relevant);
      rejectedResponse = JSON.stringify(parsed);
      if (!lastError) {
        accepted = dispositions;
        break;
      }
      log(`[agenda-boundaries] reconciliation batch ${Math.floor(start / batchSize) + 1} attempt ${attempt} rejected: ${lastError}`);
    }
    if (!accepted) throw new Error(`agenda segmentation retryable: reconciliation batch failed: ${lastError}`);
    output.push(...accepted);
  }
  return output;
}

export function validateReconciledTimeline(dispositions, canonical, units, options = {}) {
  if (!Array.isArray(dispositions) || dispositions.length !== canonical.items.length) {
    throw new Error(`agenda segmentation retryable: reconciliation returned ${dispositions?.length || 0} items; expected ${canonical.items.length}`);
  }
  const usedBoundaries = new Set();
  const unitIndex = new Map(units.map((unit, index) => [unit["atomic unit id"], index]));
  for (let i = 0; i < canonical.items.length; i += 1) {
    const disposition = dispositions[i];
    const expected = canonical.items[i].item;
    if (disposition["agenda item"] !== expected) throw new Error(`agenda segmentation retryable: reconciliation identity mismatch at ${i}: expected ${expected}`);
    if (!STATUSES.has(disposition.status)) throw new Error(`agenda segmentation retryable: invalid status for ${expected}`);
    const hasBoundary = disposition.status === "executed" || disposition.status === "empty";
    if (!hasBoundary) {
      if (disposition["atomic unit id"] || disposition["evidence quote"] || disposition.role || disposition.confidence) {
        throw new Error(`agenda segmentation retryable: ${expected} ${disposition.status} item contains fabricated boundary data`);
      }
      continue;
    }
    if (!ROLES.has(disposition.role)) throw new Error(`agenda segmentation retryable: invalid role for ${expected}`);
    const index = unitIndex.get(disposition["atomic unit id"]);
    if (!Number.isInteger(index)) throw new Error(`agenda segmentation retryable: unknown boundary unit for ${expected}`);
    if (usedBoundaries.has(index)) throw new Error(`agenda segmentation retryable: overlapping boundary for ${expected}`);
    usedBoundaries.add(index);
    Object.assign(disposition, alignEvidenceToAtomicUnit(disposition, units));
    const quote = evidenceKey(disposition["evidence quote"]);
    if (quote.length < 8 || !evidenceKey(units[index].text).includes(quote)) {
      throw new Error(`agenda segmentation retryable: non-literal boundary evidence for ${expected}`);
    }
    const minimum = Number(options.minimumConfidence ?? process.env.AGENDA_BOUNDARY_MIN_CONFIDENCE ?? 0.55);
    if (!Number.isFinite(disposition.confidence) || disposition.confidence < minimum || disposition.confidence > 1) {
      throw new Error(`agenda segmentation retryable: low-confidence boundary for ${expected}`);
    }
  }
  const boundaries = dispositions
    .filter((item) => item.status === "executed" || item.status === "empty")
    .sort((a, b) => Number(unitIndex.get(a["atomic unit id"])) - Number(unitIndex.get(b["atomic unit id"])));
  if (!boundaries.length) throw new Error("agenda segmentation retryable: reconciliation has no executed boundaries");
  if (boundaries.length === 1 && canonical.items.length > 1 && units.length > 1) {
    const onlyIndex = unitIndex.get(boundaries[0]["atomic unit id"]);
    const coveredFraction = (units.length - onlyIndex) / units.length;
    const durationSeconds = Number(units.at(-1)?.until || 0) - Number(units[0]?.since || 0);
    if (coveredFraction >= 0.9 && durationSeconds >= 600) {
      throw new Error("agenda segmentation retryable: one boundary would absorb nearly the entire substantive meeting chronology");
    }
  }
  return boundaries;
}

export function resolveSharedBoundaryOwnership(dispositions, canonical) {
  const canonicalByItem = new Map(canonical.items.map((item) => [item.item, item]));
  const byBoundary = new Map();
  for (const disposition of dispositions) {
    if (!["executed", "empty"].includes(disposition.status)) continue;
    const boundary = disposition["atomic unit id"];
    if (!byBoundary.has(boundary)) byBoundary.set(boundary, []);
    byBoundary.get(boundary).push(disposition);
  }
  for (const group of byBoundary.values()) {
    if (group.length < 2) continue;
    const deepest = Math.max(...group.map((entry) => canonicalByItem.get(entry["agenda item"])?.level || 0));
    const childOwners = group.filter((entry) => (canonicalByItem.get(entry["agenda item"])?.level || 0) === deepest);
    const substantiveOwners = childOwners.filter((entry) => canonicalByItem.get(entry["agenda item"])?.substantive);
    const owners = substantiveOwners.length === 1 ? substantiveOwners : childOwners;
    if (owners.length !== 1) {
      throw new Error(`agenda segmentation retryable: ambiguous shared boundary for ${group.map((entry) => entry["agenda item"]).join(", ")}`);
    }
    for (const entry of group) {
      if (entry === owners[0]) continue;
      entry.status = "container";
      entry["atomic unit id"] = "";
      entry.role = "";
      entry["evidence quote"] = "";
      entry.confidence = 0;
    }
  }
  return dispositions;
}

export function resolveCanonicalHierarchyOwnership(dispositions) {
  const executedItems = dispositions
    .filter((entry) => ["executed", "empty"].includes(entry.status))
    .map((entry) => entry["agenda item"]);
  for (const entry of dispositions) {
    if (!["executed", "empty"].includes(entry.status)) continue;
    if (!executedItems.some((item) => item.startsWith(`${entry["agenda item"]}.`))) continue;
    entry.status = "container";
    entry["atomic unit id"] = "";
    entry.role = "";
    entry["evidence quote"] = "";
    entry.confidence = 0;
  }
  return dispositions;
}

function chapterUnitsForSpan(span, unitId) {
  const maxChars = Math.max(2500, Number(process.env.AGENDA_CHAPTER_MAX_SOURCE_CHARS || 10000));
  const maxSeconds = Math.max(300, Number(process.env.AGENDA_SECTION_SPLIT_SECONDS || 900));
  const chapters = [];
  let start = 0;
  while (start < span.length) {
    let end = start;
    let chars = 0;
    const since = Number(span[start]?.since || 0);
    while (end < span.length) {
      const nextChars = clean(span[end]?.text).length;
      const duration = Number(span[end]?.until || since) - since;
      if (end > start && (chars + nextChars > maxChars || duration > maxSeconds)) break;
      chars += nextChars;
      end += 1;
    }
    const slice = span.slice(start, Math.max(start + 1, end));
    chapters.push({
      "chapter id": `${unitId}_chapter_${String(chapters.length + 1).padStart(2, "0")}`,
      "parent unit id": unitId,
      "ordering index": chapters.length + 1,
      "row start": Number(slice[0]["source row"]),
      "row end": Number(slice[slice.length - 1]["source row"]),
      since: Number(slice[0].since || 0),
      until: Number(slice[slice.length - 1].until || slice[0].since || 0),
      "source excerpt": slice.map((u) => `${u.speaker}: ${u.text}`).join("\n"),
      "source chars": slice.reduce((sum, u) => sum + clean(u.text).length, 0),
    });
    start += slice.length;
  }
  return chapters.length >= 2 ? chapters : [];
}

export function buildGroundedTimeline({ canonical, units, dispositions }) {
  const boundaries = validateReconciledTimeline(dispositions, canonical, units);
  const indexById = new Map(units.map((unit, index) => [unit["atomic unit id"], index]));
  const canonicalTitle = new Map(canonical.items.map((item) => [item.item, item.title]));
  const grounded = [];
  for (let i = 0; i < boundaries.length; i += 1) {
    const boundary = boundaries[i];
    const evidenceStart = indexById.get(boundary["atomic unit id"]);
    const start = evidenceStart;
    const nextStart = i + 1 < boundaries.length ? indexById.get(boundaries[i + 1]["atomic unit id"]) : units.length;
    const span = units.slice(start, nextStart);
    if (!span.length) throw new Error(`agenda segmentation retryable: empty transcript span for ${boundary["agenda item"]}`);
    const unitId = `ground_${String(grounded.length + 1).padStart(3, "0")}`;
    const excerpt = span.map((u) => `${u.speaker}: ${u.text}`).join("\n");
    grounded.push({
      "unit id": unitId,
      "agenda item": boundary["agenda item"],
      "parent agenda item": boundary["agenda item"],
      label: `${boundary["agenda item"]} ${canonicalTitle.get(boundary["agenda item"])}`,
      role: boundary.role,
      status: boundary.status,
      "boundary evidence": boundary["evidence quote"],
      "boundary confidence": boundary.confidence,
      "atomic start": span[0]["atomic unit id"],
      "atomic end": span[span.length - 1]["atomic unit id"],
      "row start": Number(span[0]["source row"]),
      "row end": Number(span[span.length - 1]["source row"]),
      "source rows": new Set(span.map((u) => u["source row"])).size,
      since: Number(span[0].since || 0),
      until: Number(span[span.length - 1].until || span[0].since || 0),
      "duration seconds": Math.max(0, Number(span[span.length - 1].until || 0) - Number(span[0].since || 0)),
      "source excerpt": excerpt,
      "source words": excerpt.split(/\s+/u).filter(Boolean).length,
      "grounding confidence": boundary.confidence,
      "grounding status": "llm-evidence-grounded",
      substantive: !["procedural"].includes(boundary.role) && boundary.status !== "empty",
      "child chapters": chapterUnitsForSpan(span, unitId),
    });
  }
  if (grounded[grounded.length - 1]["atomic end"] !== units[units.length - 1]["atomic unit id"]) {
    throw new Error("agenda segmentation retryable: transcript tail is not covered");
  }
  return grounded;
}

function boundedPrefixEvidenceUnits(prefixUnits) {
  const maxWords = Math.max(600, Number(process.env.AGENDA_SCOPE_AUDIT_WORDS || 2400));
  const opening = [];
  const closing = [];
  let openingWords = 0;
  let closingWords = 0;
  const perSide = Math.floor(maxWords / 2);
  for (const unit of prefixUnits) {
    if (openingWords >= perSide) break;
    opening.push(unit);
    openingWords += clean(unit.text).split(/\s+/u).filter(Boolean).length;
  }
  for (let index = prefixUnits.length - 1; index >= opening.length; index -= 1) {
    if (closingWords >= perSide) break;
    closing.unshift(prefixUnits[index]);
    closingWords += clean(prefixUnits[index].text).split(/\s+/u).filter(Boolean).length;
  }
  return [...opening, ...closing];
}

export async function auditUnownedTranscriptPrefix({
  canonical,
  units,
  dispositions,
  llmModel = "qwen3.5:9b",
  ollamaUrl = "http://mriczo:11434/api/chat",
  log = () => {},
  scopeAuditProvider = null,
}) {
  const boundaries = validateReconciledTimeline(dispositions, canonical, units);
  const indexById = new Map(units.map((unit, index) => [unit["atomic unit id"], index]));
  const firstBoundary = boundaries[0];
  const firstBoundaryIndex = indexById.get(firstBoundary["atomic unit id"]);
  if (firstBoundaryIndex === 0) {
    return {
      "prefix atomic units": 0,
      "out of scope": false,
      reason: "canonical meeting begins at the start of the transcript",
      confidence: 1,
    };
  }

  const prefixUnits = units.slice(0, firstBoundaryIndex);
  const evidenceUnits = boundedPrefixEvidenceUnits(prefixUnits);
  const request = {
    canonical,
    prefixUnits,
    evidenceUnits,
    firstBoundary,
    firstBoundaryIndex,
  };
  const parsed = scopeAuditProvider
    ? await scopeAuditProvider(request)
    : await callOllamaJson({
      ollamaUrl,
      llmModel,
      system: "You audit municipal transcript scope. Return only the required strict JSON object.",
      prompt: [
        "Determine whether the transcript units before the first grounded agenda boundary belong to a separate meeting and are therefore outside the canonical agenda below.",
        "Set out_of_scope true only when literal evidence establishes a separate meeting, such as its own call to order, meeting name, adjournment, or a transition into the canonical meeting.",
        "Ordinary introductions, opening remarks, or an agenda boundary missed by segmentation are not out of scope.",
        "Copy a short exact substring from one supplied prefix unit as evidence_quote.",
        "Return only {\"out_of_scope\":true,\"reason\":\"preceding separate meeting\",\"evidence_quote\":\"literal words\",\"confidence\":0.95}.",
        "Canonical agenda:",
        agendaText(canonical.items),
        `First accepted canonical boundary: ${firstBoundary["agenda item"]} at ${firstBoundary["atomic unit id"]}: ${firstBoundary["evidence quote"]}`,
        "Unowned prefix evidence (opening and units nearest the canonical boundary):",
        evidenceUnits.map((unit) => `[${unit["atomic unit id"]}] ${unit.speaker}: ${unit.text}`).join("\n"),
      ].join("\n\n"),
      attempts: 2,
    });

  const outOfScope = parsed?.out_of_scope === true || parsed?.["out of scope"] === true;
  const confidence = Number(parsed?.confidence || 0);
  const evidenceQuote = clean(parsed?.evidence_quote || parsed?.["evidence quote"]);
  const reason = clean(parsed?.reason);
  const literalEvidence = prefixUnits.some((unit) => evidenceKey(unit.text).includes(evidenceKey(evidenceQuote)));
  const minimumConfidence = Number(process.env.AGENDA_SCOPE_AUDIT_MIN_CONFIDENCE || 0.8);
  if (!outOfScope || confidence < minimumConfidence || confidence > 1 || evidenceKey(evidenceQuote).length < 8 || !literalEvidence || !reason) {
    throw new Error(`agenda segmentation retryable: ${firstBoundaryIndex} transcript units precede the first canonical boundary without validated separate-meeting evidence`);
  }
  log(`[agenda-boundaries] excluded ${firstBoundaryIndex} prefix units after Qwen scope audit: ${reason}`);
  return {
    "prefix atomic units": firstBoundaryIndex,
    "prefix atomic start": prefixUnits[0]["atomic unit id"],
    "prefix atomic end": prefixUnits.at(-1)["atomic unit id"],
    "out of scope": true,
    reason,
    "evidence quote": evidenceQuote,
    confidence,
    "verification method": "qwen3.5:9b separate-meeting scope audit with literal evidence",
  };
}

function wiseSeriesText(grounded) {
  const lines = ["su name wise chips be series def"];
  for (let i = 0; i < grounded.length; i += 1) {
    const unit = grounded[i];
    const text = `[Agenda Start] ${unit.label} | role ${unit.role} | method llm-boundary-v2\n\n${unit["source excerpt"]}`;
    lines.push(`su name wise chip ${String(i + 1).padStart(3, "0")} since num ${Number(unit["row start"])} until num ${Number(unit["row end"])} ob text ${JSON.stringify(text)} ya`);
  }
  lines.push("prah", "");
  return lines.join("\n");
}

export async function runLlmAgendaSegmentation({
  rowsJsonPath,
  canonicalIndexPath,
  fallbackAgendaPath = "",
  candidatesPyaPath,
  matchesPyaPath,
  wiseSeriesPyaPath,
  sectionGroundingPyaPath,
  llmModel = "qwen3.5:9b",
  ollamaUrl = "http://mriczo:11434/api/chat",
  log = () => {},
  candidateProvider = null,
  reconciliationProvider = null,
  scopeAuditProvider = null,
  scopeStartProvider = null,
  scopeEndProvider = null,
  meetingLabel = "",
}) {
  let canonical;
  if (canonicalIndexPath && fs.existsSync(canonicalIndexPath)) {
    try {
      canonical = loadCanonicalAgenda(canonicalIndexPath);
    } catch (error) {
      log(`[agenda-boundaries] structured index rejected; using LLM agenda extraction: ${String(error?.message || error)}`);
    }
  }
  if (!canonical) {
    if (!fallbackAgendaPath || !fs.existsSync(fallbackAgendaPath)) throw new Error("agenda segmentation retryable: canonical agenda source unavailable");
    const raw = fs.readFileSync(fallbackAgendaPath, "utf8");
    const extracted = await callOllamaJson({
      ollamaUrl,
      llmModel,
      system: "Extract a canonical agenda. Return strict JSON only.",
      prompt: `Return {\"items\":[{\"item\":\"1\",\"title\":\"CALL TO ORDER\"}]} in source order. Printed page numbers are not agenda items.\n\n${raw.slice(0, 50000)}`,
    });
    canonical = parseCanonicalAgendaMarkdown((extracted?.items || []).map((x) => `${x.item} ${x.title}`).join("\n"), fallbackAgendaPath);
  }
  const rowsRaw = JSON.parse(fs.readFileSync(rowsJsonPath, "utf8"));
  const allUnits = await splitOversizedTranscriptUnits(buildAtomicTranscriptUnits(rowsRaw), {
    maxWords: Number(process.env.AGENDA_ATOMIC_MAX_WORDS || 120),
    llmModel,
    ollamaUrl,
  });
  const meetingScopeStartAudit = await locateCanonicalMeetingScopeStart({
    canonical,
    units: allUnits,
    meetingLabel,
    llmModel,
    ollamaUrl,
    log,
    scopeStartProvider,
  });
  const scopeStartIndex = Math.max(0, allUnits.findIndex((unit) => unit["atomic unit id"] === meetingScopeStartAudit["scope atomic start"]));
  const postStartUnits = allUnits.slice(scopeStartIndex);
  const meetingScopeEndAudit = await locateCanonicalMeetingScopeEnd({
    canonical,
    units: postStartUnits,
    meetingLabel,
    llmModel,
    ollamaUrl,
    log,
    scopeEndProvider,
  });
  const scopeEndIndex = postStartUnits.findIndex((unit) => unit["atomic unit id"] === meetingScopeEndAudit["scope atomic end"]);
  if (scopeEndIndex < 0) throw new Error("agenda segmentation retryable: canonical meeting scope end is not in transcript");
  const units = postStartUnits.slice(0, scopeEndIndex + 1);
  if (!units.length) throw new Error("agenda segmentation retryable: canonical meeting scope contains no transcript units");
  const meetingScopeAudit = {
    ...meetingScopeStartAudit,
    "scope atomic end": meetingScopeEndAudit["scope atomic end"],
    "following meeting atomic start": meetingScopeEndAudit["following meeting atomic start"] || "",
    "following meeting": meetingScopeEndAudit["following meeting"] || "",
    "suffix atomic units": meetingScopeEndAudit["suffix atomic units"],
    "suffix atomic start": meetingScopeEndAudit["suffix atomic start"] || "",
    "suffix atomic end": meetingScopeEndAudit["suffix atomic end"] || "",
    "out of scope suffix": meetingScopeEndAudit["out of scope suffix"],
    "scope end reason": meetingScopeEndAudit.reason,
    "scope end evidence quote": meetingScopeEndAudit["evidence quote"] || "",
    "scope end confidence": meetingScopeEndAudit.confidence,
    "scope end verification method": meetingScopeEndAudit["verification method"] || "",
  };
  const windows = buildOverlappingWindows(units, {
    maxWords: Number(process.env.AGENDA_BOUNDARY_WINDOW_WORDS || 600),
    overlapWords: Number(process.env.AGENDA_BOUNDARY_WINDOW_OVERLAP_WORDS || 120),
  });
  let collected = null;
  if (/^(1|true|yes)$/iu.test(String(process.env.AGENDA_BOUNDARY_REUSE_CANDIDATES || "")) && fs.existsSync(candidatesPyaPath)) {
    try {
      const cached = await readPyaMapArtifact(candidatesPyaPath, CANDIDATES_ROOT);
      if (cached?.["schema version"] === "agenda_boundary_candidates_v2"
        && cached?.["canonical fingerprint"] === canonical.fingerprint
        && Number(cached?.["atomic units total"] || 0) === units.length) {
        const trustValidatedCheckpoint = /^(1|true|yes)$/iu.test(String(process.env.AGENDA_BOUNDARY_TRUST_VALIDATED_CHECKPOINT || ""));
        const auditedCandidates = trustValidatedCheckpoint
          ? (Array.isArray(cached.candidates) ? cached.candidates : [])
          : await verifyCandidateSemantics({
            proposed: Array.isArray(cached.candidates) ? cached.candidates : [],
            canonical,
            units,
            llmModel,
            ollamaUrl,
            log,
          });
        collected = { candidates: auditedCandidates, rejected: cached["rejected candidates"] || [] };
        log(`[agenda-boundaries] reused ${collected.candidates.length} validated boundary candidates${trustValidatedCheckpoint ? " from same-input checkpoint" : " after independent audit"}`);
      }
    } catch {}
  }
  if (!collected) {
    collected = candidateProvider
      ? await candidateProvider({ canonical, units, windows })
      : await collectCandidates({ canonical, units, windows, llmModel, ollamaUrl, log });
  }
  const callToOrder = canonical.items.find((entry) => /^call to order$/iu.test(clean(entry.title)));
  if (callToOrder && meetingScopeAudit["evidence quote"]) {
    collected.candidates = [
      ...(Array.isArray(collected?.candidates) ? collected.candidates : []),
      {
        "agenda item": callToOrder.item,
        "announced topic": `${meetingLabel || "canonical meeting"} call to order`,
        "atomic unit id": meetingScopeAudit["scope atomic start"],
        role: "procedural",
        "evidence quote": meetingScopeAudit["evidence quote"],
        confidence: meetingScopeAudit.confidence,
        "meeting scope boundary": true,
        "window id": "named_meeting_scope",
        "semantic verification": "qwen3.5:9b named-meeting scope discovery with literal evidence",
      },
    ];
  }
  const resolvedInitialCandidates = pruneConflictingBoundaryCandidates(await resolveCandidateBoundaryConflicts({
    candidates: pruneConflictingBoundaryCandidates(Array.isArray(collected?.candidates) ? collected.candidates : [], canonical),
    canonical,
    units,
    llmModel,
    ollamaUrl,
    log,
  }), canonical);
  const initialCandidates = await auditWholeChronologyCandidates({
    candidates: resolvedInitialCandidates,
    canonical,
    units,
    llmModel,
    ollamaUrl,
    log,
  });
  const recoveredCandidates = await recoverMissingCanonicalCandidates({
    candidates: initialCandidates,
    canonical,
    units,
    windows,
    llmModel,
    ollamaUrl,
    log,
  });
  const reconciliableCandidates = pruneConflictingBoundaryCandidates(await resolveCandidateBoundaryConflicts({
    candidates: pruneConflictingBoundaryCandidates(recoveredCandidates, canonical),
    canonical,
    units,
    llmModel,
    ollamaUrl,
    log,
  }), canonical);
  const promotedCandidates = await promoteSingleChildCandidates({
    candidates: reconciliableCandidates,
    canonical,
    units,
    llmModel,
    ollamaUrl,
    log,
  });
  let candidates = await refineCandidateStarts({
    candidates: dedupeCandidatesByAgendaItem(promotedCandidates, canonical),
    canonical,
    units,
    llmModel,
    ollamaUrl,
    log,
  });
  if (callToOrder && meetingScopeAudit["evidence quote"]) {
    candidates = [
      {
        "agenda item": callToOrder.item,
        "announced topic": `${meetingLabel || "canonical meeting"} call to order`,
        "atomic unit id": meetingScopeAudit["scope atomic start"],
        role: "procedural",
        "evidence quote": meetingScopeAudit["evidence quote"],
        confidence: meetingScopeAudit.confidence,
        "meeting scope boundary": true,
        "window id": "named_meeting_scope",
        "semantic verification": "qwen3.5:9b named-meeting scope discovery with literal evidence",
      },
      ...candidates.filter((candidate) => candidate["agenda item"] !== callToOrder.item),
    ].sort((a, b) => Number(a["atomic unit id"].slice(7)) - Number(b["atomic unit id"].slice(7)));
  }
  if (!candidates.length) throw new Error("agenda segmentation retryable: LLM found no validated boundary candidates");
  const candidateCheckpointTime = new Date().toISOString();
  writePyaMapArtifact(candidatesPyaPath, CANDIDATES_ROOT, {
    "schema version": "agenda_boundary_candidates_v2",
    "generated time": candidateCheckpointTime,
    "canonical source path": canonical.sourcePath,
    "canonical source type": canonical.sourceType,
    "canonical fingerprint": canonical.fingerprint,
    "transcript rows total": Array.isArray(rowsRaw?.rows) ? rowsRaw.rows.length : 0,
    "recording atomic units total": allUnits.length,
    "atomic units total": units.length,
    "windows total": windows.length,
    candidates,
    "rejected candidates": Array.isArray(collected?.rejected) ? collected.rejected : [],
  });
  let dispositions;
  if (reconciliationProvider) {
    const reconciledRaw = await reconciliationProvider({ canonical, units, candidates });
    dispositions = (Array.isArray(reconciledRaw?.items) ? reconciledRaw.items : []).map(normalizeDisposition);
  } else {
    dispositions = await reconcileTimelineInBatches({ canonical, candidates, units, llmModel, ollamaUrl, log });
  }
  if (callToOrder && meetingScopeAudit["evidence quote"]) {
    const callDisposition = dispositions.find((entry) => entry["agenda item"] === callToOrder.item);
    if (callDisposition) {
      Object.assign(callDisposition, {
        status: "executed",
        "atomic unit id": meetingScopeAudit["scope atomic start"],
        role: "procedural",
        "evidence quote": meetingScopeAudit["evidence quote"],
        confidence: meetingScopeAudit.confidence,
      });
    }
  }
  resolveCanonicalHierarchyOwnership(dispositions);
  resolveSharedBoundaryOwnership(dispositions, canonical);
  validateReconciledTimeline(dispositions, canonical, units);
  const prefixScopeAudit = await auditUnownedTranscriptPrefix({
    canonical,
    units,
    dispositions,
    llmModel,
    ollamaUrl,
    log,
    scopeAuditProvider,
  });
  const grounded = buildGroundedTimeline({ canonical, units, dispositions });
  const generated = new Date().toISOString();
  const candidatesArtifact = {
    "schema version": "agenda_boundary_candidates_v2",
    "generated time": generated,
    "canonical source path": canonical.sourcePath,
    "canonical source type": canonical.sourceType,
    "canonical fingerprint": canonical.fingerprint,
    "transcript rows total": Array.isArray(rowsRaw?.rows) ? rowsRaw.rows.length : 0,
    "recording atomic units total": allUnits.length,
    "atomic units total": units.length,
    "windows total": windows.length,
    candidates,
    "rejected candidates": Array.isArray(collected?.rejected) ? collected.rejected : [],
  };
  const matches = {
    "schema version": "agenda_boundary_reconciliation_v2",
    "generated time": generated,
    "canonical source path": canonical.sourcePath,
    "canonical source type": canonical.sourceType,
    "canonical fingerprint": canonical.fingerprint,
    "sections total": canonical.items.length,
    "chunks total": windows.length,
    assignments: dispositions,
  };
  const grounding = {
    "schema version": "agenda_section_grounding_v3",
    "generated time": generated,
    "canonical source path": canonical.sourcePath,
    "canonical source type": canonical.sourceType,
    "canonical fingerprint": canonical.fingerprint,
    "transcript rows total": Array.isArray(rowsRaw?.rows) ? rowsRaw.rows.length : 0,
    "recording atomic units total": allUnits.length,
    "atomic units total": units.length,
    "meeting scope audit": meetingScopeAudit,
    "prefix scope audit": prefixScopeAudit,
    "grounded units": grounded,
  };
  writePyaMapArtifact(candidatesPyaPath, CANDIDATES_ROOT, candidatesArtifact);
  writePyaMapArtifact(matchesPyaPath, MATCHES_ROOT, matches);
  writePyaMapArtifact(sectionGroundingPyaPath, GROUNDING_ROOT, grounding);
  fs.writeFileSync(wiseSeriesPyaPath, wiseSeriesText(grounded), "utf8");
  log(`[agenda-boundaries] wrote ${grounded.length} evidence-grounded sections from ${units.length} atomic units`);
  return { canonical, units, candidatesArtifact, matches, grounding };
}
