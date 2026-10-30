import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { scanPyashToken } from "../command/scan_pyashtoken.mjs";

function scratchFile(name, body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pyash-name-purge-"));
  const file = path.join(dir, name);
  fs.writeFileSync(file, body, "utf8");
  return file;
}

function scanFile(file, word = "kind") {
  const hits = scanPyashToken(word, { files: [file] });
  return hits.map((hit) => hit.found.join(" | "));
}

test("kind is not used as a Pyash name anywhere in tracked sources", () => {
  const hits = scanPyashToken("kind");
  assert.deepEqual(
    hits.map((hit) => `${hit.file}:${hit.line} ${hit.found.join(" | ")}`),
    []
  );
});

test("the scanner sees a name-role token", () => {
  const file = scratchFile("subject.pya", 'exists su name kind ob text "pair" ya\n');
  assert.deepEqual(scanFile(file), ["su name"]);
});

test("the scanner sees a map row key", () => {
  const file = scratchFile("row.pya", 'su text "kind" ob text "cat" ya\n');
  assert.deepEqual(scanFile(file), ["su text key"]);
});

test("the scanner sees a key inside a quoted json block", () => {
  const file = scratchFile("data.pya", 'ob text quoted.json.\n{"pets":[{"kind":"cat"}]}\n.json.quoted from state json to name profile be read do\n');
  assert.deepEqual(scanFile(file), ["json key"]);
});

test("the scanner sees a key inside a quoted yaml block", () => {
  const file = scratchFile("data.pya", "ob text quoted.yaml.\npets:\n  - kind: cat\n.yaml.quoted from state yaml to name profile be read do\n");
  assert.deepEqual(scanFile(file), ["yaml key"]);
});

test("the scanner sees a name inside a quoted pyash block", () => {
  const file = scratchFile("source.pya", 'ob text quoted.pyash.\nexists su name kind ob text "cat" ya\n.pyash.quoted be text ya\n');
  assert.deepEqual(scanFile(file), ["su name"]);
});

test("the scanner sees a map row key written from javascript", () => {
  const file = scratchFile("writer.mjs", 'const row = { key: "kind", type: "text", value: "cat" };\n');
  assert.deepEqual(scanFile(file), ["map row key"]);
});

test("the scanner sees a name fragment emitted from javascript", () => {
  const file = scratchFile("emitter.mjs", 'const line = `  su name kind ob text "cat" ya`;\n');
  assert.deepEqual(scanFile(file), ["name fragment"]);
});

test("the scanner sees a pyash sentence name built in javascript", () => {
  const file = scratchFile("sentence.mjs", '{ su: { name: "artifact kind" }, ob: { text: entry.kind }, mood: "ya" },\n');
  assert.deepEqual(scanFile(file), ["sentence name"]);
});

test("english prose that merely mentions kind is not a name", () => {
  const file = scratchFile("prose.pya", 'exists su name learning prompt ob text quoted.text.What kind of truth does it state?.text.quoted be text ya\n');
  assert.deepEqual(scanFile(file), []);
});

test("a word that is not used as a name stays clean", () => {
  const file = scratchFile("subject.pya", 'exists su name sort ob text "pair" ya\n');
  assert.deepEqual(scanFile(file, "kind"), []);
});
