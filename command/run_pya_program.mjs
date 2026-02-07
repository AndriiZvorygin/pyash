import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember, doRemember } from "../program/remember/index.mjs";
import { builtInSignatures } from "../program/verbs/index.mjs";
import { signatures as compileSignatures } from "../program/verbs/exchange/compile.mjs";
import { registerSignatureHandler, clearSignatureHandlers } from "../program/bridge/signature.mjs";
import { splitSentencesWithLines } from "../program/library/sentenceSplitter.mjs";
import { sentenceToPyash } from "../program/beautiful.mjs";
import { surfaceErrorSentence } from "../program/error.mjs";
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

  if (!filePath) {
    console.error("Usage: node command/run_pya_program.mjs [--gross] [--full] [--result] [--newspaper] [--no-newspaper] [--no-jit] [--verbose] [--again] [--no-checkpoint] [--run-id <id>] [--run-time <iso>] [--refinery <name>] (deprecated) <path/to/file.pya>");
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
