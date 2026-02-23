import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { parse } from "../program/understand/index.mjs";
import { tokenize } from "../program/understand/tokenize.mjs";
import { QUOTED_TEXT_PREFIX } from "../program/understand/constants.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember, doRemember } from "../program/remember/index.mjs";
import { builtInSignatures } from "../program/verbs/index.mjs";
import { signatures as compileSignatures } from "../program/verbs/exchange/compile.mjs";
import { registerSignatureHandler, clearSignatureHandlers } from "../program/bridge/signature.mjs";
import { splitSentencesWithLines } from "../program/library/sentenceSplitter.mjs";
import { sentenceToPyash } from "../program/beautiful.mjs";
import { surfaceErrorSentence, throwErrorSentence } from "../program/error.mjs";
import { setEntryModulePath } from "../program/bridge/modules.mjs";
import { state } from "../program/bridge/state.mjs";
import { setExchangeRecorder, clearExchangeRecorder, setExchangeStrict, setExchangeRunId, setExchangeSentenceId } from "../program/bridge/exchange.mjs";
import { setRunNewspaperLines } from "../program/bridge/newspaper.mjs";
import { closeMcpServers } from "../program/motor/mcp.mjs";
import { runRefinery } from "../program/bridge/refinery.mjs";
import { resolveConfigBool, resolveConfigText } from "../program/configure/env.mjs";
import { loadConfigFile, loadDefaultConfig, formatIsoWithOffset, resolveTimeZone, readFlagValue, sanitizeRunId, normalizeRunRoot, shouldAutoEnableNewspaper, shouldAutoEnableNewspaperForRefinery, buildRunId, loadCheckpointIndex } from "./run_pya_helpers.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function renderSeriesSentence(sentence) {
  const name = sentence?.su?.name ?? "result";
  const entries = Array.isArray(sentence?.ob?.series) ? sentence.ob.series : [];
  const lines = [`su name ${name} be series def`];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const normalized = entry.mood ? entry : { mood: "ya", ...entry };
    try {
      lines.push(sentenceToPyash(normalized));
    } catch {
      lines.push(JSON.stringify(normalized));
    }
  }
  lines.push("prah");
  return lines.join("\n");
}

function sentenceHasLoopRegisters(sentence) {
  return Boolean(sentence?.mood === "do" && (sentence.fromindex || sentence.toindex));
}

function detectNestedLoops(parsedSentences) {
  const defRanges = new Map();
  for (let i = 0; i < parsedSentences.length; i += 1) {
    const sentence = parsedSentences[i];
    const defName = sentence?.su?.name;
    if (!defName || sentence?.be !== "ceremony") continue;
    if (sentence.mood === "def" && !defRanges.has(defName)) {
      defRanges.set(defName, { start: i, end: null });
    } else if (sentence.mood === "prah") {
      const entry = defRanges.get(defName);
      if (entry && entry.end == null) entry.end = i;
    }
  }

  const defHasLoop = new Set();
  for (const [name, range] of defRanges.entries()) {
    if (!range || typeof range.start !== "number" || typeof range.end !== "number") continue;
    const body = parsedSentences.slice(range.start + 1, range.end);
    if (body.some(sentenceHasLoopRegisters)) {
      defHasLoop.add(name);
    }
  }

  if (defHasLoop.size === 0) return false;
  for (const sentence of parsedSentences) {
    if (sentenceHasLoopRegisters(sentence) && defHasLoop.has(sentence.be)) {
      return true;
    }
  }
  return false;
}

function normalizeToken(token) {
  const text = String(token ?? "");
  if (text.startsWith(QUOTED_TEXT_PREFIX)) return text.slice(QUOTED_TEXT_PREFIX.length);
  return text;
}

function parsePortTriples(tokens = [], startIndex = 0, stopWords = new Set()) {
  const ports = [];
  let index = startIndex;
  if (tokens[index] === "ve") index += 1;
  while (index < tokens.length) {
    const token = tokens[index];
    if (stopWords.has(token)) break;
    const transport = tokens[index];
    const kind = tokens[index + 1];
    const handle = tokens[index + 2];
    if (!transport || !kind || !handle || stopWords.has(kind) || stopWords.has(handle)) {
      return { error: "input declaration malformed port triple" };
    }
    ports.push({
      transport: String(transport),
      kind: String(kind),
      handle: String(handle)
    });
    index += 3;
  }
  return { ports, index };
}

function parseInputDeclarationLine(rawLine = "") {
  const tokens = tokenize(String(rawLine).trim()).map(normalizeToken);
  if (tokens.length < 3) return null;
  const beIndex = tokens.lastIndexOf("be");
  if (beIndex < 0) return null;
  if (tokens[beIndex + 1] !== "input") return null;
  if (tokens[beIndex + 2] !== "ya") {
    return { error: "input declaration must end with be input ya" };
  }
  const obIndex = tokens.indexOf("ob");
  if (obIndex < 0 || obIndex >= beIndex) return { error: "input declaration missing ob ports" };
  const toIndex = tokens.indexOf("to");
  const obStops = new Set(toIndex > obIndex && toIndex < beIndex ? ["to", "be"] : ["be"]);
  const obResult = parsePortTriples(tokens, obIndex + 1, obStops);
  if (obResult.error) return { error: obResult.error };
  let outputs = [];
  if (toIndex > obIndex && toIndex < beIndex) {
    const toResult = parsePortTriples(tokens, toIndex + 1, new Set(["be"]));
    if (toResult.error) return { error: toResult.error };
    outputs = toResult.ports ?? [];
  }
  return { inputs: obResult.ports ?? [], outputs };
}

function collectInputDeclarations(entries = []) {
  const inputs = [];
  const outputs = [];
  for (const entry of entries) {
    const line = String(entry?.text ?? "").trim();
    if (!line) continue;
    const parsed = parseInputDeclarationLine(line);
    if (!parsed) continue;
    if (parsed.error) {
      throwErrorSentence({
        name: "input declaration defective",
        message: `input declaration defective: ${parsed.error}`,
        from: { name: "run" },
        raw: { line }
      });
    }
    if (Array.isArray(parsed.inputs)) inputs.push(...parsed.inputs);
    if (Array.isArray(parsed.outputs)) outputs.push(...parsed.outputs);
  }
  return { inputs, outputs };
}

function parseBindingTailWords(bindingWords = []) {
  const joined = bindingWords.join(" ").trim();
  if (!joined) return { explicit: [], shorthand: null };
  const tokens = tokenize(joined).map(normalizeToken).filter(Boolean);
  if (tokens.length === 1 && tokens[0] !== "ob") {
    return { explicit: [], shorthand: tokens[0] };
  }
  const explicit = [];
  let index = 0;
  while (index < tokens.length) {
    while (index < tokens.length && (tokens[index] === "ya" || tokens[index] === "and")) index += 1;
    if (index >= tokens.length) break;
    if (tokens[index] !== "ob") {
      throwErrorSentence({
        name: "input binding defective",
        message: "input binding defective: expected ob",
        from: { name: "run" },
        raw: { tokens, index }
      });
    }
    const transport = tokens[index + 1];
    const value = tokens[index + 2];
    if (!transport || value === undefined) {
      throwErrorSentence({
        name: "input binding defective",
        message: "input binding defective: expected ob <transport> <value>",
        from: { name: "run" },
        raw: { tokens, index }
      });
    }
    if (tokens[index + 3] !== "to" || tokens[index + 4] !== "name") {
      throwErrorSentence({
        name: "input binding defective",
        message: "input binding defective: expected to name <handle>",
        from: { name: "run" },
        raw: { tokens, index }
      });
    }
    const handle = tokens[index + 5];
    if (!handle) {
      throwErrorSentence({
        name: "input binding defective",
        message: "input binding defective: missing handle name",
        from: { name: "run" },
        raw: { tokens, index }
      });
    }
    explicit.push({ transport: String(transport), value: String(value), handle: String(handle) });
    index += 6;
  }
  return { explicit, shorthand: null };
}

function materializeBindingFact({ handle, transport, value }) {
  const key = String(handle ?? "").trim();
  const type = String(transport ?? "").trim();
  if (!key || !type) return;
  if (type === "filename") {
    doRemember({ mood: "ya", su: { name: key }, ob: { filename: String(value ?? "") }, be: "filename" });
    return;
  }
  if (type === "text") {
    doRemember({ mood: "ya", su: { name: key }, ob: { text: String(value ?? "") }, be: "text" });
    return;
  }
  if (type === "name") {
    doRemember({ mood: "ya", su: { name: key }, ob: { name: String(value ?? "") }, be: "name" });
    return;
  }
  throwErrorSentence({
    name: "input binding defective",
    message: `input binding defective: unsupported transport ${JSON.stringify(type)}`,
    from: { name: "run" },
    raw: { handle, transport, value }
  });
}

function bindRuntimeInputs({ declarations, bindingWords }) {
  const inputs = Array.isArray(declarations?.inputs) ? declarations.inputs : [];
  const outputs = Array.isArray(declarations?.outputs) ? declarations.outputs : [];
  const ports = [...inputs, ...outputs];
  if (ports.length === 0) {
    if (Array.isArray(bindingWords) && bindingWords.length > 0) {
      throwErrorSentence({
        name: "input binding defective",
        message: "input binding defective: no be input ya declaration in program",
        from: { name: "run" },
        raw: { bindingWords }
      });
    }
    return;
  }
  const byHandle = new Map();
  for (const port of ports) {
    const handle = String(port?.handle ?? "").trim();
    if (!handle) continue;
    if (byHandle.has(handle)) {
      throwErrorSentence({
        name: "input declaration defective",
        message: `input declaration defective: duplicate handle ${JSON.stringify(handle)}`,
        from: { name: "run" },
        raw: { declarations }
      });
    }
    byHandle.set(handle, port);
  }
  const { explicit, shorthand } = parseBindingTailWords(bindingWords);
  const bound = new Map();
  if (shorthand !== null) {
    const filenameInputs = inputs.filter(port => String(port?.transport ?? "") === "filename");
    if (filenameInputs.length !== 1) {
      throwErrorSentence({
        name: "input binding defective",
        message: "input binding defective: shorthand requires exactly one filename input port",
        from: { name: "run" },
        raw: { declarations, shorthand }
      });
    }
    const port = filenameInputs[0];
    bound.set(String(port.handle), { handle: String(port.handle), transport: "filename", value: String(shorthand) });
  }
  for (const row of explicit) {
    const handle = String(row?.handle ?? "").trim();
    const declared = byHandle.get(handle);
    if (!declared) {
      throwErrorSentence({
        name: "input binding defective",
        message: `input binding defective: unknown handle ${JSON.stringify(handle)}`,
        from: { name: "run" },
        raw: { row }
      });
    }
    const expectedTransport = String(declared?.transport ?? "");
    const gotTransport = String(row?.transport ?? "");
    if (expectedTransport && gotTransport && expectedTransport !== gotTransport) {
      throwErrorSentence({
        name: "input binding defective",
        message: `input binding defective: transport mismatch for ${JSON.stringify(handle)} (expected ${expectedTransport}, got ${gotTransport})`,
        from: { name: "run" },
        raw: { row, declared }
      });
    }
    if (bound.has(handle)) {
      throwErrorSentence({
        name: "input binding defective",
        message: `input binding defective: duplicate binding for ${JSON.stringify(handle)}`,
        from: { name: "run" },
        raw: { row }
      });
    }
    bound.set(handle, { handle, transport: expectedTransport || gotTransport, value: String(row?.value ?? "") });
  }
  for (const required of inputs) {
    const handle = String(required?.handle ?? "").trim();
    if (!handle) continue;
    if (!bound.has(handle)) {
      throwErrorSentence({
        name: "input binding defective",
        message: `input binding defective: missing required input ${JSON.stringify(handle)}`,
        from: { name: "run" },
        raw: { declarations }
      });
    }
  }
  for (const item of bound.values()) {
    materializeBindingFact(item);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const gross = args.includes("--gross");
  const fullFlag = args.includes("--full");
  const verboseFlag = args.includes("--verbose");
  const showResultFlag = args.includes("--result");
  const disableNewspaperFlag = args.includes("--no-newspaper");
  const disableJitFlag = args.includes("--no-jit");
  const useNewspaperFlag = !disableNewspaperFlag;
  const useAgain = args.includes("--again");
  const noCheckpoint = args.includes("--no-checkpoint");
  const runIdFlag = readFlagValue(args, "--run-id");
  const runTimeFlag = readFlagValue(args, "--run-time");
  const refineryFlag = readFlagValue(args, "--refinery");
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--gross" || arg === "--full" || arg === "--result" || arg === "--newspaper" || arg === "--no-newspaper" || arg === "--again" || arg === "--no-checkpoint") continue;
    if (arg === "--run-id" || arg === "--run-time" || arg === "--refinery") {
      i += 1;
      continue;
    }
    if (arg.startsWith("--run-id=") || arg.startsWith("--run-time=") || arg.startsWith("--refinery=")) continue;
    if (arg.startsWith("--")) continue;
    positional.push(arg);
  }
  const filePath = positional[0];
  const runtimeBindingWords = positional.slice(1);

  if (!filePath) {
    console.error("Usage: node command/run_pya_program.mjs [--gross] [--full] [--result] [--newspaper] [--no-newspaper] [--no-jit] [--verbose] [--again] [--no-checkpoint] [--run-id <id>] [--run-time <iso>] [--refinery <name>] <path/to/file.pya> [runtime input binding words]");
    process.exit(1);
  }

  const resolved = path.resolve(filePath);
  setEntryModulePath(resolved);
  let text;
  let readFromFile = true;
  try {
    text = await fs.readFile(resolved, "utf8");
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    // Treat the positional args as inline Pyash when the path does not exist.
    text = positional.join(" ");
    readFromFile = false;
  }

  forget();
  clearExchangeRecorder();
  if (useAgain) setExchangeStrict(false);
  clearSignatureHandlers();
  for (const sig of [...builtInSignatures, ...compileSignatures]) {
    registerSignatureHandler(sig);
  }
  await loadDefaultConfig({ cwd: process.cwd(), interpretFn: interpret, entryPath: resolved });
  const runRoot = normalizeRunRoot(path.resolve(process.cwd()));
  if (!remember("run root")) {
    doRemember({ mood: "ya", su: { name: "run root" }, be: "default", ob: { filename: runRoot } });
  }
  const sentences = splitSentencesWithLines(text, { includeThen: true });
  if (readFromFile) {
    const inputDeclarations = collectInputDeclarations(sentences);
    bindRuntimeInputs({ declarations: inputDeclarations, bindingWords: runtimeBindingWords });
  }
  if (!disableJitFlag && process.env.PYA_NO_JIT_LOOPS !== "1" && readFromFile) {
    const parsed = sentences
      .map(({ text: sentenceText }) => parse(sentenceText))
      .filter(Boolean);
    if (detectNestedLoops(parsed)) {
      const runjsArgs = args.filter((arg) => arg !== "--no-jit");
      const runjsPath = path.resolve(root, "runjs");
      const child = spawn(runjsPath, runjsArgs, { stdio: "inherit" });
      child.on("exit", (code) => process.exit(code ?? 0));
      return;
    }
  }
  let useNewspaper = useNewspaperFlag;
  const autoNewspaperMind = resolveConfigBool("newspaper mind auto", { rememberFn: remember });
  if (!useNewspaper && !useAgain && autoNewspaperMind) {
    if (shouldAutoEnableNewspaper({ entries: sentences, rememberFn: remember })) {
      useNewspaper = true;
    }
  }
  if (!useNewspaper && !useAgain) {
    if (shouldAutoEnableNewspaperForRefinery({ entries: sentences })) {
      useNewspaper = true;
    }
  }
  const outputs = [];
  const timeZone = resolveTimeZone(remember);
  const runTime = runTimeFlag || (timeZone ? formatIsoWithOffset(new Date(), timeZone) : new Date().toISOString());
  const runId = runIdFlag || await buildRunId({ runTime, sourcePath: resolved, cwd: process.cwd() });
  const newspaperLines = [];
  setRunNewspaperLines(newspaperLines);
  let toolCounter = 0;
  const pushNewspaper = (line) => {
    if (!line) return;
    if ((useNewspaper || useAgain)) newspaperLines.push(line);
    if (verbose) {
      // eslint-disable-next-line no-console
      console.log(line);
    }
  };
  const nextToolCounter = () => String(++toolCounter).padStart(6, "0");
  const emitToolEvent = (evokedSentence, resultSentence) => {
    if (!(useNewspaper || useAgain)) return;
    if (!evokedSentence || !resultSentence) return;
    const counter = nextToolCounter();
    pushNewspaper(`su name tool event ${counter} ob la ${evokedSentence} ko to la ${resultSentence} ko be tool ya`);
  };
  const isToolSentence = (sentence) => {
    if (!sentence) return false;
    if (sentence.be === "mind") return sentence.mood === "do";
    if (sentence.be === "command") return true;
    if (sentence.be !== "write") return false;
    const targetName = sentence.to?.name;
    if (!targetName) return false;
    const target = remember(targetName);
    return target?.be === "mind";
  };

  const full = fullFlag;
  const verbose = verboseFlag;
  if (full) {
    console.log("Program:");
    if (gross) {
      console.log(JSON.stringify(sentences, null, 2));
    } else {
      console.log(text.trim());
    }
  }
  const runStart = `exists su name ${runId} from time ${runTime} be run ya`;
  pushNewspaper(runStart);
  pushNewspaper(`ob filename "${runRoot}" be run root ya`);
  if (useAgain) {
    pushNewspaper(`exists su name ${runId} as name again be run ya`);
  }
  if (useNewspaper || useAgain) {
    setExchangeRecorder({
      runRoot,
      record: (sentence) => pushNewspaper(sentenceToPyash(sentence))
    });
    setExchangeRunId(runId);
    if (useAgain) setExchangeStrict(true);
  }
  let runError = null;
  let refineryResult = null;
  let refineryName = refineryFlag ?? null;
  let checkpointIndex = null;
  const isInteractive = process.env.PYA_FORCE_INTERACTIVE === "1" ||
    (process.stdout?.isTTY === true && process.stdin?.isTTY === true);
  let pendingToolEvoked = null;

  const toResultSentence = (res, fallbackSentence) => {
    if (res?.mood && res?.be) return res;
    if (res?.sentence?.mood && res?.sentence?.be) return res.sentence;
    const remembered = remember("result");
    if (remembered?.mood && remembered?.be) return remembered;
    if (fallbackSentence?.mood) return fallbackSentence;
    return null;
  };

  const promptDecision = async (promptText) => {
    const rl = readline.createInterface({ input, output });
    try {
      // Default to "lie" on empty input for safety.
      const answer = await rl.question(`${promptText} [y/N] `);
      const normalized = answer.trim().toLowerCase();
      if (normalized === "y" || normalized === "yes") return { decision: "truth", raw: answer };
      if (normalized === "n" || normalized === "no" || normalized === "") return { decision: "lie", raw: answer };
      return null;
    } finally {
      rl.close();
    }
  };

  const recordDecision = (decisionName, decisionText) => {
    if (!decisionName) return;
    const decisionBool = decisionText === "truth";
    const decisionSentence = {
      mood: "ya",
      be: "bool",
      su: { name: decisionName },
      ob: { boolean: decisionBool }
    };
    doRemember(decisionSentence);
    pushNewspaper(sentenceToPyash(decisionSentence));
  };

  const buildRatifyDecisionSentence = ({ surfaced, decision, decisionRaw }) => {
    if (!surfaced || surfaced.be !== "ratify") return null;
    const decisionSentence = {
      mood: "ya",
      be: "ratify",
      su: surfaced.su,
      ob: { boolean: decision === "truth" }
    };
    if (typeof decisionRaw === "string" && decisionRaw) {
      decisionSentence.totext = { text: decisionRaw };
    }
    const resumeToken = surfaced?.fromtext?.text ?? null;
    if (resumeToken) {
      decisionSentence.accordingto = { name: "resume token" };
      decisionSentence.fromtext = { text: resumeToken };
    }
    if (surfaced?.to?.name) {
      decisionSentence.to = { name: surfaced.to.name };
    }
    return decisionSentence;
  };

  const parseResumeToken = (tokenText) => {
    if (!tokenText) return null;
    try {
      const parsed = JSON.parse(String(tokenText));
      return (parsed && typeof parsed === "object") ? parsed : null;
    } catch {
      return null;
    }
  };

  const runRefineryWithCallbacks = async ({ resume, nameOverride } = {}) => runRefinery({
    name: nameOverride ?? refineryName,
    interpret,
    checkpointIndex,
    checkpointEnabled: !noCheckpoint,
    runId,
    resume,
    onEvoke: (actionSentence) => {
      const embedded = sentenceToPyash(actionSentence);
      if (isToolSentence(actionSentence)) pendingToolEvoked = embedded;
      pushNewspaper(`ob la ${embedded} ko be evoke ya`);
    },
    onCheckpoint: (checkpointSentence) => {
      pushNewspaper(sentenceToPyash(checkpointSentence));
    },
    onRetry: (retrySentence) => {
      pushNewspaper(sentenceToPyash(retrySentence));
    },
    onResult: (res) => {
      const resultSentence = toResultSentence(res, null);
      if (!resultSentence?.mood) return;
      const surfaced = surfaceErrorSentence(resultSentence);
      if (pendingToolEvoked && surfaced?.mood) emitToolEvent(pendingToolEvoked, sentenceToPyash(surfaced));
      pendingToolEvoked = null;
      pushNewspaper(sentenceToPyash(surfaced));
    }
  });

  let evokeCounter = -1;
  for (const entry of sentences) {
    const line = entry.text.trim();
    if (!line) continue;
    state.currentSourceFilename = resolved;
    state.currentSourceLine = entry.line;
    const sentence = parse(line);
    state.currentSourceSentence = sentence;
    const embedded = sentenceToPyash(sentence);
    evokeCounter += 1;
    const sentenceId = `evoke-${evokeCounter}`;
    if (useNewspaper || useAgain) {
      setExchangeSentenceId(sentenceId);
    }
    const isToolCall = isToolSentence(sentence);
    pushNewspaper(`exists su name ${sentenceId} ob la ${embedded} ko be evoke ya`);
    let res;
    try {
      res = await interpret(sentence);
    } catch (err) {
      const surfaced = surfaceErrorSentence(err?.sentence ?? err);
      if (isToolCall && surfaced?.mood) emitToolEvent(embedded, sentenceToPyash(surfaced));
      if (surfaced?.mood) pushNewspaper(sentenceToPyash(surfaced));
      runError = err;
      break;
    }
    const resultSentence = toResultSentence(res, sentence);
    if (resultSentence?.mood) {
      const surfaced = surfaceErrorSentence(resultSentence);
      if (isToolCall && surfaced?.mood) emitToolEvent(embedded, sentenceToPyash(surfaced));
      pushNewspaper(sentenceToPyash(surfaced));
      if (surfaced?.mood === "do" && surfaced?.be === "ratify" && isInteractive) {
        let decision = null;
        let decisionRaw = "";
        const promptText = surfaced?.ob?.text ?? "Approve?";
        while (decision === null) {
          const decisionResult = await promptDecision(promptText);
          if (decisionResult) {
            decision = decisionResult.decision;
            decisionRaw = decisionResult.raw ?? "";
          }
        }
        const decisionName = surfaced?.to?.name ?? null;
        recordDecision(decisionName, decision);
        const resumeRefinery = surfaced?.from?.name ?? null;
        if (decision !== "truth") {
          const decisionSentence = buildRatifyDecisionSentence({ surfaced, decision, decisionRaw });
          if (decisionSentence) pushNewspaper(sentenceToPyash(decisionSentence));
        } else if (resumeRefinery === "command") {
          const resumeTokenText = surfaced?.fromtext?.text ?? null;
          const resumeToken = parseResumeToken(resumeTokenText);
          const resumeSentence = (resumeToken?.kind === "command" && resumeToken?.sentence && typeof resumeToken.sentence === "object")
            ? { ...resumeToken.sentence }
            : null;
          if (!resumeSentence) {
            const badToken = surfaceErrorSentence({
              mood: "do",
              be: "error",
              su: { name: "resume defective" },
              ob: { text: "resume token must contain command sentence" }
            });
            if (badToken?.mood) pushNewspaper(sentenceToPyash(badToken));
            runError = { sentence: badToken };
            break;
          }
          resumeSentence.accordingto = { name: "ratify decision" };
          resumeSentence.totext = { text: "truth" };
          try {
            const resumed = await interpret(resumeSentence);
            const resumedSentence = toResultSentence(resumed, resumeSentence);
            if (resumedSentence?.mood) {
              const resumedSurfaced = surfaceErrorSentence(resumedSentence);
              pushNewspaper(sentenceToPyash(resumedSurfaced));
            }
          } catch (err) {
            const resumed = surfaceErrorSentence(err?.sentence ?? err);
            if (resumed?.mood) pushNewspaper(sentenceToPyash(resumed));
            runError = err;
            break;
          }
        } else if (resumeRefinery) {
          const resumeToken = surfaced?.fromtext?.text ?? null;
          try {
            const resumed = await runRefineryWithCallbacks({ resume: { token: resumeToken, decision, raw: decisionRaw }, nameOverride: resumeRefinery });
            if (resumed?.be) {
              doRemember({
                mood: resumed?.mood ?? "ya",
                su: { name: "result" },
                be: resumed.be,
                ob: resumed.ob ?? {}
              });
            }
          } catch (err) {
            const resumed = surfaceErrorSentence(err?.sentence ?? err);
            if (resumed?.mood) pushNewspaper(sentenceToPyash(resumed));
            runError = err;
            break;
          }
        }
      }
    }
    if (sentence?.mood === "que") outputs.push(res);
  }

  if (refineryFlag) {
    console.warn("warning: --refinery is deprecated; invoke refineries with `be refinery do` instead.");
  }
  if (!runError && !refineryName) {
    refineryName = resolveConfigText("refinery name", { rememberFn: remember }) ?? null;
    if (refineryName) {
      console.warn("warning: auto-running refinery via config is deprecated; invoke with `be refinery do` instead.");
    }
  }
  if (!runError && refineryName && !noCheckpoint) {
    checkpointIndex = await loadCheckpointIndex({ runId, cwd: process.cwd() });
  }
  if (!runError && refineryName) {
    try {
      refineryResult = await runRefineryWithCallbacks();
    } catch (err) {
      const surfaced = surfaceErrorSentence(err?.sentence ?? err);
      if (pendingToolEvoked && surfaced?.mood) emitToolEvent(pendingToolEvoked, sentenceToPyash(surfaced));
      pendingToolEvoked = null;
      if (surfaced?.mood) pushNewspaper(sentenceToPyash(surfaced));
      runError = err;
    }
  }

  while (!runError && refineryResult?.mood === "do" && refineryResult?.be === "ratify" && isInteractive) {
    let decision = null;
    let decisionRaw = "";
    const promptText = refineryResult?.ob?.text ?? "Approve?";
    while (decision === null) {
      const decisionResult = await promptDecision(promptText);
      if (decisionResult) {
        decision = decisionResult.decision;
        decisionRaw = decisionResult.raw ?? "";
      }
    }
    const decisionName = refineryResult?.to?.name ?? null;
    recordDecision(decisionName, decision);
    if (decision !== "truth") {
      const decisionSentence = buildRatifyDecisionSentence({ surfaced: refineryResult, decision, decisionRaw });
      if (decisionSentence) pushNewspaper(sentenceToPyash(decisionSentence));
      break;
    }
    const resumeToken = refineryResult?.fromtext?.text ?? null;
    try {
      refineryResult = await runRefineryWithCallbacks({ resume: { token: resumeToken, decision, raw: decisionRaw } });
    } catch (err) {
      const surfaced = surfaceErrorSentence(err?.sentence ?? err);
      if (pendingToolEvoked && surfaced?.mood) emitToolEvent(pendingToolEvoked, sentenceToPyash(surfaced));
      pendingToolEvoked = null;
      if (surfaced?.mood) pushNewspaper(sentenceToPyash(surfaced));
      runError = err;
      break;
    }
  }

  const result = refineryResult ?? remember("result");
  pushNewspaper(`exists su name ${runId} be end ya`);
  state.currentSourceFilename = null;
  state.currentSourceLine = null;
  state.currentSourceSentence = null;
  if (useNewspaper || useAgain) {
    const newspaperDir = path.resolve(process.cwd(), "newspaper");
    await fs.mkdir(newspaperDir, { recursive: true });
    const newspaperPath = path.join(newspaperDir, `${sanitizeRunId(runId)}.pya`);
    await fs.writeFile(newspaperPath, `${newspaperLines.join("\n")}\n`, "utf8");
  }
  clearExchangeRecorder();
  const closedServers = closeMcpServers();
  if (closedServers > 0) {
    console.warn("warning: MCP servers were still running at exit; add `be discharge ob name <server> as wo mcp do` to shut them down explicitly.");
  }
  if (runError) throw runError;

  if (full) {
    console.log("\nResult:");
  }

  const showResultConfig = resolveConfigBool("run result", { rememberFn: remember });
  const showResult = showResultFlag || showResultConfig === true;

  if (gross) {
    console.log(JSON.stringify({ outputs, result }, null, 2));
    return;
  }

  if (!showResult && !full) {
    return;
  }

  const streamStdout = resolveConfigBool("stream stdout", { rememberFn: remember });
  const streamStdoutEnabled = streamStdout !== undefined ? streamStdout : process.stdout?.isTTY === true;
  if (result?.be === "stream" && streamStdoutEnabled) {
    const finalResult = remember("result") ?? result;
    console.log("");
    try {
      console.log(finalResult ? sentenceToPyash(finalResult) : "(no result)");
    } catch {
      console.log(finalResult ? JSON.stringify(finalResult, null, 2) : "(no result)");
    }
    return;
  }

  // If the result is a compiled artifact with a text payload, stream it directly.
  if (result?.ob?.text && !full) {
    console.log(result.ob.text);
    return;
  }

  // Surface series payloads in block form so entry boundaries are visible.
  if (result?.be === "series" && Array.isArray(result?.ob?.series)) {
    console.log(renderSeriesSentence(result));
    return;
  }

  if (outputs.length) {
    console.log("Outputs:");
    outputs.forEach(o => console.log(o ?? "(null)"));
    console.log("\nResult:");
  }

  try {
    console.log(result ? sentenceToPyash(result) : "(no result)");
  } catch {
    console.log(result ? JSON.stringify(result, null, 2) : "(no result)");
  }
}

try {
  await main();
} catch (err) {
  const surfaced = surfaceErrorSentence(err?.sentence ?? err);
  if (surfaced?.mood && surfaced?.be) {
    console.error(sentenceToPyash(surfaced));
  } else {
    console.error(err?.message ?? err);
  }
  process.exit(1);
}
