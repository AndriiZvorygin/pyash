import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checker = path.join(repoRoot, "command", "check_doc_prose.mjs");

function runCheck(target) {
  const args = target ? [checker, target] : [checker];
  try {
    const output = execFileSync(process.execPath, args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    return { code: 0, output };
  } catch (error) {
    return { code: error.status ?? 1, output: `${error.stdout || ""}${error.stderr || ""}` };
  }
}

function withTempDoc(content, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pyash-prose-"));
  const file = path.join(dir, "sample.md");
  fs.writeFileSync(file, content, "utf8");
  try {
    return run(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("the prose guard catches a keyword used as a prose word", () => {
  withTempDoc(
    "The sentences remain as history toindex garbage collection chooses to purge them.\n",
    (file) => {
      const result = runCheck(file);
      assert.equal(result.code, 1);
      assert.match(result.output, /keyword-as-prose/u);
    }
  );
});

test("the prose guard catches a duplicated alias token", () => {
  withTempDoc("The subject (`su` / `su`) is the subject.\n", (file) => {
    const result = runCheck(file);
    assert.equal(result.code, 1);
    assert.match(result.output, /duplicated-alias/u);
  });
});

test("the prose guard leaves clean prose alone", () => {
  withTempDoc("The subject (`su` / `subj`) is the subject.\n", (file) => {
    const result = runCheck(file);
    assert.equal(result.code, 0);
    assert.match(result.output, /pass/u);
  });
});

test("a line that quotes a corrupted passage on purpose is exempt", () => {
  withTempDoc(
    'A quoted example: "remain as history toindex garbage collection chooses to purge them". <!-- prose-check: ignore -->\n',
    (file) => {
      const result = runCheck(file);
      assert.equal(result.code, 0);
      assert.match(result.output, /exempt line/u);
    }
  );
});

test("the repository documentation passes the prose guard", () => {
  const result = runCheck(null);
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /doc prose check: pass/u);
});
