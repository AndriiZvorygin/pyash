import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";
import { buildSaddleMindSentence, DEFAULT_CODING_SADDLE_SYSTEM_PROMPT } from "../program/agent/coding_saddle.mjs";
import { buildToolSchemas, buildToolSentence } from "../program/verbs/mind/tooling.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("default saddle tool map exposes only one Bash command tool", async () => {
  forget();
  const modulePath = path.join(root, "module", "saddle_bash_tools.pya");
  await interpret(parse(`from filename ${JSON.stringify(modulePath)} ob name saddle command tools to name saddle command tools be import do`));

  const result = buildToolSchemas("saddle command tools");
  assert.equal(result.tools.length, 1);
  assert.equal(result.tools[0].function.name, "bash");
  assert.deepEqual(result.tools[0].function.parameters, {
    type: "object",
    properties: { command: { type: "string", description: "One shell command to run." } },
    required: ["command"]
  });
  assert.match(result.tools[0].function.description, /Run one shell command/u);

  const call = buildToolSentence({
    capability: result.toolMap.get("bash"),
    toolName: "bash",
    args: { command: "printf 'saddle bash scenario\\n'" }
  });
  assert.equal(call.be, "command");
  assert.equal(call.ob.text, "printf 'saddle bash scenario\\n'");
  assert.deepEqual(call.to, { name: "out", nameTypeWords: ["text"] });

  const broadModulePath = path.join(root, "module", "saddle_tools.pya");
  await interpret(parse(`from filename ${JSON.stringify(broadModulePath)} ob name saddle tools to name saddle tools be import do`));
  const broadTools = buildToolSchemas("saddle tools").tools;
  assert.ok(broadTools.length > 1, "the broad map remains available to other callers");
  assert.ok(broadTools.some((tool) => tool.function.name === "be_command_ob_text_to_name_text"),
    "the broad map keeps its existing command tool name");
});

test("coding saddle defaults to Bash and its home guidance documents existing Pyash web search", async () => {
  assert.equal(buildSaddleMindSentence({ input: "inspect the project" }).with.name, "saddle command tools");
  assert.match(DEFAULT_CODING_SADDLE_SYSTEM_PROMPT, /use `bash\(command\)`/u);

  const toolGuide = await fs.readFile(path.join(root, "world", "house", "base", "identity", "TOOLS.md"), "utf8");
  assert.match(toolGuide, /Bash-only Saddle/u);
  assert.match(toolGuide, /ob text "quantum computing decision making"[\s\S]*fromstate wo web[\s\S]*be search do/u);
  assert.match(toolGuide, /pyash run/u);
});
