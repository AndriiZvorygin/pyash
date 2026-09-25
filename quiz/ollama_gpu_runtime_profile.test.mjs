import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const profile = "ops/ollama/swac-rtx3060-cuda122";

test("swac CUDA runner cleanly replaces the incompatible base runtime", async () => {
  const dockerfile = await fs.readFile(`${profile}/Dockerfile`, "utf8");
  const deleteAt = dockerfile.indexOf("RUN rm -rf /usr/lib/ollama/cuda_v12");
  const copyAt = dockerfile.indexOf("COPY cuda_v12 /usr/lib/ollama/cuda_v12");

  assert.match(dockerfile, /FROM ollama\/ollama@sha256:[a-f0-9]{64}/u);
  assert.ok(deleteAt >= 0 && copyAt > deleteAt, "base CUDA folder must be removed before copying the compatible runner");
  assert.match(dockerfile, /ENV OLLAMA_LLM_LIBRARY=cuda_v12/u);
});

test("swac runner patch targets its installed compiler and GPU architecture", async () => {
  const patch = await fs.readFile(`${profile}/ollama-v0.34.1-cuda122-sm86.patch`, "utf8");
  const readme = await fs.readFile(`${profile}/README.md`, "utf8");

  assert.match(patch, /@@ -18 \+18 @@[^\n]*\n-RUN[^\n]*gcc-toolset-13-gcc[^\n]*\n\+RUN[^\n]*gcc-toolset-12-gcc/u);
  assert.match(patch, /@@ -71 \+71 @@\n-[^\n]*CMAKE_CUDA_ARCHITECTURES[^\n]*\n\+[^\n]*"86"/u);
  assert.match(readme, /git -C "\$ROOT\/src" apply --unidiff-zero/u);
  assert.match(readme, /driver 535\.247\.01/u);
  assert.match(readme, /100% GPU/u);
});
