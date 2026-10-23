import fs from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { loadCoverage } from "./compound_coverage.mjs";
import { loadDefaultConfig } from "./run_pya_helpers.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { doRemember, forget, remember } from "../program/remember/index.mjs";
import { resolveConfigText } from "../program/configure/env.mjs";
import {
  renderDerivedCompoundCoveragePya,
  renderDerivedCompoundCoverageRowPya
} from "../program/verbs/exchange/translation/compound_coverage.mjs";
import {
  createDefaultQueuedMindCompoundVerifier,
  verifyCompoundCoverage
} from "../program/verbs/exchange/translation/compound_verification.mjs";

function configureVerifierMind(mindName) {
  const backend = String(resolveConfigText("mind backend", { rememberFn: remember }) || "ollama command mind").trim();
  const model = String(resolveConfigText("mind model", { rememberFn: remember }) || "").trim();
  const host = String(
    (/ollama/iu.test(backend)
      ? resolveConfigText("ollama host", { rememberFn: remember })
      : resolveConfigText("ai host", { rememberFn: remember }) || resolveConfigText("ollama host", { rememberFn: remember })) || ""
  ).trim();
  const housekeeper = String(resolveConfigText("gpu housekeeper url", { rememberFn: remember }) || "").trim();
  if (!model || !host) throw new Error("compound verifier requires configured mind model and host");
  if (housekeeper && !String(process.env.PYA_GPU_HOUSEKEEPER_URL || "").trim()) {
    process.env.PYA_GPU_HOUSEKEEPER_URL = housekeeper;
  }
  if (housekeeper && process.env.PYA_GPU_MANAGER_REQUIRED === undefined) {
    process.env.PYA_GPU_MANAGER_REQUIRED = "true";
  }
  doRemember({
    mood: "ya",
    su: { name: mindName },
    be: "mind",
    as: { name: model },
    fromstate: { text: backend },
    from: { text: host }
  });
  return { backend, model, host, housekeeper };
}

async function createCheckpointWriter(outputPath) {
  const filename = resolve(outputPath);
  await fs.mkdir(dirname(filename), { recursive: true });
  await fs.writeFile(filename, "su name translation_compounds_verified be map def\n", "utf8");
  return {
    filename,
    async append(record) {
      await fs.appendFile(filename, `${renderDerivedCompoundCoverageRowPya(record)}\n`, "utf8");
    },
    async close() {
      await fs.appendFile(filename, "prah\n", "utf8");
    }
  };
}

export async function runCompoundCoverageVerification(args = process.argv.slice(2)) {
  const mode = args[0] ?? "summary";
  const mindName = args[1] ?? "mind";
  const outputPath = args[2] ?? "";
  if (outputPath && mode !== "pya") {
    throw new Error("compound verification output path requires pya mode");
  }
  const previousHousekeeper = process.env.PYA_GPU_HOUSEKEEPER_URL;
  const previousManagerRequired = process.env.PYA_GPU_MANAGER_REQUIRED;
  forget();
  try {
    await loadDefaultConfig({
      cwd: process.cwd(),
      interpretFn: interpret,
      entryPath: process.cwd()
    });
    configureVerifierMind(mindName);
    const coverage = await loadCoverage();
    const invoke = await createDefaultQueuedMindCompoundVerifier({
      timeoutMs: Number(process.env.PYA_GPU_MANAGER_TIMEOUT_MS || 1800000)
    });
    const checkpoint = outputPath ? await createCheckpointWriter(outputPath) : null;
    const result = await verifyCompoundCoverage(coverage.records, {
      invoke,
      verifierName: mindName,
      onRecord: checkpoint ? ({ record }) => checkpoint.append(record) : undefined
    });

    if (mode === "pya") {
      if (checkpoint) {
        await checkpoint.close();
        return `${checkpoint.filename}\n`;
      }
      return renderDerivedCompoundCoveragePya(result.records, { name: "translation_compounds_verified" });
    }
    if (mode === "summary") {
      return `${JSON.stringify({
        records: result.records.length,
        deterministic: result.deterministic.length,
        accepted: result.accepted.length,
        uncertain: result.uncertain.length,
        rejected: result.rejected.length
      }, null, 2)}\n`;
    }
    throw new Error(`unknown compound verification mode: ${mode}`);
  } finally {
    if (previousHousekeeper === undefined) delete process.env.PYA_GPU_HOUSEKEEPER_URL;
    else process.env.PYA_GPU_HOUSEKEEPER_URL = previousHousekeeper;
    if (previousManagerRequired === undefined) delete process.env.PYA_GPU_MANAGER_REQUIRED;
    else process.env.PYA_GPU_MANAGER_REQUIRED = previousManagerRequired;
    forget();
  }
}

if (import.meta.url === new URL(process.argv[1], "file://").href) {
  runCompoundCoverageVerification().then((output) => {
    process.stdout.write(output);
  }).catch((error) => {
    console.error(error?.message || String(error));
    process.exitCode = 1;
  });
}
