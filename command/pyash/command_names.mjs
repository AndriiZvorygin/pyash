export const PYASH_COMMAND_NAMES = Object.freeze([
  "run",
  "saddle",
  "resume",
  "repl",
  "configure",
  "calendar",
  "channel",
  "codex",
  "agent",
  "verify",
  "compile",
  "translate",
  "dictionary",
  "help"
]);

export function minimumUniquePrefix(command, commandNames = PYASH_COMMAND_NAMES) {
  const normalized = String(command ?? "").toLowerCase();
  if (!commandNames.includes(normalized)) return null;
  for (let length = 1; length <= normalized.length; length += 1) {
    const prefix = normalized.slice(0, length);
    if (commandNames.filter((name) => name.startsWith(prefix)).length === 1) return prefix;
  }
  return normalized;
}

export function resolvePyashCommand(input, commandNames = PYASH_COMMAND_NAMES) {
  const normalized = String(input ?? "").toLowerCase();
  if (!normalized) return { command: null, ambiguous: [] };
  if (commandNames.includes(normalized)) return { command: normalized, ambiguous: [] };
  const matches = commandNames.filter((name) => name.startsWith(normalized));
  if (matches.length === 1) return { command: matches[0], ambiguous: [] };
  return { command: null, ambiguous: matches };
}

export function renderPyashCommandPrefixes(commandNames = PYASH_COMMAND_NAMES) {
  return commandNames
    .map((name) => `${minimumUniquePrefix(name, commandNames)}=${name}`)
    .join(", ");
}
