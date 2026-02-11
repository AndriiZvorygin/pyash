function normalizeText(value) {
  if (value == null) return "";
  return String(value).trim();
}

function channelEndpoint({ channelType, channelId }) {
  return normalizeText(`channel ${channelType} room ${channelId}`);
}

function agentEndpoint(agentName) {
  return normalizeText(`agent ${agentName}`);
}

function assertRouterInputResult(result) {
  if (result?.be !== "input" || !result?.su?.name) {
    throw new Error("router input defective: invalid router input");
  }
}

function assertRouterProduceResult(result) {
  if (result?.be !== "produce" || !result?.su?.name) {
    throw new Error("router produce defective: invalid router produce");
  }
}

export function buildRouterInputSentence({
  channelType,
  event,
  targetAgentName,
  sessionName
} = {}) {
  return {
    mood: "do",
    su: { name: "router" },
    as: { wo: "input", text: "input" },
    from: { name: channelEndpoint({ channelType, channelId: event?.channelId ?? "" }) },
    to: { name: agentEndpoint(targetAgentName) },
    ob: { text: String(event?.text ?? "") },
    fromtext: sessionName ? { text: String(sessionName) } : undefined,
    be: "router"
  };
}

export function buildRouterProduceSentence({
  channelType,
  event,
  sourceAgentName,
  payloadId,
  responseText
} = {}) {
  return {
    mood: "do",
    su: { name: "router" },
    as: { wo: "produce", text: "produce" },
    from: { name: agentEndpoint(sourceAgentName) },
    to: { name: channelEndpoint({ channelType, channelId: event?.channelId ?? "" }) },
    accordingto: { text: String(payloadId ?? "") },
    ob: { text: String(responseText ?? "") },
    be: "router"
  };
}

export async function routeChannelInput({
  routerInterpretFn,
  channelType,
  event,
  targetAgentName,
  sessionName
} = {}) {
  const sentence = buildRouterInputSentence({
    channelType,
    event,
    targetAgentName,
    sessionName
  });
  const result = await routerInterpretFn(sentence);
  assertRouterInputResult(result);
  return result;
}

export async function routeChannelProduce({
  routerInterpretFn,
  channelType,
  event,
  sourceAgentName,
  payloadId,
  responseText
} = {}) {
  const sentence = buildRouterProduceSentence({
    channelType,
    event,
    sourceAgentName,
    payloadId,
    responseText
  });
  const result = await routerInterpretFn(sentence);
  assertRouterProduceResult(result);
  return result;
}
