import fs from "node:fs";
import path from "node:path";
import { replaceProgramletBranch } from "./programlet_branch_reduction.mjs";
import { replaceProgramletShape } from "./programlet_shape_reduction.mjs";
import { replaceCandidateBody, replaceRustFunctionBody } from "./rust_function_source.mjs";
import { digest } from "./function_reduction_reports.mjs";

function copyTree(source, destination) {
  fs.cpSync(source, destination, {
    recursive: true,
    force: true,
    filter: (entry) => !path.relative(source, entry).split(path.sep).some((part) => part === ".git" || part === "target"),
  });
}

export function prepareReductionWorkspace(options) {
  const { core, shader, diagnostics, candidates, branchNames, shapeOverrides, runDir, sourceHash, variant, branchVariant = variant, entrypointMode } = options;
  const workspace = path.join(diagnostics, "workspace");
  const coreCopy = path.join(workspace, "rust/pyac-vliw-core");
  const shaderCopy = path.join(workspace, "rust/pyac-gpu/shader");
  fs.mkdirSync(path.dirname(coreCopy), { recursive: true });
  fs.mkdirSync(path.dirname(shaderCopy), { recursive: true });
  fs.rmSync(path.join(coreCopy, "src"), { recursive: true, force: true });
  fs.rmSync(path.join(shaderCopy, "src"), { recursive: true, force: true });
  copyTree(core, coreCopy);
  copyTree(shader, shaderCopy);

  const changes = [];
  if (entrypointMode !== "all") {
    const shaderPath = path.join(shaderCopy, "src/lib.rs");
    let source = fs.readFileSync(shaderPath, "utf8");
    for (const name of ["pack", "programlet", "sections"].map((part) => `execute_pyac_${part}`).filter((name) => name !== `execute_pyac_${entrypointMode}`)) {
      const reduced = replaceRustFunctionBody(source, name, "return;");
      source = reduced.source;
      changes.push(`shader entrypoint ${name}: replaced ${Buffer.byteLength(reduced.originalBody)} body bytes with return`);
    }
    fs.writeFileSync(shaderPath, source);
  }

  const sourceByFile = new Map();
  for (const candidate of candidates) {
    const file = candidate.file;
    const target = path.join(coreCopy, "src/semantics_runtime", file);
    const original = sourceByFile.get(file) ?? fs.readFileSync(target, "utf8");
    const reduced = replaceCandidateBody(original, candidate.name, variant);
    sourceByFile.set(file, reduced.source);
    changes.push([
      `function: ${candidate.name}`,
      `source: rust/pyac-vliw-core/src/semantics_runtime/${file}`,
      `original sha256: ${digest(original)}`,
      `variant sha256: ${digest(reduced.source)}`,
      `replaced body bytes: ${Buffer.byteLength(reduced.originalBody)}`,
    ].join("\n"));
  }
  if (shapeOverrides.length) {
    const target = path.join(coreCopy, "src/semantics_runtime.rs");
    let source = fs.readFileSync(target, "utf8");
    for (const [shape, value] of shapeOverrides) {
      const reduced = replaceProgramletShape(source, shape, value);
      source = reduced.source;
      changes.push(`programlet shape: ${shape}; ${reduced.original} -> ${reduced.replacement}`);
    }
    fs.writeFileSync(target, source);
  }
  if (branchNames.length) {
    const file = "programlet_execute.rs";
    const target = path.join(coreCopy, "src/semantics_runtime", file);
    let source = sourceByFile.get(file) ?? fs.readFileSync(target, "utf8");
    for (const name of branchNames) {
      const reduced = replaceProgramletBranch(source, name, branchVariant);
      source = reduced.source;
      changes.push(`programlet branch: ${name}; mode ${branchVariant}; replaced body bytes: ${Buffer.byteLength(reduced.originalBody)}`);
    }
    sourceByFile.set(file, source);
  }
  for (const [file, source] of sourceByFile) fs.writeFileSync(path.join(coreCopy, "src/semantics_runtime", file), source);
  fs.writeFileSync(path.join(runDir, "mutation.diff"), [
    `functions: ${candidates.map(({ name }) => name).join(", ")}`,
    `programlet branches: ${branchNames.join(", ")}`,
    `programlet shapes: ${shapeOverrides.map(([name, value]) => `${name}=${value}`).join(", ")}`,
    `variant: ${variant}`,
    `isolated shader entrypoint: ${entrypointMode}`,
    `input shader/core tree sha256: ${sourceHash}`,
    ...changes,
    `replacement: ${variant}`,
    "",
  ].join("\n\n"));
  return { workspace, shaderCopy };
}
