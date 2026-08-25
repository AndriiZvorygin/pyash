let commandOrdinal = 0;

export function resetCommandIdentity() {
  commandOrdinal = 0;
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

export function isCommandRequestIdentity(value) {
  return /^command request \d{6}$/u.test(String(value ?? "").trim());
}

export function isCommandRequestIdentityLike(value) {
  return String(value ?? "").trim().startsWith("command request ");
}
