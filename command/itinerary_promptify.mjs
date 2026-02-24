import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseItineraryPya, renderItineraryPya } from "./itinerary_io.mjs";

function usage() {
  return "Usage: node command/itinerary_promptify.mjs <input-itinerary.pya> <output-itinerary.pya> [--model <name>] [--host <url>] [--system <text>]";
}

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.length < 2) throw new Error(usage());
  const out = {
    inputFile: args[0],
    outputFile: args[1],
    model: process.env.PYA_DRAW_PROMPT_MODEL || process.env.PYA_MIND_MODEL || "qwen3-vl:8b-instruct",
    host: process.env.OLLAMA_HOST || "http://localhost:11434",
    systemPrompt: "Use the provided fields to generate one image prompt. Follow instruction exactly and return only prompt text."
  };
  for (let i = 2; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--model") out.model = String(args[++i] ?? out.model);
    else if (arg === "--host") out.host = String(args[++i] ?? out.host);
    else if (arg === "--system") out.systemPrompt = String(args[++i] ?? out.systemPrompt);
    else throw new Error(usage());
  }
  return out;
}

function normalizeHost(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return "http://localhost:11434";
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function cleanPrompt(text) {
  const normalized = String(text ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized;
}

function packetValue(value) {
  const text = String(value ?? "").trim();
  return text || "EMPTY";
}

function cutTextAt(cuts, index) {
  if (!Array.isArray(cuts)) return "";
  const at = Number(index);
  if (!Number.isInteger(at) || at < 0 || at >= cuts.length) return "";
  return String(cuts[at]?.obText ?? "").trim();
}

function buildPromptifyPacket({
  cuts = [],
  index = 0,
  instruction = "",
  fullScript = "",
  previousPrompts = []
} = {}) {
  const currentText = cutTextAt(cuts, index);
  const previousText = cutTextAt(cuts, Number(index) - 1);
  const nextText = cutTextAt(cuts, Number(index) + 1);
  const priorPrompts = Array.isArray(previousPrompts)
    ? previousPrompts.map(value => String(value ?? "").trim()).filter(Boolean)
    : [];
  const previousPrompt1 = priorPrompts.length ? priorPrompts[priorPrompts.length - 1] : "";
  const previousPrompt2 = priorPrompts.length > 1 ? priorPrompts[priorPrompts.length - 2] : "";
  const lines = [
    `instruction: ${packetValue(instruction)}`,
    `current_cut: ${packetValue(currentText)}`,
    `previous_cut: ${packetValue(previousText)}`,
    `next_cut: ${packetValue(nextText)}`,
    `full_script: ${packetValue(fullScript)}`,
    `previous_prompt_1: ${packetValue(previousPrompt1)}`,
    `previous_prompt_2: ${packetValue(previousPrompt2)}`
  ];
  return lines.join("\n");
}

async function callPromptMind({ host, model, systemPrompt, cutText }) {
  const endpoint = `${normalizeHost(host)}/api/chat`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: cutText }
      ]
    })
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok) {
    throw new Error(`promptify defective: status=${response.status} error=${payload?.error || response.statusText}`);
  }
  const text = payload?.message?.content ?? payload?.response ?? "";
  const prompt = cleanPrompt(text);
  if (!prompt) throw new Error("promptify defective: empty prompt");
  return prompt;
}

export { parseArgs, callPromptMind, cleanPrompt, buildPromptifyPacket };

export async function main(argv = process.argv) {
  const opts = parseArgs(argv);
  const inputText = await fs.readFile(opts.inputFile, "utf8");
  const itinerary = parseItineraryPya(inputText);
  const promptedCuts = [];
  const fullScript = itinerary.cuts.map(c => String(c?.obText ?? "").trim()).filter(Boolean).join(" ");
  const promptHistory = [];
  for (let i = 0; i < itinerary.cuts.length; i += 1) {
    const packet = buildPromptifyPacket({
      cuts: itinerary.cuts,
      index: i,
      instruction: "Turn this transcript cut into one concise visual image prompt for generation.",
      fullScript,
      previousPrompts: promptHistory.slice(-2)
    });
    const prompt = await callPromptMind({
      host: opts.host,
      model: opts.model,
      systemPrompt: opts.systemPrompt,
      cutText: packet
    });
    promptHistory.push(prompt);
    const cut = itinerary.cuts[i];
    promptedCuts.push({
      ...cut,
      obText: prompt
    });
  }
  const outputText = renderItineraryPya({
    itineraryName: `${itinerary.itineraryName} prompts`,
    cuts: promptedCuts
  });
  await fs.mkdir(path.dirname(path.resolve(opts.outputFile)), { recursive: true });
  await fs.writeFile(opts.outputFile, outputText, "utf8");
  process.stdout.write(`${opts.outputFile}\n`);
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main().catch((err) => {
    process.stderr.write(`${err?.message ?? String(err)}\n`);
    process.exit(1);
  });
}
