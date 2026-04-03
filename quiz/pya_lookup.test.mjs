import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { readPyaTextValues } from "../command/pya_lookup.mjs";

test("readPyaTextValues returns configured text values by su name", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pya-lookup-"));
  const p = path.join(dir, "secret.pya");
  fs.writeFileSync(p, [
    "# comment line",
    "exists su name ollama host ob text \"http://mriczo:11434\" be default ya",
    "exists su name speaker host ob text \"http://mriczo:8010\" be default ya",
    "exists su name draw host ob text \"http://mriczo:8188\" be default ya",
    "",
  ].join("\n"), "utf8");

  const out = readPyaTextValues(p, ["ollama host", "speaker host", "draw host", "missing key"]);
  assert.equal(out["ollama host"], "http://mriczo:11434");
  assert.equal(out["speaker host"], "http://mriczo:8010");
  assert.equal(out["draw host"], "http://mriczo:8188");
  assert.equal(out["missing key"], "");
});

