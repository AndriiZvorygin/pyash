#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const SITE_URL_DEFAULT = "https://helpos.ca";

function usage() {
  return [
    "Usage: node command/render_transcript_html_from_transcript_folder.mjs <transcript_dir> [output_html] [jurisdiction] [body] [site_url] [discussion_url] [source_url] [video_url] [hook]",
    "Example: node command/render_transcript_html_from_transcript_folder.mjs artifacts/.../transcript transcript.html \"Owen Sound\" \"Council\" \"https://helpos.ca\" \"https://helpos.ca/post/...\" \"https://owensound.ca/...\" \"https://www.youtube.com/...\"",
  ].join("\n");
}

function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

function escapeHtml(input) {
  return String(input || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function parseSrtTime(raw) {
  const m = String(raw || "").match(/^(\d\d):(\d\d):(\d\d),(\d\d\d)$/);
  if (!m) return 0;
  const [, hh, mm, ss, ms] = m.map(Number);
  return (hh * 3600) + (mm * 60) + ss + (ms / 1000);
}

function fmtClock(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const total = Math.floor(safe);
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function buildTimedVideoUrl(baseUrl, seconds) {
  const base = String(baseUrl || "").trim();
  if (!base) return "#";
  const sec = Math.max(0, Math.floor(Number(seconds) || 0));
  if (/youtu\.be|youtube\.com/iu.test(base)) {
    return `${base}${base.includes("?") ? "&" : "?"}t=${sec}s`;
  }
  return `${base}#t=${sec}`;
}

function parseSrt(text, { expectSpeaker = true } = {}) {
  const src = String(text || "").replace(/\r\n/g, "\n");
  const blocks = src.split(/\n{2,}/u).map((b) => b.trim()).filter(Boolean);
  const out = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    if (lines.length < 3) continue;
    const tm = lines[1].trim().match(/^(\d\d:\d\d:\d\d,\d\d\d)\s+-->\s+(\d\d:\d\d:\d\d,\d\d\d)$/);
    if (!tm) continue;
    const lineText = lines.slice(2).join(" ").replace(/\s+/g, " ").trim();
    if (!lineText) continue;
    const speakerMatch = expectSpeaker ? lineText.match(/^([^:]{2,80}):\s+(.+)$/u) : null;
    out.push({
      since: parseSrtTime(tm[1]),
      until: parseSrtTime(tm[2]),
      speaker: speakerMatch ? speakerMatch[1].trim() : "",
      speech: speakerMatch ? speakerMatch[2].trim() : lineText,
      raw: lineText,
    });
  }
  return out;
}

function parseSpeakerRowsJson(jsonText) {
  let parsed = {};
  try { parsed = JSON.parse(String(jsonText || "{}")); } catch { parsed = {}; }
  const rows = Array.isArray(parsed?.rows) ? parsed.rows : [];
  const out = [];
  for (const r of rows) {
    const since = Number(r?.since ?? r?.start_s ?? r?.start ?? 0);
    const until = Number(r?.until ?? r?.end_s ?? r?.end ?? since);
    const speaker = String(r?.display || r?.speaker || r?.speaker_name || "").trim();
    const speech = String(r?.text || r?.speech || r?.raw || "").replace(/\s+/g, " ").trim();
    if (!speech) continue;
    out.push({
      since: Number.isFinite(since) ? since : 0,
      until: Number.isFinite(until) ? until : (Number.isFinite(since) ? since : 0),
      speaker,
      speech,
      raw: speaker ? `${speaker}: ${speech}` : speech,
    });
  }
  return out;
}

function mergeSpeakerLabelsByTime(baseRows, speakerRows, toleranceSeconds = 0.25) {
  const out = Array.isArray(baseRows) ? baseRows.map((row) => ({ ...row })) : [];
  const speakers = Array.isArray(speakerRows) ? speakerRows : [];
  if (!out.length || !speakers.length) return out;

  let j = 0;
  for (let i = 0; i < out.length; i += 1) {
    const row = out[i];
    while (j < speakers.length && speakers[j].since < row.since - toleranceSeconds) j += 1;
    const candidates = [speakers[j - 1], speakers[j], speakers[j + 1]].filter(Boolean);
    let best = null;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (const c of candidates) {
      const delta = Math.abs((Number(c.since) || 0) - (Number(row.since) || 0));
      if (delta < bestDelta) {
        bestDelta = delta;
        best = c;
      }
    }
    if (best && bestDelta <= toleranceSeconds && String(best.speaker || "").trim()) {
      row.speaker = String(best.speaker).trim();
    }
  }
  return out;
}

function mergeSpeakerLabelsByIndex(baseRows, speakerRows) {
  const out = Array.isArray(baseRows) ? baseRows.map((row) => ({ ...row })) : [];
  const speakers = Array.isArray(speakerRows) ? speakerRows : [];
  if (!out.length || !speakers.length) return out;
  const limit = Math.min(out.length, speakers.length);
  for (let i = 0; i < limit; i += 1) {
    const name = String(speakers[i]?.speaker || "").trim();
    if (name) {
      out[i].speaker = name;
      out[i].raw = `${name}: ${String(out[i].speech || "").trim()}`.trim();
    }
  }
  return out;
}

function countSrtCues(text) {
  const src = String(text || "").replace(/\r\n/g, "\n");
  const m = src.match(/^\d\d:\d\d:\d\d,\d\d\d\s+-->\s+\d\d:\d\d:\d\d,\d\d\d$/gmu);
  return Array.isArray(m) ? m.length : 0;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pickFile(transcriptDir, patterns) {
  const names = fs.readdirSync(transcriptDir);
  for (const p of patterns) {
    const match = names.find((n) => p.test(n));
    if (match) return path.join(transcriptDir, match);
  }
  return "";
}

function deriveDateText(meetingDirName) {
  const m = String(meetingDirName || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return { iso: "", long: "Unknown date" };
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  const dt = new Date(`${iso}T12:00:00Z`);
  const long = dt.toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  return { iso, long };
}

function firstSentences(text, maxSentences = 3) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const parts = t.split(/(?<=[.!?])\s+/u).filter(Boolean).slice(0, maxSentences);
  return parts.join(" ");
}

function stripMarkdown(text) {
  return String(text || "")
    .replace(/^#{1,6}\s+/gmu, "")
    .replace(/\*\*(.*?)\*\*/gu, "$1")
    .replace(/\*(.*?)\*/gu, "$1")
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/\[(.*?)\]\((.*?)\)/gu, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function parseMdHeadings(mdText) {
  const out = [];
  const lines = String(mdText || "").split(/\r?\n/u);
  for (const line of lines) {
    const m = line.match(/^##\s+(.+?)\s*$/u);
    if (!m) continue;
    const h = m[1]
      .replace(/^\d+\.\s*/u, "")
      .replace(/^\d+\s+/u, "")
      .replace(/\s{2,}.*/u, "")
      .trim();
    if (!h || /^Agenda Section Summaries$/iu.test(h)) continue;
    out.push(h.length > 110 ? `${h.slice(0, 109)}…` : h);
  }
  return out;
}

function extractMarkdownSection(mdText, headingText) {
  const lines = String(mdText || "").split(/\r?\n/u);
  const target = String(headingText || "").trim().toLowerCase();
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

function extractWholeMeetingLead(mdText) {
  const lines = String(mdText || "").split(/\r?\n/u);
  let start = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^#\s+Whole Meeting Summary\s*$/iu.test(lines[i])) {
      start = i + 1;
      break;
    }
  }
  const nextH2 = lines.findIndex((line, idx) => idx >= start && /^##\s+/u.test(line));
  const end = nextH2 >= 0 ? nextH2 : lines.length;
  const text = stripMarkdown(lines.slice(start, end).join("\n")).trim();
  return firstSentences(text, 5);
}

function extractTopNewsworthyItems(mdText, maxItems = 6) {
  const section = extractMarkdownSection(mdText, "Top Newsworthy Developments");
  if (!section) return [];
  const blocks = section
    .split(/\n{2,}/u)
    .map((b) => b.trim())
    .filter(Boolean);
  const out = [];
  for (const block of blocks) {
    const flat = block.replace(/\n+/gu, " ").trim();
    if (!flat) continue;
    let title = "";
    let text = flat;
    const bold = flat.match(/^\*\*(.+?)\*\*\s*(.*)$/u);
    if (bold) {
      title = bold[1].trim();
      text = (bold[2] || "").trim();
    }
    if (!title) {
      const maybeColon = flat.match(/^([^:]{3,90}):\s*(.+)$/u);
      if (maybeColon) {
        title = maybeColon[1].trim();
        text = maybeColon[2].trim();
      }
    }
    if (!title) title = "Key Development";
    if (!text) text = "Details available in full transcript.";
    out.push({ title, text: firstSentences(stripMarkdown(text), 3) });
    if (out.length >= maxItems) break;
  }
  return out;
}

function distinct(list) {
  const seen = new Set();
  const out = [];
  for (const x of list) {
    const k = String(x || "").trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(String(x).trim());
  }
  return out;
}

function parseLeadingItemNumber(heading) {
  const raw = String(heading || "").trim();
  const full = raw.match(/^\s*(\d+)(?:\s*[.\-]\s*([a-z0-9]+))?\b/iu);
  if (full) {
    const major = String(Number(full[1]));
    const minor = String(full[2] || "").trim().toLowerCase();
    return minor ? `${major}.${minor}` : major;
  }
  const m = raw.match(/^section\s+(\d+)\b/iu);
  return m ? String(Number(m[1])) : "";
}

function parseWiseRanges(seriesText) {
  const src = String(seriesText || "");
  const ranges = [];
  const re = /su name wise chip \d+\s+since num ([0-9.]+)\s+until num ([0-9.]+)\s+ob text /gu;
  for (const m of src.matchAll(re)) {
    const since = Number(m[1]);
    const until = Number(m[2]);
    if (!Number.isFinite(since) || !Number.isFinite(until)) continue;
    ranges.push({ since, until });
  }
  return ranges;
}

function parseGrossChunks(jsonText) {
  try {
    const obj = JSON.parse(String(jsonText || "{}"));
    const windows = Array.isArray(obj?.windows) ? obj.windows : [];
    return windows
      .map((w, i) => ({
        index: i + 1,
        start: Number(w?.start),
        end: Number(w?.end),
        summary: String(w?.summary || "").trim(),
        phase: String(w?.phase || "").trim(),
      }))
      .filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end >= w.start);
  } catch {
    return [];
  }
}

function findRowIndexAtOrAfter(rows, targetSince) {
  for (let i = 0; i < rows.length; i += 1) {
    if ((Number(rows[i]?.since) || 0) >= targetSince) return i;
  }
  return rows.length - 1;
}

function looksGenericSectionHeading(heading) {
  return /^section\s+\d+\s*$/iu.test(String(heading || "").trim());
}

function titleCaseWords(text) {
  return String(text || "")
    .split(/\s+/u)
    .map((w) => w ? (w[0].toUpperCase() + w.slice(1).toLowerCase()) : "")
    .join(" ")
    .trim();
}

function deriveHeadingFromSummary(fallbackHeading, summary, index) {
  const heading = String(fallbackHeading || "").trim() || `Section ${index + 1}`;
  if (!looksGenericSectionHeading(heading)) return heading;
  const plain = stripMarkdown(String(summary || ""))
    .replace(/\bSPEAKER_[0-9A-Z_-]+:\s*/giu, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (!plain) return heading;
  const itemMatch = plain.match(/\bitem\s+([0-9]+[a-z]?)\b/iu);
  if (itemMatch && itemMatch[1]) return `Item ${String(itemMatch[1]).toUpperCase()}`;
  const topic = plain
    .split(/(?<=[.!?])\s+/u)[0]
    .split(/\s+/u)
    .slice(0, 7)
    .join(" ")
    .replace(/[,:;.-]+$/u, "")
    .trim();
  if (!topic) return heading;
  return titleCaseWords(topic);
}

function buildRangesFromSourceRowHints(sections, rows) {
  const list = Array.isArray(sections) ? sections : [];
  if (!list.length || !Array.isArray(rows) || !rows.length) return [];
  const hinted = list.map((s) => Math.max(1, Math.floor(Number(s?.source_rows) || 0)));
  const totalHint = hinted.reduce((a, b) => a + b, 0);
  if (totalHint <= 0) return [];
  const out = [];
  let cursor = 0;
  for (let i = 0; i < list.length; i += 1) {
    const sec = list[i];
    const remainingSections = list.length - i;
    const remainingRows = rows.length - cursor;
    if (remainingRows <= 0) break;
    let take = Math.max(1, Math.floor((hinted[i] / totalHint) * rows.length));
    if (i === list.length - 1) take = remainingRows;
    const maxTake = Math.max(1, remainingRows - (remainingSections - 1));
    take = Math.min(take, maxTake);
    const startRow = cursor;
    const endRow = Math.min(rows.length - 1, cursor + take - 1);
    out.push({
      id: `section-${i + 1}`,
      heading: deriveHeadingFromSummary(String(sec?.heading || "").trim(), String(sec?.summary || "").trim(), i),
      summary: String(sec?.summary || "").trim(),
      startRow,
      endRow,
    });
    cursor = endRow + 1;
  }
  return out;
}

function normalizeSectionRanges(rows, ranges) {
  const rowCount = Array.isArray(rows) ? rows.length : 0;
  const source = Array.isArray(ranges) ? ranges : [];
  if (!rowCount || !source.length) return [];

  // Clamp starts and enforce monotonic starts, then derive ends from the next start.
  // This guarantees each transcript row appears at most once across section blocks.
  const starts = source.map((range, idx) => {
    const fallback = Math.min(rowCount - 1, Math.max(0, idx));
    const raw = Number(range?.startRow);
    if (!Number.isFinite(raw)) return fallback;
    return Math.min(rowCount - 1, Math.max(0, Math.floor(raw)));
  });

  for (let i = 1; i < starts.length; i += 1) {
    if (starts[i] <= starts[i - 1]) {
      starts[i] = Math.min(rowCount - 1, starts[i - 1] + 1);
    }
  }

  const out = [];
  for (let i = 0; i < source.length; i += 1) {
    const startRow = starts[i];
    const endRow = i + 1 < starts.length
      ? Math.max(startRow, starts[i + 1] - 1)
      : rowCount - 1;
    out.push({
      id: String(source[i]?.id || `section-${i + 1}`),
      heading: String(source[i]?.heading || `Section ${i + 1}`),
      summary: String(source[i]?.summary || ""),
      startRow,
      endRow,
    });
  }
  return out.filter((range) => range.startRow >= 0 && range.startRow < rowCount && range.endRow >= range.startRow);
}

function buildRangesFromGrossChunks(rows, grossChunks) {
  const list = Array.isArray(grossChunks) ? grossChunks : [];
  if (!Array.isArray(rows) || !rows.length || !list.length) return [];
  const maxParagraph = list.reduce((mx, g) => Math.max(mx, Number(g?.end || 0)), 0);
  if (!Number.isFinite(maxParagraph) || maxParagraph <= 0) return [];
  const toRow = (p) => {
    const ratio = Math.max(0, Math.min(1, Number(p || 0) / maxParagraph));
    return Math.max(0, Math.min(rows.length - 1, Math.round(ratio * (rows.length - 1))));
  };
  const out = list.map((g, i) => {
    const startRow = toRow(g.start);
    const endRow = Math.max(startRow, toRow(g.end));
    const heading = g.phase
      ? `Gross Chunk ${i + 1} — ${g.phase}`
      : `Gross Chunk ${i + 1}`;
    return {
      id: `section-gross-${i + 1}`,
      heading,
      summary: String(g.summary || ""),
      startRow,
      endRow,
    };
  });
  return normalizeSectionRanges(rows, out);
}

function buildSectionRanges({ transcriptRows, sectionSummaries, agendaMatches, wiseRanges, grossChunks }) {
  const rows = Array.isArray(transcriptRows) ? transcriptRows : [];
  const sections = Array.isArray(sectionSummaries) ? sectionSummaries : [];
  if (!rows.length || !sections.length) return [];
  const wise = Array.isArray(wiseRanges) ? wiseRanges : [];
  const gross = Array.isArray(grossChunks) ? grossChunks : [];

  const explicitRows = sections.filter((s) =>
    Number.isFinite(Number(s?.start_row)) &&
    Number.isFinite(Number(s?.end_row)) &&
    Number(s.start_row) >= 0 &&
    Number(s.end_row) >= Number(s.start_row)
  );
  if (explicitRows.length >= Math.max(2, Math.floor(sections.length * 0.7))) {
    const out = sections.map((sec, i) => {
      const start = Math.max(0, Math.min(rows.length - 1, Math.floor(Number(sec?.start_row) || 0)));
      const endRaw = Math.floor(Number(sec?.end_row) || start);
      const end = Math.max(start, Math.min(rows.length - 1, endRaw));
      return {
        id: `section-${i + 1}`,
        heading: deriveHeadingFromSummary(String(sec?.heading || "").trim(), String(sec?.summary || "").trim(), i),
        summary: String(sec?.summary || "").trim(),
        startRow: start,
        endRow: end,
      };
    });
    return normalizeSectionRanges(rows, out);
  }

  // Guardrail: if section summaries were produced without usable row grounding,
  // section rendering can duplicate opening transcript lines across headings.
  // In that case, prefer a plain chronological transcript over broken anchors.
  const groundedSections = sections.filter((s) => Number(s?.source_rows || 0) > 0).length;
  if (groundedSections === 0) {
    const grossFallback = buildRangesFromGrossChunks(rows, gross);
    if (grossFallback.length) return grossFallback;
    if (!wise.length) return [];
  }
  if (wise.length === sections.length) {
    const wiseMax = wise.reduce((mx, w) => Math.max(mx, Number(w?.until ?? w?.since ?? 0) || 0), 0);
    const wiseMonotonic = wise.every((w, i) => {
      if (i === 0) return true;
      const prev = Number(wise[i - 1]?.since);
      const curr = Number(w?.since);
      return Number.isFinite(prev) && Number.isFinite(curr) && curr >= prev;
    });
    const wiseLooksLikeRowIndex =
      wise.length > 0 &&
      wise.every((w) => Number.isFinite(Number(w?.since)) && Number.isFinite(Number(w?.until))) &&
      wise.every((w) => Number.isInteger(Number(w?.since)) && Number.isInteger(Number(w?.until))) &&
      wiseMonotonic &&
      wiseMax <= (rows.length + 50);

    const out = [];
    for (let i = 0; i < sections.length; i += 1) {
      const sec = sections[i];
      const wr = wise[i];
      const nextSinceRaw = i + 1 < wise.length ? Number(wise[i + 1].since) : Number.POSITIVE_INFINITY;
      let start = 0;
      let end = rows.length - 1;
      if (wiseLooksLikeRowIndex) {
        start = Math.max(0, Math.min(rows.length - 1, Math.floor(Number(wr?.since) || 0)));
        const nextStart = i + 1 < wise.length
          ? Math.max(0, Math.min(rows.length - 1, Math.floor(nextSinceRaw)))
          : rows.length;
        end = i + 1 < wise.length ? Math.max(start, nextStart - 1) : rows.length - 1;
      } else {
        const nextSince = Number.isFinite(nextSinceRaw) ? nextSinceRaw : Number.POSITIVE_INFINITY;
        start = findRowIndexAtOrAfter(rows, Number(wr?.since || 0));
        const endCandidate = findRowIndexAtOrAfter(rows, nextSince);
        end = i + 1 < wise.length ? Math.max(start, endCandidate - 1) : rows.length - 1;
      }
      out.push({
        id: `section-${i + 1}`,
        heading: deriveHeadingFromSummary(String(sec?.heading || "").trim(), String(sec?.summary || "").trim(), i),
        summary: String(sec?.summary || "").trim(),
        startRow: start,
        endRow: end,
      });
    }
    return normalizeSectionRanges(rows, out);
  }

  const matchByItem = new Map();
  const seedMatch = (item, payload) => {
    const key = String(item || "").trim();
    if (!key) return;
    if (!matchByItem.has(key)) matchByItem.set(key, { item: key, ...payload });
    else matchByItem.set(key, { ...matchByItem.get(key), ...payload });
  };

  // Prefer full boundary/section-start maps because they exist for all agenda items,
  // including items that did not get a direct "matches" hit.
  for (const b of Array.isArray(agendaMatches?.boundaries) ? agendaMatches.boundaries : []) {
    seedMatch(b?.item, {
      start_paragraph: Number.isFinite(Number(b?.start)) ? Math.floor(Number(b.start)) : undefined,
      end_paragraph: Number.isFinite(Number(b?.end)) ? Math.floor(Number(b.end)) : undefined,
      reason: String(b?.reason || ""),
      method: String(b?.method || ""),
    });
  }
  for (const s of Array.isArray(agendaMatches?.section_starts) ? agendaMatches.section_starts : []) {
    seedMatch(s?.item, {
      start_paragraph: Number.isFinite(Number(s?.start_paragraph)) ? Math.floor(Number(s.start_paragraph)) : undefined,
      title: String(s?.title || ""),
    });
  }
  for (const m of Array.isArray(agendaMatches?.matches) ? agendaMatches.matches : []) {
    seedMatch(m?.item, {
      snippet: String(m?.snippet || ""),
      score: Number(m?.score),
      paragraphIndex: Number.isFinite(Number(m?.paragraphIndex)) ? Math.floor(Number(m.paragraphIndex)) : undefined,
    });
  }

  // If we cannot anchor enough sections to agenda matches, avoid misleading
  // section layout and render plain transcript rows instead.
  if (matchByItem.size < Math.max(2, Math.floor(sections.length * 0.5))) {
    return normalizeSectionRanges(rows, buildRangesFromSourceRowHints(sections, rows));
  }

  const rowNorm = rows.map((r) => normalizeText(r.raw || r.speech || ""));
  const paragraphDomainMax = (() => {
    let mx = -1;
    for (const v of matchByItem.values()) {
      for (const n of [v?.start_paragraph, v?.end_paragraph, v?.paragraphIndex]) {
        const x = Number(n);
        if (Number.isFinite(x)) mx = Math.max(mx, Math.floor(x));
      }
    }
    for (const w of wise) {
      const s = Number(w?.since);
      const u = Number(w?.until);
      if (Number.isFinite(s)) mx = Math.max(mx, Math.floor(s));
      if (Number.isFinite(u)) mx = Math.max(mx, Math.floor(u));
    }
    return mx;
  })();
  const paragraphLooksDifferentSpace =
    Number.isFinite(paragraphDomainMax) &&
    paragraphDomainMax > (rows.length + 50);
  const mapParagraphToRow = (paragraphIndex) => {
    const p = Number(paragraphIndex);
    if (!Number.isFinite(p) || p < 0) return -1;
    if (!paragraphLooksDifferentSpace || paragraphDomainMax <= 0) {
      return Math.max(0, Math.min(rows.length - 1, Math.floor(p)));
    }
    const ratio = Math.max(0, Math.min(1, p / paragraphDomainMax));
    return Math.max(0, Math.min(rows.length - 1, Math.round(ratio * (rows.length - 1))));
  };
  const starts = [];

  for (let i = 0; i < sections.length; i += 1) {
    const sec = sections[i];
    const heading = String(sec?.heading || "").trim();
    const item = parseLeadingItemNumber(heading);
    const m = matchByItem.get(item);
    let rowIndex = -1;
    const fromParagraph = Number(m?.start_paragraph);
    if (Number.isFinite(fromParagraph) && fromParagraph >= 0) {
      rowIndex = mapParagraphToRow(fromParagraph);
    } else {
      const snippet = normalizeText(String(m?.snippet || "").slice(0, 220));
      if (snippet) {
        for (let r = 0; r < rowNorm.length; r += 1) {
          if (rowNorm[r] && rowNorm[r].includes(snippet.slice(0, Math.min(80, snippet.length)))) {
            rowIndex = r;
            break;
          }
        }
      }
    }
    if (rowIndex < 0) {
      const fromParagraphIndex = Number(m?.paragraphIndex);
      if (Number.isFinite(fromParagraphIndex) && fromParagraphIndex >= 0) {
        rowIndex = mapParagraphToRow(fromParagraphIndex);
      }
    }
    if (rowIndex < 0) {
      const snippet = normalizeText(String(m?.snippet || "").slice(0, 220));
      if (snippet) {
        for (let r = 0; r < rowNorm.length; r += 1) {
          if (rowNorm[r] && rowNorm[r].includes(snippet.slice(0, Math.min(80, snippet.length)))) {
            rowIndex = r;
            break;
          }
        }
      }
    }
    starts.push({
      heading,
      summary: String(sec?.summary || "").trim(),
      rowIndex,
    });
  }

  // Fill missing rowIndex forward/backward to keep sections navigable.
  let lastKnown = 0;
  for (const s of starts) {
    if (s.rowIndex >= 0) lastKnown = s.rowIndex;
    else s.rowIndex = lastKnown;
  }
  for (let i = starts.length - 2; i >= 0; i -= 1) {
    if (starts[i].rowIndex === starts[i + 1].rowIndex && starts[i].rowIndex === 0) {
      starts[i].rowIndex = Math.max(0, starts[i + 1].rowIndex - 1);
    }
  }

  // Ensure monotonic non-decreasing starts.
  for (let i = 1; i < starts.length; i += 1) {
    if (starts[i].rowIndex < starts[i - 1].rowIndex) starts[i].rowIndex = starts[i - 1].rowIndex;
  }

  const out = [];
  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i].rowIndex;
    const end = i + 1 < starts.length ? Math.max(start, starts[i + 1].rowIndex - 1) : rows.length - 1;
    out.push({
      id: `section-${i + 1}`,
      heading: deriveHeadingFromSummary(starts[i].heading || `Section ${i + 1}`, starts[i].summary || "", i),
      summary: starts[i].summary || "",
      startRow: start,
      endRow: end,
    });
  }
  return normalizeSectionRanges(rows, out);
}

function sectionDurationSeconds(rows, range) {
  const start = Math.max(0, Math.floor(Number(range?.startRow) || 0));
  const end = Math.max(start, Math.floor(Number(range?.endRow) || start));
  const first = rows[start];
  const last = rows[end];
  const since = Number(first?.since);
  const until = Number(last?.until ?? last?.since);
  if (!Number.isFinite(since) || !Number.isFinite(until) || until < since) return 0;
  return until - since;
}

function assertNoLongUnsummarizedSections(rows, ranges, maxSeconds = 900) {
  const violations = [];
  for (const r of Array.isArray(ranges) ? ranges : []) {
    const summary = String(r?.summary || "").trim();
    if (summary) continue;
    const dur = sectionDurationSeconds(rows, r);
    if (dur > maxSeconds) {
      violations.push({
        heading: String(r?.heading || ""),
        duration_seconds: Math.round(dur),
        start_row: Number(r?.startRow),
        end_row: Number(r?.endRow),
      });
    }
  }
  if (violations.length) {
    const first = violations[0];
    throw new Error(
      `[section-summary-contract] missing summary for long section (> ${maxSeconds}s): heading="${first.heading}" duration=${first.duration_seconds}s rows=${first.start_row}..${first.end_row}`
    );
  }
}

function buildPage({
  jurisdiction,
  body,
  dateIso,
  dateLong,
  hook,
  canonicalUrl,
  description,
  discussionUrl,
  sourceUrl,
  videoUrl,
  meetingUrl,
  agendaUrls,
  agendaCoverUrls,
  summary,
  topNewsworthyItems,
  topics,
  transcriptRows,
  transcriptSections,
  archiveJurUrl,
  archiveBodyUrl,
  transcriptStatus,
  agendaPageUrl,
}) {
  const title = hook
    ? `${hook} — ${jurisdiction} ${body} Transcript — ${dateLong}`
    : `${jurisdiction} ${body} Transcript — ${dateLong}`;
  const h1 = `${jurisdiction} ${body} Meeting Transcript — ${dateLong}`;
  const about = topics.join(", ");

  const renderEntry = (row) => {
    const jumpUrl = buildTimedVideoUrl(videoUrl || meetingUrl, row.since);
    const speaker = row.speaker
      ? `<a class="speaker-link" href="${escapeHtml(jumpUrl)}" aria-label="Jump to ${escapeHtml(row.speaker)} at ${fmtClock(row.since)}"><span class="speaker">${escapeHtml(row.speaker)}:</span></a> `
      : "";
    const ts = `<a class="timestamp" href="${escapeHtml(jumpUrl)}" aria-label="Timestamp ${fmtClock(row.since)}">${fmtClock(row.since)}</a>`;
    return `<div class="transcript-entry"><p>${ts} ${speaker}<span class="speech">${escapeHtml(row.speech)}</span></p></div>`;
  };

  const hasSections = Array.isArray(transcriptSections) && transcriptSections.length > 0;
  const summaryLooksDuplicate = (summaryText, firstRow) => {
    const a = normalizeText(summaryText);
    const b = normalizeText(firstRow);
    if (!a || !b) return false;
    if (a === b) return true;
    // Only hide summary when it is effectively the same sentence as the first row.
    // Do not hide longer summaries that happen to start with/contain the opening line.
    const minLen = Math.min(a.length, b.length);
    const maxLen = Math.max(a.length, b.length);
    const lenRatio = maxLen > 0 ? (minLen / maxLen) : 0;
    if (lenRatio < 0.92) return false;
    if (a.length >= 24 && b.includes(a)) return true;
    if (b.length >= 24 && a.includes(b)) return true;
    return false;
  };
  const mergedTopicRows = hasSections
    ? transcriptSections.map((s) => ({ href: `#${s.id}`, label: s.heading }))
    : topics.map((t) => ({ href: "#full-transcript", label: t }));
  const mergedTopicsHtml = `<nav class="toc" aria-label="Transcript topics and sections"><ol>${mergedTopicRows.map((row) => `<li><a href="${escapeHtml(row.href)}">${escapeHtml(row.label)}</a></li>`).join("")}</ol></nav>`;
  const transcriptHtml = hasSections
    ? transcriptSections.map((s) => {
      const rows = transcriptRows.slice(s.startRow, s.endRow + 1);
      const firstRowText = rows.length ? String(rows[0]?.speech || rows[0]?.raw || "").trim() : "";
      const showSummary = !summaryLooksDuplicate(String(s.summary || ""), firstRowText);
      const entries = rows.map(renderEntry).join("\n");
      return `<section id="${escapeHtml(s.id)}" class="transcript-section"><h3>${escapeHtml(s.heading)}</h3>${showSummary ? `<p class="section-summary">${escapeHtml(s.summary)}</p>` : ""}${entries}</section>`;
    }).join("\n")
    : transcriptRows.map(renderEntry).join("\n");

  const topicHtml = topics.map((t) => `<li>${escapeHtml(t)}</li>`).join("\n");
  const ld = {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    headline: title,
    datePublished: `${dateIso}T00:00:00-05:00`,
    dateModified: new Date().toISOString(),
    mainEntityOfPage: canonicalUrl,
    publisher: { "@type": "Organization", name: "HelpOS", url: SITE_URL_DEFAULT },
    about: topics,
    description,
  };

  return `<!doctype html>
<html lang="en-CA">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:type" content="article" />
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <style>
    :root { --bg:#faf8f2; --fg:#1c1f24; --muted:#5c6670; --line:#d7d2c6; --accent:#0f5f8f; }
    * { box-sizing:border-box; }
    body { margin:0; font-family: "Source Serif 4", Georgia, serif; background:var(--bg); color:var(--fg); line-height:1.6; }
    .wrap { max-width: 860px; margin: 0 auto; padding: 1.25rem 1rem 3rem; }
    nav.breadcrumbs { font-size:.95rem; color:var(--muted); margin-bottom:1rem; }
    nav.breadcrumbs a { color:var(--accent); text-decoration:none; }
    header h1 { margin:.2rem 0 .4rem; font-size:1.9rem; line-height:1.2; }
    .subtitle { color:var(--muted); margin:0 0 1rem; }
    .hook { display:inline-block; margin:.2rem 0 .55rem; padding:.2rem .5rem; border:1px solid var(--line); background:#fff; font-family:"IBM Plex Sans", Arial, sans-serif; font-size:.92rem; font-weight:700; }
    section { margin: 1.25rem 0 1.4rem; padding-top:.3rem; }
    h2 { font-family: "IBM Plex Sans", Arial, sans-serif; font-size:1.25rem; margin:0 0 .6rem; }
    h3 { font-family: "IBM Plex Sans", Arial, sans-serif; margin:.6rem 0 .4rem; font-size:1.02rem; }
    ul { margin:.25rem 0 .25rem 1.2rem; }
    .details dl { display:grid; grid-template-columns: 160px 1fr; gap:.25rem .75rem; margin:0; }
    .details dt { font-weight:700; font-family:"IBM Plex Sans", Arial, sans-serif; }
    .details dd { margin:0; }
    .notice { border:1px solid var(--line); background:#fff; padding:.75rem .85rem; }
    .notice p { margin:.35rem 0; }
    .newsworthy { margin:.5rem 0 0 0; padding:0; list-style:none; }
    .newsworthy li { border:1px solid var(--line); background:#fff; padding:.5rem .65rem; margin:.45rem 0; }
    .newsworthy li strong { font-family:"IBM Plex Sans", Arial, sans-serif; }
    .notice-brief { color:var(--muted); font-size:.93rem; border-top:1px solid var(--line); padding-top:.75rem; margin-top:1rem; }
    .discussion a, .links a { color:var(--accent); }
    .transcript-tools { margin:.4rem 0 .8rem; }
    .toc { margin:.3rem 0 .9rem; padding:.6rem .75rem; border:1px solid var(--line); background:#fff; }
    .toc ol { margin:.25rem 0 .1rem 1.2rem; }
    .toc a { color:var(--accent); text-decoration:none; }
    .transcript-section { margin: 1.1rem 0 1.25rem; }
    .transcript-section h3 { margin: 0 0 .35rem; font-family:"IBM Plex Sans", Arial, sans-serif; font-size:1.05rem; }
    .section-summary { margin:.1rem 0 .5rem; color:#26323e; background:#fff; border-left:3px solid var(--line); padding:.35rem .55rem; }
    .transcript-tools a { color:var(--accent); text-decoration:none; font-family:"IBM Plex Sans", Arial, sans-serif; }
    .transcript-entry { border-top:1px solid var(--line); padding:.58rem 0; }
    .transcript-entry p { margin:0; }
    .timestamp { color:var(--muted); text-decoration:none; font-size:.86rem; margin-right:.45rem; font-family:"IBM Plex Sans", Arial, sans-serif; }
    .speaker-link { color:inherit; text-decoration:none; }
    .speaker { font-weight:700; font-family:"IBM Plex Sans", Arial, sans-serif; }
    .speaker-link:hover .speaker, .speaker-link:focus .speaker { text-decoration:underline; }
    .speech { white-space:normal; }
    @media print { .transcript-entry { break-inside: avoid; } a { text-decoration:none; color:inherit; } }
  </style>
  <script type="application/ld+json">${JSON.stringify(ld)}</script>
</head>
<body>
  <main class="wrap">
    <nav class="breadcrumbs" aria-label="Breadcrumb">
      <a href="/">Home</a> / <a href="/transcripts">Transcripts</a> / <a href="${escapeHtml(archiveJurUrl)}">${escapeHtml(jurisdiction)}</a> / <a href="${escapeHtml(archiveBodyUrl)}">${escapeHtml(body)}</a> / <span>${escapeHtml(dateLong)}</span>
    </nav>

    <header>
      <h1>${escapeHtml(h1)}</h1>
      ${hook ? `<p class="hook">Hook: ${escapeHtml(hook)}</p>` : ""}
      <p class="subtitle">${escapeHtml(jurisdiction)} · ${escapeHtml(body)} · ${escapeHtml(dateLong)}</p>
    </header>

    <section id="summary">
      <h2>Summary</h2>
      <p>${escapeHtml(summary)}</p>
      ${topNewsworthyItems.length ? `<h3>Top Newsworthy Developments</h3><ul class="newsworthy">${topNewsworthyItems.map((item) => `<li><strong>${escapeHtml(item.title)}:</strong> ${escapeHtml(item.text)}</li>`).join("")}</ul>` : ""}
    </section>

    <section id="key-topics">
      <h2>Key Topics &amp; Sections</h2>
      ${mergedTopicsHtml}
    </section>

    <section id="details" class="details">
      <h2>Meeting Details</h2>
      <dl>
        <dt>Jurisdiction</dt><dd>${escapeHtml(jurisdiction)}</dd>
        <dt>Body</dt><dd>${escapeHtml(body)}</dd>
        <dt>Date</dt><dd>${escapeHtml(dateLong)}</dd>
        <dt>Transcript Status</dt><dd>${escapeHtml(transcriptStatus)}</dd>
        <dt>Official Source</dt><dd>${sourceUrl ? `<a href="${escapeHtml(sourceUrl)}">View official meeting page</a>` : (meetingUrl ? `<a href="${escapeHtml(meetingUrl)}">View official meeting page</a>` : "Not provided")}</dd>
        <dt>Agenda Page</dt><dd>${agendaPageUrl ? `<a href="${escapeHtml(agendaPageUrl)}">View agenda page</a>` : "Not available"}</dd>
        <dt>Original Video</dt><dd>${videoUrl ? `<a href="${escapeHtml(videoUrl)}">View original meeting video</a>` : "No direct video URL found in source metadata."}</dd>
        <dt>Meeting Portal</dt><dd>${meetingUrl ? `<a href="${escapeHtml(meetingUrl)}">View eScribe meeting page</a>` : "Not provided"}</dd>
      </dl>
    </section>

    <section id="discussion" class="discussion">
      <h2>Related Discussion</h2>
      <p>${discussionUrl ? `<a href="${escapeHtml(discussionUrl)}">Discuss this meeting on HelpOS</a>` : "HelpOS discussion thread link pending."}</p>
    </section>

    <section id="transcript-notice" class="notice" aria-labelledby="transcript-notice-title">
      <h2 id="transcript-notice-title">Transcript Notice</h2>
      <p>This transcript was generated automatically and may contain errors in wording, speaker identification, punctuation, or timestamps.</p>
      <p>It is an unofficial convenience copy provided for reading and searchability.</p>
      <p>For the official record, refer to the original source materials published by the relevant authority, including the official video, agenda, minutes, and meeting records.</p>
      <p>
        ${sourceUrl ? `<a href="${escapeHtml(sourceUrl)}">Official meeting source</a>` : ""}
        ${sourceUrl && (videoUrl || meetingUrl) ? " · " : ""}
        ${videoUrl ? `<a href="${escapeHtml(videoUrl)}">Official video / recording</a>` : (meetingUrl ? `<a href="${escapeHtml(meetingUrl)}">Official meeting portal</a>` : "")}
      </p>
    </section>

    <section id="full-transcript">
      <h2>Full Transcript</h2>
      <p class="transcript-tools"><a href="#full-transcript">Jump to transcript</a></p>
      ${transcriptHtml}
    </section>

    <section id="related-links" class="links">
      <h2>Related Links</h2>
      <ul>
        <li><a href="${escapeHtml(archiveJurUrl)}">More ${escapeHtml(jurisdiction)} transcripts</a></li>
        <li><a href="${escapeHtml(archiveBodyUrl)}">More ${escapeHtml(body)} transcripts</a></li>
        ${sourceUrl ? `<li><a href="${escapeHtml(sourceUrl)}">Official meeting source</a></li>` : ""}
        ${agendaPageUrl ? `<li><a href="${escapeHtml(agendaPageUrl)}">Agenda page</a></li>` : ""}
        ${meetingUrl ? `<li><a href="${escapeHtml(meetingUrl)}">Official eScribe meeting page</a></li>` : ""}
        ${agendaCoverUrls.map((u) => `<li><a href="${escapeHtml(u)}">Agenda cover</a></li>`).join("")}
        ${agendaUrls.map((u) => `<li><a href="${escapeHtml(u)}">Agenda</a></li>`).join("")}
        ${videoUrl ? `<li><a href="${escapeHtml(videoUrl)}">Original meeting video</a></li>` : ""}
      </ul>
    </section>
    <p class="notice-brief">Unofficial machine-generated transcript for convenience. Please verify against official source materials for the authoritative record.</p>
  </main>
</body>
</html>`;
}

function main() {
  const transcriptDirArg = process.argv[2];
  const outputArg = process.argv[3] || "transcript-page.html";
  const jurisdictionArg = process.argv[4] || "Owen Sound";
  const bodyArg = process.argv[5] || "Council";
  const siteUrlArg = process.argv[6] || SITE_URL_DEFAULT;
  const discussionArg = process.argv[7] || "";
  const sourceArg = process.argv[8] || "";
  const videoArg = process.argv[9] || "";
  const hookArg = process.argv[10] || "";
  const agendaPageArg = process.argv[11] || "";

  if (!transcriptDirArg) {
    process.stdout.write(`${usage()}\n`);
    process.exit(2);
  }

  const transcriptDir = path.resolve(process.cwd(), transcriptDirArg);
  const st = fs.statSync(transcriptDir, { throwIfNoEntry: false });
  if (!st || !st.isDirectory()) throw new Error(`transcript directory not found: ${transcriptDir}`);

  const forceMergedSrt = /^(1|true|yes)$/iu.test(String(process.env.PYA_TRANSCRIPT_FORCE_MERGED_SRT || "").trim());
  let srtPath = forceMergedSrt
    ? pickFile(transcriptDir, [
      /\.normalized\.sentences\.merged\.srt$/u,
      /\.sentences\.merged\.srt$/u,
    ])
    : pickFile(transcriptDir, [
      /\.normalized\.sentences\.speaker\.sentence\.srt$/u,
      /\.speaker\.sentence\.srt$/u,
    ]);
  if (!srtPath && forceMergedSrt) {
    srtPath = pickFile(transcriptDir, [
      /\.normalized\.sentences\.speaker\.sentence\.srt$/u,
      /\.speaker\.sentence\.srt$/u,
    ]);
  }
  if (!srtPath) throw new Error(`speaker sentence srt not found in ${transcriptDir}`);
  let srtText = fs.readFileSync(srtPath, "utf8");
  let expectSpeaker = /speaker\.sentence\.srt$/iu.test(path.basename(srtPath));
  let transcriptRows = parseSrt(srtText, { expectSpeaker });
  if (!transcriptRows.length) throw new Error(`no transcript rows parsed from ${srtPath}`);

  // Keep canonical cue timing from speaker sentence SRT and only merge speaker labels
  // from JSON, so transcript timing cannot drift from the SRT timeline.
  const speakerRowsJsonPath = pickFile(transcriptDir, [/\.normalized\.sentences\.speaker\.sentences\.json$/u, /\.speaker\.sentences\.json$/u]);
  if (speakerRowsJsonPath) {
    const jsonRows = parseSpeakerRowsJson(fs.readFileSync(speakerRowsJsonPath, "utf8"));
    if (jsonRows.length >= Math.max(25, Math.floor(transcriptRows.length * 0.6))) {
      const mergeByIndex = Math.abs(jsonRows.length - transcriptRows.length) <= 3;
      if (mergeByIndex) {
        transcriptRows = mergeSpeakerLabelsByIndex(transcriptRows, jsonRows);
        process.stdout.write(`[transcript-html] merged speaker labels by index from json: ${speakerRowsJsonPath} (${jsonRows.length} rows)\n`);
      } else {
        transcriptRows = mergeSpeakerLabelsByTime(transcriptRows, jsonRows, 0.35);
        process.stdout.write(`[transcript-html] merged speaker labels by time from json: ${speakerRowsJsonPath} (${jsonRows.length} rows)\n`);
      }
    }
  }

  // Guard against truncated speaker SRT checkpoints; fall back to full sentence-merged SRT.
  const fallbackSrtPath = pickFile(transcriptDir, [
    /\.normalized\.sentences\.merged\.srt$/u,
    /\.sentences\.merged\.srt$/u,
  ]);
  if (fallbackSrtPath && fallbackSrtPath !== srtPath) {
    const fallbackText = fs.readFileSync(fallbackSrtPath, "utf8");
    const fallbackCueCount = countSrtCues(fallbackText);
    const fallbackRows = parseSrt(fallbackText, { expectSpeaker: false });
    const currentEnd = Number(transcriptRows[transcriptRows.length - 1]?.until || 0);
    const fallbackEnd = Number(fallbackRows[fallbackRows.length - 1]?.until || 0);
    const looksTruncatedByCount = fallbackCueCount >= 50 && transcriptRows.length < Math.floor(fallbackCueCount * 0.5);
    const looksTruncatedByEndTime = fallbackCueCount >= 50 && fallbackEnd > 0 && (fallbackEnd - currentEnd) > 30;
    if (looksTruncatedByCount || looksTruncatedByEndTime) {
      const speakerRows = transcriptRows;
      srtPath = fallbackSrtPath;
      srtText = fallbackText;
      expectSpeaker = false;
      const baseRows = fallbackRows.length ? fallbackRows : parseSrt(srtText, { expectSpeaker });
      transcriptRows = mergeSpeakerLabelsByTime(baseRows, speakerRows, 0.35);
      const labeled = transcriptRows.filter((r) => String(r.speaker || "").trim()).length;
      process.stdout.write(`[transcript-html] warn: speaker srt timeline looks truncated; merged labels onto fallback srt (${labeled}/${transcriptRows.length}) from ${srtPath}\n`);
    }
  }

  const agendaSummaryPath = pickFile(transcriptDir, [/\.agenda-summary\.md$/u]);
  const agendaSummaryJsonPath = pickFile(transcriptDir, [/\.agenda-summary\.json$/u]);
  const agendaMatchesPath = pickFile(transcriptDir, [/\.agenda\.matches\.json$/u]);
  const agendaWiseSeriesPath = pickFile(transcriptDir, [/\.agenda-wise\.series\.pya$/u]);
  const agendaGrossChunksPath = pickFile(transcriptDir, [/\.agenda\.gross-chunks\.json$/u]);
  const meetingSummaryPath = pickFile(transcriptDir, [/\.meeting-summary\.md$/u]);
  const agendaSummary = agendaSummaryPath ? fs.readFileSync(agendaSummaryPath, "utf8") : "";
  let agendaSummaryJson = {};
  let agendaMatches = {};
  let wiseRanges = [];
  if (agendaSummaryJsonPath) {
    try { agendaSummaryJson = JSON.parse(fs.readFileSync(agendaSummaryJsonPath, "utf8")); } catch {}
  }
  if (agendaMatchesPath) {
    try { agendaMatches = JSON.parse(fs.readFileSync(agendaMatchesPath, "utf8")); } catch {}
  }
  if (agendaWiseSeriesPath) {
    try { wiseRanges = parseWiseRanges(fs.readFileSync(agendaWiseSeriesPath, "utf8")); } catch {}
  }
  const grossChunks = agendaGrossChunksPath
    ? parseGrossChunks(fs.readFileSync(agendaGrossChunksPath, "utf8"))
    : [];
  const meetingSummary = meetingSummaryPath ? fs.readFileSync(meetingSummaryPath, "utf8") : "";
  const meetingDir = path.dirname(transcriptDir);
  const meetingJsonPath = path.join(meetingDir, "meeting.json");
  let meetingPayload = {};
  if (fs.existsSync(meetingJsonPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(meetingJsonPath, "utf8"));
      meetingPayload = parsed?.payload && typeof parsed.payload === "object" ? parsed.payload : {};
    } catch {}
  }

  const topics = distinct(parseMdHeadings(agendaSummary)).slice(0, 10);
  if (!topics.length) {
    topics.push("Council procedure", "Public forum", "Planning and development");
  }

  const leadSummary = extractWholeMeetingLead(meetingSummary);
  const topNewsworthyItems = extractTopNewsworthyItems(meetingSummary, 6);
  const summary = firstSentences(
    leadSummary || stripMarkdown(meetingSummary || agendaSummary || transcriptRows.slice(0, 12).map((x) => x.raw).join(" ")),
    5
  );
  const meetingDirName = path.basename(path.dirname(transcriptDir));
  const dateInfo = deriveDateText(meetingDirName);
  const jurisdictionSlug = slugify(jurisdictionArg);
  const bodySlug = slugify(bodyArg);
  const canonicalUrl = `${siteUrlArg.replace(/\/+$/u, "")}/transcripts/${jurisdictionSlug}/${bodySlug}/${dateInfo.iso || "unknown-date"}`;
  const inferredAgendaPage = `${siteUrlArg.replace(/\/+$/u, "")}/agendas/${jurisdictionSlug}/${bodySlug}/${dateInfo.iso || "unknown-date"}`;
  const descTopics = topics.slice(0, 3).join(", ");
  const description = `Transcript and summary of the ${jurisdictionArg} ${bodyArg} meeting held on ${dateInfo.long}, including discussion of ${descTopics}.`;
  const archiveJurUrl = `/transcripts/${jurisdictionSlug}`;
  const archiveBodyUrl = `/transcripts/${jurisdictionSlug}/${bodySlug}`;

  const meetingUrl = String(meetingPayload?.meeting_url || "").trim();
  const agendaUrls = Array.isArray(meetingPayload?.agenda) ? meetingPayload.agenda.filter((x) => /^https?:\/\//iu.test(String(x || ""))) : [];
  const agendaCoverUrls = Array.isArray(meetingPayload?.agenda_cover) ? meetingPayload.agenda_cover.filter((x) => /^https?:\/\//iu.test(String(x || ""))) : [];
  const payloadVideoDirect = Array.isArray(meetingPayload?.video_direct)
    ? meetingPayload.video_direct.filter((x) => /^https?:\/\//iu.test(String(x || "")))
    : [];
  const payloadVideo = Array.isArray(meetingPayload?.video)
    ? meetingPayload.video.filter((x) => /^https?:\/\//iu.test(String(x || "")))
    : [];
  const finalVideo = videoArg || payloadVideoDirect[0] || payloadVideo[0] || "";
  const finalSource = sourceArg || meetingUrl || "";
  const finalAgendaPage = String(agendaPageArg || inferredAgendaPage).trim();

  const transcriptSections = buildSectionRanges({
    transcriptRows,
    sectionSummaries: agendaSummaryJson?.sections,
    agendaMatches,
    wiseRanges,
    grossChunks,
  });
  assertNoLongUnsummarizedSections(
    transcriptRows,
    transcriptSections,
    Number(process.env.PYA_SECTION_SUMMARY_REQUIRED_MAX_SECONDS || 900)
  );
  if (String(process.env.PYA_TRANSCRIPT_DEBUG || "").trim() === "1") {
    const summedRows = transcriptSections.reduce(
      (sum, s) => sum + Math.max(0, (Number(s?.endRow) - Number(s?.startRow) + 1)),
      0
    );
    process.stdout.write(`[transcript-html][debug] rows=${transcriptRows.length} sections=${transcriptSections.length} rows_in_sections=${summedRows}\n`);
    for (let i = 0; i < Math.min(12, transcriptSections.length); i += 1) {
      const s = transcriptSections[i];
      process.stdout.write(`[transcript-html][debug] section ${i + 1}: ${Number(s?.startRow)}..${Number(s?.endRow)} ${String(s?.heading || "").slice(0, 80)}\n`);
    }
  }

  const html = buildPage({
    jurisdiction: jurisdictionArg,
    body: bodyArg,
    dateIso: dateInfo.iso || "1970-01-01",
    dateLong: dateInfo.long,
    hook: hookArg,
    canonicalUrl,
    description,
    discussionUrl: discussionArg,
    sourceUrl: finalSource,
    videoUrl: finalVideo,
    meetingUrl,
    agendaUrls,
    agendaCoverUrls,
    summary,
    topNewsworthyItems,
    topics,
    transcriptRows,
    transcriptSections,
    archiveJurUrl,
    archiveBodyUrl,
    transcriptStatus: "Machine transcription, lightly cleaned",
    agendaPageUrl: finalAgendaPage,
  });

  const outPath = path.resolve(transcriptDir, outputArg);
  fs.writeFileSync(outPath, html, "utf8");
  process.stdout.write(`[transcript-html] source srt: ${srtPath}\n`);
  process.stdout.write(`[transcript-html] output: ${outPath}\n`);
  process.stdout.write(`[transcript-html] canonical: ${canonicalUrl}\n`);
}

main();
