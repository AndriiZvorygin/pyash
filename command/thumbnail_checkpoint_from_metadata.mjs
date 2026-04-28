#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { pyaFileToJson } from "../program/library/pya_to_json.mjs";

const REQUIRED_SCHEMA_KEYS = [
  "HOOK_SUBJECT",
  "EMOTION",
  "FRAMING",
  "BACKGROUND",
  "OVERLAY_TEXT",
  "COLOUR_CONTRAST",
  "STYLE",
  "CLARITY_RULES",
  "NEGATIVE_PROMPT"
];

const DEFAULT_NEGATIVE_PROMPT = "no clutter, no tiny text, no watermark, no extra faces unless requested, no blurry subject, no low-contrast muddy lighting, no crowded background";
const DEFAULT_STYLE = "Quebec bande dessinee illustration, precise linework, flat colours with soft shading, muted natural palette, balanced composition, mature francophone comic storytelling, matte printed surface";

function normalize(value) {
  return String(value ?? "").replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
}

function cleanTagLine(value) {
  const lines = String(value ?? "").split(/\r?\n/);
  return lines.filter((line) => !/^\s*tags\s*:/i.test(line)).join("\n").trim();
}

function basenameStem(filePath) {
  const base = path.basename(String(filePath || ""));
  const stem = base.replace(/\.[^.]+$/, "");
  return normalize(stem.replace(/[_-]+/g, " "));
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
    const value = normalize(candidate?.value ?? "");
    if (value) {
      return { source: String(candidate?.source || "unknown"), value };
    }
  }
  return { source: "none", value: "" };
}

function escapeText(value) {
  return JSON.stringify(String(value ?? ""));
}

function escapeFile(value) {
  return JSON.stringify(path.resolve(String(value ?? "")));
}

function clampOverlayWords(raw) {
  const cleaned = normalize(raw)
    .replace(/[^A-Za-z0-9' -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  let words = cleaned.split(" ").filter(Boolean);
  if (words.length === 0) words = ["ACT", "NOW"];
  if (words.length === 1) words = [words[0], "NOW"];
  if (words.length > 5) words = words.slice(0, 5);
  return words.join(" ").toUpperCase();
}

function overlayFromSignal(signal, fallback) {
  const source = normalize(signal || fallback);
  const terms = source
    .replace(/[^A-Za-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean)
    .filter((w) => w.length >= 3)
    .filter((w) => !/^(THE|AND|FOR|WITH|FROM|THIS|THAT|YOUR|INTO|ONTO|WILL|ARE|WAS|WERE)$/i.test(w));
  const picked = [...new Set(terms)].slice(0, 5).join(" ");
  return clampOverlayWords(picked || fallback || "KEY UPDATE");
}

function inferIntent(text) {
  const t = normalize(text).toLowerCase();
  if (/\b(debt|budget|cost|rent|tax|price|fees|bondage|ownership|economic|finance)\b/.test(t)) return "economic";
  if (/\b(council|city|policy|law|committee|state|official|reform|governance)\b/.test(t)) return "political";
  if (/\b(system|scale|network|process|structure|pattern|transformation|coordination)\b/.test(t)) return "systems";
  return "generic";
}

function buildSchema({ titleHook, summaryDescription, sourceText, filenameOnly }) {
  const combined = normalize([titleHook, summaryDescription, sourceText, filenameOnly].join(" "));
  const intent = inferIntent(combined);

  const overlay = overlayFromSignal(titleHook, filenameOnly || "KEY UPDATE");

  const byIntent = {
    economic: {
      HOOK_SUBJECT: "expressive person holding a marked reform document with highlighted debt and ownership lines",
      EMOTION: "urgent determined expression with readable eyes and brows",
      BACKGROUND: "simple civic backdrop with low-detail architectural context"
    },
    political: {
      HOOK_SUBJECT: "expressive official figure presenting a policy page with highlighted motion line",
      EMOTION: "focused decisive expression with clear facial tension",
      BACKGROUND: "minimal council-style backdrop with clean depth separation"
    },
    systems: {
      HOOK_SUBJECT: "expressive person beside a simple structured system diagram with one dominant symbolic anchor",
      EMOTION: "curious analytical expression with clear readable eyes",
      BACKGROUND: "clean low-detail backdrop supporting a single abstract system form"
    },
    generic: {
      HOOK_SUBJECT: "expressive focal person holding a clearly marked key document",
      EMOTION: "strong readable emotional expression",
      BACKGROUND: "simple background with low detail and clear depth"
    }
  };

  const picked = byIntent[intent] || byIntent.generic;

  const schema = {
    HOOK_SUBJECT: picked.HOOK_SUBJECT,
    EMOTION: picked.EMOTION,
    FRAMING: "close-up or medium-close 16:9 thumbnail framing, subject fills substantial frame, reserve right side for text",
    BACKGROUND: picked.BACKGROUND,
    OVERLAY_TEXT: overlay,
    COLOUR_CONTRAST: "high contrast foreground and background separation with clear edge readability",
    STYLE: DEFAULT_STYLE,
    CLARITY_RULES: "mobile-first readability, single clear subject, clean composition, minimal background detail, large bold readable text only, sharp subject focus, strong subject-background separation, high contrast lighting, white sclera and defined irises with clear expressive eyes for visible faces",
    NEGATIVE_PROMPT: DEFAULT_NEGATIVE_PROMPT
  };

  return { schema, intent };
}

function schemaToText(schema) {
  return REQUIRED_SCHEMA_KEYS.map((key) => `${key}: ${normalize(schema[key])}`).join("\n") + "\n";
}

function validateSchema(schema) {
  const missing = [];
  for (const key of REQUIRED_SCHEMA_KEYS) {
    if (!normalize(schema[key])) missing.push(key);
  }
  if (missing.length > 0) {
    throw new Error(`thumbnail checkpoint defective: missing schema fields: ${missing.join(",")}`);
  }
  const words = normalize(schema.OVERLAY_TEXT).split(" ").filter(Boolean);
  if (words.length < 2 || words.length > 5) {
    throw new Error(`thumbnail checkpoint defective: OVERLAY_TEXT must be 2-5 words (got ${words.length})`);
  }
}

function usage() {
  return [
    "Usage:",
    "  node command/thumbnail_checkpoint_from_metadata.mjs <metadata.pya> <source.txt> <filename-fallback> <thumbnail-source-out.txt> <checkpoint-out.pya>"
  ].join("\n");
}

async function main() {
  const [metadataPathArg, sourcePathArg, filenameFallbackArg, sourceOutArg, checkpointOutArg] = process.argv.slice(2);
  if (!metadataPathArg || !sourcePathArg || !filenameFallbackArg || !sourceOutArg || !checkpointOutArg) {
    process.stderr.write(`${usage()}\n`);
    process.exit(2);
  }

  const metadataPath = path.resolve(metadataPathArg);
  const sourcePath = path.resolve(sourcePathArg);
  const sourceOutPath = path.resolve(sourceOutArg);
  const checkpointOutPath = path.resolve(checkpointOutArg);

  const payload = await pyaFileToJson(metadataPath, { memoryOnly: false });
  const metadataMap = flattenMetadataMap(payload?.index?.["video metadata"]?.raw?.ob?.map || {});

  const sourceTextRaw = await fs.readFile(sourcePath, "utf8");
  const sourceText = normalize(sourceTextRaw);

  const title = normalize(metadataMap?.title || "");
  const heading = normalize(metadataMap?.heading || "");
  const summary = normalize(cleanTagLine(metadataMap?.summary || ""));
  const description = normalize(cleanTagLine(metadataMap?.description || ""));

  const titleHookPick = pickFirstNonEmpty([
    { source: "generated_hook", value: heading },
    { source: "generated_title", value: title }
  ]);
  const summaryPick = pickFirstNonEmpty([
    { source: "generated_summary", value: summary },
    { source: "generated_description", value: description }
  ]);

  const missing = [];
  if (!titleHookPick.value) missing.push("heading_or_title");
  if (!summaryPick.value) missing.push("summary_or_description");
  if (missing.length > 0) {
    throw new Error(`thumbnail checkpoint defective: missing required metadata fields: ${missing.join(",")}`);
  }

  const filenameOnly = basenameStem(filenameFallbackArg);

  const { schema, intent } = buildSchema({
    titleHook: titleHookPick.value,
    summaryDescription: summaryPick.value,
    sourceText,
    filenameOnly
  });

  validateSchema(schema);

  await fs.mkdir(path.dirname(sourceOutPath), { recursive: true });
  await fs.writeFile(sourceOutPath, schemaToText(schema), "utf8");

  const checkpointLines = [
    "su name thumbnail checkpoint be map def",
    `su name metadata_path ob filename ${escapeFile(metadataPath)} ya`,
    `su name source_path ob filename ${escapeFile(sourcePath)} ya`,
    `su name source_out_path ob filename ${escapeFile(sourceOutPath)} ya`,
    `su name primary_source ob text ${escapeText(titleHookPick.source)} ya`,
    `su name primary_signal ob text ${escapeText(titleHookPick.value)} ya`,
    `su name title ob text ${escapeText(title)} ya`,
    `su name heading ob text ${escapeText(heading)} ya`,
    `su name summary ob text ${escapeText(summary)} ya`,
    `su name description ob text ${escapeText(description)} ya`,
    `su name filename_fallback ob text ${escapeText(filenameOnly)} ya`,
    `su name source_excerpt_present ob text ${escapeText(sourceText ? "truth" : "lie")} ya`,
    `su name intent ob text ${escapeText(intent)} ya`,
    ...REQUIRED_SCHEMA_KEYS.map((key) => `su name ${key} ob text ${escapeText(schema[key])} ya`),
    "prah",
    ""
  ];

  await fs.mkdir(path.dirname(checkpointOutPath), { recursive: true });
  await fs.writeFile(checkpointOutPath, checkpointLines.join("\n"), "utf8");

  process.stdout.write(`${checkpointOutPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${String(error?.stack || error?.message || error)}\n`);
  process.exit(1);
});
