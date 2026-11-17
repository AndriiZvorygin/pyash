// test/pretty.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

import { npToPyash, sentenceToPyash } from "../program/beautiful.mjs";
import { parse } from "../program/understand/index.mjs";
import { pyaTextToJson } from "../program/library/pya_to_json.mjs";

test("npToPyash renders {name: X}", () => {
  assert.equal(npToPyash({ name: "collector" }), "name collector");
});

test("npToPyash renders {num: N}", () => {
  assert.equal(npToPyash({ num: 42 }), "num 42");
});

test("npToPyash gracefully handles empty NP", () => {
  assert.equal(npToPyash({}), "");
});

test("npToPyash renders escaped newlines as quoted text block", () => {
  assert.equal(
    npToPyash({ text: "alpha\\n\\nbeta" }),
    "text quoted.text.alpha\n\nbeta.text.quoted"
  );
});

test("sentenceToPyash prints su only", () => {
  const sentence = {
    mood: "ya",
    su: { name: "a" },
    be: "number"
  };

  const out = sentenceToPyash(sentence);

  assert.equal(out, "su name a be number ya");
});

test("sentenceToPyash prints su + ob", () => {
  const sentence = {
    mood: "ya",
    su: { name: "a" },
    ob: { num: 7 },
    be: "number"
  };

  const out = sentenceToPyash(sentence);

  assert.equal(out, "su name a ob num 7 be number ya");
});

test("sentenceToPyash prints all NP slots correctly", () => {
  const sentence = {
    mood: "do",
    su: { name: "x" },
    ob: { num: 2 },
    from: { num: 3 },
    to: { name: "y" },
    be: "plus"
  };

  const out = sentenceToPyash(sentence);

  assert.equal(
    out,
    "su name x ob num 2 from num 3 to name y be plus do"
  );
});

test("sentenceToPyash ignores empty fields cleanly", () => {
  const sentence = {
    mood: "que",
    su: { name: "x" },
    be: "number"
    // ob/from/to all missing
  };

  const out = sentenceToPyash(sentence);

  assert.equal(out, "su name x be number que");
});

test("sentenceToPyash round-trips bounded reads with one atmost byte", () => {
  const source = "from filename \"retrieved.html\" fromstate wo html become wo markdown atmost byte 65536 be read do";
  const rendered = sentenceToPyash(parse(source));

  assert.equal((rendered.match(/atmost byte/g) ?? []).length, 1);
  assert.equal(parse(rendered)?.atmost?.byte, 65536);
});

test("sentenceToPyash preserves typed as selectors for CLI round trips", () => {
  const source = "from filename \"world/library/archive/guide.zim\" as wo cluster-compress ob text \"guide.html\" by text \"buffer creation\" be read do";
  const parsed = parse(source);
  const rendered = sentenceToPyash(parsed);

  assert.match(rendered, /as wo cluster-compress/u);
  assert.deepEqual(parse(rendered)?.as, parsed.as);
});

test("sentenceToPyash quotes map names that contain grammar role words", async () => {
  const name = "coding saddle request 1 tools 1 function parameters properties ob";
  const source = [
    sentenceToPyash({ mood: "def", su: { name }, be: "json map" }),
    sentenceToPyash({ mood: "ya", su: { name: "type" }, ob: { text: "string" }, be: "text" }),
    sentenceToPyash({ mood: "prah", su: { name } })
  ].join("\n");

  const result = await pyaTextToJson(source);
  const map = result.memory.find((sentence) => sentence.su?.name === name);

  assert.ok(map, `expected map named ${name}`);
  assert.equal(map.be, "json map");
  assert.equal(map.ob.map.type.text, "string");
});

test("sentenceToPyash preserves multiline text containing its quote terminator", () => {
  const text = "first line\nquoted.text.inside.text.quoted\nlast line";
  const rendered = sentenceToPyash({
    mood: "ya",
    su: { name: "prompt" },
    ob: { text },
    be: "text"
  });

  assert.equal(parse(rendered)?.ob?.text, text);
});
