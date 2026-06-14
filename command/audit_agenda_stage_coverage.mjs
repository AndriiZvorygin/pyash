#!/usr/bin/env node
import { readPyaMapArtifact } from "../program/library/reporter_shared/agenda-stage-contracts.mjs";

function usage() {
  return [
    "Usage: node command/audit_agenda_stage_coverage.mjs <section_grounding.pya> [agenda_summary.pya]",
    "Checks Stage 2 row coverage, long-section chapter coverage, chapter source size, and optional Stage 3 chapter counts.",
  ].join("\n");
}

function fail(message, details = {}) {
  return { level: "error", message, ...details };
}

function warn(message, details = {}) {
  return { level: "warn", message, ...details };
}

async function main() {
  const groundingPath = process.argv[2];
  const summaryPath = process.argv[3] || "";
  if (!groundingPath) {
    process.stderr.write(`${usage()}\n`);
    process.exit(2);
  }

  const maxGapRows = Math.max(0, Number(process.env.AGENDA_MAX_GAP_ROWS || 3));
  const splitSeconds = Math.max(60, Number(process.env.AGENDA_SECTION_SPLIT_SECONDS || 900));
  const maxChapterChars = Math.max(2000, Number(process.env.AGENDA_CHAPTER_MAX_SOURCE_CHARS || 12000));

  const grounding = await readPyaMapArtifact(groundingPath, "agenda section grounding artifact");
  const units = Array.isArray(grounding?.["grounded units"]) ? grounding["grounded units"] : [];
  const issues = [];

  if (!units.length) issues.push(fail("no grounded units"));

  const sorted = units.slice().sort((a, b) => Number(a["row start"]) - Number(b["row start"]));
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const gap = Number(cur["row start"]) - Number(prev["row end"]) - 1;
    if (gap > maxGapRows && String(cur["gap status"] || "").toLowerCase() !== "allowed") {
      issues.push(fail("row gap between grounded units", {
        previous: prev["unit id"],
        current: cur["unit id"],
        gap,
      }));
    }
    if (Number(cur["row start"]) <= Number(prev["row end"])) {
      issues.push(fail("overlap between grounded units", {
        previous: prev["unit id"],
        current: cur["unit id"],
      }));
    }
  }

  for (const unit of sorted) {
    const chapters = Array.isArray(unit["child chapters"]) ? unit["child chapters"] : [];
    const duration = Number(unit["duration seconds"] || 0);
    if (duration > splitSeconds && chapters.length < 2) {
      issues.push(fail("long grounded unit lacks child chapters", {
        "unit id": unit["unit id"],
        label: unit.label,
        duration,
        splitSeconds,
      }));
    }
    if (chapters.length >= 2) {
      const expectedStart = Number(unit["row start"]);
      const expectedEnd = Number(unit["row end"]);
      if (Number(chapters[0]["row start"]) !== expectedStart) {
        issues.push(fail("chapter coverage does not start at parent", { "unit id": unit["unit id"] }));
      }
      if (Number(chapters[chapters.length - 1]["row end"]) !== expectedEnd) {
        issues.push(fail("chapter coverage does not end at parent", { "unit id": unit["unit id"] }));
      }
      for (let i = 1; i < chapters.length; i += 1) {
        if (Number(chapters[i]["row start"]) !== Number(chapters[i - 1]["row end"]) + 1) {
          issues.push(fail("chapter row gap", {
            "unit id": unit["unit id"],
            previous: chapters[i - 1]["chapter id"],
            current: chapters[i]["chapter id"],
          }));
        }
      }
    }
    for (const chapter of chapters) {
      const chars = Number(chapter["source chars"] || 0);
      if (chars > maxChapterChars) {
        issues.push(fail("child chapter exceeds source char cap", {
          "unit id": unit["unit id"],
          "chapter id": chapter["chapter id"],
          chars,
          maxChapterChars,
        }));
      }
    }
  }

  if (summaryPath) {
    const summary = await readPyaMapArtifact(summaryPath, "agenda summary artifact");
    const sections = Array.isArray(summary?.sections) ? summary.sections : [];
    if (sections.length !== units.length) {
      issues.push(fail("Stage 3 section count differs from Stage 2", {
        expected: units.length,
        actual: sections.length,
      }));
    }
    const byUnit = new Map(units.map((u) => [String(u["unit id"] || ""), u]));
    for (const section of sections) {
      const unitId = String(section?.["unit id"] || "");
      const expected = Array.isArray(byUnit.get(unitId)?.["child chapters"]) ? byUnit.get(unitId)["child chapters"].length : 0;
      const actual = Array.isArray(section?.chapters) ? section.chapters.length : 0;
      if (expected !== actual) {
        issues.push(fail("Stage 3 chapter count differs from Stage 2", { "unit id": unitId, expected, actual }));
      }
    }
  } else {
    issues.push(warn("Stage 3 summary not provided; skipped Stage 3 chapter-count audit"));
  }

  const errors = issues.filter((x) => x.level === "error");
  const report = {
    decision: errors.length ? "FAIL" : "PASS",
    "grounded units": units.length,
    issues,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(errors.length ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`${String(err?.stack || err?.message || err)}\n`);
  process.exit(1);
});
