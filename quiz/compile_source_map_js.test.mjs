import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

function unwrapQuoted(text, lang) {
  return String(text || "")
    .replace(new RegExp(`^\\s*quoted\\.${lang}\\.\\s*`), "")
    .replace(new RegExp(`\\s*\\.${lang}\\.quoted\\s*$`), "");
}

test("compile javascript emits inline source map", async () => {
  forget();
  const source = "exists su name alpha ob num 1 be number ya\nexists su name beta ob num 2 be number ya\n";
  const sentence = parse(`from text ${JSON.stringify(source)} to state javascript to text output be compile do`);
  const result = await interpret(sentence);
  const js = unwrapQuoted(result?.ob?.text ?? result?.value?.text ?? "", "javascript");
  const lines = js.trimEnd().split(/\n/);
  const mapLine = lines.at(-1) ?? "";
  const match = mapLine.match(/sourceMappingURL=data:application\/json;base64,([A-Za-z0-9+/=]+)$/);
  assert.ok(match, "expected inline source map");
  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  const map = JSON.parse(decoded);
  assert.equal(map.sources?.[0], "<pyash>");
  assert.equal(map.sourcesContent?.[0], source);
});
