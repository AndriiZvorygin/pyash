import { remember, doRemember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";
import { resolveWorldRoot } from "../library/world.mjs";
import {
  ROUTER_OPERATION_HEALTH,
  ROUTER_OPERATION_INPUT,
  ROUTER_OPERATION_PRODUCE,
  ackToSentence,
  eventToSentence,
  healthToSentence,
  resolveRouterOperation
} from "../agent/channel_core/contract.mjs";
import { readRouterHealthStateSync } from "../agent/channel_core/state.mjs";

function dayStamp(now = new Date()) {
  return now.toISOString().slice(0, 10).replace(/-/g, "");
}

function padSerial(value) {
  return String(value).padStart(4, "0");
}

function timeStamp(now = new Date()) {
  return now.toISOString().slice(11, 19).replace(/:/g, "");
}

function resolveChannelType(endpoint = "") {
  const text = String(endpoint ?? "").trim().toLowerCase();
  const match = text.match(/^channel\s+([a-z0-9_-]+)\s+room\b/);
  return match?.[1] || "channel";
}

function hashPayloadParts(payload = "", fromEndpoint = "", toEndpoint = "") {
  const input = `${payload}\n${fromEndpoint}\n${toEndpoint}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function resolveText(value, { rememberFn = remember } = {}) {
  if (!value || typeof value !== "object") return "";
  if (typeof value.text === "string") return value.text.trim();
  if (typeof value.wo === "string") return value.wo.trim();
  if (typeof value.filename === "string") return value.filename.trim();
  if (typeof value.name !== "string") return "";
  const literal = value.name.trim();
  if (!literal) return "";
  if (literal.includes(" ")) return literal;
  const fact = rememberFn(literal);
  const fromFact =
    fact?.ob?.text
    ?? fact?.ob?.name
    ?? fact?.ob?.filename
    ?? null;
  if (fromFact == null) return literal;
  return String(fromFact).trim();
}

function nextSerial(name, { rememberFn = remember } = {}) {
  const currentFact = rememberFn(name);
  const current = Number(currentFact?.ob?.num);
  const next = Number.isFinite(current) ? current + 1 : 1;
  doRemember({
    mood: "ya",
    su: { name },
    ob: { num: next },
    be: "number"
  });
  return next;
}

function buildPayloadId({ payload = "", fromEndpoint = "", toEndpoint = "" } = {}) {
  const channelType = resolveChannelType(fromEndpoint);
  const hash = hashPayloadParts(payload, fromEndpoint, toEndpoint);
  return `${channelType}-news-${dayStamp()}-${timeStamp()}-${hash}`;
}

function buildMessageId(toEndpoint = "") {
  const serial = nextSerial("router produce serial");
  const prefix = String(toEndpoint).trim().toLowerCase().startsWith("channel matrix")
    ? "matrix-event"
    : "event";
  return `${prefix}-${dayStamp()}-${padSerial(serial)}`;
}

function ensureInputPayload(text, sentence) {
  if (typeof text === "string" && text.trim()) return text.trim();
  throwErrorSentence({
    name: "router input defective",
    message: "router input defective: missing payload",
    from: { name: "router" },
    raw: { sentence }
  });
}

function ensureInputEndpoint(text, sentence) {
  if (typeof text === "string" && text.trim()) return text.trim();
  throwErrorSentence({
    name: "router input defective",
    message: "router input defective: missing source endpoint",
    from: { name: "router" },
    raw: { sentence }
  });
}

function ensureRouteEndpoint(text, sentence) {
  if (typeof text === "string" && text.trim()) return text.trim();
  throwErrorSentence({
    name: "router route defective",
    message: "router route defective: destination unresolved",
    from: { name: "router" },
    raw: { sentence }
  });
}

function ensureProducePayloadId(text, sentence) {
  if (typeof text === "string" && text.trim()) return text.trim();
  throwErrorSentence({
    name: "router produce defective",
    message: "router produce defective: missing routed payload id",
    from: { name: "router" },
    raw: { sentence }
  });
}

function resolveAgentName(endpoint) {
  const text = String(endpoint ?? "").trim();
  if (!text) return null;
  const lower = text.toLowerCase();
  if (!lower.startsWith("agent ")) return null;
  const parts = text.split(/\s+/).slice(1);
  if (!parts.length) return null;
  return parts.join(" ").trim();
}

function buildSessionId(fromEndpoint, toEndpoint) {
  const fromText = String(fromEndpoint ?? "").trim();
  const toText = String(toEndpoint ?? "").trim();
  if (!fromText || !toText) return null;
  return `${fromText} -> ${toText}`;
}

function routeInput(sentence, { rememberFn = remember } = {}) {
  const payload = ensureInputPayload(resolveText(sentence?.ob, { rememberFn }), sentence);
  const fromEndpoint = ensureInputEndpoint(resolveText(sentence?.from, { rememberFn }), sentence);
  const toEndpoint = ensureRouteEndpoint(resolveText(sentence?.to, { rememberFn }), sentence);
  const payloadId = buildPayloadId({ payload, fromEndpoint, toEndpoint });
  const explicitSession = resolveText(sentence?.fromtext, { rememberFn });
  const resolvedAgent = resolveAgentName(toEndpoint);
  const sessionId = explicitSession || buildSessionId(fromEndpoint, toEndpoint);
  return eventToSentence({
    payloadId,
    fromEndpoint,
    toEndpoint,
    payloadText: payload,
    targetAgentName: resolvedAgent,
    sessionId
  });
}

function routeProduce(sentence, { rememberFn = remember } = {}) {
  const fromEndpoint = ensureRouteEndpoint(resolveText(sentence?.from, { rememberFn }), sentence);
  const toEndpoint = ensureRouteEndpoint(resolveText(sentence?.to, { rememberFn }), sentence);
  const payloadId = ensureProducePayloadId(
    resolveText(sentence?.accordingto, { rememberFn }),
    sentence
  );
  const messageId = buildMessageId(toEndpoint);
  return ackToSentence({
    messageId,
    fromEndpoint,
    toEndpoint,
    payloadId,
    success: true
  });
}

function routerHealth({ rememberFn = remember } = {}) {
  const worldRoot = resolveWorldRoot({ rememberFn });
  const state = readRouterHealthStateSync(worldRoot);
  return healthToSentence({
    statusText: state.statusText || "ready",
    healthy: state.healthy !== false,
    sinceIso: state.updatedAt || new Date().toISOString(),
    activeMode: state.activeMode || "",
    fallbackActive: state.fallbackActive === true,
    fallbackReason: state.fallbackReason || "",
    queueDepth: state.queueDepth || 0,
    lastInputAt: state.lastInputAt || ""
  });
}

export function router(sentence, { remember: rememberFn = remember } = {}) {
  const operation = resolveRouterOperation(sentence);
  if (operation === ROUTER_OPERATION_INPUT) return routeInput(sentence, { rememberFn });
  if (operation === ROUTER_OPERATION_PRODUCE) return routeProduce(sentence, { rememberFn });
  if (operation === ROUTER_OPERATION_HEALTH) return routerHealth({ rememberFn });
  throwErrorSentence({
    name: "router input defective",
    message: `router input defective: unsupported operation ${operation || "none"}`,
    from: { name: "router" },
    raw: { sentence }
  });
}

export default router;

export const signatures = [
  { signatureWords: ["be", "router"], handler: router },
  { signatureWords: ["be", "router", "as", "wo", "health"], handler: router },
  { signatureWords: ["be", "router", "as", "wo", "input"], handler: router },
  { signatureWords: ["be", "router", "as", "wo", "input", "ob", "text"], handler: router },
  { signatureWords: ["be", "router", "as", "wo", "input", "from", "text", "ob", "text"], handler: router },
  { signatureWords: ["be", "router", "as", "wo", "input", "ob", "text", "to", "text"], handler: router },
  { signatureWords: ["be", "router", "as", "wo", "input", "from", "text", "to", "text"], handler: router },
  { signatureWords: ["be", "router", "as", "wo", "input", "from", "text", "fromtext", "text", "to", "text"], handler: router },
  { signatureWords: ["be", "router", "as", "wo", "input", "from", "text", "fromtext", "text", "ob", "text", "to", "text"], handler: router },
  { signatureWords: ["be", "router", "as", "wo", "input", "from", "text", "ob", "text", "to", "text"], handler: router },
  { signatureWords: ["be", "router", "as", "wo", "produce"], handler: router },
  { signatureWords: ["be", "router", "as", "wo", "produce", "from", "text", "ob", "text", "to", "text"], handler: router },
  { signatureWords: ["be", "router", "accordingto", "text", "as", "wo", "produce"], handler: router },
  { signatureWords: ["be", "router", "accordingto", "text", "as", "wo", "produce", "from", "text", "to", "text"], handler: router },
  { signatureWords: ["be", "router", "accordingto", "text", "as", "wo", "produce", "from", "text", "ob", "text", "to", "text"], handler: router }
];
