import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { execFile } from "node:child_process";
import YAML from "yaml";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";
import { splitSentences } from "../program/library/sentenceSplitter.mjs";

function execFileAsync(file, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, opts, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

function normalizePyash(text) {
  return String(text)
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
}

function unwrapQuoted(text, lang) {
  let out = String(text ?? "");
  const startTag = `quoted.${lang}.`;
  const endTag = `.${lang}.quoted`;
  const startIdx = out.indexOf(startTag);
  if (startIdx >= 0) {
    out = out.slice(startIdx + startTag.length);
  }
  const endIdx = out.lastIndexOf(endTag);
  if (endIdx >= 0) {
    out = out.slice(0, endIdx);
  }
  return out.trim();
}

const expectedYaml = {
  age: 36,
  flags: [true, false],
  meta: { active: true },
  name: "Ada",
  pets: [{ kind: "cat" }, { kind: "dog" }]
};

const expectedPyash = [
  "su name profile meta be json map def",
  "su name active ob bool truth ya",
  "prah",
  "su name profile pets 1 be json map def",
  "su name kind ob text \"cat\" ya",
  "prah",
  "su name profile pets 2 be json map def",
  "su name kind ob text \"dog\" ya",
  "prah",
  "su name profile be json map def",
  "su name age ob num 36 ya",
  "su name flags ob ve bool truth lie ya",
  "su name meta ob name profile meta ya",
  "su name name ob text \"Ada\" ya",
  "su name pets ob ve name \"profile pets 1\" \"profile pets 2\" ya",
  "prah",
];

function parseYaml(text) {
  return YAML.parse(String(text ?? ""));
}

test("pyash->yaml->pyash roundtrip (interpret)", async () => {
  forget();
  const entryPath = path.resolve("examples/pyash/pyash-yaml-pyash-roundtrip.pya");
  const source = await fs.readFile(entryPath, "utf8");
  const lines = splitSentences(source);

  const logs = [];
  const originalLog = console.log;
  // eslint-disable-next-line no-console
  console.log = (...args) => logs.push(args.join(" "));
  try {
    for (const line of lines) {
      if (!line.trim()) continue;
      const sentence = parse(line);
      await interpret(sentence);
    }
  } finally {
    // eslint-disable-next-line no-console
    console.log = originalLog;
  }

  assert.equal(logs.length, 2);
  assert.deepEqual(parseYaml(logs[0]), expectedYaml);
  assert.deepEqual(normalizePyash(logs[1]), expectedPyash);
});

test("pyash->yaml->pyash roundtrip (compiled JS)", async () => {
  forget();
  const sentence = parse("from filename \"examples/pyash/pyash-yaml-pyash-roundtrip.pya\" from state pyash to state javascript to text output be compile do");
  const result = await interpret(sentence);
  const wrapped = result?.ob?.text ?? result?.value?.text ?? "";
  const js = unwrapQuoted(wrapped, "javascript");

  const logs = [];
  vm.runInNewContext(js, {
    console: { log: (...args) => logs.push(args.join(" ")) },
  });

  assert.equal(logs.length, 2);
  assert.deepEqual(parseYaml(logs[0]), expectedYaml);
  assert.deepEqual(normalizePyash(logs[1]), expectedPyash);
});

test("pyash->yaml->pyash roundtrip (compiled C)", async () => {
  forget();
  const sentence = parse("from filename \"examples/pyash/pyash-yaml-pyash-roundtrip.pya\" from state pyash to state c to text output be compile do");
  const result = await interpret(sentence);
  const wrapped = result?.ob?.text ?? result?.value?.text ?? "";
  const c = unwrapQuoted(wrapped, "c");

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-yaml-roundtrip-"));
  const cPath = path.join(tmp, "out.c");
  const exePath = path.join(tmp, "out");
  await fs.writeFile(cPath, c, "utf8");

  const gccArgs = ["-std=c11", "-O0", "-o", exePath, cPath, "-lm"];
  if (c.includes("PYA_YAML_RUNTIME")) gccArgs.push("-lyaml");
  await execFileAsync("gcc", gccArgs);
  const { stdout } = await execFileAsync(exePath, []);
  const marker = "\nsu name ";
  const altMarker = "\nexists su name ";
  const idx = stdout.indexOf(marker);
  const altIdx = stdout.indexOf(altMarker);
  const startIdx = idx >= 0 && altIdx >= 0 ? Math.min(idx, altIdx) : Math.max(idx, altIdx);
  const yamlText = startIdx >= 0 ? stdout.slice(0, startIdx) : stdout;
  const rest = startIdx >= 0 ? stdout.slice(startIdx + 1) : "";

  assert.deepEqual(parseYaml(yamlText), expectedYaml);
  assert.deepEqual(normalizePyash(rest), expectedPyash);
});
