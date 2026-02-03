import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { runScriptWithInput } from "./helpers/run_script.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, "..");

test("declined ratify records decision and exits refinery without aborting program", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-ratify-"));
  const programPath = path.join(tempDir, "ratify-decline.pya");
  const program = [
    "su name flow be refinery def",
    "su name gate ob text \"Approve?\" be command propose",
    "prah",
    "from name flow be refinery do",
    "su name result ob num 9 be number ya"
  ].join("\n");
  await fs.writeFile(programPath, `${program}\n`, "utf8");

  const { logs, errors } = await runScriptWithInput(
    "program/command/run_pya_program.mjs",
    ["--gross", programPath],
    "n\n"
  );

  assert.equal(errors.join("\n"), "");
  const payload = JSON.parse(logs.join(""));
  assert.equal(payload.result?.be, "number");
  assert.equal(payload.result?.ob?.num, 9);
});
