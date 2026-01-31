import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import { resolveWhisperStreamBinary, resolveModelPath, resolveHearLanguage, resolveHearCapture, resolveHearPrompt } from "./config.mjs";
import { parseFixtureLines, buildStreamTranscript, resolveStreamStdoutEnabled, maybeEnableStreamStdout, startStreamEndWatcher } from "./stream.mjs";
import { resolveStreamOutputPath } from "./paths.mjs";
import { throwErrorSentence } from "../../error.mjs";
import { makeStream } from "../../library/runtimePrimitives.mjs";

export async function handleHearStream({ sentence, rememberFn, fixture, hearStreamProcesses }) {
  const streamName = sentence?.su?.name ?? "hear stream";
  let transcript = "";
  let backend = "fixture";
  let model = null;
  if (fixture !== undefined) {
    const values = parseFixtureLines(fixture);
    if (resolveStreamStdoutEnabled({ rememberFn })) {
      for (const line of values) {
        const trimmed = String(line ?? "").trim();
        if (trimmed) process.stdout.write(`${trimmed}\n`);
      }
      transcript = values.join("\n");
      backend = "fixture";
      return { transcript, backend, model };
    }
    return {
      stream: makeStream({
        name: streamName,
        state: "open",
        ob: { ve: { values }, index: 0, kind: "hear", final: true }
      })
    };
  }

  const whisperBin = resolveWhisperStreamBinary({ rememberFn });
  const modelPath = resolveModelPath({ rememberFn });
  const streamOutputPath = resolveStreamOutputPath(sentence);
  const captureId = resolveHearCapture({ rememberFn });
  const language = resolveHearLanguage({ rememberFn });
  const prompt = resolveHearPrompt(sentence);
  await fs.mkdir(path.dirname(streamOutputPath), { recursive: true });
  fsSync.writeFileSync(streamOutputPath, "");
  const args = ["-c", String(captureId), "-m", String(modelPath), "-l", String(language), "-f", String(streamOutputPath)];
  if (prompt) {
    args.push("--prompt", prompt);
  }
  const proc = spawn(String(whisperBin), args, {
    stdio: ["ignore", "pipe", "pipe"]
  });
  hearStreamProcesses.set(streamName, { proc });

  if (process.stdin?.isTTY !== false && resolveStreamStdoutEnabled({ rememberFn })) {
    let done = null;
    const waitForEnd = new Promise(resolve => { done = resolve; });
    const stopTail = maybeEnableStreamStdout(streamOutputPath, { onBlank: () => done?.(), rememberFn });
    const stopBlankWatcher = resolveStreamStdoutEnabled({ rememberFn })
      ? null
      : startStreamEndWatcher(streamOutputPath, { onBlank: () => done?.() });
    await new Promise(resolve => {
      process.stdin.resume();
      const finish = () => resolve();
      process.stdin.once("end", finish);
      process.stdin.once("close", finish);
      waitForEnd.then(finish);
    });
    if (process.stdin?.isTTY !== false) {
      process.stdin.pause();
    }
    proc.kill("SIGINT");
    hearStreamProcesses.delete(streamName);
    stopTail();
    if (stopBlankWatcher) stopBlankWatcher();
    try {
      transcript = buildStreamTranscript(await fs.readFile(streamOutputPath, "utf8"));
    } catch (err) {
      throwErrorSentence({
        name: "hear defective",
        message: "hear defective: missing transcript",
        from: { name: "hear" },
        raw: { outputPath: streamOutputPath, error: err?.message }
      });
    }
    backend = "whisper-stream";
    model = modelPath;
    return { transcript, backend, model };
  }

  const stopWatcher = startStreamEndWatcher(streamOutputPath, {
    onBlank: () => {
      proc.kill("SIGINT");
      const current = hearStreamProcesses.get(streamName);
      if (current?.stopWatcher) current.stopWatcher();
      hearStreamProcesses.delete(streamName);
    }
  });
  const current = hearStreamProcesses.get(streamName);
  if (current) {
    current.stopWatcher = stopWatcher;
  }
  maybeEnableStreamStdout(streamOutputPath, { rememberFn });
  return {
    stream: makeStream({
      name: streamName,
      state: "open",
      ob: { filename: streamOutputPath, index: 0, kind: "hear", backend: "whisper-stream" }
    })
  };
}
