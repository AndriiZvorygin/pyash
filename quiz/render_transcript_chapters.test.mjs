import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";

import { writePyaMapArtifact } from "../program/library/reporter_shared/agenda-stage-contracts.mjs";

test("transcript renderer displays only Stage 3 chapters", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pyash-render-chapters-"));
  const transcriptDir = path.join(root, "2026-05-25_test-meeting", "transcript");
  fs.mkdirSync(transcriptDir, { recursive: true });

  fs.writeFileSync(
    path.join(transcriptDir, "meeting-qwen-auto-normalized.sentences.speaker.sentences.json"),
    JSON.stringify({
      rows: [
        { since: 0, until: 10, display: "Chair", text: "The neighborhood program begins." },
        { since: 10, until: 20, display: "Chair", text: "The first item continues." },
        { since: 20, until: 30, display: "Chair", text: "The second item begins." },
        { since: 30, until: 40, display: "Chair", text: "The second item continues." },
      ],
    }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(transcriptDir, "meeting-qwen-auto-normalized.sentences.speaker.sentence.srt"),
    [
      "1",
      "00:00:00,000 --> 00:00:10,000",
      "Chair: The neighborhood program begins.",
      "",
      "2",
      "00:00:10,000 --> 00:00:20,000",
      "Chair: The first item continues.",
      "",
      "3",
      "00:00:20,000 --> 00:00:30,000",
      "Chair: The second item begins.",
      "",
      "4",
      "00:00:30,000 --> 00:00:40,000",
      "Chair: The second item continues.",
      "",
    ].join("\n"),
    "utf8",
  );

  writePyaMapArtifact(
    path.join(transcriptDir, "meeting-qwen-auto-normalized.agenda-summary.pya"),
    "agenda summary artifact",
    {
      "schema version": "agenda_summary_v1",
      "source section grounding": "",
      "transcript dir": transcriptDir,
      prefix: "meeting-qwen-auto-normalized",
      focus: "",
      "generated time": "2026-05-25T00:00:00.000Z",
      sections: [
        {
          index: 1,
          "unit id": "ground_001",
          heading: "1 First Item",
          summary: "The first item was summarized by Stage 3.",
          "start row": 0,
          "end row": 1,
          "source rows": 2,
          chapters: [
            {
              "chapter id": "ground_001_chapter_01",
              "parent unit id": "ground_001",
              "ordering index": 1,
              "row start": 1,
              "row end": 1,
              since: 0,
              title: "Stage 3 Chapter",
              text: "This chapter came from Stage 3.",
            },
          ],
        },
        {
          index: 2,
          "unit id": "ground_002",
          heading: "2 Second Item",
          summary: "The second item has no Stage 3 chapters.",
          "start row": 2,
          "end row": 3,
          "source rows": 2,
          chapters: [],
        },
      ],
    },
  );

  execFileSync("node", [
    path.join(process.cwd(), "command/render_transcript_html_from_transcript_folder.mjs"),
    transcriptDir,
    "transcript-page.html",
    "Test Jurisdiction",
    "Council",
    "https://example.test",
  ], { cwd: path.resolve("."), stdio: "pipe" });

  const html = fs.readFileSync(path.join(transcriptDir, "transcript-page.html"), "utf8");
  assert.match(html, /Stage 3 Chapter/u);
  assert.match(html, /This chapter came from Stage 3/u);
  assert.equal((html.match(/class="chapter-summary"/gu) || []).length, 1);
  assert.equal((html.match(/class="section-chapters"/gu) || []).length, 0);
  assert.match(html, /<ol class="toc-chapters"><li><a href="#chapter-ground-001-chapter-01">00:00:10 Stage 3 Chapter<\/a><\/li><\/ol>/u);
  assert.match(html, /The neighbourhood programme begins\./u);
  assert.doesNotMatch(html, /\bneighborhood\b|\bprogram\b/u);
  assert.match(
    html,
    /The neighbourhood programme begins\.[\s\S]*<aside id="chapter-ground-001-chapter-01" class="chapter-summary">[\s\S]*This chapter came from Stage 3\.[\s\S]*The first item continues\./u,
  );
  assert.doesNotMatch(html, /The second item has no Stage 3 chapters[\s\S]*class="chapter-summary"/u);
});
