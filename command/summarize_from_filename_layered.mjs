#!/usr/bin/env node
import fs from "node:fs";
import { splitIntoOverlappingChunks } from "./learn_from_filename_pipeline.mjs";

const MODEL = "qwen3.5:9b";
const OLLAMA_URL = process.env.OLLAMA_HOST?.replace(/\/$/u, "")
  ? `${process.env.OLLAMA_HOST.replace(/\/$/u, "")}/api/chat`
  : "http://localhost:11434/api/chat";
const CHUNK_SIZE = 12000;
const CHUNK_OVERLAP = 1200;
const MERGE_GROUP_SIZE = 12;

async function ask(messages, { numPredict = 260 } = {}) {
  const body = {
    model: MODEL,
    mode: "chat",
    keep_alive: 300,
    think: false,
    stream: false,
    options: { num_predict: numPredict },
    messages,
  };
  const res = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`ollama status ${res.status}`);
  const json = await res.json();
  return String(json?.message?.content || "").trim();
}

function parseVerdict(text) {
  const lines = String(text || "")
    .split(/\r?\n/u)
    .map((x) => x.trim())
    .filter(Boolean);
  const last = String(lines.at(-1) || "").toUpperCase();
  return last === "PASS" ? "PASS" : "FAIL";
}

function buildSummarizePrompt(source, focus, wordLimit, lane) {
  return [
    `Summarize the SOURCE in plain English (${lane}).`,
    "",
    `Focus: prioritize ${focus}.`,
    "",
    "Rules:",
    "- Keep only facts supported by SOURCE.",
    "- Be concise and concrete.",
    "- No speculation.",
    "- No bullet lists.",
    `- Keep under ${wordLimit} words.`,
    "",
    "SOURCE:",
    source,
  ].join("\n");
}

function buildVerifyPrompt(source, summary) {
  return [
    "Check whether SUMMARY is faithful to SOURCE.",
    "",
    "PASS when all concrete claims in SUMMARY are supported by SOURCE.",
    "FAIL when SUMMARY adds unsupported claims, distorts, or contradicts SOURCE.",
    "",
    "Output rules:",
    "- First line: one short sentence.",
    "- Final line: PASS or FAIL.",
    "",
    "SOURCE:",
    source,
    "",
    "SUMMARY:",
    summary,
  ].join("\n");
}

async function summarizeWithVerification({ source, focus, wordLimit, lane }) {
  const summary = await ask(
    [
      { role: "system", content: "You are a concise, source-faithful civic summarizer." },
      { role: "user", content: buildSummarizePrompt(source, focus, wordLimit, lane) },
    ],
    { numPredict: Math.max(220, Math.floor(wordLimit * 2.2)) },
  );
  const review = await ask(
    [
      { role: "system", content: "You are a strict semantic verifier." },
      { role: "user", content: buildVerifyPrompt(source, summary) },
    ],
    { numPredict: 180 },
  );
  return {
    summary,
    review,
    verdict: parseVerdict(review),
  };
}

function group(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function readFocusArg() {
  const fromArg = String(process.argv[3] || "").trim();
  if (fromArg) return fromArg;
  try {
    if (!process.stdin.isTTY) {
      const fromStdin = String(fs.readFileSync(0, "utf8") || "").trim();
      if (fromStdin) return fromStdin;
    }
  } catch {
    // best effort
  }
  return "the newsworthy juicy bits";
}

async function main() {
  const sourcePath = process.argv[2];
  if (!sourcePath) {
    process.stderr.write("usage: node command/summarize_from_filename_layered.mjs <source-file> [focus]\n");
    process.exit(2);
  }
  const focus = readFocusArg();
  const source = fs.readFileSync(sourcePath, "utf8");
  const chunks = splitIntoOverlappingChunks(source, CHUNK_SIZE, CHUNK_OVERLAP);

  const chunkSummaries = [];
  for (let i = 0; i < chunks.length; i += 1) {
    const lane = `chunk ${i + 1} of ${chunks.length}`;
    const { summary } = await summarizeWithVerification({
      source: chunks[i],
      focus,
      wordLimit: 150,
      lane,
    });
    chunkSummaries.push(summary);
  }

  let layer = chunkSummaries;
  let depth = 1;
  while (layer.length > 1) {
    const batches = group(layer, MERGE_GROUP_SIZE);
    const next = [];
    for (let i = 0; i < batches.length; i += 1) {
      const sourceBlock = batches[i]
        .map((text, idx) => `SUMMARY ${idx + 1}:\n${text}`)
        .join("\n\n=====\n\n");
      const lane = `merge layer ${depth}, group ${i + 1} of ${batches.length}`;
      const { summary } = await summarizeWithVerification({
        source: sourceBlock,
        focus,
        wordLimit: 220,
        lane,
      });
      next.push(summary);
    }
    layer = next;
    depth += 1;
  }

  process.stdout.write(`${String(layer[0] || "").trim()}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.message || String(error)}\n`);
  process.exit(1);
});
