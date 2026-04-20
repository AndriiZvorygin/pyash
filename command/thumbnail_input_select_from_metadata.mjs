#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { pyaFileToJson } from "../program/library/pya_to_json.mjs";

function normalize(value) {
  return String(value ?? "").replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
}

async function readTextSafe(filePath) {
  if (!filePath) return "";
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

function basenameStem(filePath) {
  const base = path.basename(String(filePath || ""));
  const stem = base.replace(/\.[^.]+$/, "");
  return normalize(stem.replace(/[_-]+/g, " "));
}

function cleanTagLine(value) {
  const lines = String(value ?? "").split(/\r?\n/);
  return lines.filter((line) => !/^\s*tags\s*:/i.test(line)).join("\n").trim();
}

function flattenMetadataMap(rawMap) {
  const out = {};
  if (!rawMap || typeof rawMap !== "object") return out;
  for (const [key, entry] of Object.entries(rawMap)) {
    if (entry?.ob && Object.prototype.hasOwnProperty.call(entry.ob, "text")) {
      out[key] = String(entry.ob.text ?? "");
      continue;
    }
    if (entry?.ob && Object.prototype.hasOwnProperty.call(entry.ob, "filename")) {
      out[key] = String(entry.ob.filename ?? "");
      continue;
    }
    out[key] = "";
  }
  return out;
}

function pickFirstNonEmpty(candidates) {
  for (const candidate of candidates) {
    const text = normalize(candidate?.value ?? "");
    if (text) {
      return {
        source: String(candidate?.source || "unknown"),
        value: text
      };
    }
  }
  return { source: "none", value: "" };
}

function buildThumbnailSource({ titleHook, summaryDescription, sourceText, filenameOnly }) {
  const lines = [];

  const top = pickFirstNonEmpty([
    { source: "generated_title_hook", value: titleHook },
    { source: "generated_summary_description", value: summaryDescription },
    { source: "source_text", value: sourceText },
    { source: "filename_only", value: filenameOnly }
  ]);

  if (normalize(top.value)) {
    lines.push(`PRIMARY_THUMBNAIL_SIGNAL: ${top.value}`);
  }

  if (normalize(titleHook)) {
    lines.push(`TITLE_HOOK: ${normalize(titleHook)}`);
  }
  if (normalize(summaryDescription)) {
    lines.push(`SUMMARY_DESCRIPTION: ${normalize(summaryDescription)}`);
  }
  if (normalize(sourceText)) {
    const excerpt = normalize(sourceText).slice(0, 1200);
    lines.push(`SOURCE_TEXT_EXCERPT: ${excerpt}`);
  }
  if (normalize(filenameOnly)) {
    lines.push(`FILENAME_FALLBACK: ${normalize(filenameOnly)}`);
  }

  lines.push("THUMBNAIL_DIRECTION: choose one dominant visual hook directly from PRIMARY_THUMBNAIL_SIGNAL; keep the same core meaning and nouns.");

  return {
    text: `${lines.join("\n")}\n`,
    top
  };
}

function usage() {
  return [
    "Usage:",
    "  node command/thumbnail_input_select_from_metadata.mjs <metadata.pya> <source.txt> <filename-fallback> <thumbnail-source-out.txt> [debug.json]"
  ].join("\n");
}

async function main() {
  const [metadataPathArg, sourcePathArg, filenameFallbackArg, outputPathArg, debugPathArg] = process.argv.slice(2);

  if (!metadataPathArg || !sourcePathArg || !filenameFallbackArg || !outputPathArg) {
    process.stderr.write(`${usage()}\n`);
    process.exit(2);
  }

  const metadataPath = path.resolve(metadataPathArg);
  const sourcePath = path.resolve(sourcePathArg);
  const outputPath = path.resolve(outputPathArg);
  const debugPath = debugPathArg ? path.resolve(debugPathArg) : "";

  let metadataMap = {};
  try {
    const payload = await pyaFileToJson(metadataPath, { memoryOnly: false });
    metadataMap = flattenMetadataMap(payload?.index?.["video metadata"]?.raw?.ob?.map || {});
  } catch {
    metadataMap = {};
  }

  const sourceTextRaw = await readTextSafe(sourcePath);
  const sourceText = normalize(sourceTextRaw);

  const title = normalize(metadataMap?.title || "");
  const heading = normalize(metadataMap?.heading || "");
  const summary = normalize(cleanTagLine(metadataMap?.summary || ""));
  const description = normalize(cleanTagLine(metadataMap?.description || ""));

  const titleHook = pickFirstNonEmpty([
    { source: "generated_hook", value: heading },
    { source: "generated_title", value: title }
  ]).value;

  const summaryDescription = pickFirstNonEmpty([
    { source: "generated_summary", value: summary },
    { source: "generated_description", value: description }
  ]).value;

  const filenameOnly = basenameStem(filenameFallbackArg);

  const built = buildThumbnailSource({
    titleHook,
    summaryDescription,
    sourceText,
    filenameOnly
  });

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, built.text, "utf8");

  if (debugPath) {
    const debugPayload = {
      priority_order: [
        "generated title / hook",
        "generated summary / description",
        "source text fallback",
        "filename only"
      ],
      selected_primary: built.top,
      selected_fields: {
        title,
        heading,
        summary,
        description,
        source_text_present: Boolean(sourceText),
        filename_only: filenameOnly
      },
      output_path: outputPath
    };
    await fs.mkdir(path.dirname(debugPath), { recursive: true });
    await fs.writeFile(debugPath, `${JSON.stringify(debugPayload, null, 2)}\n`, "utf8");
  }

  process.stdout.write(outputPath);
  process.stdout.write("\n");
}

main().catch((error) => {
  process.stderr.write(`${String(error?.stack || error?.message || error)}\n`);
  process.exit(1);
});
