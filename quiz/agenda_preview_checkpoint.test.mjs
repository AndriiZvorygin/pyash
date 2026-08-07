import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { hasAgendaPreviewArtifactsCheckpoint } from "../program/library/reporter_shared/agenda-preview-checkpoint.mjs";

test("agenda preview checkpoint recognizes the canonical Stage 3 summary prefix", (t) => {
  const transcriptDir = fs.mkdtempSync(path.join(os.tmpdir(), "agenda-preview-checkpoint-"));
  t.after(() => fs.rmSync(transcriptDir, { recursive: true, force: true }));
  const agendaPrefix = "meeting-qwen-auto-normalized.agenda";
  for (const name of [
    "meeting-qwen-auto-normalized.agenda-summary.pya",
    `${agendaPrefix}.meeting-summary.md`,
    `${agendaPrefix}.meeting-hook.txt`,
    `${agendaPrefix}.lemmy-post.json`,
  ]) {
    fs.writeFileSync(path.join(transcriptDir, name), "present\n", "utf8");
  }
  assert.equal(hasAgendaPreviewArtifactsCheckpoint(transcriptDir, agendaPrefix), true);
});
