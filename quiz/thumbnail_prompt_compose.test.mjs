import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function runCompose(lines, env = {}) {
  const input = `${lines.join("\n")}\n`;
  return spawnSync("node", ["command/thumbnail_prompt_compose.mjs"], {
    input,
    encoding: "utf8",
    env: { ...process.env, ...env }
  });
}

function runComposeWithArgs(lines, args = [], env = {}) {
  const input = `${lines.join("\n")}\n`;
  return spawnSync("node", ["command/thumbnail_prompt_compose.mjs", ...args], {
    input,
    encoding: "utf8",
    env: { ...process.env, ...env }
  });
}

function assertNoNegationLanguage(text) {
  assert.doesNotMatch(text, /\bno\s+/i);
  assert.doesNotMatch(text, /\bwithout\s+/i);
  assert.doesNotMatch(text, /\bavoid\s+/i);
}

function extractHookSubject(prompt) {
  return String(prompt || "").split(";")[0].trim();
}

function extractFraming(prompt) {
  return String(prompt || "").split(";")[2]?.trim() || "";
}

function extractClaritySection(prompt) {
  return String(prompt || "").trim().replace(/\.$/, "").split(";").at(-1)?.trim() || "";
}

function countOccurrences(text, needle) {
  return (String(text).match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
}

const ANCHOR_PHRASES = [
  "budget report with highlighted deficit numbers",
  "grocery receipt with circled total",
  "utility bill with red overdue stamp",
  "rent notice with bold amount due",
  "rising price chart with red upward arrow",
  "zoning map with highlighted parcel",
  "policy binder with marked page",
  "podium with municipal crest",
  "council agenda sheet with highlighted motion",
  "two people facing each other across table",
  "finger pointed at document",
  "tense side-profile confrontation",
  "opposing gestures over map or contract",
  "red upward arrow",
  "circled total",
  "highlighted overdue stamp",
  "line items marked in red",
  "tense confrontation posture",
  "opposing hand gestures",
  "simple structured diagram",
  "node and connection pattern",
  "layered circular structure",
  "expanding connected units",
  "minimal system map"
];

function anchorCount(hookSubject) {
  const lower = hookSubject.toLowerCase();
  return ANCHOR_PHRASES.filter((phrase) => lower.includes(phrase.toLowerCase())).length;
}

const SYSTEM_ANCHOR_PHRASES = [
  "simple structured diagram",
  "node and connection pattern",
  "layered circular structure",
  "expanding connected units",
  "minimal system map"
];

function systemAnchorCount(hookSubject) {
  const lower = String(hookSubject || "").toLowerCase();
  return SYSTEM_ANCHOR_PHRASES.filter((phrase) => lower.includes(phrase.toLowerCase())).length;
}

function baseSchema(overrides = {}) {
  return {
    HOOK_SUBJECT: "concerned person holding folder",
    EMOTION: "urgent worried expression",
    FRAMING: "close-up 16:9, text on left",
    BACKGROUND: "simple blurred interior",
    OVERLAY_TEXT: "Bills Keep Rising",
    COLOUR_CONTRAST: "high contrast warm skin against cool blue shadows",
    STYLE: "editorial illustration with clean silhouette",
    CLARITY_RULES: "single focal subject, mobile-first readability",
    NEGATIVE_PROMPT: "no clutter, no tiny text, no watermark",
    ...overrides
  };
}

function toLines(schema) {
  return Object.keys(schema).map((key) => `${key}: ${schema[key]}`);
}

test("thumbnail prompt compose enforces overlay text bounds", () => {
  const run = runCompose(toLines(baseSchema({ OVERLAY_TEXT: "Alert!!!" })));
  assert.equal(run.status, 0, run.stderr || "overlay repair should pass");
  assert.match(run.stdout, /overlay text "ALERT NOW"/);
});

test("same input is deterministic", () => {
  const lines = toLines(baseSchema({ OVERLAY_TEXT: "Budget Cuts Hit Hard" }));
  const first = runCompose(lines);
  const second = runCompose(lines);
  assert.equal(first.status, 0, first.stderr || "first run should pass");
  assert.equal(second.status, 0, second.stderr || "second run should pass");
  assert.equal(String(first.stdout), String(second.stdout));
});

test("economic overlay injects financial visual cue", () => {
  const run = runCompose(toLines(baseSchema({ OVERLAY_TEXT: "Costs Climbing Fast" })));
  assert.equal(run.status, 0, run.stderr || "economic alignment should pass");
  const out = String(run.stdout || "");
  assert.match(out, /budget report|grocery receipt|utility bill|rent notice|rising price chart/i);
});

test("different economic keywords can select different anchors", () => {
  const one = runCompose(toLines(baseSchema({ OVERLAY_TEXT: "Budget Cuts Hit Hard" })));
  const two = runCompose(toLines(baseSchema({ OVERLAY_TEXT: "Rent Costs Climbing" })));
  assert.equal(one.status, 0, one.stderr || "first economic run should pass");
  assert.equal(two.status, 0, two.stderr || "second economic run should pass");
  const hookOne = extractHookSubject(String(one.stdout || ""));
  const hookTwo = extractHookSubject(String(two.stdout || ""));
  assert.notEqual(hookOne, hookTwo);
});

test("abstract systems topic selects systems-pattern anchor", () => {
  const run = runCompose(toLines(baseSchema({
    OVERLAY_TEXT: "SYSTEM SCALE PATTERN",
    HOOK_SUBJECT: "focused person considering coordination structure",
    BACKGROUND: "minimal layered environment"
  })));
  assert.equal(run.status, 0, run.stderr || "systems run should pass");
  const hook = extractHookSubject(String(run.stdout || ""));
  assert.ok(systemAnchorCount(hook) >= 1, "expected systems anchor in hook subject");
});

test("non-economic systems topic avoids chart/trend anchors", () => {
  const run = runCompose(toLines(baseSchema({
    OVERLAY_TEXT: "COORDINATION TRANSFORMATION PATTERN",
    HOOK_SUBJECT: "person with reflective expression",
    BACKGROUND: "simple symbolic setting"
  })));
  assert.equal(run.status, 0, run.stderr || "non-economic systems run should pass");
  const hook = extractHookSubject(String(run.stdout || ""));
  assert.doesNotMatch(hook, /chart|graph|trend line|price|budget|receipt/i);
});

test("systems anchors remain simple with one dominant structure", () => {
  const run = runCompose(toLines(baseSchema({
    OVERLAY_TEXT: "SCALE NETWORK EVOLUTION",
    HOOK_SUBJECT: "single person in contemplation",
    BACKGROUND: "minimal abstract structure"
  })));
  assert.equal(run.status, 0, run.stderr || "systems simplicity run should pass");
  const hook = extractHookSubject(String(run.stdout || ""));
  assert.ok(systemAnchorCount(hook) <= 1, "expected one dominant systems anchor");
});

test("two-subject mode uses plural framing language only", () => {
  const run = runCompose(toLines(baseSchema({
    OVERLAY_TEXT: "Zoning Showdown Tonight",
    HOOK_SUBJECT: "mayor at podium"
  })));
  assert.equal(run.status, 0, run.stderr || "conflict run should pass");
  const framing = extractFraming(String(run.stdout || ""));
  assert.match(framing, /two subjects fill substantial frame/);
  assert.match(framing, /subjects positioned (left|right) of center/);
  assert.doesNotMatch(framing, /subject on (left|right)/);
});

test("subject anchor count is bounded to primary plus optional secondary", () => {
  const run = runCompose(toLines(baseSchema({ OVERLAY_TEXT: "Budget Cuts And Costs Climbing Fast" })));
  assert.equal(run.status, 0, run.stderr || "anchor bound run should pass");
  const hook = extractHookSubject(String(run.stdout || ""));
  assert.ok(anchorCount(hook) <= 2, `expected at most 2 anchor phrases, got ${anchorCount(hook)} in: ${hook}`);
});

test("clarity dedupe keeps strongest variants", () => {
  const run = runCompose(toLines(baseSchema({
    CLARITY_RULES: "clean composition, minimal background, minimal background detail, large readable text only, large bold readable text only, single clear subject, single clear subject, sharp focus",
    NEGATIVE_PROMPT: "no clutter, no tiny text, no blur"
  })));
  assert.equal(run.status, 0, run.stderr || "dedupe run should pass");
  const clarity = extractClaritySection(String(run.stdout || ""));
  assert.equal(countOccurrences(clarity, "clean composition"), 1);
  assert.equal(countOccurrences(clarity, "large bold readable text only"), 1);
  assert.equal(countOccurrences(clarity, "single clear subject"), 1);
  assert.equal(countOccurrences(clarity, "sharp subject focus"), 1);
});

test("clarity remains bounded", () => {
  const run = runCompose(toLines(baseSchema({
    CLARITY_RULES: "mobile-first readability, single focal subject, clean composition, minimal background, minimal background detail, large readable text only, large bold readable text only, sharp focus, high clarity edges, strong subject-background separation, high contrast lighting, white sclera and defined irises for visible faces, extra detail one, extra detail two"
  })));
  assert.equal(run.status, 0, run.stderr || "bounded clarity run should pass");
  const clarity = extractClaritySection(String(run.stdout || ""));
  const commaParts = clarity.split(",").map((part) => part.trim()).filter(Boolean);
  assert.ok(commaParts.length <= 10, `expected bounded clarity tokens, got ${commaParts.length}`);
});

test("output contains zero negation tokens", () => {
  const run = runCompose(toLines(baseSchema()));
  assert.equal(run.status, 0, run.stderr || "base output should pass");
  const out = String(run.stdout || "").trim();
  assertNoNegationLanguage(out);
});

test("verbose mode can emit debug artifact", () => {
  const run = runCompose(toLines(baseSchema()), {
    PYA_RUN_VERBOSE: "1",
    PYA_RUN_ID: "thumb-compose-test"
  });
  assert.equal(run.status, 0, run.stderr || "verbose run should pass");
});

test("multi-variant mode emits three labeled variant prompts", () => {
  const run = runComposeWithArgs(toLines(baseSchema({ OVERLAY_TEXT: "Budget Cuts Hit Hard" })), ["--multi-variants"]);
  assert.equal(run.status, 0, run.stderr || "multi-variant run should pass");
  const out = String(run.stdout || "").trim();
  const lines = out.split(/\n/).map((x) => x.trim()).filter(Boolean);
  assert.equal(lines.length, 3, "expected exactly three variants");
  assert.match(lines[0], /^Variant A \(face-driven\): /);
  assert.match(lines[1], /^Variant B \(scene-driven\): /);
  assert.match(lines[2], /^Variant C \(symbol-driven\): /);
});

test("multi-variant mode uses distinct overlay text and anchor types", () => {
  const run = runComposeWithArgs(toLines(baseSchema({ OVERLAY_TEXT: "Costs Climbing Fast" })), ["--variants=3"]);
  assert.equal(run.status, 0, run.stderr || "multi-variant distinctness run should pass");
  const lines = String(run.stdout || "").trim().split(/\n/).map((x) => x.trim()).filter(Boolean);
  const overlays = lines.map((line) => {
    const m = line.match(/overlay text "([^"]+)"/i);
    return m ? m[1] : "";
  });
  assert.equal(new Set(overlays).size, 3, "expected unique overlay text per variant");

  const subjects = lines.map((line) => extractHookSubject(line.replace(/^Variant [ABC] \([^)]*\):\s*/, "")));
  const anchorKinds = subjects.map((subject) => {
    if (/budget report|grocery receipt|utility bill|rent notice|price chart/i.test(subject)) return "economic";
    if (/simple structured diagram|node and connection pattern|layered circular structure|expanding connected units|minimal system map/i.test(subject)) return "systems";
    if (/zoning map|policy binder|podium|council agenda/i.test(subject)) return "political";
    if (/facing each other|confrontation|opposing gestures|finger pointed/i.test(subject)) return "conflict";
    return "generic";
  });
  assert.ok(anchorKinds.includes("systems"), "expected conceptual variant to use systems anchor");
  assert.ok(new Set(anchorKinds).size >= 2, "expected at least two anchor types across variants");
});

test("single mode remains default when no variant flag is provided", () => {
  const run = runCompose(toLines(baseSchema({ OVERLAY_TEXT: "Budget Cuts Hit Hard" })));
  assert.equal(run.status, 0, run.stderr || "single mode run should pass");
  const out = String(run.stdout || "").trim();
  assert.doesNotMatch(out, /^Variant A \(face-driven\): /m);
  assert.equal(out.split(/\n/).filter(Boolean).length, 1, "expected single-line output in default mode");
});

test("variant label env selects single variant prompt from variant generator", () => {
  const run = runCompose(toLines(baseSchema({ OVERLAY_TEXT: "Budget Cuts Hit Hard" })), {
    THUMBNAIL_VARIANT_MODE: "triple",
    THUMBNAIL_VARIANT_LABEL: "C"
  });
  assert.equal(run.status, 0, run.stderr || "variant label env run should pass");
  const out = String(run.stdout || "").trim();
  assert.doesNotMatch(out, /^Variant [ABC]/m);
  assert.match(out, /simple structured diagram|node and connection pattern|layered circular structure|expanding connected units|minimal system map/i);
});

test("variant label cli selects one variant prompt", () => {
  const run = runComposeWithArgs(toLines(baseSchema({ OVERLAY_TEXT: "Costs Climbing Fast" })), ["--variant-label", "B"]);
  assert.equal(run.status, 0, run.stderr || "variant label cli run should pass");
  const out = String(run.stdout || "").trim();
  assert.doesNotMatch(out, /^Variant [ABC]/m);
  assert.match(out, /WHAT NEXT|OPEN LOOP/i);
});

test("multi-variant mode enforces hard composition divergence", () => {
  const run = runComposeWithArgs(toLines(baseSchema({ OVERLAY_TEXT: "Costs Climbing Fast" })), ["--multi-variants"]);
  assert.equal(run.status, 0, run.stderr || "hard divergence run should pass");

  const lines = String(run.stdout || "").trim().split(/\n/).map((x) => x.trim()).filter(Boolean);
  assert.equal(lines.length, 3);

  const prompts = lines.map((line) => line.replace(/^Variant [ABC] \([^)]*\):\s*/, ""));
  const framingA = extractFraming(prompts[0]).toLowerCase();
  const framingB = extractFraming(prompts[1]).toLowerCase();
  const framingC = extractFraming(prompts[2]).toLowerCase();

  assert.match(framingA, /close-up face dominates frame|centered face dominates frame/);
  assert.doesNotMatch(framingA, /medium-wide|environment dominant/);

  assert.match(framingB, /medium-wide|environment dominant/);
  assert.doesNotMatch(framingB, /close-up face dominates frame|centered face dominates frame/);

  assert.match(framingC, /symbolic layout|symmetric symbolic|diagrammatic/);
  assert.doesNotMatch(framingC, /medium-wide|environment dominant|close-up face dominates frame/);
});

test("multi-variant mode enforces anchor category divergence", () => {
  const run = runComposeWithArgs(toLines(baseSchema({ OVERLAY_TEXT: "Budget Cuts Hit Hard" })), ["--multi-variants"]);
  assert.equal(run.status, 0, run.stderr || "anchor divergence run should pass");

  const lines = String(run.stdout || "").trim().split(/\n/).map((x) => x.trim()).filter(Boolean);
  const prompts = lines.map((line) => line.replace(/^Variant [ABC] \([^)]*\):\s*/, ""));
  const hooks = prompts.map((p) => extractHookSubject(p).toLowerCase());

  assert.match(hooks[0], /face|sclera|irises|portrait/);
  assert.match(hooks[1], /budget report|grocery receipt|utility bill|rent notice|price chart|zoning map|policy binder|council agenda|podium|document|contract/);
  assert.match(hooks[2], /simple structured diagram|node and connection pattern|layered circular structure|expanding connected units|minimal system map|centered symbolic structure/);
});
