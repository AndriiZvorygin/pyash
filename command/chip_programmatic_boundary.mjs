#!/usr/bin/env node
import fs from "node:fs/promises";
import process from "node:process";

const STYLE_SPLIT_MARKER = "\n<<<PYA_CHIP_STYLE>>>\n";
export const BOUNDARY_SPLIT_MARKER = "\n<<<PYA_BOUNDARY>>>\n";

async function readStdinText() {
  let data = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\r\n?/gu, "\n")
    .replace(/\\r\\n/gu, "\n")
    .replace(/\\n/gu, "\n")
    .replace(/\\r/gu, "\n");
}

function chooseMarker(matches = []) {
  if (!matches.length) return "";
  const afterLead = matches.find((match) => match.index >= 80);
  return String((afterLead ?? matches[0]).marker ?? "").trim();
}

function isQaQuestionMarker(marker) {
  return /^####\s+(?!Q[’']?uo\b).+$/iu.test(String(marker ?? "").trim())
    || /^(?:Questioner|Question|Q)\s*:\s*.+$/iu.test(String(marker ?? "").trim())
    || /^(?:Questioner|Question)\s+.+$/iu.test(String(marker ?? "").trim());
}

function looksLikeQuestionBlock(text) {
  const source = String(text ?? "").trim();
  if (!source) return false;
  if (source.includes("?")) return true;
  return /\b(?:i have a question|i would like to|i'?m curious|how\b|what\b|why\b|when\b|where\b|does\b|do\b|is\b|are\b|can\b|could\b|would\b|should\b)\b/iu.test(source);
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

function filterQaHeadingMatches(source, matches) {
  return matches.filter((match, idx) => {
    const start = Number(match?.index ?? 0) + String(match?.marker ?? "").length;
    const nextHeadingIndex = source.indexOf("\n#### ", start);
    const end = nextHeadingIndex >= 0 ? nextHeadingIndex : source.length;
    const body = source.slice(start, end).trim();
    return looksLikeQuestionBlock(body);
  });
}

function mapQaHeadingMarkers(source, matches) {
  return matches.map((match) => {
    const start = Number(match?.index ?? 0);
    const afterHeading = start + String(match?.marker ?? "").length;
    const nextHeadingIndex = source.indexOf("\n#### ", afterHeading);
    const end = nextHeadingIndex >= 0 ? nextHeadingIndex : source.length;
    return source.slice(start, end).trim();
  }).filter(Boolean);
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
  const markers = findProgrammaticBoundaries(sourceText, styleText);
  return markers[0] ?? "";
}

export function findProgrammaticBoundaries(sourceText, styleText) {
  const source = normalizeText(sourceText);
  const style = String(styleText ?? "");

  if (looksLikeQaStyle(style)) {
    const qaPatterns = [
      /^####\s+(?!Q[’']?uo\b).+$/gimu,
      /^(?:Questioner|Question|Q)\s*:\s*.+$/gimu,
      /^(?:Questioner|Question)\s+.+$/gimu
    ];
    for (const pattern of qaPatterns) {
      let matches = collectMatches(source, pattern);
      if (String(pattern).includes("^####")) {
        matches = filterQaHeadingMatches(source, matches);
        const markers = mapQaHeadingMarkers(source, matches);
        if (markers.length) return markers;
      }
      const markers = matches.map(match => match.marker).filter(isQaQuestionMarker);
      if (markers.length) return markers;
    }
  }

  if (looksLikeHeadingStyle(style)) {
    const headingPatterns = [
      /^#{1,6}\s+.+$/gimu,
      /^\d+[.)]\s+.+$/gimu,
      /^(?:[A-Z][A-Za-z0-9 ,'"()/-]{3,})\s*:\s*$/gmu
    ];
    for (const pattern of headingPatterns) {
      const markers = collectMatches(source, pattern).map(match => match.marker.trim()).filter(Boolean);
      if (markers.length) return markers;
    }
  }

  const generalPatterns = [
    /^#{1,6}\s+.+$/gimu,
    /^\d+[.)]\s+.+$/gimu
  ];
  for (const pattern of generalPatterns) {
    const markers = collectMatches(source, pattern).map(match => match.marker.trim()).filter(Boolean);
    if (markers.length) return markers;
  }

  return [];
}

function parseStdinPayload(input) {
  const text = String(input ?? "");
  const trimmed = text.trim();
  if (!trimmed) return { sourceText: "", styleText: "" };
  if (trimmed.startsWith("{")) {
    const payload = JSON.parse(trimmed);
    return {
      sourceText: String(payload.sourceText ?? ""),
      styleText: String(payload.styleText ?? "")
    };
  }
  const splitIndex = text.indexOf(STYLE_SPLIT_MARKER);
  if (splitIndex < 0) {
    return { sourceText: text, styleText: "" };
  }
  return {
    sourceText: text.slice(0, splitIndex),
    styleText: text.slice(splitIndex + STYLE_SPLIT_MARKER.length)
  };
}

async function main() {
  const [chipFilename, styleFilename] = process.argv.slice(2);
  if (!chipFilename && !styleFilename) {
    const input = await readStdinText();
    const payload = parseStdinPayload(input);
    const marker = findProgrammaticBoundary(payload.sourceText ?? "", payload.styleText ?? "");
    process.stdout.write(marker);
    return;
  }
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
