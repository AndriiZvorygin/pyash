#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function normalizeSpaces(text) {
  return String(text || "")
    .replace(/[\u00A0\u2007\u202F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(input) {
  return (
    String(input || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "section"
  );
}

function parseGlobalPageMarker(line) {
  const raw = normalizeSpaces(line);
  const m = raw.match(/^Page ([0-9]{1,4}) of ([0-9]{1,4})$/i);
  if (!m) return null;
  return { page: Number(m[1]), total: Number(m[2]) };
}

function decodeHtmlEntities(text) {
  return String(text || "")
    .replace(/&#58;/g, ":")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#160;/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUrl(href, baseOrigin = "") {
  const value = String(href || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (baseOrigin) {
    try {
      return new URL(value, `${baseOrigin.replace(/\/+$/u, "")}/`).toString();
    } catch {}
  }
  return value.replace(/^\.\//, "");
}

function inferBaseOriginFromAgendaHtml(htmlText, explicitBase = "") {
  const explicit = String(explicitBase || "").trim();
  if (explicit) {
    try {
      return new URL(explicit).origin;
    } catch {}
  }
  const src = String(htmlText || "");
  const escribeMatches = [...src.matchAll(/https?:\/\/[^"'<>]*escribemeetings\.com[^"'<>]*/giu)]
    .map((m) => String(m?.[0] || "").trim())
    .filter(Boolean);
  const pubPreferred = escribeMatches.find((u) => /https?:\/\/pub-[^/]+\.escribemeetings\.com/iu.test(u));
  const candidate = pubPreferred || escribeMatches[0] || src.match(/https?:\/\/[^"'<>]+/iu)?.[0] || "";
  if (!candidate) return "";
  try {
    return new URL(candidate).origin;
  } catch {
    return "";
  }
}

function parseAgendaHtmlAttachments(htmlText, { baseOrigin = "" } = {}) {
  const idToItem = new Map();
  const byItem = new Map();
  const seenAttachmentUrlByItem = new Map();
  const itemRe =
    /<DIV class='AgendaItem AgendaItem(\d+)'[\s\S]*?<DIV class='AgendaItemCounter'[^>]*>([\s\S]*?)<\/DIV>[\s\S]*?<DIV class='AgendaItemTitle'[^>]*>[\s\S]*?<a [^>]*>([\s\S]*?)<\/a>/gi;
  let m = null;
  while ((m = itemRe.exec(htmlText))) {
    const id = Number(m[1]);
    const item = normalizeSpaces(decodeHtmlEntities(m[2])).toLowerCase();
    const title = normalizeSpaces(decodeHtmlEntities(m[3]));
    if (!item || !title) continue;
    idToItem.set(id, { item, title });
  }

  const attRe =
    /<DIV class='AgendaItemAttachment AgendaItemAttachment(\d+)'[\s\S]*?<a class='Link'[^>]*href="([^"]+)"[^>]*>[\s\S]*?<SPAN class='Link'[^>]*>([\s\S]*?)<\/SPAN>/gi;
  while ((m = attRe.exec(htmlText))) {
    const id = Number(m[1]);
    const mapping = idToItem.get(id);
    if (!mapping) continue;
    const href = normalizeUrl(decodeHtmlEntities(m[2]), baseOrigin);
    const label = normalizeSpaces(decodeHtmlEntities(m[3]));
    if (!href) continue;
    if (!byItem.has(mapping.item)) {
      byItem.set(mapping.item, { title: mapping.title, attachments: [] });
      seenAttachmentUrlByItem.set(mapping.item, new Set());
    }
    const seen = seenAttachmentUrlByItem.get(mapping.item);
    if (seen.has(href)) continue;
    seen.add(href);
    byItem.get(mapping.item).attachments.push({ label, url: href });
  }

  return byItem;
}

function isAgendaItemCode(line) {
  const raw = normalizeSpaces(line).toLowerCase();
  return /^([0-9]{1,2})\.([a-z])$/.test(raw);
}

function collectPageMarkers(lines) {
  const byPage = new Map();
  let maxTotal = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const marker = parseGlobalPageMarker(lines[i]);
    if (!marker) continue;
    if (!byPage.has(marker.page)) byPage.set(marker.page, i);
    if (marker.total > maxTotal) maxTotal = marker.total;
  }
  return { byPage, totalPages: maxTotal };
}

function findPagesHeader(lines) {
  for (let i = 0; i < Math.min(lines.length, 500); i += 1) {
    if (normalizeSpaces(lines[i]).toLowerCase() === "pages") return i;
  }
  return -1;
}

function sanitizeTocTitle(text) {
  let t = normalizeSpaces(text);
  if (!t) return t;
  t = t.replace(/Page\s+[0-9]{1,4}\s+of\s+[0-9]{1,4}/gi, " ");
  t = t.replace(/\bit is therefore recommended:?\b[\s\S]*$/i, "");
  t = t.replace(/^Whereas\s+/i, "Whereas ");
  t = t.replace(/\bThat\b[\s\S]*$/i, "");
  t = normalizeSpaces(t);
  if (t.length > 180) {
    const firstClause = t.split(/[;:.]/u)[0] || t;
    t = normalizeSpaces(firstClause);
  }
  const words = t.split(/\s+/u).filter(Boolean);
  if (words.length > 24) t = `${words.slice(0, 24).join(" ")}...`;
  return t;
}

function isContaminatedMinutesActionTitle(title = "") {
  const t = normalizeSpaces(title);
  if (!t) return false;
  return (
    /\bR-\d{6}-\d{3}[a-z]?\b/iu.test(t) ||
    /\bS-\d{6}-\d{3}[a-z]?\b/iu.test(t) ||
    /\bMoved by\b/iu.test(t) ||
    /\bSeconded by\b/iu.test(t) ||
    /\bCarried\b/iu.test(t) ||
    /\bDefeated\b/iu.test(t) ||
    /\bLost\b/iu.test(t) ||
    /\bResolution(?:\s+No\.)?\b/iu.test(t)
  );
}

function parseTocItems(lines, startLine, endLine) {
  const items = [];
  let rejectedContaminatedTitles = 0;
  let candidateCount = 0;
  for (let i = startLine; i <= endLine; i += 1) {
    if (!isAgendaItemCode(lines[i])) continue;
    candidateCount += 1;
    const item = normalizeSpaces(lines[i]).toLowerCase();
    const titleParts = [];
    let page = null;
    let j = i + 1;
    for (; j <= endLine; j += 1) {
      const raw = normalizeSpaces(lines[j]);
      if (!raw) continue;
      if (isAgendaItemCode(raw)) break;
      const marker = parseGlobalPageMarker(raw);
      if (marker) continue;
      if (/^[0-9]{1,2}\.$/.test(raw)) break;
      if (/^[0-9]{1,4}\.?$/.test(raw)) {
        page = Number(raw.replace(/\./g, ""));
        continue;
      }
      if (titleParts.length > 0 && /^that\b/i.test(raw)) break;
      if (titleParts.length > 0 && /^[ivxlcdm]+\.$/i.test(raw)) break;
      if (titleParts.length > 0 && /^[A-Z]{2,}(?:-[A-Z]{2,})+-[0-9]{2}-[0-9]{2}\b/.test(raw)) break;
      titleParts.push(raw);
    }
    const cleanTitle = sanitizeTocTitle(titleParts.join(" ")) || item;
    if (isContaminatedMinutesActionTitle(cleanTitle)) {
      rejectedContaminatedTitles += 1;
      i = j - 1;
      continue;
    }
    items.push({
      item,
      title: cleanTitle,
      start_page: page !== null && page > 0 ? page : null,
      start_page_source: page !== null && page > 0 ? "explicit" : "missing",
    });
    i = j - 1;
  }
  return { items, rejectedContaminatedTitles, candidateCount };
}

function dedupeAndSortItems(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = `${item.item}:${item.start_page}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function inferMissingStartPages({ items, lines, byPage }) {
  const out = items.map((x) => ({ ...x }));
  const known = out
    .map((x, i) => ({ i, page: Number.isFinite(x.start_page) ? x.start_page : null }))
    .filter((x) => Number.isFinite(x.page));
  if (!known.length) return out;

  const firstKnownPage = known[0].page;
  const firstKnownLine = byPage.get(firstKnownPage);
  if (typeof firstKnownLine !== "number") return out;
  const markerPages = Array.from(byPage.keys())
    .filter((p) => Number.isFinite(p) && p > 0)
    .sort((a, b) => a - b);

  const firstIntermediatePage = markerPages.find((p) => p < firstKnownPage && p >= 5);
  const firstIntermediateLine = Number.isFinite(firstIntermediatePage) ? byPage.get(firstIntermediatePage) : null;
  const topLevelScanEnd =
    typeof firstIntermediateLine === "number"
      ? Math.min(firstKnownLine, firstIntermediateLine)
      : firstKnownLine;

  let lastTopLevelLine = -1;
  for (let i = 0; i < topLevelScanEnd; i += 1) {
    const raw = normalizeSpaces(lines[i]);
    if (/^[0-9]{1,2}\.$/.test(raw)) lastTopLevelLine = i;
  }

  const markerPagesFiltered = markerPages;

  for (let i = 0; i < out.length; i += 1) {
    if (Number.isFinite(out[i].start_page)) continue;
    const nextKnown = known.find((k) => k.i > i);
    if (!nextKnown && i !== 0) continue;
    const nextPage = nextKnown ? nextKnown.page : firstKnownPage;

    const candidates = markerPagesFiltered
      .filter((p) => p < nextPage)
      .filter((p) => {
        const line = byPage.get(p);
        return typeof line === "number" && line > lastTopLevelLine;
      });
    if (!candidates.length) continue;

    let chosen = candidates[0];
    if (candidates.length > 1) {
      const firstGap = byPage.get(candidates[1]) - byPage.get(candidates[0]);
      if (firstGap <= 3) chosen = candidates[1];
    }

    out[i].start_page = chosen;
    out[i].start_page_source = "inferred";
  }

  return out;
}

function scrubContaminatedMinutesActionBody(text) {
  const lines = String(text || "").split(/\r?\n/);
  const kept = [];
  for (const line of lines) {
    const raw = normalizeSpaces(line);
    if (/\b(?:R|S)-\d{6}-\d{3}[a-z]?\b/iu.test(raw)) continue;
    if (/\bMoved by\b/iu.test(raw)) continue;
    if (/\bSeconded by\b/iu.test(raw)) continue;
    if (/\b(?:Carried|Defeated|Lost)\b/iu.test(raw)) continue;
    if (/\bResolution(?:\s+No\.)?\b/iu.test(raw)) continue;
    kept.push(line);
  }
  return `${kept.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}
function collectItemAnchorPages(lines, byPage) {
  const markerPages = Array.from(byPage.keys())
    .filter((p) => Number.isFinite(p) && p > 0)
    .sort((a, b) => a - b);
  const pageForLine = (line) => {
    let page = null;
    for (const p of markerPages) {
      const at = byPage.get(p);
      if (typeof at !== "number") continue;
      if (at <= line) page = p;
      else break;
    }
    return page;
  };
  const byItem = new Map();
  for (let i = 0; i < lines.length; i += 1) {
    const raw = normalizeSpaces(lines[i]).toLowerCase();
    const m = raw.match(/^([0-9]{1,2}\.[a-z])\b/);
    if (!m) continue;
    const item = m[1];
    const page = pageForLine(i);
    if (!Number.isFinite(page)) continue;
    if (!byItem.has(item)) byItem.set(item, []);
    const arr = byItem.get(item);
    if (!arr.includes(page)) arr.push(page);
  }
  return byItem;
}

function enforceMonotonicStartPages(items, byPage, lines) {
  const out = items.map((x) => ({ ...x }));
  const markerPages = Array.from(byPage.keys())
    .filter((p) => Number.isFinite(p) && p > 0)
    .sort((a, b) => a - b);
  const anchors = collectItemAnchorPages(lines, byPage);

  let prevPage = 0;
  for (let i = 0; i < out.length; i += 1) {
    const current = out[i];
    const page = Number(current.start_page);
    const nextKnown = out
      .slice(i + 1)
      .map((x) => Number(x.start_page))
      .find((p) => Number.isFinite(p) && p > prevPage);

    const anchorPages = anchors.get(String(current.item || "").toLowerCase()) || [];
    if (Number.isFinite(page) && page >= prevPage) {
      const anchorRefine = anchorPages.find((p) => p >= page && (!Number.isFinite(nextKnown) || p < nextKnown));
      if (Number.isFinite(anchorRefine) && anchorRefine > page) {
        current.start_page = anchorRefine;
        prevPage = anchorRefine;
      } else {
        prevPage = page;
      }
      continue;
    }

    const anchorCandidate = anchorPages.find((p) => p >= prevPage && (!Number.isFinite(nextKnown) || p < nextKnown));
    if (Number.isFinite(anchorCandidate)) {
      current.start_page = anchorCandidate;
      prevPage = anchorCandidate;
      continue;
    }

    const pageCandidate = markerPages.find((p) => p >= prevPage && (!Number.isFinite(nextKnown) || p < nextKnown));
    if (Number.isFinite(pageCandidate)) {
      current.start_page = pageCandidate;
      prevPage = pageCandidate;
      continue;
    }

    current.start_page = null;
  }

  return out;
}

function isMinutesLikeTitle(title = "") {
  const t = normalizeSpaces(title).toLowerCase();
  return /\bminutes\b/.test(t) || /\bconfirmation of.*minutes\b/.test(t) || /\bmeeting held on\b/.test(t);
}

function hasNoUpdateTitle(title = "") {
  const t = normalizeSpaces(title).toLowerCase();
  return /\bthere (?:was|is|are) no update\b/.test(t) || /\bthere are no\b/.test(t);
}

function extractReportCode(title = "") {
  const m = normalizeSpaces(title).match(/\b([A-Z]{1,4}-[0-9]{2}-[0-9]{3})\b/);
  return m ? m[1] : "";
}
function findSectionByReportCode(lines, reportCode, allReportCodes = []) {
  if (!reportCode) return null;
  const code = String(reportCode || "").toUpperCase();
  const codeRe = new RegExp("\\b" + code.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&") + "\\b", "iu");
  const starts = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (codeRe.test(normalizeSpaces(lines[i]))) starts.push(i);
  }
  if (!starts.length) return null;
  const preferredStaff = starts.find((idx) => {
    const probe = [normalizeSpaces(lines[idx]), normalizeSpaces(lines[idx + 1] || ""), normalizeSpaces(lines[idx + 2] || "")].join(" ").toLowerCase();
    return probe.includes("staff report") && probe.includes(code.toLowerCase());
  });
  const preferredLate = starts.find((idx) => idx > 200 && /page\s+1\s+of\s+\d+/iu.test(normalizeSpaces(lines[idx + 1] || "")));
  const startLine = Number.isInteger(preferredStaff) ? preferredStaff : Number.isInteger(preferredLate) ? preferredLate : starts[0];
  const codeSet = new Set((allReportCodes || []).map((x) => String(x || "").toUpperCase()).filter(Boolean));
  codeSet.delete(code);
  const codeMatchers = Array.from(codeSet).map((c) => ({
    code: c,
    re: new RegExp("\\b" + c.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&") + "\\b", "iu"),
  }));
  let endLine = lines.length - 1;
  for (let i = startLine + 1; i < lines.length; i += 1) {
    const raw = normalizeSpaces(lines[i]);
    if (!raw) continue;
    if (/^[0-9]{1,2}\.[a-z]\b/iu.test(raw)) { endLine = i - 1; break; }
    if (/^Page [0-9]{1,4} of [0-9]{1,4}$/iu.test(raw)) continue;
    if (codeMatchers.some((m) => m.re.test(raw))) { endLine = i - 1; break; }
  }
  if (endLine < startLine) endLine = startLine;
  return {
    startLine,
    endLine,
    startAnchorText: normalizeSpaces(lines[startLine] || ""),
    endAnchorText: normalizeSpaces(lines[endLine] || ""),
  };
}

function hasContaminationMarkers(text = "") {
  const t = String(text || "");
  return {
    has_r_marker: /\bR-\d{6}-\d{3}[a-z]?\b/iu.test(t),
    has_s_marker: /\bS-\d{6}-\d{3}[a-z]?\b/iu.test(t),
    has_moved_by: /\bMoved by\b/iu.test(t),
    has_seconded_by: /\bSeconded by\b/iu.test(t),
    has_carried: /\bCarried\b/iu.test(t),
    has_defeated: /\bDefeated\b/iu.test(t),
  };
}

function findFirstNonEmptyLine(lines, startLine, endLine) {
  for (let i = startLine; i <= endLine; i += 1) {
    if (normalizeSpaces(lines[i])) return i;
  }
  return startLine;
}

function hasMinutesHeaderAt(lines, lineIndex) {
  const probe = [];
  for (let i = lineIndex; i < Math.min(lines.length, lineIndex + 12); i += 1) {
    probe.push(normalizeSpaces(lines[i]).toLowerCase());
  }
  const joined = probe.join(" ");
  return /\bminutes\b/.test(joined) && /\bowen sound city council\b/.test(joined);
}

function hasStrongAnchorInRange(section, lines, startLine, endLine) {
  const reportCode = extractReportCode(section.title);
  const reportPattern = reportCode ? new RegExp("\\b" + reportCode + "\\b", "i") : null;
  const spanLines = [];
  for (let i = startLine; i <= endLine; i += 1) {
    const raw = normalizeSpaces(lines[i]);
    if (raw) spanLines.push(raw);
  }
  const joined = spanLines.join(" ").toLowerCase();
  if (reportPattern && reportPattern.test(joined)) return true;

  const stopWords = new Set([
    "the", "and", "for", "from", "with", "that", "this", "there", "are", "was", "were", "meeting", "held",
    "city", "council", "report", "minutes", "regular", "committee", "session", "update", "re", "of", "to", "on",
    "in", "by", "at", "a", "an", "is", "be", "as", "or"
  ]);
  const words = normalizeSpaces(section.title)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w && w.length >= 5 && !stopWords.has(w) && !/^\d+[a-z]?$/.test(w));
  const unique = Array.from(new Set(words)).slice(0, 8);
  if (!unique.length) return false;
  let matched = 0;
  for (const w of unique) {
    if (joined.includes(w)) matched += 1;
    if (matched >= 2) return true;
  }
  return false;
}

function findMinutesActionBlockStart(lines, startLine, endLine) {
  for (let i = startLine; i <= endLine; i += 1) {
    const raw = normalizeSpaces(lines[i]);
    if (!raw) continue;
    const looksLikeResolution = /\b(?:R|S)-\d{6}-\d{3}[a-z]?\b/iu.test(raw);
    const looksLikeMotion = /\bMoved by\b/iu.test(raw) || /\bSeconded by\b/iu.test(raw);
    if (!looksLikeResolution && !looksLikeMotion) continue;
    const lookahead = [];
    for (let j = i; j <= Math.min(endLine, i + 6); j += 1) {
      lookahead.push(normalizeSpaces(lines[j]));
    }
    const probe = lookahead.join(" ");
    if (
      /\bMoved by\b/iu.test(probe) ||
      /\bSeconded by\b/iu.test(probe) ||
      /\b(?:Carried|Defeated|Lost)\b/iu.test(probe)
    ) {
      return i;
    }
  }
  return -1;
}

function findTocWindow(lines) {
  const pagesHeader = findPagesHeader(lines);
  if (pagesHeader >= 0) {
    const start = Math.max(0, pagesHeader);
    let lastTopLevelLine = -1;
    for (let i = start; i < Math.min(lines.length, start + 1200); i += 1) {
      const raw = normalizeSpaces(lines[i]);
      if (/^[0-9]{1,2}\.$/.test(raw)) lastTopLevelLine = i;
    }
    const probeStart = lastTopLevelLine >= 0 ? lastTopLevelLine + 1 : start;
    for (let i = probeStart; i < lines.length; i += 1) {
      const m = parseGlobalPageMarker(lines[i]);
      if (m && m.page >= 2) {
        const tocStart = pagesHeader + 1;
        const tocEnd = i - 1;
        if (tocEnd >= tocStart) return { start: tocStart, end: tocEnd, pagesHeader };
        break;
      }
    }
  } else {
    for (let i = 0; i < lines.length; i += 1) {
      const m = parseGlobalPageMarker(lines[i]);
      if (m && m.page >= 2) {
        const tocStart = 0;
        const tocEnd = i - 1;
        if (tocEnd >= tocStart) return { start: tocStart, end: tocEnd, pagesHeader };
        break;
      }
    }
  }
  return { start: -1, end: -1, pagesHeader };
}

function main() {
  const [, , inputPath, outputDir, outputIndexPath, agendaHtmlPath, sourceBaseUrl, sliceSourcePathRaw] = process.argv;
  if (!inputPath || !outputDir) {
    process.stderr.write(
      "usage: node command/extract_escribe_subreports.mjs <toc_source.md> <output_dir> [output_index.json] [agenda_html] [source_base_url] [slice_source.md]\\n",
    );
    process.exit(2);
  }

  const tocSourcePath = path.resolve(inputPath);
  const sliceSourcePath = sliceSourcePathRaw ? path.resolve(sliceSourcePathRaw) : tocSourcePath;

  const tocText = fs.readFileSync(tocSourcePath, "utf8");
  const tocLines = tocText.split(/\r?\n/);
  const sliceText = fs.readFileSync(sliceSourcePath, "utf8");
  const sliceLines = sliceText.split(/\r?\n/);

  const { byPage, totalPages } = collectPageMarkers(sliceLines);
  const tocWindow = findTocWindow(tocLines);
  const primaryTocParse =
    tocWindow.start >= 0 && tocWindow.end >= tocWindow.start
      ? parseTocItems(tocLines, tocWindow.start, tocWindow.end)
      : { items: [], rejectedContaminatedTitles: 0, candidateCount: 0 };

  const sliceTocWindow = findTocWindow(sliceLines);
  const sliceTocParse =
    sliceTocWindow.start >= 0 && sliceTocWindow.end >= sliceTocWindow.start
      ? parseTocItems(sliceLines, sliceTocWindow.start, sliceTocWindow.end)
      : { items: [], rejectedContaminatedTitles: 0, candidateCount: 0 };

  const primaryItems = Array.isArray(primaryTocParse?.items) ? primaryTocParse.items : [];
  const fallbackItems = Array.isArray(sliceTocParse?.items) ? sliceTocParse.items : [];
  const useSliceTocFallback = primaryItems.length === 0 && fallbackItems.length > 0;
  const tocItemsRaw = useSliceTocFallback ? fallbackItems : primaryItems;
  const rejectedContaminatedTitles = Number(
    (useSliceTocFallback ? sliceTocParse?.rejectedContaminatedTitles : primaryTocParse?.rejectedContaminatedTitles) || 0,
  );
  const tocCandidateCountBeforeFiltering = Number(
    (useSliceTocFallback ? sliceTocParse?.candidateCount : primaryTocParse?.candidateCount) || 0,
  );

  const tocItemsFilled = inferMissingStartPages({
    items: dedupeAndSortItems(tocItemsRaw),
    lines: sliceLines,
    byPage,
  });
  const tocItemsMonotonic = enforceMonotonicStartPages(tocItemsFilled, byPage, sliceLines);

  const skippedMissingPageCoverageCount = tocItemsMonotonic.filter(
    (x) => Number.isFinite(x.start_page) && !byPage.has(x.start_page),
  ).length;

  const tocItems = tocItemsMonotonic.filter((x) => Number.isFinite(x.start_page) && byPage.has(x.start_page));

  const sections = [];
  let skippedWeakAnchorCount = 0;
  let skippedDuplicateInferredStartCount = 0;
  let minutesBoundaryCutCount = 0;
  const inferredStartSeen = new Set();
  for (let i = 0; i < tocItems.length; i += 1) {
    const current = tocItems[i];
    const startPage = current.start_page;
    let nextIndex = i + 1;
    while (nextIndex < tocItems.length && Number(tocItems[nextIndex]?.start_page || 0) <= Number(startPage || 0)) {
      nextIndex += 1;
    }
    const next = tocItems[nextIndex];
    const nextStartPage = next ? next.start_page : totalPages + 1;
    const endPage = Math.max(startPage, nextStartPage - 1);
    const startLine = byPage.get(startPage);
    const nextStartLine = byPage.get(nextStartPage);
    if (typeof startLine !== "number") continue;
    let endLine =
      typeof nextStartLine === "number" ? Math.max(startLine, nextStartLine - 1) : sliceLines.length - 1;

    const isInferredStart = String(current.start_page_source || "") === "inferred";
    const inferredKey = String(current.start_page);
    const anchorProbeEnd = Math.min(endLine, startLine + 1200);
    const hasStrongAnchor = hasStrongAnchorInRange(current, sliceLines, startLine, anchorProbeEnd);
    if (isInferredStart && inferredStartSeen.has(inferredKey) && !hasStrongAnchor) {
      skippedDuplicateInferredStartCount += 1;
      continue;
    }
    const firstContentLine = findFirstNonEmptyLine(sliceLines, startLine, endLine);
    if (!isMinutesLikeTitle(current.title) && hasMinutesHeaderAt(sliceLines, firstContentLine)) {
      skippedWeakAnchorCount += 1;
      continue;
    }
    if (isInferredStart && !hasStrongAnchor) {
      skippedWeakAnchorCount += 1;
      continue;
    }
    if (isInferredStart) inferredStartSeen.add(inferredKey);

    if (!isMinutesLikeTitle(current.title)) {
      const contaminationStart = findMinutesActionBlockStart(sliceLines, startLine, endLine);
      if (contaminationStart > startLine + 10) {
        endLine = contaminationStart - 1;
        minutesBoundaryCutCount += 1;
      }
    }

    const rawSectionText = sliceLines.slice(startLine, endLine + 1).join("\n").trim() + "\n";
    const sectionText = scrubContaminatedMinutesActionBody(rawSectionText);
    const fileName = `${current.item.replace(".", "-")}_${slugify(current.title)}.md`;
    const filePath = path.join(outputDir, fileName);
    sections.push({
      item: current.item,
      title: current.title,
      start_page: startPage,
      end_page: endPage,
      line_start: startLine + 1,
      line_end: endLine + 1,
      file: filePath,
      text: sectionText,
    });
  }

  const existingItems = new Set(sections.map((s) => String(s.item || "").toLowerCase()));
  const reportCodes = Array.from(new Set(tocItemsRaw.map((x) => extractReportCode(x.title)).filter(Boolean)));
  const fallbackSections = [];
  for (const item of tocItemsRaw) {
    const itemKey = String(item.item || "").toLowerCase();
    if (existingItems.has(itemKey)) continue;
    if (isMinutesLikeTitle(item.title)) continue;
    const reportCode = extractReportCode(item.title);
    if (!reportCode) continue;
    const located = findSectionByReportCode(sliceLines, reportCode, reportCodes);
    if (!located) continue;
    const startLine = Number(located.startLine);
    const endLine = Number(located.endLine);
    if (!Number.isFinite(startLine) || !Number.isFinite(endLine) || endLine < startLine) continue;
    const anchorProbeEnd = Math.min(endLine, startLine + 1500);
    if (!hasStrongAnchorInRange(item, sliceLines, startLine, anchorProbeEnd)) continue;
    if (hasMinutesHeaderAt(sliceLines, findFirstNonEmptyLine(sliceLines, startLine, endLine))) continue;
    const rawText = sliceLines.slice(startLine, endLine + 1).join("\n").trim() + "\n";
    const sectionText = scrubContaminatedMinutesActionBody(rawText);
    const lineCount = sectionText.split(/\r?\n/).filter((ln) => normalizeSpaces(ln)).length;
    if (lineCount < 20) continue;
    const contamination = hasContaminationMarkers(sectionText);
    if (contamination.has_r_marker || contamination.has_s_marker || contamination.has_moved_by || contamination.has_seconded_by || contamination.has_carried || contamination.has_defeated) {
      continue;
    }
    const fileName = `${String(item.item || "").replace(/\./g, "-")}_${slugify(item.title)}_report-number.md`;
    const filePath = path.join(outputDir, fileName);
    fallbackSections.push({
      item: item.item,
      title: item.title,
      start_page: null,
      end_page: null,
      line_start: startLine + 1,
      line_end: endLine + 1,
      file: filePath,
      text: sectionText,
      extraction_method: "report_number_search",
      source_file: tocSourcePath,
      slice_source_file: sliceSourcePath,
      start_anchor_text: located.startAnchorText || "",
      end_anchor_text: located.endAnchorText || "",
      confidence: 0.9,
      contamination_scan: contamination,
    });
    existingItems.add(itemKey);
  }
  fs.mkdirSync(outputDir, { recursive: true });
  for (const section of [...sections, ...fallbackSections]) {
    fs.writeFileSync(section.file, section.text, "utf8");
  }

  const attachmentsResult = (() => {
    if (!agendaHtmlPath) return new Map();
    if (!fs.existsSync(agendaHtmlPath)) return new Map();
    const html = fs.readFileSync(agendaHtmlPath, "utf8");
    const baseOrigin = inferBaseOriginFromAgendaHtml(html, sourceBaseUrl);
    return { baseOrigin, byItem: parseAgendaHtmlAttachments(html, { baseOrigin }) };
  })();
  const attachmentsByItem = attachmentsResult?.byItem || new Map();
  const baseOrigin = attachmentsResult?.baseOrigin || "";

  const fallbackSectionsFromAttachments = [];
  if (attachmentsByItem.size > 0) {
    const already = new Set([...sections, ...fallbackSections].map((s) => String(s.item || "").toLowerCase()));
    const reportCodes = Array.from(new Set(Array.from(attachmentsByItem.values()).map((x) => extractReportCode(x.title)).filter(Boolean)));
    for (const [item, data] of attachmentsByItem.entries()) {
      const itemKey = String(item || "").toLowerCase();
      if (already.has(itemKey)) continue;
      if (isMinutesLikeTitle(data.title)) continue;
      const reportCode = extractReportCode(data.title);
      if (!reportCode) continue;
      const located = findSectionByReportCode(sliceLines, reportCode, reportCodes);
      if (!located) continue;
      const startLine = Number(located.startLine);
      const endLine = Number(located.endLine);
      if (!Number.isFinite(startLine) || !Number.isFinite(endLine) || endLine < startLine) continue;
      const pseudoSection = { item, title: data.title };
      const anchorProbeEnd = Math.min(endLine, startLine + 1500);
      if (!hasStrongAnchorInRange(pseudoSection, sliceLines, startLine, anchorProbeEnd)) continue;
      if (hasMinutesHeaderAt(sliceLines, findFirstNonEmptyLine(sliceLines, startLine, endLine))) continue;
      const rawText = sliceLines.slice(startLine, endLine + 1).join("\n").trim() + "\n";
      const sectionText = scrubContaminatedMinutesActionBody(rawText);
      const lineCount = sectionText.split(/\r?\n/).filter((ln) => normalizeSpaces(ln)).length;
      if (lineCount < 20) continue;
      const contamination = hasContaminationMarkers(sectionText);
      if (contamination.has_r_marker || contamination.has_s_marker || contamination.has_moved_by || contamination.has_seconded_by || contamination.has_carried || contamination.has_defeated) {
        continue;
      }
      const fileName = `${String(item || "").replace(/\./g, "-")}_${slugify(data.title)}_report-number.md`;
      const filePath = path.join(outputDir, fileName);
      fallbackSectionsFromAttachments.push({
        item,
        title: data.title,
        start_page: null,
        end_page: null,
        line_start: startLine + 1,
        line_end: endLine + 1,
        file: filePath,
        text: sectionText,
        extraction_method: "report_number_search",
        source_file: tocSourcePath,
        slice_source_file: sliceSourcePath,
        start_anchor_text: located.startAnchorText || "",
        end_anchor_text: located.endAnchorText || "",
        confidence: 0.9,
        contamination_scan: contamination,
      });
      already.add(itemKey);
    }
  }
  for (const section of fallbackSectionsFromAttachments) {
    fs.writeFileSync(section.file, section.text, "utf8");
  }
  const indexPath = outputIndexPath || path.join(outputDir, "subreports.index.json");
  const index = {
    source_file: tocSourcePath,
    slice_source_file: sliceSourcePath,
    output_dir: outputDir,
    generated_at_utc: new Date().toISOString(),
    total_pages_detected: totalPages,
    toc_window: {
      start_line: tocWindow.start >= 0 ? tocWindow.start + 1 : null,
      end_line: tocWindow.end >= 0 ? tocWindow.end + 1 : null,
    },
    toc_candidate_count_before_filtering: tocCandidateCountBeforeFiltering,
    toc_candidate_count_after_filtering: tocItemsRaw.length,
    rejected_contaminated_toc_titles_count: rejectedContaminatedTitles,
    toc_items_skipped_missing_page_coverage_count: skippedMissingPageCoverageCount,
    toc_items_skipped_weak_inferred_anchor_count: skippedWeakAnchorCount,
    toc_items_skipped_duplicate_inferred_start_count: skippedDuplicateInferredStartCount,
    minutes_action_boundary_cut_count: minutesBoundaryCutCount,
    duplicate_range_invalidated_count: 0,
    section_count: sections.length,
    sections: sections.map((s) => ({
      item: s.item,
      title: s.title,
      start_page: s.start_page,
      end_page: s.end_page,
      line_start: s.line_start,
      line_end: s.line_end,
      file: s.file,
    })),
    items_without_pages_from_toc: tocItemsRaw
      .filter((x) => !Number.isFinite(x.start_page))
      .map((x) => ({ item: x.item, title: x.title })),
    attachments_from_html: Array.from(attachmentsByItem.entries()).map(([item, data]) => ({
      item,
      title: data.title,
      attachment_count: data.attachments.length,
      attachments: data.attachments,
    })),
    source_base_origin: baseOrigin,
  };

  const duplicateSpanMap = new Map();
  for (const sec of [...sections, ...fallbackSections, ...fallbackSectionsFromAttachments]) {
    const ls = Number(sec?.line_start || 0);
    const le = Number(sec?.line_end || 0);
    if (!Number.isFinite(ls) || !Number.isFinite(le) || ls <= 0 || le <= 0) continue;
    const key = String(ls) + '-' + String(le);
    if (!duplicateSpanMap.has(key)) duplicateSpanMap.set(key, []);
    duplicateSpanMap.get(key).push(sec);
  }
  let duplicateRangeInvalidatedCount = 0;
  const invalidDuplicateKeys = new Set();
  for (const [key, arr] of duplicateSpanMap.entries()) {
    if (!Array.isArray(arr) || arr.length < 2) continue;
    const keepable = arr.filter((x) => /\b[A-Z]{1,4}-[0-9]{2}-[0-9]{3}\b/.test(String(x?.title || '')));
    if (keepable.length === 0) {
      invalidDuplicateKeys.add(key);
      duplicateRangeInvalidatedCount += arr.length;
    }
  }

  index.duplicate_range_invalidated_count = duplicateRangeInvalidatedCount;

  const mergedSections = [
    ...sections.map((x) => ({
      ...x,
      extraction_method: "page_toc",
      source_file: tocSourcePath,
      slice_source_file: sliceSourcePath,
      start_anchor_text: "",
      end_anchor_text: "",
      confidence: 0.82,
      contamination_scan: hasContaminationMarkers(String(x.text || "")),
    })),
    ...fallbackSections,
    ...fallbackSectionsFromAttachments,
  ];
  const sectionByItem = new Map(mergedSections
    .filter((sec) => {
      const ls = Number(sec?.line_start || 0);
      const le = Number(sec?.line_end || 0);
      const key = String(ls) + '-' + String(le);
      if (invalidDuplicateKeys.has(key)) return false;
      const text = String(sec?.text || '');
      const lineCount = text.split(/\r?\n/).filter((ln) => normalizeSpaces(ln)).length;
      if (hasNoUpdateTitle(String(sec?.title || '')) && lineCount > 40) return false;
      return true;
    })
    .map((x) => [String(x.item || "").toLowerCase(), x]));
  index.items = Array.from(new Set([...index.sections.map((x) => x.item), ...Array.from(attachmentsByItem.keys())]))
    .sort()
    .map((item) => {
      const fromSection = sectionByItem.get(String(item || "").toLowerCase());
      const fromHtml = attachmentsByItem.get(item);
      return {
        item,
        title: fromSection?.title || fromHtml?.title || item,
        has_page_slice: Boolean(fromSection),
        start_page: fromSection?.start_page ?? null,
        end_page: fromSection?.end_page ?? null,
        file: fromSection?.file ?? null,
        extraction_method: fromSection?.extraction_method ?? "none",
        source_file: fromSection?.source_file ?? tocSourcePath,
        slice_source_file: fromSection?.slice_source_file ?? sliceSourcePath,
        start_anchor_text: fromSection?.start_anchor_text ?? "",
        end_anchor_text: fromSection?.end_anchor_text ?? "",
        confidence: fromSection?.confidence ?? 0,
        contamination_scan: fromSection?.contamination_scan ?? hasContaminationMarkers(""),
        attachments: fromHtml?.attachments ?? [],
      };
    });

  fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");

  process.stdout.write(`[agenda-subreports] toc source markdown: ${tocSourcePath} | slice source markdown: ${sliceSourcePath}\n`);
  process.stdout.write(
    `[agenda-subreports] toc candidates before filtering: ${tocCandidateCountBeforeFiltering} | after filtering: ${tocItemsRaw.length} | rejected contaminated toc titles: ${rejectedContaminatedTitles}\n`,
  );
  process.stdout.write(
    `[agenda-subreports] sliced sections: ${sections.length} | toc items skipped missing page coverage: ${skippedMissingPageCoverageCount}\n`,
  );
  process.stdout.write(
    `[agenda-subreports] skipped weak inferred anchors: ${skippedWeakAnchorCount} | skipped duplicate inferred starts: ${skippedDuplicateInferredStartCount} | minutes boundary cuts: ${minutesBoundaryCutCount}\n`,
  );
  process.stdout.write(
    `extracted ${sections.length} page-sliced subreports and ${index.attachments_from_html.length} attachment groups from ${path.basename(tocSourcePath)} -> ${outputDir} (base_origin=${baseOrigin || "none"})\n`,
  );
}

main();
