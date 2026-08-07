import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  unsupportedNamedMotionAttributions,
  verifyAgendaMotionAttributions,
} from "../program/library/reporter_shared/motion-attribution-verifier.mjs";
import { summarizeGroundedUnit } from "../program/library/reporter_shared/agenda-stage3-summary-renderer.mjs";
import { writePyaMapArtifact } from "../program/library/reporter_shared/agenda-stage-contracts.mjs";

test("rejects a mover inferred from a nearby conflict declaration", () => {
  const sourceExcerpt = [
    "SPEAKER_251: I therefore move that City Council enter into a funding agreement.",
    "SPEAKER_009: Councillor Kukreja.",
    "SPEAKER_009: Through your chair I would declare a conflict of interest because I am employed with Georgian College.",
  ].join("\n");
  const defects = unsupportedNamedMotionAttributions({
    text: "Councillor Kukreja moved the funding motion.",
    sourceExcerpt,
  });
  assert.equal(defects.length, 1);
  assert.equal(defects[0].actor, "Councillor Kukreja");
});

test("accepts a mover only when a source line explicitly pairs name and role", () => {
  const sourceExcerpt = "Councillor Farmer: I move that Council receive the report.";
  const defects = unsupportedNamedMotionAttributions({
    text: "Councillor Farmer moved that Council receive the report.",
    sourceExcerpt,
  });
  assert.deepEqual(defects, []);
});

test("allows generic Council motion reporting when mover identity is unknown", () => {
  const defects = unsupportedNamedMotionAttributions({
    text: "Council approved the Georgian College funding agreement.",
    sourceExcerpt: "SPEAKER_251: I move the motion. The motion is carried.",
  });
  assert.deepEqual(defects, []);
});

test("publish artifact verification blocks an unsupported named mover", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "motion-attribution-"));
  const summaryPath = path.join(dir, "summary.pya");
  const groundingPath = path.join(dir, "grounding.pya");
  writePyaMapArtifact(summaryPath, "agenda summary artifact", {
    sections: [{
      "unit id": "ground_001",
      summary: "Councillor Kukreja moved the funding motion.",
      chapters: [],
    }],
  });
  writePyaMapArtifact(groundingPath, "agenda section grounding artifact", {
    "grounded units": [{
      "unit id": "ground_001",
      "source excerpt": "SPEAKER_251: I move the motion.\nSPEAKER_009: Councillor Kukreja.\nSPEAKER_009: I declare a conflict of interest.",
    }],
  });
  const result = verifyAgendaMotionAttributions({
    agendaSummaryPyaPath: summaryPath,
    sectionGroundingPyaPath: groundingPath,
  });
  assert.equal(result.ok, false);
  assert.equal(result.defects[0].field, "summary");
});

test("stage3 varies motion-attribution retries and includes the rejected prose", async (t) => {
  let calls = 0;
  const prompts = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const request = JSON.parse(options.body);
    prompts.push(request.messages[1].content);
    const generated = calls < 4
      ? {
          summary: "Councillor Carlton moved, seconded the recommendation.",
          "chapter text": "Councillor Carlton moved the recommendation",
          confidence: 0.9,
          notes: "",
        }
      : {
          summary: "Council adopted the recommendation after discussion.",
          "chapter text": "Recommendation adopted",
          confidence: 0.9,
          notes: "",
        };
    return { ok: true, async json() { return { message: { content: JSON.stringify(generated) } }; } };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_motion",
      label: "Staff recommendation",
      "source excerpt": "The recommendation was discussed. The motion was carried.",
      "source words": 9,
      "source rows": 2,
      substantive: true,
    },
    focus: "",
    llmModel: "qwen3.5:9b",
    ollamaUrl: "http://ollama.invalid/api/chat",
  });

  assert.equal(calls, 4);
  assert.equal(result.summary, "Council adopted the recommendation after discussion.");
  assert.match(prompts[2], /Rejected JSON/u);
  assert.match(prompts[3], /Delete the unsupported actor name/u);
});

test("stage3 starts fresh without personal names after repeated attribution defects", async (t) => {
  let calls = 0;
  const prompts = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    prompts.push(JSON.parse(options.body).messages[1].content);
    const generated = calls < 5
      ? {
          summary: "Councillor Carlton moved, seconded the recommendation.",
          "chapter text": "Councillor Carlton moved the recommendation",
          confidence: 0.9,
          notes: "",
        }
      : {
          summary: "The committee adopted the recommendation after discussion.",
          "chapter text": "Committee adopts the recommendation",
          confidence: 0.9,
          notes: "",
        };
    return { ok: true, async json() { return { message: { content: JSON.stringify(generated) } }; } };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_motion_fresh",
      label: "Staff recommendation",
      "source excerpt": "The recommendation was discussed. The motion was carried.",
      "source words": 9,
      "source rows": 2,
      substantive: true,
    },
    focus: "",
    llmModel: "qwen3.5:9b",
    ollamaUrl: "http://ollama.invalid/api/chat",
  });

  assert.equal(calls, 5);
  assert.equal(result.summary, "The committee adopted the recommendation after discussion.");
  assert.match(prompts[4], /Start over from the grounded source/u);
  assert.match(prompts[4], /Do not write any personal name/u);
  assert.match(prompts[4], /Councillor Carlton/u);
});

test("stage3 removes an unsupported mover reintroduced by downstream numeric repair", async (t) => {
  let calls = 0;
  const prompts = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const prompt = JSON.parse(options.body).messages[1].content;
    prompts.push(prompt);
    let generated;
    if (calls === 1) {
      generated = { summary: "Council approved twenty-one homes.", "chapter text": "Twenty-one homes approved", confidence: 0.9, notes: "" };
    } else if (/downstream repair reintroduced/u.test(prompt)) {
      generated = { summary: "The committee approved the housing recommendation.", "chapter text": "Committee approves housing recommendation", confidence: 0.9, notes: "" };
    } else {
      generated = { summary: "Councillor Carlton moved the housing recommendation.", "chapter text": "Councillor Carlton moved the recommendation", "numeric valid": true };
    }
    return { ok: true, async json() { return { message: { content: JSON.stringify(generated) } }; } };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_motion_after_numeric",
      label: "Housing recommendation",
      "source excerpt": "The committee considered housing. The motion was carried.",
      "source words": 9,
      "source rows": 2,
      substantive: true,
    },
    focus: "",
    llmModel: "qwen3.5:9b",
    ollamaUrl: "http://ollama.invalid/api/chat",
  });

  assert.equal(calls, 3);
  assert.equal(result.summary, "The committee approved the housing recommendation.");
  assert.match(prompts[2], /downstream repair reintroduced/u);
  assert.match(prompts[2], /Do not write any personal name/u);
});
