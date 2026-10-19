import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";
import { normalizeEvidence } from "../program/library/knowledge_core.mjs";
import { sentenceToPyash } from "../program/beautiful.mjs";
import { splitSentences } from "../program/library/sentenceSplitter.mjs";
import { clearExchangeRecorder, setExchangeRecorder } from "../program/bridge/exchange.mjs";
import { runVocabSuggest } from "../command/vocab_suggest.mjs";
import {
  digestDocument,
  digestFilename,
  replayDigest,
  sourceIdForBytes,
  canonicalDigestStream,
  verifyArtifactHash,
  validateSourceSpan
} from "../program/library/document_digestion.mjs";
import { signatures as digestionSignatures } from "../program/verbs/document_digest.mjs";

const execFileAsync = promisify(execFile);

const fixture = name => path.resolve("quiz/fixtures", name);
const contentAddressedPath = (runRoot, hash, locator) => path.join(
  runRoot,
  "artifacts",
  "sha256",
  hash.slice(0, 2),
  hash.slice(2, 4),
  `${hash}${path.extname(locator)}`
);

async function readFixture(name) {
  return fs.readFile(fixture(name));
}

test("policy, technical, and tabular goldens emit stable anchored pi7 candidates", async () => {
  const cases = [
    ["document-digestion-policy.md", "markdown", 3, 3, "section-0001-paragraph-0001", "section-0002-paragraph-0001"],
    ["document-digestion-technical.md", "markdown", 3, 3, "section-0001-paragraph-0001", "section-0002-paragraph-0002"],
    ["document-digestion-table.csv", "csv", 2, 3, "table-header", "table-row-0002"]
  ];

  for (const [filename, format, count, anchorCount, firstAnchor, lastAnchor] of cases) {
    const bytes = await readFixture(filename);
    const first = digestDocument({ bytes, format });
    const second = digestDocument({ bytes: Buffer.from(bytes), format });
    const golden = await fs.readFile(fixture(filename.replace(/\.(?:md|csv)$/u, ".golden.pya")), "utf8");

    assert.equal(first.sourceId, `src-${crypto.createHash("sha256").update(bytes).digest("hex")}`);
    assert.equal(first.records.length, 1 + anchorCount + count);
    assert.equal(first.records[0].su.name, first.sourceId);
    assert.equal(first.source.be, "artifact");
    assert.equal(first.source.as.name, "source");
    assert.equal(first.source.to.filename, first.sourceLocator);
    assert.match(first.sourceLocator, new RegExp(`^artifacts/document-digestion/${first.sourceId}\\.${format}\\.source$`, "u"));
    assert.ok(first.anchors[0].id.startsWith(firstAnchor));
    assert.ok(first.anchors.at(-1).id.startsWith(lastAnchor));
    assert.equal(first.stream, second.stream);
    assert.equal(first.stream, golden);
    assert.equal(first.artifactHash, first.sourceId.slice(4));
    assert.deepEqual(verifyArtifactHash(bytes, first.artifactHash), {
      hash: first.artifactHash,
      size: bytes.length
    });
    assert.equal(replayDigest(first, second).identical, true);

    const candidates = first.candidates;
    assert.equal(candidates.length, count);
    for (const [index, candidate] of candidates.entries()) {
      assert.equal(candidate.mood, "pi7");
      assert.match(candidate.su.name, new RegExp(`^${first.sourceId}:candidate-\\d{4}$`, "u"));
      assert.equal(candidate.fromtext.la.su.name, first.sourceId);
      assert.equal(candidate.fromtext.la.mood, "ya");
      assert.equal(candidate.accordingto.name, "reported-evidential");
      assert.equal(candidate.by.num, 1);
      assert.match(candidate.fromtext.la.ob.text, /^(?:section|table)-/u);
      assert.equal(normalizeEvidence(candidate).anchor, candidate.fromtext.la.ob.text);
      const candidateLine = first.canonicalRecords.find(line => line === first.canonicalRecords[first.records.indexOf(candidate)]);
      assert.ok(candidateLine.endsWith(" pi7"));
      assert.deepEqual(parse(candidateLine), candidate);
    }

    assert.match(first.stream, new RegExp(`^exists su name ${first.sourceId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`, "u"));
    let recordIndex = 1;
    for (const anchor of first.anchors) {
      const marker = first.records[recordIndex];
      const markerPosition = first.stream.indexOf(sentenceToPyashForTest(marker));
      assert.ok(markerPosition >= 0);
      assert.match(marker.su.name, new RegExp(`^${first.sourceId}:`, "u"));
      recordIndex += 1;
      if (anchor.candidate) {
        const candidate = first.records[recordIndex];
        const candidatePosition = first.stream.indexOf(sentenceToPyashForTest(candidate));
        assert.ok(candidatePosition > markerPosition);
        recordIndex += 1;
      }
    }
  }
});

test("anchored document replay is byte-identical and preserves exact line endings", async () => {
  const bytes = Buffer.from("# Title\r\n\r\nCafé is covered.\r\nNext line.\r\n", "utf8");
  const result = digestDocument({ bytes, format: "markdown" });
  const anchor = result.anchors[0];

  assert.equal(result.sourceId, `src-${crypto.createHash("sha256").update(bytes).digest("hex")}`);
  assert.equal(sourceIdForBytes(bytes), result.sourceId);
  assert.equal(anchor.lineStart, 3);
  assert.equal(anchor.lineEnd, 4);
  assert.deepEqual(bytes.subarray(anchor.byteStart, anchor.byteEnd), Buffer.from("Café is covered.\r\nNext line.", "utf8"));
  assert.equal(result.candidates[0].ob.text, "Café is covered.\r\nNext line.");
  assert.equal(result.stream, digestDocument({ bytes, format: "markdown" }).stream);

  const bomBytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("# Title\n\nBody.\n", "utf8")]);
  const bomResult = digestDocument({ bytes: bomBytes, format: "markdown" });
  assert.equal(bomResult.sourceId, `src-${crypto.createHash("sha256").update(bomBytes).digest("hex")}`);
  assert.equal(bomResult.anchors[0].lineStart, 3);
  assert.equal(bomResult.anchors[0].byteStart, 12);
  assert.equal(bomResult.candidates[0].ob.text, "Body.");
});

test("CSV row anchors preserve CRLF and quoted multiline rows", () => {
  const bytes = Buffer.from("name,notes\r\nAda,\"line one\r\nline two\"\r\n", "utf8");
  const result = digestDocument({ bytes, format: "csv" });
  const row = result.anchors[1];

  assert.equal(row.id, "table-row-0001-lines-2-3-bytes-12-36");
  assert.deepEqual(bytes.subarray(row.byteStart, row.byteEnd), Buffer.from("Ada,\"line one\r\nline two\"", "utf8"));
  assert.equal(result.anchors[0].candidate, null);
  assert.equal(result.candidates[0].ob.text, "name: Ada; notes: line one\r\nline two");
  assert.match(result.candidates[0].su.name, new RegExp(`^${result.sourceId}:candidate-0001$`, "u"));
});

test("digest rejects empty input, invalid UTF-8, malformed CSV, and broken spans", async () => {
  assert.throws(
    () => digestDocument({ bytes: Buffer.alloc(0), format: "markdown" }),
    /empty input/u
  );
  assert.throws(
    () => sourceIdForBytes(Buffer.alloc(0)),
    /empty input/u
  );
  assert.throws(
    () => digestDocument({ bytes: Buffer.from([0xc3, 0x28]), format: "markdown" }),
    /invalid UTF-8/u
  );
  assert.throws(
    () => digestDocument({ bytes: Buffer.from("name,age\nAda,36,active\n", "utf8"), format: "csv" }),
    /CSV/u
  );
  assert.throws(
    () => digestDocument({ bytes: Buffer.from("name,age\n\"Ada,36\n", "utf8"), format: "csv" }),
    /CSV/u
  );

  const bytes = Buffer.from("a\n", "utf8");
  assert.throws(
    () => validateSourceSpan(bytes, { byteStart: 0, byteEnd: bytes.length + 1, lineStart: 1, lineEnd: 1 }),
    /span/u
  );
  assert.throws(
    () => validateSourceSpan(bytes, { byteStart: 0, byteEnd: 1, lineStart: 2, lineEnd: 2 }),
    /span/u
  );
  assert.throws(
    () => verifyArtifactHash(bytes, "0".repeat(64)),
    /artifact hash mismatch/u
  );
});

test("filename digestion records the source artifact hash and returns a Pyash series", async () => {
  const result = await digestFilename(fixture("document-digestion-policy.md"));
  assert.equal(result.source.be, "artifact");
  assert.equal(result.source.as.name, "source");
  assert.equal(result.source.to.filename, result.sourceLocator);
  assert.equal(result.series.be, "series");
  assert.equal(result.series.ob.series, result.records);
  assert.equal(result.artifactHash, result.sourceId.slice(4));
});

test("filename digestion emits the canonical projection before artifact events", async () => {
  const exchange = [];
  setExchangeRecorder({ record: sentence => exchange.push(sentence), runRoot: process.cwd() });
  try {
    const result = await digestFilename(fixture("document-digestion-policy.md"));
    assert.deepEqual(exchange.slice(0, result.records.length), result.records);
    const artifacts = exchange.filter(sentence => sentence.be === "artifact");
    assert.equal(artifacts.length, 3);
    assert.equal(artifacts[0].as.name, "source");
    assert.equal(artifacts[0].to.filename, result.sourceLocator);
    assert.equal(artifacts[1].accordingto.name, "sha256");
    assert.equal(artifacts[1].fromtext.text, result.artifactHash);
    assert.equal(artifacts[1].to.filename, result.sourceLocator);
    assert.equal(artifacts[2].as.name, "digest");
    assert.equal(artifacts[2].fromtext.text, result.streamHash);
    assert.equal(exchange.at(-1).be, "artifact");
    assert.equal(result.digestArtifact.fromtext.text, result.streamHash);
  } finally {
    clearExchangeRecorder();
  }
});

test("be digestion exposes the same records through a Pyash series target", async () => {
  forget();
  await interpret(parse(
    `su name principle from filename "${fixture("document-digestion-policy.md")}" to name series principle be digestion do`
  ));
  const output = remember("principle");
  assert.equal(output.be, "series");
  assert.equal(output.ob.series[0].be, "artifact");
  assert.equal(output.ob.series[0].as.name, "source");
  assert.equal(output.ob.series[2].mood, "pi7");
  assert.equal(output.ob.series[2].accordingto.name, "reported-evidential");
});

test("document digestion exposes a truthful series signature", () => {
  assert.ok(digestionSignatures.some(({ signatureWords }) => signatureWords.join(" ") === "be digestion from filename to name series"));
  assert.ok(digestionSignatures.some(({ signatureWords }) => signatureWords.join(" ") === "be digestion from text to name series"));
  assert.ok(digestionSignatures.some(({ signatureWords }) => signatureWords.join(" ") === "be digestion as wo csv from filename to name series"));
  assert.ok(digestionSignatures.some(({ signatureWords }) => signatureWords.join(" ") === "be digestion from filename fromstate wo markdown to name series"));
  assert.equal(digestionSignatures.some(({ signatureWords }) => signatureWords.includes("num") && signatureWords.includes("digestion")), false);
  assert.equal(digestionSignatures.some(({ signatureWords }) => signatureWords.join(" ").includes("as name csv") || signatureWords.join(" ").includes("as name markdown")), false);
});

test("the Pyash orchestration module delegates to the digestion series contract", async () => {
  forget();
  const modulePath = path.resolve("module/documentation_digestion.pya");
  const sourcePath = fixture("document-digestion-policy.md");
  await interpret(parse(`from filename "${modulePath}" ob name documentation digestion to name documentation digestion be import do`));
  await interpret(parse(`su name policy from filename "${sourcePath}" fromstate wo markdown to name series policy be documentation digestion do`));
  const output = remember("policy");
  assert.equal(output.be, "series");
  assert.equal(output.ob.series[0].as.name, "source");
  assert.equal(output.ob.series[2].mood, "pi7");
});

test("repository-root digestion example routes Markdown and CSV through the module", async () => {
  const examplePath = path.resolve("examples/pyash/document-digestion.pya");
  const runner = path.resolve("command/run_pya_program.mjs");
  const { stdout } = await execFileAsync(process.execPath, [
    runner,
    examplePath,
    "--no-newspaper",
    "--verbose",
    "--run-id",
    "document-digestion-example-test",
    "--run-time",
    "2026-09-01T12:00:00Z"
  ], {
    cwd: process.cwd(),
    maxBuffer: 16 * 1024 * 1024
  });
  for (const filename of [
    "document-digestion-policy.md",
    "document-digestion-technical.md",
    "document-digestion-table.csv"
  ]) {
    assert.match(stdout, new RegExp(filename.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  }
});

test("digestion module and golden streams pass vocabulary validation", async () => {
  const lines = [];
  const result = await runVocabSuggest([
    "module/documentation_digestion.pya",
    "quiz/fixtures/document-digestion-policy.golden.pya",
    "quiz/fixtures/document-digestion-technical.golden.pya",
    "quiz/fixtures/document-digestion-table.golden.pya"
  ], { report: line => lines.push(String(line)) });
  assert.equal(result.exitCode, 0, lines.join("\n"));
});

test("typed format forms dispatch for filename and text inputs", async () => {
  const markdown = await readFixture("document-digestion-policy.md");
  const csv = await readFixture("document-digestion-table.csv");
  const calls = [
    [`be digestion as wo csv from filename "${fixture("document-digestion-table.csv")}" to name series rows do`, "csv", csv],
    [`be digestion as wo csv from text quoted.text.${csv.toString("utf8")}.text.quoted to name series rows do`, "csv", csv],
    [`be digestion from filename "${fixture("document-digestion-policy.md")}" fromstate wo markdown to name series policy do`, "markdown", markdown],
    [`be digestion from text quoted.text.${markdown.toString("utf8")}.text.quoted fromstate wo markdown to name series policy do`, "markdown", markdown]
  ];
  for (const [call, format, bytes] of calls) {
    forget();
    await interpret(parse(call));
    const target = remember(call.includes("rows") ? "rows" : "policy");
    const expected = digestDocument({ bytes, format });
    assert.equal(target.be, "series");
    assert.equal(target.ob.series[0].su.name, expected.sourceId);
    assert.deepEqual(target.ob.series, expected.records);
  }
});

test("literal digestion has an executable JavaScript and C series boundary", async () => {
  const sourcePath = path.resolve("examples/pyash/document-digestion.pya");
  const expected = [
    ["principle", "document-digestion-policy.md"],
    ["technical", "document-digestion-technical.md"],
    ["table", "document-digestion-table.csv"]
  ].map(([name, filename]) => [name, digestDocument({ bytes: fsSync.readFileSync(fixture(filename)), filename }).stream]);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-document-compile-"));
  try {
    for (const targetState of ["javascript", "c"]) {
      forget();
      await interpret(parse(`from filename "${sourcePath}" to name output become name ${targetState} be compile do`));
      const output = remember("output");
      assert.equal(output.be, targetState);
      const body = unwrapCompiled(output.ob.text, targetState);
      assert.doesNotMatch(body, /TODO:.*digestion/u);
      assert.match(body, /src-7b5d10bc20a86cb16d320a9310afe3c751b5e21483a4c72a99ce08104d5eaa28/u);

      if (targetState === "javascript") {
        const scriptPath = path.join(tempDir, "digest.mjs");
        await fs.writeFile(scriptPath, `${body}\nconsole.log(JSON.stringify({ principle: globalThis["principle"], technical: globalThis["technical"], table: globalThis["table"] }));\n`, "utf8");
        const { stdout } = await execFileAsync(process.execPath, [scriptPath], { cwd: process.cwd(), maxBuffer: 8 * 1024 * 1024 });
        const values = JSON.parse(stdout.trim());
        for (const [name, stream] of expected) {
          assert.equal(canonicalDigestStream(values[name].ob.series), stream);
        }
      } else {
        const cPath = path.join(tempDir, "digest.c");
        const objectPath = path.join(tempDir, "digest.o");
        const wrapperPath = path.join(tempDir, "wrapper.c");
        const executablePath = path.join(tempDir, "digest");
        await fs.writeFile(cPath, body, "utf8");
        await fs.writeFile(wrapperPath, [
          "#include <stdio.h>",
          "extern const char *principle_digest_stream;",
          "extern const char *technical_digest_stream;",
          "extern const char *table_digest_stream;",
          "int main(void) { fputs(principle_digest_stream, stdout); fputs(technical_digest_stream, stdout); fputs(table_digest_stream, stdout); return 0; }"
        ].join("\n"), "utf8");
        await execFileAsync("gcc", ["-std=c11", "-O0", "-Dmain=pyash_generated_main", "-c", cPath, "-o", objectPath], { cwd: process.cwd(), maxBuffer: 2 * 1024 * 1024 });
        await execFileAsync("gcc", ["-std=c11", "-O0", objectPath, wrapperPath, "-o", executablePath], { cwd: process.cwd(), maxBuffer: 2 * 1024 * 1024 });
        const { stdout } = await execFileAsync(executablePath, [], { cwd: process.cwd(), maxBuffer: 8 * 1024 * 1024 });
        assert.equal(crypto.createHash("sha256").update(stdout, "utf8").digest("hex"), crypto.createHash("sha256").update(expected.map(([, stream]) => stream).join(""), "utf8").digest("hex"));
      }
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

function unwrapCompiled(text, lang) {
  const prefix = `quoted.${lang}.\n`;
  const suffix = `.${lang}.quoted`;
  assert.ok(text.startsWith(prefix));
  assert.ok(text.endsWith(suffix));
  return text.slice(prefix.length, -suffix.length);
}

function sentenceToPyashForTest(sentence) {
  return sentenceToPyash(sentence);
}

test("newspaper replay verifies two identical digest artifacts and rejects tampering", async () => {
  const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-document-digest-"));
  const source = await readFixture("document-digestion-policy.md");
  await fs.writeFile(path.join(runRoot, "source.md"), source);
  const modulePath = path.resolve("module/documentation_digestion.pya");
  await fs.writeFile(
    path.join(runRoot, "program.pya"),
    [
      `from filename "${modulePath}" ob name documentation digestion to name documentation digestion be import do`,
      'su name principle from filename "source.md" fromstate wo markdown to name series principle be documentation digestion do'
    ].join("\n") + "\n",
    "utf8"
  );
  const runner = path.resolve("command/run_pya_program.mjs");
  const replay = path.resolve("command/replay_newspaper.mjs");
  const runs = ["digest-replay-one", "digest-replay-two"];
  const digestArtifacts = [];
  const sourceArtifacts = [];

  try {
    for (const runId of runs) {
      await execFileAsync(process.execPath, [runner, "program.pya", "--newspaper", "--run-id", runId, "--run-time", "2026-08-31T12:00:00Z"], {
        cwd: runRoot,
        maxBuffer: 8 * 1024 * 1024
      });
      const newspaper = await fs.readFile(path.join(runRoot, "newspaper", `${runId}.pya`), "utf8");
      const records = splitSentences(newspaper).map(line => parse(line));
      const sourceArtifact = records.find(sentence => sentence?.be === "artifact" && sentence?.as?.name === "source");
      assert.ok(sourceArtifact);
      sourceArtifacts.push(sourceArtifact);
      const digestArtifact = records.find(sentence => sentence?.be === "artifact" && sentence?.as?.name === "digest");
      assert.ok(digestArtifact);
      assert.equal(digestArtifact.fromtext.text.length, 64);
      const streamPath = path.resolve(runRoot, digestArtifact.to.filename);
      const stream = await fs.readFile(streamPath, "utf8");
      assert.equal(crypto.createHash("sha256").update(stream, "utf8").digest("hex"), digestArtifact.fromtext.text);
      digestArtifacts.push({ digestArtifact, stream, streamPath });

      await execFileAsync(process.execPath, [replay, "--run-id", runId, "--run-root", runRoot], {
        cwd: runRoot,
        maxBuffer: 2 * 1024 * 1024
      });
    }

    assert.equal(digestArtifacts[0].stream, digestArtifacts[1].stream);
    assert.equal(digestArtifacts[0].digestArtifact.fromtext.text, digestArtifacts[1].digestArtifact.fromtext.text);

    const sourceHash = sourceArtifacts[0].fromtext.text;
    const sourceLocator = sourceArtifacts[0].to.filename;
    const sourcePath = contentAddressedPath(runRoot, sourceHash, sourceLocator);
    const sourceBytes = await fs.readFile(sourcePath);
    await fs.writeFile(sourcePath, Buffer.concat([sourceBytes, Buffer.from("tampered", "utf8")]));
    await assert.rejects(
      execFileAsync(process.execPath, [replay, "--run-id", runs[0], "--run-root", runRoot], {
        cwd: runRoot,
        maxBuffer: 2 * 1024 * 1024
      }),
      error => error?.code === 1 && /hash inconsistency/u.test(String(error.stderr))
    );
    await fs.writeFile(sourcePath, sourceBytes);

    const expectedHash = digestArtifacts[0].digestArtifact.fromtext.text;
    const digestPath = contentAddressedPath(runRoot, expectedHash, digestArtifacts[0].digestArtifact.to.filename);
    await fs.writeFile(digestPath, `${digestArtifacts[0].stream}tampered`, "utf8");
    await assert.rejects(
      execFileAsync(process.execPath, [replay, "--run-id", runs[0], "--run-root", runRoot], {
        cwd: runRoot,
        maxBuffer: 2 * 1024 * 1024
      }),
      error => error?.code === 1 && /hash inconsistency/u.test(String(error.stderr))
    );
  } finally {
    await fs.rm(runRoot, { recursive: true, force: true });
  }
});
