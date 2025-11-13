// main.mjs
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { parse } from "./parser.mjs";
import { interpret, dumpMemory } from "./dispatcher.mjs";
import { dumpHistory } from "./memory.mjs";

async function repl() {
  const rl = readline.createInterface({ input, output });

  console.log("Pyash REPL");
  console.log("Type a sentence, 'mem' to see state, 'hist' for history, 'quit' to exit.\n");

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

    if (trimmed === "hist") {
      console.log("History:", JSON.stringify(dumpHistory(), null, 2));
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
