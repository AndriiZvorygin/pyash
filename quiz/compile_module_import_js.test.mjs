import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import vm from "node:vm";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

function unwrapQuoted(text, lang) {
  return String(text || "")
    .replace(new RegExp(`^\\s*quoted\\.${lang}\\.\\s*`), "")
    .replace(new RegExp(`\\s*\\.${lang}\\.quoted\\s*$`), "");
}

test("compile module import to javascript and run", async () => {
  forget();

  const entryPath = path.resolve("quiz/fixtures/modules/entry.pya");
  const sentence = parse(`from filename "${entryPath}" to state javascript to text output be compile do`);

  const result = await interpret(sentence);
  const js = unwrapQuoted(result?.ob?.text ?? result?.value?.text ?? "", "javascript");

  const logs = [];
  vm.runInNewContext(js, {
    console: { log: (...args) => logs.push(args.join(" ")) }
  });

  assert.deepEqual(logs, ["1"]);
});
