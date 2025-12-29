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

test("compile full module import to javascript and run", async () => {
  forget();

  const entryPath = path.resolve("examples/pyash/module-import-full.pya");
  const sentence = parse(`from filename "${entryPath}" to state javascript to text output be compile do`);

  const result = await interpret(sentence);
  const js = unwrapQuoted(result?.ob?.text ?? result?.value?.text ?? "", "javascript");

  const logs = [];
  vm.runInNewContext(js, {
    console: { log: (...args) => logs.push(args.join(" ")) }
  });

  const mapText = [
    "su name settings be map def",
    "su name limit ob num 3 ya",
    "su name mode ob text \"ready\" ya",
    "prah"
  ].join("\n");

  assert.deepEqual(logs, [mapText, "2", "5", "7"]);
});
