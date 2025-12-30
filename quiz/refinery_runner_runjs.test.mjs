import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import vm from "node:vm";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";

function normalizeLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(line => line.length > 0);
}

function unwrapQuoted(text, lang) {
  return String(text || "")
    .replace(new RegExp(`^\\s*quoted\\.${lang}\\.\\s*`), "")
    .replace(new RegExp(`\\s*\\.${lang}\\.quoted\\s*$`), "");
}

test("compile js refinery runner executes platforms in deterministic order", async () => {
  const programPath = path.resolve("examples/pyash/refinery-pass.pya");
  const jsSentence = parse(`from filename "${programPath}" to state javascript to text output be compile do`);
  const jsResult = await interpret(jsSentence);
  const js = unwrapQuoted(jsResult?.ob?.text ?? jsResult?.value?.text ?? "", "javascript");
  const logs = [];
  vm.runInNewContext(js, {
    console: { log: (...args) => logs.push(args.join(" ")) },
    process: { env: { PYA_REFINERY: "line" } },
    TextEncoder: globalThis.TextEncoder
  });
  const lines = normalizeLines(logs.join("\n")).filter(line => line === "a" || line === "b");
  assert.deepEqual(lines, ["a", "b"]);
});
