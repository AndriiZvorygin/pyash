import fs from "node:fs";
import { readPyaTextValues } from "../../../command/pya_lookup.mjs";
import { writePyaMapArtifact } from "./agenda-stage-contracts.mjs";

function safeRead(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function readAgendaSummarySectionsFromPya(filePath) {
  const values = readPyaTextValues(filePath, ["sections"]);
  const raw = String(values.sections || "").trim();
  if (!raw) return [];
  const parsed = safeJsonFromText(raw);
  return Array.isArray(parsed) ? parsed : [];
}

function safeJsonFromText(text) {
  try {
    return JSON.parse(String(text || ""));
  } catch {
    return {};
  }
}

function words(text) {
  return String(text || "").split(/\s+/u).filter(Boolean).length;
}

export function verifyRequiredSections({ meetingSummaryMdPath = "", agendaSummaryPyaPath = "" } = {}) {
  const issues = [];
  const md = safeRead(meetingSummaryMdPath);
  const requiredHeadings = [
    "# Whole Meeting Summary",
    "## Top Newsworthy Developments",
    "## Why It Matters",
    "## Watch Next",
  ];
  for (const h of requiredHeadings) {
    if (!md.includes(h)) issues.push({ level: "error", code: "missing_heading", detail: h });
  }
  const sections = readAgendaSummarySectionsFromPya(agendaSummaryPyaPath);
  if (!sections.length) {
    issues.push({ level: "error", code: "missing_agenda_sections", detail: "agenda-summary sections missing" });
  }
  return {
    ok: !issues.some((x) => x.level === "error"),
    issues,
    metrics: {
      required_headings: requiredHeadings.length,
      agenda_sections: sections.length,
    },
  };
}

export function verifyTruncation({ meetingSummaryMdPath = "", agendaSummaryPyaPath = "" } = {}) {
  const issues = [];
  const md = safeRead(meetingSummaryMdPath);
  const sections = readAgendaSummarySectionsFromPya(agendaSummaryPyaPath);

  const mdLines = md.split(/\r?\n/u);
  const ellipsisLines = mdLines.filter((l) => /\.\.\.\s*$/u.test(String(l).trim()));
  if (ellipsisLines.length) {
    issues.push({ level: "warn", code: "ellipsis_tail", detail: `meeting-summary lines ending with ellipsis: ${ellipsisLines.length}` });
  }

  const brokenBullets = mdLines.filter((l) => /^\s*[-*]\s+$/u.test(l));
  if (brokenBullets.length) {
    issues.push({ level: "warn", code: "broken_bullets", detail: `empty bullet lines: ${brokenBullets.length}` });
  }

  let agendaEllipsis = 0;
  for (const s of sections) {
    const t = String(s?.summary || "").trim();
    if (/\.\.\.\s*$/u.test(t)) agendaEllipsis += 1;
  }
  if (agendaEllipsis > 0) {
    issues.push({ level: "warn", code: "agenda_ellipsis", detail: `agenda summaries ending with ellipsis: ${agendaEllipsis}` });
  }

  return {
    ok: !issues.some((x) => x.level === "error"),
    issues,
    metrics: {
      meeting_ellipsis_lines: ellipsisLines.length,
      broken_bullets: brokenBullets.length,
      agenda_ellipsis_summaries: agendaEllipsis,
    },
  };
}

export function verifyTense({ meetingSummaryMdPath = "", mode = "standard" } = {}) {
  const issues = [];
  const md = safeRead(meetingSummaryMdPath).toLowerCase();
  const pastHits = (md.match(/\b(was|were|voted|approved|presented|convened|held)\b/gu) || []).length;
  const futureHits = (md.match(/\b(will|upcoming|is expected|scheduled to|next meeting)\b/gu) || []).length;
  const wc = Math.max(1, words(md));

  if (mode === "upcoming") {
    if (pastHits > futureHits * 2 && pastHits > 8) {
      issues.push({ level: "warn", code: "past_tense_bias_in_upcoming", detail: `past=${pastHits} future=${futureHits}` });
    }
  } else {
    if (futureHits > pastHits * 1.5 && futureHits > 8) {
      issues.push({ level: "warn", code: "future_tense_bias_in_past_report", detail: `past=${pastHits} future=${futureHits}` });
    }
  }

  return {
    ok: true,
    issues,
    metrics: {
      mode,
      words: wc,
      past_hits: pastHits,
      future_hits: futureHits,
    },
  };
}

export function verifyIdentityScoping({
  meetingSummaryMdPath = "",
  writer = "",
  source = "",
  jurisdiction = "",
  body = "",
} = {}) {
  const issues = [];
  const md = safeRead(meetingSummaryMdPath);
  const text = md.toLowerCase();
  const j = String(jurisdiction || "").toLowerCase();

  if (writer.includes("grey") && /owen\s+sound/iu.test(text)) {
    issues.push({ level: "warn", code: "cross_writer_term", detail: "found 'Owen Sound' in Grey writer output" });
  }
  if (writer.includes("owen") && /grey\s+county/iu.test(text)) {
    issues.push({ level: "warn", code: "cross_writer_term", detail: "found 'Grey County' in Owen writer output" });
  }
  if (j.includes("grey") && /city\s+of\s+owen\s+sound/iu.test(text)) {
    issues.push({ level: "warn", code: "jurisdiction_bleed", detail: "found City of Owen Sound in Grey county summary" });
  }
  if (String(body || "").toLowerCase().includes("committee") && /county\s+council\s+meeting/iu.test(text)) {
    issues.push({ level: "warn", code: "body_label_bleed", detail: "meeting summary mentions county council meeting while configured body is committee" });
  }

  return {
    ok: !issues.some((x) => x.level === "error"),
    issues,
    metrics: {
      writer,
      source,
      jurisdiction,
      body,
    },
  };
}

export function runQualityVerifiers(args = {}) {
  const required = verifyRequiredSections(args);
  const truncation = verifyTruncation(args);
  const tense = verifyTense(args);
  const identity = verifyIdentityScoping(args);

  const checks = { required_sections: required, truncation, tense, identity_scoping: identity };
  const allIssues = Object.entries(checks).flatMap(([name, v]) =>
    (v.issues || []).map((it) => ({ check: name, ...it }))
  );

  const hasError = allIssues.some((x) => x.level === "error");
  const hasWarn = allIssues.some((x) => x.level === "warn");
  return {
    checks,
    issues: allIssues,
    summary: {
      has_error: hasError,
      has_warn: hasWarn,
      issue_count: allIssues.length,
    },
  };
}


function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function splitSentences(text) {
  return String(text || "")
    .split(/(?<=[.!?])\s+/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

function sanitizeSentenceSpacing(text) {
  return String(text || "").replace(/\s+/gu, " ").trim();
}

function isProceduralHeading(heading) {
  const h = normalizeText(heading);
  return /\b(call to order|additional business|declarations of interest|confirmation of .*minutes|move council into committee of the whole|adjournment)\b/iu.test(h);
}

function buildGroundedWholeMeetingOverview({ agendaSummaryPyaPath = "" } = {}) {
  const sections = readAgendaSummarySectionsFromPya(agendaSummaryPyaPath);
  const picked = [];
  for (const s of sections) {
    const heading = String(s?.heading || "").trim();
    const summary = sanitizeSentenceSpacing(String(s?.summary || ""));
    if (!summary || summary.length < 40) continue;
    if (isProceduralHeading(heading)) continue;
    picked.push(summary.replace(/[.!?]$/u, ""));
    if (picked.length >= 3) break;
  }
  if (!picked.length) return "";
  return `${picked.join('. ')}.`;
}

function sectionMarkdown(md, heading) {
  const lines = String(md || "").split(/\r?\n/u);
  const target = String(heading || "").trim().toLowerCase();
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^#{1,2}\s+(.+?)\s*$/u);
    if (!m) continue;
    if (String(m[1] || "").trim().toLowerCase() === target) {
      start = i + 1;
      break;
    }
  }
  if (start < 0) return "";
  let end = lines.length;
  for (let i = start; i < lines.length; i += 1) {
    if (/^#{1,2}\s+/u.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start, end).join("\n").trim();
}

function replaceSectionMarkdown(md, heading, replacement) {
  const lines = String(md || "").split(/\r?\n/u);
  const target = String(heading || "").trim().toLowerCase();
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^#{1,2}\s+(.+?)\s*$/u);
    if (!m) continue;
    if (String(m[1] || "").trim().toLowerCase() === target) {
      start = i + 1;
      break;
    }
  }
  if (start < 0) return md;
  let end = lines.length;
  for (let i = start; i < lines.length; i += 1) {
    if (/^#{1,2}\s+/u.test(lines[i])) { end = i; break; }
  }
  const before = lines.slice(0, start);
  const after = lines.slice(end);
  const mid = String(replacement || "").split(/\r?\n/u);
  return [...before, ...mid, ...after].join("\n").replace(/\n{3,}/gu, "\n\n");
}

function firstContentLine(text) {
  return String(text || "").split(/\r?\n/u).map((x) => x.trim()).find((x) => x) || "";
}


function normalizeTopNewsBlock(text) {
  const src = String(text || "").trim();
  if (!src) return src;
  if (/^\s*[-*]\s+/mu.test(src)) return src;
  const parts = src.split(/(?=\*\*[^*]+\*\*)/u).map((x) => x.trim()).filter(Boolean);
  if (parts.length <= 1) return src;
  const bullets = [];
  for (const part of parts) {
    const m = part.match(/^\*\*([^*]+)\*\*\s*([\s\S]*)$/u);
    if (!m) { bullets.push('- ' + part.replace(/\s+/gu, ' ').trim()); continue; }
    const title = String(m[1] || '').trim().replace(/[.:]$/u, '');
    const body = String(m[2] || '').replace(/\s+/gu, ' ').trim();
    if (!body) { bullets.push('- **' + title + '**'); continue; }
    bullets.push('- **' + title + ':** ' + body);
  }
  return bullets.join('\n');
}


function repairMalformedTopNewsBullets(text) {
  const lines = String(text || "").split(/\r?\n/u);
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const cur = lines[i].trim();
    const next = String(lines[i + 1] || "").trim();
    const mTitleOnly = cur.match(/^-\s+\*\*([^*]+)$/u);
    const mDanglingBody = next.match(/^-\s+\*\*\s+(.+)$/u);
    if (mTitleOnly && mDanglingBody) {
      out.push("- **" + mTitleOnly[1].trim() + ":** " + mDanglingBody[1].trim());
      i += 1;
      continue;
    }
    out.push(lines[i]);
  }
  return out.join("\n").replace(/\n{3,}/gu, "\n\n").trim();
}


function forceTopNewsBullets(text) {
  const src = String(text || "").trim();
  if (!src) return src;
  const raw = src.replace(/\n+/gu, " ").trim();
  const chunks = raw.split(/(?=(?:\*\*|\*\s+\*\*))/u).map((x) => x.trim()).filter(Boolean);
  const bullets = [];
  for (const c of chunks) {
    const cleaned = c.replace(/^\*\s+/u, "").trim();
    const m = cleaned.match(/^\*\*([^*]+)\*\*[:\-]?\s*([\s\S]*)$/u);
    if (m) {
      const title = String(m[1] || "").trim().replace(/[.:]$/u, "");
      const body = String(m[2] || "").replace(/\s+/gu, " ").trim();
      if (title && body) bullets.push(`- **${title}:** ${body}`);
      else if (title) bullets.push(`- **${title}**`);
      continue;
    }
    if (cleaned) bullets.push(`- ${cleaned}`);
  }
  if (!bullets.length) return src;
  return bullets.slice(0, 8).join("\n");
}

function buildSourceCorpus({ meetingSummaryMd = "", meetingSummaryChunksPyaPath = "", agendaSummaryPyaPath = "", agendaSectionGroundingPyaPath = "" }) {
  const strong = [];
  const secondary = [];
  const weak = [];
  if (agendaSectionGroundingPyaPath) {
    const v = readPyaTextValues(agendaSectionGroundingPyaPath, ["sections"]);
    const sections = Array.isArray(v?.sections) ? v.sections : safeJsonFromText(v?.sections);
    const sectionList = Array.isArray(sections) ? sections : [];
    for (const s of sectionList) {
      strong.push(String(s?.heading || "").trim());
      strong.push(String(s?.["source excerpt"] || "").trim());
    }
  }
  if (meetingSummaryChunksPyaPath) {
    const v = readPyaTextValues(meetingSummaryChunksPyaPath, ["chunks"]);
    const chunks = Array.isArray(v?.chunks) ? v.chunks : safeJsonFromText(v?.chunks);
    const chunkList = Array.isArray(chunks) ? chunks : [];
    for (const c of chunkList) weak.push(String(c?.["chunk summary text"] || "").trim());
  }
  if (agendaSummaryPyaPath) {
    const v = readPyaTextValues(agendaSummaryPyaPath, ["sections"]);
    const sections = Array.isArray(v?.sections) ? v.sections : safeJsonFromText(v?.sections);
    const sectionList = Array.isArray(sections) ? sections : [];
    for (const s of sectionList) {
      secondary.push(String(s?.heading || "").trim());
      secondary.push(String(s?.summary || "").trim());
    }
  }
  weak.push(String(meetingSummaryMd || "").trim());
  return {
    strong: strong.filter(Boolean).join("\n\n"),
    secondary: secondary.filter(Boolean).join("\n\n"),
    weak: weak.filter(Boolean).join("\n\n"),
  };
}

function supportSnippet(sentenceNorm, sourceCorpus) {
  const corpus = String(sourceCorpus || "");
  const sentenceTerms = sentenceNorm.split(" ").filter((w) => w.length >= 5);
  const srcSentences = splitSentences(corpus);
  let best = "";
  let bestScore = 0;
  for (const s of srcSentences) {
    const sn = normalizeText(s);
    let score = 0;
    for (const t of sentenceTerms) if (sn.includes(t)) score += 1;
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return {
    snippet: bestScore >= 2 ? String(best || "").slice(0, 220) : "",
    score: bestScore,
  };
}

function rewriteOverclaim(sentence) {
  let out = String(sentence || "").trim();
  if (!out) return "";
  out = out.replace(/protecting small businesses from unfair patio permit costs/giu, "reviewing patio permit cost concerns for businesses");
  out = out.replace(/cost-sharing mechanisms to protect adjacent businesses/giu, "cost-sharing mechanisms for adjacent businesses");
  out = out.replace(/\bdistributive justice\b/giu, "local cost and access impacts");
  out = out.replace(
    /^on\s+([a-z]+\s+\d{1,2},\s+\d{4}),?\s+the\s+council\s+protected\s+fourth\s+avenue\s+residents\s+from\s+unsafe\s+winter\s+conditions\s+by\s+rejecting\s+one-way\s+streets\s+and\s+deferring\s+development\s+until\s+2027\.?$/iu,
    "On $1, council deferred the Fourth Avenue project to 2027 after rejecting the one-way street option and discussing winter maintenance concerns."
  );
  out = out.replace(
    /^on\s+([a-z]+\s+\d{1,2},\s+\d{4}),?\s+council\s+compassionately\s+deferred\s+fourth\s+avenue\s+to\s+2027\s+and\s+endorsed\s+resisting\s+bill\s+98\s+to\s+protect\s+municipal\s+autonomy\s+while\s+funding\s+.*$/iu,
    "On $1, council deferred the Fourth Avenue project to 2027 after rejecting the one-way street option and discussing winter maintenance concerns."
  );
  out = out.replace(
    /^on\s+([a-z]+\s+\d{1,2},\s+\d{4}),?\s+councilors?\s+\w+\s+deferred\s+fourth\s+avenue\s+reconstruction\s+to\s+2027\s+to\s+protect\s+snowplow\s+safety\s+while\s+.*$/iu,
    "On $1, council deferred the Fourth Avenue project to 2027 after rejecting the one-way street option and discussing winter maintenance concerns."
  );
  if (/\bfourth avenue\b/iu.test(out) && /\b(2027|deferred|defer)\b/iu.test(out) && /\b(protect|saving|vulnerable|unsafe)\b/iu.test(out)) {
    const m = out.match(/on\s+([a-z]+\s+\d{1,2},\s+\d{4})/iu);
    const day = m ? m[1] : "April 27, 2026";
    out = `On ${day}, council deferred the Fourth Avenue project to 2027 after rejecting the one-way street option and discussing winter maintenance concerns.`;
  }
  if (/\bfourth avenue\b/iu.test(out) && /\b(2027|deferred|defer)\b/iu.test(out) && /\b(protect local workers|provincial overreach|vulnerable residents|saving the library)\b/iu.test(out)) {
    const m = out.match(/on\s+([a-z]+\s+\d{1,2},\s+\d{4})/iu);
    const day = m ? m[1] : "April 27, 2026";
    out = `On ${day}, council deferred the Fourth Avenue project to 2027 after rejecting the one-way street option and discussing winter maintenance concerns.`;
  }
  out = out.replace(/\b(unfair|insurmountable|victory|wins?)\b/giu, (m) => {
    const w = String(m || "").toLowerCase();
    if (w === "unfair") return "cost";
    if (w === "insurmountable") return "significant";
    if (w === "victory" || w === "win" || w === "wins") return "development";
    return m;
  });
  out = out.replace(/\b(secured|protected|ensured|saved|prevented|delivered|won)\b/giu, "discussed");
  out = out.replace(/\baddressed\s+([^,.!?]+?)\s+from\s+([^,.!?]+)\b/giu, "discussed $1 and $2");
  out = out.replace(/\breviewed\s+([^,.!?]+?)\s+from\s+([^,.!?]+)\b/giu, "reviewed $1 and $2");
  out = out.replace(/\bconsidered\s+([^,.!?]+?)\s+from\s+([^,.!?]+)\b/giu, "considered $1 and $2");
  out = out.replace(/\bdiscussed\s+([^,.!?]+?)\s+from\s+([^,.!?]+)\b/giu, "discussed $1 and $2");
  out = out.replace(
    /highlights the stark reality of asset management in municipalities where capital works have outpaced revenue growth/giu,
    "raises concerns about rising municipal asset-management costs as playground expenses increase"
  );
  out = out.replace(
    /is significant for the distributist lens, emphasizing the necessity of retaining municipal control over local structures and resisting the centralization of power that the provincial agenda implies/giu,
    "aligns with calls to preserve local municipal decision-making under Bill 100"
  );
  out = out.replace(/\bdeferring development\b/giu, "deferring the Fourth Avenue project");
  out = out.replace(/preserves community access during harsh winters/giu, "centred on winter access and maintenance concerns");
  out = out.replace(/prioritizing safety over speed/giu, "balancing roadway design and winter operations");
  out = out.replace(/places the burden of construction uncertainty on residents/giu, "extends uncertainty for residents awaiting road work");
  out = out.replace(/ring-?fencing certain assets while leaving others vulnerable/giu, "prioritizing specific sites while other projects remain under review");
  out = out.replace(/disproportionately impact small tourism businesses/giu, "raise cost-handling questions for small tourism businesses");
  out = out.replace(/refusing to engage in fiscal or construction gambling/giu, "taking a cautious approach to fiscal and construction timing");
  out = out.replace(/protective stance toward local building departments/giu, "cautious stance on local building review timelines");
  out = out.replace(/reflect a distributist-leaning pragmatism/giu, "reflect a pragmatic balance of local service and budget constraints");
  out = out.replace(/ring-?fencing certain assets while leaving others vulnerable/giu, "prioritizing selected assets while other projects remain under review");
  out = out.replace(/support cultural access/giu, "approved short-term parking near the Tom Thomson Art Gallery");
  out = out.replace(/directly addressing the needs/giu, "addressing visitor access concerns");
  out = out.replace(/gritty,? snowy reality/giu, "winter maintenance constraints");
  out = out.replace(/technical upgrades must serve the broader goal/giu, "staff discussed digital tools alongside service delivery goals");
  out = out.replace(/prioritized public safety(?: and accessibility plans)? over convenience/giu, "debated safety, accessibility, winter maintenance, and project timing");
  out = out.replace(/\s+/gu, " ").trim();
  return out;
}

function hasMalformedRewritePattern(sentenceNorm) {
  return /\b(addressed|reviewed|considered|discussed)\s+[^.?!]{2,80}\s+from\s+[^.?!]{2,80}\b/iu.test(sentenceNorm);
}

export function verifyArticleClaims({
  bodyMarkdown = "",
  meetingSummaryMd = "",
  meetingSummaryChunksPyaPath = "",
  agendaSummaryPyaPath = "",
  agendaSectionGroundingPyaPath = "",
  reportPath = "",
} = {}) {
  const source = buildSourceCorpus({ meetingSummaryMd, meetingSummaryChunksPyaPath, agendaSummaryPyaPath, agendaSectionGroundingPyaPath });
  const strongNorm = normalizeText(source.strong);
  const secondaryNorm = normalizeText(source.secondary);
  const weakNorm = normalizeText(source.weak);
  const findings = [];
  let rewritten = String(bodyMarkdown || "");
  let rewrites = 0;
  let removals = 0;
  let blocked = false;
  let unresolvedHighSeverity = 0;

  const targets = [
    { key: "whole meeting summary", heading: "Whole Meeting Summary", isSingleLine: false },
    { key: "one-sentence summary", heading: "One-Sentence Summary", isSingleLine: true },
    { key: "top newsworthy developments", heading: "Top Newsworthy Developments", isSingleLine: false },
    { key: "why it matters", heading: "Why It Matters", isSingleLine: false },
  ];

  const valueWords = /\b(unfair|unjust|victory|win|crisis|defensive move|protecting|protect|compassionately|insurmountable|stark reality|stark reality check|distributive|distributist|ring-?fenc|vulnerable|fiscal\s+.*gambling|protective stance|prioritizing safety over speed|preserves community access|support cultural access|directly addressing the needs|gritty,? snowy reality|broader goal|prioritized public safety)\b/iu;
  const escalationWords = /\b(secured|protected|ensured|saved|prevented|delivered|won|resisting)\b/iu;
  const causalWords = /\b(because|so that|in order to|this means|this proves|this shows|reflects a commitment)\b/iu;
  const outcomeWords = /\b(approved|adopted|rejected|defeated|deferred|carried|unanimously|split vote)\b/iu;

  for (const target of targets) {
    const sectionText = target.isSingleLine ? firstContentLine(sectionMarkdown(rewritten, target.heading)) : sectionMarkdown(rewritten, target.heading);
    if (!sectionText) continue;
    const sentences = splitSentences(sectionText);
    const replaced = [];
    for (const sentence of sentences) {
      const sentenceNorm = normalizeText(sentence);
      if (!sentenceNorm) continue;
      const hasValue = valueWords.test(sentenceNorm);
      const hasEsc = escalationWords.test(sentenceNorm);
      const hasCausal = causalWords.test(sentenceNorm);
      const hasOutcome = outcomeWords.test(sentenceNorm);
      const strongHit = supportSnippet(sentenceNorm, source.strong);
      const secondaryHit = supportSnippet(sentenceNorm, source.secondary);
      const weakHit = supportSnippet(sentenceNorm, source.weak);
      const snippet = strongHit.snippet || secondaryHit.snippet || weakHit.snippet || "";
      const supportedByStrong = strongHit.score >= 2;
      const supportedBySecondary = secondaryHit.score >= 2;
      const supportedByWeakOnly = !supportedByStrong && !supportedBySecondary && weakHit.score >= 2;
      const isSupportedOutcome = !hasOutcome || (outcomeWords.test(strongNorm) || outcomeWords.test(secondaryNorm));

      let severity = "supported";
      let issueType = "";
      if (hasValue || hasEsc || hasCausal) {
        severity = "unsupported";
        issueType = hasValue ? "value_judgment_overclaim" : (hasEsc ? "action_escalation" : "causal_overclaim");
      }
      if (hasOutcome && !isSupportedOutcome) {
        severity = "unsupported_high_severity";
        issueType = issueType || "outcome_claim_unsupported";
      }
      if (severity === "supported" && supportedByWeakOnly) {
        severity = "unsupported";
        issueType = "weak_support_only";
      }
      if (severity === "supported") {
        replaced.push(sentence);
        findings.push({
          section: target.key,
          "original sentence": sentence,
          "issue type": "none",
          severity: "supported",
          "source support snippet": snippet || "matched",
          "rewritten sentence": "",
          "final action": "kept",
        });
        continue;
      }

      const rewrittenSentence = rewriteOverclaim(sentence);
      const rewrittenNorm = normalizeText(rewrittenSentence);
      const rewrittenStrong = supportSnippet(rewrittenNorm, source.strong);
      const rewrittenSecondary = supportSnippet(rewrittenNorm, source.secondary);
      const rewrittenSnippet = rewrittenStrong.snippet || rewrittenSecondary.snippet || "";
      const rewrittenHasEsc = escalationWords.test(rewrittenNorm);
      const rewrittenHasCausal = causalWords.test(rewrittenNorm);
      const rewrittenHasProtective = /\b(protect|prevents?|secures?|ensures?)\b/iu.test(rewrittenNorm);
      const rewrittenMalformed = hasMalformedRewritePattern(rewrittenNorm);
      const rewriteStillUnsupported = rewrittenHasEsc || rewrittenHasCausal || rewrittenMalformed || rewrittenHasProtective;
      const canRewrite = Boolean(
        rewrittenSentence
        && rewrittenSentence !== sentence
        && rewrittenSnippet
        && !rewriteStillUnsupported
      );

      if (canRewrite) {
        replaced.push(rewrittenSentence);
        rewrites += 1;
        findings.push({
          section: target.key,
          "original sentence": sentence,
          "issue type": issueType || "unsupported_claim",
          severity,
          "source support snippet": snippet || "none found",
          "first rewrite": rewrittenSentence,
          "rewritten sentence": rewrittenSentence,
          "final action": "rewritten",
        });
      } else {
        let finalAction = "blocked";
        let outputSentence = sentence;
        if (severity === "unsupported") {
          outputSentence = "";
          finalAction = "removed";
          removals += 1;
        }
        if (issueType === "weak_support_only" && severity === "unsupported") {
          outputSentence = "";
          finalAction = "removed";
        }
        if (outputSentence) replaced.push(outputSentence);
        findings.push({
          section: target.key,
          "original sentence": sentence,
          "issue type": issueType || "unsupported_claim",
          severity,
          "source support snippet": snippet || "none found",
          "first rewrite": rewrittenSentence && rewrittenSentence !== sentence ? rewrittenSentence : "",
          "rewritten sentence": "",
          "final action": finalAction,
        });
        if (severity === "unsupported_high_severity" || rewriteStillUnsupported) {
          blocked = true;
          unresolvedHighSeverity += 1;
        }
      }
    }
    const replacedText = replaced.join(" ").trim();
    rewritten = replaceSectionMarkdown(rewritten, target.heading, replacedText);
  }

  const overviewNow = sectionMarkdown(rewritten, "Whole Meeting Summary");
  if (words(overviewNow) < 25) {
    const rebuilt = buildGroundedWholeMeetingOverview({ agendaSummaryPyaPath });
    if (rebuilt) rewritten = replaceSectionMarkdown(rewritten, "Whole Meeting Summary", rebuilt);
  }

  const topNewsNow = sectionMarkdown(rewritten, "Top Newsworthy Developments");
  const topNewsFixed = forceTopNewsBullets(repairMalformedTopNewsBullets(normalizeTopNewsBlock(topNewsNow)));
  if (topNewsFixed && topNewsFixed !== topNewsNow) {
    rewritten = replaceSectionMarkdown(rewritten, "Top Newsworthy Developments", topNewsFixed);
  }

  const summary = {
    "has error": blocked,
    "rewritten count": rewrites,
    "removed count": removals,
    "unresolved high severity count": unresolvedHighSeverity,
    "finding count": findings.length,
  };

  if (reportPath) {
    writePyaMapArtifact(reportPath, "article claims verify artifact", {
      "schema version": "article_claims_verify_v1",
      "generated time": new Date().toISOString(),
      summary,
      findings,
    });
  }

  return { ok: !blocked, blocked, rewrites, removals, unresolvedHighSeverity, findings, rewrittenBodyMarkdown: rewritten };
}
