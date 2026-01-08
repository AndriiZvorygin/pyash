const mindLogs = new Map();
const mindAnswerCounters = new Map();

export function historyDialogueName({ callSentence, configSentence, targetName }) {
  if (typeof callSentence?.from?.text === "string") return callSentence.from.text;
  if (callSentence?.fromtext?.name) return String(callSentence.fromtext.name);
  if (typeof callSentence?.fromtext?.text === "string") return callSentence.fromtext.text;
  if (typeof configSentence?.from?.text === "string") return configSentence.from.text;
  if (configSentence?.fromtext?.name) return String(configSentence.fromtext.name);
  if (typeof configSentence?.fromtext?.text === "string") return configSentence.fromtext.text;
  if (targetName) return `${targetName} story`;
  return "mind story";
}

export function appendLog(dialogue, entry) {
  if (!dialogue) return;
  const arr = mindLogs.get(dialogue) || [];
  arr.push(entry);
  mindLogs.set(dialogue, arr);
}

export function buildHistoryMessages(dialogue, { window = 8 } = {}) {
  if (!dialogue) return [];
  const log = mindLogs.get(dialogue) || [];
  const max = window * 2;
  return log.slice(-max);
}

export function nextAnswerName(targetName, dialogue) {
  const key = dialogue || targetName || "mind";
  const count = (mindAnswerCounters.get(key) || 0) + 1;
  mindAnswerCounters.set(key, count);
  return { count, name: targetName ? `${targetName} answer ${count}` : `mind answer ${count}` };
}

export function resetMindLogs() {
  mindLogs.clear();
  mindAnswerCounters.clear();
}
