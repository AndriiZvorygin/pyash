import assert from "node:assert/strict";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveGpuHousekeeperUrl } from "../program/runtime/gpu/managed-ollama.mjs";

const pipelinePaths = [
  new URL("../world/house/owen-sound-reporter/program/run-full-transcript-pipeline.mjs", import.meta.url),
  new URL("../world/house/grey-county-reporter/program/run-full-transcript-pipeline.mjs", import.meta.url),
  new URL("../world/house/andrii-youtube-reporter/program/run-andrii-youtube-meeting-from-ref.mjs", import.meta.url),
  new URL("../world/house/andrii-youtube-reporter/program/run-full-transcript-pipeline.mjs", import.meta.url),
  new URL("../world/house/andrii-youtube-reporter/program/run-full-transcript-pipeline-from-meeting-folder.mjs", import.meta.url),
];

test("reporter transcript pipelines use the shared configured GPU housekeeper endpoint", async () => {
  const configRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "pyash-gpu-housekeeper-config-"));
  const secretPath = path.join(configRoot, "configure", "secret.pya");
  await fsPromises.mkdir(path.dirname(secretPath), { recursive: true });
  await fsPromises.writeFile(secretPath, 'exists su name gpu housekeeper url ob text "http://configured-manager:18886" be default ya\n', "utf8");
  assert.equal(
    resolveGpuHousekeeperUrl({ ollamaUrl: "http://provider-without-manager:11434", env: {}, cwd: configRoot }),
    "http://configured-manager:18886",
  );

  for (const pipelineUrl of pipelinePaths) {
    const source = fs.readFileSync(pipelineUrl, "utf8");
    assert.match(source, /resolveGpuHousekeeperUrl/u);
    assert.doesNotMatch(source, /mriczo:8090/u);
  }
});
