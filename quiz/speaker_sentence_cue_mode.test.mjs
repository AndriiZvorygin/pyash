import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readRepoFile = relativePath => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

const DIARIZER = readRepoFile("command/diarize_sentence_srt_from_transcript_folder.mjs");
const AUTO_ASSIGN = readRepoFile("command/auto_assign_speakers_from_callouts.mjs");

test("interview diarization routes one sentence cue per recognition request", () => {
  assert.match(DIARIZER, /function buildCueLevelTurns\(cues\)/u);
  assert.match(DIARIZER, /const CUE_LEVEL_TURNS = true/u);
  assert.match(DIARIZER, /const turns = buildCueLevelTurns\(workCues\)/u);
  assert.match(DIARIZER, /prevSpeaker: prevSpeaker \|\| null/u);
});

test("sentence-level speaker mode disables aggregate small-panel relabeling", () => {
  assert.match(DIARIZER, /aggregate relabel\/reassign: disabled/u);
  assert.doesNotMatch(DIARIZER, /if \(REASSIGN_PASS_ENABLED/u);
  assert.doesNotMatch(DIARIZER, /reassignReport\s*=\s*applySmallPanelReassign/u);
});

test("the shared speaker policy defaults to anonymous sentence-level output", () => {
  const policy = readRepoFile("program/library/reporter_shared/speaker-diarization-policy.mjs");
  assert.match(policy, /SPEAKER_DIARIZATION_POLICY_VERSION = "sentence-cue-anonymous-v1"/u);
  assert.match(policy, /PYA_SPEAKER_SENTENCE_ONLY: "1"/u);
  assert.match(policy, /PYA_SPEAKER_BAD_SAMPLE_GUARD: "1"/u);
  assert.match(policy, /namedSpeakerIdentityEnabled/u);
  assert.match(DIARIZER, /named_identity_output=\$\{NAMED_IDENTITY_OUTPUT_ENABLED/u);
  assert.match(DIARIZER, /aggregate relabel\/reassign: disabled/u);
  assert.match(AUTO_ASSIGN, /named speaker identity requires explicit verification opt-in/u);
});

test("panel identity mapping does not apply interview self-introduction aliases globally", () => {
  const RENDERER = readRepoFile("command/render_transcript_html_from_transcript_folder.mjs");
  assert.match(RENDERER, /PYA_INTERVIEW_SPEAKER_ALIASES/u);
  assert.match(RENDERER, /if \(!\/\^\(1\|true\|yes\)\$\/iu\.test\(String\(process\.env\.PYA_INTERVIEW_SPEAKER_ALIASES/u);
});

