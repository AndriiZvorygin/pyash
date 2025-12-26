import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

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

test("compile write json map to filename (js) writes file", async () => {
  forget();

  const pyash = [
    "su name profile be json map def",
    "su name name ob text \"Ada\" ya",
    "su name profile be json map prah",
    "ob name profile to state beautiful json to filename out.json be write do"
  ].join("\n");

  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state javascript to text output be compile do`);
  const result = await interpret(sentence);
  const wrapped = result?.ob?.text ?? result?.value?.text ?? "";
  const js = wrapped.replace(/^\s*quoted\.javascript\.\s*/, "").replace(/\s*\.javascript\.quoted\s*$/, "");

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-write-json-js-"));
  const jsPath = path.join(tmp, "out.js");
  const outPath = path.join(tmp, "out.json");
  await fs.writeFile(jsPath, js, "utf8");
  await fs.writeFile(path.join(tmp, "package.json"), JSON.stringify({ type: "module" }), "utf8");

  await execFileAsync("node", [jsPath], { cwd: tmp });
  const saved = await fs.readFile(outPath, "utf8");

  assert.equal(saved.trim(), '{\n  "name": "Ada"\n}');
});
