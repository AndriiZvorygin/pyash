// main.mjs
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { parse } from "./understand/index.mjs";
import { interpret } from "./bridge/index.mjs";
import { dumpMemory, resetMemory } from "./memory/index.mjs";
import { splitSentences } from "./library/sentenceSplitter.mjs";

async function repl() {
  const rl = readline.createInterface({ input, output });

  console.log("Pyash REPL");
  console.log("Commands:");
  console.log("  mem    - show current memory (all sentences, last-write-wins)");
  console.log("  reset  - clear memory");
  console.log("  quit   - exit");
  console.log("  paste  - enter multi-line mode (end with a single '.' on its own line)");
  console.log("");
  console.log("Type a Pyash sentence to interpret it.\n");

  const processBlock = async (block) => {
    if (block.trim() === ".") return "end";
    const sentences = splitSentences(block);

    for (const raw of sentences) {
      const trimmed = raw.trim();
      if (!trimmed) continue;

      if (trimmed === "quit" || trimmed === "exit") {
        return "quit";
      }

      if (trimmed === "mem") {
        console.log("Memory:", JSON.stringify(dumpMemory(), null, 2));
        continue;
      }

      if (trimmed === "reset") {
        resetMemory();
        console.log("Memory cleared.");
        continue;
      }

      try {
        const sentence = parse(trimmed);
        const result = await interpret(sentence);
        console.log("→", JSON.stringify(result, null, 2));
      } catch (err) {
        console.error("Error:", err.message);
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
