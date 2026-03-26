#!/usr/bin/env node
import fs from "node:fs";

const MODEL = "qwen3.5:9b";
const OLLAMA_URL = "http://localhost:11434/api/chat";
const MAX_ATTEMPTS = 3;
const PASS_THRESHOLD = 0.8;

function abridgeUtf8(text, maxBytes) {
  const buf = Buffer.from(String(text ?? ""), "utf8");
  if (buf.length <= maxBytes) return String(text ?? "");
  let end = maxBytes;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end -= 1;
  if (end <= 0) end = maxBytes;
  return buf.slice(0, end).toString("utf8");
}

function parseScore(review) {
  const lines = String(review || "")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
  const last = lines.at(-1) || "";
  if (/^PASS$/i.test(last)) return 1;
  if (/^FAIL$/i.test(last)) return 0;
  const n = Number(last);
  if (Number.isFinite(n) && n >= 0 && n <= 1) return n;
  return 0;
}

async function ask(messages, { numPredict = 220 } = {}) {
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
  if (!res.ok) {
    throw new Error(`ollama status ${res.status}`);
  }
  const json = await res.json();
  return String(json?.message?.content || "").trim();
}

function buildSummaryPrompt(source, feedback) {
  return [
    "Summarize the SOURCE in plain English.",
    "",
    "Rules:",
    "- Keep only facts supported by SOURCE.",
    "- Be concise and concrete.",
    "- No speculation.",
    "- No markdown bullets.",
    "- Keep output under 180 words.",
    "",
    "RETRY_FEEDBACK:",
    feedback || "",
    "",
    "SOURCE:",
    source,
  ].join("\n");
}

function buildScorePrompt(source, summary) {
  return [
    "Score SUMMARY for semantic faithfulness to SOURCE.",
    "",
    "Scoring:",
    "- 1.0 = fully faithful",
    "- 0.8 = mostly faithful with minor compression drift",
    "- 0.5 = mixed",
    "- 0.0 = unusable / unsupported",
    "",
    "Rules:",
    "- Penalize unsupported concrete claims.",
    "- Do not penalize concise paraphrase when meaning stays faithful.",
    "",
    "Output:",
    "- First line: one short sentence feedback.",
    "- Final line: exactly one of PASS, FAIL, or a numeric score from 0 to 1.",
    "",
    "SOURCE:",
    source,
    "",
    "SUMMARY:",
    summary,
  ].join("\n");
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    process.stderr.write(
      "usage: node command/summary_from_filename_scored.mjs <input-file>\n",
    );
    process.exit(2);
  }
  const sourceRaw = fs.readFileSync(inputPath, "utf8");
  const source = abridgeUtf8(sourceRaw, 14000);

  let feedback = "";
  let bestSummary = "";
  let bestScore = -1;

  for (let i = 1; i <= MAX_ATTEMPTS; i += 1) {
    const summary = await ask(
      [
        { role: "system", content: "You are a concise, factual summarizer." },
        { role: "user", content: buildSummaryPrompt(source, feedback) },
      ],
      { numPredict: 240 },
    );

    const review = await ask(
      [
        {
          role: "system",
          content: "You are a strict semantic summary scorer.",
        },
        { role: "user", content: buildScorePrompt(source, summary) },
      ],
      { numPredict: 220 },
    );

    const score = parseScore(review);
    if (bestSummary === "" || score > bestScore) {
      bestSummary = summary;
      bestScore = score;
    }
    feedback = review;
    if (score > PASS_THRESHOLD) break;
  }

  process.stdout.write(`${bestSummary}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.message || String(error)}\n`);
  process.exit(1);
});
