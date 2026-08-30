import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { buildProgram } from "../program/program.mjs";
import { forget } from "../program/remember/index.mjs";
import { transpileProgram } from "../program/verbs/exchange/compile/transpile_program.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(".");
const examplePath = path.join(repoRoot, "examples/pyash/claim-core-golden.pya");
const fixturePath = path.join(repoRoot, "quiz/fixtures/claim-core-golden.txt");

async function runRunner(runner) {
  const result = await execFileAsync(path.join(repoRoot, runner), [examplePath], {
    cwd: repoRoot,
    encoding: "buffer",
    timeout: 120000
  });
  return Buffer.from(result.stdout ?? []);
}

test("public claim golden is byte-identical across run, runjs, and runc", async () => {
  const expected = await fs.readFile(fixturePath);
  const outputs = [];
  for (const runner of ["run", "runjs", "runc"]) outputs.push(await runRunner(runner));
  for (const output of outputs) assert.deepEqual(output, expected);
});

test("public claim calls reject malformed intended evidence and identity", async () => {
  const malformedEvidenceCases = [
    {
      name: "missing source anchor",
      line: "exists su name weather ob text clear as name public since date 2026-01-01 until date 2026-01-31 accordingto name direct-evidential by num 0.5 be text ya",
      error: /source anchor defective/u
    },
    {
      name: "missing confidence",
      line: "exists su name weather ob text clear as name public since date 2026-01-01 until date 2026-01-31 fromtext la su name report ob text paragraph-1 be text ya ko accordingto name direct-evidential be text ya",
      error: /confidence defective/u
    },
    {
      name: "unsupported evidential",
      line: "exists su name weather ob text clear as name public since date 2026-01-01 until date 2026-01-31 fromtext la su name report ob text paragraph-1 be text ya ko accordingto name unsupported-evidential by num 0.5 be text ya",
      error: /evidential defective/u
    },
    {
      name: "unstable source anchor",
      line: "exists su name weather ob text clear as name public since date 2026-01-01 until date 2026-01-31 fromtext la su name report ob text \"bad anchor!\" be text ya ko accordingto name direct-evidential by num 0.5 be text ya",
      error: /source anchor defective/u
    },
    {
      name: "out-of-range confidence",
      line: "exists su name weather ob text clear as name public since date 2026-01-01 until date 2026-01-31 fromtext la su name report ob text paragraph-1 be text ya ko accordingto name direct-evidential by num 1.1 be text ya",
      error: /confidence defective/u
    }
  ];

  for (const malformed of malformedEvidenceCases) {
    const sentence = parse(malformed.line);
    forget();
    await assert.rejects(() => interpret(sentence), malformed.error, malformed.name);
    for (const lang of ["javascript", "c"]) {
      assert.throws(
        () => transpileProgram(buildProgram(malformed.line).sentences, { lang }),
        malformed.error,
        `${malformed.name} (${lang})`
      );
    }
  }

  const malformedIdentityLine =
    "su name claim ob la su name weather since date 2026-01-01 be text ya ko be claim identify do";
  await assert.rejects(() => interpret(parse(malformedIdentityLine)), /time window defective/u);
  for (const lang of ["javascript", "c"]) {
    assert.throws(
      () => transpileProgram(buildProgram(malformedIdentityLine).sentences, { lang }),
      /time window defective/u,
      `partial identity window (${lang})`
    );
  }
});

test("compiled C reports knowledge record overflow instead of dropping evidence", async () => {
  const source = Array.from({ length: 257 }, (_, index) => [
    index === 0 ? "exists" : "",
    "su name weather ob text clear as name public since date 2026-01-01 until date 2026-01-31",
    `fromtext la su name source-${index} ob text paragraph-1 be text ya ko`,
    "accordingto name direct-evidential by num 0.5 be text ya"
  ].filter(Boolean).join(" ")).join("\n");
  const c = transpileProgram(buildProgram(source).sentences, { lang: "c" });
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "claim-core-overflow-"));
  const cPath = path.join(tempDir, "overflow.c");
  const executablePath = path.join(tempDir, "overflow");
  await fs.writeFile(cPath, c, "utf8");
  await execFileAsync("gcc", ["-std=c11", "-O0", "-o", executablePath, cPath], { timeout: 120000 });
  const failure = await execFileAsync(executablePath, [], { timeout: 120000 }).then(
    () => null,
    error => error
  );
  assert.ok(failure, "overflow must fail deterministically");
  assert.match(String(failure.stderr ?? ""), /knowledge core defective: record count exceeds supported capacity/u);
});
