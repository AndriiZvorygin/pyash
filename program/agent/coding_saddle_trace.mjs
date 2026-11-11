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
  segmentMaximumBytes = 4 * 1024 * 1024,
  now = new Date(),
  pid = process.pid,
  runId: providedRunId = ""
} = {}) {
  const root = path.resolve(String(worldRoot || path.join(cwd || process.cwd(), "world")));
  const projectRoot = path.resolve(String(cwd || process.cwd()));
  const date = now instanceof Date ? now : new Date(now);
  const stamp = date.toISOString().replace(/[-:.]/g, "");
  const runId = stableRunId(providedRunId || `${stamp}-${pid}-coding-saddle`);
  const journalDirectory = path.join(root, "newspaper");
  const journalDate = dayStamp(date);
  const segmentLimit = Number(segmentMaximumBytes);
  if (!Number.isSafeInteger(segmentLimit) || segmentLimit < 512) {
    throw new Error("coding saddle newspaper segment limit must be at least 512 bytes");
  }
  fs.mkdirSync(journalDirectory, { recursive: true });
  const existingSegments = fs.readdirSync(journalDirectory)
    .map((name) => name.match(new RegExp(`^${journalDate}-(\\d{4})-coding-saddle\\.pya$`, "u")))
    .filter(Boolean)
    .map((match) => Number(match[1]))
    .sort((a, b) => a - b);
  let segmentNumber = existingSegments.at(-1) ?? 0;
  let journalPath = segmentNumber
    ? path.join(journalDirectory, `${journalDate}-${String(segmentNumber).padStart(4, "0")}-coding-saddle.pya`)
    : "";
  if (journalPath && fs.statSync(journalPath).size >= segmentLimit) journalPath = "";
  const nextJournalPath = () => {
    segmentNumber += 1;
    return path.join(journalDirectory, `${journalDate}-${String(segmentNumber).padStart(4, "0")}-coding-saddle.pya`);
  };
  if (!journalPath) journalPath = nextJournalPath();

  let eventCounter = 0;
  let activeTurnId = "";
  let activeBackend = String(backend ?? "");
  let activeModel = String(model ?? "");
  let activeSessionName = String(sessionName ?? "coding");
  let activeSessionFile = String(sessionFile ?? "");
  let omittedRecordCount = 0;
  let closed = false;
  const pending = new Map();

  const append = (sentence) => {
    if (!sentence) return;
    let line = typeof sentence === "string" ? sentence : sentenceToPyash(sentence);
    let payload = line.endsWith("\n") ? line : `${line}\n`;
    let bytes = Buffer.byteLength(payload, "utf8");
    if (bytes > segmentLimit) {
      omittedRecordCount += 1;
      payload = mapBlock(`coding saddle oversized newspaper record ${runId} ${omittedRecordCount}`, [
        ["original bytes", bytes],
        ["sha256", crypto.createHash("sha256").update(payload).digest("hex")],
        ["reason", "record exceeds configured segment maximum"]
      ]);
      bytes = Buffer.byteLength(payload, "utf8");
    }
    if (bytes > segmentLimit) throw new Error("newspaper segment limit is too small for its omission record");
    const currentBytes = fs.existsSync(journalPath) ? fs.statSync(journalPath).size : 0;
    if (currentBytes && currentBytes + bytes > segmentLimit) journalPath = nextJournalPath();
    fs.appendFileSync(journalPath, payload, "utf8");
  };
  const exchangeRecord = (sentence) => append(sentence);
  // Keep workspace access rooted at the project while storing saddle run artifacts beside its newspaper.
  setExchangeRecorder({ runRoot: projectRoot, artifactRoot: root, record: exchangeRecord });
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
    get journalPath() { return journalPath; },
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
