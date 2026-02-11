function normalizeText(value) {
  if (value == null) return "";
  return String(value).trim();
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
  sessionId
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
  return sentence;
}

export function eventFromSentence(sentence) {
  return {
    payloadId: normalizeText(sentence?.su?.name),
    fromEndpoint: normalizeText(sentence?.from?.name),
    toEndpoint: normalizeText(sentence?.to?.name),
    payloadText: String(sentence?.ob?.text ?? ""),
    targetAgentName: normalizeText(sentence?.for?.text),
    sessionId: normalizeText(sentence?.fromtext?.text)
  };
}

export function ackToSentence({
  messageId,
  fromEndpoint,
  toEndpoint,
  payloadId,
  success = true
} = {}) {
  return {
    mood: "ya",
    su: { name: normalizeText(messageId) },
    vyah: { ve: { type: "name", values: [success ? "success" : "fail"] } },
    from: { name: normalizeText(fromEndpoint) },
    to: { name: normalizeText(toEndpoint) },
    accordingto: { text: normalizeText(payloadId) },
    be: ROUTER_OPERATION_PRODUCE
  };
}

export function ackFromSentence(sentence) {
  const successValues = sentence?.vyah?.ve?.values;
  return {
    messageId: normalizeText(sentence?.su?.name),
    fromEndpoint: normalizeText(sentence?.from?.name),
    toEndpoint: normalizeText(sentence?.to?.name),
    payloadId: normalizeText(sentence?.accordingto?.text),
    success: Array.isArray(successValues) ? successValues.includes("success") : false
  };
}

export function healthToSentence({
  statusText = "ready",
  healthy = true,
  sinceIso = new Date().toISOString()
} = {}) {
  return {
    mood: "ya",
    su: { name: "router" },
    ob: { text: normalizeText(statusText) || "ready" },
    as: { boolean: healthy === true },
    since: { date: String(sinceIso) },
    be: ROUTER_OPERATION_HEALTH
  };
}

export function healthFromSentence(sentence) {
  return {
    name: normalizeText(sentence?.su?.name),
    statusText: normalizeText(sentence?.ob?.text),
    healthy: sentence?.as?.boolean === true,
    sinceIso: normalizeText(sentence?.since?.date)
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
  return {
    mood: "do",
    su: { name: "router" },
    as: { wo: ROUTER_OPERATION_INPUT, text: ROUTER_OPERATION_INPUT },
    from: { name: channelEndpoint({ channelType, channelId: event?.channelId ?? "" }) },
    to: { name: agentEndpoint(targetAgentName) },
    ob: { text: String(event?.text ?? "") },
    fromtext: sessionName ? { text: String(sessionName) } : undefined,
    be: "router"
  };
}

export function buildRouterProduceRequestSentence({
  channelType,
  event,
  sourceAgentName,
  payloadId,
  responseText
} = {}) {
  return {
    mood: "do",
    su: { name: "router" },
    as: { wo: ROUTER_OPERATION_PRODUCE, text: ROUTER_OPERATION_PRODUCE },
    from: { name: agentEndpoint(sourceAgentName) },
    to: { name: channelEndpoint({ channelType, channelId: event?.channelId ?? "" }) },
    accordingto: { text: String(payloadId ?? "") },
    ob: { text: String(responseText ?? "") },
    be: "router"
  };
}
