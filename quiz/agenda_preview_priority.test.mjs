import assert from "node:assert/strict";
import test from "node:test";
import { agendaPreviewPriorityAdjustment } from "../program/library/reporter_shared/agenda-preview-priority.mjs";

test("delegations and actionable business outrank routine correspondence", () => {
  const delegation = agendaPreviewPriorityAdjustment({ title: "Delegation from the Regional Health Team" });
  const report = agendaPreviewPriorityAdjustment({ title: "Staff Report: Capital Tender Award", summary: "Council will be asked to authorize the purchase." });
  const correspondence = agendaPreviewPriorityAdjustment({ title: "Correspondence provided for information", summary: "The letter will be received and filed." });
  const ministerLetter = agendaPreviewPriorityAdjustment({ title: "Letter from the Minister provided for information" });
  assert.ok(delegation > correspondence);
  assert.ok(report > correspondence);
  assert.ok(correspondence <= -40);
  assert.ok(ministerLetter < 0);
});

test("actionable correspondence remains less prominent than a substantive delegation", () => {
  const actionable = agendaPreviewPriorityAdjustment({ title: "Correspondence requesting Council endorsement of a resolution" });
  const delegation = agendaPreviewPriorityAdjustment({ title: "Deputation and presentation on housing" });
  assert.ok(actionable < delegation);
  assert.ok(actionable > -34);
});
