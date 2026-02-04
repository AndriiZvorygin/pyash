import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { sentenceToPyash } from "../beautiful.mjs";
import { mind_to_name_text } from "./mind/mind.mjs";

function normalizeInputs(values) {
  if (!Array.isArray(values)) return [];
  return values.map((value) => {
    if (value == null) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
    if (value.text !== undefined) return String(value.text);
    if (value.num !== undefined) return String(value.num);
    if (value.boolean !== undefined) return value.boolean ? "truth" : "lie";
    return JSON.stringify(value);
  });
}

function buildToolCallLogger() {
  return ({ toolName, toolSentence }) => {
    const rendered = sentenceToPyash(toolSentence);
    // eslint-disable-next-line no-console
    console.error(`[tool ${toolName}] ${rendered}`);
  };
}

export async function session(sentence, { inputs = [] } = {}) {
  const mindName = sentence?.for?.name ?? sentence?.to?.name ?? sentence?.su?.name ?? "mind";
  const toolMapName = sentence?.with?.name ?? null;
  const callTemplate = {
    mood: "do",
    be: "write",
    for: { name: mindName },
    with: toolMapName ? { name: toolMapName } : undefined,
    at: sentence?.at,
    fromtext: sentence?.fromtext,
    accordingto: sentence?.accordingto
  };

  const scripted = [
    ...normalizeInputs(sentence?.ob?.ve?.values),
    ...normalizeInputs(inputs),
  ];
  if (sentence?.ob?.text) scripted.unshift(String(sentence.ob.text));

  const onToolCall = buildToolCallLogger();

  const runTurn = async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return { done: false };
    if (trimmed === "/bye") return { done: true };
    const callSentence = {
      ...callTemplate,
      ob: { text: trimmed }
    };
    const result = await mind_to_name_text(callSentence, { onToolCall });
    const responseText = result?.ob?.text ?? "";
    if (responseText) output.write(`${responseText}\n`);
    return { done: false };
  };

  if (scripted.length > 0) {
    for (const line of scripted) {
      const { done } = await runTurn(String(line ?? ""));
      if (done) break;
    }
    return { be: "session" };
  }

  const rl = readline.createInterface({ input, output });
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const line = await rl.question("> ");
      const { done } = await runTurn(line);
      if (done) break;
    }
  } finally {
    rl.close();
  }
  return { be: "session" };
}

export default session;

export const signatures = [
  { signatureWords: ["be", "session", "for", "name", "mind"], handler: session },
  { signatureWords: ["be", "session", "for", "name", "mind", "with", "name", "map"], handler: session },
  { signatureWords: ["be", "session", "for", "name", "mind", "at", "filename"], handler: session },
  { signatureWords: ["be", "session", "for", "name", "mind", "with", "name", "map", "at", "filename"], handler: session }
];
