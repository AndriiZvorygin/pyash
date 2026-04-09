import fs from "node:fs";
import path from "node:path";

function pickLargestFileFromDir(dirPath, matcher) {
  if (!dirPath || !fs.existsSync(dirPath)) return "";
  const ranked = fs.readdirSync(dirPath)
    .filter((name) => matcher.test(name))
    .map((name) => {
      const full = path.join(dirPath, name);
      const st = fs.statSync(full, { throwIfNoEntry: false });
      return {
        full,
        name,
        size: Number(st?.size || 0),
        mtime: Number(st?.mtimeMs || 0),
      };
    })
    .sort((a, b) => b.size - a.size || b.mtime - a.mtime || a.name.localeCompare(b.name));
  return ranked.length ? ranked[0].full : "";
}

export function pickRichestAgendaMarkdownPathFromConvertedDir(convertedDir) {
  return pickLargestFileFromDir(convertedDir, /^agenda-\d+(?:-[a-z0-9-]+)?\.md$/iu);
}

export function pickRichestAgendaPrunedMarkdownPathFromConvertedDir(convertedDir) {
  return pickLargestFileFromDir(convertedDir, /^agenda-\d+(?:-[a-z0-9-]+)?\.pruned\.md$/iu);
}

export function pickRichestAgendaPdfPathFromSourceDir(sourceDir) {
  return pickLargestFileFromDir(sourceDir, /^agenda-\d+\.pdf$/iu);
}

export function pickRichestAgendaPathFromMeetingDir(meetingDir) {
  const convertedDir = path.join(meetingDir, "converted");
  const pruned = pickRichestAgendaPrunedMarkdownPathFromConvertedDir(convertedDir);
  if (pruned) return pruned;
  return pickRichestAgendaMarkdownPathFromConvertedDir(convertedDir);
}

function cleanSummaryText(value) {
  return String(value || "")
    .split(/\r?\n/u)
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((line) => !/\|\s*gender\s*:/iu.test(line))
    .filter((line) => !/\|\s*role\s*:/iu.test(line))
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function toOneSentenceSummary(value, fallback = "Agenda preview is available.") {
  const text = cleanSummaryText(value);
  if (!text) return fallback;
  const stripped = text
    .replace(/^The agenda(?:'s)? most newsworthy items include\s+/iu, "")
    .replace(/^Most newsworthy agenda items include\s+/iu, "")
    .replace(/[.!?]+$/u, "")
    .trim();
  const parts = stripped
    .split(/\s*;\s*/u)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 3);
  const core = parts.join("; ").replace(/\s+/gu, " ").trim();
  if (!core) return fallback;
  const sentence = `Upcoming agenda highlights ${core}.`;
  return sentence.length <= 280 ? sentence : `${sentence.slice(0, 277).trim()}...`;
}

export function parseTopNewsHeadlines(markdownText = "") {
  const lines = String(markdownText || "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => /^[-*+]\s+/u.test(line) || /^\d+\.\s+/u.test(line));
  const seen = new Set();
  const out = [];
  for (const line of lines) {
    const noMarker = line.replace(/^[-*+]\s+/u, "").replace(/^\d+\.\s+/u, "").trim();
    const bold = noMarker.match(/\*\*(.+?)\*\*/u);
    const raw = bold ? bold[1] : noMarker.split(/[.:]/u)[0];
    const cleaned = cleanSummaryText(raw).replace(/[`*_]/gu, "").trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

export function deriveWholeAgendaSummaryFromTopNews(topNewsMarkdown, fallback) {
  const headlines = parseTopNewsHeadlines(topNewsMarkdown);
  if (!headlines.length) return cleanSummaryText(fallback || "Agenda preview is available.");
  const list = headlines.slice(0, 5).join("; ");
  return `The agenda's most newsworthy items include ${list}.`;
}
