import assert from "node:assert/strict";
import test from "node:test";
import { renderAgendaPreviewToc } from "../program/library/reporter_shared/agenda-preview-toc.mjs";

test("agenda preview TOC nests child summaries without repeating the agenda code and title", () => {
  const html = renderAgendaPreviewToc({
    utilityRows: [{ href: "#summary", label: "Summary" }],
    sections: [{
      id: "section-6",
      heading: "6.f Planning Report",
      subsections: [
        { id: "section-6-child-1", title: "Planning justification" },
        { id: "section-6-child-2", title: "Employment capacity" },
      ],
    }],
  });
  assert.match(html, /<li><a href="#section-6">6\.f Planning Report<\/a><ol class="toc-children">/u);
  assert.match(html, /href="#section-6-child-1">Planning justification<\/a>/u);
  assert.doesNotMatch(html, />6\.f Planning Report: Planning justification</u);
  assert.equal((html.match(/>6\.f /gu) || []).length, 1);
});

