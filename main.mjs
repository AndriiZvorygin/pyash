import { parse } from "./parser.mjs";
import { interpret, dumpMemory } from "./dispatcher.mjs";

async function run(line) {
  const s = parse(line);
  const result = interpret(s);
  console.log(line, "→", result);
}

await run("subj name collector obj num 7 be number ya");
await run("obj num 3 to name collector be add do");
await run("subj name collector obj what que");

console.log("\nMemory:", dumpMemory());
