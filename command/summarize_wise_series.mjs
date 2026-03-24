#!/usr/bin/env node
import fs from "node:fs";

const MODEL = "qwen3.5:9b";
const OLLAMA_URL = "http://localhost:11434/api/chat";

function unescapeQuoted(value) {
  try {
    return JSON.parse(`"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
  } catch {
    return String(value || "");
  }
}

function parseSeriesTexts(pyaText) {
  const source = String(pyaText || "");
  const out = [];

  const quotedRe = /ob text quoted\.text\.(.*?)\.text\.quoted(?: from num \d+)? be text ya/gs;
  for (const m of source.matchAll(quotedRe)) out.push(String(m[1] || ""));

  const plainRe = /ob text "((?:[^"\\]|\\.)*)"(?: from num \d+)? be text ya/g;
  for (const m of source.matchAll(plainRe)) out.push(unescapeQuoted(String(m[1] || "")));

  return out;
}

async function askSummary(chunk, focus) {
  const focusLine = String(focus || "").trim();
  const prompt = [
    "Summarize this CHUNK in plain English.",
    focusLine ? `Focus: prioritize details about ${focusLine}.` : "",
    "",
    "Rules:",
    "- Keep only facts supported by CHUNK.",
    "- Be concise and concrete.",
    "- No speculation.",
    "- No bullet lists.",
    "- Keep under 120 words.",
    "",
    "CHUNK:",
    chunk,
  ].join("\n");

  const body = {
    model: MODEL,
    mode: "chat",
    keep_alive: 300,
    think: false,
    stream: false,
    options: { num_predict: 180 },
    messages: [
      { role: "system", content: "You are a precise civic-document summarizer." },
      { role: "user", content: prompt },
    ],
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

function toSeriesPya(name, texts) {
  const lines = [`su name ${name} be series def`];
  for (let i = 0; i < texts.length; i += 1) {
    const t = String(texts[i] || "");
    lines.push(`ob text quoted.text.${t}.text.quoted from num ${i + 1} be text ya`);
  }
  lines.push("prah");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const inPath = process.argv[2];
  const outPath = process.argv[3];
  const focusArg = process.argv[4] || "";
  if (!inPath || !outPath) {
    process.stderr.write("usage: node command/summarize_wise_series.mjs <in.series.pya> <out.series.pya> [focus]\n");
    process.exit(2);
  }

  let focus = String(focusArg || "");
  if (!focus.trim()) {
    try {
      if (!process.stdin.isTTY) focus = fs.readFileSync(0, "utf8");
    } catch {
      // best effort: leave focus empty
    }
  }
  focus = String(focus || "").trim();

  const source = fs.readFileSync(inPath, "utf8");
  const chunks = parseSeriesTexts(source);
  const summaries = [];
  for (const chunk of chunks) {
    summaries.push(await askSummary(chunk, focus));
  }

  const outText = toSeriesPya("wise chunk summaries", summaries);
  fs.writeFileSync(outPath, outText, "utf8");
  process.stdout.write(outPath + "\n");
}

main().catch((err) => {
  process.stderr.write(`${err?.message || String(err)}\n`);
  process.exit(1);
});
