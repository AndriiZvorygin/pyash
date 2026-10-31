import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { remember } from "../../remember/index.mjs";
import { renderSayValue } from "../say.mjs";
import { recordArtifact } from "../../bridge/exchange.mjs";
import { throwErrorSentence } from "../../error.mjs";
import { canonicalJsonStringify, metadataPathForOutput, resolveOutputPath, sha256 } from "../piper_utils.mjs";
import { hasSpeakableContent } from "../../library/prose_segmentation.mjs";
import { resolveHost, resolveToneStrategy, resolvePostProcessEnabled, resolvePostProcessFilter, resolveKeepChunkArtifacts, resolveClipVerifyEnabled, resolveClipVerifyAllChunks, resolveClipVerifyMaxRetries, resolveClipVerifyTailWords, resolveClipVerifyWindowMs, resolveClipVerifyPeakDb, resolveClipVerifyDeltaDb, resolveClipVerifyMinTailMs, resolveClipVerifyMinTailWords, resolveClipVerifyTailGapGuardEnabled, resolveClipVerifyStrict, resolveTailPadMs, resolveChunkTailPadMs, resolveTailPauseMarkup, resolveClipVerifyHost, resolveClipVerifyWorkflowRoot, resolveClipVerifyWorkflowName, resolveQwenSaySanitizeMap } from "./config.mjs";
import { renderSayPromptSeries, resolveSayPromptSeriesPath, pathExists, resolveToneManifestInstructs, resolveWorkflowAndTone, inferChunkTone, resolveChunkInstructs, normalizeToneInstruction, planChunkInstructs } from "./prompt.mjs";
import { countWords, assertChunkIntegrity, normalizeQwenSayChunkText, ensureTrailingDoublePeriod, applyTailPauseMarkup, sanitizeQwenSayScriptText, splitQwenSayTextChunks } from "./text.mjs";
import { runQwenSay, randomChunkSeed, postProcessQwenSayAudio, concatAudioChunks, padAudioTail, probeDurationSecondsSafe } from "./audio.mjs";
import { expectedTailTokens, verifyAsrTailMatchUsingTranscriptAndTimestamps, applyTailGapGuard, tightenRetryChunkText, parseTailEndSeconds, asrEvidenceUnavailable, detectHotTailSuspect, verifyChunkTailWithQwenAsr } from "./verify.mjs";

export async function qwenSay(
  sentence,
  {
    remember: rememberFn = remember,
    runSayFn = runQwenSay,
    concatAudioFn = concatAudioChunks,
    pathExistsFn = pathExists,
    postProcessFn = postProcessQwenSayAudio,
    planChunkInstructsFn = planChunkInstructs,
    detectHotTailFn = detectHotTailSuspect,
    verifyChunkTailFn = verifyChunkTailWithQwenAsr
  } = {}
) {
  if (sentence?.ob?.hollow) {
    throwErrorSentence({
      name: "qwen say input hollow error",
      message: "qwen say input hollow error",
      from: { name: "qwen say" },
      raw: { sentence }
    });
  }
  const text = String(renderSayValue(sentence.ob ?? {}, { rememberFn }) ?? "");
  if (!text.trim()) {
    throwErrorSentence({
      name: "qwen say defective",
      message: "qwen say defective: missing text",
      from: { name: "qwen say" },
      raw: { sentence }
    });
  }
  if (!hasSpeakableContent(text)) {
    throwErrorSentence({
      name: "qwen say defective",
      message: "qwen say defective: empty speakable text",
      from: { name: "qwen say" },
      raw: { sentence, text }
    });
  }

  const outputPath = resolveOutputPath(sentence, { ext: ".wav" });
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const { workflowName, workflowRoot, toneDefault, toneOverride } = await resolveWorkflowAndTone(sentence, { rememberFn, pathExistsFn });
  const host = resolveHost({ rememberFn });
  const toneStrategy = resolveToneStrategy({ rememberFn });
  const manifestInstructs = await resolveToneManifestInstructs(sentence, { rememberFn });
  const sanitizeMap = resolveQwenSaySanitizeMap({ rememberFn });
  const chunks = splitQwenSayTextChunks(text, { forceSentenceChunks: manifestInstructs.length > 0 });
  const integritySource = sanitizeQwenSayScriptText(text, sanitizeMap);
  const integrityChunks = chunks.map((chunk) =>
    sanitizeQwenSayScriptText(normalizeQwenSayChunkText(chunk), sanitizeMap)
  );
  assertChunkIntegrity(integritySource, integrityChunks);
  let chunkInstructs = [];
  let toneStrategyResolved = "";
  if (String(toneOverride ?? "").trim()) {
    chunkInstructs = chunks.map(() => String(toneOverride).trim());
    toneStrategyResolved = "override";
  } else if (manifestInstructs.length > 0) {
    chunkInstructs = chunks.map((chunk, i) => {
      const fromManifest = normalizeToneInstruction(manifestInstructs[i] ?? "", toneDefault);
      if (fromManifest) return fromManifest;
      return inferChunkTone(chunk, toneDefault);
    });
    toneStrategyResolved = manifestInstructs.length === chunks.length ? "manifest" : "manifest-fallback";
  } else {
    const tonePlan = await planChunkInstructsFn(chunks, {
      rememberFn,
      toneOverride,
      toneDefault,
      toneStrategy
    });
    chunkInstructs = Array.isArray(tonePlan?.instructs) && tonePlan.instructs.length === chunks.length
      ? tonePlan.instructs
      : resolveChunkInstructs(chunks, { toneDefault, toneOverride });
    toneStrategyResolved = String(tonePlan?.strategy ?? "").trim() || toneStrategy;
  }
  const postProcessEnabled = resolvePostProcessEnabled({ rememberFn });
  const postProcessFilter = resolvePostProcessFilter({ rememberFn });
  const keepChunkArtifacts = resolveKeepChunkArtifacts({ rememberFn });
  const clipVerifyEnabled = resolveClipVerifyEnabled({ rememberFn });
  const clipVerifyAllChunks = resolveClipVerifyAllChunks({ rememberFn });
  const clipVerifyMaxRetries = resolveClipVerifyMaxRetries({ rememberFn });
  const clipVerifyTailWords = resolveClipVerifyTailWords({ rememberFn });
  const clipVerifyWindowMs = resolveClipVerifyWindowMs({ rememberFn });
  const clipVerifyPeakDb = resolveClipVerifyPeakDb({ rememberFn });
  const clipVerifyDeltaDb = resolveClipVerifyDeltaDb({ rememberFn });
  const clipVerifyMinTailMs = resolveClipVerifyMinTailMs({ rememberFn });
  const clipVerifyMinTailWords = resolveClipVerifyMinTailWords({ rememberFn });
  const clipVerifyTailGapGuardEnabled = resolveClipVerifyTailGapGuardEnabled({ rememberFn });
  const clipVerifyStrict = resolveClipVerifyStrict({ rememberFn });
  const tailPadMs = resolveTailPadMs({ rememberFn });
  const chunkTailPadMs = resolveChunkTailPadMs({ rememberFn });
  const tailPauseMarkup = resolveTailPauseMarkup({ rememberFn });
  const clipVerifyHost = resolveClipVerifyHost({ rememberFn });
  const clipVerifyWorkflowRoot = resolveClipVerifyWorkflowRoot({ rememberFn });
  const clipVerifyWorkflowName = resolveClipVerifyWorkflowName({ rememberFn });
  let postProcessApplied = false;
  let chunkArtifactsDir = "";
  const chunkVerification = [];
  const preparedChunks = chunks.map((chunk, index) => ({
    index,
    raw: String(chunk ?? ""),
    text: ensureTrailingDoublePeriod(
      sanitizeQwenSayScriptText(normalizeQwenSayChunkText(chunk), sanitizeMap)
    ),
    speakText: applyTailPauseMarkup(
      ensureTrailingDoublePeriod(
        sanitizeQwenSayScriptText(normalizeQwenSayChunkText(chunk), sanitizeMap)
      ),
      tailPauseMarkup
    )
  }));
  const emptyChunk = preparedChunks.find((entry) => !hasSpeakableContent(entry.text));
  if (emptyChunk) {
    throwErrorSentence({
      name: "qwen say defective",
      message: "qwen say defective: empty speakable chunk",
      from: { name: "qwen say" },
      raw: { sentence, atindex: emptyChunk.index, chunk: emptyChunk.raw, text: emptyChunk.text }
    });
  }

  if (chunks.length <= 1) {
    const singleChunkText = preparedChunks[0]?.text ?? "";
    const singleChunkSpeakText = preparedChunks[0]?.speakText ?? singleChunkText;
    const singleChunkInstruct = chunkInstructs[0] ?? toneDefault;
    const runResult = await runSayFn({
      text: singleChunkSpeakText,
      instruct: singleChunkInstruct,
      workflowName,
      workflowRoot,
      host,
      output: outputPath,
      returnTranscript: clipVerifyEnabled
    });
    if (keepChunkArtifacts) {
      const outputParsed = path.parse(outputPath);
      const chunkDir = path.join(outputParsed.dir, `${outputParsed.name}.qwen-say-chunks`);
      await fs.rm(chunkDir, { recursive: true, force: true });
      await fs.mkdir(chunkDir, { recursive: true });
      const chunkOutput = path.join(chunkDir, `chunk-${'001'}.wav`);
      await fs.copyFile(outputPath, chunkOutput);
      const chunkDurationSeconds = await probeDurationSecondsSafe(chunkOutput);
      const verificationRecord = {
        index: 0,
        retries: 0,
        suspect: false,
        asrChecked: false,
        asrPass: null,
        expectedTail: expectedTailTokens(singleChunkText, clipVerifyTailWords),
        text: singleChunkSpeakText,
        verifyText: singleChunkText,
        durationSeconds: chunkDurationSeconds
      };
      if (clipVerifyEnabled) {
        verificationRecord.asrChecked = true;
        verificationRecord.asrTranscript = String(runResult?.transcript ?? "").trim();
        verificationRecord.asrTimestamps = String(runResult?.timestamps ?? "").trim();
        verificationRecord.asrTailEndSeconds = parseTailEndSeconds(verificationRecord.asrTimestamps);
      }
      const manifestPath = path.join(chunkDir, "chunks.metadata.json");
      const manifest = {
        kind: "qwen say chunk artifacts",
        output: outputPath,
        chunks: [{
          index: 0,
          filename: chunkOutput,
          text: singleChunkSpeakText,
          verifyText: singleChunkText,
          durationSeconds: chunkDurationSeconds,
          instruct: singleChunkInstruct,
          verification: verificationRecord
        }]
      };
      await fs.writeFile(manifestPath, canonicalJsonStringify(manifest), "utf8");
      chunkArtifactsDir = chunkDir;
    }
  } else {
    const outputParsed = path.parse(outputPath);
    const chunkDir = keepChunkArtifacts
      ? path.join(outputParsed.dir, `${outputParsed.name}.qwen-say-chunks`)
      : await fs.mkdtemp(path.join(os.tmpdir(), "pyash-qwen-say-chunks-"));
    const chunkFiles = [];
    try {
      if (keepChunkArtifacts) {
        await fs.rm(chunkDir, { recursive: true, force: true });
        await fs.mkdir(chunkDir, { recursive: true });
      }
      for (let i = 0; i < chunks.length; i += 1) {
        let chunkText = preparedChunks[i]?.text ?? "";
        let chunkSpeakText = preparedChunks[i]?.speakText ?? chunkText;
        const chunkOutput = path.join(chunkDir, `chunk-${String(i + 1).padStart(3, "0")}.wav`);
        const isLastChunk = i === (chunks.length - 1);
        const verificationRecord = {
          index: i,
          retries: 0,
          suspect: false,
          asrChecked: false,
          asrPass: null,
          expectedTail: expectedTailTokens(chunkText, clipVerifyTailWords),
          hotTail: null
        };
        while (true) {
          const runResult = await runSayFn({
            text: chunkSpeakText,
            instruct: chunkInstructs[i] ?? toneDefault,
            workflowName,
            workflowRoot,
            host,
            output: chunkOutput,
            returnTranscript: clipVerifyEnabled,
            seed: randomChunkSeed()
          });
          verificationRecord.asrTailGapFail = false;
          verificationRecord.asrTailGapClamped = false;
          verificationRecord.asrTailOvershootMs = null;
          verificationRecord.asrTailGapMs = null;
          if (!clipVerifyEnabled) break;
          let suspect = false;
          try {
            verificationRecord.hotTail = await detectHotTailFn({
              input: chunkOutput,
              windowMs: clipVerifyWindowMs,
              peakDbThreshold: clipVerifyPeakDb,
              deltaDbThreshold: clipVerifyDeltaDb
            });
            suspect = verificationRecord.hotTail?.suspect === true;
          } catch (err) {
            verificationRecord.hotTail = { suspect: true, error: String(err?.message ?? err) };
            suspect = true;
          }
          verificationRecord.suspect = suspect;
          const shortFinalChunkBypass = isLastChunk
            && countWords(chunkText) < Math.max(1, Number(clipVerifyMinTailWords) || 1)
            && !suspect;
          if (shortFinalChunkBypass) {
            verificationRecord.asrChecked = false;
            verificationRecord.asrBypassed = "short-final-chunk";
            verificationRecord.asrPass = true;
            break;
          }
          const shouldAsrCheck = clipVerifyAllChunks || suspect || isLastChunk;
          if (!shouldAsrCheck) break;
          verificationRecord.asrChecked = true;
          const inlineTranscript = String(runResult?.transcript ?? "").trim();
          const inlineTimestamps = String(runResult?.timestamps ?? "").trim();
          if (inlineTranscript) {
            const inlineVerdict = verifyAsrTailMatchUsingTranscriptAndTimestamps({
              expectedTail: verificationRecord.expectedTail,
              transcript: inlineTranscript,
              timestamps: inlineTimestamps
            });
            verificationRecord.asrPass = inlineVerdict?.pass === true;
            verificationRecord.asrMatched = Number(inlineVerdict?.matched ?? 0);
            verificationRecord.asrExpected = Number(inlineVerdict?.expected ?? verificationRecord.expectedTail.length);
            verificationRecord.asrMatchSource = String(inlineVerdict?.source ?? "transcript");
            verificationRecord.asrTranscript = inlineTranscript;
            verificationRecord.asrTimestamps = inlineTimestamps;
            verificationRecord.asrTailEndSeconds = parseTailEndSeconds(inlineTimestamps);
            verificationRecord.asrSource = "inline";
            const durationSeconds = Number(verificationRecord?.hotTail?.durationSeconds ?? NaN);
            if (verificationRecord.asrPass) {
              applyTailGapGuard({
                verificationRecord,
                durationSeconds,
                isLastChunk,
                clipVerifyMinTailMs,
                clipVerifyMinTailWords,
                chunkText,
                guardEnabled: clipVerifyTailGapGuardEnabled && verificationRecord.suspect === true
              });
            }
            if (!verificationRecord.asrPass) {
              const asrResult = await verifyChunkTailFn({
                input: chunkOutput,
                host: clipVerifyHost,
                workflowRoot: clipVerifyWorkflowRoot,
                workflowName: clipVerifyWorkflowName,
                expectedTail: verificationRecord.expectedTail
              });
              if (asrResult?.pass === true) {
                verificationRecord.asrPass = true;
                verificationRecord.asrMatched = Number(asrResult?.matched ?? 0);
                verificationRecord.asrExpected = Number(asrResult?.expected ?? verificationRecord.expectedTail.length);
                verificationRecord.asrMatchSource = String(asrResult?.matchSource ?? "transcript");
                verificationRecord.asrTranscript = String(asrResult?.transcript ?? "");
                verificationRecord.asrTimestamps = String(asrResult?.timestamps ?? "");
                const fallbackTailEnd = Number(asrResult?.tailEndSeconds);
                verificationRecord.asrTailEndSeconds = Number.isFinite(fallbackTailEnd) ? fallbackTailEnd : null;
                verificationRecord.asrSource = "external-fallback";
                const durationSeconds = Number(verificationRecord?.hotTail?.durationSeconds ?? NaN);
                applyTailGapGuard({
                  verificationRecord,
                  durationSeconds,
                  isLastChunk,
                  clipVerifyMinTailMs,
                  clipVerifyMinTailWords,
                  chunkText
                });
              }
            }
          } else {
            const asrResult = await verifyChunkTailFn({
              input: chunkOutput,
              host: clipVerifyHost,
              workflowRoot: clipVerifyWorkflowRoot,
              workflowName: clipVerifyWorkflowName,
              expectedTail: verificationRecord.expectedTail
            });
            verificationRecord.asrPass = asrResult?.pass === true;
            verificationRecord.asrMatched = Number(asrResult?.matched ?? 0);
            verificationRecord.asrExpected = Number(asrResult?.expected ?? verificationRecord.expectedTail.length);
            verificationRecord.asrMatchSource = String(asrResult?.matchSource ?? "transcript");
            verificationRecord.asrTranscript = String(asrResult?.transcript ?? "");
            verificationRecord.asrTimestamps = String(asrResult?.timestamps ?? "");
            const externalTailEnd = Number(asrResult?.tailEndSeconds);
            verificationRecord.asrTailEndSeconds = Number.isFinite(externalTailEnd) ? externalTailEnd : null;
            verificationRecord.asrSource = "external";
            const durationSeconds = Number(verificationRecord?.hotTail?.durationSeconds ?? NaN);
            if (verificationRecord.asrPass) {
              applyTailGapGuard({
                verificationRecord,
                durationSeconds,
                isLastChunk,
                clipVerifyMinTailMs,
                clipVerifyMinTailWords,
                chunkText,
                guardEnabled: clipVerifyTailGapGuardEnabled && verificationRecord.suspect === true
              });
            }
          }
          if (verificationRecord.asrPass) break;
          if (verificationRecord.retries >= clipVerifyMaxRetries) {
            if (verificationRecord.suspect !== true && asrEvidenceUnavailable(verificationRecord)) {
              verificationRecord.asrPass = true;
              verificationRecord.asrBypassed = "asr-unavailable-nonsuspect";
              break;
            }
            if (clipVerifyStrict) {
              throwErrorSentence({
                name: "qwen say defective",
                message: `qwen say defective: clipped chunk retries exhausted at chunk ${i + 1}`,
                from: { name: "qwen say" },
                raw: {
                  chunkIndex: i + 1,
                  retries: verificationRecord.retries,
                  expectedTail: verificationRecord.expectedTail,
                  transcript: verificationRecord.asrTranscript,
                  timestamps: verificationRecord.asrTimestamps,
                  suspect: verificationRecord.suspect
                }
              });
            }
            verificationRecord.asrPass = true;
            verificationRecord.asrBypassed = "retry-exhausted-nonstrict";
            break;
          }
          verificationRecord.retries += 1;
          chunkText = tightenRetryChunkText(chunkText);
          chunkSpeakText = applyTailPauseMarkup(chunkText, tailPauseMarkup);
        }
        verificationRecord.text = chunkSpeakText;
        verificationRecord.verifyText = chunkText;
        if (chunkTailPadMs > 0) {
          const parsedChunk = path.parse(chunkOutput);
          const paddedChunkPath = path.join(parsedChunk.dir, `${parsedChunk.name}.padded${parsedChunk.ext || ".wav"}`);
          await padAudioTail({
            input: chunkOutput,
            output: paddedChunkPath,
            padMs: chunkTailPadMs
          });
          await fs.rename(paddedChunkPath, chunkOutput);
        }
        chunkVerification.push(verificationRecord);
        chunkFiles.push(chunkOutput);
      }
      if (keepChunkArtifacts) {
        const manifestPath = path.join(chunkDir, "chunks.metadata.json");
        const manifest = {
          kind: "qwen say chunk artifacts",
          output: outputPath,
          chunks: chunkFiles.map((filename, index) => ({
            index,
            filename,
            text: chunkVerification[index]?.text ?? preparedChunks[index]?.speakText ?? preparedChunks[index]?.text ?? "",
            instruct: chunkInstructs[index] ?? toneDefault,
            verification: chunkVerification[index] ?? null
          }))
        };
        await fs.writeFile(manifestPath, canonicalJsonStringify(manifest), "utf8");
        chunkArtifactsDir = chunkDir;
      }
      await concatAudioFn({ inputs: chunkFiles, output: outputPath });
    } finally {
      if (!keepChunkArtifacts) {
        await fs.rm(chunkDir, { recursive: true, force: true });
      }
    }
  }

  if (postProcessEnabled && String(postProcessFilter ?? "").trim()) {
    const parsed = path.parse(outputPath);
    const cleanedPath = path.join(parsed.dir, `${parsed.name}.cleaned${parsed.ext || ".wav"}`);
    try {
      await postProcessFn({
        input: outputPath,
        output: cleanedPath,
        filter: postProcessFilter
      });
      await fs.rename(cleanedPath, outputPath);
      postProcessApplied = true;
    } catch {
      await fs.rm(cleanedPath, { force: true });
    }
  }

  if (tailPadMs > 0) {
    const parsed = path.parse(outputPath);
    const paddedPath = path.join(parsed.dir, `${parsed.name}.padded${parsed.ext || ".wav"}`);
    await padAudioTail({
      input: outputPath,
      output: paddedPath,
      padMs: tailPadMs
    });
    await fs.rename(paddedPath, outputPath);
  }

  const audioBytes = await fs.readFile(outputPath);
  const producer = String(sentence?.su?.name ?? "qwen say");
  const artifact = recordArtifact({
    locator: outputPath,
    producer,
    bytes: audioBytes,
    kind: "say"
  });

  const metadataPath = metadataPathForOutput(outputPath);
  const inputBytes = Buffer.from(text, "utf8");
  const metadata = {
    kind: "say",
    backend: "comfyui",
    workflow: workflowName,
    inputSha256: sha256(inputBytes),
    outputSha256: sha256(audioBytes),
    format: "wav",
    streaming: false,
    chunks: chunks.length,
    keepChunkArtifacts,
    chunkArtifactsDir: chunkArtifactsDir || undefined,
    clipVerifyEnabled,
    clipVerifyAllChunks,
    clipVerifyMaxRetries,
    clipVerifyTailWords,
    clipVerifyWindowMs,
    clipVerifyPeakDb,
    clipVerifyDeltaDb,
    clipVerifyMinTailMs,
    clipVerifyStrict,
    tailPadMs,
    chunkTailPadMs,
    tailPauseMarkup,
    clipVerifyHost,
    clipVerifyWorkflowName,
    tone: toneOverride || chunkInstructs[0] || toneDefault,
    toneStrategy: toneStrategyResolved,
    postProcess: postProcessEnabled,
    postProcessApplied,
    postProcessFilter
  };
  const metadataText = canonicalJsonStringify(metadata);
  await fs.writeFile(metadataPath, metadataText, "utf8");
  recordArtifact({
    locator: metadataPath,
    producer,
    bytes: Buffer.from(metadataText, "utf8"),
    kind: "metadata"
  });

  const promptSeriesPath = resolveSayPromptSeriesPath(outputPath);
  const promptSeriesText = renderSayPromptSeries(chunks, chunkInstructs);
  await fs.writeFile(promptSeriesPath, promptSeriesText, "utf8");
  recordArtifact({
    locator: promptSeriesPath,
    producer: `${producer} prompts`,
    bytes: Buffer.from(promptSeriesText, "utf8"),
    kind: "series"
  });

  if (artifact?.su?.name) {
    return { ob: { name: artifact.su.name }, be: "say" };
  }
  return { ob: { text: outputPath }, be: "say" };
}

export const signatures = [
  { signatureWords: ["be", "qwen say", "ob", "text"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "ob", "num"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "ob", "bool"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "ob", "hollow"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "ob", "name", "text"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "ob", "name", "num"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "ob", "name", "bool"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "ob", "name", "hollow"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "ob", "name", "vec"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "ob", "vec"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "ob", "text", "to", "filename"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "ob", "num", "to", "filename"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "ob", "bool", "to", "filename"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "ob", "hollow", "to", "filename"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "ob", "name", "text", "to", "filename"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "ob", "name", "num", "to", "filename"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "ob", "name", "bool", "to", "filename"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "ob", "name", "hollow", "to", "filename"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "ob", "name", "vec", "to", "filename"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "ob", "vec", "to", "filename"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "from", "filename", "ob", "text", "to", "filename"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "from", "filename", "ob", "name", "text", "to", "filename"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "as", "text", "ob", "text"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "as", "text", "ob", "name", "text"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "as", "text", "ob", "text", "to", "filename"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "as", "text", "ob", "name", "text", "to", "filename"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "from", "filename", "as", "text", "ob", "text", "to", "filename"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "from", "filename", "as", "text", "ob", "name", "text", "to", "filename"], handler: qwenSay }
];

