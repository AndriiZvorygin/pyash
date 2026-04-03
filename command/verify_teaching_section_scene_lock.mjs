#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

function countAlignedCues(srtText = "") {
  return String(srtText ?? "")
    .split(/\r?\n/u)
    .filter((line) => /-->/.test(line))
    .length;
}

function countSectionCuts(seriesText = "") {
  return String(seriesText ?? "")
    .split(/\r?\n/u)
    .filter((line) => /^su name cut \d+/u.test(String(line ?? "").trim()))
    .length;
}

async function countDrawPngs(drawDir = "") {
  try {
    const entries = await fs.readdir(drawDir);
    return entries.filter((name) => /^section-draw-stage-cut-\d+\.png$/u.test(String(name ?? ""))).length;
  } catch {
    return 0;
  }
}

export async function analyzeTeachingSectionSceneLock(artifactDir = "") {
  const root = String(artifactDir ?? "").trim();
  const sectionsDir = path.join(root, "sections");
  const out = {
    ok: true,
    artifactDir: root,
    sections: []
  };
  let sectionDirs = [];
  try {
    const entries = await fs.readdir(sectionsDir, { withFileTypes: true });
    sectionDirs = entries
      .filter((entry) => entry.isDirectory() && /^paragraph-\d+$/u.test(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => Number(a.split("-")[1]) - Number(b.split("-")[1]));
  } catch {
    return { ...out, ok: false, error: "sections directory missing" };
  }
  for (const name of sectionDirs) {
    const dir = path.join(sectionsDir, name);
    const alignedFile = path.join(dir, "captions-aligned.srt");
    const cutsFile = path.join(dir, "section-cuts.series.pya");
    const drawDir = path.join(dir, "draw");
    let alignedCount = 0;
    let cutCount = 0;
    try {
      alignedCount = countAlignedCues(await fs.readFile(alignedFile, "utf8"));
    } catch {
      alignedCount = 0;
    }
    try {
      cutCount = countSectionCuts(await fs.readFile(cutsFile, "utf8"));
    } catch {
      cutCount = 0;
    }
    const drawCount = await countDrawPngs(drawDir);
    const row = {
      section: name,
      alignedCount,
      cutCount,
      drawCount,
      ok: alignedCount > 0 && alignedCount === cutCount && cutCount === drawCount
    };
    if (!row.ok) out.ok = false;
    out.sections.push(row);
  }
  if (!out.sections.length) {
    out.ok = false;
    out.error = "no paragraph sections found";
  }
  return out;
}

async function main() {
  const target = String(process.argv[2] ?? "").trim();
  if (!target) {
    process.stderr.write("Usage: node command/verify_teaching_section_scene_lock.mjs <artifact-dir>\n");
    process.exit(2);
  }
  const result = await analyzeTeachingSectionSceneLock(target);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    process.stderr.write(`${String(err?.message ?? err)}\n`);
    process.exit(1);
  });
}

