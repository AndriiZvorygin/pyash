import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("transcript normalization falls back to source chunks when LLM fetch fails", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "normalize-fallback-"));
  const transcriptDir = path.join(dir, "transcript");
  fs.mkdirSync(transcriptDir, { recursive: true });
  fs.writeFileSync(
    path.join(transcriptDir, "meeting-qwen-auto.plain.txt"),
    "Mayor Body called the City of Oceansound meeting to order.\n",
    "utf8",
  );

  execFileSync("node", [
    path.join(ROOT, "command/normalize_transcript_from_transcript_folder_shared.mjs"),
    "owen",
    transcriptDir,
    "meeting-qwen-auto",
  ], {
    cwd: ROOT,
    env: {
      ...process.env,
      OLLAMA_HOST: "http://127.0.0.1:9",
      PYA_NORMALIZE_FETCH_ATTEMPTS: "1",
      PYA_NORMALIZE_FETCH_TIMEOUT_MS: "6000",
      PYA_NORMALIZE_REQUIRE_LLM: "0",
    },
    stdio: "pipe",
  });

  const output = fs.readFileSync(path.join(transcriptDir, "meeting-qwen-auto-normalized.plain.txt"), "utf8");
  const meta = JSON.parse(fs.readFileSync(path.join(transcriptDir, "meeting-qwen-auto-normalized.normalize.metadata.json"), "utf8"));

  assert.match(output, /Mayor Boddy called the City of Owen Sound meeting to order\./u);
  assert.equal(meta.fallback_chunk_count, 1);
  assert.equal(meta.fallback_chunks[0].index, 1);
});
