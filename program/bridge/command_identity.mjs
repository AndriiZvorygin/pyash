let commandOrdinal = 0;
let pendingResumeIdentity;

export const COMMAND_RESULT_IDENTITY_PROTOCOL_NAME = "command result identity protocol";
export const COMMAND_RESULT_IDENTITY_PROTOCOL_VERSION = "v1";

export function commandResultIdentityProtocolSentence() {
  return {
    mood: "ya",
    exists: true,
    su: { name: COMMAND_RESULT_IDENTITY_PROTOCOL_NAME },
    ob: { text: COMMAND_RESULT_IDENTITY_PROTOCOL_VERSION },
    be: "text"
  };
}

export function isCommandResultIdentityProtocolSentence(sentence) {
  return sentence?.be === "text"
    && sentence?.su?.name === COMMAND_RESULT_IDENTITY_PROTOCOL_NAME
    && sentence?.ob?.text === COMMAND_RESULT_IDENTITY_PROTOCOL_VERSION;
}

export function isCommandResultIdentityProtocolMarker(sentence) {
  return sentence?.be === "text" && sentence?.su?.name === COMMAND_RESULT_IDENTITY_PROTOCOL_NAME;
}

export function resetCommandIdentity() {
  commandOrdinal = 0;
  pendingResumeIdentity = undefined;
}

export function allocateCommandIdentity() {
  commandOrdinal += 1;
  const ordinal = String(commandOrdinal).padStart(6, "0");
  return {
    ordinal,
    name: `command request ${ordinal}`
  };
}

export function restoreCommandIdentity(name) {
  const normalized = String(name ?? "").trim();
  const match = normalized.match(/^command request (\d{6})$/u);
  if (!match) return null;
  commandOrdinal = Math.max(commandOrdinal, Number(match[1]));
  return { ordinal: match[1], name: normalized };
}

export function setCommandResumeIdentity(name) {
  pendingResumeIdentity = String(name ?? "").trim();
}

export function consumeCommandResumeIdentity() {
  const identity = pendingResumeIdentity;
  pendingResumeIdentity = undefined;
  return identity;
}

export async function withCommandResumeIdentity(name, callback) {
  const prior = pendingResumeIdentity;
  setCommandResumeIdentity(name);
  try {
    return await callback();
  } finally {
    pendingResumeIdentity = prior;
  }
}

export function isCommandRequestIdentity(value) {
  return /^command request \d{6}$/u.test(String(value ?? "").trim());
}

export function isCommandRequestIdentityLike(value) {
  return String(value ?? "").trim().startsWith("command request ");
}
