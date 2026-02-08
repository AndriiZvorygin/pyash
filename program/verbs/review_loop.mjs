import { remember, doRemember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";

async function resolveInterpret() {
  const mod = await import("../bridge/index.mjs");
  return mod.interpret;
}

async function resolveIsRefinery(name) {
  const mod = await import("../bridge/refinery.mjs");
  return Boolean(mod.getRefinery(name));
}

function resolveTextFromValue(value) {
  if (!value || typeof value !== "object") return "";
  if (typeof value.text === "string") return value.text;
  if (value.name) {
    const fact = remember(value.name);
    return String(fact?.ob?.text ?? "");
  }
  return "";
}

function resolveFactText(name) {
  const fact = remember(name);
  return String(fact?.ob?.text ?? "");
}

function extractLastNonEmptyLine(text) {
  const lines = String(text ?? "")
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(Boolean);
  return lines.length ? lines[lines.length - 1] : "";
}

function extractScore(line) {
  const matches = [...String(line ?? "").matchAll(/(?:^|[^0-9.])([01](?:\.\d+)?)(?![0-9.])/gu)];
  if (!matches.length) return null;
  const raw = matches[matches.length - 1][1];
  const score = Number(raw);
  if (!Number.isFinite(score)) return null;
  if (score < 0 || score > 1) return null;
  return score;
}

function parseVerdictFromLastLine(reviewText, threshold) {
  const lastLine = extractLastNonEmptyLine(reviewText);
  const upper = lastLine.toUpperCase();
  if (/^PASS\b/u.test(upper)) return { pass: true, score: 1, lastLine };
  if (/^FAIL\b/u.test(upper)) return { pass: false, score: 0, lastLine };
  const score = extractScore(lastLine);
  if (score !== null) {
    return { pass: score >= threshold, score, lastLine };
  }
  return { pass: false, score: null, lastLine };
}

function formatSeriesTranscript(seriesName) {
  if (!seriesName) return "";
  const fact = remember(seriesName);
  if (!fact || fact.be !== "series" || !Array.isArray(fact.ob?.series)) return "";
  return fact.ob.series
    .map((entry) => {
      const role = String(entry?.su?.name ?? entry?.role ?? "assistant").toUpperCase();
      const content = String(entry?.ob?.text ?? entry?.content ?? "");
      if (!content.trim()) return "";
      return `${role}: ${content}`;
    })
    .filter(Boolean)
    .join("\n");
}

async function invokeMind({ mindName, prompt, outputName, toolMapName }) {
  const interpret = await resolveInterpret();
  const call = {
    mood: "do",
    be: "write",
    for: { name: mindName },
    ob: { text: String(prompt ?? "") },
    to: { name: outputName, nameTypeWords: ["text"] }
  };
  // Tool-enabled write signatures currently omit explicit by/window.
  if (!toolMapName) call.by = { num: 0 };
  if (toolMapName) {
    call.with = { name: toolMapName, nameTypeWords: ["map"] };
  }
  await interpret(call);
  return resolveFactText(outputName);
}

async function invokeRefinery({ refineryName, prompt, outputName }) {
  const interpret = await resolveInterpret();
  await interpret({
    mood: "do",
    be: "refinery",
    from: { name: refineryName },
    ob: { text: String(prompt ?? "") },
    to: { name: outputName, nameTypeWords: ["text"] }
  });
  return resolveFactText(outputName);
}

async function invokeCeremony({ ceremonyName, prompt, outputName }) {
  const interpret = await resolveInterpret();
  await interpret({
    mood: "do",
    be: ceremonyName,
    ob: { text: String(prompt ?? "") },
    to: { name: outputName, nameTypeWords: ["text"] }
  });
  return resolveFactText(outputName);
}

function buildReviewerPrompt({ task, draft, transcript, threshold }) {
  const pieces = [
    "Review the candidate for factual grounding, constraint fit, and contradictions.",
    "Use the flow transcript to check whether claims match tool outputs and prior steps.",
    "Return concise reasoning, then put only PASS, FAIL, or a 0..1 confidence score on the last non-empty line.",
    `Pass threshold is ${threshold}.`,
    "",
    "TASK:",
    task,
    "",
    "CANDIDATE:",
    draft
  ];
  if (transcript) {
    pieces.push("", "FLOW TRANSCRIPT:", transcript);
  }
  return pieces.join("\n");
}

function buildRepairPrompt({ task, draft, reviewText }) {
  return [
    "Revise the candidate to fix all reviewer issues while preserving supported facts.",
    "Keep the result concise.",
    "",
    "TASK:",
    task,
    "",
    "PRIOR CANDIDATE:",
    draft,
    "",
    "REVIEW FEEDBACK:",
    reviewText
  ].join("\n");
}

export async function reviewLoop(sentence) {
  const task = resolveTextFromValue(sentence?.ob);
  const generatorName = sentence?.for?.name ?? null;
  const reviewerName = sentence?.by?.name ?? null;
  const toolMapName = sentence?.with?.name ?? (sentence?.with?.wo === "tools" ? "agent tools" : null);
  const outputName = sentence?.to?.name ?? null;
  const maxAttempts = Math.max(1, Math.trunc(Number(sentence?.atmost?.num ?? 3)));
  const threshold = Number.isFinite(Number(sentence?.atleast?.num))
    ? Number(sentence.atleast.num)
    : 0.8;

  if (!task) {
    throwErrorSentence({
      name: "review loop defective",
      message: "review loop defective: missing input text",
      from: { name: "review loop" },
      raw: { sentence }
    });
  }
  if (!generatorName) {
    throwErrorSentence({
      name: "review loop defective",
      message: "review loop defective: missing generator name",
      from: { name: "review loop" },
      raw: { sentence }
    });
  }
  if (!reviewerName) {
    throwErrorSentence({
      name: "review loop defective",
      message: "review loop defective: missing reviewer name",
      from: { name: "review loop" },
      raw: { sentence }
    });
  }

  const generatorFact = remember(generatorName);
  const reviewerFact = remember(reviewerName);
  const generatorIsMind = generatorFact?.be === "mind";
  const reviewerIsMind = reviewerFact?.be === "mind";
  const reviewerIsRefinery = !reviewerIsMind && await resolveIsRefinery(reviewerName);
  const generatorIsRefinery = !generatorIsMind && await resolveIsRefinery(generatorName);

  let latestPrompt = task;
  let finalDraft = "";
  let lastReviewText = "";
  let lastVerdict = { pass: false, score: null, lastLine: "" };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const draftName = `review loop draft ${attempt}`;
    if (generatorIsMind) {
      finalDraft = await invokeMind({
        mindName: generatorName,
        prompt: latestPrompt,
        outputName: draftName,
        toolMapName
      });
    } else if (generatorIsRefinery) {
      finalDraft = await invokeRefinery({
        refineryName: generatorName,
        prompt: latestPrompt,
        outputName: draftName
      });
    } else {
      finalDraft = await invokeCeremony({
        ceremonyName: generatorName,
        prompt: latestPrompt,
        outputName: draftName
      });
    }

    const flowSeriesName = generatorIsMind ? `${generatorName} story session` : "";
    const transcript = formatSeriesTranscript(flowSeriesName);
    const reviewPrompt = buildReviewerPrompt({
      task,
      draft: finalDraft,
      transcript,
      threshold
    });

    const reviewName = `review loop feedback ${attempt}`;
    if (reviewerIsMind) {
      lastReviewText = await invokeMind({
        mindName: reviewerName,
        prompt: reviewPrompt,
        outputName: reviewName,
        toolMapName
      });
    } else if (reviewerIsRefinery) {
      lastReviewText = await invokeRefinery({
        refineryName: reviewerName,
        prompt: reviewPrompt,
        outputName: reviewName
      });
    } else {
      lastReviewText = await invokeCeremony({
        ceremonyName: reviewerName,
        prompt: reviewPrompt,
        outputName: reviewName
      });
    }

    lastVerdict = parseVerdictFromLastLine(lastReviewText, threshold);
    if (lastVerdict.pass) break;

    latestPrompt = buildRepairPrompt({
      task,
      draft: finalDraft,
      reviewText: lastReviewText
    });
  }

  const resultText = finalDraft;
  if (outputName) {
    doRemember({
      mood: "ya",
      su: { name: outputName },
      ob: { text: resultText },
      be: "text"
    });
  }
  doRemember({
    mood: "ya",
    su: { name: "review loop verdict" },
    ob: {
      text: lastVerdict.lastLine || (lastVerdict.pass ? "PASS" : "FAIL")
    },
    be: "text"
  });
  if (typeof lastVerdict.score === "number") {
    doRemember({
      mood: "ya",
      su: { name: "review loop score" },
      ob: { num: lastVerdict.score },
      be: "number"
    });
  }

  return { ob: { text: resultText }, be: "text" };
}

const OB_TYPES = [
  ["text"],
  ["name", "text"]
];

const ROLE_TYPES = [
  ["name", "mind"],
  ["text"]
];

const WITH_TYPES = [
  null,
  ["name", "map"],
  ["wo", "tools"]
];

function buildReviewSignature({ obType, forType, byType, withType, includeLimits }) {
  const words = ["be", "review", "loop"];
  // Signatures are sorted by case key: atleast, atmost, by, for, ob, to, with
  if (includeLimits) words.push("atleast", "num", "atmost", "num");
  words.push("by", ...byType);
  words.push("for", ...forType);
  words.push("ob", ...obType);
  words.push("to", "name", "text");
  if (withType) words.push("with", ...withType);
  return words;
}

const signatureSet = new Set();
const signatureEntries = [];

for (const obType of OB_TYPES) {
  for (const forType of ROLE_TYPES) {
    for (const byType of ROLE_TYPES) {
      for (const withType of WITH_TYPES) {
        for (const includeLimits of [false, true]) {
          const words = buildReviewSignature({ obType, forType, byType, withType, includeLimits });
          const key = words.join(" ");
          if (signatureSet.has(key)) continue;
          signatureSet.add(key);
          signatureEntries.push({ signatureWords: words, handler: reviewLoop });
        }
      }
    }
  }
}

export const signatures = signatureEntries;

export default reviewLoop;
