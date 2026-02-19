import { remember, doRemember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";
import { resolveConfigMapNum, resolveConfigMapText } from "../configure/env.mjs";
import { emitSessionGold } from "../agent/gold.mjs";

async function resolveInterpret() {
  const mod = await import("../bridge/index.mjs");
  return mod.interpret;
}

async function resolveIsRefinery(name) {
  const mod = await import("../bridge/refinery.mjs");
  return Boolean(mod.getRefinery(name));
}

async function resolveRefineryTarget(name) {
  const mod = await import("../bridge/refinery.mjs");
  const fact = remember(name);
  const candidate =
    fact?.as?.name ??
    fact?.from?.name ??
    (fact?.be === "refinery" ? name : null) ??
    name;
  if (!candidate) return null;
  return mod.getRefinery(candidate) ? candidate : null;
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

function shellEscapeSingle(value) {
  return `'${String(value ?? "").replace(/'/gu, `'\"'\"'`)}'`;
}

function applyTemplate(template, values) {
  let out = String(template ?? "");
  for (const [key, value] of Object.entries(values ?? {})) {
    const token = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "gu");
    out = out.replace(token, String(value ?? ""));
  }
  return out;
}

function parseVerdictFromLastLine(verifyText, threshold) {
  const lastLine = extractLastNonEmptyLine(verifyText);
  const upper = lastLine.toUpperCase();
  if (/^PASS\b/u.test(upper)) return { pass: true, score: 1, lastLine };
  if (/^FAIL\b/u.test(upper)) return { pass: false, score: 0, lastLine };
  const score = extractScore(lastLine);
  if (score !== null) {
    return { pass: score >= threshold, score, lastLine };
  }
  return { pass: false, score: null, lastLine };
}

function seriesEntryCount(seriesName) {
  if (!seriesName) return 0;
  const fact = remember(seriesName);
  if (!fact || fact.be !== "series" || !Array.isArray(fact.ob?.series)) return 0;
  return fact.ob.series.length;
}

function formatSeriesTranscript(seriesName, { maxLines = 40, fromIndex = 0 } = {}) {
  if (!seriesName) return "";
  const fact = remember(seriesName);
  if (!fact || fact.be !== "series" || !Array.isArray(fact.ob?.series)) return "";
  const start = Math.max(0, Math.trunc(Number(fromIndex) || 0));
  const lines = fact.ob.series
    .slice(start)
    .map((entry) => {
      const role = String(entry?.su?.name ?? entry?.role ?? "assistant").toUpperCase();
      const content = String(entry?.ob?.text ?? entry?.content ?? "");
      if (!content.trim()) return "";
      return `${role}: ${content}`;
    })
    .filter(Boolean);
  return lines.slice(Math.max(0, lines.length - Math.max(1, Math.trunc(maxLines)))).join("\n");
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

async function invokeGuaranteeCommand({ commandText, outputName }) {
  const interpret = await resolveInterpret();
  try {
    await interpret({
      mood: "do",
      be: "command",
      ob: { text: String(commandText ?? "") },
      to: { name: outputName, nameTypeWords: ["text"] }
    });
    return {
      ok: true,
      output: resolveFactText(outputName),
      error: ""
    };
  } catch (err) {
    const message = String(
      err?.sentence?.ob?.text ??
      err?.message ??
      "command guarantee failed"
    );
    return {
      ok: false,
      output: "",
      error: message
    };
  }
}

function buildVerifierPrompt({ task, draft, transcript, threshold, includeTranscript }) {
  const pieces = [
    "Verify the candidate for factual grounding, constraint fit, and contradictions.",
    includeTranscript
      ? "Use the flow transcript to check whether claims match tool outputs and prior steps."
      : "Focus on task fit and factual consistency from the candidate text.",
    "Return concise reasoning, then put only PASS, FAIL, or a 0..1 confidence score on the last non-empty line.",
    `Pass threshold is ${threshold}.`,
    "",
    "TASK:",
    task,
    "",
    "CANDIDATE:",
    draft
  ];
  if (includeTranscript && transcript) {
    pieces.push("", "FLOW TRANSCRIPT:", transcript);
  }
  return pieces.join("\n");
}

function buildRetryPrompt({ task, acceptedBundle, draft, verifyText, guaranteeText }) {
  const lines = [
    "Revise the candidate to fix all verifier issues while preserving supported facts.",
    "Keep the result concise.",
    "",
    "TASK:",
    task
  ];
  if (acceptedBundle?.draft || acceptedBundle?.verify || acceptedBundle?.guarantee) {
    lines.push(
      "",
      "LATEST ACCEPTED REFERENCE:",
      `draft: ${acceptedBundle?.draft || "none"}`,
      `verify: ${acceptedBundle?.verify || "none"}`,
      `guarantee: ${acceptedBundle?.guarantee || "none"}`
    );
  }
  lines.push(
    "",
    "LATEST FAILED CANDIDATE:",
    draft,
    "",
    "LATEST VERIFY FEEDBACK:",
    verifyText || "none",
    "",
    "LATEST GUARANTEE FEEDBACK:",
    guaranteeText || "none"
  );
  return lines.join("\n");
}

function rememberText(name, text) {
  doRemember({
    mood: "ya",
    su: { name },
    ob: { text: String(text ?? "") },
    be: "text"
  });
}

function rememberNum(name, value) {
  doRemember({
    mood: "ya",
    su: { name },
    ob: { num: Number(value ?? 0) },
    be: "number"
  });
}

function rememberMap(name, map) {
  doRemember({
    mood: "ya",
    su: { name },
    ob: { map: map ?? {} },
    be: "map"
  });
}

export async function verifyLoop(sentence) {
  const task = resolveTextFromValue(sentence?.ob);
  const generatorName = sentence?.for?.name ?? null;
  const verifierName = sentence?.by?.name ?? null;
  const toolMapName = sentence?.with?.name ?? (sentence?.with?.wo === "tools" ? "agent tools" : null);
  const outputName = sentence?.to?.name ?? null;
  const configMaxAttempts = resolveConfigMapNum("verify loop configure", "max attempts");
  const configThreshold = resolveConfigMapNum("verify loop configure", "threshold");
  const maxAttempts = Math.max(1, Math.trunc(Number(sentence?.atmost?.num ?? configMaxAttempts ?? 3)));
  const threshold = Number.isFinite(Number(sentence?.atleast?.num))
    ? Number(sentence.atleast.num)
    : (Number.isFinite(Number(configThreshold)) ? Number(configThreshold) : 0.8);
  const transcriptMaxLines = Math.max(1, Math.trunc(Number(
    resolveConfigMapNum("verify loop configure", "transcript max lines") ?? 40
  )));
  const includeTranscript = resolveConfigMapText("verify loop configure", "include transcript") !== "lie";
  const guaranteeCommandTemplate =
    resolveConfigMapText("verify loop configure", "guarantee command")
    ?? resolveConfigMapText("verify loop configure", "verifier command")
    ?? "";
  const guaranteeExpectRegex =
    resolveConfigMapText("verify loop configure", "guarantee expect regex")
    ?? resolveConfigMapText("verify loop configure", "verifier expect regex")
    ?? "";
  const guaranteeDraftRegex = resolveConfigMapText("verify loop configure", "guarantee draft regex") ?? "";

  if (!task) {
    throwErrorSentence({
      name: "verify loop defective",
      message: "verify loop defective: missing input text",
      from: { name: "verify loop" },
      raw: { sentence }
    });
  }
  if (!generatorName) {
    throwErrorSentence({
      name: "verify loop defective",
      message: "verify loop defective: missing generator name",
      from: { name: "verify loop" },
      raw: { sentence }
    });
  }
  if (!verifierName && !guaranteeCommandTemplate && !guaranteeDraftRegex) {
    throwErrorSentence({
      name: "verify loop defective",
      message: "verify loop defective: missing verifier and guarantee",
      from: { name: "verify loop" },
      raw: { sentence }
    });
  }

  const generatorFact = remember(generatorName);
  const verifierFact = verifierName ? remember(verifierName) : null;
  const generatorIsMind = generatorFact?.be === "mind";
  const verifierIsMind = verifierFact?.be === "mind";
  const generatorRefineryName = !generatorIsMind ? await resolveRefineryTarget(generatorName) : null;
  const verifierRefineryName = verifierName && !verifierIsMind ? await resolveRefineryTarget(verifierName) : null;
  const verifierIsRefinery = verifierName && !verifierIsMind
    ? Boolean(verifierRefineryName ?? await resolveIsRefinery(verifierName))
    : false;
  const generatorIsRefinery = !generatorIsMind && Boolean(generatorRefineryName ?? await resolveIsRefinery(generatorName));

  const priorSuccess = remember("verify loop last success")?.ob?.map ?? {};
  const acceptedReference = {
    draft: String(priorSuccess?.draft?.text ?? ""),
    verify: String(priorSuccess?.verify?.text ?? ""),
    guarantee: String(priorSuccess?.guarantee?.text ?? "")
  };
  let latestPrompt = task;
  let finalDraft = "";
  let lastReviewText = "";
  let lastVerdict = { pass: false, score: null, lastLine: "" };
  let lastGuaranteeText = "not run";
  let lastGuaranteePass = (guaranteeCommandTemplate || guaranteeDraftRegex) ? false : true;
  let attemptsUsed = 0;
  let stopReason = "max attempts";
  let previousFailedDraft = "";
  let lastFailureBundle = null;
  let lastSuccessBundle = null;

  rememberText("verify loop seed task", task);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attemptsUsed = attempt;
    const draftName = `verify loop draft ${attempt}`;
    const flowSeriesName = generatorIsMind ? `${generatorName} story session` : "";
    const flowStart = seriesEntryCount(flowSeriesName);
    if (generatorIsMind) {
      finalDraft = await invokeMind({
        mindName: generatorName,
        prompt: latestPrompt,
        outputName: draftName,
        toolMapName
      });
    } else if (generatorIsRefinery) {
      finalDraft = await invokeRefinery({
        refineryName: generatorRefineryName ?? generatorName,
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

    lastGuaranteeText = "not run";
    lastGuaranteePass = true;
    if (guaranteeDraftRegex) {
      let matched = false;
      try {
        matched = new RegExp(guaranteeDraftRegex, "u").test(String(finalDraft ?? ""));
      } catch {
        matched = false;
      }
      lastGuaranteePass = lastGuaranteePass && matched;
      lastGuaranteeText = `draft regex=${matched ? "match" : "mismatch"}`;
    }
    if (guaranteeCommandTemplate) {
      const guaranteeCommand = applyTemplate(guaranteeCommandTemplate, {
        draft: shellEscapeSingle(finalDraft),
        task: shellEscapeSingle(task)
      });
      const guaranteeName = `verify loop guarantee ${attempt}`;
      const guarantee = await invokeGuaranteeCommand({
        commandText: guaranteeCommand,
        outputName: guaranteeName
      });
      const regexOk = guaranteeExpectRegex
        ? (() => {
            try {
              return new RegExp(guaranteeExpectRegex, "u").test(String(guarantee.output ?? ""));
            } catch {
              return false;
            }
          })()
        : true;
      const commandPass = guarantee.ok && regexOk;
      lastGuaranteePass = lastGuaranteePass && commandPass;
      if (guarantee.ok) {
        lastGuaranteeText = guaranteeExpectRegex
          ? `ok: command status=0 regex=${regexOk ? "match" : "mismatch"} output=${guarantee.output}`
          : `ok: command status=0 output=${guarantee.output}`;
      } else {
        lastGuaranteeText = `fail: ${guarantee.error}`;
      }
    }

    if (!lastGuaranteePass) {
      lastReviewText = "skipped verifier (guarantee failed)";
      lastVerdict = { pass: false, score: 0, lastLine: "FAIL (guarantee)" };
    } else if (verifierName) {
      const transcript = formatSeriesTranscript(flowSeriesName, {
        maxLines: transcriptMaxLines,
        fromIndex: flowStart
      });
      const reviewPrompt = buildVerifierPrompt({
        task,
        draft: finalDraft,
        transcript,
        threshold,
        includeTranscript
      });

      const reviewName = `verify loop feedback ${attempt}`;
      if (verifierIsMind) {
        lastReviewText = await invokeMind({
          mindName: verifierName,
          prompt: reviewPrompt,
          outputName: reviewName
        });
      } else if (verifierIsRefinery) {
        lastReviewText = await invokeRefinery({
          refineryName: verifierRefineryName ?? verifierName,
          prompt: reviewPrompt,
          outputName: reviewName
        });
      } else {
        lastReviewText = await invokeCeremony({
          ceremonyName: verifierName,
          prompt: reviewPrompt,
          outputName: reviewName
        });
      }
      lastVerdict = parseVerdictFromLastLine(lastReviewText, threshold);
    } else {
      lastReviewText = "skipped verifier";
      lastVerdict = { pass: true, score: 1, lastLine: "PASS (guarantee)" };
    }

    if (lastVerdict.pass && lastGuaranteePass) {
      stopReason = "pass";
      lastSuccessBundle = {
        attempt: { num: attempt },
        draft: { text: finalDraft },
        verify: { text: lastReviewText },
        verdict: { text: lastVerdict.lastLine || "PASS" },
        guarantee: { text: lastGuaranteeText }
      };
      break;
    }

    if (previousFailedDraft && previousFailedDraft === finalDraft) {
      stopReason = "unchanged draft";
      lastFailureBundle = {
        attempt: { num: attempt },
        draft: { text: finalDraft },
        verify: { text: lastReviewText },
        verdict: { text: lastVerdict.lastLine || "FAIL" },
        guarantee: { text: lastGuaranteeText }
      };
      break;
    }
    previousFailedDraft = finalDraft;
    lastFailureBundle = {
      attempt: { num: attempt },
      draft: { text: finalDraft },
      verify: { text: lastReviewText },
      verdict: { text: lastVerdict.lastLine || "FAIL" },
      guarantee: { text: lastGuaranteeText }
    };
    stopReason = attempt >= maxAttempts ? "max attempts" : stopReason;

    latestPrompt = buildRetryPrompt({
      task,
      acceptedBundle: acceptedReference,
      draft: finalDraft,
      verifyText: lastReviewText,
      guaranteeText: lastGuaranteeText
    });
  }

  const resultText = finalDraft;
  if (outputName) {
    rememberText(outputName, resultText);
  }
  rememberText("verify loop verdict", lastVerdict.lastLine || (lastVerdict.pass ? "PASS" : "FAIL"));
  rememberText("verify loop guarantee", lastGuaranteeText);
  rememberText("verify loop verifier", lastGuaranteeText);
  rememberNum("verify loop attempts used", attemptsUsed);
  rememberText("verify loop stop reason", stopReason);
  rememberText("verify loop summary", `attempts=${attemptsUsed}; stop=${stopReason}; verdict=${lastVerdict.lastLine || "FAIL"}; guarantee=${lastGuaranteeText}`);
  if (lastFailureBundle) rememberMap("verify loop last failure", lastFailureBundle);
  if (lastSuccessBundle) rememberMap("verify loop last success", lastSuccessBundle);
  if (typeof lastVerdict.score === "number") {
    rememberNum("verify loop score", lastVerdict.score);
  }
  try {
    const label = lastVerdict.pass ? "gold_positive" : "gold_negative";
    const bundle = lastVerdict.pass ? (lastSuccessBundle ?? {}) : (lastFailureBundle ?? {});
    const gold = await emitSessionGold({
      rememberFn: remember,
      generatorName,
      label,
      task,
      draft: resultText,
      review: bundle?.verify?.text ?? lastReviewText,
      guarantee: bundle?.guarantee?.text ?? lastGuaranteeText
    });
    rememberText("verify loop gold label", label);
    rememberText("verify loop gold key", gold?.key ?? "");
    rememberText("verify loop gold file", gold?.file ?? "");
  } catch (err) {
    rememberText("verify loop gold error", String(err?.message ?? err ?? ""));
  }

  return { ob: { text: resultText }, be: "text" };
}

const OB_TYPES = [
  ["text"],
  ["name", "text"]
];

const ROLE_TYPES = [
  ["name", "mind"],
  ["name", "refinery"],
  ["text"]
];

const WITH_TYPES = [
  null,
  ["name", "map"],
  ["wo", "tools"]
];

function buildVerifySignature({ obType, forType, byType, withType, includeLimits }) {
  const words = ["be", "verify", "loop"];
  // Signatures are sorted by case key: atleast, atmost, by, for, ob, to, with
  if (includeLimits) words.push("atleast", "num", "atmost", "num");
  if (byType) words.push("by", ...byType);
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
          for (const useReviewer of [true, false]) {
            const words = buildVerifySignature({ obType, forType, byType: useReviewer ? byType : null, withType, includeLimits });
            const key = words.join(" ");
            if (signatureSet.has(key)) continue;
            signatureSet.add(key);
            signatureEntries.push({ signatureWords: words, handler: verifyLoop });
          }
        }
      }
    }
  }
}

export const signatures = signatureEntries;

export default verifyLoop;
