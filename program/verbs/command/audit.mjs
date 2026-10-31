import { remember, doRemember } from "../../remember/index.mjs";
import { throwErrorSentence } from "../../error.mjs";
import { sentenceToPyash } from "../../beautiful.mjs";
import { resolveConfigMapText } from "../../configure/env.mjs";
import { emitExchangeSentence, recordArtifact, recordExchange } from "../../bridge/exchange.mjs";
import { allocateCommandIdentity, consumeCommandResumeIdentity, restoreCommandIdentity } from "../../bridge/command_identity.mjs";

function buildCommandAudit({
  requestIdentity,
  stage,
  commandClass,
  policy,
  decision,
  sentence,
  resultSentence,
  rememberFn = remember
} = {}) {
  const lane = resolveConfigMapText("command configure", "audit security lane", { rememberFn });
  const identity = requestIdentity?.name ?? String(requestIdentity ?? "").trim();
  const ordinal = identity.match(/^command request (\d{6})$/u)?.[1] ?? "000000";
  const normalizedClass = String(commandClass ?? "").trim().toLowerCase();
  const audit = {
    mood: "ya",
    exists: true,
    be: "command audit",
    su: { name: `command audit ${ordinal}` },
    to: { name: identity },
    as: { name: stage || "policy" },
    from: { name: policy?.source ?? "command configure" },
    accordingto: { name: decision ?? policy?.mode ?? "allow" },
    ob: { text: sentenceToPyash(sentence ?? {}) },
    fromtext: { text: new Date().toISOString() }
  };
  if (normalizedClass && normalizedClass !== "unknown") {
    audit.by = { name: normalizedClass };
  }
  if (resultSentence) audit.totext = { text: sentenceToPyash(resultSentence) };
  if (lane) audit.at = { filename: lane };
  return audit;
}

export function emitCommandAudit(payload) {
  emitExchangeSentence(buildCommandAudit(payload));
}

export function commandRequestSentence({ requestIdentity, sentence } = {}) {
  return {
    mood: "ya",
    exists: true,
    be: "evoke",
    su: { name: requestIdentity.name },
    ob: { la: sentence }
  };
}

export function resolveCommandIdentity({ sentence } = {}) {
  const resumeIdentity = consumeCommandResumeIdentity();
  if (resumeIdentity === undefined) return { identity: allocateCommandIdentity(), resumed: false };
  const restored = restoreCommandIdentity(resumeIdentity);
  if (restored) return { identity: restored, resumed: true };
  throwErrorSentence({
    name: "command resume defective",
    message: "command resume defective: request identity context malformed",
    from: { name: "command" },
    raw: { sentence, requestIdentity: resumeIdentity }
  });
}

export function commandResultSentence({ requestIdentity, output } = {}) {
  return {
    mood: "ya",
    exists: true,
    be: "command",
    su: { name: requestIdentity.name },
    ob: { text: String(output ?? "") }
  };
}

export function rememberCommandResult({ sentence, resultSentence } = {}) {
  const output = resultSentence.ob ?? { text: "" };
  if (sentence?.su?.name) {
    doRemember({
      ...resultSentence,
      su: { name: sentence.su.name },
      be: "text"
    });
  }
  if (sentence?.to?.name) {
    doRemember({
      ...resultSentence,
      su: { name: sentence.to.name },
      be: "text"
    });
  }
  doRemember(resultSentence);
  doRemember({
    mood: "ya",
    su: { name: "result" },
    be: "command",
    ob: output
  });
}

export async function recordCommandOutput({ filename, output, requestIdentity } = {}) {
  if (!filename) return null;
  const bytes = Buffer.from(String(output ?? ""), "utf8");
  const artifact = recordArtifact({
    locator: filename,
    producer: requestIdentity.name,
    bytes,
    kind: "command output",
    requestIdentity: requestIdentity.name
  });
  if (artifact) {
    recordExchange({
      artifactName: artifact.su?.name,
      op: "write",
      producer: requestIdentity.name,
      requestIdentity: requestIdentity.name
    });
  }
  return artifact;
}

