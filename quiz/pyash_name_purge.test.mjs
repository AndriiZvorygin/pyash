import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { scanPyashToken } from "../command/scan_pyashtoken.mjs";

// The fixtures below deliberately contain the word under test in a Pyash name
// position, so the parts are assembled at runtime: the file must not itself
// contain the word in a name position, or the repo-wide scan would flag the
// guard that proves the scan works.
const WORD = ["ki", "nd"].join("");
const pair = (suffix) => `su name ${WORD} ${suffix}`;

function scratchFile(name, body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pyash-name-purge-"));
  const file = path.join(dir, name);
  fs.writeFileSync(file, body, "utf8");
  return file;
}

function scanFile(file, word = WORD) {
  const hits = scanPyashToken(word, { files: [file] });
  return hits.map((hit) => hit.found.join(" | "));
}

test("the legacy alias is not used as a Pyash name anywhere in tracked sources", () => {
  const hits = scanPyashToken(WORD);
  assert.deepEqual(
    hits.map((hit) => `${hit.file}:${hit.line} ${hit.found.join(" | ")}`),
    []
  );
});

test("the scanner sees a name-role token", () => {
  const file = scratchFile("subject.pya", `exists ${pair(`ob text "pair" ya`)}\n`);
  assert.deepEqual(scanFile(file), ["su name"]);
});

test("the scanner sees a map row key", () => {
  const file = scratchFile("row.pya", `su text "${WORD}" ob text "cat" ya\n`);
  assert.deepEqual(scanFile(file), ["su text key"]);
});

test("the scanner sees a key inside a quoted json block", () => {
  const file = scratchFile(
    "data.pya",
    `ob text quoted.json.\n{"pets":[{"${WORD}":"cat"}]}\n.json.quoted from state json to name profile be read do\n`
  );
  assert.deepEqual(scanFile(file), ["json key"]);
});

test("the scanner sees a key inside a quoted yaml block", () => {
  const file = scratchFile(
    "data.pya",
    `ob text quoted.yaml.\npets:\n  - ${WORD}: cat\n.yaml.quoted from state yaml to name profile be read do\n`
  );
  assert.deepEqual(scanFile(file), ["yaml key"]);
});

test("the scanner sees a name inside a quoted pyash block", () => {
  const file = scratchFile("source.pya", `ob text quoted.pyash.\nexists ${pair(`ob text "cat" ya`)}\n.pyash.quoted be text ya\n`);
  assert.deepEqual(scanFile(file), ["su name"]);
});

test("the scanner sees a map row key written from javascript", () => {
  const file = scratchFile("writer.mjs", `const row = { key: "${WORD}", type: "text", value: "cat" };\n`);
  assert.deepEqual(scanFile(file), ["map row key"]);
});

test("the scanner sees a name fragment emitted from javascript", () => {
  const file = scratchFile("emitter.mjs", `const line = \`  ${pair(`ob text "cat" ya`)}\`;\n`);
  assert.deepEqual(scanFile(file), ["name fragment"]);
});

test("the scanner sees a pyash sentence name built in javascript", () => {
  const file = scratchFile("sentence.mjs", `{ su: { name: "artifact ${WORD}" }, ob: { text: entry.value }, mood: "ya" },\n`);
  assert.deepEqual(scanFile(file), ["sentence name"]);
});

test("english prose that merely mentions the word is not a name", () => {
  const file = scratchFile(
    "prose.pya",
    `exists su name learning prompt ob text quoted.text.What ${WORD} of truth does it state?.text.quoted be text ya\n`
  );
  assert.deepEqual(scanFile(file), []);
});

test("a word that is not used as a name stays clean", () => {
  const file = scratchFile("subject.pya", 'exists su name sort ob text "pair" ya\n');
  assert.deepEqual(scanFile(file), []);
});
