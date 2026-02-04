import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { remember } from "../../remember/index.mjs";
import { recordArtifact, recordExchange } from "../../bridge/exchange.mjs";
import { throwErrorSentence } from "../../error.mjs";
import { getEffectiveVyahAspect } from "../../library/grammar/vyah.mjs";
import { resolveConfigBool } from "../../configure/env.mjs";
import { ensureAgentPathDir, resolveAgentCwd, resolveAgentPath } from "../../library/agent_cwd.mjs";
import { appendWorldActivity, isWorldToolsActive, resolveWorldAgent, resolveWorldPath, resolveWorldPlace, resolveWorldPlaceDir } from "../../library/world.mjs";
import { renderWriteValue, normalizeNewlines } from "./write_helpers.mjs";
import { startFileTail, makeStreamIncrementalWriter } from "./write_stream.mjs";
import { resolveKeyboardCommand, sendKeyboardText } from "./write_keyboard.mjs";

export default async function write(sentence, { remember: rememberFn = remember } = {}) {
  const modifiers = Array.isArray(sentence?.vyah?.ve?.values) ? sentence.vyah.ve.values : [];
  const aspect = getEffectiveVyahAspect(modifiers, { verb: "write", caseKey: "vyah" });
  const aspectKey = aspect === "stream" ? "stream" : "eval";
  if (aspectKey !== "eval" && aspectKey !== "stream") {
    throwErrorSentence({
      name: "write aspect invalid",
      message: `write does not support vyah ${aspect}`,
      from: { name: "write" },
      raw: { aspect }
    });
  }

  let target = sentence?.to?.filename;
  const targetName = sentence?.to?.name ?? sentence?.to?.wo ?? sentence?.to?.text;
  const isKeyboard = targetName === "keyboard";
  if (isKeyboard) {
    const enabled = resolveConfigBool("keyboard enabled", { rememberFn });
    if (enabled === false) {
      throwErrorSentence({
        name: "write keyboard disabled",
        message: "write keyboard disabled (set keyboard enabled to truth to allow)",
        from: { name: "write" },
        raw: { sentence }
      });
    }
    const hasDisplay = Boolean(process.env.DISPLAY);
    const hasX11 = fsSync.existsSync("/tmp/.X11-unix");
    if (!hasDisplay && !hasX11) {
      throwErrorSentence({
        name: "write keyboard headless",
        message: "write keyboard unavailable (headless: DISPLAY not set and /tmp/.X11-unix missing)",
        from: { name: "write" },
        raw: { sentence }
      });
    }
  }
  if (targetName && !isKeyboard && aspectKey !== "stream") {
    throwErrorSentence({
      name: "write target invalid",
      message: `write target invalid: to name ${targetName}`,
      from: { name: "write" },
      raw: { targetName }
    });
  }
  const formatParts = [];
  if (sentence?.become?.name) formatParts.push(sentence.become.name);
  if (sentence?.become?.text) formatParts.push(sentence.become.text);
  const formatRaw = formatParts.join(" ").trim().toLowerCase();
  let format = "pyash";
  if (formatRaw.includes("json") && formatRaw.includes("beautiful")) {
    format = "beautiful json";
  } else if (formatRaw.includes("json")) {
    format = "json";
  } else if (formatRaw.includes("yaml")) {
    format = "yaml";
  } else if (formatRaw.includes("csv")) {
    format = "csv";
  }
  if (aspectKey === "stream") {
    if (!isKeyboard) {
      throwErrorSentence({
        name: "write stream invalid",
        message: "write vyah stream requires to wo keyboard",
        from: { name: "write" },
        raw: { sentence }
      });
    }
    const streamName = sentence?.from?.name ?? sentence?.from?.text;
    if (!streamName) {
      throwErrorSentence({
        name: "write stream invalid",
        message: "write vyah stream requires from name <stream>",
        from: { name: "write" },
        raw: { sentence }
      });
    }
    const stream = rememberFn(streamName);
    const streamLike = stream && (stream.be === "stream" || stream.ob?.filename || Array.isArray(stream.ob?.ve?.values));
    if (!streamLike) {
      throwErrorSentence({
        name: "write stream missing",
        message: `stream not found: ${streamName} (set PYA_STREAM_STDOUT=0 or define stream stdout default to lie for hear stream handles)`,
        from: { name: "write" },
        raw: { streamName }
      });
    }
    const keyboardCmd = resolveKeyboardCommand({ rememberFn });
    let collected = "";
    let chain = Promise.resolve();
    const append = (chunk) => {
      if (!chunk) return;
      collected += chunk;
      chain = chain.then(() => sendKeyboardText(chunk, keyboardCmd)).catch(() => {});
    };
    if (Array.isArray(stream?.ob?.ve?.values)) {
      for (const value of stream.ob.ve.values) {
        append(String(value ?? ""));
        append("\n");
      }
      await chain;
    } else if (stream?.ob?.filename) {
      const filename = stream.ob.filename;
      let done = null;
      const waitForBlank = new Promise(resolve => { done = resolve; });
      const writer = makeStreamIncrementalWriter((chunk) => {
        append(chunk);
      });
      const stopTail = startFileTail({
        filename,
        onLine: (line) => {
          const trimmed = String(line ?? "").trim();
          if (!trimmed) return;
          if (trimmed.includes("[BLANK_AUDIO]") || trimmed.includes("[PYA_STREAM_END]")) {
            if (done) done();
            return;
          }
          writer.write(trimmed);
        }
      });
      await waitForBlank;
      stopTail();
      writer.finish();
      await chain;
    } else {
      throwErrorSentence({
        name: "write stream invalid",
        message: "write vyah stream requires a hear stream",
        from: { name: "write" },
        raw: { streamName }
      });
    }
    return { ob: { text: normalizeNewlines(collected).trimEnd() }, be: "write" };
  }

  const text = renderWriteValue(sentence.ob ?? {}, { rememberFn, format });
  const normalized = normalizeNewlines(text);
  if (isKeyboard) {
    const keyboardCmd = resolveKeyboardCommand({ rememberFn });
    try {
      await sendKeyboardText(normalized, keyboardCmd);
    } catch (err) {
      throwErrorSentence({
        name: "write keyboard defective",
        message: `write keyboard defective: ${err?.message ?? "unknown error"}`,
        from: { name: "write" },
        raw: { error: err?.message ?? String(err ?? "") }
      });
    }
  } else if (target) {
    const worldMode = isWorldToolsActive({ rememberFn });
    const agentCwd = resolveAgentCwd({ rememberFn });
    if (agentCwd && !path.isAbsolute(String(target))) {
      target = path.resolve(agentCwd, String(target));
    } else if (worldMode) {
      const place = resolveWorldPlace({ rememberFn }) ?? "commons";
      const placeDir = resolveWorldPlaceDir(place, { rememberFn });
      if (!placeDir) {
        throwErrorSentence({
          name: "write defective",
          message: "write defective: world place missing",
          from: { name: "write" },
          raw: { target }
        });
      }
      const resolvedTarget = path.resolve(placeDir, String(target));
      const { outside, root } = resolveWorldPath(resolvedTarget, { rememberFn });
      if (outside) {
        throwErrorSentence({
          name: "write defective",
          message: `write defective: outside world root (${root})`,
          from: { name: "write" },
          raw: { target }
        });
      }
      target = resolvedTarget;
    }
    const { resolved, outside, agentCwd: resolvedAgentCwd } = resolveAgentPath(target, { rememberFn });
    if (outside) {
      throwErrorSentence({
        name: "write defective",
        message: `write defective: outside agent cwd (${resolvedAgentCwd})`,
        from: { name: "write" },
        raw: { target }
      });
    }
    await ensureAgentPathDir(resolved, { agentCwd: resolvedAgentCwd, outside });
    target = resolved;
    if (worldMode) {
      await fs.mkdir(path.dirname(target), { recursive: true });
    }
    await fs.writeFile(target, normalized, "utf8");
    const buffer = Buffer.from(normalized, "utf8");
    const artifact = recordArtifact({ locator: target, producer: "exchange", bytes: buffer });
    if (artifact?.su?.name) {
      recordExchange({ artifactName: artifact.su.name, op: "write", producer: "exchange" });
    }
    if (worldMode) {
      const agent = resolveWorldAgent({ rememberFn }) ?? "agent";
      const place = resolveWorldPlace({ rememberFn }) ?? "commons";
      const placeDir = resolveWorldPlaceDir(place, { rememberFn });
      if (placeDir) {
        const rel = path.relative(placeDir, target);
        await appendWorldActivity({
          placeDir,
          sentence: {
            mood: "ya",
            su: { name: agent },
            to: { filename: rel },
            at: { date: new Date().toISOString() },
            be: "write"
          }
        });
      }
    }
  } else {
    // eslint-disable-next-line no-console
    console.log(text);
  }
  return { ob: { text: normalized }, be: "write" };
}

export const signatures = [
  { signatureWords: ["be", "write", "ob", "text"], handler: write },
  { signatureWords: ["be", "write", "ob", "num"], handler: write },
  { signatureWords: ["be", "write", "ob", "date"], handler: write },
  { signatureWords: ["be", "write", "ob", "bool"], handler: write },
  { signatureWords: ["be", "write", "ob", "hollow"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "text"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "num"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "date"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "bool"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "hollow"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "map"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "json", "map"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "vec"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "vec", "num"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "vec", "text"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "vec", "bool"], handler: write },
  { signatureWords: ["be", "write", "ob", "vec"], handler: write },
  { signatureWords: ["be", "write", "ob", "vec", "num"], handler: write },
  { signatureWords: ["be", "write", "ob", "vec", "text"], handler: write },
  { signatureWords: ["be", "write", "ob", "vec", "bool"], handler: write },
  { signatureWords: ["be", "write", "ob", "text", "to", "text"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "text", "to", "text"], handler: write },
  { signatureWords: ["be", "write", "ob", "text", "to", "wo", "keyboard"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "text", "to", "wo", "keyboard"], handler: write },
  { signatureWords: ["be", "write", "from", "name", "to", "text", "vyah", "stream"], handler: write },
  { signatureWords: ["be", "write", "from", "name", "text", "to", "text", "vyah", "stream"], handler: write },
  { signatureWords: ["be", "write", "from", "name", "stream", "to", "text", "vyah", "stream"], handler: write },
  { signatureWords: ["be", "write", "from", "name", "to", "wo", "keyboard", "vyah", "stream"], handler: write },
  { signatureWords: ["be", "write", "from", "name", "text", "to", "wo", "keyboard", "vyah", "stream"], handler: write },
  { signatureWords: ["be", "write", "from", "name", "stream", "to", "wo", "keyboard", "vyah", "stream"], handler: write },
  { signatureWords: ["be", "write", "from", "name", "filename", "to", "wo", "keyboard", "vyah", "stream"], handler: write },
  { signatureWords: ["be", "write", "become", "name", "csv", "ob", "name", "csv", "map"], handler: write },
  { signatureWords: ["be", "write", "become", "name", "json", "ob", "name", "json", "map"], handler: write },
  { signatureWords: ["be", "write", "become", "name", "yaml", "ob", "name", "json", "map"], handler: write },
  { signatureWords: ["be", "write", "become", "name", "json", "ob", "text"], handler: write },
  { signatureWords: ["be", "write", "become", "name", "json", "ob", "name", "text"], handler: write },
  { signatureWords: ["be", "write", "become", "name", "yaml", "ob", "text"], handler: write },
  { signatureWords: ["be", "write", "become", "name", "yaml", "ob", "name", "text"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "csv", "map"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "text"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "num"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "bool"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "hollow"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "name", "text"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "name", "num"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "name", "bool"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "name", "hollow"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "name", "vec"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "name", "vec", "num"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "name", "vec", "text"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "name", "vec", "bool"], handler: write },
  { signatureWords: ["be", "write", "ob", "text", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "num", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "date", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "bool", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "hollow", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "text", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "num", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "date", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "bool", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "hollow", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "map", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "json", "map", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "vec", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "vec", "num", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "vec", "text", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "vec", "bool", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "vec", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "vec", "num", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "vec", "text", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "vec", "bool", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "text", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "num", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "bool", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "hollow", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "name", "text", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "name", "num", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "name", "bool", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "name", "hollow", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "name", "json", "ob", "name", "json", "map", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "name", "csv", "ob", "name", "csv", "map", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "name", "yaml", "ob", "name", "json", "map", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "name", "yaml", "ob", "text", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "name", "yaml", "ob", "name", "text", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "csv", "map", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "name", "vec", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "name", "vec", "num", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "name", "vec", "text", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "name", "vec", "bool", "to", "filename"], handler: write }
];
