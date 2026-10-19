import { remember } from "../../remember/index.mjs";
import { resolveRatifyDecision, normalizeRatifyAction } from "../ratify_policy.mjs";

const MUTATING_ACTIONS = new Set(["send", "delete", "purchase", "publish", "calendar-mutation"]);

function normalizedText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function capabilityConfigured(channelConfig = {}) {
  return channelConfig?.capabilitiesConfigured === true
    || Object.keys(channelConfig?.capabilities ?? {}).length > 0;
}

export function channelCapabilityAllowed(channelConfig = {}, capability) {
  const name = normalizedText(capability);
  if (!name) return false;
  if (!capabilityConfigured(channelConfig)) return true;
  return channelConfig?.capabilities?.[name] === true;
}

export function isCorrespondenceWorkerMutationAllowed({ agentName, action } = {}) {
  return normalizedText(agentName) === "correspondence worker"
    && normalizedText(action) === "send";
}

function capabilityForAction(action) {
  const normalized = normalizedText(action);
  if (normalized === "receive") return "receive";
  if (MUTATING_ACTIONS.has(normalized)) return normalized === "send" ? "send" : "mutate";
  return "";
}

function headquartersChannel(channelConfig = {}) {
  return channelConfig?.headquarters === true
    || channelConfig?.headquartersWork === true
    || normalizedText(channelConfig?.workKind) === "headquarters";
}

export async function authorizeChannelAction({
  worldRoot,
  agentName,
  channelConfig = {},
  action,
  proposal = {},
  rememberFn = remember
} = {}) {
  const canonicalAction = normalizeRatifyAction(action);
  if (!canonicalAction) {
    return {
      allowed: false,
      action: normalizedText(action),
      reason: "unsupported-action",
      capability: ""
    };
  }
  const capability = capabilityForAction(canonicalAction);
  if (!channelCapabilityAllowed(channelConfig, capability)) {
    return {
      allowed: false,
      action: canonicalAction,
      reason: "capability-deny",
      capability
    };
  }
  if (canonicalAction !== "send" && !isCorrespondenceWorkerMutationAllowed({
    agentName,
    action: canonicalAction
  })) {
    return {
      allowed: false,
      action: canonicalAction,
      reason: "correspondence-mutation-scope",
      capability
    };
  }

  const requiresRatification = headquartersChannel(channelConfig)
    || channelConfig?.ratifyOutbound === true;
  if (!requiresRatification) {
    return {
      allowed: true,
      action: canonicalAction,
      reason: "capability-allow",
      capability,
      ratify: null
    };
  }

  const ratify = await resolveRatifyDecision({
    worldRoot,
    mindName: agentName,
    action: canonicalAction,
    subjectName: proposal?.subjectName ?? proposal?.subject ?? "",
    toolName: proposal?.toolName ?? proposal?.tool ?? "",
    toolSignature: proposal?.toolSignature ?? proposal?.signature ?? "",
    headquarters: headquartersChannel(channelConfig),
    rememberFn
  });
  const mode = String(ratify?.mode ?? "ask").trim().toLowerCase();
  return {
    allowed: mode === "allow",
    action: canonicalAction,
    reason: mode === "allow" ? "ratify-allow" : mode === "deny" ? "ratify-deny" : "ratify-ask",
    capability,
    ratify: ratify ?? {
      mode: "ask",
      decision: "ask",
      raw: "unanswered",
      matchedKey: null,
      policyPath: ""
    }
  };
}
