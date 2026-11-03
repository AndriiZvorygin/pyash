import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { sentenceToPyash } from "../beautiful.mjs";
import {
  clearExchangeRecorder,
  emitExchangeSentence,
  recordArtifact,
  setExchangeRecorder,
  setExchangeRunId
} from "../bridge/exchange.mjs";

function textFact(name, value) {
  return { mood: "ya", su: { name }, ob: { text: String(value ?? "") }, be: "text" };
}

function mapBlock(name, fields = []) {
  return [
    sentenceToPyash({ mood: "def", su: { name }, be: "json map" }),
    ...fields.map(([key, value]) => sentenceToPyash(textFact(key, value))),
    "prah"
  ].join("\n") + "\n";
}

function dayStamp(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

function stableRunId(value) {
  return String(value ?? "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function eventToolName(event = {}) {
  return String(event.toolName ?? event.tool_name ?? event.toolCall?.function?.name ?? "unknown tool");
}

function eventCallId(event = {}) {
  return String(event.toolCall?.id ?? event.tool_call?.id ?? "").trim();
}

function eventKey(event = {}) {
  return eventCallId(event) || eventToolName(event);
}

function serialize(value) {
  try { return JSON.stringify(value ?? {}, null, 2); } catch { return String(value); }
}

function artifactReference(artifact, label) {
  const artifactName = String(artifact?.su?.name ?? label);
  const filename = String(artifact?.to?.filename ?? "");
  const hash = String(artifact?.fromtext?.text ?? "");
  return {
    mood: "ya",
    su: { name: `${label} artifact` },
    ob: { text: `artifact ${artifactName}${hash ? ` sha256:${hash}` : ""}` },
    to: filename ? { filename } : undefined,
    be: "text"
  };
}

export function createCodingSaddleTrace({
  worldRoot,
  cwd,
  sessionName = "coding",
  sessionFile = "",
  backend = "",
  model = "",
  now = new Date(),
  pid = process.pid,
  runId: providedRunId = ""
} = {}) {
  const root = path.resolve(String(worldRoot || path.join(cwd || process.cwd(), "world")));
  const date = now instanceof Date ? now : new Date(now);
  const stamp = date.toISOString().replace(/[-:.]/g, "");
  const runId = stableRunId(providedRunId || `${stamp}-${pid}-coding-saddle`);
  const journalPath = path.join(root, "newspaper", `${dayStamp(date)}-coding-saddle.pya`);
  fs.mkdirSync(path.dirname(journalPath), { recursive: true });

  let eventCounter = 0;
  let activeTurnId = "";
  let activeBackend = String(backend ?? "");
  let activeModel = String(model ?? "");
  let activeSessionName = String(sessionName ?? "coding");
  let activeSessionFile = String(sessionFile ?? "");
  let closed = false;
  const pending = new Map();

  const append = (sentence) => {
    if (!sentence) return;
    const line = typeof sentence === "string" ? sentence : sentenceToPyash(sentence);
    fs.appendFileSync(journalPath, line.endsWith("\n") ? line : `${line}\n`, "utf8");
  };
  const exchangeRecord = (sentence) => append(sentence);
  setExchangeRecorder({ runRoot: root, record: exchangeRecord });
  setExchangeRunId(runId);

  append(mapBlock(`coding saddle run ${runId}`, [
    ["run id", runId],
    ["started at", date.toISOString()],
    ["working directory", path.resolve(String(cwd || process.cwd()))],
    ["session name", sessionName],
    ["session file", sessionFile],
    ["backend", backend],
    ["model", model]
  ]));

  const writeEventArtifact = (event, sequence, stage, turnId) => {
    const subject = `coding saddle tool event ${runId} ${String(sequence).padStart(6, "0")} ${stage}`;
    const toolSentence = event.toolSentence && typeof event.toolSentence === "object"
      ? sentenceToPyash(event.toolSentence)
      : "";
    const resultSentence = event.resultSentence && typeof event.resultSentence === "object"
      ? sentenceToPyash(event.resultSentence)
      : "";
    const fields = [
      ["run id", runId],
      ["turn id", turnId],
      ["backend", activeBackend],
      ["model", activeModel],
      ["stage", stage],
      ["tool name", eventToolName(event)],
      ["tool call id", eventCallId(event)],
      ["tool sentence", toolSentence],
      ["raw tool call", serialize(event.toolCall ?? event.tool_call ?? {})],
      ["result sentence", resultSentence],
      ["tool result", String(event.toolText ?? event.tool_text ?? "")],
      ["recorded at", new Date().toISOString()]
    ];
    const locator = `artifacts/${runId}/tool-event-${String(sequence).padStart(6, "0")}-${stage}.pya`;
    const bytes = Buffer.from(mapBlock(subject, fields), "utf8");
    return recordArtifact({
      locator,
      producer: "coding saddle",
      bytes,
      kind: `tool-${stage}`,
      requestIdentity: turnId ? { name: turnId } : undefined
    });
  };

  return {
    runId,
    journalPath,
    beginTurn({
      input = "",
      turnId = crypto.randomUUID(),
      backend: turnBackend = activeBackend,
      model: turnModel = activeModel,
      sessionName: turnSessionName = activeSessionName,
      sessionFile: turnSessionFile = activeSessionFile
    } = {}) {
      if (closed) throw new Error("coding saddle trace is closed");
      activeTurnId = stableRunId(turnId) || crypto.randomUUID();
      activeBackend = String(turnBackend ?? "");
      activeModel = String(turnModel ?? "");
      activeSessionName = String(turnSessionName ?? "coding");
      activeSessionFile = String(turnSessionFile ?? "");
      append(mapBlock(`coding saddle turn ${runId} ${activeTurnId}`, [
        ["run id", runId],
        ["turn id", activeTurnId],
        ["backend", activeBackend],
        ["model", activeModel],
        ["session name", activeSessionName],
        ["session file", activeSessionFile],
        ["started at", new Date().toISOString()]
      ]));
      recordArtifact({
        locator: `artifacts/${runId}/turn-${activeTurnId}-input.pya`,
        producer: "coding saddle",
        bytes: Buffer.from(mapBlock(`coding saddle input ${runId} ${activeTurnId}`, [
          ["run id", runId],
          ["turn id", activeTurnId],
          ["input", input]
        ]), "utf8"),
        kind: "turn-input",
        requestIdentity: { name: activeTurnId }
      });
      return activeTurnId;
    },
    recordToolEvent(event = {}) {
      if (closed || !event?.stage) return false;
      const stage = String(event.stage).trim().toLowerCase();
      const key = eventKey(event);
      let call = null;
      let sequence;
      if (stage === "call") {
        sequence = ++eventCounter;
        call = { event, sequence };
        const queue = pending.get(key) ?? [];
        queue.push(call);
        pending.set(key, queue);
      } else if (stage === "result") {
        const queue = pending.get(key) ?? [];
        call = queue.shift() ?? null;
        if (queue.length) pending.set(key, queue);
        else pending.delete(key);
        sequence = call?.sequence ?? ++eventCounter;
      } else {
        sequence = ++eventCounter;
      }

      const artifact = writeEventArtifact(event, sequence, stage, activeTurnId);
      if (stage === "call" && call) call.artifact = artifact;
      if (stage === "result" && call) {
        emitExchangeSentence({
          mood: "ya",
          su: { name: `tool event ${String(sequence).padStart(6, "0")}` },
          ob: { la: artifactReference(call.artifact, "tool call") },
          to: { la: artifactReference(artifact, "tool result") },
          accordingto: activeTurnId ? { text: activeTurnId } : undefined,
          from: { name: runId },
          be: "tool"
        });
      }
      return Boolean(artifact);
    },
    finishTurn({ status = "complete", error = "", sessionTurnId = "" } = {}) {
      if (!activeTurnId) return null;
      const turnId = activeTurnId;
      append(mapBlock(`coding saddle turn outcome ${runId} ${turnId}`, [
        ["run id", runId],
        ["turn id", turnId],
        ["status", status],
        ["session turn id", sessionTurnId],
        ["error", error],
        ["finished at", new Date().toISOString()]
      ]));
      activeTurnId = "";
      return turnId;
    },
    close({ status = "closed" } = {}) {
      if (closed) return;
      if (activeTurnId) this.finishTurn({ status: "interrupted" });
      append(mapBlock(`coding saddle run outcome ${runId}`, [
        ["run id", runId],
        ["status", status],
        ["finished at", new Date().toISOString()]
      ]));
      closed = true;
      clearExchangeRecorder();
    }
  };
}
