import { parse } from "./parser.mjs";
import { interpret } from "./dispatcher.mjs";
import { dumpMemory } from "./memory.mjs";

async function run(line) {
  const s = parse(line);
  const result = await interpret(s);
  console.log(line, "→", JSON.stringify(result, null, 2));
}

await run("subj name collector obj num 7 be number ya");
await run("subj name collector from number 5 be giant then");
await run("obj num 2 to name collector be add do");
await run("subj name collector obj what que");

console.log("\nMemory:", JSON.stringify(dumpMemory(), null, 2));
