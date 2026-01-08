// pyash/verbs/mind.mjs
import ollama from "../../motor/ollama.mjs";
import { remember, doRemember } from "../../remember/index.mjs";
import { sentenceToPyash } from "../../beautiful.mjs";
import { throwErrorSentence } from "../../error.mjs";
import { getEffectiveVyahAspect } from "../../library/grammar/vyah.mjs";
import { makeStream } from "../../library/runtimePrimitives.mjs";
import { appendLog, buildHistoryMessages, historyDialogueName, nextAnswerName, resetMindLogs as resetMindHistory } from "./history.mjs";
import { recordMindJson, resetMindDebugCounters, stripContext } from "./logging.mjs";
import { buildToolSchemas, buildToolSentence, toolListFromMap } from "./tooling.mjs";

async function resolveInterpret() {
  const mod = await import("../../bridge/index.mjs");
  return mod.interpret;
}

export async function mind_to_name_text(sentence, { inputs = [] } = {}) {
  const ob = sentence?.ob ?? {};
  const mindName = sentence?.for?.name ?? sentence?.to?.name ?? sentence?.su?.name ?? "mind";
  const outputName = sentence?.for?.name ? sentence?.to?.name : sentence?.totext?.name;
  const config = mindName ? remember(mindName) : null;
  const configSentence = config?.be === "mind" ? config : null;
  const vyahValues = Array.isArray(sentence?.vyah?.ve?.values)
    ? sentence.vyah.ve.values
    : (Array.isArray(configSentence?.vyah?.ve?.values) ? configSentence.vyah.ve.values : []);
  const aspect = getEffectiveVyahAspect(vyahValues, { verb: "mind", caseKey: "vyah" });
  let streamChunks = null;
  const dialogue = typeof sentence?.from?.text === "string"
    ? sentence.from.text
    : historyDialogueName({ callSentence: sentence, configSentence, targetName: mindName });
  const historyWindow =
    sentence?.by?.num ??
    sentence?.by?.quantity?.num ??
    configSentence?.ob?.window?.num ??
    configSentence?.ob?.historyWindow?.num ??
    configSentence?.window ??
    configSentence?.historyWindow ??
    ob?.window?.num ??
    8;

  // Model resolution: explicit on call or from config via state (keyword "as")
  const explicitModel = sentence?.ob?.model ?? ob?.model ?? null;
  const configModel = configSentence?.as?.name ?? null;
  const model = explicitModel ?? configModel ?? "qwen3-vl:8b-instruct";

  // Prompt resolution: config accordingto (discourse) + call prompt/text
  const configPrompt = configSentence?.accordingto?.name ?? null;

  const callPrompt =
    sentence?.with?.text ??
    sentence?.ob?.text ??
    (sentence?.ob?.name && !sentence?.ob?.model ? sentence?.ob?.name : null) ??
    ob?.text ??
    (ob?.name && !ob?.model ? ob?.name : null);

  const toolMapName = sentence?.with?.name ?? null;
  const { tools, toolMap, toolBlock } = buildToolSchemas(toolMapName);

  const historyMessages = buildHistoryMessages(dialogue, { window: historyWindow });

  // Combine upstream inputs into a context string
  let inputText = "";
  for (const inp of inputs) {
    if (typeof inp === "string") {
      inputText += inp + "\n";
    } else if (inp?.text) {
      inputText += inp.text + "\n";
    } else if (inp != null) {
      inputText += JSON.stringify(inp) + "\n";
    }
  }

  let responseText = "";
  if (toolMapName) {
    if (aspect === "stream") {
      throwErrorSentence({
        name: "mind aspect invalid",
        message: "mind stream is not supported with tools",
        from: { name: "mind" },
        raw: { aspect }
      });
    }
    const messages = [];
    if (configPrompt) messages.push({ role: "system", content: configPrompt });
    if (toolBlock) messages.push({ role: "system", content: toolBlock });
    if (historyMessages.length) messages.push(...historyMessages);
    const userContent = [callPrompt, inputText.trim()].filter(Boolean).join("\n\n");
    messages.push({ role: "user", content: userContent });

    const interpret = await resolveInterpret();
    const maxToolTurns = 6;
    let turns = 0;
    let lastResponse = null;

    while (turns < maxToolTurns) {
      turns += 1;
      const mockResponse = typeof process !== "undefined" ? process?.env?.PYA_MIND_RESPONSE : undefined;
      if (mockResponse) {
        try {
          lastResponse = JSON.parse(mockResponse);
        } catch {
          lastResponse = { message: { content: mockResponse } };
        }
      } else {
        const requestPayload = { model, messages, tools, stream: false };
        recordMindJson({ targetName: mindName, label: "request", payload: requestPayload });
        lastResponse = await ollama.chat(requestPayload);
      }
      recordMindJson({ targetName: mindName, label: "response", payload: stripContext(lastResponse) });

      const toolCalls = lastResponse?.message?.tool_calls;
      if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
        responseText = lastResponse?.message?.content ?? "";
        break;
      }

      const assistantMessage = {
        role: "assistant",
        content: lastResponse?.message?.content ?? "",
        tool_calls: toolCalls
      };
      messages.push(assistantMessage);
      appendLog(dialogue, { role: "assistant", content: assistantMessage.content });

      for (const call of toolCalls) {
        const toolName = call?.function?.name ?? call?.name;
        if (!toolName || !toolMap.has(toolName)) {
          throwErrorSentence({
            name: "tool defective",
            message: `unknown tool: ${toolName}`,
            from: { name: "mind" },
            raw: call
          });
        }
        const capability = toolMap.get(toolName);
        const toolSentence = buildToolSentence({
          capability,
          args: call?.function?.arguments ?? call?.arguments
        });
        const toolResult = await interpret(toolSentence);
        const toolText = toolResult && typeof toolResult === "object" ? sentenceToPyash(toolResult) : String(toolResult ?? "");
        messages.push({ role: "tool", tool_name: toolName, content: toolText });
        appendLog(dialogue, { role: "tool", content: toolText });
      }
    }

    if (!responseText) {
      responseText = lastResponse?.message?.content ?? "";
    }
  } else {
    const promptParts = [];
    if (configPrompt) promptParts.push(configPrompt);
    const toolList = toolListFromMap(toolMapName);
    if (toolList) promptParts.push(toolList);
    if (historyMessages.length) {
      const histText = historyMessages
        .map(m => `${m.role.toUpperCase()}: ${m.content}`)
        .join("\n");
      promptParts.push(histText);
    }
    if (callPrompt) promptParts.push(callPrompt);
    const fullPrompt = promptParts.filter(Boolean).join("\n\n") + (inputText ? "\n\n" + inputText : "");
    const mockResponse = typeof process !== "undefined" ? process?.env?.PYA_MIND_RESPONSE : undefined;
    if (mockResponse) {
      responseText = mockResponse;
    } else if (aspect === "stream") {
      recordMindJson({ targetName: mindName, label: "request", payload: { model, prompt: fullPrompt.trim(), stream: true } });
      const streamed = await ollama.generateStream({
        model,
        prompt: fullPrompt.trim(),
        onChunk: process?.env?.PYA_STREAM_STDOUT === "1"
          ? (chunk) => { if (chunk) process.stdout.write(String(chunk)); }
          : undefined
      });
      streamChunks = Array.isArray(streamed?.chunks) ? streamed.chunks : null;
      recordMindJson({ targetName: mindName, label: "response", payload: stripContext({ response: streamed.text, chunks: streamChunks }) });
      responseText = streamed.text;
    } else {
      recordMindJson({ targetName: mindName, label: "request", payload: { model, prompt: fullPrompt.trim(), stream: true } });
      const raw = await ollama.generate(model, fullPrompt.trim());
      recordMindJson({ targetName: mindName, label: "response", payload: stripContext({ response: raw }) });
      responseText = raw;
    }
  }

  // Record turn so future calls have context
  const { count, name: answerName } = nextAnswerName(mindName, dialogue);
  if (callPrompt) {
    doRemember({
      mood: "ya",
      su: { name: `${mindName} ${dialogue} question ${count}` },
      be: "write",
      from: { name: "user" },
      ob: { text: callPrompt }
    });
    appendLog(dialogue, { role: "user", content: callPrompt });
  }
  const answerSentence = {
    mood: "ya",
    su: { name: answerName },
    be: "answer",
    from: { name: mindName },
    ob: { text: responseText }
  };
  doRemember(answerSentence);
  doRemember({
    ...answerSentence,
    su: { name: "result" }
  });
  if (outputName) {
    doRemember({
      ...answerSentence,
      su: { name: outputName }
    });
  }
  doRemember({
    mood: "ya",
    su: { name: `${mindName} ${dialogue} answer ${count}` },
    be: "answer",
    from: { name: mindName },
    ob: { text: responseText }
  });
  appendLog(dialogue, { role: "assistant", content: responseText });

  if (aspect === "stream") {
    const streamName = sentence?.su?.name ?? outputName ?? `${mindName ?? "mind"} stream`;
    const chunks = (Array.isArray(streamChunks) && streamChunks.length > 0)
      ? streamChunks
      : String(responseText ?? "")
        .split(/\s+/)
        .filter(Boolean);
    return makeStream({
      name: streamName,
      state: "open",
      ob: { ve: { values: chunks }, index: 0 }
    });
  }

  return answerSentence;
}

export default mind_to_name_text;

export { buildHistoryMessages };
export function resetMindLogs() {
  resetMindHistory();
  resetMindDebugCounters();
}

export const signatures = [
  { signatureWords: ["be", "write", "ob", "text", "to", "name", "mind", "vyah", "stream"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "ob", "text", "to", "name", "mind", "with", "name", "map", "vyah", "stream"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "ob", "name", "text", "to", "name", "mind", "vyah", "stream"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "ob", "name", "text", "to", "name", "mind", "with", "name", "map", "vyah", "stream"], handler: mind_to_name_text },
  // Type-style target: write ... to name mind
  { signatureWords: ["be", "write", "ob", "text", "to", "name", "mind"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "ob", "text", "to", "name", "mind", "with", "name", "map"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "ob", "name", "text", "to", "name", "mind"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "ob", "name", "text", "to", "name", "mind", "with", "name", "map"], handler: mind_to_name_text },
  // New preferred form: for name <mind> to name <output>
  { signatureWords: ["be", "write", "for", "name", "mind", "ob", "text", "to", "name", "text"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "for", "name", "mind", "ob", "name", "text", "to", "name", "text"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "for", "name", "mind", "ob", "text", "to", "text"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "for", "name", "mind", "ob", "name", "text", "to", "text"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "for", "name", "mind", "ob", "text", "to", "name", "text", "with", "name", "map"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "for", "name", "mind", "ob", "name", "text", "to", "name", "text", "with", "name", "map"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "for", "name", "mind", "ob", "text", "to", "text", "with", "name", "map"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "for", "name", "mind", "ob", "name", "text", "to", "text", "with", "name", "map"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "for", "name", "mind", "ob", "text", "to", "name", "text", "vyah", "stream"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "for", "name", "mind", "ob", "name", "text", "to", "name", "text", "vyah", "stream"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "for", "name", "mind", "ob", "text", "to", "text", "vyah", "stream"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "for", "name", "mind", "ob", "name", "text", "to", "text", "vyah", "stream"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "for", "name", "mind", "ob", "text", "to", "name", "text", "vyah", "stream", "with", "name", "map"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "for", "name", "mind", "ob", "name", "text", "to", "name", "text", "vyah", "stream", "with", "name", "map"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "for", "name", "mind", "ob", "text", "to", "text", "vyah", "stream", "with", "name", "map"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "for", "name", "mind", "ob", "name", "text", "to", "text", "vyah", "stream", "with", "name", "map"], handler: mind_to_name_text },
  // Legacy compatibility: to name <mind> totext name <output>
  { signatureWords: ["be", "write", "ob", "text", "to", "name", "mind", "totext", "name", "text"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "ob", "name", "text", "to", "name", "mind", "totext", "name", "text"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "ob", "text", "to", "name", "mind", "totext", "text"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "ob", "name", "text", "to", "name", "mind", "totext", "text"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "ob", "text", "to", "name", "mind", "totext", "name", "text", "with", "name", "map"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "ob", "name", "text", "to", "name", "mind", "totext", "name", "text", "with", "name", "map"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "ob", "text", "to", "name", "mind", "totext", "text", "with", "name", "map"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "ob", "name", "text", "to", "name", "mind", "totext", "text", "with", "name", "map"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "ob", "text", "to", "name", "mind", "totext", "name", "text", "vyah", "stream"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "ob", "name", "text", "to", "name", "mind", "totext", "name", "text", "vyah", "stream"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "ob", "text", "to", "name", "mind", "totext", "text", "vyah", "stream"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "ob", "name", "text", "to", "name", "mind", "totext", "text", "vyah", "stream"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "ob", "text", "to", "name", "mind", "totext", "name", "text", "vyah", "stream", "with", "name", "map"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "ob", "name", "text", "to", "name", "mind", "totext", "name", "text", "vyah", "stream", "with", "name", "map"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "ob", "text", "to", "name", "mind", "totext", "text", "vyah", "stream", "with", "name", "map"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "ob", "name", "text", "to", "name", "mind", "totext", "text", "vyah", "stream", "with", "name", "map"], handler: mind_to_name_text }
];
