#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const [transcriptDirArg, prefix = "meeting-qwen-auto-normalized"] = process.argv.slice(2);
if (!transcriptDirArg) throw new Error("Usage: node command/retime_chapter_artifacts_from_srt.mjs <transcript_dir> [prefix]");
const dir = path.resolve(transcriptDirArg);

function parseTime(raw) {
  const m = String(raw).match(/(\d\d):(\d\d):(\d\d),(\d\d\d)/u);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000 : 0;
}

function formatTime(seconds, separator = ",") {
  const ms = Math.max(0, Math.round(Number(seconds) * 1000));
  const hh = Math.floor(ms / 3600000);
  const mm = Math.floor((ms % 3600000) / 60000);
  const ss = Math.floor((ms % 60000) / 1000);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}${separator}${String(ms % 1000).padStart(3, "0")}`;
}

function parseSrt(file) {
  return fs.readFileSync(file, "utf8").trim().split(/\r?\n\r?\n+/u).map((block) => {
    const lines = block.split(/\r?\n/u);
    const m = String(lines[1] || "").match(/^(.+?)\s+-->\s+(.+)$/u);
    return { lines, since: parseTime(m?.[1]), until: parseTime(m?.[2]) };
  }).filter((row) => row.lines.length >= 3);
}

function pyaEsc(text) {
  return String(text).replace(/\\/gu, "\\\\").replace(/"/gu, '\\"');
}

function decodePayload(raw) {
  return JSON.parse(JSON.parse(`"${raw}"`));
}

const sentencePath = path.join(dir, `${prefix}.sentences.merged.srt`);
const rows = parseSrt(sentencePath);
if (!rows.length) throw new Error(`No rows in ${sentencePath}`);

const ranges = new Map();
function retimePya(file, rootPattern) {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/u).map((line) => {
    const m = line.match(rootPattern);
    if (!m) return line;
    const payload = decodePayload(m[5]);
    const id = String(payload["chapter id"] || payload["chunk id"] || m[2]);
    const start = rows[Number(payload["row start"])];
    const end = rows[Number(payload["row end"])];
    const prior = ranges.get(id);
    if ((!start || !end) && !prior) throw new Error(`Invalid row span in ${file}: ${payload["row start"]}-${payload["row end"]}`);
    const since = start?.since ?? prior.since;
    const until = end?.until ?? prior.until;
    payload.since = since;
    payload.until = until;
    payload["duration seconds"] = Math.max(0, until - since);
    ranges.set(id, { since, until, title: payload["chapter title"] || prior?.title || "" });
    return `${m[1]}${id} since num ${since.toFixed(3)} until num ${until.toFixed(3)} ob text "${pyaEsc(JSON.stringify(payload))}" ya`;
  });
  fs.writeFileSync(file, lines.join("\n"), "utf8");
}

retimePya(
  path.join(dir, `${prefix}.chapter.gross-chunks.pya`),
  /^(su name chapter gross chunk\s+)([^\s]+)\s+since num\s+([0-9.]+)\s+until num\s+([0-9.]+)\s+ob text\s+"([\s\S]+)"\s+ya$/u
);
retimePya(
  path.join(dir, `${prefix}.chapter.grounding.pya`),
  /^(su name chapter grounding unit\s+)([^\s]+)\s+since num\s+([0-9.]+)\s+until num\s+([0-9.]+)\s+ob text\s+"([\s\S]+)"\s+ya$/u
);
retimePya(
  path.join(dir, `${prefix}.chapter-summary.pya`),
  /^(su name chapter summary unit\s+)([^\s]+)\s+since num\s+([0-9.]+)\s+until num\s+([0-9.]+)\s+ob text\s+"([\s\S]+)"\s+ya$/u
);

const ordered = [...ranges.entries()].filter(([id]) => id.startsWith("chapter_")).sort((a, b) => a[1].since - b[1].since);
fs.writeFileSync(path.join(dir, `${prefix}.chapters.txt`), ordered.map(([, r]) => `${formatTime(r.since, ":").slice(0, 8)} ${r.title}`).join("\n") + "\n");
fs.writeFileSync(path.join(dir, `${prefix}.chapter-wise.series.pya`), [
  "su name chapter wise series artifact be series def",
  ...ordered.map(([id, r]) => `su name chapter wise chip ${id} since num ${r.since.toFixed(3)} until num ${r.until.toFixed(3)} ob text "${pyaEsc(r.title)}" ya`),
  "prah",
  "",
].join("\n"));
const chapterSummaryMdPath = path.join(dir, `${prefix}.chapter-summary.md`);
if (fs.existsSync(chapterSummaryMdPath)) {
  let rangeIndex = 0;
  const md = fs.readFileSync(chapterSummaryMdPath, "utf8").replace(
    /^Time:\s+\d\d:\d\d:\d\d\s+-\s+\d\d:\d\d:\d\d\s*$/gmu,
    () => {
      const range = ordered[rangeIndex++]?.[1];
      return range
        ? `Time: ${formatTime(range.since, ":").slice(0, 8)} - ${formatTime(range.until, ":").slice(0, 8)}`
        : "";
    }
  );
  fs.writeFileSync(chapterSummaryMdPath, md, "utf8");
}

const speakerSrtPath = path.join(dir, `${prefix}.sentences.speaker.sentence.srt`);
if (fs.existsSync(speakerSrtPath)) {
  const speakerRows = parseSrt(speakerSrtPath);
  if (Math.abs(speakerRows.length - rows.length) > 3) throw new Error("Speaker SRT row count differs from corrected sentence SRT");
  fs.writeFileSync(speakerSrtPath, speakerRows.map((row, i) => {
    const timing = rows[i] || rows[rows.length - 1];
    row.lines[1] = `${formatTime(timing.since)} --> ${formatTime(timing.until)}`;
    return row.lines.join("\n");
  }).join("\n\n") + "\n");
}

const speakerJsonPath = path.join(dir, `${prefix}.sentences.speaker.sentences.json`);
if (fs.existsSync(speakerJsonPath)) {
  const data = JSON.parse(fs.readFileSync(speakerJsonPath, "utf8"));
  for (let i = 0; i < (data.rows || []).length; i += 1) {
    const timing = rows[i] || rows[rows.length - 1];
    data.rows[i].since = timing.since;
    data.rows[i].until = timing.until;
  }
  fs.writeFileSync(speakerJsonPath, `${JSON.stringify(data, null, 2)}\n`);
}

const chapterLineByTitle = new Map(ordered.map(([, r]) => [r.title, `- ${formatTime(r.since, ":").slice(0, 8)} ${r.title}`]));
const retimeChapterList = (text) => String(text).replace(
  /^-\s+\d\d:\d\d:\d\d\s+(.+)$/gmu,
  (line, title) => chapterLineByTitle.get(String(title).trim()) || line
);
const lemmyMdPath = path.join(dir, `${prefix}.lemmy-post.md`);
if (fs.existsSync(lemmyMdPath)) fs.writeFileSync(lemmyMdPath, retimeChapterList(fs.readFileSync(lemmyMdPath, "utf8")), "utf8");
const lemmyJsonPath = path.join(dir, `${prefix}.lemmy-post.json`);
if (fs.existsSync(lemmyJsonPath)) {
  const data = JSON.parse(fs.readFileSync(lemmyJsonPath, "utf8"));
  data.body_markdown = retimeChapterList(data.body_markdown);
  fs.writeFileSync(lemmyJsonPath, `${JSON.stringify(data, null, 2)}\n`);
}

process.stdout.write(`[retime-chapters] rows=${rows.length} chapters=${ordered.length} end=${formatTime(rows.at(-1).until)}\n`);
