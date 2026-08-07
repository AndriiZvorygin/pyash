import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAgendaPreviewChunkSpans,
  chunkAgendaPreviewSource,
} from "../program/library/reporter_shared/agenda-preview-source-chunks.mjs";

function normalized(text = "") {
  return String(text || "").replace(/\s+/gu, " ").trim();
}

test("agenda preview chunking splits an oversized paragraph without losing source text", () => {
  const source = Array.from(
    { length: 2400 },
    (_, index) => `word${String(index).padStart(4, "0")}`,
  ).join(" ");

  const chunks = chunkAgendaPreviewSource(source, { maxChars: 9000, targetChars: 8000 });

  assert.ok(chunks.length >= 3);
  assert.equal(chunks.every((chunk) => chunk.length <= 9000), true);
  assert.equal(normalized(chunks.join(" ")), normalized(source));
});

test("agenda preview chunking retains a short final source span", () => {
  const source = `${"context ".repeat(1100)}\n\nFinal recommendation carried.`;
  const chunks = chunkAgendaPreviewSource(source, { maxChars: 9000, targetChars: 8000 });

  assert.equal(chunks.at(-1).includes("Final recommendation carried."), true);
  assert.equal(normalized(chunks.join(" ")), normalized(source));
});

test("agenda preview chunking does not turn uppercase slide headings into tiny chapters", () => {
  const slide = (heading, detail) => `${heading}\n\n${detail.repeat(18)}`;
  const source = [
    slide("COMMUNITY NEED", "The outreach team provides a non-emergency response. "),
    slide("STRATEGIES", "Staff use harm reduction and de-escalation practices. "),
    slide("COMMUNITY SURVEY RESULTS", "Businesses described safety and service needs. "),
    slide("ACKNOWLEDGEMENTS", "The report recognizes project partners. "),
    slide("THANK YOU FOR FUNDING THIS PILOT PROGRAM", "The presentation closes with thanks. "),
  ].join("\n\n");

  const chunks = chunkAgendaPreviewSource(source, { maxChars: 9000, targetChars: 8000 });

  assert.equal(chunks.length, 1);
  assert.equal(normalized(chunks.join(" ")), normalized(source));
});

test("agenda preview chunking is controlled by character capacity, not attachment markers", () => {
  const source = [
    "Attachment: Presentation.pdf",
    "Short presentation content. ".repeat(40),
    "Attachment: Staff Report.pdf",
    "Short staff report content. ".repeat(40),
    "Attachment: Letters of Support.pdf",
    "Short correspondence content. ".repeat(40),
  ].join("\n\n");

  const chunks = chunkAgendaPreviewSource(source, { maxChars: 9000, targetChars: 8000 });

  assert.equal(chunks.length, 1);
  assert.equal(normalized(chunks.join(" ")), normalized(source));
});

test("agenda preview chunk spans divide the parent row and time ranges", () => {
  const source = Array.from(
    { length: 18 },
    (_, index) => `Paragraph ${index + 1}. ${"detail ".repeat(95)}`,
  ).join("\n\n");
  const spans = buildAgendaPreviewChunkSpans(source, {
    rowStart: 40,
    sourceRows: 18,
    since: 120,
    durationSeconds: 180,
    maxChars: 3000,
    targetChars: 2500,
  });

  assert.ok(spans.length >= 3);
  assert.equal(spans[0].rowStart, 40);
  assert.equal(spans.at(-1).rowEnd, 57);
  assert.equal(spans[0].since, 120);
  assert.equal(spans.at(-1).until, 300);
  for (let index = 1; index < spans.length; index += 1) {
    assert.equal(spans[index].rowStart, spans[index - 1].rowEnd + 1);
    assert.equal(spans[index].since, spans[index - 1].until);
  }
  assert.equal(normalized(spans.map((span) => span.text).join(" ")), normalized(source));
});

test("agenda preview chunking preserves reports longer than the former 60000 character cap", () => {
  const source = Array.from(
    { length: 900 },
    (_, index) => `Report paragraph ${index + 1}: ${"substantive evidence ".repeat(5)}`,
  ).join("\n\n");
  assert.ok(source.length > 60000);

  const chunks = chunkAgendaPreviewSource(source);

  assert.equal(chunks.every((chunk) => chunk.length <= 9000), true);
  assert.equal(normalized(chunks.join(" ")), normalized(source));
  assert.match(chunks.at(-1), /Report paragraph 900:/u);
});
