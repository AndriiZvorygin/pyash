import fs from "node:fs/promises";
import path from "node:path";

import { parse } from "../understand/index.mjs";
import { interpret } from "../bridge/index.mjs";
import { forget, remember } from "../remember/index.mjs";
import { builtInSignatures } from "../verbs/index.mjs";
import { signatures as compileSignatures } from "../verbs/exchange/compile.mjs";
import { registerSignatureHandler, clearSignatureHandlers } from "../bridge/signature.mjs";
import { splitSentences } from "../library/sentenceSplitter.mjs";
import { sentenceToPyash } from "../beautiful.mjs";
import { surfaceErrorSentence } from "../error.mjs";
import { setEntryModulePath } from "../bridge/modules.mjs";
import { setExchangeRecorder, clearExchangeRecorder, setExchangeStrict } from "../bridge/exchange.mjs";
import { runRefinery } from "../bridge/refinery.mjs";

function readFlagValue(args, name) {
  const prefix = `${name}=`;
  const idx = args.findIndex(arg => arg === name || arg.startsWith(prefix));
  if (idx === -1) return null;
  const arg = args[idx];
  if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  return args[idx + 1] ?? null;
}

function sanitizeRunId(value) {
  return String(value ?? "")
    .trim()
    .replace(/[\\/]/g, "_")
    .replace(/\s+/g, "-") || "run";
}

function normalizeRunRoot(value) {
  return String(value ?? "").replace(/[\\]+/g, "/");
}

async function main() {
  const args = process.argv.slice(2);
  const gross = args.includes("--gross");
  const full = args.includes("--full");
  const useNewspaper = args.includes("--newspaper");
  const useAgain = args.includes("--again");
  const runIdFlag = readFlagValue(args, "--run-id");
  const runTimeFlag = readFlagValue(args, "--run-time");
  const refineryFlag = readFlagValue(args, "--refinery");
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--gross" || arg === "--full" || arg === "--newspaper" || arg === "--again") continue;
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
    console.error("Usage: node program/cli/run_pya_program.mjs [--gross] [--full] [--newspaper] [--again] [--run-id <id>] [--run-time <iso>] [--refinery <name>] <path/to/file.pya>");
    process.exit(1);
  }

  const resolved = path.resolve(filePath);
  setEntryModulePath(resolved);
  let text;
  try {
    text = await fs.readFile(resolved, "utf8");
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    // Treat the positional args as inline Pyash when the path does not exist.
    text = positional.join(" ");
  }

  forget();
  clearExchangeRecorder();
  if (useAgain) setExchangeStrict(false);
  clearSignatureHandlers();
  for (const sig of [...builtInSignatures, ...compileSignatures]) {
    registerSignatureHandler(sig);
  }
  const sentences = splitSentences(text);
  const outputs = [];
  const runId = runIdFlag || `run-${Date.now()}`;
  const runTime = runTimeFlag || new Date().toISOString();
  const runRoot = normalizeRunRoot(path.resolve(process.cwd()));
  const newspaperLines = [];
  let toolCounter = 0;
  const pushNewspaper = (line) => {
    if ((useNewspaper || useAgain) && line) newspaperLines.push(line);
  };
  const nextToolCounter = () => String(++toolCounter).padStart(6, "0");
  const emitToolEvent = (evokedSentence, resultSentence) => {
    if (!(useNewspaper || useAgain)) return;
    if (!evokedSentence || !resultSentence) return;
    const counter = nextToolCounter();
    pushNewspaper(`su name tool event ${counter} ob la ${evokedSentence} ko to la ${resultSentence} ko be tool ya`);
  };
  const isMindToolCall = (sentence) => {
    if (!sentence) return false;
    if (sentence.be === "mind") return true;
    if (sentence.be !== "write") return false;
    const targetName = sentence.to?.name;
    if (!targetName) return false;
    const target = remember(targetName);
    return target?.be === "mind";
  };

  if (full) {
    console.log("Program:");
    if (gross) {
      console.log(JSON.stringify(sentences, null, 2));
    } else {
      console.log(text.trim());
    }
  }
  const runStart = `su name ${runId} from time ${runTime} be run ya`;
  pushNewspaper(runStart);
  pushNewspaper(`ob filename "${runRoot}" be run root ya`);
  if (useAgain) {
    pushNewspaper(`su name ${runId} as name again be run ya`);
  }
  if (useNewspaper || useAgain) {
    setExchangeRecorder({
      runRoot,
      record: (sentence) => pushNewspaper(sentenceToPyash(sentence))
    });
    if (useAgain) setExchangeStrict(true);
  }
  let runError = null;
  let refineryResult = null;

  const toResultSentence = (res, fallbackSentence) => {
    if (res?.mood && res?.be) return res;
    if (res?.sentence?.mood && res?.sentence?.be) return res.sentence;
    const remembered = remember("result");
    if (remembered?.mood && remembered?.be) return remembered;
    if (fallbackSentence?.mood) return fallbackSentence;
    return null;
  };

  for (const raw of sentences) {
    const line = raw.trim();
    if (!line) continue;
    const sentence = parse(line);
    const embedded = sentenceToPyash(sentence);
    const isToolCall = isMindToolCall(sentence);
    pushNewspaper(`ob la ${embedded} ko be evoke ya`);
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
    }
    if (sentence?.mood === "que") outputs.push(res);
  }

  if (!runError && refineryFlag) {
    let pendingToolEvoked = null;
    try {
      refineryResult = await runRefinery({
        name: refineryFlag,
        interpret,
        onEvoke: (actionSentence) => {
          const embedded = sentenceToPyash(actionSentence);
          if (isMindToolCall(actionSentence)) pendingToolEvoked = embedded;
          pushNewspaper(`ob la ${embedded} ko be evoke ya`);
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
    } catch (err) {
      const surfaced = surfaceErrorSentence(err?.sentence ?? err);
      if (pendingToolEvoked && surfaced?.mood) emitToolEvent(pendingToolEvoked, sentenceToPyash(surfaced));
      pendingToolEvoked = null;
      if (surfaced?.mood) pushNewspaper(sentenceToPyash(surfaced));
      runError = err;
    }
  }

  const result = refineryResult ?? remember("result");
  pushNewspaper(`su name ${runId} be end ya`);
  if (useNewspaper || useAgain) {
    const newspaperDir = path.resolve(process.cwd(), "newspaper");
    await fs.mkdir(newspaperDir, { recursive: true });
    const newspaperPath = path.join(newspaperDir, `${sanitizeRunId(runId)}.pya`);
    await fs.writeFile(newspaperPath, `${newspaperLines.join("\n")}\n`, "utf8");
  }
  clearExchangeRecorder();
  if (runError) throw runError;

  if (full) {
    console.log("\nResult:");
  }

  if (gross) {
    console.log(JSON.stringify({ outputs, result }, null, 2));
    return;
  }

  // If the result is a compiled artifact with a text payload, stream it directly.
  if (result?.ob?.text) {
    console.log(result.ob.text);
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
