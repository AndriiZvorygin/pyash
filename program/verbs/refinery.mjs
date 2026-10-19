import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { remember, doRemember } from "../remember/index.mjs";
import { resolveConfigText } from "../configure/env.mjs";
import { runRefinery, getRefinery } from "../bridge/refinery.mjs";
import { normalizeSimulationContract } from "../bridge/refinery_simulation.mjs";
import { emitExchangeSentence } from "../bridge/exchange.mjs";
import { parse } from "../understand/index.mjs";
import { splitSentencesWithLines } from "../library/sentenceSplitter.mjs";
import { surfaceErrorSentence, throwErrorSentence } from "../error.mjs";
import { collectInputDeclarations } from "../runtime/input_ports.mjs";

let nativeRefineryCounter = 0;

async function resolveInterpret() {
  const mod = await import("../bridge/index.mjs");
  return mod.interpret;
}

function sanitizeRunSegment(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "") || "stage";
}

function buildNativeRefineryRunId(filename) {
  nativeRefineryCounter += 1;
  const base = sanitizeRunSegment(path.basename(String(filename ?? ""), ".pya"));
  const leaf = `${base}-${String(nativeRefineryCounter).padStart(3, "0")}`;
  const parentRunId = String(process.env.PYA_RUN_ID ?? "").trim();
  if (parentRunId) return `${parentRunId}/native-refinery/${leaf}`;
  return `native-refinery/${leaf}`;
}

function bindingsMapFromName(name) {
  const fact = name ? remember(name) : null;
  if (!fact) return null;
  if (fact.be !== "map" && fact.be !== "json map") {
    throwErrorSentence({
      name: "refinery binding defective",
      message: `refinery binding defective: ${JSON.stringify(name)} not map`,
      from: { name: "refinery" },
      raw: { fact }
    });
  }
  return fact.ob?.map ?? {};
}

function bindingWordForPort({ handle, transport, value }) {
  return ["ob", transport, value, "to", "name", handle];
}

function stringifyBindingValue(entry, transport, handle) {
  const current = entry && typeof entry === "object" && entry.ob && typeof entry.ob === "object" ? entry.ob : entry;
  if (!current || typeof current !== "object") {
    throwErrorSentence({
      name: "refinery binding defective",
      message: `refinery binding defective: missing ${JSON.stringify(handle)}`,
      from: { name: "refinery" },
      raw: { handle, transport, entry }
    });
  }
  if (transport === "filename") {
    if (typeof current.filename === "string") return current.filename;
    throwErrorSentence({
      name: "refinery binding defective",
      message: `refinery binding defective: ${JSON.stringify(handle)} not filename`,
      from: { name: "refinery" },
      raw: { handle, transport, entry: current }
    });
  }
  if (transport === "text") {
    if (typeof current.text === "string") return current.text;
    if (typeof current.num === "number") return String(current.num);
    if (typeof current.boolean === "boolean") return current.boolean ? "truth" : "lie";
    throwErrorSentence({
      name: "refinery binding defective",
      message: `refinery binding defective: ${JSON.stringify(handle)} not text`,
      from: { name: "refinery" },
      raw: { handle, transport, entry: current }
    });
  }
  if (transport === "name") {
    if (typeof current.name === "string") return current.name;
    throwErrorSentence({
      name: "refinery binding defective",
      message: `refinery binding defective: ${JSON.stringify(handle)} not name`,
      from: { name: "refinery" },
      raw: { handle, transport, entry: current }
    });
  }
  throwErrorSentence({
    name: "refinery binding defective",
    message: `refinery binding defective: unsupported transport ${JSON.stringify(transport)}`,
    from: { name: "refinery" },
    raw: { handle, transport, entry: current }
  });
}

async function buildFileRefineryBindingWords({ filename, bindingsName }) {
  const text = await fs.readFile(String(filename), "utf8");
  const sentences = splitSentencesWithLines(text, { includeThen: true });
  const declarations = collectInputDeclarations(sentences);
  const inputs = Array.isArray(declarations?.inputs) ? declarations.inputs : [];
  const bindingMap = bindingsName ? bindingsMapFromName(bindingsName) : {};
  const words = [];
  for (const port of inputs) {
    const handle = String(port?.handle ?? "").trim();
    const transport = String(port?.transport ?? "").trim();
    const entry = bindingMap?.[handle];
    if (!entry) {
      throwErrorSentence({
        name: "refinery binding defective",
        message: `refinery binding defective: missing ${JSON.stringify(handle)}`,
        from: { name: "refinery" },
        raw: { filename, declarations, bindingsName }
      });
    }
    const value = stringifyBindingValue(entry, transport, handle);
    words.push(...bindingWordForPort({ handle, transport, value }));
  }
  return words;
}

function streamNativeRefineryText(text, { filename, channel }) {
  if (process.env.PYA_RUN_VERBOSE !== "1") return;
  const prefix = `[native refinery][${path.basename(String(filename ?? ""))}][${channel}] `;
  const normalized = String(text ?? "").replace(/\r\n?/gu, "\n");
  if (!normalized) return;
  const endsWithNewline = normalized.endsWith("\n");
  const lines = normalized.split("\n");
  if (endsWithNewline) lines.pop();
  for (const line of lines) {
    process.stderr.write(`${prefix}${line}\n`);
  }
}

async function runFileBackedRefinery(sentence) {
  const filename = sentence?.from?.filename;
  const resolvedFilename = path.resolve(String(filename ?? ""));
  const bindingWords = await buildFileRefineryBindingWords({
    filename: resolvedFilename,
    bindingsName: sentence?.ob?.name ?? null
  });
  const runId = buildNativeRefineryRunId(resolvedFilename);
  const runnerPath = path.resolve(process.cwd(), "command", "run_pya_program.mjs");
  const args = [runnerPath];
  if (process.env.PYA_RUN_VERBOSE === "1") args.push("--verbose");
  args.push("--run-id", runId, resolvedFilename, ...bindingWords);
  const child = await new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (data) => {
      const text = data.toString("utf8");
      stdout += text;
      streamNativeRefineryText(text, { filename: resolvedFilename, channel: "stdout" });
    });
    proc.stderr.on("data", (data) => {
      const text = data.toString("utf8");
      stderr += text;
      streamNativeRefineryText(text, { filename: resolvedFilename, channel: "stderr" });
    });
    proc.on("error", reject);
    proc.on("close", (code, signal) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const err = new Error(`native refinery defective: status=${code ?? 0} signal=${signal ?? ""}`);
      err.stdout = stdout;
      err.stderr = stderr;
      reject(err);
    });
  });

  const artifactDir = path.resolve(process.cwd(), "artifacts", runId);
  const resultFilename = path.join(artifactDir, "result.pya");
  const produceFilename = path.join(artifactDir, "produce.txt");
  const resultText = await fs.readFile(resultFilename, "utf8");
  const resultSentence = parse(String(resultText).trim());
  if (!resultSentence?.mood) {
    throwErrorSentence({
      name: "native refinery defective",
      message: "native refinery defective: result artifact unreadable",
      from: { name: "refinery" },
      raw: { resultText, runId }
    });
  }
  const resultMap = {
    produce: resultSentence.ob ?? {},
    kind: { text: String(resultSentence.be ?? "") },
    passing: { boolean: true },
    "run id": { text: runId },
    "artifacts folder": { filename: artifactDir },
    "result file": { filename: resultFilename },
    "program filename": { filename: resolvedFilename }
  };
  try {
    await fs.access(produceFilename);
    resultMap["produce file"] = { filename: produceFilename };
  } catch {
    // Child may not have a text produce artifact.
  }
  if (child.stderr) {
    resultMap.review = { text: String(child.stderr).trim() };
  }
  return { ob: { map: resultMap }, be: "map" };
}

function resolveGenitiveText(genitive) {
  const chainArr = Array.isArray(genitive?.chain) ? genitive.chain : [];
  if (chainArr.length === 0) return undefined;
  const [root, ...rest] = chainArr;
  let curr = typeof root === "string" ? remember(root) : undefined;
  for (const part of rest) {
    if (curr && typeof curr === "object" && curr.name) {
      const fact = remember(curr.name);
      if (fact) curr = fact.ob ?? fact;
    }
    if (curr && typeof curr === "object") {
      if (curr.ob?.map && Object.prototype.hasOwnProperty.call(curr.ob.map, part)) {
        curr = curr.ob.map[part];
      } else if (curr.ob && curr.ob[part] !== undefined) {
        curr = curr.ob[part];
      } else {
        curr = curr?.[part];
      }
    } else {
      curr = curr?.[part];
    }
  }
  if (typeof curr === "string") return curr;
  if (typeof curr === "number") return String(curr);
  if (curr && typeof curr === "object") {
    if (curr.text !== undefined) return String(curr.text);
    if (curr.num !== undefined) return String(curr.num);
    if (curr.boolean !== undefined) return curr.boolean ? "truth" : "lie";
  }
  return curr;
}

function resolveInputOb(ob) {
  if (!ob || typeof ob !== "object") return null;
  if (typeof ob.text === "string") return { text: ob.text };
  if (typeof ob.num === "number") return { num: ob.num };
  if (typeof ob.boolean === "boolean") return { boolean: ob.boolean };
  if (ob.genitive) {
    const text = resolveGenitiveText(ob.genitive);
    if (typeof text === "string") return { text };
  }
  if (typeof ob.name === "string") {
    const fact = remember(ob.name);
    if (fact?.ob?.text !== undefined) return { text: String(fact.ob.text) };
    if (fact?.ob?.num !== undefined) return { num: Number(fact.ob.num) };
    if (fact?.ob?.boolean !== undefined) return { boolean: !!fact.ob.boolean };
    return { text: ob.name };
  }
  return null;
}

function normalizeKey(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function mapEntryNumber(mapFact, keys) {
  const entries = mapFact?.ob?.map;
  if (!entries || typeof entries !== "object") return null;
  for (const key of keys) {
    const probe = entries[key]
      ?? entries[normalizeKey(key)]
      ?? Object.entries(entries).find(([entryKey]) => normalizeKey(entryKey) === normalizeKey(key))?.[1];
    if (!probe || typeof probe !== "object") continue;
    const value = probe?.ob?.num ?? probe?.ob?.text ?? probe?.num ?? probe?.text;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function buildRetryConfigFromConduct({ sentence, namedTarget, refineryName }) {
  const config = {};
  const sources = [];
  const globalConduct = remember("saddle conduct");
  if (globalConduct?.be === "map") sources.push(globalConduct);
  const targetConductName = namedTarget ? `${namedTarget} saddle conduct` : null;
  if (targetConductName) {
    const targetConduct = remember(targetConductName);
    if (targetConduct?.be === "map") sources.push(targetConduct);
  }
  const refineryConductName = refineryName ? `${refineryName} saddle conduct` : null;
  if (refineryConductName && refineryConductName !== targetConductName) {
    const refineryConduct = remember(refineryConductName);
    if (refineryConduct?.be === "map") sources.push(refineryConduct);
  }
  const explicitConductName = sentence?.under?.name
    ?? sentence?.beneath?.name
    ?? sentence?.fromunder?.name
    ?? null;
  if (explicitConductName) {
    const explicitConduct = remember(explicitConductName);
    if (explicitConduct?.be === "map") sources.push(explicitConduct);
  }

  for (const source of sources) {
    const attempts = mapEntryNumber(source, ["reiterate attempts", "attempts", "max attempts", "retry attempts"]);
    const delay = mapEntryNumber(source, ["reiterate delay", "delay", "initial delay", "retry delay"]);
    const backoff = mapEntryNumber(source, ["reiterate backoff", "backoff", "retry backoff"]);
    const cap = mapEntryNumber(source, ["reiterate cap", "cap", "max delay", "retry cap"]);
    if (attempts != null) config.maxAttempts = attempts;
    if (delay != null) config.initialDelayMs = delay;
    if (backoff != null) config.backoff = backoff;
    if (cap != null) config.maxDelayMs = cap;
  }

  const callMaxAttempts = sentence?.atmost?.num ?? null;
  if (Number.isFinite(callMaxAttempts)) config.maxAttempts = Number(callMaxAttempts);
  return Object.keys(config).length ? config : null;
}

function refineryConductName(sentence) {
  return sentence?.under?.name
    ?? sentence?.beneath?.name
    ?? sentence?.fromunder?.name
    ?? null;
}

async function refinery(sentence) {
  if (sentence?.from?.filename) {
    return runFileBackedRefinery(sentence);
  }
  const interpret = await resolveInterpret();
  const namedTarget = sentence?.for?.name ?? null;
  const namedTargetFact = namedTarget ? remember(namedTarget) : null;
  const refineryName =
    sentence?.from?.name ??
    sentence?.as?.name ??
    namedTargetFact?.as?.name ??
    namedTargetFact?.from?.name ??
    (namedTarget && getRefinery(namedTarget) ? namedTarget : null) ??
    resolveConfigText("refinery name", { rememberFn: remember }) ??
    null;
  const inputOb = resolveInputOb(sentence?.ob);
  const retryConfig = buildRetryConfigFromConduct({ sentence, namedTarget, refineryName });
  const conductName = refineryConductName(sentence);
  const conductFact = conductName ? remember(conductName) : null;
  const simulation = conductName ? normalizeSimulationContract(conductFact) : null;
  const priorInput = remember("input");

  if (inputOb) {
    const inputBe = inputOb?.num !== undefined ? "number" : inputOb?.boolean !== undefined ? "bool" : "text";
    doRemember({ mood: "ya", su: { name: "input" }, ob: inputOb, be: inputBe });
  }

  try {
    const resultSentence = await runRefinery({
      name: refineryName,
      interpret,
      retryConfig,
      simulation,
      runId: null,
      onEvoke: (actionSentence) => {
        emitExchangeSentence({ mood: "ya", be: "evoke", ob: { la: actionSentence } });
      },
      onCheckpoint: (checkpointSentence) => {
        emitExchangeSentence(checkpointSentence);
      },
      onRetry: (retrySentence) => {
        emitExchangeSentence(retrySentence);
      },
      onResult: (res) => {
        const surfaced = surfaceErrorSentence(res);
        if (surfaced?.mood) emitExchangeSentence(surfaced);
      }
    });
    if (resultSentence?.mood && resultSentence?.be) {
      if (resultSentence.be === "error") return resultSentence;
      if (resultSentence.be === "ratify") return resultSentence;
      return { ob: resultSentence.ob ?? {}, be: resultSentence.be };
    }
    return { ob: resultSentence ?? {}, be: "result" };
  } finally {
    if (priorInput) doRemember(priorInput);
  }
}

export const signatures = [
  { signatureWords: ["be", "refinery", "from", "filename", "to", "name", "map"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "filename", "ob", "name", "map", "to", "name", "map"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "filename", "ob", "name", "json", "map", "to", "name", "map"], handler: refinery },
  { signatureWords: ["be", "write", "for", "name", "text", "ob", "text", "to", "name", "text"], handler: refinery },
  { signatureWords: ["be", "write", "for", "name", "text", "ob", "name", "text", "to", "name", "text"], handler: refinery },
  { signatureWords: ["be", "write", "for", "name", "text", "ob", "text", "to", "text"], handler: refinery },
  { signatureWords: ["be", "write", "for", "name", "text", "ob", "name", "text", "to", "text"], handler: refinery },
  { signatureWords: ["be", "write", "for", "name", "text", "ob", "text"], handler: refinery },
  { signatureWords: ["be", "write", "for", "name", "text", "ob", "name", "text"], handler: refinery },
  { signatureWords: ["be", "write", "for", "name", "refinery", "ob", "text", "to", "name", "text"], handler: refinery },
  { signatureWords: ["be", "write", "for", "name", "refinery", "ob", "name", "text", "to", "name", "text"], handler: refinery },
  { signatureWords: ["be", "write", "for", "name", "refinery", "ob", "text", "to", "text"], handler: refinery },
  { signatureWords: ["be", "write", "for", "name", "refinery", "ob", "name", "text", "to", "text"], handler: refinery },
  { signatureWords: ["be", "write", "for", "name", "refinery", "ob", "text"], handler: refinery },
  { signatureWords: ["be", "write", "for", "name", "refinery", "ob", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "for", "name", "refinery", "ob", "text", "to", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "for", "name", "refinery", "ob", "name", "text", "to", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "for", "name", "refinery", "ob", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "for", "name", "refinery", "ob", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "to", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "text", "to", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "name", "text", "to", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "name", "num", "to", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "ob", "text", "to", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "text", "ob", "text", "to", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "name", "text", "ob", "text", "to", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "name", "num", "ob", "text", "to", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "ob", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "text", "ob", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "name", "text", "ob", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "name", "num", "ob", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "ob", "name", "text", "to", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "ob", "name", "text", "to", "name", "text", "under", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "ob", "name", "text", "to", "name", "text", "beneath", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "ob", "name", "text", "to", "name", "text", "beneath", "name", "map"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "name", "text", "ob", "name", "text", "to", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "name", "text", "ob", "name", "text", "to", "name", "text", "under", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "name", "text", "ob", "name", "text", "to", "name", "text", "beneath", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "name", "text", "ob", "name", "text", "to", "name", "text", "beneath", "name", "map"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "text", "ob", "name", "text", "to", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "text", "ob", "name", "text", "to", "name", "text", "under", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "text", "ob", "name", "text", "to", "name", "text", "beneath", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "text", "ob", "name", "text", "to", "name", "text", "beneath", "name", "map"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "name", "num", "ob", "name", "text", "to", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "name", "num", "ob", "name", "text", "to", "name", "text", "under", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "name", "num", "ob", "name", "text", "to", "name", "text", "beneath", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "name", "num", "ob", "name", "text", "to", "name", "text", "beneath", "name", "map"], handler: refinery },
  { signatureWords: ["be", "refinery", "ob", "text", "to", "name", "text", "under", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "ob", "text", "to", "name", "text", "beneath", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "ob", "text", "to", "name", "text", "beneath", "name", "map"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "name", "text", "ob", "text", "to", "name", "text", "under", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "name", "text", "ob", "text", "to", "name", "text", "beneath", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "name", "text", "ob", "text", "to", "name", "text", "beneath", "name", "map"], handler: refinery },
  { signatureWords: ["be", "refinery", "beneath", "name", "map", "from", "name", "text", "to", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "name", "text", "fromunder", "name", "map", "to", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "name", "text", "fromunder", "name", "map"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "text", "ob", "text", "to", "name", "text", "under", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "text", "ob", "text", "to", "name", "text", "beneath", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "text", "ob", "text", "to", "name", "text", "beneath", "name", "map"], handler: refinery }
];

export default refinery;
