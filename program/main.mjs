// main.mjs
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { parse } from "./understand/index.mjs";
import { interpret } from "./bridge/index.mjs";
import { allRemember, forget, remember, doRemember } from "./remember/index.mjs";
import { splitSentences, splitSentencesWithLines } from "./library/sentenceSplitter.mjs";
import { setEntryModulePath } from "./bridge/modules.mjs";
import { state } from "./bridge/state.mjs";
import { sentenceToPyash } from "./beautiful.mjs";

async function loadConfigFile({ configPath, interpretFn }) {
  try {
    const raw = await fs.readFile(configPath, "utf8");
    const lines = splitSentencesWithLines(raw, { includeThen: true });
    for (const entry of lines) {
      const trimmed = entry.text.trim();
      if (!trimmed) continue;
      state.currentSourceFilename = configPath;
      state.currentSourceLine = entry.line;
      const sentence = parse(trimmed);
      state.currentSourceSentence = sentence;
      await interpretFn(sentence);
    }
    state.currentSourceFilename = null;
    state.currentSourceLine = null;
    state.currentSourceSentence = null;
  } catch (err) {
    if (err?.code === "ENOENT") return;
    throw err;
  }
}

async function loadDefaultConfig({ cwd, interpretFn }) {
  const configPaths = [
    path.resolve(cwd, "configure", "default.pya"),
    path.resolve(cwd, "configure", "secret.pya")
  ];
  for (const configPath of configPaths) {
    await loadConfigFile({ configPath, interpretFn });
  }
}

async function repl() {
  setEntryModulePath(process.cwd());
  await loadDefaultConfig({ cwd: process.cwd(), interpretFn: interpret });
  const runRoot = path.resolve(process.cwd());
  if (!remember("run root")) {
    doRemember({ mood: "ya", su: { name: "run root" }, be: "default", ob: { filename: runRoot } });
  }
  const rl = readline.createInterface({ input, output });

  console.log("Pyash REPL");
  console.log("Commands:");
  console.log("  mem    - show current memory (all sentences, last-write-wins)");
  console.log("  reset  - clear memory");
  console.log("  quit   - exit");
  console.log("  paste  - enter multi-line mode (end with a single '.' on its own line)");
  console.log("");
  console.log("Type a Pyash sentence to interpret it.\n");

  const toResultSentence = (res, fallbackSentence) => {
    if (res?.mood && res?.be) return res;
    if (res?.sentence?.mood && res?.sentence?.be) return res.sentence;
    const remembered = remember("result");
    if (remembered?.mood && remembered?.be) return remembered;
    if (fallbackSentence?.mood) return fallbackSentence;
    return null;
  };

  const processBlock = async (block) => {
    if (block.trim() === ".") return "end";
    const sentences = splitSentencesWithLines(block, { includeThen: true });

    for (const entry of sentences) {
      const trimmed = entry.text.trim();
      if (!trimmed) continue;

      if (trimmed === "quit" || trimmed === "exit") {
        return "quit";
      }

      if (trimmed === "mem") {
        const lines = allRemember().map((sentence) => sentenceToPyash(sentence));
        console.log(lines.join("\n"));
        continue;
      }

      if (trimmed === "reset") {
        forget();
        console.log("Memory cleared.");
        continue;
      }

      try {
        state.currentSourceFilename = "<repl>";
        state.currentSourceLine = entry.line ?? 1;
        const sentence = parse(trimmed);
        state.currentSourceSentence = sentence;
        const result = await interpret(sentence);
        const resultSentence = toResultSentence(result, sentence);
        if (resultSentence?.mood) {
          console.log("→", sentenceToPyash(resultSentence));
        } else {
          console.log("→ (no result)");
        }
      } catch (err) {
        console.error("Error:", err.message);
      } finally {
        state.currentSourceFilename = null;
        state.currentSourceLine = null;
        state.currentSourceSentence = null;
      }
    }
  };

  while (true) {
    const line = await rl.question("> ");
    const trimmed = line.trim();

    if (trimmed === "paste") {
      console.log("Paste Pyash lines; end with a single '.' on its own line.");
      const pastedLines = [];
      while (true) {
        const pasted = await rl.question("| ");
        if (pasted.trim() === ".") break;
        pastedLines.push(pasted);
      }
      const state = await processBlock(pastedLines.join("\n"));
      if (state === "quit") {
        rl.close();
        return;
      }
      continue;
    }

    const state = await processBlock(line);
    if (state === "quit") break;
  }

  rl.close();
}

await repl();
