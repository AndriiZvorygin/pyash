import fs from "node:fs/promises";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { splitSentences } from "../program/library/sentenceSplitter.mjs";
import { buildErrorSentence, surfaceErrorSentence } from "../program/error.mjs";
import { sentenceToPyash } from "../program/beautiful.mjs";
import { hashLocator, setExchangeRecorder, clearExchangeRecorder, setExchangeRunRoot } from "../program/bridge/exchange.mjs";
import {
  isCommandRequestIdentity,
  isCommandRequestIdentityLike,
  isCommandResultIdentityProtocolMarker,
  isCommandResultIdentityProtocolSentence
} from "../program/bridge/command_identity.mjs";

function readFlagValue(args, name) {
  const prefix = `${name}=`;
  const idx = args.findIndex(arg => arg === name || arg.startsWith(prefix));
  if (idx === -1) return null;
  const arg = args[idx];
  if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  return args[idx + 1] ?? null;
}

function normalizeLines(text) {
  return splitSentences(String(text), { includeThen: true });
}

function contentAddressPath(hash, locator) {
  if (!hash) return null;
  const ext = locator ? path.extname(locator) : "";
  return path.join("artifacts", "sha256", hash.slice(0, 2), hash.slice(2, 4), `${hash}${ext}`);
}

function identityDefect(message) {
  return buildErrorSentence({
    name: "command result identity defective",
    message,
    from: { name: "replay" }
  });
}

function identityFields(sentence) {
  return [
    ["subject", sentence?.su?.name],
    ["destination", sentence?.to?.name],
    ["object", sentence?.ob?.name],
    ["producer", sentence?.from?.name]
  ].filter(([, value]) => value);
}

async function main() {
  const args = process.argv.slice(2);
  const runId = readFlagValue(args, "--run-id") || "run";
  const runRootOverride = readFlagValue(args, "--run-root");
  const runRoot = runRootOverride ? path.resolve(runRootOverride) : process.cwd();
  const newspaperPath = path.resolve(runRoot, "newspaper", `${runId}.pya`);
  const text = await fs.readFile(newspaperPath, "utf8");
  const lines = normalizeLines(text);
  const errors = [];
  const requests = new Map();
  const results = new Map();
  const toolResults = new Map();
  const auditDecisions = new Map();
  const approvalRequests = new Set();
  const approvalDecisions = new Map();
  const linked = [];
  const identityErrors = [];
  let identityContract = false;
  setExchangeRecorder({ record: () => {}, runRoot });
  setExchangeRunRoot(runRoot);

  for (const line of lines) {
    if (!line.trim()) continue;
    const sentence = parse(line);
    if (isCommandResultIdentityProtocolMarker(sentence)) {
      identityContract = true;
      if (!isCommandResultIdentityProtocolSentence(sentence)) {
        identityErrors.push(identityDefect("unsupported command result identity protocol version"));
      }
    }
    for (const [field, rawValue] of identityFields(sentence)) {
      const value = String(rawValue).trim();
      if (!isCommandRequestIdentityLike(value)) continue;
      if (!isCommandRequestIdentity(value)) {
        identityErrors.push(identityDefect(`malformed command request identity in ${field}: ${value}`));
      }
    }
    const requestName = String(sentence?.su?.name ?? "").trim();
    if (sentence?.be === "evoke" && isCommandRequestIdentity(requestName)) {
      const requestShape = sentenceToPyash(sentence?.ob?.la ?? {});
      const prior = requests.get(requestName);
      if (prior && prior !== requestShape) {
        identityErrors.push(identityDefect(`conflicting command request for ${requestName}`));
      } else {
        requests.set(requestName, requestShape);
      }
    }
    if (sentence?.be === "command" && sentence?.mood === "ya" && isCommandRequestIdentity(requestName)) {
      const resultShape = sentenceToPyash(sentence?.ob ?? {});
      const prior = results.get(requestName);
      if (prior && prior !== resultShape) {
        identityErrors.push(identityDefect(`conflicting command result for ${requestName}`));
      } else {
        results.set(requestName, resultShape);
      }
    }
    const toolResult = sentence?.be === "tool" ? sentence?.to?.la : null;
    const toolResultName = String(toolResult?.su?.name ?? "").trim();
    if (toolResult?.be === "command" && toolResult?.mood === "ya" && isCommandRequestIdentityLike(toolResultName)) {
      if (!isCommandRequestIdentity(toolResultName)) {
        identityErrors.push(identityDefect(`malformed command request identity in tool result: ${toolResultName}`));
      } else {
        const resultShape = sentenceToPyash(toolResult?.ob ?? {});
        const prior = toolResults.get(toolResultName);
        if (prior && prior !== resultShape) {
          identityErrors.push(identityDefect(`conflicting tool result for ${toolResultName}`));
        } else {
          toolResults.set(toolResultName, resultShape);
        }
      }
    }
    if (sentence?.be === "command audit" && sentence?.to?.name) {
      const value = String(sentence.to.name).trim();
      linked.push({ kind: "audit", value });
      if (isCommandRequestIdentity(value)) {
        const decisions = auditDecisions.get(value) ?? [];
        decisions.push({
          stage: String(sentence.as?.name ?? "").trim(),
          decision: String(sentence.accordingto?.name ?? "").trim(),
          hasResult: Boolean(sentence.totext?.text)
        });
        auditDecisions.set(value, decisions);
      }
    }
    if (sentence?.be === "ratify" && sentence?.to?.name) {
      const value = String(sentence.to.name).trim();
      if (isCommandRequestIdentityLike(value)) {
        linked.push({ kind: "approval", value });
        if (sentence.mood === "do") approvalRequests.add(value);
        if (sentence.mood === "ya" && typeof sentence.ob?.boolean === "boolean") {
          approvalDecisions.set(value, sentence.ob.boolean);
        }
      }
    }
    if (sentence?.be === "bool" && sentence?.mood === "ya" && isCommandRequestIdentity(requestName)
      && typeof sentence.ob?.boolean === "boolean") {
      approvalDecisions.set(requestName, sentence.ob.boolean);
    }
    if (sentence?.be === "artifact" || sentence?.be === "exchange") {
      for (const [field, value] of identityFields(sentence)) {
        if (field === "object" || field === "producer") {
          if (isCommandRequestIdentity(value)) {
            linked.push({ kind: sentence.be, value: String(value).trim() });
          }
        }
      }
    }
    if (sentence.be === "artifact") {
      const locator = sentence.to?.filename ?? sentence.ob?.text;
      const expectedHash = sentence.fromtext?.text;
      if (locator && expectedHash) {
        try {
          const caLocator = contentAddressPath(expectedHash, locator);
          let info = null;
          try {
            info = hashLocator(caLocator);
          } catch {
            info = hashLocator(locator);
          }
          if (!info || info.hash !== expectedHash) {
            errors.push(buildErrorSentence({
              name: "hash inconsistency",
              message: "hash inconsistency",
              from: { name: "replay" },
              raw: { locator }
            }));
          }
        } catch (err) {
          errors.push(buildErrorSentence({
            name: "replay defective",
            message: err?.message ?? "replay defective",
            from: { name: "replay" },
            raw: { locator }
          }));
        }
      }
    }
  }

  if (identityContract) {
    errors.push(...identityErrors);
    for (const [requestName] of results) {
      if (!requests.has(requestName)) {
        errors.push(identityDefect(`command result has no command request: ${requestName}`));
      }
    }
    for (const [requestName, resultShape] of toolResults) {
      if (!requests.has(requestName)) {
        errors.push(identityDefect(`tool result has no command request: ${requestName}`));
      } else if (!results.has(requestName) || results.get(requestName) !== resultShape) {
        errors.push(identityDefect(`tool result does not resolve to command result: ${requestName}`));
      }
    }
    for (const link of linked) {
      if (!requests.has(link.value)) {
        errors.push(identityDefect(`${link.kind} has no command request: ${link.value}`));
      }
    }
    for (const [requestName] of requests) {
      const hasResult = results.has(requestName);
      const decisions = auditDecisions.get(requestName) ?? [];
      const deniedByAudit = decisions.some(entry => entry.decision === "deny");
      const failedByAudit = decisions.some(entry => entry.decision === "error");
      const approvalDecision = approvalDecisions.get(requestName);
      const deniedByApproval = approvalDecision === false;
      const terminalFailure = deniedByAudit || failedByAudit || deniedByApproval;
      if (hasResult && terminalFailure) {
        errors.push(identityDefect(`command request has both terminal failure and result: ${requestName}`));
      } else if (!hasResult && !terminalFailure) {
        const pendingApproval = approvalRequests.has(requestName) || decisions.some(entry => entry.decision === "ask");
        errors.push(identityDefect(
          pendingApproval
            ? `command request resume is incomplete: ${requestName}`
            : `command request graph is incomplete: ${requestName}`
        ));
      }
    }
  }

  clearExchangeRecorder();

  if (errors.length > 0) {
    const errSentence = surfaceErrorSentence(errors[0]);
    console.error(sentenceToPyash(errSentence));
    process.exit(1);
  }
  console.log(`exists su name ${runId} be replay ya`);
}

main().catch(err => {
  const errSentence = surfaceErrorSentence(buildErrorSentence({
    name: "replay defective",
    message: err?.message ?? "replay defective",
    from: { name: "replay" }
  }));
  console.error(sentenceToPyash(errSentence));
  process.exit(1);
});
