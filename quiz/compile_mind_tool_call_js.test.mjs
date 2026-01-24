import test from "node:test";
import assert from "node:assert/strict";
import { interpret } from "../program/bridge/index.mjs";
import { parse } from "../program/understand/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("compile includes tool_call_id and interpret raw output handling for mind tools (JS)", async () => {
  forget();

  const program = [
    "su name tools be map def",
    "su name plus num be plus ob num 1 to name num can",
    "prah",
    "exists su name helper be mind via state \"qwen3:8b\" ya",
    "ob text \"use plus\" for name helper to name text helper-out with name tools be write do"
  ].join("\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = result?.ob?.text ?? result?.value?.text ?? "";

  assert.ok(js.includes("tool_call_id"));
  assert.ok(js.includes("rawText.match(/^quoted"));
});
