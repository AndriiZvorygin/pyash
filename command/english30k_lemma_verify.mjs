import fs from "node:fs/promises";
import { resolve } from "node:path";

import pyashWords from "../program/library/pyashWords.json" with { type: "json" };
import { interpret } from "../program/bridge/index.mjs";
import { parse } from "../program/understand/index.mjs";
import { doRemember, forget, remember } from "../program/remember/index.mjs";
import { resolveConfigText } from "../program/configure/env.mjs";
import { loadDefaultConfig } from "./run_pya_helpers.mjs";
import {
  buildEnglishLemmaCandidates,
  loadEnglishLemmaCatalog,
  renderEnglishLemmaCatalogPya
} from "../program/library/translation/english_lemmas.mjs";
import { loadEnglish30k } from "../program/library/translation/english30k_coverage.mjs";
import { loadAnchorWordForms } from "../program/library/translation/anchor_words.mjs";
import {
  createDefaultQueuedMindEnglishLemmaVerifier,
  verifyEnglishLemmaCandidates
} from "../program/library/translation/english_lemma_verification.mjs";

function configureVerifierMind(mindName) {
  const backend = String(resolveConfigText("mind backend", { rememberFn: remember }) || "ollama command mind").trim();
  const model = String(resolveConfigText("mind model", { rememberFn: remember }) || "").trim();
  const host = String((/ollama/iu.test(backend)
    ? resolveConfigText("ollama host", { rememberFn: remember })
    : resolveConfigText("ai host", { rememberFn: remember }) || resolveConfigText("ollama host", { rememberFn: remember })) || "").trim();
  const housekeeper = String(resolveConfigText("gpu housekeeper url", { rememberFn: remember }) || "").trim();
  if (!model || !host) throw new Error("English lemma verifier requires configured mind model and host");
  if (housekeeper && !String(process.env.PYA_GPU_HOUSEKEEPER_URL || "").trim()) process.env.PYA_GPU_HOUSEKEEPER_URL = housekeeper;
  if (housekeeper && process.env.PYA_GPU_MANAGER_REQUIRED === undefined) process.env.PYA_GPU_MANAGER_REQUIRED = "true";
  doRemember({
    mood: "ya",
    su: { name: mindName },
    be: "mind",
    as: { name: model },
    fromstate: { text: backend },
    from: { text: host }
  });
}

export async function runEnglish30kLemmaVerification(args = process.argv.slice(2)) {
  const mode = args[0] ?? "summary";
  const mindName = args[1] ?? "english lemma verifier";
  const outputPath = args[2] ?? "";
  const previousHousekeeper = process.env.PYA_GPU_HOUSEKEEPER_URL;
  const previousManagerRequired = process.env.PYA_GPU_MANAGER_REQUIRED;
  forget();
  try {
    await loadDefaultConfig({ cwd: process.cwd(), interpretFn: interpret, entryPath: process.cwd() });
    configureVerifierMind(mindName);
    const [source, catalog, anchors] = await Promise.all([
      loadEnglish30k(),
      loadEnglishLemmaCatalog(),
      loadAnchorWordForms()
    ]);
    const candidates = buildEnglishLemmaCandidates({
      sourceRows: source.rows,
      atomicEntries: pyashWords,
      aliases: anchors.formsToAnchor,
      catalogEntries: catalog.entries
    });
    const invoke = await createDefaultQueuedMindEnglishLemmaVerifier({
      timeoutMs: Number(process.env.PYA_GPU_MANAGER_TIMEOUT_MS || 1800000)
    });
    const result = await verifyEnglishLemmaCandidates(candidates, { invoke, verifierName: mindName });
    if (mode === "summary") {
      return JSON.stringify({
        candidates: result.records.length,
        accepted: result.accepted.length,
        uncertain: result.uncertain.length,
        rejected: result.rejected.length
      }, null, 2);
    }
    if (mode === "pya") {
      const rendered = renderEnglishLemmaCatalogPya(
        {
          source: { path: source.path, sourceHash: source.sourceHash, cutoff: source.cutoff },
          entries: result.records
        },
        { name: "translation_english30k_lemma_review" }
      );
      if (outputPath) {
        await fs.writeFile(resolve(outputPath), rendered, "utf8");
        return `${resolve(outputPath)}\n`;
      }
      return rendered;
    }
    throw new Error(`unknown English lemma verification mode: ${mode}`);
  } finally {
    if (previousHousekeeper === undefined) delete process.env.PYA_GPU_HOUSEKEEPER_URL;
    else process.env.PYA_GPU_HOUSEKEEPER_URL = previousHousekeeper;
    if (previousManagerRequired === undefined) delete process.env.PYA_GPU_MANAGER_REQUIRED;
    else process.env.PYA_GPU_MANAGER_REQUIRED = previousManagerRequired;
    forget();
  }
}

if (import.meta.url === new URL(process.argv[1], "file://").href) {
  runEnglish30kLemmaVerification().then((output) => {
    process.stdout.write(output);
  }).catch((error) => {
    console.error(error?.message || String(error));
    process.exitCode = 1;
  });
}
