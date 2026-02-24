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
    systemPrompt: "Convert this transcript cut into one concise visual image prompt for generation. Return only the prompt text. No markdown, no quotes, no explanation."
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

function normalizeCutText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function findDistinctNeighborText(cuts, index, direction) {
  const list = Array.isArray(cuts) ? cuts : [];
  const current = normalizeCutText(list[index]?.obText ?? "");
  let i = Number(index) + Number(direction);
  while (i >= 0 && i < list.length) {
    const candidateRaw = String(list[i]?.obText ?? "").trim();
    const candidate = normalizeCutText(candidateRaw);
    if (candidate && candidate !== current) return candidateRaw;
    i += Number(direction);
  }
  return "";
}

function shotModeForIndex(index) {
  const n = Math.max(0, Number(index) || 0) % 4;
  if (n === 0) return "establishing wide shot";
  if (n === 1) return "medium character-driven scene";
  if (n === 2) return "close-up symbolic detail";
  return "dynamic action or transition shot";
}

function buildPromptifyPacket({
  cuts = [],
  index = 0,
  instruction = "",
  fullScript = "",
  previousPrompt = ""
} = {}) {
  const current = cuts[index] ?? {};
  const previousText = findDistinctNeighborText(cuts, index, -1);
  const nextText = findDistinctNeighborText(cuts, index, 1);
  const currentText = String(current?.obText ?? "").trim();
  const shotMode = shotModeForIndex(index);
  const lines = [
    "[ROLE]",
    "You generate ONE visual prompt for the CURRENT CUT only.",
    "Keep continuity with nearby cuts, but avoid repeating the same visual concept.",
    "",
    "[TASK]",
    packetValue(instruction),
    "",
    "[DIVERSITY GUARDRAILS]",
    "The image must be visually distinct from neighboring cuts and prior prompts.",
    "Do not reuse the same central composition, same subject arrangement, or same symbolic centerpiece.",
    "Prefer a new perspective, setting emphasis, or camera distance when semantic overlap exists.",
    "",
    "[GLOBAL CONTEXT]",
    `full_script: ${packetValue(fullScript)}`,
    "",
    "[NEIGHBOR CONTEXT]",
    `previous_cut: ${packetValue(previousText)}`,
    `current_cut: ${packetValue(currentText)}`,
    `next_cut: ${packetValue(nextText)}`,
    `shot_mode: ${packetValue(shotMode)}`,
    "",
    "[PRIOR VISUAL STATE]",
    `previous_prompt: ${packetValue(previousPrompt)}`,
    "",
    "[OUTPUT RULE]",
    "Return ONLY one single-line prompt. No markdown. No explanation."
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
  let previousPrompt = "";
  for (let i = 0; i < itinerary.cuts.length; i += 1) {
    const packet = buildPromptifyPacket({
      cuts: itinerary.cuts,
      index: i,
      instruction: "Turn this transcript cut into one concise visual image prompt for generation.",
      fullScript,
      previousPrompt
    });
    const prompt = await callPromptMind({
      host: opts.host,
      model: opts.model,
      systemPrompt: opts.systemPrompt,
      cutText: packet
    });
    previousPrompt = prompt;
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
