function parseCommandResumeToken(sentence = {}) {
  const text = String(sentence?.fromtext?.text ?? "").trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function formatRatifyToolResult(toolName = "", sentence = {}) {
  if (sentence?.be !== "ratify") return "";
  const token = parseCommandResumeToken(sentence);
  if (token?.kind !== "command") return "";
  const message = String(sentence?.ob?.text ?? "").trim();
  const approval = {
    status: "approval_required"
  };
  const tool = String(toolName ?? "").trim();
  const request = String(sentence?.to?.name ?? token?.requestIdentity ?? "").trim();
  const commandClass = String(token?.class ?? "").trim();
  const command = String(token?.text ?? "").trim();
  if (tool) approval.tool = tool;
  if (request) approval.request = request;
  if (commandClass) approval.command_class = commandClass;
  if (command) approval.command = command;
  if (message) approval.message = message;
  return JSON.stringify(approval, null, 2);
}
