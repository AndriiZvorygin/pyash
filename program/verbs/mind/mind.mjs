// pyash/verbs/mind.mjs
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { remember, doRemember, getDefinitionEntry, allRemember } from "../../remember/index.mjs";
import { throwErrorSentence } from "../../error.mjs";
import { getEffectiveVyahAspect } from "../../library/grammar/vyah.mjs";
import { historyDialogueName, resetMindLogs as resetMindHistory, buildHistoryMessages } from "./history.mjs";
import { resetMindDebugCounters } from "./logging.mjs";
import { buildToolSchemas } from "./tooling.mjs";
import { buildAgentSystemPrompt, buildAgentNamingPrompt } from "../../agent/context.mjs";
import {
  resolveAgentHouse,
  ensureAgentDirs,
  generateSessionName,
  ensureSessionFile,
  ensureSessionFileAtPath,
  findSessionFileBySystemPrompt,
  readSessionMessages,
  appendSessionEntry,
  pickLatestSessionFile,
  buildSessionNamePrefix,
  buildSessionNameForDate,
  readSessionMessagesWithFallback,
  updateSessionSummary,
  normalizeHistoryWindow
} from "../../agent/session.mjs";
import { resolveConfigBool, resolveConfigMapBool, resolveConfigMapNum, resolveConfigText } from "../../configure/env.mjs";
import { recordMindAnswer } from "./series.mjs";
import { resolveMindPrompt, resolveGenitiveText, resolvePromptFromName } from "./resolve_prompt.mjs";
import { resolveHistoryContext } from "./history_context.mjs";
import { runToolChat } from "./tool_chat.mjs";
import { runGenerate } from "./generate.mjs";
import { mindSignatureWords } from "./signatures.mjs";
import { parse } from "../../understand/index.mjs";
import { consumeMindInterrupt } from "../../agent/interrupt.mjs";
import { enforceAutoDischarge } from "../../motor/provider_auto_discharge.mjs";

const DEFAULT_TOOL_MAP_NAME = "agent tools";
const DEFAULT_TOOL_MAP_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../module/agent_tools.pya"
);
const CHANNEL_EMPTY_REPLY_FALLBACK = "I received your message, but I could not generate a reply. Please retry.";
const loadedMindTuningKeys = new Set();
const missingMindTuningKeys = new Set();

function unescapeQuotedText(value) {
  return String(value ?? "")
    .replace(/\\\\/g, "\\")
    .replace(/\\"/g, "\"");
}

function extractAgentRuntimeMapText(text) {
  const source = String(text ?? "");
  const blockMatch = source.match(/su name agent runtime be map def([\s\S]*?)\n\s*prah\b/i);
  if (!blockMatch) return {};
  const block = blockMatch[1] ?? "";
  const values = {};
  const lineRegex = /^\s*su name ([^"\n]+?)\s+ob text\s+"((?:[^"\\]|\\.)*)"\s+ya\s*$/gim;
  for (const match of block.matchAll(lineRegex)) {
    const key = String(match[1] ?? "").trim().toLowerCase();
    const rawValue = String(match[2] ?? "");
    if (!key) continue;
    values[key] = unescapeQuotedText(rawValue).trim();
  }
  return values;
}

async function loadAgentRuntimeConfig(agentCwd) {
  const cwd = String(agentCwd ?? "").trim();
  if (!cwd) return {};
  const runtimePath = path.join(cwd, "conduct", "runtime.pya");
  let text = "";
  try {
    text = await fs.readFile(runtimePath, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return {};
    throw err;
  }
  const map = extractAgentRuntimeMapText(text);
  const backend = String(map.backend ?? "").trim();
  const model = String(map.model ?? "").trim();
  const host = String(map.host ?? map["ollama host"] ?? map["mind host"] ?? "").trim();
  const reasoningEffort = String(map["reasoning effort"] ?? map["mind reasoning effort"] ?? "").trim();
  const toolsMap = String(map["tools map"] ?? "").trim();
  return {
    backend,
    model,
    host,
    reasoningEffort,
    toolsMap
  };
}

function deriveMindTuningKey(model) {
  const raw = String(model ?? "").trim().toLowerCase();
  if (!raw) return "";
  const tail = raw.split("/").pop() ?? raw;
  const base = tail.split(":")[0] ?? tail;
  return base.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

async function ensureMindTuningLoaded(model) {
  const key = deriveMindTuningKey(model);
  if (!key) return key;
  if (loadedMindTuningKeys.has(key) || missingMindTuningKeys.has(key)) return key;
  const filename = path.resolve(process.cwd(), "mind", `${key}.pya`);
  try {
    await fs.access(filename);
  } catch {
    missingMindTuningKeys.add(key);
    return key;
  }
  const { interpret } = await import("../../bridge/index.mjs");
  try {
    await interpret({
      mood: "do",
      be: "import",
      from: { name: filename },
      ob: { name: "mind tuning" },
      to: { name: `mind tuning ${key}` }
    });
    loadedMindTuningKeys.add(key);
  } catch (err) {
    throwErrorSentence({
      name: "mind tuning defective",
      message: `mind tuning defective: ${err?.message ?? "cannot import tuning file"}`,
      from: { name: "mind" },
      raw: { model, filename }
    });
  }
  return key;
}

function readMapNum(map, keys = []) {
  for (const key of keys) {
    const entry = map?.[key];
    const direct = Number(entry?.ob?.num ?? entry?.num);
    if (Number.isFinite(direct)) return direct;
    const fromText = Number(entry?.ob?.text ?? entry?.text);
    if (Number.isFinite(fromText)) return fromText;
  }
  return null;
}

function normalizeNumPredict(value) {
  if (value === undefined || value === null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const whole = Math.trunc(numeric);
  if (whole <= 0) return null;
  return whole;
}

function readMapText(map, keys = []) {
  for (const key of keys) {
    const text = entryText(map?.[key]);
    if (text) return text;
  }
  return "";
}

function readMapBool(map, keys = []) {
  for (const key of keys) {
    const entry = map?.[key];
    const value = entry?.ob?.boolean ?? entry?.boolean;
    if (typeof value === "boolean") return value;
    const text = String(entry?.ob?.text ?? entry?.text ?? "").trim().toLowerCase();
    if (text === "truth" || text === "true" || text === "1" || text === "yes") return true;
    if (text === "lie" || text === "false" || text === "0" || text === "no") return false;
  }
  return false;
}

function readMapBoolNullable(map, keys = []) {
  for (const key of keys) {
    const entry = map?.[key];
    const value = entry?.ob?.boolean ?? entry?.boolean;
    if (typeof value === "boolean") return value;
    const text = String(entry?.ob?.text ?? entry?.text ?? "").trim().toLowerCase();
    if (text === "truth" || text === "true" || text === "1" || text === "yes") return true;
    if (text === "lie" || text === "false" || text === "0" || text === "no") return false;
  }
  return null;
}

function entryText(entry) {
  return String(entry?.ob?.text ?? entry?.text ?? "").trim();
}

function resolveMindTuningForModel(model, { rememberFn = remember } = {}) {
  const key = deriveMindTuningKey(model);
  if (!key) return null;
  const fact = rememberFn(`mind tuning ${key}`);
  const map = fact?.ob?.map;
  if (!map || typeof map !== "object") return null;
  return {
    temperature: readMapNum(map, ["temperature"]),
    topP: readMapNum(map, ["top p", "top_p"]),
    topK: readMapNum(map, ["top k", "top_k"]),
    minP: readMapNum(map, ["min p", "min_p"]),
    presencePenalty: readMapNum(map, ["presence penalty", "presence_penalty"]),
    numPredict: readMapNum(map, ["num predict", "num_predict", "max tokens", "max output tokens"]),
    think: readMapBoolNullable(map, ["think", "thinking"]),
    thinkPrefix: readMapText(map, ["think prefix", "think_prefix"]),
    stripThinkInHistory: readMapBool(map, ["strip think history", "strip think in history", "strip_think_in_history", "strip think"])
  };
}

function stripThinkBlock(text) {
  const source = String(text ?? "");
  if (!source.trim()) return source;
  const lower = source.toLowerCase();
  const openIndex = lower.indexOf("<think>");
  const closeIndex = lower.indexOf("</think>");
  if (openIndex === 0 && closeIndex > openIndex) {
    const rest = source.slice(closeIndex + "</think>".length).trim();
    return rest || source;
  }
  return source;
}

async function ensureDefaultToolMapLoaded() {
  const existing = remember(DEFAULT_TOOL_MAP_NAME);
  if (existing?.be === "map") return;
  let content = "";
  try {
    content = await fs.readFile(DEFAULT_TOOL_MAP_PATH, "utf8");
  } catch {
    return;
  }
  const lines = content.split(/\r?\n/).map(line => line.trim()).filter(line => line);
  let collecting = false;
  const entries = [];
  for (const line of lines) {
    const sentence = parse(line);
    if (!sentence) continue;
    if (!collecting) {
      if (sentence.mood === "def" && sentence.be === "map" && sentence.su?.name === DEFAULT_TOOL_MAP_NAME) {
        collecting = true;
      }
      continue;
    }
    if (sentence.mood === "prah") {
      break;
    }
    entries.push(sentence);
  }
  if (!entries.length) return;
  const map = {};
  for (const entry of entries) {
    const key = entry?.su?.name ?? entry?.su?.text;
    if (!key) continue;
    map[key] = entry;
  }
  if (!Object.keys(map).length) return;
  doRemember({
    mood: "ya",
    su: { name: DEFAULT_TOOL_MAP_NAME },
    be: "map",
    ob: { map }
  });
}

export async function mind_to_name_text(sentence, {
  inputs = [],
  onToolCall,
  sessionUserContent = "",
  sessionUserMetadata = null,
  sessionAssistantMetadata = null
} = {}) {
  const ob = sentence?.ob ?? {};
  const mindName = sentence?.for?.name ?? sentence?.to?.name ?? sentence?.su?.name ?? "mind";
  const outputName = sentence?.for?.name ? sentence?.to?.name : sentence?.totext?.name;
  const config = mindName ? remember(mindName) : null;
  const configSentence = config?.be === "mind" ? config : null;
  const vyahValues = Array.isArray(sentence?.vyah?.ve?.values)
    ? sentence.vyah.ve.values
    : (Array.isArray(configSentence?.vyah?.ve?.values) ? configSentence.vyah.ve.values : []);
  const aspect = getEffectiveVyahAspect(vyahValues, { verb: "mind", caseKey: "vyah" });
  const dialogue = historyDialogueName({ callSentence: sentence, configSentence, targetName: mindName });
  const configSessionHistoryWindow =
    resolveConfigMapNum("session configure", "history window", { rememberFn: remember })
    ?? resolveConfigMapNum("agent configure", "session history window", { rememberFn: remember });
  const historyWindow =
    normalizeHistoryWindow(
      sentence?.by?.num ??
    sentence?.by?.quantity?.num ??
    configSentence?.ob?.window?.num ??
    configSentence?.ob?.historyWindow?.num ??
    configSentence?.window ??
    configSentence?.historyWindow ??
    ob?.window?.num ??
    configSessionHistoryWindow ??
    8,
      { defaultPairs: 8, maxPairs: 200 }
    );

  const sentenceAgentCwd = sentence?.at?.filename ?? sentence?.at?.text ?? sentence?.at?.name ?? "";
  const agentRuntime = await loadAgentRuntimeConfig(sentenceAgentCwd);

  // Model resolution: explicit on call, then agent runtime, then per-mind config, then configured default.
  const explicitModel = sentence?.ob?.model ?? ob?.model ?? null;
  const configModel = configSentence?.as?.name ?? null;
  const runtimeModel = agentRuntime?.model ? String(agentRuntime.model).trim() : null;
  const configuredModel = resolveConfigText("mind model", { rememberFn: remember }) ?? null;
  const model = explicitModel ?? runtimeModel ?? configModel ?? configuredModel ?? "qwen3-vl:8b-instruct";
  await ensureMindTuningLoaded(model);
  const modelTuning = resolveMindTuningForModel(model, { rememberFn: remember });
  const configuredThink = resolveConfigMapBool("mind configure", "think", { rememberFn: remember });
  const configuredNumPredict = normalizeNumPredict(
    resolveConfigMapNum("mind configure", "max tokens", { rememberFn: remember })
    ?? resolveConfigMapNum("mind configure", "max output tokens", { rememberFn: remember })
    ?? resolveConfigMapNum("mind configure", "num predict", { rememberFn: remember })
    ?? resolveConfigMapNum("mind configure", "num_predict", { rememberFn: remember })
  );
  const callNumPredict = normalizeNumPredict(
    sentence?.atmost?.num
    ?? sentence?.atmost?.quantity?.num
  );
  const effectiveModelTuning = (() => {
    const tuning = modelTuning && typeof modelTuning === "object" ? { ...modelTuning } : {};
    if (typeof configuredThink === "boolean") tuning.think = configuredThink;
    if (configuredNumPredict !== null) tuning.numPredict = configuredNumPredict;
    if (callNumPredict !== null) tuning.numPredict = callNumPredict;
    return tuning;
  })();

  // Prompt resolution: config/call fromtext (discourse source) + call prompt/text
  const configPromptValue = configSentence?.fromtext ?? null;
  const callPromptValue = sentence?.fromtext ?? null;

  const { callPrompt: rawCallPrompt, resolvedConfigPrompt } = resolveMindPrompt({
    sentence,
    ob,
    configSentence,
    rememberFn: remember
  });
  const callPrompt = (() => {
    const prefix = String(effectiveModelTuning?.thinkPrefix ?? "").trim();
    const base = String(rawCallPrompt ?? "");
    if (!prefix) return base;
    if (base.startsWith(prefix)) return base;
    return `${prefix}\n${base}`.trim();
  })();

  const runtimeToolsMap = agentRuntime?.toolsMap ? String(agentRuntime.toolsMap).trim() : "";
  const toolMapName = sentence?.with?.name
    ?? (
      sentence?.with?.wo === "tools" || sentence?.with?.text === "tools"
        ? (runtimeToolsMap || DEFAULT_TOOL_MAP_NAME)
        : null
    );
  if (toolMapName === DEFAULT_TOOL_MAP_NAME) {
    await ensureDefaultToolMapLoaded();
  }
  const toolMapFact = toolMapName ? remember(toolMapName) : null;
  const toolMapDef = toolMapName ? getDefinitionEntry(toolMapName) : null;
  const toolMapDefSentence = toolMapDef ? allRemember()[toolMapDef.index] : null;
  const toolMapCwd =
    toolMapFact?.at?.filename ??
    toolMapFact?.at?.text ??
    toolMapFact?.at?.name ??
    toolMapDefSentence?.at?.filename ??
    toolMapDefSentence?.at?.text ??
    toolMapDefSentence?.at?.name ??
    null;
  const agentCwd = sentence?.at?.filename ?? sentence?.at?.text ?? sentence?.at?.name ?? toolMapCwd;
  const toolMapSandpit = toolMapFact?.as?.wo === "sandpit" || toolMapFact?.as?.text === "sandpit";
  const toolMapWorld = toolMapFact?.as?.wo === "world" || toolMapFact?.as?.text === "world";
  const agentEnabled = (() => {
    if (!toolMapFact || toolMapFact.be !== "map") return false;
    const entries = toolMapFact.ob?.map ?? {};
    for (const entry of Object.values(entries)) {
      if (!entry || entry.su?.name !== "agent") continue;
      if (entry?.ob?.boolean === true) return true;
      if (entry?.ob?.text && String(entry.ob.text).toLowerCase() === "truth") return true;
    }
    return false;
  })();
  if (toolMapName && agentCwd) {
    doRemember({
      mood: "ya",
      be: "cwd",
      su: { name: "agent cwd" },
      ob: { filename: String(agentCwd) }
    });
    if (toolMapSandpit || agentEnabled) {
      doRemember({
        mood: "ya",
        be: "truth",
        su: { name: "agent sandbox" },
        ob: { boolean: true }
      });
    }
  }
  if (toolMapName && toolMapWorld) {
    const worldRoot = agentCwd ?? "world";
    doRemember({
      mood: "ya",
      be: "truth",
      su: { name: "world tools" },
      ob: { boolean: true }
    });
    doRemember({
      mood: "ya",
      be: "root",
      su: { name: "world root" },
      ob: { filename: String(worldRoot) }
    });
    doRemember({
      mood: "ya",
      be: "text",
      su: { name: "world agent" },
      ob: { text: String(mindName) }
    });
  }
  const { tools, toolMap, toolBlock } = buildToolSchemas(toolMapName);
  const sessionNameHint = (() => {
    if (!toolMapFact || toolMapFact.be !== "map") return null;
    const entries = toolMapFact.ob?.map ?? {};
    for (const entry of Object.values(entries)) {
      if (!entry || entry.su?.name !== "session name") continue;
      if (typeof entry?.ob?.text === "string") return entry.ob.text;
      if (typeof entry?.ob?.name === "string") return entry.ob.name;
    }
    return null;
  })();
  const sessionNameFromFromtext = (() => {
    const raw = sentence?.fromtext?.name ?? sentence?.fromtext?.text ?? "";
    if (!raw) return null;
    const lower = String(raw).trim().toLowerCase();
    if (lower.startsWith("session name ")) {
      return String(raw).trim().slice("session name ".length).trim();
    }
    return null;
  })();
  const sessionFileOverride = (() => {
    const filename = sentence?.fromtext?.filename;
    if (!filename) return null;
    if (path.isAbsolute(filename)) return filename;
    return filename;
  })();
  const globalSessionNameHint = (() => {
    const fact = remember("session name");
    if (!fact) return null;
    if (typeof fact?.ob?.text === "string") return fact.ob.text;
    if (typeof fact?.ob?.name === "string") return fact.ob.name;
    return null;
  })();
  const explicitAgentHouse = String(sentenceAgentCwd ?? "").trim();
  const sessionAgentEnabled = agentEnabled || Boolean(explicitAgentHouse);
  const resolvedSessionAgentHouse = explicitAgentHouse
    ? path.resolve(explicitAgentHouse)
    : resolveAgentHouse({ mindName, rememberFn: remember });
  const interruptAgentHouse = resolvedSessionAgentHouse || (explicitAgentHouse ? path.resolve(explicitAgentHouse) : "");
  const assertNotInterrupted = async () => {
    if (!interruptAgentHouse) return;
    const interrupt = await consumeMindInterrupt({
      agentHouse: interruptAgentHouse,
      agentName: mindName
    });
    if (!interrupt) return;
    throwErrorSentence({
      name: "mind interrupted",
      message: "mind interrupted by stop request",
      from: { name: "mind" },
      raw: { interruptAt: interrupt.at, agentName: mindName }
    });
  };
  await assertNotInterrupted();
  if (agentEnabled) {
    doRemember({ mood: "ya", su: { name: "agent name" }, ob: { text: mindName }, be: "text" });
  }

  let { historySeriesName, historyMessages } = resolveHistoryContext({
    sentence,
    configSentence,
    historyWindow,
    dialogue,
    rememberFn: remember,
    resolveGenitiveText,
    resolvePromptFromName
  });
  const runtimeBackend = agentRuntime?.backend ? String(agentRuntime.backend).trim() : null;
  const runtimeHost = agentRuntime?.host ? String(agentRuntime.host).trim() : null;
  const runtimeReasoningEffort = agentRuntime?.reasoningEffort ? String(agentRuntime.reasoningEffort).trim() : null;
  const backendName = runtimeBackend || resolveConfigText("mind backend", { rememberFn: remember }) || null;
  const ollamaHost = runtimeHost || resolveConfigText("ollama host", { rememberFn: remember }) || null;
  const mindReasoningEffort = runtimeReasoningEffort || resolveConfigText("mind reasoning effort", { rememberFn: remember }) || null;
  const mindDebug = resolveConfigBool("mind debug", { rememberFn: remember }) === true;
  await enforceAutoDischarge({ activatingClass: "mind", activatingModel: model, rememberFn: remember });

  const debugMind = (label, payload) => {
    if (!mindDebug) return;
    const mode = payload?.mode ?? "generate";
    const host = payload?.host ?? "(unset)";
    const endpoint = typeof payload?.host === "string"
      ? `${payload.host.replace(/\/$/, "")}/api/${mode === "chat" ? "chat" : "generate"}`
      : "(unset)";
    const summary = {
      label,
      mode,
      model: payload?.model ?? null,
      stream: !!payload?.stream,
      host,
      endpoint
    };
    // eslint-disable-next-line no-console
    console.error(`[mind debug] ${JSON.stringify(summary)}`);
  };

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
  let sessionFile = null;
  let agentSystemPrompt = resolvedConfigPrompt;
  const systemLogPrompt = resolvedConfigPrompt ?? "";
  if (sessionAgentEnabled) {
    const agentHouse = resolvedSessionAgentHouse;
    const { sessionDir } = await ensureAgentDirs(agentHouse);
    agentSystemPrompt = await buildAgentSystemPrompt({
      agentHouse,
      mindName,
      configPrompt: resolvedConfigPrompt
    });
    const namingPrompt = resolvedConfigPrompt ?? "";
    const sessionNameSeed = sessionNameHint ?? globalSessionNameHint ?? sessionNameFromFromtext;
    if (sessionFileOverride || sessionNameSeed || !historySeriesName) {
      const promptText = namingPrompt || [callPrompt, inputText.trim()].filter(Boolean).join("\n\n");
      const datePrefix = buildSessionNamePrefix();
      if (sessionFileOverride) {
        const resolvedPath = path.isAbsolute(sessionFileOverride)
          ? sessionFileOverride
          : path.resolve(sessionDir, sessionFileOverride);
        sessionFile = await ensureSessionFileAtPath({
          sessionFile: resolvedPath,
          sessionName: path.basename(resolvedPath, path.extname(resolvedPath) || ".pya"),
          systemPrompt: systemLogPrompt,
          model
        });
      } else if (sessionNameSeed) {
        const baseName = String(sessionNameSeed).trim();
        const sessionName = buildSessionNameForDate({
          baseName,
          dateCompact: datePrefix.replace(/-$/, "")
        });
        sessionFile = sessionName ? await ensureSessionFile({
          sessionDir,
          sessionName,
          systemPrompt: systemLogPrompt,
          model
        }) : null;
      } else {
        sessionFile = await findSessionFileBySystemPrompt({
          sessionDir,
          datePrefix,
          systemPrompt: namingPrompt || systemLogPrompt
        });
        if (!sessionFile) {
          sessionFile = await pickLatestSessionFile(sessionDir, { datePrefix });
        }
        if (!sessionFile) {
          const generated = await generateSessionName({
            promptText: namingPrompt || promptText,
            model,
            backendName,
            ollamaHost,
            mindDebug,
            debugMind,
            rememberFn: remember
          });
          const sessionName = `${datePrefix}${generated}`;
          sessionFile = await ensureSessionFile({
            sessionDir,
            sessionName,
            systemPrompt: systemLogPrompt,
            model
          });
        }
      }
      if (sessionFile) {
        const sessionHistory = sessionNameSeed
          ? await readSessionMessagesWithFallback({
            sessionDir,
            baseName: String(sessionNameSeed).trim(),
            historyWindow
          })
          : await readSessionMessages({ sessionFile, historyWindow });
        historyMessages = sessionHistory.messages;
        if (sessionHistory.lastSystemModel && sessionHistory.lastSystemModel !== model) {
          await appendSessionEntry({
            sessionFile,
            role: "system",
            content: systemLogPrompt,
            model
          });
        }
        if (!sessionHistory.lastSystemModel) {
          await appendSessionEntry({
            sessionFile,
            role: "system",
            content: systemLogPrompt,
            model
          });
        }
      }
    }
  }
  if (toolMapName) {
    if (aspect === "stream") {
      throwErrorSentence({
        name: "mind aspect invalid",
        message: "mind stream is not supported with tools",
        from: { name: "mind" },
        raw: { aspect }
      });
    }
    const mockResponseRaw = resolveConfigText("mind response", { rememberFn: remember });
    responseText = await runToolChat({
      sentence,
      ob,
      mindName,
      model,
      dialogue,
      callPrompt,
      resolvedConfigPrompt: agentSystemPrompt,
      historyMessages,
      toolMapName,
      toolMap,
      tools,
      toolBlock,
      backendName,
      ollamaHost,
      reasoningEffort: mindReasoningEffort,
      modelTuning: effectiveModelTuning,
      mindDebug,
      debugMind,
      inputs: { inputText, mockResponseRaw, imageInputs: inputs },
      onToolCall,
      checkInterrupted: assertNotInterrupted
    });
  } else {
    const { responseText: text, stream } = await runGenerate({
      sentence,
      ob,
      mindName,
      model,
      dialogue,
      historyMessages,
      callPrompt,
      resolvedConfigPrompt: agentSystemPrompt,
      toolMapName,
      backendName,
      ollamaHost,
      reasoningEffort: mindReasoningEffort,
      modelTuning: effectiveModelTuning,
      mindDebug,
      debugMind,
      outputName,
      historySeriesName,
      aspect,
      inputText,
      inputs,
      checkInterrupted: assertNotInterrupted
    });
    if (stream) return stream;
    responseText = text ?? "";
  }

  if (!responseText && String(outputName ?? "").trim().endsWith("_channel_out")) {
    responseText = CHANNEL_EMPTY_REPLY_FALLBACK;
  }
  if (effectiveModelTuning?.stripThinkInHistory) {
    responseText = stripThinkBlock(responseText);
  }

  if (sessionAgentEnabled && sessionFile) {
    const userContent = String(sessionUserContent || callPrompt || "");
    await appendSessionEntry({
      sessionFile,
      role: "user",
      content: userContent,
      metadata: sessionUserMetadata
    });
    await appendSessionEntry({
      sessionFile,
      role: "agent",
      content: responseText || "",
      metadata: sessionAssistantMetadata
    });
    const agentHouse = resolvedSessionAgentHouse;
    await updateSessionSummary({
      agentHouse,
      mindName,
      backendName,
      model,
      ollamaHost,
      mindDebug,
      debugMind,
      rememberFn: remember,
      callPrompt: callPrompt || "",
      responseText: responseText || ""
    });
  }

  // Record turn so future calls have context
  const answerSentence = recordMindAnswer({ mindName, dialogue, callPrompt, responseText, outputName, historySeriesName });
  return answerSentence;
}

export default mind_to_name_text;

export { buildHistoryMessages };
export function resetMindLogs() {
  resetMindHistory();
  resetMindDebugCounters();
}

export const signatures = mindSignatureWords.map(signatureWords => ({ signatureWords, handler: mind_to_name_text }));
