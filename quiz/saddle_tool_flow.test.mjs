import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";
import { resetMindLogs } from "../program/verbs/mind/mind.mjs";

test("coding saddle can execute command then repair via tool calls", async () => {
  forget();
  resetMindLogs();

  const outDir = path.join(process.cwd(), "artifacts", "saddle-flow");
  await fs.mkdir(outDir, { recursive: true });
  const targetPath = path.join(outDir, "hello.js");
  const normalizedTarget = targetPath.replace(/\\/g, "/");
  const patch = [
    `--- a/${normalizedTarget}`,
    `+++ b/${normalizedTarget}`,
    "@@ -1 +1 @@",
    "-console.log(\"draft\");",
    "+console.log(6 * 7);"
  ].join("\n");

  const originalMindResponse = process.env.PYA_MIND_RESPONSE;
  process.env.PYA_MIND_RESPONSE = JSON.stringify([
    {
      message: {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            type: "function",
            function: {
              name: "be_command_ob_text_to_name_text",
              arguments: {
                ob: `printf 'console.log(\"draft\");\\n' > \"${normalizedTarget}\"`
              }
            }
          }
        ]
      }
    },
    {
      message: {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            type: "function",
            function: {
              name: "be_repair_ob_text_to_name_map",
              arguments: { ob: patch }
            }
          }
        ]
      }
    },
    { message: { role: "assistant", content: "done" } }
  ]);

  try {
    await interpret(parse('from filename "./module/saddle_tools.pya" ob name saddle tools to name saddle tools be import do'));
    await interpret(parse('exists su name coding saddle be mind as name "qwen3-vl:8b-instruct" ya'));
    await interpret(parse('ob text "write hello program" for name coding saddle to name text coding output with name saddle tools be write do'));

    const output = remember("coding output");
    assert.equal(output?.ob?.text, "done");

    const fileText = await fs.readFile(targetPath, "utf8");
    assert.equal(fileText.trim(), "console.log(6 * 7);");
  } finally {
    if (originalMindResponse === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = originalMindResponse;
  }
});
