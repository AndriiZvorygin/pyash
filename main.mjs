// main.mjs
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { parse } from "./parser.mjs";
import { interpret } from "./dispatcher.mjs";
import { dumpMemory, resetMemory } from "./memory.mjs";

async function repl() {
  const rl = readline.createInterface({ input, output });

  console.log("Pyash REPL");
  console.log("Commands:");
  console.log("  mem    - show current memory (all sentences, last-write-wins)");
  console.log("  reset  - clear memory");
  console.log("  quit   - exit");
  console.log("");
  console.log("Type a Pyash sentence to interpret it.\n");

  while (true) {
    const line = await rl.question("> ");
    const trimmed = line.trim();

    if (!trimmed) continue;

    if (trimmed === "quit" || trimmed === "exit") {
      break;
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

  rl.close();
}

await repl();
