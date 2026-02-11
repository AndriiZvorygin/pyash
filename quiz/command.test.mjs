import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { command } from "../program/verbs/command.mjs";

test("command executes quoted command text and returns stdout", async () => {
  process.env.PYA_COMMAND_RESPONSE = "hi";
  const sentence = parse(
    "ob wo quoted.command.printf hi.command.quoted be command do"
  );
  const result = await interpret(sentence);
  assert.equal(result?.ob?.text ?? result?.value?.text, "hi");
  delete process.env.PYA_COMMAND_RESPONSE;
});

test("command direct node uses process exec path when PATH is empty", async () => {
  const priorPath = process.env.PATH;
  process.env.PATH = "";
  try {
    const sentence = parse(
      "ob wo quoted.command.node -p 6*7.command.quoted be command do"
    );
    const result = await command(sentence, { remember: () => null });
    assert.equal(String(result?.ob?.text ?? "").trim(), "42");
  } finally {
    if (priorPath === undefined) delete process.env.PATH;
    else process.env.PATH = priorPath;
  }
});
