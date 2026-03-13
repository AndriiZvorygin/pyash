#!/usr/bin/env node
import fs from "node:fs/promises";

function normalizeText(value) {
  return String(value ?? "").replace(/\r\n?/gu, "\n");
}

function chooseMarker(matches = []) {
  if (!matches.length) return "";
  const afterLead = matches.find((match) => match.index >= 80);
  return String((afterLead ?? matches[0]).marker ?? "").trim();
}

function collectMatches(source, pattern) {
  const matches = [];
  for (const match of source.matchAll(pattern)) {
    const marker = String(match[0] ?? "").trim();
    if (!marker) continue;
    matches.push({ index: Number(match.index ?? 0), marker });
  }
  return matches;
}

function looksLikeQaStyle(styleText) {
  const style = styleText.toLowerCase();
  return (
    style.includes("question and answer")
    || style.includes("question-answer")
    || style.includes("q/a")
    || (style.includes("question") && style.includes("answer"))
  );
}

function looksLikeHeadingStyle(styleText) {
  const style = styleText.toLowerCase();
  return (
    style.includes("section")
    || style.includes("heading")
    || style.includes("agenda")
    || style.includes("chapter")
    || style.includes("minutes")
    || style.includes("topic block")
  );
}

export function findProgrammaticBoundary(sourceText, styleText) {
  const source = normalizeText(sourceText);
  const style = String(styleText ?? "");

  if (looksLikeQaStyle(style)) {
    const qaPatterns = [
      /^(?:Questioner|Question|Q)\s*:\s*.+$/gimu,
      /^(?:Questioner|Question)\s+.+$/gimu
    ];
    for (const pattern of qaPatterns) {
      const marker = chooseMarker(collectMatches(source, pattern));
      if (marker) return marker;
    }
  }

  if (looksLikeHeadingStyle(style)) {
    const headingPatterns = [
      /^#{1,6}\s+.+$/gimu,
      /^\d+[.)]\s+.+$/gimu,
      /^(?:[A-Z][A-Za-z0-9 ,'"()/-]{3,})\s*:\s*$/gmu
    ];
    for (const pattern of headingPatterns) {
      const marker = chooseMarker(collectMatches(source, pattern));
      if (marker) return marker;
    }
  }

  const generalPatterns = [
    /^#{1,6}\s+.+$/gimu,
    /^\d+[.)]\s+.+$/gimu
  ];
  for (const pattern of generalPatterns) {
    const marker = chooseMarker(collectMatches(source, pattern));
    if (marker) return marker;
  }

  return "";
}

async function main() {
  const [chipFilename, styleFilename] = process.argv.slice(2);
  if (!chipFilename || !styleFilename) {
    throw new Error("usage: node command/chip_programmatic_boundary.mjs <chip-file> <style-file>");
  }
  const [chipText, styleText] = await Promise.all([
    fs.readFile(chipFilename, "utf8"),
    fs.readFile(styleFilename, "utf8")
  ]);
  const marker = findProgrammaticBoundary(chipText, styleText);
  process.stdout.write(marker);
}

const isCli = import.meta.url === `file://${process.argv[1]}`;
if (isCli) {
  main().catch((err) => {
    const message = String(err?.message ?? err ?? "chip programmatic boundary defective");
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
