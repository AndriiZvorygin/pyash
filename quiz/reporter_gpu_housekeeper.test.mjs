import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { resolveGpuHousekeeperUrl } from "../program/runtime/gpu/managed-ollama.mjs";

const pipelinePaths = [
  new URL("../world/house/owen-sound-reporter/program/run-full-transcript-pipeline.mjs", import.meta.url),
  new URL("../world/house/grey-county-reporter/program/run-full-transcript-pipeline.mjs", import.meta.url),
  new URL("../world/house/andrii-youtube-reporter/program/run-andrii-youtube-meeting-from-ref.mjs", import.meta.url),
  new URL("../world/house/andrii-youtube-reporter/program/run-full-transcript-pipeline.mjs", import.meta.url),
  new URL("../world/house/andrii-youtube-reporter/program/run-full-transcript-pipeline-from-meeting-folder.mjs", import.meta.url),
];

test("reporter transcript pipelines use the shared current GPU housekeeper endpoint", () => {
  assert.equal(
    resolveGpuHousekeeperUrl({ ollamaUrl: "http://mriczo:11434", env: {} }),
    "http://mriczo:18886",
  );

  for (const pipelineUrl of pipelinePaths) {
    const source = fs.readFileSync(pipelineUrl, "utf8");
    assert.match(source, /resolveGpuHousekeeperUrl/u);
    assert.doesNotMatch(source, /mriczo:8090/u);
  }
});
