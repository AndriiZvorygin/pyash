import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import verify from "../program/verbs/verify.mjs";

test("verify verb supports inline pyash text", async () => {
  const result = await verify({
    be: "verify",
    mood: "do",
    as: { wo: "pyash" },
    ob: { text: "exists su name alpha ob num 1 be number ya" }
  });

  assert.equal(result?.be, "series");
  assert.equal(result?.mood, "ya");
  assert.equal(result?.exactly?.num, 0);
  assert.equal(result?.vyah?.ve?.values?.[0], "success");
  assert.equal(result?.atmost?.num, 1);
  assert.deepEqual(result?.ob?.series, []);
});

test("verify verb supports filename source", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-verify-verb-"));
  const filePath = path.join(tmpDir, "bad.pya");
  await fs.writeFile(filePath, "su name alpha ob num 1 be number nope\n", "utf8");

  const result = await verify({
    be: "verify",
    mood: "do",
    as: { wo: "pyash" },
    from: { filename: filePath }
  });

  assert.equal(result?.be, "series");
  assert.equal(result?.mood, "ya");
  assert.equal(result?.vyah?.ve?.values?.[0], "fail");
  assert.equal(result?.from?.filename, filePath);
  assert.ok(result?.exactly?.num > 0);
  assert.ok(Array.isArray(result?.ob?.series));
  const first = result.ob.series[0];
  assert.equal(first?.be, "error");
  assert.equal(first?.mood, "ya");
  assert.equal(first?.from?.name, "verify");
  assert.equal(typeof first?.by?.num, "number");
});
