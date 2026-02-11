function normalizeText(value) {
  if (value == null) return "";
  return String(value).trim();
}

function parseAgentFromEndpoint(endpoint) {
  const text = normalizeText(endpoint);
  if (!text) return "";
  const lower = text.toLowerCase();
  if (!lower.startsWith("agent ")) return "";
  return text.split(/\s+/).slice(1).join(" ").trim();
}

export function orchestrateRouterInput({
  routerInput,
  fallbackAgentName,
  fallbackSessionName
} = {}) {
  const agentName =
    normalizeText(routerInput?.for?.text)
    || parseAgentFromEndpoint(routerInput?.to?.name)
    || normalizeText(fallbackAgentName);
  const sessionName =
    normalizeText(routerInput?.fromtext?.text)
    || normalizeText(fallbackSessionName)
    || "session name channel";
  return {
    agentName,
    sessionName,
    payloadId: normalizeText(routerInput?.su?.name),
    payloadText: normalizeText(routerInput?.ob?.text),
    sourceEndpoint: normalizeText(routerInput?.from?.name),
    destinationEndpoint: normalizeText(routerInput?.to?.name)
  };
}
