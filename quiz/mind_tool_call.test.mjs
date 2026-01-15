import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { allRemember, forget } from "../program/remember/index.mjs";
import { deriveSignatureFromCall, joinSignatureWords } from "../program/bridge/signature.mjs";
import { resetMindLogs } from "../program/verbs/mind/mind.mjs";

test("mind tool calling executes allowed tool and returns final answer", async () => {
  forget();
  resetMindLogs();

  const toolSentence = parse("su name plus num be plus ob num 1 to name num can");
  const toolName = joinSignatureWords(deriveSignatureFromCall(toolSentence));

  const original = process.env.PYA_MIND_RESPONSE;
  process.env.PYA_MIND_RESPONSE = JSON.stringify([
    {
      message: {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            type: "function",
            function: {
              name: toolName,
              arguments: { ob: 2, to: "total" }
            }
          }
        ]
      }
    },
    { message: { role: "assistant", content: "done" } }
  ]);

  try {
    await interpret(parse("su name tools be map def"));
    await interpret(parse("su name plus num be plus ob num 1 to name num can"));
    await interpret(parse("prah"));
    await interpret(parse('exists su name helper be mind via state "qwen3" ya'));
    await interpret(parse("exists su name total ob num 3 be number ya"));

    await interpret(parse("ob text \"plus\" for name helper to name text helper-out with name tools be write do"));

    const mem = allRemember();
    const total = mem.find(s => s.su?.name === "total");
    const answer = mem.find(s => s.su?.name === "helper answer 1");

    assert.equal(total?.ob?.num, 5);
    assert.equal(answer?.ob?.text, "done");
  } finally {
    if (original === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = original;
  }
});
