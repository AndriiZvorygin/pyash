#!/usr/bin/env node
import fs from "node:fs/promises";
import { parseSrtToCuts } from "./itinerary_io.mjs";

function usage() {
  return "Usage: node command/srt_section_collapse.mjs <input.srt> <output.srt>";
}

function formatSrtTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const totalMs = Math.round(safe * 1000);
  const hh = Math.floor(totalMs / 3600000);
  const mm = Math.floor((totalMs % 3600000) / 60000);
  const ss = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function parseSectionLine(text) {
  const raw = String(text ?? "").trim();
  const m = /^\[([^\]]+)\]\s*(.*)$/u.exec(raw);
  if (!m) return { section: "Section", line: raw };
  const section = String(m[1] ?? "").trim().replace(/\s+/gu, " ");
  const line = String(m[2] ?? "").trim();
  return { section: section || "Section", line };
}

function collapseBySection(cuts = []) {
  const groups = [];
  for (const cut of cuts) {
    const since = Number(cut?.since ?? 0);
    const until = Number(cut?.until ?? since);
    const { section, line } = parseSectionLine(cut?.obText);
    const last = groups[groups.length - 1];
    if (!last || last.section !== section) {
      groups.push({
        section,
        since,
        until,
        lines: line ? [line] : []
      });
      continue;
    }
    last.until = Math.max(last.until, until);
    if (line) last.lines.push(line);
  }
  return groups.map((group, idx) => {
    const joined = group.lines.join(" ").replace(/\s+/gu, " ").trim();
    const text = joined ? `[${group.section}] ${joined}` : `[${group.section}]`;
    return {
      index: idx + 1,
      since: group.since,
      until: Math.max(group.since + 0.06, group.until),
      text
    };
  });
}

async function main() {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) throw new Error(usage());
  const srtText = await fs.readFile(inputPath, "utf8");
  const cuts = parseSrtToCuts(srtText);
  const rows = collapseBySection(cuts);
  if (!rows.length) throw new Error("srt section collapse defective: no rows");
  const out = [];
  for (const row of rows) {
    out.push(String(row.index));
    out.push(`${formatSrtTime(row.since)} --> ${formatSrtTime(row.until)}`);
    out.push(row.text);
    out.push("");
  }
  await fs.writeFile(outputPath, `${out.join("\n")}\n`, "utf8");
  process.stdout.write(`${outputPath}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err?.message ?? String(err)}\n`);
  process.exit(1);
});
