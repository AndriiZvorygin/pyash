import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { selectAgendaPreviewCoverPath } from "../program/library/reporter_shared/agenda-preview-cover.mjs";
import { hasWholeAgendaSummaryCheckpoint } from "../program/library/reporter_shared/agenda-preview-checkpoint.mjs";

test("agenda preview cover selection stays optional when drawing fails", () => {
  assert.equal(selectAgendaPreviewCoverPath({ drawCompleted: false, stablePath: "/old.png" }), "");
  assert.equal(selectAgendaPreviewCoverPath({ drawCompleted: true, stablePath: "/stable.png", isFreshFile: () => false }), "");
});

test("agenda preview prefers a fresh stable cover and then a fresh preferred cover", () => {
  assert.equal(
    selectAgendaPreviewCoverPath({
      drawCompleted: true,
      stablePath: "/stable.png",
      preferredPath: "/preferred.png",
      isFreshFile: (filePath) => filePath === "/stable.png",
    }),
    "/stable.png",
  );
  assert.equal(
    selectAgendaPreviewCoverPath({
      drawCompleted: true,
      stablePath: "/stable.png",
      preferredPath: "/preferred.png",
      isFreshFile: (filePath) => filePath === "/preferred.png",
    }),
    "/preferred.png",
  );
});

test("whole-agenda summary reuse requires complete non-empty section coverage", (t) => {
  const sections = [{ summary: "A generated summary." }, { summary: "Another generated summary." }];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agenda-summary-checkpoint-test-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const summaryPath = path.join(tempDir, "summary.md");
  fs.writeFileSync(summaryPath, [
    "# Whole Meeting Summary",
    "## Top Newsworthy Developments",
    "## Why It Matters",
    "## Watch Next",
  ].join("\n"), "utf8");
  assert.equal(hasWholeAgendaSummaryCheckpoint("/missing/summary.md", sections), false);
  assert.equal(hasWholeAgendaSummaryCheckpoint("/missing/summary.md", []), false);
  assert.equal(hasWholeAgendaSummaryCheckpoint(summaryPath, sections), true);
  assert.equal(hasWholeAgendaSummaryCheckpoint(summaryPath, [{ summary: "" }]), false);
});
