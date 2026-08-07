import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  numericAuditSourceExcerpt,
  repairNumericFidelityLlm,
  repairUnsupportedNumericClaimsLlm,
  rewriteWithoutNumericClaimsLlm,
  stage3GenerationOrder,
  summarizeGroundedUnit,
} from "../program/library/reporter_shared/agenda-stage3-summary-renderer.mjs";

test("stage3 can ask qwen for grounded prose with no numeric claims", async (t) => {
  let requestBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          message: {
            content: JSON.stringify({
              summary: "Council returned to open session and reported that no direction was provided.",
              "chapter text": "Return to open session",
            }),
          },
        };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await rewriteWithoutNumericClaimsLlm({
    summary: "Council returned at nine seventeen.",
    chapterText: "Nine seventeen return",
    sourceExcerpt: "Council returned to open session and reported that no direction was provided.",
    ollamaUrl: "http://ollama.invalid/api/chat",
  });

  assert.equal(result.summary, "Council returned to open session and reported that no direction was provided.");
  assert.equal(requestBody.model, "qwen3.5:9b");
  assert.match(requestBody.messages[1].content, /Do not write any digits/u);
});

test("stage3 varies qualitative retries instead of repeating a failed numeric prompt", async (t) => {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const request = JSON.parse(options.body);
    const prompt = request.messages[1].content;
    if (calls === 3) {
      assert.match(prompt, /Correction attempt 3 of 6/u);
      assert.match(prompt, /Start both fields over as fresh qualitative civic prose/u);
      assert.match(prompt, /GROUNDED_SOURCE: The committee discussed a countywide library service review/u);
      assert.doesNotMatch(prompt, /PRIOR_SUMMARY:/u);
    }
    const content = calls < 3
      ? {
          summary: "The review compared seven six million with three million in library spending.",
          "chapter text": "Seven six million library comparison",
        }
      : {
          summary: "The committee supported a review of countywide library services after discussing differing municipal costs and service models.",
          "chapter text": "Countywide library service review",
        };
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(content) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await rewriteWithoutNumericClaimsLlm({
    summary: "The review compared seven six million with three million in library spending.",
    chapterText: "Seven six million library comparison",
    sourceExcerpt: "The committee discussed a countywide library service review.",
    ollamaUrl: "http://ollama.invalid/api/chat",
  });

  assert.equal(calls, 3);
  assert.match(result.summary, /supported a review of countywide library services/u);
  assert.doesNotMatch(`${result.summary} ${result.chapterText}`, /\d/u);
});

test("Owen Stage 3 delegates availability retries to the model-specific renderer", () => {
  const source = fs.readFileSync(
    new URL("../world/house/owen-sound-reporter/program/summarize-agenda-wise-sections-from-transcript-folder.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /\/api\/tags/u);
  assert.match(source, /runAgendaStage3SummaryRenderer/u);
});

test("stage3 duplication repairs retain sibling summaries as grounding context", () => {
  const source = fs.readFileSync(
    new URL("../program/library/reporter_shared/agenda-stage3-summary-renderer.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /siblingSummaries:\s*chapterSiblingContext\(existingChapters,\s*ci\)/u);
  assert.doesNotMatch(source, /siblingSummaries:\s*auditNote\s*\?\s*\[\]/u);
});

test("stage3 generates compact units first while retaining canonical indexes", () => {
  const units = [
    { "source chars": 30000 },
    { "source chars": 700 },
    { "source chars": 12000 },
  ];
  assert.deepEqual(stage3GenerationOrder(units).map((entry) => entry.index), [1, 2, 0]);
});

test("stage3 sentence budgets do not split at the abbreviation By-law No.", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        message: {
          content: JSON.stringify({
            summary: "Council considers By-law No. 2026-097 to establish the reserve as a public highway.",
            "chapter text": "Public highway reserve",
            confidence: 0.9,
            notes: "",
          }),
        },
      };
    },
  });
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_bylaw",
      label: "By-law No. 2026-097",
      "source excerpt": "By-law No. 2026-097 would establish the reserve as a public highway.",
      "source rows": 2,
      "duration seconds": 45,
      substantive: true,
    },
    focus: "",
    llmModel: "qwen3.5:9b",
    ollamaUrl: "http://ollama.invalid/api/chat",
  });

  assert.equal(
    result.summary,
    "Council considers By-law No. 2026-097 to establish the reserve as a public highway.",
  );
});

test("stage3 retries when sentence cleanup rejects an incomplete summary", async (t) => {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls += 1;
    const summary = calls === 1
      ? "Staff reported development activity across the city"
      : "Staff reported development activity across the city.";
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify({ summary, "chapter text": "Development update", confidence: 0.9, notes: "" }) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_006",
      label: "Annual Development Update",
      "source excerpt": "Staff reported development activity across the city.",
      "source word count": 7,
      "source row count": 1,
      substantive: true,
    },
    focus: "",
    llmModel: "qwen3.5:9b",
    ollamaUrl: "http://ollama.invalid/api/chat",
  });
  assert.equal(result.summary, "Staff reported development activity across the city.");
  assert.equal(calls, 2);
});

test("stage3 survives a sustained transient Ollama transport outage", async (t) => {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  const originalRetryDelay = process.env.AGENDA_STAGE3_OLLAMA_RETRY_DELAY_MS;
  process.env.AGENDA_STAGE3_OLLAMA_RETRY_DELAY_MS = "1";
  globalThis.fetch = async () => {
    calls += 1;
    if (calls <= 5) throw new Error("fetch failed");
    return {
      ok: true,
      async json() {
        return {
          message: {
            content: JSON.stringify({
              summary: "Council received the grounded staff report.",
              "chapter text": "Staff report",
              confidence: 0.9,
              notes: "",
            }),
          },
        };
      },
    };
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalRetryDelay === undefined) delete process.env.AGENDA_STAGE3_OLLAMA_RETRY_DELAY_MS;
    else process.env.AGENDA_STAGE3_OLLAMA_RETRY_DELAY_MS = originalRetryDelay;
  });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_outage",
      label: "Staff Report",
      "source excerpt": "Council received the grounded staff report.",
      "source word count": 7,
      "source row count": 1,
      substantive: true,
    },
    focus: "",
    llmModel: "qwen3.5:9b",
    ollamaUrl: "http://ollama.invalid/api/chat",
  });

  assert.equal(result.summary, "Council received the grounded staff report.");
  assert.equal(calls, 6);
});

test("stage3 uses a qwen prose rewrite when ordinary retries remain fragments", async (t) => {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const request = JSON.parse(options.body);
    const isRewrite = request.messages[0].content.includes("rewrite generated civic-report fragments");
    const summary = isRewrite
      ? "Staff reported strong residential and commercial development activity."
      : "strong residential commercial development activity";
    return { ok: true, async json() {
      return { message: { content: JSON.stringify({ summary, "chapter text": "Development update", confidence: 0.9, notes: "" }) } };
    } };
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const result = await summarizeGroundedUnit({
    unit: { "unit id": "ground_006", label: "Annual Development Update", "source excerpt": "Residential and commercial development remained strong.", "source chars": 56, substantive: true },
    focus: "unusual bits",
    llmModel: "qwen3.5:9b",
    ollamaUrl: "http://ollama.invalid/api/chat",
  });
  assert.equal(result.summary, "Staff reported strong residential and commercial development activity.");
  assert.equal(calls, 3);
});

test("stage3 skips numeric audit when generated prose makes no numeric claim", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("numeric audit should not run"); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const result = await repairNumericFidelityLlm({
    summary: "Council discussed the committee structure and approved the recommendation.",
    chapterText: "Committee structure review",
    sourceExcerpt: "A long grounded transcript with unrelated numbers such as 2025.",
    ollamaUrl: "http://ollama.invalid/api/chat",
  });
  assert.match(result.summary, /approved the recommendation/u);
});

test("stage3 uses qwen to remove an unsupported numeric claim without a prose fallback", async (t) => {
  let requestBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          message: {
            content: JSON.stringify({
              summary: "Staff recommends funding the infrastructure work from the capital reserve.",
              "chapter text": "Infrastructure funding",
            }),
          },
        };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await repairUnsupportedNumericClaimsLlm({
    summary: "Staff recommends a $475,000 allocation for the infrastructure work.",
    chapterText: "$475,000 infrastructure allocation",
    sourceExcerpt: "Staff recommends funding the infrastructure work from the capital reserve.",
    unsupportedTokens: ["475000"],
    ollamaUrl: "http://ollama.invalid/api/chat",
  });

  assert.equal(result.unsupportedTokens.length, 0);
  assert.doesNotMatch(result.summary, /475/u);
  assert.equal(requestBody.model, "qwen3.5:9b");
  assert.match(requestBody.messages[1].content, /Otherwise omit the unsupported quantity/u);
});

test("stage3 numeric repair never exposes transcript speaker ids as grounded facts", async (t) => {
  let requestBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          message: {
            content: JSON.stringify({
              summary: "The committee received the development update.",
              "chapter text": "Development update",
            }),
          },
        };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await repairUnsupportedNumericClaimsLlm({
    summary: "Speaker 072 presented the development update.",
    chapterText: "Speaker 072 development update",
    sourceExcerpt: "SPEAKER_072: The committee received the development update.",
    unsupportedTokens: ["072"],
    ollamaUrl: "http://ollama.invalid/api/chat",
  });

  assert.equal(result.unsupportedTokens.length, 0);
  assert.doesNotMatch(requestBody.messages[1].content, /GROUNDED_SOURCE: SPEAKER_072/u);
  assert.match(requestBody.messages[1].content, /speaker identifiers are internal metadata/u);
});

test("stage3 asks qwen for a qualitative rewrite when numeric correction invents another amount", async (t) => {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const request = JSON.parse(options.body);
    if (calls === 2) {
      assert.match(request.messages[1].content, /without any numeric claims/u);
    }
    const summary = calls === 1
      ? "Staff recommends a $425,796 capital allocation."
      : "Staff recommends funding the work from the capital reserve.";
    return {
      ok: true,
      async json() {
        return {
          message: {
            content: JSON.stringify({
              summary,
              "chapter text": calls === 1 ? "$425,796 capital allocation" : "Capital reserve funding",
            }),
          },
        };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await repairUnsupportedNumericClaimsLlm({
    summary: "Staff recommends a $475,000 capital allocation.",
    chapterText: "$475,000 capital allocation",
    sourceExcerpt: "Staff recommends funding the work from the capital reserve.",
    unsupportedTokens: ["475000"],
    ollamaUrl: "http://ollama.invalid/api/chat",
  });

  assert.equal(calls, 2);
  assert.equal(result.unsupportedTokens.length, 0);
  assert.doesNotMatch(`${result.summary} ${result.chapterText}`, /\d/u);
});

test("stage3 does not treat the ordinary word one as malformed numeric notation", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("numeric audit should not run"); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const result = await repairNumericFidelityLlm({
    summary: "Council said the framework was one of several options considered and included one-time funding.",
    chapterText: "One of several options",
    sourceExcerpt: "The framework was one of several options considered and included one-time funding.",
    ollamaUrl: "http://ollama.invalid/api/chat",
  });
  assert.equal(result.summary, "Council said the framework was one of several options considered and included one-time funding.");
  assert.equal(result.chapterText, "One of several options");
});

test("stage3 uses qwen to remove ambiguous spoken clock notation after exact repair retries", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const isFinalRewrite = request.messages[0].content.includes("resolve malformed numeric notation");
    return {
      ok: true,
      async json() {
        return {
          message: {
            content: JSON.stringify(isFinalRewrite
              ? {
                  summary: "Council returned to open session after the closed-session discussion.",
                  "chapter text": "Return to open session",
                }
              : request.messages[0].content.includes("convert exact English numeric phrases")
                ? { replacements: [] }
                : {
                    summary: "Council returned at nine seventeen eighteen after the closed-session discussion.",
                    "chapter text": "Nine seventeen eighteen return",
                    "numeric valid": false,
                  }),
          },
        };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await repairNumericFidelityLlm({
    summary: "Council returned at nine seventeen eighteen after the closed-session discussion.",
    chapterText: "Nine seventeen eighteen return",
    sourceExcerpt: "It is nine seventeen, nine eighteen a.m., and Council is returning to the open session.",
    ollamaUrl: "http://ollama.invalid/api/chat",
  });

  assert.equal(result.summary, "Council returned to open session after the closed-session discussion.");
  assert.equal(result.chapterText, "Return to open session");
});

test("stage3 reapplies notation and grounding as one downstream contract", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const system = request.messages[0].content;
    let content;
    if (system.includes("Remove unsupported numeric claims")) {
      content = {
        summary: "Council returned to open session and reported no direction from the closed session.",
        "chapter text": "Return to open session",
      };
    } else if (system.includes("correct numeric notation")) {
      content = {
        summary: "Council returned to open session at 9:17 a.m. and reported no direction.",
        "chapter text": "91718 return to open session",
        "numeric valid": true,
      };
    } else if (system.includes("convert exact English numeric phrases")) {
      content = { replacements: [] };
    } else {
      content = {
        summary: "Council returned at nine seventeen eighteen and reported no direction.",
        "chapter text": "Nine seventeen eighteen return",
        confidence: 0.9,
        notes: "",
      };
    }
    return { ok: true, async json() {
      return { message: { content: JSON.stringify(content) } };
    } };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_clock",
      label: "Reporting Out of Closed Session",
      "source excerpt": [
        "It is nine seventeen, nine eighteen a.m., and Council is returning to open session.",
        "Council reported that no direction was provided during the closed session.",
      ].join(" "),
      "source word count": 25,
      "source row count": 2,
      substantive: true,
    },
    focus: "",
    llmModel: "qwen3.5:9b",
    ollamaUrl: "http://ollama.invalid/api/chat",
  });

  assert.equal(
    result.summary,
    "Council returned to open session and reported no direction from the closed session.",
  );
  assert.equal(result.chapterText, "Return to open session");
});

test("numeric audit grounding keeps numeric evidence and adjacent context", () => {
  const excerpt = numericAuditSourceExcerpt([
    "SPEAKER_001: Unrelated opening remarks.",
    "SPEAKER_002: Staff introduced the capital program.",
    "SPEAKER_003: The program includes 77 drainage projects.",
    "SPEAKER_004: Council asked how delivery would be tracked.",
    "SPEAKER_005: Unrelated closing remarks.",
  ].join("\n"));
  assert.match(excerpt, /capital program/u);
  assert.match(excerpt, /77 drainage projects/u);
  assert.match(excerpt, /delivery would be tracked/u);
  assert.doesNotMatch(excerpt, /Unrelated opening/u);
  assert.doesNotMatch(excerpt, /Unrelated closing/u);
});

test("stage3 uses qwen3.5:9b for focused numeric repair without replacing prose", async (t) => {
  let requestBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
        message: {
          content: JSON.stringify({
            summary: "Staff described about 77 drainage projects, work on 9th Avenue and 4th Avenue, and the unfinished 16th Avenue sewer.",
            "chapter text": "Capital project updates",
          }),
        },
        };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const result = await repairNumericFidelityLlm({
    summary: "Staff described about seventy-seven drainage projects, work on Ninth Avenue and Fourth Avenue, and the unfinished Sixteenth Avenue sewer.",
    chapterText: "Capital project updates",
    sourceExcerpt: "about seventy-seven individual drainage projects; Ninth Avenue; Fourth Avenue; 16th Avenue",
    ollamaUrl: "http://ollama.invalid/api/chat",
  });
  assert.match(result.summary, /77 drainage projects.*9th Avenue.*4th Avenue.*16th Avenue/u);
  assert.equal(requestBody.model, "qwen3.5:9b");
  assert.match(requestBody.messages[1].content, /Keep all non-numeric wording and sentence structure unchanged/u);
});

test("stage3 applies qwen numeric token mappings when prose retries repeat a defect", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const wantsMappings = request.messages[0].content.includes("exact English numeric phrases");
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(wantsMappings
          ? { replacements: [{ from: "seventy-seven", to: "77" }] }
          : { summary: "Staff tracked seventy-seven projects.", "chapter text": "Project update" }) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const result = await repairNumericFidelityLlm({
    summary: "Staff tracked seventy-seven projects.",
    chapterText: "Project update",
    sourceExcerpt: "Staff reported seventy-seven individual projects.",
    ollamaUrl: "http://ollama.invalid/api/chat",
  });
  assert.equal(result.summary, "Staff tracked 77 projects.");
});

test("stage3 requests omitted numeric mappings one phrase at a time", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const wantsMappings = request.messages[0].content.includes("exact English numeric phrases");
    if (!wantsMappings) {
      return {
        ok: true,
        async json() {
          return { message: { content: JSON.stringify({
            summary: "The plan provides seventy-seven supports and identifies twenty-three positions.",
            "chapter text": "Seventy-seven supports and twenty-three positions",
            "numeric valid": false,
          }) } };
        },
      };
    }
    const phrasesLine = request.messages[1].content.match(/PHRASES: (\[[^\n]+\])/u)?.[1] || "[]";
    const phrases = JSON.parse(phrasesLine);
    const replacements = phrases.length === 1
      ? [{ from: phrases[0], to: phrases[0].toLowerCase() === "seventy-seven" ? "77" : "23" }]
      : [];
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify({ replacements }) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const result = await repairNumericFidelityLlm({
    summary: "The plan provides seventy-seven supports and identifies twenty-three positions.",
    chapterText: "Seventy-seven supports and twenty-three positions",
    sourceExcerpt: "The plan provides seventy-seven supports and identifies twenty-three positions.",
    ollamaUrl: "http://ollama.invalid/api/chat",
  });
  assert.equal(result.summary, "The plan provides 77 supports and identifies 23 positions.");
  assert.equal(result.chapterText, "77 supports and 23 positions");
});
