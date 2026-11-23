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
  assert.match(deploy, /if \(\( exit_code != 0 \)\); then/u);
  assert.match(deploy, /if \[\[ -n "\$rollback_tag" \]\] && \(\( cache_backup == 1 \)\); then/u);
  assert.match(deploy, /No verified prior runtime image and pipeline artifact are available/u);
  assert.equal(deploy.includes("deployment_started"), false);
});

test("runtime consumes a required saved pipeline artifact through WGPU", () => {
  const gpu = read("rust/pyac-gpu/worker/src/gpu.rs");
  const pipeline = read("rust/pyac-gpu/worker/src/gpu/pipeline.rs");
  const runtime = read("rust/pyac-gpu/worker/src/gpu/runtime.rs");
  const runtimeBin = read("rust/pyac-gpu/worker/src/bin/vliw_runtime.rs");

  assert.match(runtimeBin, /PYAC_VLIW_PIPELINE_CACHE_PATH/u);
  assert.match(gpu, /mod runtime;/u);
  assert.match(pipeline, /read_pipeline_cache\(path: &Path\)/u);
  assert.match(pipeline, /cache: Some\(cache\)/u);
  assert.match(runtime, /read_pipeline_cache\(cache_path\)/u);
  assert.match(runtime, /fallback: false/u);
  assert.match(runtime, /pipeline_cache\s*\.get_data\(\)/u);
  assert.doesNotMatch(runtime, /cache: None/u);
});

test("serial programlet interpreter declares and binds a single-lane workgroup", () => {
  const shader = read("rust/pyac-gpu/shader/src/lib.rs");
  const runtime = read("rust/pyac-gpu/worker/src/gpu/runtime.rs");

  assert.match(shader, /#\[spirv\(compute\(threads\(1\)\)\)\]\s+pub fn execute_pyac_programlet/u);
  assert.match(runtime, /name: Cow::Borrowed\("execute_pyac_programlet"\),\s+workgroup_size: \(1, 1, 1\)/u);
});

test("compose mounts the artifact read-only in service and writable for its compiler", () => {
  const compose = parse(read("container/pyac-vliw-runtime/compose.yaml"));
  const runtime = compose.services["pyac-vliw-runtime"];
  const compiler = compose.services["pyac-vliw-pipeline-compiler"];

  for (const service of [runtime, compiler]) {
    assert.equal(service.runtime, "nvidia");
    assert.deepEqual(service.deploy.resources.reservations.devices[0].capabilities, ["gpu"]);
  }
  assert.equal(runtime.volumes.some((volume) => volume.target === "/service/artifacts" && volume.read_only), true);
  assert.equal(compiler.entrypoint[0], "/service/pyac-vliw-pipeline-compiler");
  assert.equal(compiler.volumes.some((volume) => volume.target === "/service/artifacts" && !volume.read_only), true);
});

test("runtime uses the Vulkan loader version verified on Mriczo", () => {
  const dockerfile = read("container/pyac-vliw-runtime/Dockerfile");

  assert.match(dockerfile, /FROM ubuntu:24\.04/u);
  assert.match(dockerfile, /libvulkan1/u);
});

test("function-reduction profiling allows a full bounded pipeline build", () => {
  const reducer = read("rust/pyac-gpu/profile-function-reduction.mjs");
  const runtimeGuide = read("rust/pyac-gpu/README.md");

  assert.match(reducer, /BUILD_TIMEOUT_SEC = Number\(process\.env\.PYAC_VLIW_REDUCE_BUILD_TIMEOUT_SEC \|\| 300\)/u);
  assert.match(reducer, /args\.includes\("--build-only"\)/u);
  assert.match(reducer, /PIPELINE_TIMEOUT_SEC = Number\(process\.env\.PYAC_VLIW_REDUCE_PIPELINE_TIMEOUT_SEC \|\| 600\)/u);
  assert.match(reducer, /PIPELINE_TIMEOUT_SEC > 600/u);
  assert.match(read("rust/pyac-gpu/profile-pipeline-build.mjs"), /const MAX_TIMEOUT_SEC = 600/u);
  assert.match(runtimeGuide, /capped at 16 GiB RSS and ten minutes/u);
  assert.match(runtimeGuide, /`--build-only` stops after SPIR-V generation/u);
  assert.match(runtimeGuide, /current full shader pipeline build/u);
  assert.match(runtimeGuide, /60-second readiness ceiling/u);
});

test("function-reduction can isolate shader entrypoints and stub multiple core candidates", () => {
  const reducer = read("rust/pyac-gpu/profile-function-reduction.mjs");
  const workspace = read("rust/pyac-gpu/function_reduction_workspace.mjs");

  assert.match(reducer, /\["pack", "programlet", "sections"\]/u);
  assert.match(reducer, /args\.includes\(`--\$\{name\}-only`\)/u);
  assert.match(reducer, /args\.indexOf\("--functions"\)/u);
  assert.match(workspace, /\["pack", "programlet", "sections"\]\.map\(\(part\) => `execute_pyac_\$\{part\}`\)/u);
  assert.match(workspace, /name !== `execute_pyac_\$\{entrypointMode\}`/u);
  assert.match(workspace, /replaceRustFunctionBody\(source, name, "return;"\)/u);
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
