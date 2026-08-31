import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";
import { normalizeEvidence } from "../program/library/knowledge_core.mjs";
import { clearExchangeRecorder, setExchangeRecorder } from "../program/bridge/exchange.mjs";
import {
  digestDocument,
  digestFilename,
  replayDigest,
  sourceIdForBytes,
  verifyArtifactHash,
  validateSourceSpan
} from "../program/library/document_digestion.mjs";

const fixture = name => path.resolve("quiz/fixtures", name);

async function readFixture(name) {
  return fs.readFile(fixture(name));
}

test("policy, technical, and tabular goldens emit stable anchored pi7 candidates", async () => {
  const cases = [
    ["document-digestion-policy.md", "markdown", 3, "section-0001-paragraph-0001", "section-0002-paragraph-0001"],
    ["document-digestion-technical.md", "markdown", 3, "section-0001-paragraph-0001", "section-0002-paragraph-0002"],
    ["document-digestion-table.csv", "csv", 3, "table-header", "table-row-0002"]
  ];

  for (const [filename, format, count, firstAnchor, lastAnchor] of cases) {
    const bytes = await readFixture(filename);
    const first = digestDocument({ bytes, format });
    const second = digestDocument({ bytes: Buffer.from(bytes), format });
    const golden = await fs.readFile(fixture(filename.replace(/\.(?:md|csv)$/u, ".golden.pya")), "utf8");

    assert.equal(first.sourceId, `src-${crypto.createHash("sha256").update(bytes).digest("hex")}`);
    assert.equal(first.records.length, 1 + count * 2);
    assert.equal(first.records[0].su.name, first.sourceId);
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
      assert.equal(candidate.fromtext.la.su.name, first.sourceId);
      assert.equal(candidate.accordingto.name, "reported-evidential");
      assert.equal(candidate.by.num, 1);
      assert.match(candidate.fromtext.la.ob.text, /^(?:section|table)-/u);
      assert.equal(normalizeEvidence(candidate).anchor, candidate.fromtext.la.ob.text);
      const candidateLine = first.canonicalRecords[2 + index * 2];
      assert.ok(candidateLine.endsWith(" pi7"));
      assert.deepEqual(parse(candidateLine), candidate);
    }

    assert.match(first.stream, new RegExp(`^exists su name ${first.sourceId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`, "u"));
    for (let index = 0; index < first.anchors.length; index += 1) {
      const markerPosition = first.stream.indexOf(first.canonicalRecords[1 + index * 2]);
      const candidatePosition = first.stream.indexOf(first.canonicalRecords[2 + index * 2]);
      assert.ok(markerPosition >= 0);
      assert.ok(candidatePosition > markerPosition);
      if (index > 0) {
        const previousCandidatePosition = first.stream.indexOf(first.canonicalRecords[index * 2]);
        assert.ok(markerPosition > previousCandidatePosition);
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
  assert.equal(result.candidates[1].ob.text, "Ada,\"line one\r\nline two\"");
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
  assert.equal(result.source.be, "source");
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
    const artifact = exchange.at(-2);
    assert.equal(artifact.be, "artifact");
    assert.equal(artifact.accordingto.name, "sha256");
    assert.equal(artifact.fromtext.text, result.artifactHash);
    assert.equal(exchange.at(-1).be, "exchange");
  } finally {
    clearExchangeRecorder();
  }
});

test("be digestion exposes the same records through a Pyash series target", async () => {
  forget();
  await interpret(parse(
    `su name principle from filename "${fixture("document-digestion-policy.md")}" to name principle be digestion do`
  ));
  const output = remember("principle");
  assert.equal(output.be, "series");
  assert.equal(output.ob.series[0].be, "source");
  assert.equal(output.ob.series[2].mood, "pi7");
  assert.equal(output.ob.series[2].accordingto.name, "reported-evidential");
});
