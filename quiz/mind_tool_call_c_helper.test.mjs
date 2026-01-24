import test from "node:test";
import assert from "node:assert/strict";
import { interpret } from "../program/bridge/index.mjs";
import { parse } from "../program/understand/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("compile includes tool_call_id and tool capture for mind tools (C)", async () => {
  forget();

  const program = [
    "su name tools be map def",
    "su name plus num be plus ob num 1 to name num can",
    "prah",
    "exists su name helper be mind via state \"qwen3:8b\" ya",
    "ob text \"use plus\" for name helper to name text helper-out with name tools be write do"
  ].join("\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state c to text output be compile do`
  );

  const result = await interpret(sentence);
  const csrc = result?.ob?.text ?? result?.value?.text ?? "";

  assert.ok(csrc.includes("tool_call_id"));
  assert.ok(csrc.includes("pya_tool_capture"));
  assert.ok(csrc.includes("pya_tool_output"));
});
