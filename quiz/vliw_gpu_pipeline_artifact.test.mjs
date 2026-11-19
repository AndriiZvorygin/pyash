import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("VLIW deploy compiles and persists the GPU artifact before replacement", () => {
  const deploy = read("container/pyac-vliw-runtime/command/deploy.sh");
  const compileIndex = deploy.indexOf("pyac-vliw-pipeline-compiler");
  const replaceIndex = deploy.indexOf(
    "compose up -d --no-deps --force-recreate --no-build pyac-vliw-runtime",
    compileIndex,
  );

  assert.equal(deploy.includes("READY_TIMEOUT_SEC=60"), true);
  assert.equal(deploy.includes("PYAC_VLIW_DEPLOY_READY_TIMEOUT_SEC"), false);
  assert.ok(compileIndex >= 0 && compileIndex < replaceIndex);
  assert.match(deploy, /if \[\[ ! -s "\$ARTIFACT_DIR\/pyac_vliw_pipeline_cache\.bin" \]\]/u);
  assert.match(deploy, /rollback-pipeline-cache\.bin/u);
});

test("runtime consumes a required saved pipeline artifact through WGPU", () => {
  const gpu = read("rust/pyac-gpu/worker/src/gpu.rs");
  const runtime = read("rust/pyac-gpu/worker/src/bin/vliw_runtime.rs");

  assert.match(runtime, /PYAC_VLIW_PIPELINE_CACHE_PATH/u);
  assert.match(gpu, /read_pipeline_cache\(cache_path\)/u);
  assert.match(gpu, /fallback: false/u);
  assert.match(gpu, /cache: Some\(cache\)/u);
  assert.match(gpu, /pipeline_cache\s*\.get_data\(\)/u);
  assert.doesNotMatch(gpu, /cache: None/u);
});

test("compose mounts the artifact read-only in service and writable for its compiler", () => {
  const compose = parse(read("container/pyac-vliw-runtime/compose.yaml"));
  const runtime = compose.services["pyac-vliw-runtime"];
  const compiler = compose.services["pyac-vliw-pipeline-compiler"];

  assert.equal(runtime.volumes.some((volume) => volume.target === "/service/artifacts" && volume.read_only), true);
  assert.equal(compiler.entrypoint[0], "/service/pyac-vliw-pipeline-compiler");
  assert.equal(compiler.volumes.some((volume) => volume.target === "/service/artifacts" && !volume.read_only), true);
});

test("repository rules forbid production startup compilation and CPU fallback", () => {
  const agents = read("AGENTS.md");
  const runtimeGuide = read("container/pyac-vliw-runtime/README.md");

  assert.match(agents, /production service must load compiled artifacts from disk/u);
  assert.match(agents, /hard 60-second ceiling/u);
  assert.match(runtimeGuide, /November 18, 2026 startup incident/u);
  assert.match(runtimeGuide, /not the final GPU artifact/u);
  assert.doesNotMatch(runtimeGuide, /30 minutes by default/u);
});
