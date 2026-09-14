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
  ]) {
    fs.writeFileSync(path.join(transcriptDir, name), "present\n", "utf8");
  }
  fs.writeFileSync(path.join(transcriptDir, "agenda-page.html"), "<!doctype html><title>Agenda</title>\n", "utf8");
  fs.writeFileSync(path.join(transcriptDir, `${agendaPrefix}.lemmy-post.json`), `${JSON.stringify({
    content_type: "agenda",
    title: "Agenda preview",
    body_markdown: "A grounded agenda preview.",
    agenda_url: "https://helpos.ca/agendas/owen-sound/board/2026-09-09",
    local_agenda_html: path.join(transcriptDir, "agenda-page.html"),
  })}\n`, "utf8");
  assert.equal(hasAgendaPreviewArtifactsCheckpoint(transcriptDir, agendaPrefix), true);
});

test("agenda preview checkpoint rejects a non-empty partial payload", (t) => {
  const transcriptDir = fs.mkdtempSync(path.join(os.tmpdir(), "agenda-preview-checkpoint-partial-"));
  t.after(() => fs.rmSync(transcriptDir, { recursive: true, force: true }));
  const agendaPrefix = "meeting-qwen-auto-normalized.agenda";
  for (const name of [
    "meeting-qwen-auto-normalized.agenda-summary.pya",
    `${agendaPrefix}.meeting-summary.md`,
    `${agendaPrefix}.meeting-hook.txt`,
  ]) {
    fs.writeFileSync(path.join(transcriptDir, name), "present\n", "utf8");
  }
  fs.writeFileSync(path.join(transcriptDir, `${agendaPrefix}.lemmy-post.json`), "{\"content_type\":\"agenda\"}\n", "utf8");
  assert.equal(hasAgendaPreviewArtifactsCheckpoint(transcriptDir, agendaPrefix), false);
});
