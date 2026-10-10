import { doRemember } from "../../remember/index.mjs";
import { jsonToMapSentences } from "../exchange/json_map.mjs";

const REPLY_FIELDS = new Set([
  "text", "response", "output", "output_text", "message", "choices",
  "thinking", "reasoning", "reasoning_content", "created_at", "createdAt",
  "model", "role", "done", "done_reason", "doneReason", "finish_reason",
  "context", "error"
]);

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function extractReplyText(raw) {
  if (typeof raw === "string") return raw;
  if (!raw || typeof raw !== "object") return "";
  const choice = Array.isArray(raw.choices) ? raw.choices[0] : null;
  return firstDefined(
    raw.response,
    raw.output_text,
    raw.output,
    raw.text,
    raw.message?.content,
    choice?.message?.content,
    choice?.text,
    ""
  );
}

function collectMetadata(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const metadata = {};
  for (const [key, value] of Object.entries(raw)) {
    if (REPLY_FIELDS.has(key)) continue;
    if (value === undefined) continue;
    metadata[key] = value;
  }
  const recognized = [
    "total_duration", "load_duration", "prompt_eval_count", "prompt_eval_duration",
    "eval_count", "eval_duration", "prompt_tokens", "completion_tokens", "total_tokens",
    "input_tokens", "output_tokens", "usage", "system_fingerprint"
  ];
  for (const key of recognized) {
    if (raw[key] !== undefined) metadata[key] = raw[key];
  }
  return metadata;
}

export function normalizeMindReply(raw, { fallbackText = "" } = {}) {
  if (raw && typeof raw === "object" && raw.error) {
    const message = typeof raw.error === "string" ? raw.error : JSON.stringify(raw.error);
    const error = new Error(message || "mind backend error");
    error.code = "MIND_BACKEND_ERROR";
    error.raw = raw;
    throw error;
  }
  const choice = Array.isArray(raw?.choices) ? raw.choices[0] : null;
  const message = raw?.message ?? choice?.message ?? {};
  const textValue = extractReplyText(raw);
  const envelope = {
    text: String(textValue ?? fallbackText ?? "")
  };
  const thinking = firstDefined(raw?.thinking, raw?.reasoning, raw?.reasoning_content, message?.thinking);
  const createdAt = firstDefined(raw?.created_at, raw?.createdAt);
  const model = firstDefined(raw?.model, choice?.model);
  const role = firstDefined(raw?.role, message?.role, choice?.role);
  const done = firstDefined(raw?.done);
  const doneReason = firstDefined(raw?.done_reason, raw?.doneReason, raw?.finish_reason, choice?.finish_reason);
  if (thinking !== undefined) envelope.thinking = String(thinking ?? "");
  if (createdAt !== undefined) envelope.createdAt = String(createdAt);
  if (model !== undefined) envelope.model = String(model);
  if (role !== undefined) envelope.role = String(role);
  if (done !== undefined) envelope.done = Boolean(done);
  if (doneReason !== undefined) envelope.doneReason = String(doneReason);
  envelope.metadata = collectMetadata(raw);
  if (role !== undefined) envelope.metadata.role = String(role);
  if (done !== undefined) envelope.metadata.done = Boolean(done);
  if (doneReason !== undefined) envelope.metadata.done_reason = String(doneReason);
  return envelope;
}

export function requireMindReplyText(envelope) {
  const reply = envelope?.text !== undefined
    ? envelope
    : normalizeMindReply(envelope ?? {});
  if (String(reply?.text ?? "").trim()) return reply;
  const error = new Error("mind hollow answer from backend");
  error.name = "mind hollow answer";
  error.code = "MIND_HOLLOW_ANSWER";
  throw error;
}

export function mergeMindReplyChunks(chunks = [], terminal = null) {
  const rawTerminal = terminal && typeof terminal === "object" ? terminal : {};
  const text = chunks.map((chunk) => String(chunk ?? "")).join("");
  const envelope = normalizeMindReply({ ...rawTerminal, response: text });
  if (rawTerminal.message?.content !== undefined || rawTerminal.response !== undefined) {
    envelope.text = text;
  }
  return envelope;
}

export function replyMetadataName(answerName) {
  return `${answerName} metadata`;
}

export function rememberReplyMetadata(name, metadata = {}) {
  if (!name) return null;
  const { rootName, sentences } = jsonToMapSentences(metadata, name);
  for (const sentence of sentences) doRemember(sentence);
  return rootName;
}

export function replySentence({
  envelope,
  subjectName,
  fromName,
  answerName,
  metadataName,
  role,
  be = "answer"
} = {}) {
  const reply = envelope ?? normalizeMindReply({});
  const sentence = {
    mood: "ya",
    su: { name: answerName ?? subjectName ?? "answer" },
    be,
    from: fromName ? { name: fromName } : undefined,
    ob: { text: reply.text }
  };
  if (reply.thinking !== undefined) sentence.in = { text: reply.thinking };
  if (reply.createdAt !== undefined) sentence.during = { date: reply.createdAt };
  if (reply.model !== undefined) sentence.as = { name: reply.model };
  if (metadataName && Object.keys(reply.metadata ?? {}).length > 0) {
    sentence.accordingto = { name: metadataName };
  }
  if (role) sentence.su = { name: role };
  return sentence;
}

export function errorReplyEnvelope(error) {
  return {
    text: "",
    done: true,
    doneReason: "error",
    metadata: {},
    error: {
      name: error?.name ?? "mind defective",
      message: error?.message ?? String(error ?? "mind stream failed")
    }
  };
}
