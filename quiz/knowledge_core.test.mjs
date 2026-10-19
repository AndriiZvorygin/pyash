import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import vm from "node:vm";
import { promisify } from "node:util";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { allRemember, forget } from "../program/remember/index.mjs";
import { buildProgram } from "../program/program.mjs";
import { transpileProgram } from "../program/verbs/exchange/compile/transpile_program.mjs";
import { sentenceToPyash } from "../program/beautiful.mjs";
import {
  deriveClaimKey,
  canonicalJson,
  compareUtf8Bytes,
  normalizeEvidence,
  resolveCurrentView,
  resolveContestedView,
  resolveProvenanceView
} from "../program/library/knowledge_core.mjs";

const execFileAsync = promisify(execFile);

const claimLine = ({ payload, confidence, evidence, sourceAnchor, window = true, predicate = "plus" } = {}) => {
  const cases = [
    `su name weather`,
    `ob text ${JSON.stringify(payload ?? "clear")}`,
    "as name public"
  ];
  if (window) cases.push("since date 2026-01-01 until date 2026-01-31");
  if (sourceAnchor) cases.push(`fromtext text ${JSON.stringify(sourceAnchor)}`);
  if (evidence) cases.push(`accordingto name ${evidence}`);
  if (confidence !== undefined) cases.push(`by num ${confidence}`);
  cases.push(`be ${predicate} ya`);
  return parse(cases.join(" "));
};

test("claim key is canonical across predicate aliases and case order", () => {
  const canonical = claimLine({ predicate: "plus" });
  const alias = parse([
    "as name public",
    "until date 2026-01-31",
    "ob text \"clear\"",
    "su name weather",
    "since date 2026-01-01",
    "be add ya"
  ].join(" "));

  assert.equal(deriveClaimKey(canonical), deriveClaimKey(alias));
  assert.equal(
    deriveClaimKey(canonical),
    "su name weather since date 2026-01-01 until date 2026-01-31 as name public be plus ya"
  );
  assert.notEqual(
    deriveClaimKey(canonical),
    deriveClaimKey(claimLine({ window: false }))
  );
});

test("claim keys support timeless claims and reject partial or timestamp windows", () => {
  const timeless = claimLine({ window: false });
  assert.equal(
    deriveClaimKey(timeless),
    "su name weather as name public be plus ya"
  );

  assert.throws(
    () => deriveClaimKey(parse("su name weather ob text clear since date 2026-01-01 as name public be plus ya")),
    /time window defective/u
  );
  assert.throws(
    () => deriveClaimKey(parse("su name weather ob text clear since date 2026-01-01T12:00:00Z until date 2026-01-31 as name public be plus ya")),
    /time window defective/u
  );
});

test("knowledge ordering uses locale-independent UTF-8 bytes", () => {
  assert.equal(compareUtf8Bytes("Zebra", "apple"), -1);
  assert.equal(compareUtf8Bytes("apple", "Éclair"), -1);
  assert.deepEqual(
    Object.keys(canonicalJson({ "é": 1, apple: 2, Zebra: 3, "Å": 4, zebra: 5 })),
    ["Zebra", "apple", "zebra", "Å", "é"]
  );

  const duplicateReported = normalizeEvidence(claimLine({
    payload: "same",
    confidence: 0.5,
    evidence: "reported-evidential",
    sourceAnchor: "tie-source tie-anchor"
  }));
  const duplicateDirect = normalizeEvidence(claimLine({
    payload: "same",
    confidence: 0.5,
    evidence: "direct-evidential",
    sourceAnchor: "tie-source tie-anchor"
  }));
  assert.equal(
    resolveCurrentView([duplicateReported, duplicateDirect], duplicateReported.key).record.evidential,
    "direct"
  );
});

test("evidence fixture uses accordingto evidential names and stable source anchor", () => {
  const sentence = claimLine({
    confidence: 0.75,
    evidence: "direct-evidential",
    sourceAnchor: "weather-report-1 paragraph-2"
  });
  const evidence = normalizeEvidence(sentence);

  assert.deepEqual(evidence, {
    key: deriveClaimKey(sentence),
    payload: { text: "clear" },
    evidential: "direct",
    confidence: 0.75,
    source: "weather-report-1",
    anchor: "paragraph-2",
    anchorId: "weather-report-1#paragraph-2",
    sentence: sentenceToPyash(sentence)
  });
  assert.equal(
    sentenceToPyash(sentence),
    "su name weather ob text \"clear\" since date 2026-01-01 until date 2026-01-31 as name public fromtext text \"weather-report-1 paragraph-2\" accordingto name direct-evidential by num 0.75 be plus ya"
  );

  const mixedCase = claimLine({
    confidence: 0.75,
    evidence: "DIRECT-EVIDENTIAL",
    sourceAnchor: "weather-report-1 paragraph-2"
  });
  assert.equal(normalizeEvidence(mixedCase).sentence, evidence.sentence);
  assert.throws(
    () => normalizeEvidence(claimLine({ evidence: "direct-evidential", sourceAnchor: "weather-report-1" })),
    /source anchor defective/u
  );
  assert.throws(
    () => normalizeEvidence(claimLine({ evidence: "direct-evidential", confidence: 1.1, sourceAnchor: "weather-report-1 paragraph-2" })),
    /confidence defective/u
  );
});

test("resolver selects duplicate evidence by confidence but retains conflicts", () => {
  const records = [
    normalizeEvidence(claimLine({ confidence: 0.4, evidence: "reported-evidential", sourceAnchor: "wire-1 p-1" })),
    normalizeEvidence(claimLine({ confidence: 0.9, evidence: "direct-evidential", sourceAnchor: "official-1 p-1" })),
    normalizeEvidence(claimLine({ payload: "storm", confidence: 0.99, evidence: "inferential-evidential", sourceAnchor: "model-1 p-1" }))
  ];
  const key = records[0].key;

  const current = resolveCurrentView(records, key);
  assert.equal(current.status, "contested");
  assert.equal(current.record, null);
  assert.deepEqual(current.records.map(record => record.payload), [{ text: "clear" }, { text: "storm" }]);
  assert.equal(current.records[0].confidence, 0.9);

  const contested = resolveContestedView(records, key);
  assert.equal(contested.status, "contested");
  assert.equal(contested.records.length, 2);

  const provenance = resolveProvenanceView(records, key);
  assert.equal(provenance.status, "provenance");
  assert.equal(provenance.records.length, 3);
  assert.deepEqual(provenance.records.map(record => record.anchorId), [
    "model-1#p-1",
    "official-1#p-1",
    "wire-1#p-1"
  ]);

  const duplicateKey = records[0].key;
  const lowAnchor = normalizeEvidence(claimLine({ confidence: 0.1, evidence: "reported-evidential", sourceAnchor: "a-low p-1" }));
  const highAnchor = normalizeEvidence(claimLine({ confidence: 0.9, evidence: "direct-evidential", sourceAnchor: "z-high p-1" }));
  assert.equal(resolveCurrentView([lowAnchor, highAnchor], duplicateKey).record.confidence, 0.9);
});

test("interpreter preserves repeated evidence sentences for one subject", async () => {
  forget();
  const first = claimLine({ payload: "clear", confidence: 0.4, evidence: "reported-evidential", sourceAnchor: "wire-1 p-1", predicate: "text" });
  first.exists = true;
  const second = claimLine({ payload: "storm", confidence: 0.9, evidence: "direct-evidential", sourceAnchor: "official-1 p-1", predicate: "text" });

  await interpret(first);
  await interpret(second);
  await interpret(claimLine({ payload: "latest", predicate: "text" }));

  const stored = allRemember().filter(sentence => sentence?.accordingto?.name?.endsWith("-evidential"));
  assert.equal(stored.length, 2);
  assert.deepEqual(stored.map(sentence => sentence.ob.text), ["clear", "storm"]);
});

test("compiled JavaScript keeps evidence records live for runtime resolution", () => {
  const source = [
    "exists su name weather ob text clear as name public since date 2026-01-01 until date 2026-01-31 fromtext text \"a-low p-1\" accordingto name reported-evidential by num 0.4 be text ya",
    "su name weather ob text clear as name public since date 2026-01-01 until date 2026-01-31 fromtext text \"z-high p-1\" accordingto name direct-evidential by num 0.9 be text ya"
  ].join("\n");
  const js = transpileProgram(buildProgram(source).sentences, { lang: "javascript" });
  const sandbox = { globalThis: null };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(`${js}\nglobalThis.__result = __pyaKnowledge.resolveCurrent(__pyaKnowledge.claimKey(__pyaKnowledgeRecords[0]));`, sandbox);

  assert.equal(sandbox.__pyaKnowledgeRecords.length, 2);
  assert.equal(sandbox.__result.status, "current");
  sandbox.__pyaKnowledgeRecords[0].ob.text = "storm";
  vm.runInNewContext("globalThis.__result = __pyaKnowledge.resolveCurrent(__pyaKnowledge.claimKey(__pyaKnowledgeRecords[0]));", sandbox);
  assert.equal(sandbox.__result.status, "contested");
  assert.equal(Array.from(sandbox.__result.records, record => record.payload.text).join(","), "clear,storm");
});

test("compiled C renders the canonical resolver view and observes runtime mutation", async () => {
  const source = [
    "exists su name weather ob text clear as name public since date 2026-01-01 until date 2026-01-31 fromtext text \"a-low p-1\" accordingto name reported-evidential by num 0.4 be text ya",
    "su name weather ob text clear as name public since date 2026-01-01 until date 2026-01-31 fromtext text \"z-high p-1\" accordingto name direct-evidential by num 0.9 be text ya"
  ].join("\n");
  const sentences = buildProgram(source).sentences;
  const js = transpileProgram(sentences, { lang: "javascript" });
  const sandbox = { globalThis: null };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(`${js}\nconst __key = __pyaKnowledge.claimKey(__pyaKnowledgeRecords[0]);\nglobalThis.__current = __pyaKnowledge.resolveCurrent(__key);\nglobalThis.__contested = __pyaKnowledge.resolveContested(__key);\nglobalThis.__provenance = __pyaKnowledge.resolveProvenance(__key);`, sandbox);
  const initial = [sandbox.__current, sandbox.__contested, sandbox.__provenance].map(JSON.stringify);
  const directRecords = sentences.map(normalizeEvidence);
  const directKey = directRecords[0].key;
  assert.deepEqual(initial, [
    resolveCurrentView(directRecords, directKey),
    resolveContestedView(directRecords, directKey),
    resolveProvenanceView(directRecords, directKey)
  ].map(JSON.stringify));

  const c = transpileProgram(sentences, { lang: "c" });
  const key = sandbox.__pyaKnowledge.claimKey(sandbox.__pyaKnowledgeRecords[0]);
  const mutation = [
    `  printf("%s\\n", pya_knowledge_render_current(${JSON.stringify(key)}));`,
    `  printf("%s\\n", pya_knowledge_render_contested(${JSON.stringify(key)}));`,
    `  printf("%s\\n", pya_knowledge_render_provenance(${JSON.stringify(key)}));`,
    "  strcpy(pya_knowledge_records[0].payload_json, \"{\\\"text\\\":\\\"storm\\\"}\");",
    `  printf("%s\\n", pya_knowledge_render_current(${JSON.stringify(key)}));`
  ].join("\n");
  const runnable = c.replace("  return 0;\n}\n#if defined(__GNUC__)", `${mutation}\n  return 0;\n}\n#if defined(__GNUC__)`);

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-knowledge-c-"));
  const cPath = path.join(tempDir, "knowledge.c");
  const executablePath = path.join(tempDir, "knowledge");
  await fs.writeFile(cPath, runnable, "utf8");
  await execFileAsync("gcc", ["-std=c11", "-O0", "-o", executablePath, cPath], { timeout: 120000 });
  const { stdout } = await execFileAsync(executablePath, [], { timeout: 120000 });
  const [cCurrent, cContested, cProvenance, cMutated] = stdout.trim().split(/\r?\n/u);

  assert.deepEqual([cCurrent, cContested, cProvenance], initial);
  const mutated = JSON.parse(cMutated);
  assert.equal(mutated.status, "contested");
  assert.deepEqual(mutated.records.map(record => record.payload), [{ text: "clear" }, { text: "storm" }]);
});
