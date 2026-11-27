import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";
import {
  buildSaddleMindSentence,
  DEFAULT_CODING_SADDLE_SYSTEM_PROMPT,
  saddleToolEventLabel,
  saddleToolEventPreview
} from "../program/agent/coding_saddle.mjs";
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

test("Bash tool-call labels show a bounded one-line command snippet", () => {
  assert.equal(saddleToolEventLabel({
    stage: "call",
    toolName: "bash",
    toolSentence: { ob: { text: "mkdir -p ./magazine\nprintf ready" } }
  }), "[tool call] bash: mkdir -p ./magazine printf ready");

  const longCommand = "x".repeat(500);
  const label = saddleToolEventLabel({
    stage: "call",
    toolName: "bash",
    toolSentence: { ob: { text: longCommand } }
  });
  assert.ok(label.length < 240);
  assert.match(label, /characters omitted/u);
});

test("Bash approval results render as readable structured JSON without the resume token", () => {
  const token = {
    kind: "command",
    class: "destructive",
    text: "rm -rf magaiize",
    requestIdentity: "command request 000008",
    sentence: { mood: "do", be: "command", ob: { text: "rm -rf magaiize" } }
  };
  const preview = saddleToolEventPreview({
    stage: "result",
    toolName: "bash",
    toolSentence: { ob: { text: "rm -rf magaiize" } },
    resultSentence: {
      mood: "do",
      be: "ratify",
      su: { name: "command approval" },
      ob: { text: "approve command (destructive): rm -rf magaiize" },
      to: { name: "command request 000008" },
      fromtext: { text: JSON.stringify(token) }
    },
    toolText: 'su name command approval ob text "approve command ..."'
  });

  assert.match(preview, /"status": "approval_required"/u);
  assert.match(preview, /"request": "command request 000008"/u);
  assert.match(preview, /"command_class": "destructive"/u);
  assert.match(preview, /"command": "rm -rf magaiize"/u);
  assert.doesNotMatch(preview, /\\\\|resume token|issuedAt/u);
});

test("Bash result previews preserve exit status and stderr while keeping sandbox blocks distinct", () => {
  const success = saddleToolEventPreview({
    stage: "result",
    toolName: "bash",
    toolSentence: { ob: { text: "node success.mjs" } },
    resultSentence: {
      be: "command",
      ob: { text: "stdout marker", raw: { status: 0, cwd: "/work/project", stdout: "stdout marker", stderr: "warning marker" } }
    }
  });
  assert.match(success, /exit code: 0/u);
  assert.match(success, /stdout: stdout marker/u);
  assert.match(success, /stderr: warning marker/u);

  const processFailure = saddleToolEventPreview({
    stage: "result",
    toolName: "bash",
    toolSentence: { ob: { text: "node fail.mjs" } },
    resultSentence: {
      be: "error",
      su: { name: "command defective" },
      ob: {
        text: "command defective: status=7 signal=none",
        raw: {
          status: 7,
          cwd: "/work/project",
          stdout: "stdout marker",
          stderr: "stderr marker"
        }
      }
    }
  });
  assert.match(processFailure, /exit code: 7/u);
  assert.match(processFailure, /stderr: stderr marker/u);

  const sandboxBlock = saddleToolEventPreview({
    stage: "result",
    toolName: "bash",
    toolSentence: { ob: { text: "mkdir -p /outside" } },
    resultSentence: {
      be: "error",
      su: { name: "command sandbox defective" },
      ob: {
        text: "command sandbox defective: command path outside writable roots",
        raw: { processStarted: false, outsideRoots: ["/outside"], writableRoots: ["/work/project"] }
      }
    }
  });
  assert.match(sandboxBlock, /blocked before process launch/u);
  assert.match(sandboxBlock, /stderr: unavailable because the command was blocked/u);
});
