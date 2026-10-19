function normalizeText(value) {
  if (value == null) return "";
  return String(value).trim();
}

function cloneIdentity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const identity = {};
  for (const key of [
    "provider",
    "account",
    "channelId",
    "eventId",
    "historyId",
    "messageId",
    "threadId",
    "rfcMessageId",
    "sourceLocator"
  ]) {
    const text = normalizeText(value[key]);
    if (text) identity[key] = text;
  }
  return Object.keys(identity).length ? identity : null;
}

function attachIdentity(sentence, identity) {
  if (!identity) return sentence;
  Object.defineProperty(sentence, "channelIdentity", {
    value: identity,
    enumerable: false,
    configurable: true
  });
  return sentence;
}

export function channelIdentityFromEvent(event = {}) {
  return cloneIdentity(event?.channelIdentity ?? {
    provider: event?.provider,
    account: event?.account,
    channelId: event?.channelId,
    eventId: event?.eventId,
    historyId: event?.historyId,
    messageId: event?.messageId,
    threadId: event?.threadId,
    rfcMessageId: event?.rfcMessageId,
    sourceLocator: event?.sourceLocator
  });
}

export const ROUTER_OPERATION_INPUT = "input";
export const ROUTER_OPERATION_PRODUCE = "produce";
export const ROUTER_OPERATION_HEALTH = "health";

export function channelEndpoint({ channelType, channelId }) {
  return normalizeText(`channel ${channelType} room ${channelId}`);
}

export function agentEndpoint(agentName) {
  return normalizeText(`agent ${agentName}`);
}

export function resolveRouterOperation(sentence) {
  const raw = sentence?.as?.wo ?? sentence?.as?.text ?? sentence?.as?.name ?? "";
  return normalizeText(raw).toLowerCase();
}

export function eventToSentence({
  payloadId,
  fromEndpoint,
  toEndpoint,
  payloadText,
  targetAgentName,
  sessionId,
  channelIdentity
} = {}) {
  const sentence = {
    mood: "ya",
    su: { name: normalizeText(payloadId) },
    from: { name: normalizeText(fromEndpoint) },
    to: { name: normalizeText(toEndpoint) },
    ob: { text: String(payloadText ?? "") },
    be: ROUTER_OPERATION_INPUT
  };
  if (normalizeText(targetAgentName)) sentence.for = { text: normalizeText(targetAgentName) };
  if (normalizeText(sessionId)) sentence.fromtext = { text: normalizeText(sessionId) };
  return attachIdentity(sentence, cloneIdentity(channelIdentity));
}

export function eventFromSentence(sentence) {
  const event = {
    payloadId: normalizeText(sentence?.su?.name),
    fromEndpoint: normalizeText(sentence?.from?.name),
    toEndpoint: normalizeText(sentence?.to?.name),
    payloadText: String(sentence?.ob?.text ?? ""),
    targetAgentName: normalizeText(sentence?.for?.text),
    sessionId: normalizeText(sentence?.fromtext?.text)
  };
  const identity = cloneIdentity(sentence?.channelIdentity);
  if (identity) event.channelIdentity = identity;
  return event;
}

export function ackToSentence({
  messageId,
  fromEndpoint,
  toEndpoint,
  payloadId,
  success = true,
  channelIdentity
} = {}) {
  const sentence = {
    mood: "ya",
    su: { name: normalizeText(messageId) },
    vyah: { ve: { type: "name", values: [success ? "success" : "fail"] } },
    from: { name: normalizeText(fromEndpoint) },
    to: { name: normalizeText(toEndpoint) },
    accordingto: { text: normalizeText(payloadId) },
    be: ROUTER_OPERATION_PRODUCE
  };
  return attachIdentity(sentence, cloneIdentity(channelIdentity));
}

export function ackFromSentence(sentence) {
  const successValues = sentence?.vyah?.ve?.values;
  const ack = {
    messageId: normalizeText(sentence?.su?.name),
    fromEndpoint: normalizeText(sentence?.from?.name),
    toEndpoint: normalizeText(sentence?.to?.name),
    payloadId: normalizeText(sentence?.accordingto?.text),
    success: Array.isArray(successValues) ? successValues.includes("success") : false
  };
  const identity = cloneIdentity(sentence?.channelIdentity);
  if (identity) ack.channelIdentity = identity;
  return ack;
}

export function healthToSentence({
  statusText = "ready",
  healthy = true,
  sinceIso = new Date().toISOString(),
  activeMode = "",
  fallbackActive = false,
  fallbackReason = "",
  queueDepth = 0,
  lastInputAt = ""
} = {}) {
  const sentence = {
    mood: "ya",
    su: { name: "router" },
    ob: { text: normalizeText(statusText) || "ready" },
    as: { boolean: healthy === true },
    since: { date: String(sinceIso) },
    be: ROUTER_OPERATION_HEALTH
  };
  const modeText = normalizeText(activeMode);
  if (modeText) sentence.for = { text: modeText };
  sentence.fromstate = { text: fallbackActive ? "active" : "inactive" };
  const reasonText = normalizeText(fallbackReason);
  if (reasonText) sentence.fromtext = { text: reasonText };
  const depth = Number(queueDepth);
  if (Number.isFinite(depth) && depth >= 0) sentence.to = { num: Math.floor(depth) };
  const lastInputText = normalizeText(lastInputAt);
  if (lastInputText) sentence.during = { date: lastInputText };
  return sentence;
}

export function healthFromSentence(sentence) {
  const fallbackState = normalizeText(sentence?.fromstate?.text).toLowerCase();
  return {
    name: normalizeText(sentence?.su?.name),
    statusText: normalizeText(sentence?.ob?.text),
    healthy: sentence?.as?.boolean === true,
    sinceIso: normalizeText(sentence?.since?.date),
    activeMode: normalizeText(sentence?.for?.text),
    fallbackActive: fallbackState === "active",
    fallbackReason: normalizeText(sentence?.fromtext?.text),
    queueDepth: Number.isFinite(Number(sentence?.to?.num)) ? Number(sentence.to.num) : 0,
    lastInputAt: normalizeText(sentence?.during?.date)
  };
}

export function assertInputResultSentence(sentence) {
  const event = eventFromSentence(sentence);
  if (sentence?.be !== ROUTER_OPERATION_INPUT) {
    throw new Error("router input defective: invalid router input");
  }
  if (!event.payloadId || !event.fromEndpoint || !event.toEndpoint) {
    throw new Error("router input defective: invalid router input");
  }
}

export function assertProduceResultSentence(sentence) {
  const ack = ackFromSentence(sentence);
  if (sentence?.be !== ROUTER_OPERATION_PRODUCE) {
    throw new Error("router produce defective: invalid router produce");
  }
  if (!ack.messageId || !ack.fromEndpoint || !ack.toEndpoint || !ack.payloadId) {
    throw new Error("router produce defective: invalid router produce");
  }
}

export function buildRouterInputRequestSentence({
  channelType,
  event,
  targetAgentName,
  sessionName
} = {}) {
  const sentence = {
    mood: "do",
    su: { name: "router" },
    as: { wo: ROUTER_OPERATION_INPUT, text: ROUTER_OPERATION_INPUT },
    from: { name: channelEndpoint({ channelType, channelId: event?.channelId ?? "" }) },
    to: { name: agentEndpoint(targetAgentName) },
    ob: { text: String(event?.text ?? "") },
    fromtext: sessionName ? { text: String(sessionName) } : undefined,
    be: "router"
  };
  return attachIdentity(sentence, channelIdentityFromEvent(event));
}

export function buildRouterProduceRequestSentence({
  channelType,
  event,
  sourceAgentName,
  payloadId,
  responseText
} = {}) {
  const sentence = {
    mood: "do",
    su: { name: "router" },
    as: { wo: ROUTER_OPERATION_PRODUCE, text: ROUTER_OPERATION_PRODUCE },
    from: { name: agentEndpoint(sourceAgentName) },
    to: { name: channelEndpoint({ channelType, channelId: event?.channelId ?? "" }) },
    accordingto: { text: String(payloadId ?? "") },
    ob: { text: String(responseText ?? "") },
    be: "router"
  };
  return attachIdentity(sentence, channelIdentityFromEvent(event));
}
