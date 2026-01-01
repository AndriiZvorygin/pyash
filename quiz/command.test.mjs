import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";

test("command executes quoted command text and returns stdout", async () => {
  process.env.PYA_COMMAND_RESPONSE = "hi";
  const sentence = parse(
    "ob wo quoted.command.printf hi.command.quoted be command do"
  );
  const result = await interpret(sentence);
  assert.equal(result?.ob?.text ?? result?.value?.text, "hi");
  delete process.env.PYA_COMMAND_RESPONSE;
});
