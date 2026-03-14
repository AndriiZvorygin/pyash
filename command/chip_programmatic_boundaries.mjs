#!/usr/bin/env node
import fs from "node:fs/promises";
import process from "node:process";

import { BOUNDARY_SPLIT_MARKER, findProgrammaticBoundaries } from "./chip_programmatic_boundary.mjs";

const STYLE_SPLIT_MARKER = "\n<<<PYA_CHIP_STYLE>>>\n";

async function readStdinText() {
  let data = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) data += chunk;
  return data;
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
  const [sourceFilename, styleFilename] = process.argv.slice(2);
  let sourceText = "";
  let styleText = "";
  if (!sourceFilename && !styleFilename) {
    const input = await readStdinText();
    ({ sourceText, styleText } = parseStdinPayload(input));
  } else if (sourceFilename && styleFilename) {
    [sourceText, styleText] = await Promise.all([
      fs.readFile(sourceFilename, "utf8"),
      fs.readFile(styleFilename, "utf8")
    ]);
  } else {
    throw new Error("usage: node command/chip_programmatic_boundaries.mjs <source-file> <style-file>");
  }
  const markers = findProgrammaticBoundaries(sourceText, styleText);
  process.stdout.write(markers.join(BOUNDARY_SPLIT_MARKER));
}

main().catch((err) => {
  const message = String(err?.message ?? err ?? "chip programmatic boundaries defective");
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
